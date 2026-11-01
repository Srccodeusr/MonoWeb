import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, requireRole, createAuditLog, AuthenticatedRequest } from '../auth';
import { HostNode } from '../../src/hostingTypes';
import { encryptSecret, maskSecret, decryptSecret, newId, randomToken } from '../hosting/crypto';
import { configureCommand, daemon, pingNode } from '../hosting/daemonClient';
import { defaultHostingSettings, sanitizeHostingSettings, sanitizePlan } from '../hosting/plans';
import { sanitizeAddon, sanitizeImage, sanitizeNode, sanitizeStoreItem } from '../hosting/sanitize';
import { backupDbNow, dbInfo } from '../db';
import { destroyServer, liveLimits, liveState, nodeUsage, pushSpec, refreshNodeStatuses, renewServer, stopQuietly } from '../hosting/serverService';
import { publicBaseUrl } from '../hosting/billing';
import { testStripe } from '../hosting/stripe';
import { addCoins } from './economy';

const router = Router();
router.use(authMiddleware, requireRole(['admin', 'super_admin']));

const err = (res: Response, status: number, message: string, code = 'ERROR') => res.status(status).json({ success: false, error: { code, message } });
type H = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: H) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (e: any) { if (!res.headersSent) { console.error('[HostingAdmin]', e?.message || e); err(res, e?.status || 400, e?.message || 'Request failed.'); } }
};
const audit = (req: AuthenticatedRequest, action: string, target: string, details: string) => createAuditLog(req.user!.id, req.user!.email, req.user!.role, action, target, details);

// ============================================================================ overview stats
router.get('/stats', wrap(async (_req, res) => {
  const db = await getDb();
  const by = (k: string) => db.servers.reduce((a: any, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
  const paid = db.orders.filter(o => o.kind === 'hosting_plan' && o.status === 'paid');
  const since = Date.now() - 30 * 86400_000;
  res.json({
    success: true,
    data: {
      nodes: { total: db.nodes.length, online: db.nodes.filter(n => n.status?.online).length },
      servers: { total: db.servers.length, byStatus: by('status'), expiringSoon: db.servers.filter(s => s.expiresAt && new Date(s.expiresAt).getTime() - Date.now() < 86400_000 && s.status !== 'expired').length },
      users: { total: db.users.length, premium: db.users.filter(u => u.hostingPlanId && u.planExpiresAt && new Date(u.planExpiresAt) > new Date()).length },
      revenue: { total: paid.reduce((a, o) => a + o.amount, 0), last30: paid.filter(o => new Date(o.createdAt).getTime() > since).reduce((a, o) => a + o.amount, 0), pending: db.orders.filter(o => o.kind === 'hosting_plan' && o.status === 'pending').length },
      economy: { coinsInCirculation: db.users.reduce((a, u) => a + (u.coins || 0), 0), purchases30: db.coinTx.filter(t => t.amount < 0 && new Date(t.createdAt).getTime() > since).length },
      ads: { active: db.ads.filter(a => a.isActive).length, impressions: db.ads.reduce((a, x) => a + (x.impressions || 0), 0), clicks: db.ads.reduce((a, x) => a + (x.clicks || 0), 0) },
    },
  });
}));

// ============================================================================ nodes
const publicNode = (db: Awaited<ReturnType<typeof getDb>>, n: HostNode) => {
  const { secretEnc, ...rest } = n;
  return { ...rest, usage: nodeUsage(db, n.id) };
};

router.get('/nodes', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: db.nodes.map(n => publicNode(db, n)) }); }));

