'use strict';
// Mock runtime for development WITHOUT Docker. Simulated VPSes live in memory; files live in DATA_DIR/mock/<id>.
// Commands are emulated (echo, pwd, ls, cat, cd, whoami, uname, uptime); nothing is executed on the host.
const fs = require('fs'), path = require('path'), { posix } = path;
module.exports = (cfg) => {
  const vps = new Map(); const root = id => path.join(cfg.dataDir, 'mock', id);
  const real = (id, p) => { const n = posix.normalize(String(p || '/')); if (!n.startsWith('/') || n.includes('\0')) throw Object.assign(new Error('Path must be absolute'), { status: 400 }); const f = path.join(root(id), n); if (!f.startsWith(root(id))) throw Object.assign(new Error('Bad path'), { status: 400 }); return f; };
  const get = id => { const v = vps.get(id); if (!v) throw Object.assign(new Error('VPS not found on this node'), { status: 404 }); return v; };
  const log = (v, l) => { v.log.push(`${new Date().toISOString()} ${l}`); if (v.log.length > 500) v.log.shift(); };
  return {
    kind: 'mock',
    async info() { return { runtime: 'mock', version: 'dev' }; },
    async create(v) {
      if (vps.has(v.id)) throw Object.assign(new Error('A VPS with this id already exists on the node.'), { status: 409 });
      fs.mkdirSync(root(v.id) + '/root', { recursive: true }); fs.mkdirSync(root(v.id) + '/etc', { recursive: true });
      fs.writeFileSync(root(v.id) + '/etc/hostname', (v.hostname || 'vps') + '\n'); fs.writeFileSync(root(v.id) + '/root/README.txt', 'Welcome to your MonoVPS (mock runtime).\n');
      const n = { ...v, status: 'running', startedAt: new Date().toISOString(), log: [], sshx: null }; vps.set(v.id, n);
      log(n, `Created ${v.image} · ${v.cpu} vCPU · ${v.ramMb} MB RAM`); log(n, 'sshd listening on :22'); log(n, 'Boot complete.');
      return { diskEnforced: !!v.diskGb };
    },
    async resize(id, { cpu, ramMb }) { const v = get(id); v.cpu = cpu; v.ramMb = ramMb; log(v, `Resized to ${cpu} vCPU / ${ramMb} MB`); },
    async list_all() { return [...vps.entries()].map(([id, v]) => ({ id, status: v.status })); },
    async power(id, a) { const v = get(id); const m = { start: 'running', stop: 'offline', kill: 'offline', restart: 'running' }[a]; if (!m) throw Object.assign(new Error('Bad action'), { status: 400 });
      v.status = m; v.startedAt = m === 'running' ? new Date().toISOString() : null; log(v, `Power: ${a}`); },
    async inspect(id) { const v = vps.get(id); return v ? { exists: true, status: v.status, startedAt: v.startedAt } : { exists: false, status: 'missing' }; },
    async stats(id) { const v = get(id); const on = v.status === 'running'; return { exists: true, status: v.status, startedAt: v.startedAt, cpuPct: on ? +(Math.random() * 12).toFixed(1) : 0, ramUsedMb: on ? Math.round(v.ramMb * (0.08 + Math.random() * 0.1)) : 0, diskUsedMb: 612, netRxMb: on ? 14.2 : 0, netTxMb: on ? 3.1 : 0 }; },
    async logs(id) { return get(id).log.join('\n'); },
    async exec(id, cmd, cwd = '/root') {
      const v = get(id); if (v.status !== 'running') return { output: 'VPS is offline.', code: 1, cwd };
      const [c, ...a] = cmd.trim().split(/\s+/); const arg = a.join(' ');
      const out = s => ({ output: s, code: 0, cwd });
      switch (c) {
        case '': return out('');
        case 'echo': return out(arg);
        case 'pwd': return out(cwd);
        case 'whoami': return out('root');
        case 'uname': return out('Linux ' + (v.hostname || 'vps') + ' 6.8.0 x86_64 GNU/Linux');
        case 'uptime': return out(' up ' + Math.round((Date.now() - new Date(v.startedAt)) / 60000) + ' min');
        case 'cd': { const t = posix.normalize(arg.startsWith('/') ? arg : posix.join(cwd, arg || '/root')); return fs.existsSync(real(id, t)) ? { output: '', code: 0, cwd: t } : { output: `bash: cd: ${arg}: No such file or directory`, code: 1, cwd }; }
        case 'ls': try { return out(fs.readdirSync(real(id, arg.startsWith('/') ? arg : posix.join(cwd, arg))).join('  ')); } catch { return { output: `ls: cannot access '${arg}'`, code: 2, cwd }; }
        case 'cat': try { return out(fs.readFileSync(real(id, arg.startsWith('/') ? arg : posix.join(cwd, arg)), 'utf8')); } catch { return { output: `cat: ${arg}: No such file`, code: 1, cwd }; }
        default: return { output: `bash: ${c}: mock runtime only emulates a few commands (use RUNTIME=docker on a real node)`, code: 127, cwd };
      }
    },
    async list(id, p) { const d = real(id, p); if (!fs.existsSync(d)) return []; return fs.readdirSync(d, { withFileTypes: true }).map(e => { const s = fs.statSync(path.join(d, e.name)); return { name: e.name, dir: e.isDirectory(), link: false, size: s.size, modified: s.mtimeMs }; }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)); },
    async read(id, p) { const f = real(id, p); if (fs.statSync(f).size > 2 * 1024 * 1024) throw Object.assign(new Error('File is larger than 2 MB.'), { status: 413 }); return fs.readFileSync(f, 'utf8'); },
    async write(id, p, c) { fs.mkdirSync(path.dirname(real(id, p)), { recursive: true }); fs.writeFileSync(real(id, p), c); },
    async mkdir(id, p) { fs.mkdirSync(real(id, p), { recursive: true }); },
    async remove(id, p) { if (posix.normalize(p) === '/') throw Object.assign(new Error('Refusing to delete /'), { status: 400 }); fs.rmSync(real(id, p), { recursive: true, force: true }); },
    async rename(id, a, b) { fs.renameSync(real(id, a), real(id, b)); },
    async setPassword(id) { get(id); },
    async sshx(id, action) { const v = get(id); if (action === 'start') v.sshx = 'https://sshx.io/s/mock-' + id.slice(0, 6) + '#demo'; if (action === 'stop') v.sshx = null; return { running: !!v.sshx, url: v.sshx }; },
    async destroy(id) { vps.delete(id); fs.rmSync(root(id), { recursive: true, force: true }); },
    async reinstall(v) { await this.destroy(v.id); return this.create(v); },
  };
};
