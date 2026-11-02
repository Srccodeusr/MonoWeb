import { Router, Request, Response, NextFunction } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../auth';
import { HostImage, HostServer, ServerActivityEntry } from '../../src/hostingTypes';
import { DaemonError, daemon, daemonFetch } from '../hosting/daemonClient';
import { allow } from '../hosting/ratelimit';
import { decryptSecret, encryptSecret, newId } from '../hosting/crypto';
import { HostingError, buildPorts, dropStateCache, liveLimits, nodeFor, pushSpec, renderStartup, selectableNodes, userCaps } from '../hosting/serverService';
import { createDatabase, dbHostConfig, dropDatabase, makeNames, rotatePassword } from '../hosting/databases';
import { member } from './hosting';

/**
 * Everything the new server pages need that the older route files did not offer:
 * activity feed, recycle bin, "pull from URL", startup settings, background / egg / reinstall, and MySQL databases.
 * Mounted twice in server.ts: `activityHook` BEFORE the hosting routers (so it sees every mutating request) and the router AFTER them.
 */
const router = Router();
router.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => (req.user ? next() : authMiddleware(req, res, next)));

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });
const ok = (res: Response, data?: unknown) => res.json({ success: true, data });
function handle(fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) {
  return async (req: AuthenticatedRequest, res: Response) => {
    try { await fn(req, res); } catch (e: any) {
      if (res.headersSent) return;
      if (e instanceof HostingError) return err(res, e.status, e.code, e.message);
      if (e instanceof DaemonError) return err(res, e.status === 404 ? 404 : e.status === 409 || e.status === 400 || e.status === 507 ? e.status : 502, 'NODE_ERROR', e.message);
      console.error('[HostingTools]', e?.message || e); err(res, 500, 'INTERNAL', 'Something went wrong. Please try again.');
    }
  };
}
const usable = (s: HostServer) => {
  if (s.status === 'suspended') throw new HostingError(403, 'SUSPENDED', 'This server is suspended. Contact support.');
  if (s.status === 'expired') throw new HostingError(403, 'EXPIRED', 'This server has expired. Renew it first.');
  if (s.status === 'transferring') throw new HostingError(409, 'TRANSFERRING', 'This server is being moved to another node.');
};
const q = (v: unknown) => encodeURIComponent(String(v ?? '/'));

// ======================================================================================== activity
const MAX_ACTIVITY = 150;
async function record(serverId: string, user: { id: string; username?: string; email?: string }, event: string, detail: string, ip?: string) {
  const db = await getDb();
  const s = db.servers.find(x => x.id === serverId);
  if (!s) return;
  const list = (s.activity ||= []);
  const now = Date.now();
  const last = list[0];
  // A folder upload fires one request per file: fold bursts into a single line instead of flooding the feed.
  if (event === 'file.upload' && last && last.event === event && last.userId === user.id && now - new Date(last.at).getTime() < 30_000) {
    const n = (parseInt(/^Uploaded (\d+) files/.exec(last.detail)?.[1] || '1', 10) || 1) + 1;
    last.detail = `Uploaded ${n} files`; last.at = new Date(now).toISOString();
  } else {
    list.unshift({ id: newId('act'), at: new Date(now).toISOString(), userId: user.id, username: user.username || user.email || 'user', event, detail: detail.slice(0, 240), ip });
    if (list.length > MAX_ACTIVITY) list.length = MAX_ACTIVITY;
  }
  saveDbSync();
}

const join = (a: unknown, b: unknown) => `${String(a || '/').replace(/\/+$/, '')}/${String(b || '')}`.replace(/\/{2,}/g, '/');
const count = (n: unknown) => (Array.isArray(n) ? n.length : 1);

