import { Router, Response } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, requireRole, createAuditLog, AuthenticatedRequest } from '../auth';
import { VpsInstance, VpsNode, VpsOsImage, VpsPlan, VpsSettings, defaultVpsSettings } from '../../src/vpsTypes';
import { encryptSecret, newId, randomPassword, randomToken } from '../hosting/crypto';
import { publicBaseUrl } from '../hosting/billing';
import { onNodesChanged } from '../bot/nodes';
import { VpsDaemonError, pingVpsNode, vpsDaemon, vpsInstallCommands } from '../vps/daemonClient';
import {
  Db, VpsError, addDays, destroyVps, dpath, extendVps, forgetLive, fulfilDeployOrder, imageById, liveState, logVpsEvent, mailUser, nodeOf, nodeUsage, pickImage, provisionVps,
  refreshVpsNodes, refundCredits, resizeVps, rootPassword, touchOrder, viewOf, vpsSettings,
} from '../vps/service';

const router = Router();
router.use(authMiddleware, requireRole(['admin', 'super_admin']));

type H = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: H) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (e: any) {
    if (res.headersSent) return;
    const status = e instanceof VpsError || e instanceof VpsDaemonError ? e.status : (e?.status || 400);
    if (status >= 500 && !(e instanceof VpsDaemonError)) console.error('[VPS-Admin]', e?.message || e);
    res.status(status).json({ success: false, error: { code: e?.code || 'ERROR', message: e?.message || 'Request failed.' } });
  }
};
const ok = (res: Response, data: unknown = {}) => res.json({ success: true, data });
const bad = (m: string): never => { throw new VpsError(400, m, 'INVALID_INPUT'); };
const audit = (req: AuthenticatedRequest, action: string, target: string, details: string) => createAuditLog(req.user!.id, req.user!.email, req.user!.role, action, target, details, req.ip || '127.0.0.1');
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v: unknown, d = '', max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

const findVps = async (req: AuthenticatedRequest) => {
  const db = await getDb(); const v = db.vpsServers.find(x => x.id === req.params.id); if (!v) throw new VpsError(404, 'VPS not found.', 'NOT_FOUND');
  return { db, v, node: nodeOf(db, v) };
};
const needNode = (n: VpsNode | undefined): VpsNode => n || bad('The node for this VPS was removed.');

/* ============================================================== overview */
router.get('/overview', wrap(async (_req, res) => {
  const db = await getDb(); const now = Date.now(); const since = now - 30 * 86_400_000;
  const by: Record<string, number> = {}; for (const v of db.vpsServers) { const k = v.suspended ? (v.suspendReason === 'expired' ? 'expired' : 'suspended') : v.status; by[k] = (by[k] || 0) + 1; }
  const paid = db.vpsOrders.filter(o => o.status === 'fulfilled');
  const cap = db.vpsNodes.reduce((a, n) => ({ ramMb: a.ramMb + (n.ramMb || 0), diskGb: a.diskGb + (n.diskGb || 0) }), { ramMb: 0, diskGb: 0 });
  const used = db.vpsServers.reduce((a, v) => ({ ramMb: a.ramMb + v.spec.ramMb, diskGb: a.diskGb + v.spec.diskGb, cpu: a.cpu + v.spec.cpu }), { ramMb: 0, diskGb: 0, cpu: 0 });
  const alerts: { level: 'red' | 'amber'; text: string; page?: string }[] = [];
  for (const n of db.vpsNodes) if (n.status?.online === false) alerts.push({ level: 'red', text: `Node ${n.name} is offline${n.status.error ? `: ${n.status.error}` : ''}`, page: 'admin-vps-nodes' });
  if (!db.vpsNodes.some(n => n.enabled)) alerts.push({ level: 'amber', text: 'No node accepts new VPSes. Customers cannot deploy.', page: 'admin-vps-nodes' });
  const noQuota = db.vpsServers.filter(v => v.diskEnforced === false).length; if (noQuota) alerts.push({ level: 'amber', text: `${noQuota} VPS(es) have no hard disk limit (node filesystem lacks xfs pquota).`, page: 'admin-vps-servers' });
  const failed = db.vpsOrders.filter(o => o.status === 'failed' || (o.status === 'pending' && o.error)).length; if (failed) alerts.push({ level: 'amber', text: `${failed} VPS order(s) failed to deploy.`, page: 'admin-vps-orders' });
  const errors = db.vpsServers.filter(v => v.status === 'error').length; if (errors) alerts.push({ level: 'red', text: `${errors} VPS(es) are in an error state.`, page: 'admin-vps-servers' });
  ok(res, {
    enabled: vpsSettings(db).enabled,
    nodes: { total: db.vpsNodes.length, online: db.vpsNodes.filter(n => n.status?.online).length, accepting: db.vpsNodes.filter(n => n.enabled).length },
    vps: { total: db.vpsServers.length, byStatus: by, expiringSoon: db.vpsServers.filter(v => !v.suspended && Date.parse(v.expiresAt) - now < 3 * 86_400_000).length, owners: new Set(db.vpsServers.map(v => v.ownerId)).size },
    orders: { pending: db.vpsOrders.filter(o => o.status === 'pending').length, failed },
    revenue: { total: paid.reduce((a, o) => a + o.amount, 0), last30: paid.filter(o => Date.parse(o.createdAt) > since).reduce((a, o) => a + o.amount, 0), renewals30: paid.filter(o => o.kind === 'renew' && Date.parse(o.createdAt) > since).length },
    allocation: { ...used, capRamMb: cap.ramMb, capDiskGb: cap.diskGb },
    plans: db.vpsPlans.length, images: db.vpsImages.filter(i => i.enabled).length, alerts,
    recent: db.vpsEvents.slice(0, 8),
  });
}));