router.post('/nodes', wrap(async (req, res) => {
  const db = await getDb();
  const clean = sanitizeNode(req.body);
  const secret = randomToken(36); // CSPRNG, 48 chars (AirLink used Math.random)
  const node: HostNode = { id: newId('node'), ...clean, secretEnc: encryptSecret(secret), status: { online: false }, createdAt: new Date().toISOString() };
  db.nodes.push(node); saveDbSync();
  await audit(req, 'NODE_CREATED', node.id, `Added node ${node.name}`);
  const panelUrl = publicBaseUrl(req as any);
  // The secret is shown exactly once, together with the command to run on the node.
  res.status(201).json({ success: true, data: { node: publicNode(db, node), secret, command: configureCommand(panelUrl, secret, node.daemonPort, undefined, node.sftpPort), panelUrl } });
}));

router.put('/nodes/:id', wrap(async (req, res) => {
  const db = await getDb(); const n = db.nodes.find(x => x.id === req.params.id); if (!n) return err(res, 404, 'Node not found.');
  Object.assign(n, sanitizeNode(req.body, n)); saveDbSync(); await audit(req, 'NODE_UPDATED', n.id, `Updated node ${n.name}`);
  res.json({ success: true, data: publicNode(db, n) });
}));

router.post('/nodes/:id/rotate-secret', wrap(async (req, res) => {
  const db = await getDb(); const n = db.nodes.find(x => x.id === req.params.id); if (!n) return err(res, 404, 'Node not found.');
  const secret = randomToken(36); n.secretEnc = encryptSecret(secret); n.status = { ...n.status, online: false }; saveDbSync();
  await audit(req, 'NODE_SECRET_ROTATED', n.id, `Rotated secret for ${n.name}`);
  res.json({ success: true, data: { secret, command: configureCommand(publicBaseUrl(req as any), secret, n.daemonPort, undefined, n.sftpPort) } });
}));

router.post('/nodes/:id/test', wrap(async (req, res) => {
  const db = await getDb(); const n = db.nodes.find(x => x.id === req.params.id); if (!n) return err(res, 404, 'Node not found.');
  try {
    const { ping, system } = await pingNode(n);
    n.status = { online: true, checkedAt: new Date().toISOString(), version: ping.version, runtime: ping.runtime, runtimeInfo: ping.runtimeInfo, platform: ping.platform, hostname: ping.hostname, system };
    saveDbSync(); res.json({ success: true, data: publicNode(db, n) });
  } catch (e: any) {
    n.status = { ...n.status, online: false, checkedAt: new Date().toISOString(), error: e.message }; saveDbSync();
    res.json({ success: false, error: { code: 'UNREACHABLE', message: e.message }, data: publicNode(db, n) });
  }
}));

router.delete('/nodes/:id', wrap(async (req, res) => {
  const db = await getDb(); const n = db.nodes.find(x => x.id === req.params.id); if (!n) return err(res, 404, 'Node not found.');
  if (db.servers.some(s => s.nodeId === n.id)) return err(res, 409, 'This node still hosts servers. Delete or move them first.');
  db.nodes = db.nodes.filter(x => x.id !== n.id); saveDbSync(); await audit(req, 'NODE_DELETED', n.id, `Deleted node ${n.name}`);
  res.json({ success: true });
}));

// ============================================================================ servers
router.get('/servers', wrap(async (req, res) => {
  const db = await getDb();
  const q = String(req.query.search || '').toLowerCase(); const status = String(req.query.status || ''); const nodeId = String(req.query.nodeId || '');
  const rows = db.servers.filter(s => (!status || s.status === status) && (!nodeId || s.nodeId === nodeId)).map(s => {
    const owner = db.users.find(u => u.id === s.ownerId); const node = db.nodes.find(n => n.id === s.nodeId); const image = db.images.find(i => i.id === s.imageId);
    return { id: s.id, name: s.name, status: s.status, suspendedReason: s.suspendedReason, owner: owner ? { id: owner.id, username: owner.username, email: owner.email } : null, node: node ? { id: node.id, name: node.name, location: node.locationName } : null, image: image?.name || '?', limits: liveLimits(s), ports: s.ports.map(p => p.host), createdAt: s.createdAt, expiresAt: s.expiresAt, expiredAt: s.expiredAt, renewCount: s.renewCount };
  }).filter(r => !q || r.name.toLowerCase().includes(q) || r.id.includes(q) || r.owner?.username.toLowerCase().includes(q) || r.owner?.email.toLowerCase().includes(q));
  res.json({ success: true, data: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500) });
}));