function describe(method: string, rest: string, b: any): { event: string; detail: string } | null {
  const seg = rest.split('/');
  const key = `${method} ${seg[0]}${seg[1] ? '/' + seg[1] : ''}`;
  switch (key) {
    case 'POST power': return { event: `power.${String(b?.action || 'action')}`, detail: `Sent power action: ${String(b?.action || '').slice(0, 12)}` };
    case 'POST command': return { event: 'console.command', detail: 'Sent a console command' };
    case 'PUT files/content': return { event: 'file.write', detail: `Edited ${String(b?.path || '').slice(0, 160)}` };
    case 'POST files/mkdir': return { event: 'file.create', detail: `Created folder ${join(b?.path, b?.name)}` };
    case 'POST files/rename': return { event: 'file.rename', detail: `Renamed ${String(b?.from || '')} to ${String(b?.to || '')}` };
    case 'POST files/delete': return { event: 'file.delete', detail: `${b?.permanent ? 'Permanently deleted' : 'Moved to recycle bin:'} ${count(b?.paths)} item${count(b?.paths) === 1 ? '' : 's'}` };
    case 'POST files/move': return { event: 'file.move', detail: `Moved ${count(b?.paths)} item${count(b?.paths) === 1 ? '' : 's'} to ${String(b?.dest || '/').slice(0, 160)}` };
    case 'POST files/copy': return { event: 'file.copy', detail: `Copied ${count(b?.paths)} item${count(b?.paths) === 1 ? '' : 's'}` };
    case 'POST files/archive': return { event: 'file.archive', detail: `Archived ${count(b?.names)} item${count(b?.names) === 1 ? '' : 's'}` };
    case 'POST files/extract': return { event: 'file.extract', detail: `Extracted ${String(b?.path || '')}` };
    case 'POST files/upload': return { event: 'file.upload', detail: `Uploaded ${join(b?.path, b?.name)}` };
    case 'POST files/pull': { let host = ''; try { host = new URL(String(b?.url)).host; } catch { /* ignore */ } return { event: 'file.pull', detail: `Pulled a file from ${host || 'a URL'}` }; }
    case 'POST recycle/restore': return { event: 'file.restore', detail: b?.all ? 'Restored everything from the recycle bin' : `Restored ${count(b?.ids)} item${count(b?.ids) === 1 ? '' : 's'} from the recycle bin` };
    case 'POST recycle/purge': return { event: 'file.purge', detail: b?.all ? 'Emptied the recycle bin' : `Permanently deleted ${count(b?.ids)} item${count(b?.ids) === 1 ? '' : 's'} from the recycle bin` };
    case 'POST backups': return seg[2] === 'restore' ? { event: 'backup.restore', detail: 'Restored a backup' } : { event: 'backup.create', detail: 'Created a backup' };
    case 'DELETE backups': return { event: 'backup.delete', detail: 'Deleted a backup' };
    case 'PATCH subusers': return { event: 'user.update', detail: 'Changed a user’s permissions' };
    case 'DELETE subusers': return { event: 'user.delete', detail: 'Removed a user' };
    case 'POST schedules': return { event: 'task.run', detail: seg[2] ? 'Ran a scheduled task' : 'Created a scheduled task' };
    case 'PUT schedules': return { event: 'task.update', detail: 'Updated a scheduled task' };
    case 'DELETE schedules': return { event: 'task.delete', detail: 'Deleted a scheduled task' };
    case 'POST sftp': return { event: 'sftp.password', detail: 'Created an SFTP password' };
    case 'DELETE sftp': return { event: 'sftp.revoke', detail: 'Revoked SFTP access' };
    case 'PUT startup': return { event: 'startup.update', detail: 'Updated startup settings' };
    case 'PUT background': return { event: 'settings.background', detail: b?.url ? 'Changed the server background' : 'Removed the server background' };
    case 'POST reinstall': return { event: 'server.reinstall', detail: 'Reinstalled the server' };
    case 'POST egg': return { event: 'server.egg', detail: 'Changed the server software' };
    case 'POST databases': return seg[2] ? { event: 'database.password', detail: 'Rotated a database password' } : { event: 'database.create', detail: 'Created a database' };
    case 'DELETE databases': return { event: 'database.delete', detail: 'Deleted a database' };
    case 'POST transfer': return { event: 'server.move', detail: 'Started moving the server to another node' };
    case 'POST renew': return { event: 'server.renew', detail: 'Renewed the server' };
    case 'POST addons': case 'DELETE addons': return { event: 'addon.change', detail: method === 'POST' ? 'Installed an addon' : 'Removed an addon' };
    default: return null;
  }
}