/* ============================================================== nodes */
const nodeOut = (db: Db, n: VpsNode) => { const { secretEnc, ...rest } = n; return { ...rest, usage: nodeUsage(db, n.id) }; };
function sanitizeNode(b: any, base?: VpsNode): Omit<VpsNode, 'id' | 'secretEnc' | 'status' | 'createdAt'> {
  const g = (k: keyof VpsNode, d: unknown) => (b?.[k] !== undefined ? b[k] : base ? (base as any)[k] : d);
  const n = {
    name: str(g('name', ''), '', 60), location: str(g('location', 'Default'), 'Default', 60) || 'Default', daemonHost: str(g('daemonHost', ''), '', 200),
    daemonPort: Math.round(num(g('daemonPort', 3100), 3100)), scheme: g('scheme', 'http') === 'https' ? 'https' as const : 'http' as const, publicHost: str(g('publicHost', ''), '', 200),
    maxVps: Math.max(0, Math.round(num(g('maxVps', 20), 20))), portMin: Math.round(num(g('portMin', 42000), 42000)), portMax: Math.round(num(g('portMax', 42999), 42999)),
    ramMb: Math.max(0, Math.round(num(g('ramMb', 0), 0))), diskGb: Math.max(0, Math.round(num(g('diskGb', 0), 0))), cpus: Math.max(0, num(g('cpus', 0), 0)), overallocatePercent: Math.min(500, Math.max(0, Math.round(num(g('overallocatePercent', 0), 0)))),
    enabled: bool(g('enabled', true), true), discordBot: bool(g('discordBot', false), false), notes: str(g('notes', ''), '', 500),
  };
  if (!n.name) bad('Give the node a name.');
  if (!/^[\w.-]+$/.test(n.daemonHost)) bad('Enter the daemon address as a hostname or IPv4 address.');
  if (n.publicHost && !/^[\w.-]+$/.test(n.publicHost)) bad('The public address must be a hostname or IPv4 address.');
  if (!(n.daemonPort > 0 && n.daemonPort < 65536)) bad('Daemon port must be 1-65535.');
  if (!(n.portMin >= 1024 && n.portMax <= 65535 && n.portMin < n.portMax)) bad('SSH port range must be inside 1024-65535 (from < to).');
  return n;
}

router.get('/nodes', wrap(async (_req, res) => { const db = await getDb(); ok(res, db.vpsNodes.map(n => nodeOut(db, n))); }));

router.post('/nodes', wrap(async (req, res) => {
  const db = await getDb(); const clean = sanitizeNode(req.body);
  for (const o of db.vpsNodes) if (o.daemonHost === clean.daemonHost && o.daemonPort === clean.daemonPort) bad('A node with this address and port already exists.');
  const secret = randomToken(36);
  const node: VpsNode = { id: newId('vnode'), ...clean, secretEnc: encryptSecret(secret), status: { online: false }, createdAt: new Date().toISOString() };
  db.vpsNodes.push(node); saveDbSync(); await audit(req, 'VPS_NODE_CREATED', node.id, `Added VPS node ${node.name}`); await onNodesChanged();   // bot nodes are handed to the Discord bot automatically
  const panelUrl = publicBaseUrl(req as any);
  res.status(201).json({ success: true, data: { node: nodeOut(db, node), secret, panelUrl, ...vpsInstallCommands(panelUrl, secret, node.daemonPort) } });
}));

