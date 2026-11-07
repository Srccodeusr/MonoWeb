'use strict';
// Docker runtime: every VPS is one container (name "monovps-<id>") built from an sshd-enabled base image.
//
// Changes vs 1.0.0:
//  * sshd: in addition to the original sed, a drop-in file (sshd_config.d/00-monovps.conf) forces root + password login, which also
//    survives distro images whose sshd_config is shipped differently. (1.0.0's sed itself worked on ubuntu/debian.)
//  * Image tag is versioned (":2-<hash of base>") so changing an image's base in the admin panel builds a fresh image.
//  * Concurrent first-time creates no longer start the same image build several times (build mutex).
//  * A failed create removes the half-created container instead of leaking it (and its SSH port).
//  * sshx stop/start: "pkill -f sshx" matched and killed its own wrapping `sh -c '... sshx ...'` before the log was removed, so the
//    panel kept showing a dead session as live. "pkill -x sshx" matches the process name only.
//  * File listing is NUL-delimited, so file names containing tabs/newlines no longer corrupt the listing.
//  * Stats are cached for 3 s (docker stats takes 1-2 s and the panel polls every few seconds).
const { execFile } = require('child_process');
const crypto = require('crypto');
const posix = require('path').posix;

const fs = require('fs');
const path = require('path');

// Image revision 3 = the MonoPanel ROM (rom/Dockerfile): Docker, Node.js, pm2, build tools, ptreodoctyl-install. Bump to force rebuilds.
const IMAGE_REV = '3';
const ROM_DIR = path.join(__dirname, '..', 'rom');
const OS = { 'ubuntu-20.04': 'ubuntu:20.04', 'ubuntu-22.04': 'ubuntu:22.04', 'ubuntu-24.04': 'ubuntu:24.04', 'debian-11': 'debian:11', 'debian-12': 'debian:12' };
const run = (args, o = {}) => new Promise((res, rej) => {
  const p = execFile('docker', args, { maxBuffer: o.maxBuffer || 8 * 1024 * 1024, timeout: o.timeout || 60000, encoding: 'buffer' }, (e, out, err) => {
    if (e && !o.soft) { const m = String(err || e.message).trim().split('\n').slice(-(o.tail || 1)).join(' | '); const x = new Error(m || 'docker failed'); x.out = out; return rej(x); }
    res({ out, text: out.toString('utf8'), err: err.toString('utf8'), code: e ? (e.code || 1) : 0 });
  });
  if (o.input !== undefined) p.stdin.end(o.input);
});
const name = id => `monovps-${id}`;
const safePath = p => { if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\0')) throw Object.assign(new Error('Path must be absolute'), { status: 400 }); return posix.normalize(p); };
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const safeTag = s => String(s).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40) || 'custom';

const builds = new Map();   // tag -> in-flight build promise

// Hash of everything in rom/ so editing the Dockerfile or any ROM script produces a new image tag (computed once per daemon start).
let romHashCache = null;
function romHash() {
  if (romHashCache) return romHashCache;
  const h = crypto.createHash('sha1');
  const walk = d => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n); const st = fs.statSync(f); if (st.isDirectory()) walk(f); else { h.update(path.relative(ROM_DIR, f)); h.update(fs.readFileSync(f)); } } };
  walk(ROM_DIR);
  return (romHashCache = h.digest('hex').slice(0, 6));
}

async function ensureImage(os, customBase) {
  const base = customBase || OS[os]; if (!base) throw Object.assign(new Error(`Unsupported image "${os}"`), { status: 400 });
  const hash = crypto.createHash('sha1').update(base).update(romHash()).digest('hex').slice(0, 6);
  const tag = `mono-vps/${safeTag(os)}:${IMAGE_REV}-${hash}`;
  if ((await run(['image', 'inspect', tag], { soft: true })).code === 0) return tag;
  if (builds.has(tag)) return builds.get(tag);
  // The panel waits up to 15 min for a create call, so the build must finish inside that.
  const p = run(['build', '-t', tag, '-f', path.join(ROM_DIR, 'Dockerfile'), '--build-arg', `BASE=${base}`, ROM_DIR],
    { timeout: 14 * 60000, maxBuffer: 64 * 1024 * 1024, tail: 4 }).then(() => tag).finally(() => builds.delete(tag));
  builds.set(tag, p); return p;
}
async function setPassword(id, pw) { await run(['exec', '-i', name(id), 'chpasswd'], { input: `root:${pw}\n` }); }

const statCache = new Map();    // id -> { at, val }

