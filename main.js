// ==============================================================
//   MonoWeb  |  Pterodactyl launcher
//   Startup command:  node main.js
//
//   1. preflight checks     4. Cloudflare tunnel (optional)
//   2. npm install (if needed)  5. runs dist/server.cjs and supervises it
//   3. vite/esbuild build (if needed)   6. live console UI + commands
//
//   Zero npm dependencies: it has to run before `npm install`.
// ==============================================================
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TunnelManager } from './cloudflare.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);
const BOOT = Date.now();

// ------------------------------------------------------------ .env (no override: panel variables win)
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}
const HAS_DOTENV = loadDotEnv(path.join(ROOT, '.env'));

// ------------------------------------------------------------ console UI
const COLOR = !process.env.NO_COLOR;
const c = (code) => (COLOR ? `\x1b[${code}m` : '');
const RESET = c('0'), BOLD = c('1'), MUTED = c('90'), CYAN = c('96'), WHITE = c('97'), GREEN = c('92'), YELLOW = c('93'), RED = c('91'), MAGENTA = c('95');
const BADGE = { info: c('44;97'), success: c('42;97'), warn: c('43;30'), error: c('41;97'), dim: c('100;97') };
const stamp = () => new Date().toTimeString().slice(0, 8);
const clip = (s, n = 118) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function log(ctx, message, level = 'info') {
  console.log(`${MUTED}${stamp()}${RESET} ${BADGE[level] || BADGE.info} ${String(ctx).padEnd(6)} ${RESET} ${message}`);
}

const GLYPH = {
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  B: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
};
const art = (word) => Array.from({ length: 6 }, (_, row) => [...word].map((ch) => { const g = GLYPH[ch]; return (g[row] || '').padEnd(Math.max(...g.map((x) => x.length))); }).join(''));

