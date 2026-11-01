import { Router, Response, NextFunction } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, createAuditLog, AuthenticatedRequest } from '../auth';
import { SUBUSER_PERMISSIONS } from '../../src/hostingTypes';
import { allow } from '../hosting/ratelimit';
import { newId, hashSftpPassword, randomPassword } from '../hosting/crypto';
import { can, sanitizePermissions } from '../hosting/access';
import { HostingError, liveState, pushSpec, selectableNodes, userCaps } from '../hosting/serverService';
import { DaemonError } from '../hosting/daemonClient';
import { createSchedule, runScheduleNow, updateSchedule } from '../hosting/schedules';
import { describeCron } from '../hosting/cron';
import { beginTransfer, transferTargets } from '../hosting/transfer';
import { installAddon, publicAddon, uninstallAddon, isCompatible } from '../hosting/addons';
import { member } from './hosting';

/** Team members, scheduled tasks, node switching, SFTP and the addon store. Mounted next to routes/hosting.ts. */
const router = Router();
router.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => (req.user ? next() : authMiddleware(req, res, next)));

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });
function handle(fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) {
  return async (req: AuthenticatedRequest, res: Response) => {
    try { await fn(req, res); } catch (e: any) {
      if (res.headersSent) return;
      if (e instanceof HostingError) return err(res, e.status, e.code, e.message);
      if (e instanceof DaemonError) return err(res, e.status === 404 ? 404 : 502, 'NODE_ERROR', e.message);
      console.error('[HostingExtra]', e?.message || e); err(res, 500, 'INTERNAL', 'Something went wrong. Please try again.');
    }
  };
}
const ok = (res: Response, data?: unknown) => res.json({ success: true, data });

// =================================================================================== subusers (paid plans)
router.get('/servers/:id/subusers', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'owner');
  const caps = userCaps(db, acc.owner);
  ok(res, {
    allowed: caps.plan.features.subusers, limit: caps.perServer.subusers, permissions: SUBUSER_PERMISSIONS, planName: caps.plan.name,
    items: db.subusers.filter(x => x.serverId === server.id).map(x => { const u = db.users.find(y => y.id === x.userId); return { id: x.id, userId: x.userId, username: u?.username || 'deleted user', email: u?.email, permissions: x.permissions, createdAt: x.createdAt }; }),
  });
}));

router.post('/servers/:id/subusers', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'owner');
  const caps = userCaps(db, acc.owner);
  if (!caps.plan.features.subusers) return err(res, 403, 'NOT_IN_PLAN', 'Team members are available on paid plans.');
  const current = db.subusers.filter(x => x.serverId === server.id);
  if (current.length >= caps.perServer.subusers) return err(res, 403, 'SUBUSER_LIMIT', `Your plan allows ${caps.perServer.subusers} team member${caps.perServer.subusers === 1 ? '' : 's'} per server.`);
  if (!allow(`subadd:${req.user!.id}`, 15, 60 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many invitations. Try again later.');
  const q = String(req.body?.identifier || '').trim().toLowerCase();
  const target = q && db.users.find(u => u.username.toLowerCase() === q || u.email.toLowerCase() === q);
  if (!target || target.isSuspended) return err(res, 404, 'USER_NOT_FOUND', 'No active account matches that username or email.');
  if (target.id === server.ownerId) return err(res, 400, 'IS_OWNER', 'That is the server owner.');
  if (current.some(x => x.userId === target.id)) return err(res, 409, 'DUPLICATE', 'That user already has access.');
  const permissions = sanitizePermissions(req.body?.permissions);
  if (!permissions.length) return err(res, 400, 'NO_PERMISSIONS', 'Choose at least one permission.');
  const rec = { id: newId('sub'), serverId: server.id, userId: target.id, permissions, addedBy: req.user!.id, createdAt: new Date().toISOString() };
  db.subusers.push(rec); saveDbSync();
  await createAuditLog(req.user!.id, req.user!.email, req.user!.role, 'SUBUSER_ADDED', server.id, `Added ${target.username} to "${server.name}"`);
  ok(res, { id: rec.id });
}));

async function revokeSftpIfNeeded(db: Awaited<ReturnType<typeof getDb>>, serverId: string, userId: string, permissions: string[] | null) {
  if (permissions && permissions.includes('sftp')) return;
  const before = db.sftpCreds.length;
  db.sftpCreds = db.sftpCreds.filter(c => !(c.serverId === serverId && c.userId === userId));
  if (db.sftpCreds.length !== before) saveDbSync();
}

router.patch('/servers/:id/subusers/:subId', handle(async (req, res) => {
  const { db, server } = await member(req, 'owner');
  const sub = db.subusers.find(x => x.id === req.params.subId && x.serverId === server.id);
  if (!sub) return err(res, 404, 'NOT_FOUND', 'Team member not found.');
  const permissions = sanitizePermissions(req.body?.permissions);
  if (!permissions.length) return err(res, 400, 'NO_PERMISSIONS', 'Choose at least one permission.');
  sub.permissions = permissions; saveDbSync();
  await revokeSftpIfNeeded(db, server.id, sub.userId, permissions);
  await pushSpec(db, server).catch(() => undefined);
  ok(res);
}));