export function activityHook(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const m = /^\/servers\/([\w-]{8,64})(?:\/(.*))?$/.exec(req.path);
  if (!m) return next();
  const serverId = m[1]; const rest = (m[2] || '').replace(/\/+$/, '');
  const found = rest ? describe(req.method, rest, req.body) : req.method === 'PATCH' ? { event: 'settings.update', detail: 'Updated the server name, description or variables' } : null;
  if (!found) return next();
  const ip = req.ip;
  res.on('finish', () => {
    const user = (req as AuthenticatedRequest).user;
    if (res.statusCode >= 400 || !user) return;
    record(serverId, user, found.event, found.detail, ip).catch(() => undefined);
  });
  next();
}

router.get('/servers/:id/activity', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'settings');
  const own = acc.role === 'owner';
  const feed: ServerActivityEntry[] = [...(server.activity || [])];
  // older actions that were written to the global audit log (create, team invites ...)
  for (const a of db.auditLogs) {
    if (a.targetResource !== server.id || !/^(SERVER_|SUBUSER_)/.test(a.action)) continue;
    feed.push({ id: a.id, at: a.createdAt, userId: a.actorId, username: a.actorEmail, event: a.action.startsWith('SUBUSER') ? 'user.add' : a.action === 'SERVER_CREATED' ? 'server.create' : 'server.event', detail: a.details });
  }
  const limit = Math.min(150, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
  const search = String(req.query.q || '').trim().toLowerCase();
  const items = feed.sort((a, b) => b.at.localeCompare(a.at))
    .filter(e => !search || `${e.username} ${e.detail} ${e.event}`.toLowerCase().includes(search))
    .slice(0, limit).map(e => ({ ...e, ip: own ? e.ip : undefined }));
  ok(res, { items });
}));

// ======================================================================================== file manager extras
router.get('/servers/:id/recycle', handle(async (req, res) => {
  const { db, server } = await member(req, 'files.read');
  ok(res, await daemon(nodeFor(db, server), 'GET', `/v1/servers/${server.id}/recycle`));
}));
for (const op of ['restore', 'purge'] as const) {
  router.post(`/servers/:id/recycle/${op}`, handle(async (req, res) => {
    const { db, server } = await member(req, 'files.write'); usable(server);
    const b = req.body || {};
    ok(res, await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/recycle/${op}`, { ids: Array.isArray(b.ids) ? b.ids.map(String).slice(0, 1000) : [], all: b.all === true }, { timeoutMs: 120_000 }));
  }));
}
for (const op of ['move', 'copy', 'archive'] as const) {
  router.post(`/servers/:id/files/${op}`, handle(async (req, res) => {
    const { db, server } = await member(req, 'files.write'); usable(server);
    if (!allow(`fileop:${req.user!.id}`, 60, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Slow down: too many file actions.');
    const b = req.body || {};
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []);
    const body = op === 'archive' ? { path: b.path || '/', names: strs(b.names), name: typeof b.name === 'string' ? b.name : undefined } : { paths: strs(b.paths), dest: typeof b.dest === 'string' ? b.dest : undefined };
    ok(res, await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/files/${op}`, body, { timeoutMs: op === 'archive' ? 10 * 60_000 : 120_000 }));
  }));
}
// Several files/folders as one .tar.gz download. Streamed through the panel so node addresses stay private.
router.post('/servers/:id/files/bulk-download', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { db, server } = await member(req, 'files.read');
    if (!allow(`bulkdl:${req.user!.id}`, 10, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many downloads. Wait a minute.');
    const names = Array.isArray(req.body?.names) ? req.body.names.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [];
    const up = await daemonFetch(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/files/bulk-download`, { path: req.body?.path || '/', names }, { timeoutMs: 10 * 60_000 });
    if (!up.ok || !up.body) return err(res, up.status === 404 ? 404 : 502, 'NODE_ERROR', 'Download failed.');
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': up.headers.get('content-disposition') || 'attachment', 'X-Content-Type-Options': 'nosniff' });
    const r = up.body.getReader();
    req.on('close', () => r.cancel().catch(() => undefined));
    for (;;) { const { value, done } = await r.read(); if (done) break; res.write(Buffer.from(value)); }
    res.end();
  } catch (e: any) { if (!res.headersSent) err(res, e instanceof HostingError ? e.status : 502, 'NODE_ERROR', e?.message || 'Download failed.'); else res.end(); }
});
router.post('/servers/:id/files/pull', handle(async (req, res) => {
  const { db, server } = await member(req, 'files.write'); usable(server);
  if (!allow(`pull:${req.user!.id}`, 10, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many downloads. Wait a few minutes.');
  const b = req.body || {};
  const url = String(b.url || '').trim();
  if (!/^https?:\/\/[^\s]{3,2000}$/i.test(url)) return err(res, 400, 'INVALID_URL', 'Enter a full http:// or https:// link.');
  ok(res, await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/files/pull`, { url, path: b.path || '/', name: typeof b.name === 'string' && b.name ? b.name : undefined }, { timeoutMs: 5 * 60_000 }));
}));