const findServer = async (req: AuthenticatedRequest) => { const db = await getDb(); const s = db.servers.find(x => x.id === req.params.id); return { db, s }; };

router.post('/servers/:id/suspend', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  s.status = 'suspended'; s.suspendedReason = String(req.body?.reason || 'Suspended by an administrator').slice(0, 200); saveDbSync(); await stopQuietly(db, s);
  await audit(req, 'SERVER_SUSPENDED', s.id, s.suspendedReason); res.json({ success: true });
}));
router.post('/servers/:id/unsuspend', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  s.status = 'offline'; s.suspendedReason = undefined; saveDbSync(); await audit(req, 'SERVER_UNSUSPENDED', s.id, 'Unsuspended'); res.json({ success: true });
}));
router.post('/servers/:id/power', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  const action = String(req.body?.action); if (!['start', 'stop', 'restart', 'kill'].includes(action)) return err(res, 400, 'Invalid action.');
  const node = db.nodes.find(n => n.id === s.nodeId)!; await pushSpec(db, s); await daemon(node, 'POST', `/v1/servers/${s.id}/power`, { action }, { timeoutMs: 60000 }); res.json({ success: true });
}));
router.post('/servers/:id/extend', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  const days = Number(req.body?.days); if (!Number.isFinite(days) || days < 1 || days > 3650) return err(res, 400, 'Days must be 1-3650.');
  renewServer(db, s, days * 86400_000); await audit(req, 'SERVER_EXTENDED', s.id, `+${days} days`); res.json({ success: true, data: { expiresAt: s.expiresAt } });
}));
router.patch('/servers/:id', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  const b = req.body || {}; const num = (v: any, min: number, max: number) => Math.round(Math.min(max, Math.max(min, Number(v))));
  if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim().slice(0, 60);
  for (const [k, min, max] of [['ramMB', 64, 1e7], ['cpuPercent', 5, 6400], ['diskMB', 64, 1e8], ['swapMB', 0, 1e7], ['backups', 0, 1000], ['databases', 0, 100]] as const)
    if (b[k] !== undefined && Number.isFinite(Number(b[k]))) (s.limits as any)[k] = num(b[k], min, max);
  if (b.ownerId && db.users.some(u => u.id === b.ownerId)) s.ownerId = b.ownerId;
  if (b.expiresAt === null) s.expiresAt = undefined; else if (typeof b.expiresAt === 'string' && !Number.isNaN(Date.parse(b.expiresAt))) s.expiresAt = new Date(b.expiresAt).toISOString();
  saveDbSync(); await pushSpec(db, s).catch(() => undefined); await audit(req, 'SERVER_EDITED', s.id, 'Admin edited server'); res.json({ success: true });
}));
router.post('/servers/:id/reinstall', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  const img = db.images.find(i => i.id === s.imageId); if (!img) return err(res, 400, 'Image no longer exists.');
  await stopQuietly(db, s); await pushSpec(db, s);
  await daemon(db.nodes.find(n => n.id === s.nodeId)!, 'POST', `/v1/servers/${s.id}/install`, { image: img.install.image, script: img.install.script, entrypoint: img.install.entrypoint, env: s.variables, files: img.install.files });
  s.status = 'installing'; saveDbSync(); res.json({ success: true });
}));
router.delete('/servers/:id', wrap(async (req, res) => {
  const { db, s } = await findServer(req); if (!s) return err(res, 404, 'Server not found.');
  try { await destroyServer(db, s); }
  catch (e: any) {
    if (req.query.force !== '1') return err(res, 502, `${e.message} Retry with force to remove the record anyway (files may remain on the node).`);
    db.servers = db.servers.filter(x => x.id !== s.id); saveDbSync();
  }
  await audit(req, 'SERVER_DELETED_ADMIN', s.id, `Deleted ${s.name}`); res.json({ success: true });
}));