router.put('/nodes/:id', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) throw new VpsError(404, 'Node not found.');
  const clean = sanitizeNode(req.body, n);
  const outside = db.vpsServers.filter(v => v.nodeId === n.id && (v.sshPort < clean.portMin || v.sshPort > clean.portMax)).length;
  if (outside) bad(`${outside} VPS(es) on this node use SSH ports outside the new range.`);
  Object.assign(n, clean); saveDbSync(); await audit(req, 'VPS_NODE_UPDATED', n.id, `Updated VPS node ${n.name}`); await onNodesChanged(); ok(res, nodeOut(db, n));
}));

router.post('/nodes/:id/rotate-secret', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) throw new VpsError(404, 'Node not found.');
  const secret = randomToken(36); n.secretEnc = encryptSecret(secret); n.status = { ...n.status, online: false }; saveDbSync();
  await audit(req, 'VPS_NODE_SECRET_ROTATED', n.id, n.name); const panelUrl = publicBaseUrl(req as any);
  ok(res, { secret, panelUrl, ...vpsInstallCommands(panelUrl, secret, n.daemonPort) });
}));

router.post('/nodes/:id/test', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) throw new VpsError(404, 'Node not found.');
  try {
    const { ping, system } = await pingVpsNode(n);
    n.status = { online: true, checkedAt: new Date().toISOString(), version: ping.version, runtime: system.runtime, system: { cpus: system.cpus, memTotalMb: system.memTotalMb, memFreeMb: system.memFreeMb, diskTotalMb: system.diskTotalMb, diskFreeMb: system.diskFreeMb, loadavg: system.loadavg || [0, 0, 0], uptimeS: system.uptimeS, vpsCount: system.vpsCount, vpsRunning: system.vpsRunning } };
    saveDbSync(); ok(res, nodeOut(db, n));
  } catch (e: any) {
    n.status = { ...n.status, online: false, checkedAt: new Date().toISOString(), error: e.message }; saveDbSync();
    res.json({ success: false, error: { code: 'UNREACHABLE', message: e.message }, data: nodeOut(db, n) });
  }
}));

/** Compare what the panel believes with what the node actually runs. */
router.get('/nodes/:id/reconcile', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) throw new VpsError(404, 'Node not found.');
  const remote = (await vpsDaemon<{ vps: { id: string; status: string }[] }>(n, 'GET', '/v1/vps', undefined, 15_000)).vps;
  const mine = db.vpsServers.filter(v => v.nodeId === n.id);
  ok(res, {
    orphans: remote.filter(r => !mine.some(v => v.id === r.id)),                                   // containers the panel does not know about
    missing: mine.filter(v => v.status !== 'installing' && !remote.some(r => r.id === v.id)).map(v => ({ id: v.id, name: v.name })),   // panel records without a container
    ok: mine.length - mine.filter(v => !remote.some(r => r.id === v.id)).length,
  });
}));
router.post('/nodes/:id/prune', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) throw new VpsError(404, 'Node not found.');
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string' && /^[a-z0-9-]{6,40}$/.test(x)) : [];
  let removed = 0;
  for (const id of ids) { if (db.vpsServers.some(v => v.id === id)) continue; await vpsDaemon(n, 'DELETE', `/v1/vps/${id}`, undefined, 60_000).then(() => { removed++; }).catch(() => undefined); }
  await audit(req, 'VPS_NODE_PRUNED', n.id, `Removed ${removed} orphan container(s)`); ok(res, { removed });
}));

router.delete('/nodes/:id', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) throw new VpsError(404, 'Node not found.');
  if (db.vpsServers.some(v => v.nodeId === n.id)) throw new VpsError(409, 'This node still hosts VPSes. Delete them first.', 'NODE_IN_USE');
  db.vpsNodes = db.vpsNodes.filter(x => x.id !== n.id); saveDbSync(); await audit(req, 'VPS_NODE_DELETED', n.id, n.name); await onNodesChanged(); ok(res);
}));
router.post('/refresh', wrap(async (_req, res) => { await refreshVpsNodes(); const db = await getDb(); ok(res, db.vpsNodes.map(n => nodeOut(db, n))); }));