module.exports = (cfg) => ({
  kind: 'docker',
  /** Build the ROM image for the given OS ids in the background so the first customer does not wait for it. */
  async prebuild(list) { for (const os of list) { try { console.log(`[monovps] pre-building ROM image for ${os}...`); console.log(`[monovps] ready: ${await ensureImage(os)}`); } catch (e) { console.error(`[monovps] pre-build of ${os} failed: ${e.message}`); } } },

  async info() { const v = (await run(['version', '--format', '{{.Server.Version}}'])).text.trim(); return { runtime: 'docker', version: v }; },

  async create(v) {
    if ((await run(['inspect', '--format', '{{.Id}}', name(v.id)], { soft: true })).code === 0) throw Object.assign(new Error('A VPS with this id already exists on the node.'), { status: 409 });
    const tag = await ensureImage(v.image, v.base);
    const args = ['run', '-d', '--name', name(v.id), '--hostname', v.hostname || `vps-${v.id.slice(0, 6)}`, '--init', '--restart', 'unless-stopped',
      '--cpus', String(v.cpu || 1), '--memory', `${v.ramMb || 1024}m`, '--memory-swap', `${v.ramMb || 1024}m`, '--pids-limit', '1024',
      '-p', `${v.sshPort}:22`, '--label', 'monovps=1'];
    if (cfg.ociRuntime) args.push('--runtime', cfg.ociRuntime);
    else if (cfg.privileged) args.push('--privileged');   // opt-in (VPS_PRIVILEGED=true): lets Docker/Wings run inside the VPS, but root in the VPS can then escape to the host. Prefer sysbox-runc.
    let diskEnforced = !!v.diskGb;
    try {
      try { await run(v.diskGb ? [...args, '--storage-opt', `size=${v.diskGb}g`, tag] : [...args, tag]); }
      catch (e) { // storage-opt needs overlay2 on xfs+pquota; fall back to no hard disk quota
        if (v.diskGb && /storage-opt|quota|size/i.test(e.message)) { diskEnforced = false; await run(['rm', '-f', name(v.id)], { soft: true }); await run([...args, tag]); } else throw e;
      }
      await setPassword(v.id, v.rootPassword);
    } catch (e) { await run(['rm', '-f', '-v', name(v.id)], { soft: true }); throw e; }   // never leak a half-created container
    return { diskEnforced };
  },

  async power(id, action) {
    const a = { start: ['start'], stop: ['stop', '-t', '15'], restart: ['restart', '-t', '15'], kill: ['kill'] }[action];
    if (!a) throw Object.assign(new Error('Bad action'), { status: 400 });
    await run([a[0], ...a.slice(1), name(id)]); statCache.delete(id);
  },

  /** Live CPU / RAM limit change (docker update). Disk size cannot be changed on a running container. */
  async resize(id, { cpu, ramMb }) {
    await run(['update', '--cpus', String(cpu), '--memory', `${ramMb}m`, '--memory-swap', `${ramMb}m`, name(id)]);
  },

  async inspect(id) {
    const r = await run(['inspect', '--format', '{{json .State}}', name(id)], { soft: true });
    if (r.code) return { exists: false, status: 'missing' };
    const s = JSON.parse(r.text);
    return { exists: true, status: s.Running ? 'running' : 'offline', startedAt: s.Running ? s.StartedAt : null };
  },

  async list_all() {
    const r = await run(['ps', '-a', '--filter', 'label=monovps=1', '--format', '{{.Names}}\t{{.State}}'], { soft: true });
    return r.text.split('\n').filter(Boolean).map(l => { const [n, s] = l.split('\t'); return { id: n.replace(/^monovps-/, ''), status: s === 'running' ? 'running' : 'offline' }; });
  },

  async stats(id) {
    const hit = statCache.get(id); if (hit && Date.now() - hit.at < 3000) return hit.val;
    const st = await this.inspect(id);
    let val;
    if (st.status !== 'running') val = { ...st, cpuPct: 0, ramUsedMb: 0, diskUsedMb: 0, netRxMb: 0, netTxMb: 0 };
    else {
      const r = await run(['stats', '--no-stream', '--format', '{{json .}}', name(id)], { soft: true, timeout: 15000 });
      let j = {}; try { j = JSON.parse(r.text); } catch { /* ignore */ }
      const mb = s => { const m = /([\d.]+)\s*([KMGT]?i?B)/i.exec(s || ''); if (!m) return 0; return Number(m[1]) * ({ B: 1 / 1048576, KB: 1 / 1024, KIB: 1 / 1024, MB: 1, MIB: 1, GB: 1024, GIB: 1024, TB: 1048576, TIB: 1048576 }[m[2].toUpperCase()] || 0); };
      const [rx, tx] = String(j.NetIO || '').split('/');
      const df = await run(['exec', name(id), 'df', '-Pk', '/'], { soft: true });
      const used = Number((df.text.split('\n')[1] || '').split(/\s+/)[2] || 0) / 1024;
      val = { ...st, cpuPct: parseFloat(j.CPUPerc) || 0, ramUsedMb: Math.round(mb((j.MemUsage || '').split('/')[0])), diskUsedMb: Math.round(used), netRxMb: +mb(rx).toFixed(1), netTxMb: +mb(tx).toFixed(1) };
    }
    statCache.set(id, { at: Date.now(), val }); return val;
  },

  async logs(id, tail = 300) { const r = await run(['logs', '--tail', String(Math.min(2000, tail)), '--timestamps', name(id)], { soft: true }); return stripAnsi(r.text + r.err); },

  async exec(id, cmd, cwd = '/root') {
    const script = `${cmd}\n__rc=$?; printf '\\n__MONO_END__%s\\n%s' "$__rc" "$PWD"`;
    const r = await run(['exec', '-w', safePath(cwd), name(id), 'bash', '-c', script], { soft: true, timeout: 30000 });
    const full = stripAnsi((r.text + r.err).slice(0, 262144)); const i = full.lastIndexOf('\n__MONO_END__');
    if (i < 0) return { output: full || 'Command failed or timed out (30s limit). Use SSH or sshx for long-running programs.', code: r.code || 1, cwd };
    const [rc, pwd] = full.slice(i + 13).split('\n');
    return { output: full.slice(0, i), code: Number(rc) || 0, cwd: pwd || cwd };
  },

  async list(id, p) {
    const d = safePath(p);
    const r = await run(['exec', name(id), 'find', d, '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\t%s\\t%T@\\t%f\\0']);
    return r.text.split('\0').filter(Boolean).map(l => {
      const [t, s, m, ...n] = l.split('\t');
      const modified = Math.round(Number(m) * 1000);
      return { name: n.join('\t'), dir: t === 'd', link: t === 'l', size: Number(s) || 0, modified: Number.isFinite(modified) ? modified : 0 };
    }).filter(f => f.name).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  },
  async read(id, p) {
    const f = safePath(p); const sz = Number((await run(['exec', name(id), 'stat', '-c', '%s', f])).text);
    if (sz > 2 * 1024 * 1024) throw Object.assign(new Error('File is larger than 2 MB. Use SSH/SFTP instead.'), { status: 413 });
    return (await run(['exec', name(id), 'cat', '--', f])).text;
  },
  async write(id, p, content) { await run(['exec', '-i', name(id), 'sh', '-c', 'cat > "$1"', 'sh', safePath(p)], { input: content }); },
  async mkdir(id, p) { await run(['exec', name(id), 'mkdir', '-p', '--', safePath(p)]); },
  async remove(id, p) { const f = safePath(p); if (f === '/') throw Object.assign(new Error('Refusing to delete /'), { status: 400 }); await run(['exec', name(id), 'rm', '-rf', '--', f]); },
  async rename(id, a, b) { await run(['exec', name(id), 'mv', '--', safePath(a), safePath(b)]); },
  setPassword,

  async sshx(id, action) {
    const c = name(id), log = '/tmp/sshx.log';
    // "-x" matches the process NAME exactly. The old "pkill -f sshx" also matched the wrapping `sh -c '... sshx ...'` and killed it before the log was removed.
    const kill = 'pkill -x sshx; rm -f /tmp/sshx.log; true';
    if (action === 'stop') { await run(['exec', c, 'sh', '-c', kill], { soft: true }); return { running: false, url: null }; }
    if (action === 'start') {
      await run(['exec', c, 'sh', '-c', kill], { soft: true });
      await run(['exec', '-d', c, 'sh', '-c', `curl -sSf https://sshx.io/get | sh -s run > ${log} 2>&1`], { soft: true });
      for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 1000)); const u = await this.sshx(id, 'status'); if (u.url) return u; }
      throw Object.assign(new Error('sshx did not return a link. Does the VPS have internet access?'), { status: 504 });
    }
    const r = await run(['exec', c, 'cat', log], { soft: true });
    const alive = (await run(['exec', c, 'pgrep', '-x', 'sshx'], { soft: true })).code === 0;
    const m = /https:\/\/sshx\.io\/s\/[^\s]+/.exec(stripAnsi(r.text));
    return { running: !!m && alive, url: m && alive ? m[0] : null };
  },

  async destroy(id) { await run(['rm', '-f', '-v', name(id)], { soft: true }); statCache.delete(id); },
  async reinstall(v) { await this.destroy(v.id); return this.create(v); },
});