router.delete('/servers/:id/subusers/:subId', handle(async (req, res) => {
  const db = await getDb();
  const sub = db.subusers.find(x => x.id === req.params.subId && x.serverId === req.params.id);
  const server = db.servers.find(s => s.id === req.params.id);
  // the owner can remove anyone; a team member can remove themselves ("leave server")
  if (!sub || !server || (server.ownerId !== req.user!.id && sub.userId !== req.user!.id)) return err(res, 404, 'NOT_FOUND', 'Team member not found.');
  db.subusers = db.subusers.filter(x => x.id !== sub.id); saveDbSync();
  await revokeSftpIfNeeded(db, server.id, sub.userId, null);
  await pushSpec(db, server).catch(() => undefined);
  ok(res);
}));

// =================================================================================== scheduled tasks (paid plans)
const publicSchedule = (s: any) => ({ id: s.id, name: s.name, cron: s.cron, description: describeCron(s.cron), enabled: s.enabled, tasks: s.tasks, lastRunAt: s.lastRunAt, lastStatus: s.lastStatus, lastError: s.lastError, nextRunAt: s.nextRunAt });

router.get('/servers/:id/schedules', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'schedules');
  const caps = userCaps(db, acc.owner);
  ok(res, { allowed: caps.plan.features.scheduledTasks, limit: caps.perServer.schedules, backupsAvailable: server.limits.backups > 0, items: db.schedules.filter(s => s.serverId === server.id).map(publicSchedule) });
}));
router.post('/servers/:id/schedules', handle(async (req, res) => {
  const { db, server } = await member(req, 'schedules');
  ok(res, publicSchedule(createSchedule(db, server, req.user!.id, req.body)));
}));
router.put('/servers/:id/schedules/:schId', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'schedules');
  const sch = db.schedules.find(s => s.id === req.params.schId && s.serverId === server.id);
  if (!sch) return err(res, 404, 'NOT_FOUND', 'Schedule not found.');
  if (!userCaps(db, acc.owner).plan.features.scheduledTasks) return err(res, 403, 'NOT_IN_PLAN', 'Scheduled tasks are available on paid plans.');
  ok(res, publicSchedule(updateSchedule(db, sch, server, req.body)));
}));
router.delete('/servers/:id/schedules/:schId', handle(async (req, res) => {
  const { db, server } = await member(req, 'schedules');
  db.schedules = db.schedules.filter(s => !(s.id === req.params.schId && s.serverId === server.id)); saveDbSync(); ok(res);
}));
router.post('/servers/:id/schedules/:schId/run', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'schedules');
  const sch = db.schedules.find(s => s.id === req.params.schId && s.serverId === server.id);
  if (!sch) return err(res, 404, 'NOT_FOUND', 'Schedule not found.');
  if (!userCaps(db, acc.owner).plan.features.scheduledTasks) return err(res, 403, 'NOT_IN_PLAN', 'Scheduled tasks are available on paid plans.');
  if (!allow(`schrun:${server.id}`, 6, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Slow down.');
  await runScheduleNow(db, sch); ok(res);
}));