// ============================================================================ accounts
const accountRow = (db: Awaited<ReturnType<typeof getDb>>, u: any) => {
  const plan = db.hostingPlans.find(p => p.id === u.hostingPlanId);
  const servers = db.servers.filter(s => s.ownerId === u.id);
  return { id: u.id, username: u.username, displayName: u.displayName, email: u.email, role: u.role, isSuspended: u.isSuspended, credits: u.credits, coins: u.coins || 0, planId: u.hostingPlanId || null, planName: plan?.name || 'Free', planExpiresAt: u.planExpiresAt || null, tempPlan: u.tempPlan || null, extraSlots: u.extraSlots || 0, overrides: u.hostingOverrides || {}, servers: servers.length, createdAt: u.createdAt, lastLoginIp: u.lastLoginIp };
};

router.get('/accounts', wrap(async (req, res) => {
  const db = await getDb(); const q = String(req.query.search || '').toLowerCase();
  res.json({ success: true, data: db.users.filter(u => !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id === q).slice(0, 500).map(u => accountRow(db, u)) });
}));

router.get('/accounts/:id', wrap(async (req, res) => {
  const db = await getDb(); const u = db.users.find(x => x.id === req.params.id); if (!u) return err(res, 404, 'Account not found.');
  res.json({ success: true, data: { ...accountRow(db, u), servers: db.servers.filter(s => s.ownerId === u.id).map(s => ({ id: s.id, name: s.name, status: s.status, expiresAt: s.expiresAt, limits: liveLimits(s) })), coinHistory: db.coinTx.filter(t => t.userId === u.id).slice(0, 30), orders: db.orders.filter(o => o.userId === u.id && o.kind === 'hosting_plan').slice(0, 20) } });
}));

router.patch('/accounts/:id/hosting', wrap(async (req, res) => {
  const db = await getDb(); const u = db.users.find(x => x.id === req.params.id); if (!u) return err(res, 404, 'Account not found.');
  const b = req.body || {};
  if (b.planId !== undefined) {
    if (b.planId === null || b.planId === '') { u.hostingPlanId = undefined; u.planExpiresAt = undefined; }
    else { if (!db.hostingPlans.some(p => p.id === b.planId)) return err(res, 400, 'Unknown plan.'); u.hostingPlanId = b.planId; }
  }
  if (b.planExpiresAt !== undefined) u.planExpiresAt = b.planExpiresAt ? new Date(b.planExpiresAt).toISOString() : undefined;
  if (b.addDays) { const base = u.planExpiresAt && new Date(u.planExpiresAt) > new Date() ? new Date(u.planExpiresAt) : new Date(); base.setDate(base.getDate() + Math.round(Number(b.addDays))); u.planExpiresAt = base.toISOString(); }
  if (b.extraSlots !== undefined) u.extraSlots = Math.max(0, Math.min(1000, Math.round(Number(b.extraSlots) || 0)));
  if (b.overrides && typeof b.overrides === 'object') {
    const o: any = {}; for (const k of ['serverLimit', 'ramMB', 'cpuPercent', 'diskMB']) { const v = b.overrides[k]; if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) o[k] = Math.max(0, Math.round(Number(v))); }
    u.hostingOverrides = Object.keys(o).length ? o : undefined;
  }
  u.updatedAt = new Date().toISOString(); saveDbSync(); await audit(req, 'ACCOUNT_HOSTING_EDITED', u.id, JSON.stringify({ plan: b.planId, addDays: b.addDays }).slice(0, 300));
  res.json({ success: true, data: accountRow(db, u) });
}));