function banner() {
  const mono = art('MONO'), web = art('WEB');
  const width = Math.max(...mono.map((l) => l.length)) + 1 + Math.max(...web.map((l) => l.length));
  const label = ' p o w e r e d   b y   M o n o N o d e ';
  const side = Math.max(0, Math.floor((width - label.length) / 2));
  console.log();
  for (let i = 0; i < 6; i++) console.log(`${CYAN}${mono[i]}${RESET} ${WHITE}${web[i]}${RESET}`);
  console.log(`${MUTED}${'─'.repeat(side)}${RESET}${BOLD}${WHITE}${label}${RESET}${MUTED}${'─'.repeat(Math.max(0, width - side - label.length))}${RESET}\n`);
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
function box(rows, { inner = 66, color = CYAN, title = '' } = {}) {
  const top = title ? `─ ${title} ` : '';
  console.log(`${color}╭${top}${'─'.repeat(Math.max(0, inner - top.length))}╮${RESET}`);
  for (const [name, value] of rows) {
    if (name === '-') { console.log(`${color}├${'─'.repeat(inner)}┤${RESET}`); continue; }
    const body = ` ${name.padEnd(14)} `;
    const val = String(value);
    const room = inner - body.length;
    const shown = strip(val).length > room ? clip(strip(val), room) : val;
    const pad = ' '.repeat(Math.max(0, room - strip(shown).length));
    console.log(`${color}│${RESET}${BOLD}${body}${RESET}${shown}${pad}${color}│${RESET}`);
  }
  console.log(`${color}╰${'─'.repeat(inner)}╯${RESET}`);
}

const fmtDur = (ms) => {
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s % 60}s` : m ? `${m}m ${s % 60}s` : `${s}s`;
};
const fmtMB = (b) => `${(b / 1048576).toFixed(b > 1073741824 ? 0 : 1)} MB`;
const bar = (pct, n = 20) => { const f = Math.max(0, Math.min(n, Math.round((pct / 100) * n))); return `${pct > 85 ? RED : pct > 60 ? YELLOW : GREEN}${'█'.repeat(f)}${MUTED}${'░'.repeat(n - f)}${RESET}`; };

// ------------------------------------------------------------ system helpers
function memoryLimit() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try { const v = fs.readFileSync(f, 'utf8').trim(); const n = Number(v); if (v !== 'max' && n > 0 && n < os.totalmem() * 2) return n; } catch { /* next */ }
  }
  return os.totalmem();
}
const MEM_LIMIT = memoryLimit();
const heapFor = (share, cap) => Math.max(256, Math.min(cap, Math.floor((MEM_LIMIT / 1048576) * share)));

function procRss(pid) {
  try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/); return m ? Number(m[1]) * 1024 : 0; } catch { return 0; }
}
let lastCpu = { ticks: 0, at: Date.now(), pid: 0 };
function procCpu(pid) {
  try {
    const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const p = f.slice(f.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(p[11]) + Number(p[12]), now = Date.now();
    let pct = 0;
    if (lastCpu.pid === pid && now > lastCpu.at) pct = ((ticks - lastCpu.ticks) / 100 / ((now - lastCpu.at) / 1000)) * 100;
    lastCpu = { ticks, at: now, pid };
    return Math.max(0, pct);
  } catch { return 0; }
}

// ------------------------------------------------------------ config
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || '', 10) || 3000;
const STATUS_EVERY = Math.max(0, parseInt(process.env.STATUS_INTERVAL || '600', 10) || 0) * 1000;
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const state = { child: null, stopping: false, ready: false, startedAt: 0, restarts: 0, crashes: [], busy: false, step: null };
const tunnel = new TunnelManager({ root: ROOT, port: PORT, log, env: process.env });

// ------------------------------------------------------------ long-running steps (npm / build)
function runStep(ctx, label, cmd, args, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    log(ctx, `${label}`);
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    state.step = child;
    const tail = [];
    const hb = setInterval(() => log(ctx, `${label} - still working (${fmtDur(Date.now() - t0)})`, 'dim'), 20000);
    const onLine = (l) => { if (!l.trim()) return; tail.push(l); if (tail.length > 30) tail.shift(); log(ctx, `${MUTED}${clip(strip(l))}${RESET}`, 'dim'); };
    for (const s of [child.stdout, child.stderr]) readline.createInterface({ input: s }).on('line', onLine);
    child.on('error', (e) => { clearInterval(hb); state.step = null; resolve({ ok: false, code: -1, tail: [e.message], ms: 0 }); });
    child.on('close', (code) => { clearInterval(hb); state.step = null; resolve({ ok: code === 0, code, tail, ms: Date.now() - t0 }); });
  });
}

function failBox(title, tail) {
  console.log();
  box([['Step', `${RED}${title} failed${RESET}`], ['-', ''], ...tail.slice(-8).map((l) => ['', clip(strip(l), 50)])], { color: RED, title: 'ERROR' });
  console.log();
}

// ------------------------------------------------------------ install / build
const sha = (...parts) => crypto.createHash('sha1').update(parts.join('\0')).digest('hex');
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
function sourceFingerprint() {
  const files = [...walk('src'), ...walk('server'), ...walk('public'), 'server.ts', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json'].filter((f) => fs.existsSync(f)).sort();
  const h = crypto.createHash('sha1');
  for (const f of files) { h.update(f); h.update(fs.readFileSync(f)); }
  for (const k of Object.keys(process.env).filter((k) => k.startsWith('VITE_')).sort()) h.update(`${k}=${process.env[k]}`); // baked into the bundle
  return h.digest('hex');
}

async function ensureDependencies() {
  const lock = ['package-lock.json', 'package.json'].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'));
  const want = sha(...lock, process.version);
  const stampFile = path.join('node_modules', '.mono-install');
  const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';
  if (fs.existsSync(path.join('node_modules', 'express')) && have === want) { log('NPM', 'Dependencies up to date', 'success'); return true; }
  const r = await runStep('NPM', 'Installing dependencies (first start can take a few minutes)', 'npm', ['install', '--no-audit', '--no-fund', '--no-progress', '--include=dev', '--loglevel=error'], { NODE_ENV: 'development' });
  if (!r.ok) { failBox('npm install', r.tail); return false; }
  fs.mkdirSync('node_modules', { recursive: true });
  fs.writeFileSync(stampFile, want);
  log('NPM', `Dependencies installed in ${fmtDur(r.ms)}`, 'success');
  return true;
}

async function ensureBuild(force = false) {
  const distOk = fs.existsSync('dist/server.cjs') && fs.existsSync('dist/index.html');
  const hasSources = fs.existsSync('src') && fs.existsSync('server.ts');
  const stampFile = path.join('dist', '.mono-build');
  if (!hasSources) {
    if (distOk) { log('BUILD', 'No sources found - using the uploaded dist/ as is', 'warn'); return true; }
    failBox('build', ['Neither sources nor dist/ were found.', 'Upload the full MonoWeb project.']); return false;
  }
  const fp = sourceFingerprint();
  const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';
  if (!force && distOk && !have) { fs.writeFileSync(stampFile, fp); log('BUILD', 'Found a pre-built dist/ - adopting it', 'success'); return true; }
  if (!force && distOk && have === fp) { log('BUILD', 'Build is up to date', 'success'); return true; }

  const heap = heapFor(0.85, 3072);
  if (MEM_LIMIT < 900 * 1048576) log('BUILD', `Only ${fmtMB(MEM_LIMIT)} RAM - the build may run out of memory. Raise the limit once, or run "npm run build" locally and upload dist/.`, 'warn');
  const r = await runStep('BUILD', `Building frontend + server (heap ${heap} MB)`, 'npm', ['run', 'build'], { NODE_ENV: 'production', NODE_OPTIONS: `--max-old-space-size=${heap}` });
  if (!r.ok) {
    failBox('npm run build', r.tail);
    if (distOk) { log('BUILD', 'Falling back to the previous dist/ build', 'warn'); return true; }
    return false;
  }
  fs.writeFileSync(stampFile, fp);
  log('BUILD', `Build finished in ${fmtDur(r.ms)}`, 'success');
  return true;
}

// ------------------------------------------------------------ web process
function childEnv() {
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(PORT), FORCE_COLOR: '0' };
  const pub = tunnel.url;
  const isLocal = (u) => !u || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u);
  if (pub && isLocal(env.APP_URL)) {
    env.APP_URL = pub;
    env.ALLOWED_ORIGINS = [pub, ...String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)].join(',');
    if (isLocal(env.DISCORD_REDIRECT_URI) || /localhost|127\.0\.0\.1/.test(env.DISCORD_REDIRECT_URI || '')) env.DISCORD_REDIRECT_URI = `${pub}/api/v1/auth/discord/callback`;
    log('CORE', `APP_URL -> ${pub} (from the tunnel)`, 'dim');
  }
  return env;
}

function levelOf(line) {
  if (/password|secret|api key/i.test(line) && /admin|generated|created|bootstrap|initial/i.test(line)) return 'warn';
  if (/\b(error|fatal|exception|unhandled|EADDRINUSE|ECONN|failed)\b/i.test(line)) return 'error';
  if (/\bwarn(ing)?\b/i.test(line)) return 'warn';
  if (/running on|listening|ready|started|connected|logged in/i.test(line)) return 'success';
  return 'info';
}

async function waitHealthy(timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && state.child && !state.stopping) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startWeb() {
  if (state.child) return;
  const heap = heapFor(0.75, 4096);
  const args = ['--disable-warning=ExperimentalWarning', `--max-old-space-size=${heap}`, 'dist/server.cjs'];
  log('WEB', `Starting dist/server.cjs on port ${PORT} (heap ${heap} MB)`);
  const child = spawn(process.execPath, args, { cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  state.child = child; state.ready = false; state.startedAt = Date.now();
  for (const s of [child.stdout, child.stderr]) {
    readline.createInterface({ input: s }).on('line', (l) => { if (l.trim()) log('WEB', `${levelOf(l) === 'warn' ? BOLD : ''}${clip(strip(l), 200)}${RESET}`, levelOf(l)); });
  }
  child.on('error', (e) => log('WEB', `Spawn error: ${e.message}`, 'error'));
  child.on('close', (code, signal) => {
    if (state.child === child) state.child = null;
    state.ready = false;
    if (state.stopping || state.busy) return;
    const now = Date.now();
    state.crashes = state.crashes.filter((t) => now - t < 120000).concat(now);
    log('WEB', `Process exited (${signal || `code ${code}`})`, 'error');
    if (state.crashes.length > 5) { log('CORE', 'Crash loop: 6 exits in 2 minutes. Fix the error above, then type "restart".', 'error'); return; }
    state.restarts++;
    const wait = Math.min(30, 3 * state.crashes.length);
    log('CORE', `Restarting in ${wait}s (restart #${state.restarts})`, 'warn');
    setTimeout(() => { if (!state.stopping && !state.busy) startWeb(); }, wait * 1000);
  });
  waitHealthy().then((ok) => {
    if (!ok || state.child !== child) { if (state.child === child) log('WEB', 'Health check timed out - the panel did not answer on /api/health', 'warn'); return; }
    state.ready = true;
    readyBanner();
  });
}