// =================================================================================== switch node (paid plans)
router.get('/servers/:id/transfer', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'owner');
  const plan = userCaps(db, acc.owner).plan;
  const targets = plan.features.switchNode ? transferTargets(db, server) : [];
  const cur = db.nodes.find(n => n.id === server.nodeId);
  ok(res, { allowed: plan.features.switchNode, planName: plan.name, current: cur ? { id: cur.id, name: cur.name, location: cur.locationName } : null, transfer: server.transfer || null,
    targets: targets.map(n => ({ id: n.id, name: n.name, location: n.locationName, flag: n.locationFlag, runtime: n.status.runtime })) });
}));
router.post('/servers/:id/transfer', handle(async (req, res) => {
  const { db, server } = await member(req, 'owner');
  if (!allow(`xfer:${server.id}`, 3, 30 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Please wait before moving this server again.');
  beginTransfer(db, server, String(req.body?.nodeId || ''));
  await createAuditLog(req.user!.id, req.user!.email, req.user!.role, 'SERVER_TRANSFER_STARTED', server.id, `Moving "${server.name}" to ${req.body?.nodeId}`);
  res.status(202).json({ success: true, data: { started: true } });
}));
router.post('/servers/:id/transfer/dismiss', handle(async (req, res) => {
  const { server } = await member(req, 'owner');
  if (server.transfer?.state === 'failed') { server.transfer = undefined; saveDbSync(); }
  ok(res);
}));

// =================================================================================== SFTP
const loginName = (username: string, serverId: string) => `${(username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'user')}.${serverId.slice(0, 8)}`;

async function sftpInfo(req: AuthenticatedRequest) {
  const { db, server, acc } = await member(req, 'sftp');
  const node = db.nodes.find(n => n.id === server.nodeId);
  const plan = userCaps(db, acc.owner).plan;
  const cred = db.sftpCreds.find(c => c.serverId === server.id && c.userId === req.user!.id);
  return { db, server, acc, node, plan, cred };
}

router.get('/servers/:id/sftp', handle(async (req, res) => {
  const { server, node, plan, cred } = await sftpInfo(req);
  ok(res, { planAllows: plan.features.sftp, nodeOffers: !!node?.sftpPort, host: node?.fqdn, port: node?.sftpPort || 0, username: cred?.username || loginName(req.user!.username, server.id), hasPassword: !!cred, readOnly: !!cred?.readOnly });
}));
router.post('/servers/:id/sftp', handle(async (req, res) => {
  const { db, server, acc, node, plan, cred } = await sftpInfo(req);
  if (!plan.features.sftp) return err(res, 403, 'NOT_IN_PLAN', 'SFTP access is available on paid plans.');
  if (!node?.sftpPort) return err(res, 409, 'NOT_OFFERED', 'This node does not offer SFTP yet.');
  if (!allow(`sftp:${req.user!.id}`, 10, 60 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many password resets. Try again later.');
  const password = randomPassword(24);
  let username = cred?.username || loginName(req.user!.username, server.id);
  if (!cred && db.sftpCreds.some(c => c.serverId === server.id && c.username === username)) username = `${username.split('.')[0]}-${req.user!.id.slice(-3)}.${server.id.slice(0, 8)}`;
  if (cred) { cred.passwordHash = hashSftpPassword(password); }
  else db.sftpCreds.push({ id: newId('sftp'), serverId: server.id, userId: req.user!.id, username, passwordHash: hashSftpPassword(password), readOnly: false, createdAt: new Date().toISOString() });
  saveDbSync();
  await pushSpec(db, server);
  await createAuditLog(req.user!.id, req.user!.email, req.user!.role, 'SFTP_PASSWORD_SET', server.id, `SFTP credentials generated for ${acc.role}`);
  ok(res, { username, password, host: node.fqdn, port: node.sftpPort }); // the only time the password is ever visible
}));
router.delete('/servers/:id/sftp', handle(async (req, res) => {
  const { db, server } = await sftpInfo(req);
  db.sftpCreds = db.sftpCreds.filter(c => !(c.serverId === server.id && c.userId === req.user!.id)); saveDbSync();
  await pushSpec(db, server).catch(() => undefined); ok(res);
}));

// =================================================================================== addon store
router.get('/addons', handle(async (req, res) => {
  const db = await getDb();
  let server;
  if (req.query.serverId) { req.params.id = String(req.query.serverId); server = (await member(req, 'addons')).server; }
  const list = db.addons.filter(a => a.isActive).sort((a, b) => Number(b.featured) - Number(a.featured) || b.installs - a.installs || a.name.localeCompare(b.name));
  ok(res, { categories: [...new Set(list.map(a => a.category))], coinName: db.settings.hosting!.economy.coinName, items: list.map(a => publicAddon(db, a, server)) });
}));
router.get('/servers/:id/addons', handle(async (req, res) => {
  const { db, server } = await member(req, 'addons');
  ok(res, db.addonInstalls.filter(i => i.serverId === server.id).map(i => { const a = db.addons.find(x => x.id === i.addonId); return { id: i.id, addonId: i.addonId, name: a?.name || 'Removed addon', version: i.version, currentVersion: a?.version, installedAt: i.installedAt, paths: i.paths.length }; }));
}));
router.post('/servers/:id/addons/:addonId/install', handle(async (req, res) => {
  const { db, server } = await member(req, 'addons');
  const user = db.users.find(u => u.id === req.user!.id)!;
  const addon = db.addons.find(a => a.id === req.params.addonId);
  if (!addon) return err(res, 404, 'NOT_FOUND', 'Addon not found.');
  if (!allow(`addon:${req.user!.id}`, 10, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many installs. Wait a few minutes.');
  if (!isCompatible(addon, server)) return err(res, 400, 'INCOMPATIBLE', 'This addon does not work with that server\'s software.');
  const live = await liveState(db, server);
  await installAddon(db, user, server, addon, req.body?.payWith === 'credits' ? 'credits' : 'coins', live.status === 'running');
  await createAuditLog(req.user!.id, req.user!.email, req.user!.role, 'ADDON_INSTALLED', server.id, `Installed ${addon.name} on "${server.name}"`);
  ok(res, { coins: user.coins || 0, credits: user.credits });
}));
router.delete('/servers/:id/addons/:installId', handle(async (req, res) => {
  const { db, server } = await member(req, 'addons');
  const inst = db.addonInstalls.find(i => i.id === req.params.installId && i.serverId === server.id);
  if (!inst) return err(res, 404, 'NOT_FOUND', 'Not installed.');
  await uninstallAddon(db, server, inst); ok(res);
}));

void can; void selectableNodes;
export default router;