router.post('/accounts/:id/coins', wrap(async (req, res) => {
  const db = await getDb(); const u = db.users.find(x => x.id === req.params.id); if (!u) return err(res, 404, 'Account not found.');
  const amount = Math.round(Number(req.body?.amount)); if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1e7) return err(res, 400, 'Enter a non-zero amount (max 10,000,000).');
  addCoins(db, u, amount, String(req.body?.reason || 'Admin adjustment').slice(0, 120), `admin:${req.user!.id}`); saveDbSync();
  await audit(req, 'COINS_ADJUSTED', u.id, `${amount > 0 ? '+' : ''}${amount}`); res.json({ success: true, data: { coins: u.coins } });
}));

router.post('/accounts/:id/suspend-servers', wrap(async (req, res) => {
  const db = await getDb(); const list = db.servers.filter(s => s.ownerId === req.params.id); const on = req.body?.suspend !== false;
  for (const s of list) { if (on) { s.status = 'suspended'; s.suspendedReason = 'Account suspended'; await stopQuietly(db, s); } else if (s.status === 'suspended') { s.status = 'offline'; s.suspendedReason = undefined; } }
  saveDbSync(); res.json({ success: true, data: { affected: list.length } });
}));

// ============================================================================ plans
router.get('/plans', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: db.hostingPlans.sort((a, b) => a.sortOrder - b.sortOrder) }); }));
router.post('/plans', wrap(async (req, res) => {
  const db = await getDb(); const now = new Date().toISOString();
  const plan = { id: newId('plan'), ...sanitizePlan(req.body), createdAt: now, updatedAt: now };
  db.hostingPlans.push(plan); saveDbSync(); await audit(req, 'PLAN_CREATED', plan.id, plan.name); res.status(201).json({ success: true, data: plan });
}));
router.put('/plans/:id', wrap(async (req, res) => {
  const db = await getDb(); const p = db.hostingPlans.find(x => x.id === req.params.id); if (!p) return err(res, 404, 'Plan not found.');
  Object.assign(p, sanitizePlan(req.body, p), { updatedAt: new Date().toISOString() }); saveDbSync(); await audit(req, 'PLAN_UPDATED', p.id, p.name); res.json({ success: true, data: p });
}));
router.delete('/plans/:id', wrap(async (req, res) => {
  const db = await getDb(); const p = db.hostingPlans.find(x => x.id === req.params.id); if (!p) return err(res, 404, 'Plan not found.');
  if (db.settings.hosting!.freePlanId === p.id) return err(res, 409, 'This is the default free plan. Choose another default in Hosting Settings first.');
  db.users.forEach(u => { if (u.hostingPlanId === p.id) { u.hostingPlanId = undefined; u.planExpiresAt = undefined; } if (u.tempPlan?.planId === p.id) u.tempPlan = undefined; });
  db.hostingPlans = db.hostingPlans.filter(x => x.id !== p.id); saveDbSync(); await audit(req, 'PLAN_DELETED', p.id, p.name); res.json({ success: true });
}));

// ============================================================================ store
router.get('/store', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: db.storeItems.sort((a, b) => a.sortOrder - b.sortOrder) }); }));
router.post('/store', wrap(async (req, res) => {
  const db = await getDb(); const item = { id: newId('store'), ...sanitizeStoreItem(req.body), sold: 0, createdAt: new Date().toISOString() } as any;
  db.storeItems.push(item); saveDbSync(); await audit(req, 'STORE_ITEM_CREATED', item.id, item.name); res.status(201).json({ success: true, data: item });
}));
router.put('/store/:id', wrap(async (req, res) => {
  const db = await getDb(); const i = db.storeItems.find(x => x.id === req.params.id); if (!i) return err(res, 404, 'Item not found.');
  const clean: any = sanitizeStoreItem(req.body, i); for (const k of ['upgrade', 'renewDays', 'premiumPlanId', 'premiumDays', 'pack', 'slots']) delete (i as any)[k];
  Object.assign(i, clean); saveDbSync(); await audit(req, 'STORE_ITEM_UPDATED', i.id, i.name); res.json({ success: true, data: i });
}));
router.delete('/store/:id', wrap(async (req, res) => { const db = await getDb(); db.storeItems = db.storeItems.filter(x => x.id !== req.params.id); saveDbSync(); await audit(req, 'STORE_ITEM_DELETED', req.params.id, ''); res.json({ success: true }); }));
router.get('/economy/ledger', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: db.coinTx.slice(0, 200).map(t => ({ ...t, username: db.users.find(u => u.id === t.userId)?.username || t.userId })) }); }));