/* ============================================================== servers */
const row = (db: Db, v: VpsInstance) => {
  const owner = db.users.find(u => u.id === v.ownerId); const n = nodeOf(db, v);
  return { ...viewOf(db, v), owner: owner ? { id: owner.id, email: owner.email, username: owner.username } : null, nodeId: v.nodeId, nodeName: n?.name || '(removed)', adminNote: v.adminNote || '', diskEnforced: v.diskEnforced !== false };
};

router.get('/servers', wrap(async (req, res) => {
  const db = await getDb(); const q = str(req.query.search).toLowerCase(); const status = str(req.query.status); const nodeId = str(req.query.nodeId);
  const rows = db.vpsServers.map(v => row(db, v)).filter(r => (!status || r.status === status) && (!nodeId || r.nodeId === nodeId) && (!q || `${r.name} ${r.id} ${r.owner?.email || ''} ${r.owner?.username || ''} ${r.nodeName}`.toLowerCase().includes(q)));
  ok(res, rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500));
}));

router.get('/servers/:id', wrap(async (req, res) => {
  const { db, v } = await findVps(req); const live = await liveState(db, v);
  ok(res, { ...row(db, v), live: { status: live.status, stats: live.stats, nodeOnline: live.nodeOnline, nodeError: live.nodeError }, events: db.vpsEvents.filter(e => e.vpsId === v.id).slice(0, 50), orders: db.vpsOrders.filter(o => o.vpsId === v.id || o.id === v.orderId) });
}));

router.post('/servers', wrap(async (req, res) => {   // gift / replacement / staff-created VPS (no charge)
  const db = await getDb(); const email = str(req.body?.email).toLowerCase();
  const user = db.users.find(u => u.email.toLowerCase() === email); if (!user) bad('No user with that email.');
  const planId = str(req.body?.planId); const plan = db.vpsPlans.find(p => p.id === planId); if (!plan) bad('Pick a plan.');
  const image = pickImage(db, { images: [] }, str(req.body?.image) || undefined);
  const days = Math.min(3650, Math.max(1, Math.round(num(req.body?.days, plan!.periodDays))));
  const { vps } = await provisionVps(db, { owner: user!, plan: plan!, image, name: str(req.body?.name, '', 40), nodeId: str(req.body?.nodeId) || undefined, periodDays: days });
  logVpsEvent(db, vps, req.user!.email, 'ADMIN_CREATED', `Created by staff for ${user!.email}`, req.ip);
  mailUser(db, user!.id, 'Your VPS is ready', `A VPS named "${vps.name}" (${plan!.name}) was created for you by our team. Open it from the VPS tab of your dashboard.`);
  saveDbSync(); await audit(req, 'VPS_ADMIN_CREATED', vps.id, `${plan!.name} for ${user!.email}`); ok(res, row(db, vps));
}));

router.patch('/servers/:id', wrap(async (req, res) => {   // name, admin note
  const { db, v } = await findVps(req);
  if (req.body?.name !== undefined) { const n = str(req.body.name, '', 40); if (!n) bad('Name cannot be empty.'); v.name = n; }
  if (req.body?.adminNote !== undefined) v.adminNote = str(req.body.adminNote, '', 500);
  saveDbSync(); await audit(req, 'VPS_UPDATED', v.id, 'Edited name/note'); ok(res, row(db, v));
}));

