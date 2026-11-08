import { Router, Response } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, requireRole, createAuditLog, AuthenticatedRequest } from '../auth';
import { publicBaseUrl } from '../hosting/billing';
import { encryptSecret, newId, randomToken } from '../hosting/crypto';
import { vpsInstallCommands } from '../vps/daemonClient';
import { VpsNode } from '../../src/vpsTypes';
import { applyConfigPatch, botState, configView, credentialsComplete, logActivity, removeBan, setCredentials, addBan } from '../bot/state';
import { checkCredentials, getStatus, restartBot, startBot, stopBot } from '../bot/manager';
import { nodeViews, onNodesChanged } from '../bot/nodes';

/** Admin API of the Discord Manager Bot: /api/v1/admin/manager-bot/* (admins only). */
const router = Router();
router.use(authMiddleware, requireRole(['admin', 'super_admin']));

type H = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap = (fn: H) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (e: any) { if (!res.headersSent) res.status(e?.status || 400).json({ success: false, error: { code: e?.code || 'ERROR', message: e?.message || 'Request failed.' } }); }
};
const ok = (res: Response, data: unknown = {}) => res.json({ success: true, data });
const audit = (req: AuthenticatedRequest, action: string, details: string) => createAuditLog(req.user!.id, req.user!.email, req.user!.role, action, 'MANAGER_BOT', details, req.ip || '127.0.0.1');
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };

/** Everything the admin page shows in one request. */
async function overview() {
  const db = await getDb(); const s = botState(db);
  return { config: configView(db), status: getStatus(db), nodes: nodeViews(db), bans: s.bans.slice(0, 200), activity: s.activity.slice(0, 80), configured: credentialsComplete(db) };
}

router.get('/', wrap(async (_req, res) => ok(res, await overview())));
router.get('/status', wrap(async (_req, res) => { const db = await getDb(); ok(res, getStatus(db)); }));

/** Save credentials and settings. The token and client secret are only replaced when a new value is sent. */
router.put('/', wrap(async (req, res) => {
  const db = await getDb(); const b = req.body || {};
  setCredentials(db, { botToken: b.botToken, clientId: b.clientId, clientSecret: b.clientSecret });
  applyConfigPatch(db, b);
  await audit(req, 'MANAGER_BOT_SETTINGS', 'Updated Discord Manager Bot settings');
  ok(res, await overview());
}));

router.post('/check', wrap(async (_req, res) => { const db = await getDb(); ok(res, await checkCredentials(db)); }));

/** Start (or restart) the bot with the saved credentials: logs in, loads every command and registers them in Discord. */
router.post('/start', wrap(async (req, res) => {
  const db = await getDb(); if (!credentialsComplete(db)) fail(400, 'Save the bot token and client ID first.');
  botState(db).config.enabled = true; saveDbSync();
  try { await restartBot(); } catch (e: any) { await audit(req, 'MANAGER_BOT_START_FAILED', e?.message || 'failed'); return res.status(502).json({ success: false, error: { code: 'BOT_START_FAILED', message: e?.message || 'The bot could not start.' }, data: await overview() }); }
  await audit(req, 'MANAGER_BOT_STARTED', 'Started the Discord Manager Bot'); ok(res, await overview());
}));

router.post('/stop', wrap(async (req, res) => {
  const db = await getDb(); botState(db).config.enabled = false; saveDbSync(); await stopBot();
  await audit(req, 'MANAGER_BOT_STOPPED', 'Stopped the Discord Manager Bot'); ok(res, await overview());
}));

/* ------------------------------------------------------------------ nodes */
router.get('/nodes', wrap(async (_req, res) => { const db = await getDb(); ok(res, { bot: nodeViews(db), available: db.vpsNodes.filter(n => !n.discordBot).map(n => ({ id: n.id, name: n.name, location: n.location })) }); }));

