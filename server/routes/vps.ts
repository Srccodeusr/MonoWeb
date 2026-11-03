import { Router, Response } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../auth';
import { VpsInstance } from '../../src/vpsTypes';
import { VpsDaemonError, vpsDaemon } from '../vps/daemonClient';
import {
  Db, VpsError, allowedImages, chargeCredits, dpath, forgetLive, fulfilDeployOrder, liveState, logVpsEvent, newVpsOrder, nodeOf, pickImage, pickNode, publicHost, recordBillingOrder,
  refundCredits, resolveRenewPlan, rootPassword, touchOrder, extendVps, viewOf, vpsSettings,
} from '../vps/service';
import { encryptSecret, randomPassword } from '../hosting/crypto';

const router = Router();
router.use(authMiddleware);

type H = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: H) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (e: any) {
    if (res.headersSent) return;
    const status = e instanceof VpsError || e instanceof VpsDaemonError ? e.status : (e?.status || 400);
    if (status >= 500 && !(e instanceof VpsDaemonError)) console.error('[VPS]', e?.message || e);
    res.status(status).json({ success: false, error: { code: e?.code || 'VPS_ERROR', message: status >= 500 && !(e instanceof VpsDaemonError) && !(e instanceof VpsError) ? 'Internal error.' : (e?.message || 'Request failed.') } });
  }
};
const ok = (res: Response, data: unknown = {}) => res.json({ success: true, data });
const isStaff = (req: AuthenticatedRequest) => ['admin', 'super_admin'].includes(req.user!.role);
const bad = (m: string, code = 'INVALID_INPUT'): never => { throw new VpsError(400, m, code); };
const text = (v: unknown, max: number, label: string): string => { if (typeof v !== 'string' || v.length > max) return bad(`${label} is invalid.`); return v; };

/** Owner (or an admin) + the node. `write` blocks suspended / installing VPSes. */
async function mine(req: AuthenticatedRequest, opts: { write?: boolean; needNode?: boolean } = {}) {
  const db = await getDb();
  const v = db.vpsServers.find(x => x.id === req.params.id);
  if (!v || (v.ownerId !== req.user!.id && !isStaff(req))) throw new VpsError(404, 'VPS not found.', 'NOT_FOUND');
  if (opts.write) {
    if (v.suspended) throw new VpsError(403, `This VPS is ${v.suspendReason === 'expired' ? 'expired. Renew it to continue.' : `suspended${v.suspendReason ? ` (${v.suspendReason})` : ''}. Contact support.`}`, 'SUSPENDED');
    if (v.status === 'installing') throw new VpsError(409, 'This VPS is still installing.', 'INSTALLING');
  }
  const node = nodeOf(db, v);
  if (opts.needNode !== false && !node) throw new VpsError(409, 'The node for this VPS was removed. Contact support.', 'NODE_MISSING');
  return { db, v, node: node!, actor: req.user!.email, ip: req.ip };
}
const feature = (db: Db, key: 'allowTerminal' | 'allowSshx' | 'allowFileManager' | 'allowReinstall' | 'allowRenewal', label: string) => { if (!vpsSettings(db)[key]) throw new VpsError(403, `${label} is turned off by the administrator.`, 'FEATURE_OFF'); };
const planFor = (db: Db, v: VpsInstance) => db.vpsPlans.find(p => p.id === v.planId) || null;
const planOut = (db: Db, v: VpsInstance) => { const p = planFor(db, v) || resolveRenewPlan(db, v); return p ? { name: p.name, price: p.price, periodDays: p.periodDays } : { name: v.planName, price: 0, periodDays: 0 }; };

/* ============================================================== catalogue + orders */
const publicSettings = (db: Db) => {
  const s = vpsSettings(db);
  return { enabled: s.enabled, paymentMode: s.paymentMode, allowRenewal: s.allowRenewal, allowReinstall: s.allowReinstall, allowTerminal: s.allowTerminal, allowSshx: s.allowSshx, allowFileManager: s.allowFileManager,
    announcement: s.announcement, newVpsNote: s.newVpsNote, maxVpsPerUser: s.maxVpsPerUser, currencySymbol: db.settings.currencySymbol || '$' };
};

