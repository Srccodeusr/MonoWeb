import { Router, Response, NextFunction } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, createAuditLog, AuthenticatedRequest } from '../auth';
import { HostServer, HostBackup } from '../../src/hostingTypes';
import { daemon, daemonFetch, DaemonError } from '../hosting/daemonClient';
import { newId } from '../hosting/crypto';
import { allow } from '../hosting/ratelimit';
import {
  HostingError, createServer, destroyServer, dropStateCache, liveLimits, liveState, nodeFor, nodeUsage,
  pushSpec, selectableNodes, userCaps, userServers, specFor, renewServer,
} from '../hosting/serverService';

const router = Router();
router.use(authMiddleware);

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });

function handle(fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try { await fn(req, res); }
    catch (e: any) {
      if (res.headersSent) return;
      if (e instanceof HostingError) return err(res, e.status, e.code, e.message);
      if (e instanceof DaemonError) return err(res, e.status === 404 ? 404 : 502, 'NODE_ERROR', e.message);
      console.error('[Hosting] route error:', e?.message || e);
      err(res, 500, 'INTERNAL', 'Something went wrong. Please try again.');
    }
  };
}

async function owned(req: AuthenticatedRequest): Promise<{ db: Awaited<ReturnType<typeof getDb>>; server: HostServer }> {
  const db = await getDb();
  const server = db.servers.find(s => s.id === req.params.id && s.ownerId === req.user!.id);
  // 404 (not 403) so server ids cannot be probed for existence.
  if (!server) throw new HostingError(404, 'NOT_FOUND', 'Server not found.');
  return { db, server };
}

function publicServer(db: Awaited<ReturnType<typeof getDb>>, s: HostServer, live?: Awaited<ReturnType<typeof liveState>>) {
  const node = db.nodes.find(n => n.id === s.nodeId);
  const image = db.images.find(i => i.id === s.imageId);
  return {
    id: s.id, name: s.name, description: s.description, status: live?.status || s.status, startedAt: live?.startedAt, installLog: live?.installLog,
    image: image ? { id: image.id, name: image.name, software: image.software, category: image.category, iconUrl: image.iconUrl } : null,
    location: node?.locationName || 'Unknown', address: node ? `${node.fqdn}` : '', ports: s.ports.map(p => ({ host: p.host, container: p.container, label: p.label })),
    limits: liveLimits(s), baseLimits: s.limits, upgrades: s.upgrades, createdAt: s.createdAt, expiresAt: s.expiresAt, expiredAt: s.expiredAt, renewCount: s.renewCount,
    variables: (image?.variables || []).filter(v => v.userEditable).map(v => ({ name: v.name, env: v.env, description: v.description, value: s.variables[v.env] ?? v.default })),
    planId: s.planId,
  };
}

// ------------------------------------------------------------------------------------------ overview
router.get('/overview', handle(async (req, res) => {
  const db = await getDb();
  const hs = db.settings.hosting!;
  const caps = userCaps(db, req.user!);
  const mine = userServers(db, req.user!.id);
  const lives = await Promise.all(mine.map(s => liveState(db, s)));
  const sym = db.settings.currencySymbol || '$';
  res.json({
    success: true,
    data: {
      user: { username: req.user!.username, displayName: req.user!.displayName, coins: req.user!.coins || 0, credits: req.user!.credits },
      platform: { servers: db.servers.length, users: db.users.length },
      topBar: hs.topBar.enabled ? hs.topBar : null,
      promos: hs.promos,
      plan: { id: caps.plan.id, name: caps.plan.name, isFree: caps.plan.isFree, noAds: caps.noAds && hs.ads.hideForPremium, expiresAt: req.user!.planExpiresAt, tempUntil: req.user!.tempPlan?.until, serverLimit: caps.serverLimit, used: caps.used, perServer: caps.perServer, renewMethods: caps.plan.renewal.methods },
      economy: { enabled: hs.economy.enabled, coinName: hs.economy.coinName },
      renew: { ads: hs.renew.ads.enabled, blog: hs.renew.blog.enabled, coins: hs.renew.coins.enabled, coinPrice: hs.renew.coins.priceCoins, coinDays: hs.renew.coins.extendDays },
      currencySymbol: sym,
      servers: mine.map((s, i) => publicServer(db, s, lives[i])),
    },
  });
}));