async function stopWeb() {
  const child = state.child;
  if (!child) return;
  state.child = null;
  child.kill('SIGTERM');
  await Promise.race([new Promise((r) => child.once('close', r)), new Promise((r) => setTimeout(r, 8000))]);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

// ------------------------------------------------------------ status panels
function statusRows() {
  const t = tunnel.info();
  const webRss = state.child ? procRss(state.child.pid) : 0;
  const mainRss = process.memoryUsage().rss;
  const used = webRss + mainRss + (t.pid ? procRss(t.pid) : 0);
  const pct = (used / MEM_LIMIT) * 100;
  const cpu = state.child ? procCpu(state.child.pid) : 0;
  const publicUrl = t.url || (process.env.APP_URL && !/localhost|127\.0\.0\.1/.test(process.env.APP_URL) ? process.env.APP_URL : '');
  const tunnelText = t.mode === 'off' ? `${MUTED}disabled${RESET}` : `${t.mode} / ${t.state === 'connected' ? GREEN : t.state === 'failed' ? RED : YELLOW}${t.state}${RESET}${t.connections ? ` (${t.connections} conn)` : ''}`;
  return [
    ['Status', state.ready ? `${GREEN}Online & Ready${RESET}` : state.child ? `${YELLOW}Starting${RESET}` : `${RED}Offline${RESET}`],
    ['Public URL', publicUrl || `${MUTED}none - use http://<node-ip>:${PORT}${RESET}`],
    ['Local URL', `http://127.0.0.1:${PORT}`],
    ['Listening', `0.0.0.0:${PORT}`],
    ['Tunnel', tunnelText],
    ['-', ''],
    ['Panel uptime', state.ready ? fmtDur(Date.now() - state.startedAt) : '-'],
    ['Launcher up', fmtDur(Date.now() - BOOT)],
    ['Restarts', String(state.restarts)],
    ['CPU (web)', `${bar(Math.min(100, cpu))} ${cpu.toFixed(1)}%`],
    ['Memory', `${bar(pct)} ${fmtMB(used)} / ${fmtMB(MEM_LIMIT)}`],
    ['  web / main', `${fmtMB(webRss)} / ${fmtMB(mainRss)}`],
    ['-', ''],
    ['Node', `${process.version} (${process.arch})`],
    ['Database', process.env.DATABASE_FILE || 'data/mono.sqlite'],
    ['Admin email', process.env.AETHER_ADMIN_EMAIL || `${MUTED}not set${RESET}`],
  ];
}

function readyBanner() {
  console.log();
  box(statusRows(), { title: 'MONOWEB' });
  console.log(`${MUTED}  Console commands: ${RESET}help  status  url  restart  rebuild  tunnel  stop${RESET}\n`);
}

const HELP = [
  ['status', 'Show this panel (CPU, RAM, tunnel, URLs)'],
  ['url', 'Print the public / local URL'],
  ['restart', 'Restart the web process'],
  ['rebuild', 'Force npm install + rebuild, then restart'],
  ['tunnel', 'Restart the Cloudflare tunnel'],
  ['stop', 'Shut everything down cleanly'],
];

async function rebuild() {
  if (state.busy) return log('CORE', 'Already busy', 'warn');
  state.busy = true;
  await stopWeb();
  const ok = (await ensureDependencies()) && (await ensureBuild(true));
  state.busy = false;
  ok ? startWeb() : log('CORE', 'Rebuild failed - the panel stays offline until it succeeds', 'error');
}

async function onCommand(raw) {
  const cmd = raw.trim().toLowerCase();
  if (!cmd) return;
  switch (cmd) {
    case 'help': case '?': console.log(); box(HELP.map(([a, b]) => [a, b]), { title: 'COMMANDS', color: MAGENTA }); console.log(); break;
    case 'status': console.log(); box(statusRows(), { title: 'MONOWEB' }); console.log(); break;
    case 'url': { const t = tunnel.info(); log('CORE', `Public: ${t.url || process.env.APP_URL || 'n/a'}  |  Local: http://127.0.0.1:${PORT}`); break; }
    case 'restart': log('CORE', 'Restarting web process'); state.busy = true; await stopWeb(); state.busy = false; state.crashes = []; startWeb(); break;
    case 'rebuild': await rebuild(); break;
    case 'tunnel': if (tunnel.mode === 'off') log('TUNNEL', 'No tunnel configured (see CF_* variables)', 'warn'); else { log('TUNNEL', 'Restarting tunnel'); await tunnel.restart(); } break;
    case 'stop': case 'exit': case 'shutdown': case 'quit': await shutdown(0); break;
    default: log('CORE', `Unknown command "${clip(cmd, 30)}" - type help`, 'warn');
  }
}

// ------------------------------------------------------------ shutdown
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true; state.stopping = true;
  log('CORE', 'Shutting down...', 'warn');
  try { state.step?.kill('SIGTERM'); } catch { /* none running */ }
  await Promise.allSettled([stopWeb(), tunnel.stop()]);
  log('CORE', `Goodbye. Ran for ${fmtDur(Date.now() - BOOT)}`, 'success');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => log('CORE', `Launcher error: ${e.stack || e}`, 'error'));