// ============================================================================ images
router.get('/images', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: db.images }); }));
router.post('/images', wrap(async (req, res) => {
  const db = await getDb(); const img = { id: newId('img'), ...sanitizeImage(req.body), createdAt: new Date().toISOString() };
  db.images.push(img); saveDbSync(); await audit(req, 'IMAGE_CREATED', img.id, img.name); res.status(201).json({ success: true, data: img });
}));
router.put('/images/:id', wrap(async (req, res) => {
  const db = await getDb(); const i = db.images.find(x => x.id === req.params.id); if (!i) return err(res, 404, 'Image not found.');
  Object.assign(i, sanitizeImage(req.body, i)); saveDbSync(); await audit(req, 'IMAGE_UPDATED', i.id, i.name); res.json({ success: true, data: i });
}));
router.delete('/images/:id', wrap(async (req, res) => {
  const db = await getDb(); if (db.servers.some(s => s.imageId === req.params.id)) return err(res, 409, 'Servers still use this image. Disable it instead.');
  db.images = db.images.filter(x => x.id !== req.params.id); saveDbSync(); await audit(req, 'IMAGE_DELETED', req.params.id, ''); res.json({ success: true });
}));

// ============================================================================ settings
router.get('/settings', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: { ...db.settings.hosting!, plans: db.hostingPlans.map(p => ({ id: p.id, name: p.name, isFree: p.isFree })) } }); }));
router.put('/settings', wrap(async (req, res) => {
  const db = await getDb(); db.settings.hosting = sanitizeHostingSettings(req.body, db.settings.hosting || defaultHostingSettings());
  saveDbSync(); await audit(req, 'HOSTING_SETTINGS_UPDATED', 'hosting', 'Updated hosting settings'); res.json({ success: true, data: db.settings.hosting });
}));