// ------------------------------------------------------------------------------------------ wizard catalog
router.get('/catalog', handle(async (req, res) => {
  const db = await getDb();
  const caps = userCaps(db, req.user!);
  const images = db.images.filter(i => i.isActive);
  const nodes = db.nodes.filter(n => n.isPublic && !n.isMaintenance && n.status?.online && (!n.premiumOnly || !caps.plan.isFree));
  const locations = [...new Map(nodes.map(n => [n.locationName, { name: n.locationName, flag: n.locationFlag || '', nodes: nodes.filter(x => x.locationName === n.locationName).length }])).values()];
  res.json({
    success: true,
    data: {
      plan: { name: caps.plan.name, isFree: caps.plan.isFree, serverLimit: caps.serverLimit, used: caps.used, perServer: caps.perServer, chooseNode: caps.plan.features.chooseNode },
      locations,
      nodes: caps.plan.features.chooseNode ? nodes.map(n => ({ id: n.id, name: n.name, location: n.locationName, runtime: n.status.runtime })) : [],
      images: images.map(i => ({
        id: i.id, name: i.name, software: i.software, category: i.category, description: i.description, iconUrl: i.iconUrl, minRamMB: i.minRamMB, runtime: i.runtime,
        versions: Object.keys(i.dockerImages), defaultVersion: i.defaultImage, variables: i.variables.filter(v => v.userEditable).map(v => ({ name: v.name, env: v.env, default: v.default, description: v.description })),
      })),
      packs: db.entitlements.filter(e => e.userId === req.user!.id && !e.serverId).map(e => ({ id: e.id, name: e.name, pack: e.pack })),
      maxNameLength: db.settings.hosting!.wizard.maxNameLength,
    },
  });
}));

// ------------------------------------------------------------------------------------------ servers CRUD
router.get('/servers', handle(async (req, res) => {
  const db = await getDb();
  const mine = userServers(db, req.user!.id);
  const lives = await Promise.all(mine.map(s => liveState(db, s)));
  res.json({ success: true, data: mine.map((s, i) => publicServer(db, s, lives[i])) });
}));