router.post('/servers/:id/suspend', wrap(async (req, res) => {
  const { db, v, node } = await findVps(req); const reason = str(req.body?.reason, 'Suspended by an administrator', 100) || 'Suspended by an administrator';
  v.suspended = true; v.suspendReason = reason; v.status = 'suspended'; saveDbSync(); forgetLive(v.id);
  if (node) await vpsDaemon(node, 'POST', dpath(v, '/power'), { action: 'stop' }, 40_000).catch(() => undefined);
  logVpsEvent(db, v, req.user!.email, 'SUSPENDED', reason, req.ip); mailUser(db, v.ownerId, `VPS "${v.name}" was suspended`, `Your VPS "${v.name}" was suspended.\n\nReason: ${reason}\n\nContact support if you think this is a mistake.`);
  saveDbSync(); await audit(req, 'VPS_SUSPENDED', v.id, reason); ok(res, row(db, v));
}));
router.post('/servers/:id/unsuspend', wrap(async (req, res) => {
  const { db, v, node } = await findVps(req);
  v.suspended = false; v.suspendReason = undefined; v.status = 'offline'; if (Date.parse(v.expiresAt) < Date.now()) v.expiresAt = addDays(Date.now(), 1);   // never unsuspend straight into an expiry
  v.expiredAt = undefined; saveDbSync(); forgetLive(v.id);
  if (node && req.body?.start !== false) await vpsDaemon(node, 'POST', dpath(v, '/power'), { action: 'start' }, 40_000).catch(() => undefined);
  logVpsEvent(db, v, req.user!.email, 'UNSUSPENDED', '', req.ip); saveDbSync(); await audit(req, 'VPS_UNSUSPENDED', v.id, v.name); ok(res, row(db, v));
}));
router.post('/servers/:id/power', wrap(async (req, res) => {
  const { db, v, node } = await findVps(req); const a = req.body?.action; if (!['start', 'stop', 'restart', 'kill'].includes(a)) bad('Unknown power action.');
  await vpsDaemon(needNode(node), 'POST', dpath(v, '/power'), { action: a }, 45_000); forgetLive(v.id); logVpsEvent(db, v, req.user!.email, `POWER_${String(a).toUpperCase()}`, 'by staff', req.ip); saveDbSync(); ok(res);
}));
router.post('/servers/:id/extend', wrap(async (req, res) => {
  const { db, v } = await findVps(req); const days = Math.round(num(req.body?.days, 30)); if (days < 1 || days > 3650) bad('Days must be between 1 and 3650.');
  await extendVps(db, v, days); v.renewCount = Math.max(0, v.renewCount - 1);   // staff extensions are not customer renewals
  logVpsEvent(db, v, req.user!.email, 'EXTENDED', `+${days} days`, req.ip); saveDbSync(); await audit(req, 'VPS_EXTENDED', v.id, `+${days} days`); ok(res, row(db, v));
}));
router.post('/servers/:id/resize', wrap(async (req, res) => {
  const { db, v } = await findVps(req); const cpu = num(req.body?.cpu, v.spec.cpu), ramMb = Math.round(num(req.body?.ramMb, v.spec.ramMb));
  if (!(cpu >= 0.25 && cpu <= 64) || !(ramMb >= 256 && ramMb <= 262144)) bad('CPU must be 0.25-64 and RAM 256 MB-256 GB.');
  await resizeVps(db, v, { cpu, ramMb }); forgetLive(v.id); logVpsEvent(db, v, req.user!.email, 'RESIZED', `${cpu} vCPU / ${ramMb} MB`, req.ip); saveDbSync(); await audit(req, 'VPS_RESIZED', v.id, `${cpu} vCPU / ${ramMb} MB`); ok(res, row(db, v));
}));
router.post('/servers/:id/transfer-owner', wrap(async (req, res) => {
  const { db, v } = await findVps(req); const email = str(req.body?.email).toLowerCase(); const u = db.users.find(x => x.email.toLowerCase() === email); if (!u) bad('No user with that email.');
  const from = db.users.find(x => x.id === v.ownerId)?.email || v.ownerId; v.ownerId = u!.id; logVpsEvent(db, v, req.user!.email, 'OWNER_CHANGED', `${from} → ${u!.email}`, req.ip); saveDbSync(); await audit(req, 'VPS_OWNER_CHANGED', v.id, `${from} → ${u!.email}`); ok(res, row(db, v));
}));
router.post('/servers/:id/reset-password', wrap(async (req, res) => {
  const { db, v, node } = await findVps(req); const pw = randomPassword(20); await vpsDaemon(needNode(node), 'POST', dpath(v, '/password'), { password: pw });
  v.rootPasswordEnc = encryptSecret(pw); logVpsEvent(db, v, req.user!.email, 'PASSWORD_RESET', 'by staff', req.ip); saveDbSync(); await audit(req, 'VPS_PASSWORD_RESET', v.id, v.name); ok(res, { password: pw });
}));
router.post('/servers/:id/reveal-password', wrap(async (req, res) => {   // support tool; every use is audited
  const { db, v } = await findVps(req); logVpsEvent(db, v, req.user!.email, 'PASSWORD_REVEALED', 'by staff', req.ip); saveDbSync(); await audit(req, 'VPS_PASSWORD_REVEALED', v.id, v.name); ok(res, { password: rootPassword(v) });
}));
router.post('/servers/:id/reinstall', wrap(async (req, res) => {
  const { db, v, node } = await findVps(req); const image = pickImage(db, { images: [] }, str(req.body?.image) || v.image); const pw = randomPassword(20);
  v.status = 'installing'; saveDbSync(); forgetLive(v.id);
  try { await vpsDaemon(needNode(node), 'POST', '/v1/vps', { id: v.id, image: image.id, base: image.base, ...v.spec, hostname: `vps-${v.id.slice(0, 6)}`, sshPort: v.sshPort, rootPassword: pw, reinstall: true }, 15 * 60_000); }
  catch (e: any) { v.status = 'error'; v.lastError = `Reinstall failed: ${e?.message}`; saveDbSync(); throw e; }
  v.image = image.id; v.rootPasswordEnc = encryptSecret(pw); v.status = 'running'; v.lastError = undefined; logVpsEvent(db, v, req.user!.email, 'REINSTALLED', `${image.label} by staff`, req.ip); saveDbSync(); await audit(req, 'VPS_REINSTALLED', v.id, image.label); ok(res, row(db, v));
}));
router.post('/servers/:id/clear-error', wrap(async (req, res) => { const { db, v } = await findVps(req); v.lastError = undefined; if (v.status === 'error') v.status = 'offline'; saveDbSync(); ok(res, row(db, v)); }));
router.delete('/servers/:id', wrap(async (req, res) => {
  const { db, v } = await findVps(req); const force = req.query.force === '1';
  await destroyVps(db, v, force); mailUser(db, v.ownerId, `VPS "${v.name}" was deleted`, `Your VPS "${v.name}" was deleted by our team.`);
  saveDbSync(); await audit(req, 'VPS_DELETED', v.id, `${v.name}${force ? ' (forced, node not contacted)' : ''}`); ok(res);
}));

