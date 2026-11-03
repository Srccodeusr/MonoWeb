'use strict';
// MonoVPS daemon: signed-request HTTP API (same HMAC scheme as the MonoNode game daemon). Zero runtime dependencies.
//
// Changes vs 1.0.0 (see README): body limit raised so 4 MB file saves fit, /v1/vps listing, /v1/vps/:id/resize,
// disk/VPS counts in /v1/system, create() reports whether the disk quota is enforced, optional custom base image.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https'), crypto = require('crypto');

const VERSION = '1.1.0';

(function loadEnv() {
  const f = path.join(process.cwd(), '.env');
  if (!fs.existsSync(f)) return;
  for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l[0] === '#') continue;
    const i = l.indexOf('='); if (i < 1) continue;
    const k = l.slice(0, i).trim();
    const v = l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

const env = (k, d = '') => (process.env[k] ?? d).trim();
const cfg = {
  secret: env('DAEMON_SECRET'), host: env('DAEMON_HOST', '0.0.0.0'), port: parseInt(env('DAEMON_PORT', '3100'), 10),
  allowed: env('ALLOWED_IPS').split(',').map(s => s.trim()).filter(Boolean),
  tlsCert: env('TLS_CERT'), tlsKey: env('TLS_KEY'), runtime: env('RUNTIME', 'docker'), ociRuntime: env('OCI_RUNTIME'),
  basePrefixes: env('ALLOWED_BASE_PREFIXES', 'ubuntu:,debian:').split(',').map(s => s.trim()).filter(Boolean),
  dataDir: path.resolve(env('DATA_DIR', './data')),
};
if (cfg.secret.length < 32) { console.error('DAEMON_SECRET must be at least 32 characters. Run: npm run configure -- --panel <url> --key <secret>'); process.exit(1); }
fs.mkdirSync(cfg.dataDir, { recursive: true });
const rt = cfg.runtime === 'mock' ? require('./runtime-mock')(cfg) : require('./runtime-docker')(cfg);
if (rt.kind === 'mock') console.warn('[monovps] RUNTIME=mock: simulated VPSes only. Not for production.');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const seen = new Map();
setInterval(() => { const n = Date.now(); for (const [k, e] of seen) if (e < n) seen.delete(k); }, 30000).unref();
const ID = /^[a-z0-9-]{6,40}$/;
const BASE = /^[a-z0-9][a-z0-9._\/-]{0,100}:[A-Za-z0-9._-]{1,60}$/;
const MAX_BODY = 6 * 1024 * 1024;       // 4 MB file content + JSON overhead
const MAX_FILE = 4 * 1024 * 1024;

function authenticate(req, body) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (cfg.allowed.length && !cfg.allowed.includes(ip)) throw new HttpError(403, 'Forbidden');
  const ts = String(req.headers['x-mono-ts'] || ''), nonce = String(req.headers['x-mono-nonce'] || ''), sig = String(req.headers['x-mono-sig'] || '');
  if (!ts || nonce.length < 16 || nonce.length > 64 || !/^[0-9a-f]{64}$/i.test(sig)) throw new HttpError(401, 'Unauthorized');
  if (!Number.isFinite(+ts) || Math.abs(Date.now() / 1000 - +ts) > 60) throw new HttpError(401, 'Request expired');
  if (seen.has(nonce)) throw new HttpError(401, 'Replay detected');
  const bh = crypto.createHash('sha256').update(body).digest('hex');
  const exp = crypto.createHmac('sha256', cfg.secret).update(`${ts}\n${nonce}\n${req.method.toUpperCase()}\n${req.url}\n${bh}`).digest();
  const got = Buffer.from(sig, 'hex');
  if (exp.length !== got.length || !crypto.timingSafeEqual(exp, got)) throw new HttpError(401, 'Unauthorized');
  seen.set(nonce, Date.now() + 120000);
}

const readBody = req => new Promise((res, rej) => {
  const c = []; let n = 0;
  req.on('data', d => { n += d.length; if (n > MAX_BODY) { rej(new HttpError(413, 'Body too large')); req.destroy(); } else c.push(d); });
  req.on('end', () => res(Buffer.concat(c)));
  req.on('error', rej);
});
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
const str = (v, max = 4096) => { if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'Invalid input'); return v; };

function diskInfo() {
  // Docker keeps container layers under /var/lib/docker; fall back to / on hosts that put it elsewhere.
  for (const p of ['/var/lib/docker', '/']) {
    try { const s = fs.statfsSync(p); return { diskTotalMb: Math.round(s.blocks * s.bsize / 1048576), diskFreeMb: Math.round(s.bavail * s.bsize / 1048576) }; } catch { /* try next */ }
  }
  return {};
}