router.post('/servers', handle(async (req, res) => {
  if (!allow(`create:${req.user!.id}`, 5, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'You are creating servers too quickly. Wait a few minutes.');
  const db = await getDb();
  if (!db.settings.hosting!.enabled) return err(res, 503, 'DISABLED', 'Server creation is currently disabled.');
  const user = db.users.find(u => u.id === req.user!.id)!;
  const b = req.body || {};
  const server = await createServer(user, {
    name: b.name, description: b.description, imageId: b.imageId, location: b.location, nodeId: b.nodeId,
    dockerImageLabel: b.version, variables: b.variables && typeof b.variables === 'object' ? b.variables : undefined, entitlementId: b.entitlementId,
  });
  await createAuditLog(user.id, user.email, user.role, 'SERVER_CREATED', server.id, `Created server "${server.name}"`);
  res.status(201).json({ success: true, data: publicServer(db, server, { status: 'installing' }) });
}));

router.get('/servers/:id', handle(async (req, res) => {
  const { db, server } = await owned(req);
  res.json({ success: true, data: publicServer(db, server, await liveState(db, server)) });
}));

router.patch('/servers/:id', handle(async (req, res) => {
  const { db, server } = await owned(req);
  const b = req.body || {};
  if (typeof b.name === 'string') {
    const n = b.name.trim();
    if (!n || n.length > db.settings.hosting!.wizard.maxNameLength || /[\u0000-\u001f<>]/.test(n)) return err(res, 400, 'INVALID_NAME', 'Invalid server name.');
    server.name = n;
  }
  if (typeof b.description === 'string') {
    if (/[\u0000-\u001f<>]/.test(b.description)) return err(res, 400, 'INVALID_DESCRIPTION', 'Invalid description.');
    server.description = b.description.trim().slice(0, 191);
  }
  if (b.variables && typeof b.variables === 'object') {
    const image = db.images.find(i => i.id === server.imageId);
    for (const v of image?.variables || []) {
      if (!v.userEditable || b.variables[v.env] === undefined) continue;
      const val = String(b.variables[v.env]);
      if (val.length > 500 || /[\0\r\n]/.test(val)) return err(res, 400, 'INVALID_VARIABLE', `${v.name}: invalid value.`);
      if (v.rules.startsWith('/') && v.rules.lastIndexOf('/') > 0) {
        const last = v.rules.lastIndexOf('/');
        try { if (!new RegExp(v.rules.slice(1, last), v.rules.slice(last + 1)).test(val)) return err(res, 400, 'INVALID_VARIABLE', `${v.name} has an invalid format.`); } catch { /* ignore */ }
      }
      server.variables[v.env] = val;
    }
    await pushSpec(db, server);
  }
  saveDbSync();
  res.json({ success: true, data: publicServer(db, server, await liveState(db, server)) });
}));

router.delete('/servers/:id', handle(async (req, res) => {
  const { db, server } = await owned(req);
  await destroyServer(db, server);
  await createAuditLog(req.user!.id, req.user!.email, req.user!.role, 'SERVER_DELETED', server.id, `Deleted server "${server.name}"`);
  res.json({ success: true, message: 'Server deleted.' });
}));

// ------------------------------------------------------------------------------------------ power / console
function assertUsable(s: HostServer) {
  if (s.status === 'suspended') throw new HostingError(403, 'SUSPENDED', `This server is suspended${s.suspendedReason ? `: ${s.suspendedReason}` : ''}. Contact support.`);
  if (s.status === 'expired') throw new HostingError(403, 'EXPIRED', 'This server has expired. Renew it to bring it back online.');
}

router.post('/servers/:id/power', handle(async (req, res) => {
  const { db, server } = await owned(req);
  const action = String(req.body?.action);
  if (!['start', 'stop', 'restart', 'kill'].includes(action)) return err(res, 400, 'INVALID_ACTION', 'Invalid power action.');
  if (action !== 'kill' && action !== 'stop') assertUsable(server);
  if (!allow(`power:${server.id}`, 10, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Slow down: too many power actions.');
  await pushSpec(db, server); // make sure the daemon runs with the latest limits/upgrades
  await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/power`, { action }, { timeoutMs: 60_000 });
  dropStateCache(server.id);
  res.json({ success: true });
}));

router.post('/servers/:id/command', handle(async (req, res) => {
  const { db, server } = await owned(req);
  assertUsable(server);
  const command = String(req.body?.command ?? '');
  if (!command.trim() || command.length > 2048) return err(res, 400, 'INVALID_COMMAND', 'Invalid command.');
  if (!allow(`cmd:${req.user!.id}`, 60, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many commands.');
  await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/command`, { command });
  res.json({ success: true });
}));

router.get('/servers/:id/stats', handle(async (req, res) => {
  const { db, server } = await owned(req);
  const s = await daemon(nodeFor(db, server), 'GET', `/v1/servers/${server.id}/stats`, undefined, { timeoutMs: 8000 }).catch(() => null);
  res.json({ success: true, data: s });
}));

// Live console: the browser never talks to the node directly, so node addresses/secrets stay private.
router.get('/servers/:id/console', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { db, server } = await owned(req);
    if (!allow(`console:${req.user!.id}`, 20, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many console connections.');
    const upstream = await daemonFetch(nodeFor(db, server), 'GET', `/v1/servers/${server.id}/logs?tail=200`, undefined, { timeoutMs: 0 });
    if (!upstream.ok || !upstream.body) return err(res, 502, 'NODE_ERROR', 'Could not open the console.');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const reader = upstream.body.getReader();
    req.on('close', () => { reader.cancel().catch(() => undefined); });
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e: any) {
    if (res.headersSent) return res.end();
    if (e instanceof HostingError) return err(res, e.status, e.code, e.message);
    err(res, 502, 'NODE_ERROR', e?.message || 'Console unavailable.');
  }
});

// ------------------------------------------------------------------------------------------ files
const q = (v: unknown) => encodeURIComponent(String(v ?? '/'));

router.get('/servers/:id/files', handle(async (req, res) => {
  const { db, server } = await owned(req);
  res.json({ success: true, data: await daemon(nodeFor(db, server), 'GET', `/v1/servers/${server.id}/files?path=${q(req.query.path)}`) });
}));
router.get('/servers/:id/files/content', handle(async (req, res) => {
  const { db, server } = await owned(req);
  res.json({ success: true, data: await daemon(nodeFor(db, server), 'GET', `/v1/servers/${server.id}/files/content?path=${q(req.query.path)}`) });
}));
router.put('/servers/:id/files/content', handle(async (req, res) => {
  const { db, server } = await owned(req); assertUsable(server);
  res.json({ success: true, data: await daemon(nodeFor(db, server), 'PUT', `/v1/servers/${server.id}/files/content`, { path: req.body?.path, content: req.body?.content }) });
}));
for (const op of ['mkdir', 'rename', 'delete', 'extract'] as const) {
  router.post(`/servers/:id/files/${op}`, handle(async (req, res) => {
    const { db, server } = await owned(req); assertUsable(server);
    res.json({ success: true, data: await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/files/${op}`, req.body || {}) });
  }));
}
router.post('/servers/:id/files/upload', handle(async (req, res) => {
  const { db, server } = await owned(req); assertUsable(server);
  const b = req.body || {};
  if (typeof b.data !== 'string' || b.data.length > 9_000_000) return err(res, 413, 'TOO_LARGE', 'Files over ~6 MB must be uploaded with SFTP/git or the console.');
  res.json({ success: true, data: await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/files/upload`, { path: b.path, name: b.name, data: b.data }, { timeoutMs: 60_000 }) });
}));
router.get('/servers/:id/files/download', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { db, server } = await owned(req);
    const up = await daemonFetch(nodeFor(db, server), 'GET', `/v1/servers/${server.id}/files/download?path=${q(req.query.path)}`, undefined, { timeoutMs: 120_000 });
    if (!up.ok || !up.body) return err(res, up.status === 404 ? 404 : 502, 'NODE_ERROR', 'Download failed.');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': up.headers.get('content-disposition') || 'attachment', 'X-Content-Type-Options': 'nosniff' });
    const r = up.body.getReader();
    req.on('close', () => r.cancel().catch(() => undefined));
    for (;;) { const { value, done } = await r.read(); if (done) break; res.write(Buffer.from(value)); }
    res.end();
  } catch (e: any) { if (!res.headersSent) err(res, e instanceof HostingError ? e.status : 502, 'NODE_ERROR', e?.message || 'Download failed.'); else res.end(); }
});