/* ============================================================== orders */
router.get('/orders', wrap(async (req, res) => {
  const db = await getDb(); const status = str(req.query.status); const q = str(req.query.search).toLowerCase();
  ok(res, db.vpsOrders.filter(o => (!status || o.status === status) && (!q || `${o.userEmail} ${o.planName} ${o.id}`.toLowerCase().includes(q))).slice(0, 500));
}));
router.post('/orders/:id/approve', wrap(async (req, res) => {
  const db = await getDb(); const o = db.vpsOrders.find(x => x.id === req.params.id); if (!o) throw new VpsError(404, 'Order not found.');
  if (!['pending', 'paid', 'failed'].includes(o.status) || o.kind !== 'deploy') bad(`This order is already ${o.status}.`);
  if (o.status === 'failed' && o.source !== 'checkout') bad('Failed panel orders were refunded automatically. Ask the customer to order again.');
  try {
    const vps = await fulfilDeployOrder(db, o);
    mailUser(db, o.userId, 'Your VPS is ready', `Your order for "${o.planName}" was approved and your VPS "${vps.name}" is online. Open it from the VPS tab of your dashboard.`);
    saveDbSync(); await audit(req, 'VPS_ORDER_APPROVED', o.id, `${o.planName} for ${o.userEmail}`); ok(res, { order: o, vpsId: vps.id });
  } catch (e: any) { touchOrder(o, { error: e?.message || 'Deployment failed' }); saveDbSync(); throw e; }
}));
router.post('/orders/:id/decline', wrap(async (req, res) => {
  const db = await getDb(); const o = db.vpsOrders.find(x => x.id === req.params.id); if (!o) throw new VpsError(404, 'Order not found.');
  if (o.status !== 'pending') bad('Only pending orders can be declined.');
  const reason = str(req.body?.reason, 'Payment could not be verified', 200) || 'Payment could not be verified';
  const bo = o.billingOrderId ? db.orders.find(x => x.id === o.billingOrderId) : undefined; const user = db.users.find(u => u.id === o.userId);
  let refunded = 0; if (o.creditsHeld) { refundCredits(user, o.amount); refunded = o.amount; }
  if (bo) { bo.status = 'failed'; bo.creditsHeld = false; bo.adminNote = reason; }
  touchOrder(o, { status: 'declined', adminNote: reason, creditsHeld: false });
  mailUser(db, o.userId, 'VPS order declined', `We could not approve your order for "${o.planName}".\n\nReason: ${reason}\n\n${refunded > 0 ? `$${refunded.toFixed(2)} was refunded to your account credits.` : ''}`);
  saveDbSync(); await audit(req, 'VPS_ORDER_DECLINED', o.id, reason); ok(res, o);
}));