// ============================================================================ Stripe (admin-guided setup)
const stripeView = (db: Awaited<ReturnType<typeof getDb>>, req: AuthenticatedRequest) => {
  const g: any = db.settings.paymentGateways?.stripe || {};
  let base = ''; try { base = publicBaseUrl(req as any); } catch { base = '(set APP_URL)'; }
  return {
    enabled: !!g.enabled, publishableKey: g.publishableKey || '', secretKeyMasked: maskSecret(decryptSecret(g.secretKey || '')), hasSecretKey: !!g.secretKey,
    webhookSecretMasked: maskSecret(decryptSecret(g.webhookSecret || '')), hasWebhookSecret: !!g.webhookSecret, currency: (g.currency || db.settings.currencyCode || 'usd').toLowerCase(), mode: g.mode || 'test',
    instructions: g.instructions || '', lastTestedAt: g.lastTestedAt, lastTestOk: g.lastTestOk,
    webhookUrl: `${base}/api/v1/stripe/webhook`, events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'],
  };
};
router.get('/stripe', wrap(async (req, res) => { const db = await getDb(); res.json({ success: true, data: stripeView(db, req) }); }));
router.put('/stripe', wrap(async (req, res) => {
  const db = await getDb(); const b = req.body || {}; db.settings.paymentGateways = db.settings.paymentGateways || ({} as any);
  const g: any = (db.settings.paymentGateways as any).stripe ||= { enabled: false, instructions: '' };
  if (typeof b.secretKey === 'string' && b.secretKey.trim() && !b.secretKey.includes('•')) {
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(b.secretKey.trim())) return err(res, 400, 'Secret key must look like sk_test_… or sk_live_….');
    g.secretKey = encryptSecret(b.secretKey.trim()); g.mode = b.secretKey.includes('_live_') ? 'live' : 'test'; g.lastTestOk = undefined;
  }
  if (typeof b.webhookSecret === 'string' && b.webhookSecret.trim() && !b.webhookSecret.includes('•')) {
    if (!/^whsec_[A-Za-z0-9+/=_-]+$/.test(b.webhookSecret.trim())) return err(res, 400, 'Webhook signing secret must start with whsec_.');
    g.webhookSecret = encryptSecret(b.webhookSecret.trim());
  }
  if (typeof b.publishableKey === 'string') g.publishableKey = b.publishableKey.trim().slice(0, 200);
  if (typeof b.currency === 'string' && /^[a-zA-Z]{3}$/.test(b.currency)) g.currency = b.currency.toLowerCase();
  if (typeof b.instructions === 'string') g.instructions = b.instructions.slice(0, 1000);
  if (typeof b.enabled === 'boolean') {
    if (b.enabled && (!g.secretKey || !g.webhookSecret)) return err(res, 400, 'Add the secret key and the webhook signing secret before enabling Stripe.');
    g.enabled = b.enabled;
  }
  saveDbSync(); await audit(req, 'STRIPE_SETTINGS_UPDATED', 'stripe', `enabled=${g.enabled}`); res.json({ success: true, data: stripeView(db, req) });
}));
router.post('/stripe/test', wrap(async (req, res) => {
  const db = await getDb(); const g: any = db.settings.paymentGateways?.stripe;
  const key = typeof req.body?.secretKey === 'string' && req.body.secretKey && !req.body.secretKey.includes('•') ? req.body.secretKey.trim() : decryptSecret(g?.secretKey || '');
  if (!key) return err(res, 400, 'Enter your Stripe secret key first.');
  try { const r = await testStripe({ secretKey: key }); if (g) { g.lastTestedAt = new Date().toISOString(); g.lastTestOk = true; saveDbSync(); } res.json({ success: true, data: r }); }
  catch (e: any) { if (g) { g.lastTestedAt = new Date().toISOString(); g.lastTestOk = false; saveDbSync(); } err(res, 400, e.message, 'STRIPE_TEST_FAILED'); }
}));

// ============================================================================ addon store
router.get('/addons', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: { items: db.addons, images: db.images.map(i => ({ id: i.id, name: i.name })) } }); }));
router.post('/addons', wrap(async (req, res) => {
  const db = await getDb(); const now = new Date().toISOString();
  const a = { id: newId('addon'), ...sanitizeAddon(req.body, db.images.map(i => i.id)), installs: 0, createdAt: now, updatedAt: now };
  db.addons.push(a); saveDbSync(); await audit(req, 'ADDON_CREATED', a.id, a.name); res.status(201).json({ success: true, data: a });
}));
router.put('/addons/:id', wrap(async (req, res) => {
  const db = await getDb(); const a = db.addons.find(x => x.id === req.params.id); if (!a) return err(res, 404, 'Addon not found.');
  Object.assign(a, sanitizeAddon(req.body, db.images.map(i => i.id), a), { updatedAt: new Date().toISOString() }); saveDbSync(); await audit(req, 'ADDON_UPDATED', a.id, a.name); res.json({ success: true, data: a });
}));
router.delete('/addons/:id', wrap(async (req, res) => {
  const db = await getDb(); const a = db.addons.find(x => x.id === req.params.id); if (!a) return err(res, 404, 'Addon not found.');
  const used = db.addonInstalls.filter(i => i.addonId === a.id).length;
  if (used && req.query.force !== '1') return err(res, 409, `${used} server(s) have this addon installed. Disable it instead, or delete with force (their files stay).`);
  db.addons = db.addons.filter(x => x.id !== a.id); saveDbSync(); await audit(req, 'ADDON_DELETED', a.id, a.name); res.json({ success: true });
}));