async function route(req, body) {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const m = req.method;
  const j = body.length ? JSON.parse(body.toString()) : {};
  if (p === '/v1/ping' && m === 'GET') return { ok: true, daemon: 'monovps', version: VERSION };
  if (p === '/v1/system' && m === 'GET') {
    const info = await rt.info().catch(e => ({ runtime: rt.kind, error: e.message }));
    const list = await rt.list_all().catch(() => []);
    return { ...info, ...diskInfo(), hostname: os.hostname(), cpus: os.cpus().length, memTotalMb: Math.round(os.totalmem() / 1048576), memFreeMb: Math.round(os.freemem() / 1048576),
      loadavg: os.loadavg(), platform: os.platform(), uptimeS: Math.round(os.uptime()), vpsCount: list.length, vpsRunning: list.filter(x => x.status === 'running').length };
  }
  if (p === '/v1/vps' && m === 'GET') return { vps: await rt.list_all() };
  if (p === '/v1/vps' && m === 'POST') {
    const v = {
      id: str(j.id, 40), image: str(j.image, 40),
      base: j.base ? str(j.base, 160) : '',
      cpu: Math.min(64, Math.max(0.25, +j.cpu || 1)), ramMb: Math.min(262144, Math.max(256, +j.ramMb || 1024)), diskGb: Math.min(4096, Math.max(0, +j.diskGb || 0)),
      hostname: str(j.hostname || '', 63).replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 63), sshPort: +j.sshPort, rootPassword: str(j.rootPassword, 128),
    };
    if (!ID.test(v.id) || !(v.sshPort >= 1024 && v.sshPort <= 65535) || v.rootPassword.length < 8 || /[\r\n:]/.test(v.rootPassword)) throw new HttpError(400, 'Invalid VPS spec');
    if (v.base && (!BASE.test(v.base) || !cfg.basePrefixes.some(x => v.base.startsWith(x)))) throw new HttpError(400, `Base image "${v.base}" is not allowed on this node (ALLOWED_BASE_PREFIXES).`);
    if (j.reinstall === true) return { ok: true, ...(await rt.reinstall(v)) };
    return { ok: true, ...(await rt.create(v)) };
  }
  const mm = /^\/v1\/vps\/([a-z0-9-]{6,40})(\/[a-z]+)?$/.exec(p); if (!mm) throw new HttpError(404, 'Not found');
  const id = mm[1], sub = mm[2] || '';
  if (sub === '' && m === 'GET') return rt.stats(id);
  if (sub === '' && m === 'DELETE') { await rt.destroy(id); return { ok: true }; }
  if (sub === '/power' && m === 'POST') { await rt.power(id, str(j.action, 10)); return { ok: true }; }
  if (sub === '/resize' && m === 'POST') {
    await rt.resize(id, { cpu: Math.min(64, Math.max(0.25, +j.cpu || 1)), ramMb: Math.min(262144, Math.max(256, +j.ramMb || 1024)) });
    return { ok: true };
  }
  if (sub === '/logs' && m === 'GET') return { log: await rt.logs(id, +u.searchParams.get('tail') || 300) };
  if (sub === '/exec' && m === 'POST') return rt.exec(id, str(j.cmd, 8192), j.cwd ? str(j.cwd, 1024) : '/root');
  if (sub === '/files' && m === 'GET') return { files: await rt.list(id, u.searchParams.get('path') || '/') };
  if (sub === '/file' && m === 'GET') return { content: await rt.read(id, u.searchParams.get('path') || '') };
  if (sub === '/file' && m === 'PUT') { await rt.write(id, str(j.path, 1024), str(j.content, MAX_FILE)); return { ok: true }; }
  if (sub === '/mkdir' && m === 'POST') { await rt.mkdir(id, str(j.path, 1024)); return { ok: true }; }
  if (sub === '/delete' && m === 'POST') { await rt.remove(id, str(j.path, 1024)); return { ok: true }; }
  if (sub === '/rename' && m === 'POST') { await rt.rename(id, str(j.from, 1024), str(j.to, 1024)); return { ok: true }; }
  if (sub === '/password' && m === 'POST') {
    const pw = str(j.password, 128);
    if (pw.length < 8 || /[\r\n:]/.test(pw)) throw new HttpError(400, 'Invalid password');
    await rt.setPassword(id, pw); return { ok: true };
  }
  if (sub === '/sshx' && m === 'GET') return rt.sshx(id, 'status');
  if (sub === '/sshx' && m === 'POST') return rt.sshx(id, j.action === 'stop' ? 'stop' : 'start');
  throw new HttpError(404, 'Not found');
}

const handler = async (req, res) => {
  try {
    if (req.url.length > 2048) throw new HttpError(414, 'URI too long');
    const body = await readBody(req); authenticate(req, body);
    send(res, 200, await route(req, body));
  } catch (e) {
    const gone = /No such container/i.test(e.message || '');          // docker says this when the VPS container was removed on the node
    const nf = e.code === 'ENOENT' || /No such file|not found/i.test(e.message || '');
    const s = e.status || (e instanceof SyntaxError ? 400 : gone || nf ? 404 : 500);
    if (gone && !e.status) e.message = 'VPS not found on this node';
    else if (nf && !e.status) e.message = 'No such file or directory';
    if (s >= 500) console.error('[monovps]', e.message);
    send(res, s, { error: s >= 500 ? (e.message || 'Internal error').slice(0, 300) : e.message });
  }
};
const server = cfg.tlsCert && cfg.tlsKey ? https.createServer({ cert: fs.readFileSync(cfg.tlsCert), key: fs.readFileSync(cfg.tlsKey) }, handler) : http.createServer(handler);
server.listen(cfg.port, cfg.host, () => console.log(`[monovps] daemon v${VERSION} listening on ${cfg.tlsCert ? 'https' : 'http'}://${cfg.host}:${cfg.port} (runtime: ${rt.kind})`));