process.on('unhandledRejection', (e) => log('CORE', `Launcher rejection: ${e?.stack || e}`, 'error'));

// ------------------------------------------------------------ main
async function main() {
  banner();
  log('INIT', 'Starting MonoWeb launcher');
  log('CORE', '─'.repeat(38));
  log('CORE', 'MonoWeb  |  MonoNode platform');
  log('CORE', `Node ${process.version}  |  ${os.platform()} ${os.arch()}  |  ${os.cpus().length} vCPU`);
  log('CORE', `Memory limit ${fmtMB(MEM_LIMIT)}  |  port ${PORT}${process.env.SERVER_PORT ? ' (panel allocation)' : ''}`);
  log('CORE', '─'.repeat(38));

  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    failBox('Node version', [`Node ${process.version} is too old.`, 'MonoWeb needs Node 22.13 or newer', '(built-in node:sqlite).', 'Pick the Node.js 22 Docker image', 'in Startup -> Docker Image.']);
    process.exit(1);
  }
  log('INIT', `Node ${process.version} OK`, 'success');
  log('INIT', HAS_DOTENV ? 'Loaded .env (panel variables take priority)' : 'No .env file - using panel/startup variables only');
  fs.mkdirSync('data', { recursive: true });
  try { fs.accessSync('data', fs.constants.W_OK); log('DB', 'data/ is writable (SQLite lives here - back it up)', 'success'); }
  catch { log('DB', 'data/ is NOT writable - the panel cannot save anything', 'error'); process.exit(1); }
  if (!process.env.AETHER_ADMIN_EMAIL) log('INIT', 'AETHER_ADMIN_EMAIL not set - a default admin email will be used on first start', 'warn');
  if (!process.env.APP_URL || /localhost/.test(process.env.APP_URL)) {
    if (tunnel.mode === 'off') log('INIT', 'APP_URL is localhost and no tunnel is on - set APP_URL to your public domain (Stripe/OAuth need it)', 'warn');
  }
  log('INIT', `Tunnel mode: ${tunnel.mode}`);

  if (!(await ensureDependencies())) process.exit(1);
  if (!(await ensureBuild(truthy(process.env.FORCE_BUILD)))) process.exit(1);

  if (tunnel.mode !== 'off') await tunnel.start();
  tunnel.on('url', (u) => { if (state.ready) log('TUNNEL', `Public URL is now ${u}`, 'success'); });

  startWeb();

  readline.createInterface({ input: process.stdin }).on('line', (l) => { onCommand(l).catch((e) => log('CORE', e.message, 'error')); });
  if (STATUS_EVERY) setInterval(() => { if (state.ready) { console.log(); box(statusRows(), { title: 'MONOWEB STATUS' }); console.log(); } }, STATUS_EVERY).unref();
}

main().catch((e) => { log('CORE', `Fatal: ${e.stack || e}`, 'error'); process.exit(1); });