router.get('/catalog', wrap(async (req, res) => {
  const db = await getDb(); const me = db.users.find(u => u.id === req.user!.id)!;
  const plans = db.vpsPlans.filter(p => p.enabled).sort((a, b) => a.sort - b.sort).map(p => ({ id: p.id, name: p.name, description: p.description, cpu: p.cpu, ramMb: p.ramMb, diskGb: p.diskGb, bandwidthGb: p.bandwidthGb, price: p.price, periodDays: p.periodDays, isPopular: p.isPopular,
    images: allowedImages(db, p).map(i => ({ id: i.id, label: i.label })) }));
  const locations = [...new Set(db.vpsNodes.filter(n => n.enabled).map(n => n.location))];
  ok(res, { plans, locations, credits: me.credits, owned: db.vpsServers.filter(v => v.ownerId === me.id).length, settings: publicSettings(db), capacity: db.vpsNodes.some(n => n.enabled) });
}));

router.get('/orders', wrap(async (req, res) => {
  const db = await getDb();
  ok(res, db.vpsOrders.filter(o => o.userId === req.user!.id).slice(0, 100).map(o => ({ id: o.id, planName: o.planName, kind: o.kind, amount: o.amount, status: o.status, error: o.status === 'declined' ? o.adminNote : undefined, vpsId: o.vpsId, name: o.name, createdAt: o.createdAt })));
}));

/** Buy a VPS with account credits. instant = deployed right away; manual = staff approve it (credits held, refunded on decline). */
router.post('/deploy', wrap(async (req, res) => {
  const db = await getDb(); const s = vpsSettings(db);
  if (!s.enabled) throw new VpsError(403, 'VPS hosting is not available right now.', 'DISABLED');
  const user = db.users.find(u => u.id === req.user!.id)!;
  const plan = db.vpsPlans.find(p => p.id === req.body?.planId && p.enabled); if (!plan) throw new VpsError(404, 'That plan is not available.', 'PLAN_NOT_FOUND');
  if (s.maxVpsPerUser > 0 && db.vpsServers.filter(v => v.ownerId === user.id).length >= s.maxVpsPerUser) throw new VpsError(400, `You can own at most ${s.maxVpsPerUser} VPS.`, 'LIMIT_REACHED');
  const wanted = typeof req.body?.image === 'string' ? req.body.image : undefined;
  if (wanted && !allowedImages(db, plan).some(i => i.id === wanted)) bad('That operating system is not available for this plan.');
  const image = pickImage(db, plan, wanted);
  const name = (typeof req.body?.name === 'string' ? req.body.name.trim() : '').slice(0, 40) || `${plan.name} VPS`;
  const loc = typeof req.body?.location === 'string' && db.vpsNodes.some(n => n.enabled && n.location === req.body.location) ? req.body.location : '';
  if (!pickNode(db, plan, loc || undefined)) throw new VpsError(503, 'No VPS node has free capacity right now. Please try again shortly.', 'NO_CAPACITY');
  if (s.paymentMode === 'manual' && db.vpsOrders.some(o => o.userId === user.id && o.planId === plan.id && o.status === 'pending')) throw new VpsError(400, `You already have a pending order for ${plan.name}.`, 'DUPLICATE_PENDING');

  chargeCredits(user, plan.price);   // throws INSUFFICIENT_CREDITS before anything is created
  const manual = s.paymentMode === 'manual';
  const bo = recordBillingOrder(db, user, plan, plan.price, manual && plan.price > 0 ? 'pending' : 'paid', { creditsHeld: manual && plan.price > 0, serverName: name });
  const vo = newVpsOrder(db, { userId: user.id, userEmail: user.email, planId: plan.id, planName: plan.name, kind: 'deploy', image: image.id, name, location: loc, amount: plan.price, paymentMethod: bo.paymentMethod,
    creditsHeld: bo.creditsHeld === true, billingOrderId: bo.id, source: 'panel', status: manual && plan.price > 0 ? 'pending' : 'paid' });
  saveDbSync();
  if (manual && plan.price > 0) {
    logVpsEvent(db, { id: '-', ownerId: user.id } as VpsInstance, user.email, 'ORDER_SUBMITTED', `${plan.name} awaiting approval`); saveDbSync();
    return ok(res, { pending: true, orderId: vo.id, message: 'Payment received. A staff member will verify your order and your VPS will appear here.', credits: user.credits });
  }
  try {
    const vps = await fulfilDeployOrder(db, vo);
    ok(res, { vpsId: vps.id, credits: user.credits });
  } catch (e: any) {
    refundCredits(user, plan.price); bo.status = 'failed'; bo.creditsHeld = false; bo.adminNote = `Deployment failed, credits refunded: ${e?.message}`;
    touchOrder(vo, { status: 'failed', error: e?.message || 'Deployment failed', creditsHeld: false }); saveDbSync();
    throw e;
  }
}));