/* ============================================================== plans */
function sanitizePlan(b: any, base?: VpsPlan): Omit<VpsPlan, 'id' | 'createdAt' | 'updatedAt'> {
  const g = (k: keyof VpsPlan, d: unknown) => (b?.[k] !== undefined ? b[k] : base ? (base as any)[k] : d);
  const p = {
    name: str(g('name', ''), '', 40), description: str(g('description', ''), '', 300), cpu: num(g('cpu', 1), 1), ramMb: Math.round(num(g('ramMb', 1024), 1024)), diskGb: Math.round(num(g('diskGb', 20), 20)),
    bandwidthGb: Math.max(0, Math.round(num(g('bandwidthGb', 0), 0))), price: Math.round(num(g('price', 5), 5) * 100) / 100, periodDays: Math.round(num(g('periodDays', 30), 30)),
    images: (Array.isArray(g('images', [])) ? (g('images', []) as unknown[]) : []).filter((x): x is string => typeof x === 'string').slice(0, 20),
    enabled: bool(g('enabled', true), true), isPopular: bool(g('isPopular', false), false), sort: Math.round(num(g('sort', 0), 0)), catalogPlanId: str(g('catalogPlanId', ''), '', 80) || undefined,
  };
  if (!p.name) bad('Give the plan a name.');
  if (!(p.cpu >= 0.25 && p.cpu <= 64)) bad('vCPU must be between 0.25 and 64.');
  if (!(p.ramMb >= 256)) bad('RAM must be at least 256 MB.');
  if (!(p.diskGb >= 1)) bad('Disk must be at least 1 GB.');
  if (!(p.price >= 0)) bad('Price cannot be negative.');
  if (!(p.periodDays >= 1 && p.periodDays <= 3650)) bad('Billing period must be 1-3650 days.');
  return p;
}
router.get('/plans', wrap(async (_req, res) => {
  const db = await getDb();
  ok(res, { plans: db.vpsPlans.slice().sort((a, b) => a.sort - b.sort).map(p => ({ ...p, inUse: db.vpsServers.filter(v => v.planId === p.id).length })),
    catalogPlans: db.plans.filter(p => db.products.find(x => x.id === p.productId)?.category === 'vps').map(p => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly })), images: db.vpsImages });
}));
router.post('/plans', wrap(async (req, res) => {
  const db = await getDb(); const now = new Date().toISOString(); const clean = sanitizePlan(req.body);
  if (clean.catalogPlanId && db.vpsPlans.some(p => p.catalogPlanId === clean.catalogPlanId)) bad('Another VPS plan is already linked to that website plan.');
  const p: VpsPlan = { id: newId('vplan'), ...clean, createdAt: now, updatedAt: now }; db.vpsPlans.push(p); saveDbSync(); await audit(req, 'VPS_PLAN_CREATED', p.id, p.name); ok(res, p);
}));
router.put('/plans/:id', wrap(async (req, res) => {
  const db = await getDb(); const p = db.vpsPlans.find(x => x.id === req.params.id); if (!p) throw new VpsError(404, 'Plan not found.');
  const clean = sanitizePlan(req.body, p); if (clean.catalogPlanId && db.vpsPlans.some(x => x.id !== p.id && x.catalogPlanId === clean.catalogPlanId)) bad('Another VPS plan is already linked to that website plan.');
  Object.assign(p, clean, { updatedAt: new Date().toISOString() }); saveDbSync(); await audit(req, 'VPS_PLAN_UPDATED', p.id, p.name); ok(res, p);
}));
router.delete('/plans/:id', wrap(async (req, res) => {
  const db = await getDb(); const p = db.vpsPlans.find(x => x.id === req.params.id); if (!p) throw new VpsError(404, 'Plan not found.');
  if (db.vpsServers.some(v => v.planId === p.id)) throw new VpsError(409, 'VPSes still use this plan (they need it for renewals). Hide it instead.', 'PLAN_IN_USE');
  db.vpsPlans = db.vpsPlans.filter(x => x.id !== p.id); saveDbSync(); await audit(req, 'VPS_PLAN_DELETED', p.id, p.name); ok(res);
}));

