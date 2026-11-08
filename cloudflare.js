// ==============================================================
//   MonoWeb  |  Cloudflare Tunnel manager
//   Downloads cloudflared, (optionally) creates the tunnel + DNS
//   record through the Cloudflare API, runs it and keeps it alive.
//   No npm dependencies - safe to import before `npm install`.
// ==============================================================
//
// Modes (CF_TUNNEL_MODE, or auto-detected from the variables below):
//   token  CF_TUNNEL_TOKEN set          -> run an existing dashboard-managed tunnel
//   auto   CF_API_TOKEN + CF_HOSTNAME   -> create tunnel, ingress and DNS CNAME by API, then run it
//   quick  CF_QUICK_TUNNEL=true         -> temporary https://xxxx.trycloudflare.com URL, no account
//   off    nothing set                  -> no tunnel
//
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function resolveMode(env = process.env) {
  const explicit = String(env.CF_TUNNEL_MODE || '').trim().toLowerCase();
  if (['off', 'quick', 'token', 'auto'].includes(explicit)) return explicit;
  if (env.CF_TUNNEL_TOKEN) return 'token';
  if (env.CF_API_TOKEN && env.CF_HOSTNAME) return 'auto';
  if (truthy(env.CF_QUICK_TUNNEL)) return 'quick';
  return 'off';
}

// ---------------------------------------------------------------- binary
const ARCH = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' };