/* ============================================================== my VPS */
router.get('/', wrap(async (req, res) => {
  const db = await getDb();
  const list = db.vpsServers.filter(v => v.ownerId === req.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out = await Promise.all(list.map(async v => viewOf(db, v, v.suspended || v.status === 'installing' ? undefined : await liveState(db, v, 5000))));
  ok(res, { vps: out, settings: publicSettings(db) });
}));

router.get('/:id', wrap(async (req, res) => {
  const { db, v } = await mine(req, { needNode: false }); const live = await liveState(db, v);
  ok(res, { vps: viewOf(db, v, v.suspended || v.status === 'installing' ? undefined : live), stats: live.stats, plan: planOut(db, v), settings: publicSettings(db), diskEnforced: v.diskEnforced !== false });
}));

router.get('/:id/credentials', wrap(async (req, res) => {
  const { db, v, node, actor, ip } = await mine(req);
  logVpsEvent(db, v, actor, 'CREDENTIALS_VIEWED', '', ip); saveDbSync();
  ok(res, { host: publicHost(node), port: v.sshPort, username: 'root', password: rootPassword(v) });
}));

router.patch('/:id', wrap(async (req, res) => {
  const { db, v, actor, ip } = await mine(req, { needNode: false });
  const name = text(req.body?.name, 40, 'Name').trim(); if (!name) bad('Name cannot be empty.');
  const old = v.name; v.name = name; logVpsEvent(db, v, actor, 'RENAMED', `${old} → ${name}`, ip); saveDbSync(); ok(res);
}));

router.post('/:id/power', wrap(async (req, res) => {
  const { db, v, node, actor, ip } = await mine(req, { write: true }); const a = req.body?.action;
  if (!['start', 'stop', 'restart', 'kill'].includes(a)) bad('Unknown power action.');
  await vpsDaemon(node, 'POST', dpath(v, '/power'), { action: a }, 45_000); forgetLive(v.id);
  logVpsEvent(db, v, actor, `POWER_${String(a).toUpperCase()}`, '', ip); saveDbSync(); ok(res);
}));

router.get('/:id/logs', wrap(async (req, res) => { const { v, node } = await mine(req); ok(res, await vpsDaemon(node, 'GET', dpath(v, '/logs', '?tail=300'))); }));

router.post('/:id/exec', wrap(async (req, res) => {
  const { db, v, node } = await mine(req, { write: true }); feature(db, 'allowTerminal', 'The terminal');
  const cmd = text(req.body?.cmd, 8000, 'Command'); const cwd = typeof req.body?.cwd === 'string' && req.body.cwd.startsWith('/') ? req.body.cwd.slice(0, 1000) : '/root';
  ok(res, await vpsDaemon(node, 'POST', dpath(v, '/exec'), { cmd, cwd }, 35_000));
}));

/* ---- files ---- */
const fq = (p: unknown) => encodeURIComponent(typeof p === 'string' && p.startsWith('/') && p.length <= 1000 ? p : '/');
router.get('/:id/files', wrap(async (req, res) => { const { db, v, node } = await mine(req); feature(db, 'allowFileManager', 'The file manager'); ok(res, await vpsDaemon(node, 'GET', dpath(v, '/files', `?path=${fq(req.query.path)}`))); }));
router.get('/:id/file', wrap(async (req, res) => { const { db, v, node } = await mine(req); feature(db, 'allowFileManager', 'The file manager'); ok(res, await vpsDaemon(node, 'GET', dpath(v, '/file', `?path=${fq(req.query.path)}`))); }));
router.put('/:id/file', wrap(async (req, res) => {
  const { db, v, node } = await mine(req, { write: true }); feature(db, 'allowFileManager', 'The file manager');
  ok(res, await vpsDaemon(node, 'PUT', dpath(v, '/file'), { path: text(req.body?.path, 1000, 'Path'), content: String(req.body?.content ?? '') }));
}));
for (const [sub, keys] of [['mkdir', ['path']], ['delete', ['path']], ['rename', ['from', 'to']]] as const) {
  router.post(`/:id/files/${sub}`, wrap(async (req, res) => {
    const { db, v, node } = await mine(req, { write: true }); feature(db, 'allowFileManager', 'The file manager');
    ok(res, await vpsDaemon(node, 'POST', dpath(v, '/' + sub), Object.fromEntries(keys.map(k => [k, text(req.body?.[k], 1000, k)]))));
  }));
}

/* ---- sshx ---- */
router.get('/:id/sshx', wrap(async (req, res) => { const { db, v, node } = await mine(req); feature(db, 'allowSshx', 'sshx'); ok(res, await vpsDaemon(node, 'GET', dpath(v, '/sshx'))); }));
router.post('/:id/sshx', wrap(async (req, res) => {
  const { db, v, node, actor, ip } = await mine(req, { write: true }); feature(db, 'allowSshx', 'sshx');
  const action = req.body?.action === 'stop' ? 'stop' : 'start';
  const r = await vpsDaemon(node, 'POST', dpath(v, '/sshx'), { action }, 45_000);
  logVpsEvent(db, v, actor, action === 'start' ? 'SSHX_STARTED' : 'SSHX_STOPPED', '', ip); saveDbSync(); ok(res, r);
}));

/* ---- password / reinstall / renew ---- */
router.post('/:id/password', wrap(async (req, res) => {
  const { db, v, node, actor, ip } = await mine(req, { write: true }); const pw = randomPassword(20);
  await vpsDaemon(node, 'POST', dpath(v, '/password'), { password: pw }); v.rootPasswordEnc = encryptSecret(pw);
  logVpsEvent(db, v, actor, 'PASSWORD_RESET', '', ip); saveDbSync(); ok(res, { password: pw });
}));

router.post('/:id/reinstall', wrap(async (req, res) => {
  const { db, v, node, actor, ip } = await mine(req, { write: true }); feature(db, 'allowReinstall', 'Reinstalling');
  if (req.body?.confirm !== v.name) bad('Type the VPS name to confirm.', 'CONFIRM_MISMATCH');
  const plan = planFor(db, v); const image = pickImage(db, plan || { images: [] }, typeof req.body?.image === 'string' ? req.body.image : v.image);
  const pw = randomPassword(20); v.status = 'installing'; saveDbSync(); forgetLive(v.id);
  try {
    const r = await vpsDaemon<{ diskEnforced?: boolean }>(node, 'POST', '/v1/vps', { id: v.id, image: image.id, base: image.base, ...v.spec, hostname: `vps-${v.id.slice(0, 6)}`, sshPort: v.sshPort, rootPassword: pw, reinstall: true }, 15 * 60_000);
    v.image = image.id; v.rootPasswordEnc = encryptSecret(pw); v.status = 'running'; v.lastError = undefined; v.diskEnforced = r.diskEnforced !== false;
  } catch (e: any) {
    // The daemon removes the old container before building the new one, so after a failure the VPS may be gone: say so instead of pretending it is "running".
    v.status = 'error'; v.lastError = `Reinstall failed: ${e?.message || 'unknown error'}. Try again or contact support.`; saveDbSync(); logVpsEvent(db, v, actor, 'REINSTALL_FAILED', e?.message || '', ip); saveDbSync();
    throw e;
  }
  logVpsEvent(db, v, actor, 'REINSTALLED', image.label, ip); saveDbSync(); ok(res);
}));

router.post('/:id/renew', wrap(async (req, res) => {
  const { db, v, actor, ip } = await mine(req, { needNode: false }); feature(db, 'allowRenewal', 'Renewal');
  if (v.ownerId !== req.user!.id) throw new VpsError(403, 'Only the owner can renew this VPS.', 'FORBIDDEN');
  const plan = resolveRenewPlan(db, v); if (!plan) throw new VpsError(400, 'This plan can no longer be renewed online. Contact support.', 'NO_PLAN');
  const user = db.users.find(u => u.id === req.user!.id)!;
  chargeCredits(user, plan.price);
  const bo = recordBillingOrder(db, user, plan, plan.price, 'paid', { serverName: v.name });
  newVpsOrder(db, { userId: user.id, userEmail: user.email, planId: plan.id, planName: plan.name, kind: 'renew', vpsId: v.id, image: v.image, name: v.name, location: '', amount: plan.price, paymentMethod: bo.paymentMethod,
    creditsHeld: false, billingOrderId: bo.id, source: 'panel', status: 'fulfilled' });
  await extendVps(db, v, plan.periodDays);
  logVpsEvent(db, v, actor, 'RENEWED', `+${plan.periodDays} days for $${plan.price.toFixed(2)}`, ip); saveDbSync();
  ok(res, { expiresAt: v.expiresAt, credits: user.credits });
}));

router.get('/:id/activity', wrap(async (req, res) => { const { db, v } = await mine(req, { needNode: false }); ok(res, db.vpsEvents.filter(e => e.vpsId === v.id).slice(0, 100)); }));

export default router;