// ======================================================================================== meta + background
router.get('/servers/:id/meta', handle(async (req, res) => {
  const { db, server } = await member(req);
  const node = db.nodes.find(n => n.id === server.nodeId);
  const caps = userCaps(db, db.users.find(u => u.id === server.ownerId)!);
  const eggs = db.images.filter(i => i.isActive && selectableNodes(db, i, caps.plan).some(n => n.id === server.nodeId) || i.id === server.imageId)
    .map(i => ({ id: i.id, name: i.name, software: i.software, category: i.category, minRamMB: i.minRamMB }));
  ok(res, { serverId: server.id, node: node ? { name: node.name, location: node.locationName } : null, backgroundUrl: server.backgroundUrl || '', imageId: server.imageId, eggs });
}));

router.put('/servers/:id/background', handle(async (req, res) => {
  const { server } = await member(req, 'settings');
  const raw = String(req.body?.url ?? '').trim();
  if (raw) {
    let u: URL;
    try { u = new URL(raw); } catch { return err(res, 400, 'INVALID_URL', 'Enter a valid image link.'); }
    if (!['http:', 'https:'].includes(u.protocol) || raw.length > 500 || /[\s"'<>`\\]/.test(raw)) return err(res, 400, 'INVALID_URL', 'Use a plain http(s) image link (up to 500 characters).');
  }
  server.backgroundUrl = raw || undefined; saveDbSync();
  ok(res, { backgroundUrl: server.backgroundUrl || '' });
}));

// ======================================================================================== startup
const SECRET_RE = /(TOKEN|PASSWORD|SECRET|API_?KEY)/i;
function startupView(db: Awaited<ReturnType<typeof getDb>>, server: HostServer) {
  const img = db.images.find(i => i.id === server.imageId);
  const l = liveLimits(server);
  const env = { ...server.variables, SERVER_MEMORY: String(l.ramMB), SERVER_IP: '0.0.0.0', SERVER_PORT: String(server.ports[0]?.container ?? server.ports[0]?.host ?? '') };
  const labels = Object.keys(img?.dockerImages || {});
  return {
    command: renderStartup(img?.startup || '', env),
    dockerImage: labels.find(k => img!.dockerImages[k] === server.dockerImage) || '',
    dockerImages: labels,
    variables: (img?.variables || []).map(v => ({
      name: v.name, env: v.env, description: v.description, editable: v.userEditable, value: server.variables[v.env] ?? v.default,
      kind: /boolean/i.test(v.rules) ? 'boolean' : SECRET_RE.test(v.env) ? 'secret' : 'text',
    })),
  };
}

router.get('/servers/:id/startup', handle(async (req, res) => {
  const { db, server } = await member(req, 'settings');
  ok(res, startupView(db, server));
}));

router.put('/servers/:id/startup', handle(async (req, res) => {
  const { db, server } = await member(req, 'settings'); usable(server);
  const img = db.images.find(i => i.id === server.imageId);
  if (!img) return err(res, 404, 'IMAGE_NOT_FOUND', 'The software for this server no longer exists.');
  const b = req.body || {};
  const next = { ...server.variables };
  if (b.variables && typeof b.variables === 'object') {
    for (const v of img.variables) {
      if (!v.userEditable || b.variables[v.env] === undefined) continue;
      const val = String(b.variables[v.env]);
      if (val.length > 500 || /[\0\r\n]/.test(val)) return err(res, 400, 'INVALID_VARIABLE', `${v.name}: invalid value.`);
      if (/boolean/i.test(v.rules) && !['0', '1', 'true', 'false', ''].includes(val)) return err(res, 400, 'INVALID_VARIABLE', `${v.name} must be on or off.`);
      if (v.rules === 'number' && val !== '' && !/^-?\d+(\.\d+)?$/.test(val)) return err(res, 400, 'INVALID_VARIABLE', `${v.name} must be a number.`);
      if (v.rules === 'required' && !val.trim()) return err(res, 400, 'INVALID_VARIABLE', `${v.name} is required.`);
      if (v.rules.startsWith('/') && v.rules.lastIndexOf('/') > 0) {
        const last = v.rules.lastIndexOf('/');
        try { if (!new RegExp(v.rules.slice(1, last), v.rules.slice(last + 1)).test(val)) return err(res, 400, 'INVALID_VARIABLE', `${v.name} has an invalid format.`); } catch { /* bad admin regex: skip */ }
      }
      next[v.env] = val;
    }
  }
  if (typeof b.dockerImage === 'string' && b.dockerImage) {
    const target = img.dockerImages[b.dockerImage];
    if (!target) return err(res, 400, 'INVALID_IMAGE', 'That Docker image is not available for this software.');
    server.dockerImage = target;
  }
  server.variables = next;
  await pushSpec(db, server);
  saveDbSync();
  ok(res, startupView(db, server));
}));

// ======================================================================================== reinstall + change egg
async function wipeVolume(db: Awaited<ReturnType<typeof getDb>>, server: HostServer) {
  const node = nodeFor(db, server);
  const list = await daemon<{ entries: { name: string }[] }>(node, 'GET', `/v1/servers/${server.id}/files?path=${q('/')}`);
  const paths = list.entries.map(e => '/' + e.name);
  for (let i = 0; i < paths.length; i += 200) await daemon(node, 'POST', `/v1/servers/${server.id}/files/delete`, { paths: paths.slice(i, i + 200), permanent: true }, { timeoutMs: 120_000 });
}

async function runInstall(db: Awaited<ReturnType<typeof getDb>>, server: HostServer, img: HostImage, wipe: boolean) {
  const node = nodeFor(db, server);
  await daemon(node, 'POST', `/v1/servers/${server.id}/power`, { action: 'kill' }, { timeoutMs: 30_000 }).catch(() => undefined);
  if (wipe) await wipeVolume(db, server);
  await pushSpec(db, server);
  await daemon(node, 'POST', `/v1/servers/${server.id}/install`, {
    image: img.install.image, script: img.install.script, entrypoint: img.install.entrypoint,
    env: { ...server.variables, SERVER_MEMORY: String(liveLimits(server).ramMB) }, files: img.install.files,
  });
  server.status = 'installing'; dropStateCache(server.id); saveDbSync();
}

router.post('/servers/:id/reinstall', handle(async (req, res) => {
  const { db, server } = await member(req, 'settings'); usable(server);
  if (server.status === 'installing') return err(res, 409, 'INSTALLING', 'The server is already installing.');
  if (!allow(`reinstall:${server.id}`, 3, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Please wait before reinstalling again.');
  const img = db.images.find(i => i.id === server.imageId);
  if (!img) return err(res, 404, 'IMAGE_NOT_FOUND', 'The software for this server no longer exists.');
  await runInstall(db, server, img, req.body?.wipe === true);
  ok(res);
}));

router.post('/servers/:id/egg', handle(async (req, res) => {
  const { db, server, acc } = await member(req, 'owner'); usable(server);
  if (server.status === 'installing') return err(res, 409, 'INSTALLING', 'Wait for the current installation to finish.');
  const img = db.images.find(i => i.id === String(req.body?.imageId) && i.isActive);
  if (!img) return err(res, 404, 'IMAGE_NOT_FOUND', 'That software is not available.');
  const caps = userCaps(db, acc.owner);
  if (!selectableNodes(db, img, caps.plan).some(n => n.id === server.nodeId)) return err(res, 400, 'NODE_INCOMPATIBLE', 'This server’s node cannot run that software. Move the server to another node first.');
  if (liveLimits(server).ramMB < img.minRamMB) return err(res, 400, 'LOW_RAM', `${img.name} needs at least ${img.minRamMB} MB RAM; this server has ${liveLimits(server).ramMB} MB.`);
  if (!allow(`egg:${server.id}`, 3, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Please wait before changing the software again.');
  const reinstall = req.body?.reinstall === true;
  server.imageId = img.id;
  server.dockerImage = img.dockerImages[img.defaultImage] || Object.values(img.dockerImages)[0];
  server.variables = Object.fromEntries(img.variables.map(v => [v.env, server.variables[v.env] ?? v.default]));
  server.ports = buildPorts(img, server.ports.map(p => p.host));
  if (reinstall) await runInstall(db, server, img, true);
  else { await pushSpec(db, server); saveDbSync(); }
  ok(res, { reinstalled: reinstall });
}));

// ======================================================================================== databases (MySQL)
const publicDb = (d: NonNullable<HostServer['databases']>[number], cfg: ReturnType<typeof dbHostConfig>) => ({
  id: d.id, label: d.label, name: d.name, username: d.username, password: (() => { try { return decryptSecret(d.passwordEnc); } catch { return ''; } })(),
  host: cfg?.publicHost || '', port: cfg?.publicPort || 3306, createdAt: d.createdAt,
});

router.get('/servers/:id/databases', handle(async (req, res) => {
  const { server } = await member(req, 'settings');
  const cfg = dbHostConfig();
  ok(res, { configured: !!cfg, limit: server.limits.databases, items: (server.databases || []).map(d => publicDb(d, cfg)) });
}));

router.post('/servers/:id/databases', handle(async (req, res) => {
  const { server } = await member(req, 'settings'); usable(server);
  const cfg = dbHostConfig();
  if (!cfg) return err(res, 503, 'DB_HOST_MISSING', 'No database host is configured yet. An administrator must set DB_HOST_ADDRESS in the panel’s .env.');
  const list = (server.databases ||= []);
  if (server.limits.databases <= 0) return err(res, 403, 'NO_DATABASES', 'Databases are not included in this server’s plan.');
  if (list.length >= server.limits.databases) return err(res, 403, 'DATABASE_LIMIT', `Database limit reached (${server.limits.databases}). Delete one first.`);
  if (!allow(`dbcreate:${req.user!.id}`, 6, 60 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many databases created. Try again later.');
  const label = String(req.body?.label ?? '').trim();
  if (!/^[A-Za-z0-9 _-]{1,24}$/.test(label)) return err(res, 400, 'INVALID_NAME', 'Use 1–24 letters, numbers, spaces, dashes or underscores.');
  const { name, username } = makeNames(server.id, label);
  let password: string;
  try { password = await createDatabase(cfg, name, username); }
  catch (e: any) { console.error('[Databases] create failed:', e?.message || e); return err(res, 502, 'DB_HOST_ERROR', 'The database host refused the request. Check the admin credentials in .env.'); }
  const rec = { id: newId('db'), label, name, username, passwordEnc: encryptSecret(password), createdAt: new Date().toISOString() };
  list.push(rec); saveDbSync();
  ok(res, publicDb(rec, cfg));
}));

router.post('/servers/:id/databases/:dbId/rotate', handle(async (req, res) => {
  const { server } = await member(req, 'settings'); usable(server);
  const cfg = dbHostConfig(); const rec = (server.databases || []).find(d => d.id === req.params.dbId);
  if (!cfg || !rec) return err(res, 404, 'NOT_FOUND', 'Database not found.');
  try { rec.passwordEnc = encryptSecret(await rotatePassword(cfg, rec.username)); }
  catch (e: any) { console.error('[Databases] rotate failed:', e?.message || e); return err(res, 502, 'DB_HOST_ERROR', 'The database host refused the request.'); }
  saveDbSync(); ok(res, publicDb(rec, cfg));
}));

router.delete('/servers/:id/databases/:dbId', handle(async (req, res) => {
  const { server } = await member(req, 'settings');
  const cfg = dbHostConfig(); const rec = (server.databases || []).find(d => d.id === req.params.dbId);
  if (!rec) return err(res, 404, 'NOT_FOUND', 'Database not found.');
  if (cfg) { try { await dropDatabase(cfg, rec.name, rec.username); } catch (e: any) { console.error('[Databases] drop failed:', e?.message || e); return err(res, 502, 'DB_HOST_ERROR', 'The database host refused the request.'); } }
  server.databases = (server.databases || []).filter(d => d.id !== rec.id); saveDbSync();
  ok(res);
}));

export default router;