// ============================================================================ database (SQLite)
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
router.get('/database', wrap(async (_req, res) => {
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => /^mono-[\w.-]+\.sqlite$/.test(f)).map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, createdAt: st.mtime.toISOString() }; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30) : [];
  res.json({ success: true, data: { ...dbInfo(), backups: files } });
}));
router.post('/database/backup', wrap(async (req, res) => {
  if (!allowBackup()) return err(res, 429, 'Please wait a minute between backups.');
  const dest = backupDbNow(); await audit(req, 'DATABASE_BACKUP', 'db', path.basename(dest));
  res.json({ success: true, data: { name: path.basename(dest), size: fs.statSync(dest).size } });
}));
router.get('/database/backups/:name', wrap(async (req, res) => {
  const name = String(req.params.name);
  if (!/^mono-[\w.-]+\.sqlite$/.test(name)) return err(res, 400, 'Invalid backup name.');
  const file = path.join(BACKUP_DIR, name); if (!fs.existsSync(file)) return err(res, 404, 'Backup not found.');
  await audit(req, 'DATABASE_BACKUP_DOWNLOAD', 'db', name);
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}));
let lastBackup = 0; const allowBackup = () => { if (Date.now() - lastBackup < 60_000) return false; lastBackup = Date.now(); return true; };

// ============================================================================ media library (ad banners / images)
const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
const SIGS: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: b => b.slice(0, 4).toString() === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
router.get('/media', wrap(async (_req, res) => { const db = await getDb(); res.json({ success: true, data: db.media.slice().reverse().map(m => ({ ...m, url: `/api/v1/media/${m.id}` })) }); }));
router.post('/media', wrap(async (req, res) => {
  const db = await getDb(); const data = String(req.body?.data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(data, 'base64'); if (!buf.length || buf.length > 3 * 1024 * 1024) return err(res, 413, 'Image must be between 1 byte and 3 MB.');
  const sig = SIGS.find(s => s.test(buf)); if (!sig) return err(res, 400, 'Only PNG, JPEG, GIF or WebP images are allowed (SVG is blocked on purpose).');
  const id = crypto.randomBytes(12).toString('hex'); fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${sig.ext}`), buf, { mode: 0o640 });
  const item = { id, filename: String(req.body?.filename || 'image').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'image', mime: sig.mime, size: buf.length, uploadedBy: req.user!.id, createdAt: new Date().toISOString() };
  db.media.push(item); saveDbSync(); res.status(201).json({ success: true, data: { ...item, url: `/api/v1/media/${id}` } });
}));
router.delete('/media/:id', wrap(async (req, res) => {
  const db = await getDb(); const m = db.media.find(x => x.id === req.params.id); if (!m) return err(res, 404, 'Not found.');
  const ext = SIGS.find(s => s.mime === m.mime)!.ext; fs.rmSync(path.join(UPLOAD_DIR, `${m.id}.${ext}`), { force: true });
  db.media = db.media.filter(x => x.id !== m.id); saveDbSync(); res.json({ success: true });
}));

void liveState; void refreshNodeStatuses;
export default router;

/** Public, cache-friendly image serving (no SVG, nosniff, id is a random 24-hex string so it cannot traverse). */
export async function serveMedia(req: any, res: any) {
  const db = await getDb(); const m = db.media.find(x => x.id === req.params.id);
  if (!m) return res.status(404).end();
  const ext = SIGS.find(s => s.mime === m.mime)!.ext; const file = path.join(UPLOAD_DIR, `${m.id}.${ext}`);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set({ 'Content-Type': m.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'" });
  fs.createReadStream(file).pipe(res);
}