/** Hand an existing VPS node to the bot, or take it away. The registry updates itself and the change is announced. */
router.post('/nodes/:id/toggle', wrap(async (req, res) => {
  const db = await getDb(); const n = db.vpsNodes.find(x => x.id === req.params.id); if (!n) fail(404, 'Node not found.');
  n!.discordBot = req.body?.enabled === true; saveDbSync(); await onNodesChanged();
  await audit(req, 'MANAGER_BOT_NODE', `${n!.discordBot ? 'Added' : 'Removed'} node ${n!.name} ${n!.discordBot ? 'to' : 'from'} the bot`);
  ok(res, { bot: nodeViews(db) });
}));

/**
 * Create a brand-new VPS node that is a bot node from the start (same rules and install command as Admin > VPS Nodes).
 * The website adds it to the bot automatically.
 */
router.post('/nodes', wrap(async (req, res) => {
  const db = await getDb(); const b = req.body || {};
  const str = (v: unknown, d = '', max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : d);
  const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const name = str(b.name, '', 60), host = str(b.daemonHost, '', 200), port = Math.round(num(b.daemonPort, 3100));
  if (!name) fail(400, 'Give the node a name.');
  if (!/^[\w.-]+$/.test(host)) fail(400, 'Enter the daemon address as a hostname or IPv4 address.');
  if (!(port > 0 && port < 65536)) fail(400, 'Daemon port must be 1-65535.');
  const publicHost = str(b.publicHost, '', 200); if (publicHost && !/^[\w.-]+$/.test(publicHost)) fail(400, 'The public address must be a hostname or IPv4 address.');
  const portMin = Math.round(num(b.portMin, 42000)), portMax = Math.round(num(b.portMax, 42999));
  if (!(portMin >= 1024 && portMax <= 65535 && portMin < portMax)) fail(400, 'SSH port range must be inside 1024-65535 (from < to).');
  if (db.vpsNodes.some(o => o.daemonHost === host && o.daemonPort === port)) fail(400, 'A node with this address and port already exists.');
  const secret = randomToken(36);
  const node: VpsNode = {
    id: newId('vnode'), name, location: str(b.location, 'Default', 60) || 'Default', daemonHost: host, daemonPort: port, scheme: b.scheme === 'https' ? 'https' : 'http', publicHost,
    secretEnc: encryptSecret(secret), maxVps: Math.max(0, Math.round(num(b.maxVps, 20))), portMin, portMax, ramMb: Math.max(0, Math.round(num(b.ramMb, 0))), diskGb: Math.max(0, Math.round(num(b.diskGb, 0))),
    cpus: Math.max(0, num(b.cpus, 0)), overallocatePercent: Math.min(500, Math.max(0, Math.round(num(b.overallocatePercent, 0)))), enabled: true, discordBot: true, notes: str(b.notes, '', 500),
    status: { online: false }, createdAt: new Date().toISOString(),
  };
  db.vpsNodes.push(node); saveDbSync(); await onNodesChanged();
  await audit(req, 'VPS_NODE_CREATED', `Added bot node ${node.name}`);
  const panelUrl = publicBaseUrl(req as any);
  res.status(201).json({ success: true, data: { node: nodeViews(db).find(n => n.id === node.id), secret, panelUrl, ...vpsInstallCommands(panelUrl, secret, node.daemonPort) } });
}));

/* ------------------------------------------------------------------ bans */
router.post('/bans', wrap(async (req, res) => {
  const db = await getDb(); const id = String(req.body?.discordId || '').trim(); if (!/^\d{15,25}$/.test(id)) fail(400, 'Enter a Discord user ID (17-19 digits).');
  addBan(db, id, String(req.body?.reason || ''), req.user!.email); logActivity(db, 'BAN', `${req.user!.email} banned ${id} from the bot`, false);
  await audit(req, 'MANAGER_BOT_BAN', id); ok(res, await overview());
}));
router.delete('/bans/:id', wrap(async (req, res) => {
  const db = await getDb(); removeBan(db, req.params.id); logActivity(db, 'UNBAN', `${req.user!.email} unbanned ${req.params.id}`, false); await audit(req, 'MANAGER_BOT_UNBAN', req.params.id); ok(res, await overview());
}));

export default router;