// ------------------------------------------------------------------------------------------ backups
router.get('/servers/:id/backups', handle(async (req, res) => {
  const { db, server } = await owned(req);
  res.json({ success: true, data: { limit: server.limits.backups, items: db.backups.filter(b => b.serverId === server.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) } });
}));
router.post('/servers/:id/backups', handle(async (req, res) => {
  const { db, server } = await owned(req); assertUsable(server);
  const existing = db.backups.filter(b => b.serverId === server.id).length;
  if (server.limits.backups <= 0) return err(res, 403, 'NO_BACKUPS', 'Backups are not included in your plan.');
  if (existing >= server.limits.backups) return err(res, 403, 'BACKUP_LIMIT', `Backup limit reached (${server.limits.backups}). Delete one first.`);
  if (!allow(`backup:${server.id}`, 3, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Please wait before creating another backup.');
  const r = await daemon<{ id: string; size: number; checksum: string }>(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/backups`, {}, { timeoutMs: 10 * 60_000 });
  const rec: HostBackup = { id: r.id, serverId: server.id, name: String(req.body?.name || `Backup ${existing + 1}`).slice(0, 60), size: r.size, checksum: r.checksum, createdAt: new Date().toISOString() };
  db.backups.push(rec); saveDbSync();
  res.status(201).json({ success: true, data: rec });
}));
router.post('/servers/:id/backups/:backupId/restore', handle(async (req, res) => {
  const { db, server } = await owned(req); assertUsable(server);
  if (!db.backups.some(b => b.id === req.params.backupId && b.serverId === server.id)) return err(res, 404, 'NOT_FOUND', 'Backup not found.');
  await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/backups/${req.params.backupId}/restore`, {}, { timeoutMs: 10 * 60_000 });
  dropStateCache(server.id);
  res.json({ success: true });
}));
router.delete('/servers/:id/backups/:backupId', handle(async (req, res) => {
  const { db, server } = await owned(req);
  const b = db.backups.find(x => x.id === req.params.backupId && x.serverId === server.id);
  if (!b) return err(res, 404, 'NOT_FOUND', 'Backup not found.');
  await daemon(nodeFor(db, server), 'DELETE', `/v1/servers/${server.id}/backups/${b.id}`).catch(() => undefined);
  db.backups = db.backups.filter(x => x.id !== b.id); saveDbSync();
  res.json({ success: true });
}));

// ------------------------------------------------------------------------------------------ renew with coins
router.post('/servers/:id/renew', handle(async (req, res) => {
  const { db, server } = await owned(req);
  const hs = db.settings.hosting!;
  const method = String(req.body?.method);
  const user = db.users.find(u => u.id === req.user!.id)!;
  const caps = userCaps(db, user);
  if (method !== 'coins') return err(res, 400, 'USE_EARN', 'Renew with ads/blogs through the Earn flow, or upgrade your plan.');
  if (!hs.renew.coins.enabled || !caps.plan.renewal.methods.includes('coins')) return err(res, 403, 'DISABLED', 'Renewing with coins is not enabled.');
  const price = hs.renew.coins.priceCoins;
  if ((user.coins || 0) < price) return err(res, 402, 'INSUFFICIENT_COINS', `You need ${price} ${hs.economy.coinName} (you have ${user.coins || 0}).`);
  user.coins = (user.coins || 0) - price;
  db.coinTx.unshift({ id: newId('ctx'), userId: user.id, amount: -price, balanceAfter: user.coins, reason: `Renewed server "${server.name}"`, ref: server.id, createdAt: new Date().toISOString() });
  renewServer(db, server, hs.renew.coins.extendDays * 86400_000);
  await pushSpec(db, server).catch(() => undefined);
  res.json({ success: true, data: { expiresAt: server.expiresAt, coins: user.coins } });
}));

void nodeUsage; void selectableNodes; void specFor;
export default router;