async function ensureBinary(root, log, env) {
  if (env.CLOUDFLARED_BIN && fs.existsSync(env.CLOUDFLARED_BIN)) return env.CLOUDFLARED_BIN;

  const local = path.join(root, 'bin', 'cloudflared');
  if (fs.existsSync(local) && fs.statSync(local).size > 5_000_000) return local;

  try {
    const found = execFileSync('which', ['cloudflared'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found) return found;
  } catch { /* not installed system-wide */ }

  if (process.platform !== 'linux') throw new Error(`No cloudflared binary for ${process.platform}. Install it and set CLOUDFLARED_BIN.`);
  const arch = ARCH[process.arch];
  if (!arch) throw new Error(`Unsupported CPU architecture: ${process.arch}`);

  const url = env.CLOUDFLARED_URL || `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  log('TUNNEL', `Downloading cloudflared (linux-${arch})`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const tmp = `${local}.part`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let seen = 0, nextMark = 25;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    seen += chunk.length;
    if (total && (seen / total) * 100 >= nextMark) { log('TUNNEL', `cloudflared download ${nextMark}%`, 'dim'); nextMark += 25; }
  });
  await pipeline(body, fs.createWriteStream(tmp));
  if (fs.statSync(tmp).size < 5_000_000) { fs.rmSync(tmp, { force: true }); throw new Error('Downloaded file is too small to be cloudflared.'); }
  fs.renameSync(tmp, local);
  fs.chmodSync(local, 0o755);
  try {
    const v = execFileSync(local, ['--version'], { encoding: 'utf8' }).trim().split('\n')[0];
    log('TUNNEL', `Installed ${v}`, 'success');
  } catch (e) {
    throw new Error(`cloudflared will not run here (is the volume mounted noexec?): ${e.message}`);
  }
  return local;
}

// ---------------------------------------------------------------- API
class CloudflareApi {
  constructor(token, base) { this.token = token; this.base = (base || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''); }
  async call(method, route, body) {
    const res = await fetch(this.base + route, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json;
    try { json = await res.json(); } catch { throw new Error(`Cloudflare API ${method} ${route}: HTTP ${res.status} (not JSON)`); }
    if (!json.success) {
      const msg = (json.errors || []).map((e) => `${e.message}${e.code ? ` [${e.code}]` : ''}`).join('; ') || `HTTP ${res.status}`;
      throw new Error(`Cloudflare API ${method} ${route}: ${msg}`);
    }
    return json.result;
  }
}

// ---------------------------------------------------------------- manager
export class TunnelManager extends EventEmitter {
  constructor({ root, port, log, env = process.env }) {
    super();
    this.root = root; this.port = port; this.log = log; this.env = env;
    this.mode = resolveMode(env);
    this.state = this.mode === 'off' ? 'off' : 'idle';
    this.url = ''; this.hostname = ''; this.connections = 0; this.restarts = 0;
    this.child = null; this.stopping = false; this.token = '';
    this.stateFile = path.join(root, 'data', 'cloudflare.json');
  }

  setState(s) { if (s !== this.state) { this.state = s; this.emit('state', s); } }
  setUrl(u) { if (u && u !== this.url) { this.url = u; this.emit('url', u); } }
  info() { return { mode: this.mode, state: this.state, url: this.url, hostname: this.hostname, connections: this.connections, restarts: this.restarts, pid: this.child?.pid || 0 }; }

  async start() {
    if (this.mode === 'off') return { ok: true };
    this.stopping = false;
    this.setState('starting');
    try {
      this.bin = await ensureBinary(this.root, this.log, this.env);
      if (this.mode === 'auto') {
        const r = await this.provision();
        this.token = r.token; this.hostname = r.hostname; this.setUrl(`https://${r.hostname}`);
      } else if (this.mode === 'token') {
        this.token = this.env.CF_TUNNEL_TOKEN;
        if (!this.token) throw new Error('CF_TUNNEL_TOKEN is empty.');
        if (this.env.CF_HOSTNAME) { this.hostname = this.env.CF_HOSTNAME; this.setUrl(`https://${this.hostname}`); }
        else this.log('TUNNEL', `Token mode: set the public hostname's service to http://localhost:${this.port} in Zero Trust -> Networks -> Tunnels`, 'warn');
      }
      this.spawnTunnel();
      await this.waitReady(this.mode === 'quick' ? 40_000 : 30_000);
      return { ok: this.state === 'connected' };
    } catch (e) {
      this.setState('failed');
      this.log('TUNNEL', e.message, 'error');
      return { ok: false, error: e.message };
    }
  }

  waitReady(ms) {
    return new Promise((resolve) => {
      if (this.state === 'connected') return resolve();
      const done = () => { clearTimeout(t); this.off('state', onState); resolve(); };
      const onState = (s) => { if (s === 'connected' || s === 'failed') done(); };
      const t = setTimeout(() => { this.log('TUNNEL', 'Tunnel not connected yet - continuing, it will keep retrying in the background', 'warn'); done(); }, ms);
      this.on('state', onState);
    });
  }

  spawnTunnel() {
    const args = ['tunnel', '--no-autoupdate'];
    if (this.env.CF_PROTOCOL) args.push('--protocol', this.env.CF_PROTOCOL);
    const env = { ...process.env, ...this.env };
    if (this.mode === 'quick') args.push('--url', `http://127.0.0.1:${this.port}`);
    else { args.push('run'); env.TUNNEL_TOKEN = this.token; }  // env var keeps the token out of `ps`

    this.connections = 0;
    const child = spawn(this.bin, args, { cwd: this.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    for (const stream of [child.stdout, child.stderr]) readline.createInterface({ input: stream }).on('line', (l) => this.onLine(l));
    child.on('error', (e) => this.log('TUNNEL', `Could not run cloudflared: ${e.message}`, 'error'));
    child.on('close', async (code, signal) => {
      this.child = null; this.connections = 0;
      if (this.stopping) { this.setState('stopped'); return; }
      this.setState('reconnecting');
      this.restarts++;
      const wait = Math.min(60, 5 * this.restarts);
      this.log('TUNNEL', `cloudflared exited (${signal || code}); restarting in ${wait}s`, 'warn');
      await sleep(wait * 1000);
      if (!this.stopping) this.spawnTunnel();
    });
  }

  onLine(raw) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!line) return;
    const quick = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (quick && this.mode === 'quick') { this.setUrl(quick[0]); this.log('TUNNEL', `Quick tunnel: ${quick[0]}`, 'success'); return; }
    if (/Registered tunnel connection/i.test(line)) {
      this.connections++;
      const loc = line.match(/location=(\S+)/)?.[1];
      this.log('TUNNEL', `Connection ${this.connections} registered${loc ? ` (${loc})` : ''}`, 'success');
      this.setState('connected');
      return;
    }
    if (/\b(ERR|WRN)\b|failed|unable|error|unauthorized|invalid/i.test(line)) {
      const level = /\bERR\b|failed|unable|unauthorized|invalid/i.test(line) ? 'error' : 'warn';
      this.log('TUNNEL', line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, '').slice(0, 160), level);
    }
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) { if (this.mode !== 'off') this.setState('stopped'); return; }
    child.kill('SIGTERM');
    await Promise.race([new Promise((r) => child.once('close', r)), sleep(5000)]);
    if (this.child) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }

  async restart() { await this.stop(); this.restarts = 0; return this.start(); }

  // ---- API provisioning (auto mode)
  readCache() { try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { return {}; } }
  writeCache(data) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async provision() {
    const env = this.env;
    const hostname = String(env.CF_HOSTNAME || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!env.CF_API_TOKEN || !hostname) throw new Error('Auto mode needs CF_API_TOKEN and CF_HOSTNAME.');
    const api = new CloudflareApi(env.CF_API_TOKEN, env.CF_API_BASE);

    let account = env.CF_ACCOUNT_ID;
    if (!account) {
      const accounts = await api.call('GET', '/accounts');
      if (accounts.length !== 1) throw new Error('Set CF_ACCOUNT_ID (the API token can see zero or several accounts).');
      account = accounts[0].id;
    }

    // 1) tunnel: reuse the cached/same-named one, else create
    const name = env.CF_TUNNEL_NAME || 'monoweb';
    const cache = this.readCache();
    let tunnelId = cache.accountId === account && cache.name === name ? cache.tunnelId : '';
    if (tunnelId) {
      try { await api.call('GET', `/accounts/${account}/cfd_tunnel/${tunnelId}`); }
      catch { tunnelId = ''; }
    }
    if (!tunnelId) {
      const found = await api.call('GET', `/accounts/${account}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
      if (found.length) tunnelId = found[0].id;
    }
    if (!tunnelId) {
      this.log('TUNNEL', `Creating tunnel "${name}"`);
      const created = await api.call('POST', `/accounts/${account}/cfd_tunnel`, { name, config_src: 'cloudflare' });
      tunnelId = created.id;
    }
    const token = await api.call('GET', `/accounts/${account}/cfd_tunnel/${tunnelId}/token`);

    // 2) ingress -> this server's port (re-sent every start because Pterodactyl ports can change)
    await api.call('PUT', `/accounts/${account}/cfd_tunnel/${tunnelId}/configurations`, {
      config: { ingress: [{ hostname, service: `http://127.0.0.1:${this.port}` }, { service: 'http_status:404' }] },
    });
    this.log('TUNNEL', `Ingress ${hostname} -> http://127.0.0.1:${this.port}`);

    // 3) DNS CNAME
    let zone = env.CF_ZONE_ID;
    if (!zone) {
      const parts = hostname.split('.');
      for (let i = 0; i < parts.length - 1 && !zone; i++) {
        const found = await api.call('GET', `/zones?name=${encodeURIComponent(parts.slice(i).join('.'))}`);
        if (found.length) zone = found[0].id;
      }
      if (!zone) throw new Error(`No Cloudflare zone found for ${hostname}. Add the domain to Cloudflare or set CF_ZONE_ID.`);
    }
    const target = `${tunnelId}.cfargotunnel.com`;
    const records = await api.call('GET', `/zones/${zone}/dns_records?name=${encodeURIComponent(hostname)}`);
    const record = { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 };
    const existing = records.find((r) => r.type === 'CNAME') || records[0];
    if (!existing) { await api.call('POST', `/zones/${zone}/dns_records`, record); this.log('TUNNEL', `DNS CNAME ${hostname} created`, 'success'); }
    else if (existing.type === 'CNAME' && existing.content === target && existing.proxied) this.log('TUNNEL', `DNS CNAME ${hostname} already correct`);
    else if (existing.type === 'CNAME') { await api.call('PUT', `/zones/${zone}/dns_records/${existing.id}`, record); this.log('TUNNEL', `DNS CNAME ${hostname} updated`, 'success'); }
    else throw new Error(`${hostname} already has a ${existing.type} record. Delete it in Cloudflare DNS (a CNAME cannot coexist with it).`);

    this.writeCache({ accountId: account, name, tunnelId, hostname });
    return { token, hostname };
  }
}