/* ============================================================== OS images */
function sanitizeImage(b: any, base?: VpsOsImage): VpsOsImage {
  const id = base ? base.id : str(b?.id).toLowerCase();
  const i = { id, label: str(b?.label ?? base?.label, '', 60), base: str(b?.base ?? base?.base, '', 120), enabled: bool(b?.enabled, base ? base.enabled : true), sort: Math.round(num(b?.sort ?? base?.sort, 99)) };
  if (!/^[a-z0-9][a-z0-9.-]{1,38}$/.test(i.id)) bad('The id may only contain a-z, 0-9, dot and dash (e.g. ubuntu-22.04).');
  if (!i.label) bad('Give the image a label.');
  if (!/^[a-z0-9][a-z0-9._\/-]{0,100}:[A-Za-z0-9._-]{1,60}$/.test(i.base)) bad('Base image must look like ubuntu:22.04 (Debian/Ubuntu family only).');
  return i;
}
router.get('/images', wrap(async (_req, res) => { const db = await getDb(); ok(res, db.vpsImages.slice().sort((a, b) => a.sort - b.sort).map(i => ({ ...i, inUse: db.vpsServers.filter(v => v.image === i.id).length }))); }));
router.post('/images', wrap(async (req, res) => {
  const db = await getDb(); const i = sanitizeImage(req.body); if (db.vpsImages.some(x => x.id === i.id)) bad('An image with this id already exists.');
  db.vpsImages.push(i); saveDbSync(); await audit(req, 'VPS_IMAGE_CREATED', i.id, i.base); ok(res, i);
}));
router.put('/images/:id', wrap(async (req, res) => {
  const db = await getDb(); const i = db.vpsImages.find(x => x.id === req.params.id); if (!i) throw new VpsError(404, 'Image not found.');
  Object.assign(i, sanitizeImage(req.body, i)); saveDbSync(); await audit(req, 'VPS_IMAGE_UPDATED', i.id, i.base); ok(res, i);
}));
router.delete('/images/:id', wrap(async (req, res) => {
  const db = await getDb(); const i = db.vpsImages.find(x => x.id === req.params.id); if (!i) throw new VpsError(404, 'Image not found.');
  if (db.vpsServers.some(v => v.image === i.id)) throw new VpsError(409, 'VPSes use this image. Disable it instead.', 'IMAGE_IN_USE');
  db.vpsImages = db.vpsImages.filter(x => x.id !== i.id); saveDbSync(); await audit(req, 'VPS_IMAGE_DELETED', i.id, i.label); ok(res);
}));

/* ============================================================== settings + activity */
router.get('/settings', wrap(async (_req, res) => { const db = await getDb(); ok(res, vpsSettings(db)); }));
router.put('/settings', wrap(async (req, res) => {
  const db = await getDb(); const cur = vpsSettings(db); const b = req.body || {}; const d = defaultVpsSettings();
  const next: VpsSettings = {
    enabled: bool(b.enabled, cur.enabled), paymentMode: b.paymentMode === 'manual' ? 'manual' : b.paymentMode === 'instant' ? 'instant' : cur.paymentMode, handleCheckoutOrders: bool(b.handleCheckoutOrders, cur.handleCheckoutOrders),
    defaultImage: imageById(db, str(b.defaultImage)) ? str(b.defaultImage) : cur.defaultImage || d.defaultImage, maxVpsPerUser: Math.max(0, Math.round(num(b.maxVpsPerUser, cur.maxVpsPerUser))),
    deleteAfterExpiryDays: Math.max(0, Math.round(num(b.deleteAfterExpiryDays, cur.deleteAfterExpiryDays))), reminderHours: Math.max(0, Math.round(num(b.reminderHours, cur.reminderHours))),
    allowRenewal: bool(b.allowRenewal, cur.allowRenewal), allowReinstall: bool(b.allowReinstall, cur.allowReinstall), allowTerminal: bool(b.allowTerminal, cur.allowTerminal), allowSshx: bool(b.allowSshx, cur.allowSshx), allowFileManager: bool(b.allowFileManager, cur.allowFileManager),
    announcement: str(b.announcement ?? cur.announcement, '', 300), newVpsNote: str(b.newVpsNote ?? cur.newVpsNote, '', 300),
  };
  db.vpsSettings = next; saveDbSync(); await audit(req, 'VPS_SETTINGS_UPDATED', 'vps', 'Updated VPS settings'); ok(res, next);
}));

router.get('/events', wrap(async (req, res) => {
  const db = await getDb(); const vpsId = str(req.query.vpsId); const q = str(req.query.search).toLowerCase(); const action = str(req.query.action); const limit = Math.min(500, Math.max(10, Math.round(num(req.query.limit, 200))));
  const names = new Map(db.vpsServers.map(v => [v.id, v.name] as const));
  ok(res, db.vpsEvents.filter(e => (!vpsId || e.vpsId === vpsId) && (!action || e.action === action) && (!q || `${e.actor} ${e.action} ${e.details}`.toLowerCase().includes(q))).slice(0, limit)
    .map(e => ({ ...e, vpsName: names.get(e.vpsId) || (e.vpsId === '-' ? '—' : '(deleted)'), ownerEmail: db.users.find(u => u.id === e.userId)?.email || '' })));
}));

export default router;
