import { spawn, spawnSync, ChildProcess, execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { log } from '../log';
import { Runtime, ServerSpec, PowerState, Stats, InstallOptions } from './types';

/**
 * Native process runtime for hosts that cannot run a container engine
 * (OpenVZ / LXC / Termux / very small VPS / nested virtualisation without privileges).
 *
 * Isolation, strongest available first:
 *   1. bubblewrap (bwrap): private PID/IPC/UTS namespaces, read-only system dirs, only the server volume writable
 *   2. plain process in its own process group with a scrubbed environment (+ ulimit)
 * Memory is enforced by a watchdog that sums RSS of the process group and kills the group when it exceeds the plan.
 */
interface Live {
  child: ChildProcess;
  bus: EventEmitter;
  ring: string[];
  startedAt: string;
  exitCode?: number;
  killedForMemory?: boolean;
}

const live = new Map<string, Live>();
const RING_MAX = 2000;

function hasBin(bin: string): boolean {
  try { return spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 3000 }).status !== null; } catch { return false; }
}

function sandboxMode(): 'bwrap' | 'none' {
  if (config.processSandbox === 'none') return 'none';
  if (process.platform !== 'linux') return 'none';
  const ok = hasBin('bwrap');
  if (config.processSandbox === 'bwrap' && !ok) throw new Error('PROCESS_SANDBOX=bwrap but bubblewrap is not installed');
  return ok ? 'bwrap' : 'none';
}

function bwrapArgs(dir: string, cmd: string): string[] {
  const ro = ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/etc/ssl', '/etc/ca-certificates', '/etc/alternatives', '/opt']
    .filter(p => fs.existsSync(p));
  const args = ['--die-with-parent', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--new-session', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  for (const p of ro) args.push('--ro-bind', p, p);
  for (const f of ['/etc/resolv.conf', '/etc/hosts', '/etc/passwd', '/etc/group', '/etc/nsswitch.conf', '/etc/localtime'])
    if (fs.existsSync(f)) args.push('--ro-bind', f, f);
  args.push('--bind', dir, '/home/container', '--chdir', '/home/container', '--', '/bin/sh', '-c', cmd);
  return args;
}

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/home/container', LANG: 'C.UTF-8', TERM: 'xterm', USER: 'container',
    ...extra, // never inherit the daemon's own environment (it holds DAEMON_SECRET)
  };
}

function psTable(): { pid: number; pgid: number; rssKb: number; cpu: number }[] {
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,pgid=,rss=,pcpu='], { encoding: 'utf8', timeout: 4000 });
    return out.split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length === 4).map(p => ({ pid: +p[0], pgid: +p[1], rssKb: +p[2], cpu: +p[3] }));
  } catch { return []; }
}

function groupUsage(pid: number): { rssBytes: number; cpu: number } {
  const rows = psTable().filter(r => r.pgid === pid || r.pid === pid);
  return { rssBytes: rows.reduce((a, r) => a + r.rssKb * 1024, 0), cpu: rows.reduce((a, r) => a + r.cpu, 0) };
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
}

export class ProcessRuntime implements Runtime {
  readonly name = 'process';
  private watchdog: NodeJS.Timeout;

  constructor() {
    // Memory watchdog: the only portable way to enforce RAM without cgroup delegation.
    this.watchdog = setInterval(() => {
      for (const [id, l] of live) {
        if (l.exitCode !== undefined || !l.child.pid) continue;
        const limit = (l as any).limitBytes as number | undefined;
        if (!limit) continue;
        const { rssBytes } = groupUsage(l.child.pid);
        if (rssBytes > limit * 1.05) {
          l.killedForMemory = true;
          this.push(l, `\r\n[mono] Memory limit exceeded (${Math.round(rssBytes / 1048576)} MB > ${Math.round(limit / 1048576)} MB). Server killed.\r\n`);
          log.warn(`Server ${id} killed: memory limit`);
          killGroup(l.child.pid, 'SIGKILL');
        }
      }
    }, 3000);
    this.watchdog.unref();
  }

  async info() { return { engine: 'process', sandbox: sandboxMode(), platform: process.platform }; }

  private push(l: Live, text: string): void {
    for (const line of text.split(/(?<=\n)/)) {
      l.ring.push(line);
      if (l.ring.length > RING_MAX) l.ring.shift();
    }
    l.bus.emit('data', text);
  }

  async start(spec: ServerSpec, dir: string): Promise<void> {
    const existing = live.get(spec.id);
    if (existing && existing.exitCode === undefined) throw new Error('Server is already running');
    const cmd = spec.startup;
    const mode = sandboxMode();
    const env = cleanEnv({ ...spec.env, STARTUP: spec.startup });
    const ulimit = `ulimit -u ${spec.limits.pids > 0 ? spec.limits.pids : 512} 2>/dev/null; ulimit -n 4096 2>/dev/null; `;
    let child: ChildProcess;
    if (mode === 'bwrap') {
      child = spawn('bwrap', bwrapArgs(dir, ulimit + cmd), { env, cwd: dir, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      child = spawn('/bin/sh', ['-c', ulimit + cmd], { env: { ...env, HOME: dir }, cwd: dir, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    const l: Live = { child, bus: new EventEmitter(), ring: existing?.ring.slice(-200) || [], startedAt: new Date().toISOString() };
    (l as any).limitBytes = Math.max(64, spec.limits.ramMB) * 1048576;
    l.bus.setMaxListeners(50);
    live.set(spec.id, l);
    this.push(l, `[mono] Starting (${mode === 'bwrap' ? 'bubblewrap sandbox' : 'process runtime, no namespace sandbox'})\r\n`);
    child.stdout?.on('data', (c: Buffer) => this.push(l, c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => this.push(l, c.toString('utf8')));
    child.stdin?.on('error', () => undefined);
    child.on('exit', code => {
      l.exitCode = code ?? (l.killedForMemory ? 137 : 1);
      this.push(l, `\r\n[mono] Process exited with code ${l.exitCode}\r\n`);
      l.bus.emit('end');
    });
    child.on('error', err => { this.push(l, `[mono] Failed to start: ${err.message}\r\n`); l.exitCode = 127; l.bus.emit('end'); });
  }

  async stop(spec: ServerSpec): Promise<void> {
    const l = live.get(spec.id);
    if (!l || l.exitCode !== undefined || !l.child.pid) return;
    const pid = l.child.pid;
    if (spec.stopCommand && spec.stopCommand !== '^C') l.child.stdin?.write(spec.stopCommand + '\n');
    else killGroup(pid, 'SIGINT');
    const exited = await new Promise<boolean>(resolve => {
      const t = setTimeout(() => resolve(false), 30_000);
      l.child.once('exit', () => { clearTimeout(t); resolve(true); });
    });
    if (!exited) { killGroup(pid, 'SIGTERM'); await new Promise(r => setTimeout(r, 5000)); if (l.exitCode === undefined) killGroup(pid, 'SIGKILL'); }
  }

  async kill(id: string): Promise<void> {
    const l = live.get(id);
    if (l?.child.pid && l.exitCode === undefined) killGroup(l.child.pid, 'SIGKILL');
  }

  async remove(id: string): Promise<void> {
    await this.kill(id);
    live.delete(id);
  }

  async state(id: string): Promise<PowerState> {
    const l = live.get(id);
    if (!l) return { state: 'offline' };
    if (l.exitCode === undefined) return { state: 'running', startedAt: l.startedAt };
    return { state: 'offline', exitCode: l.exitCode };
  }

  async stats(id: string, spec: ServerSpec): Promise<Stats> {
    const l = live.get(id);
    const limit = spec.limits.ramMB * 1048576;
    if (!l || l.exitCode !== undefined || !l.child.pid) return { running: false, cpuPercent: 0, memBytes: 0, memLimit: limit, netRx: 0, netTx: 0 };
    const u = groupUsage(l.child.pid);
    return { running: true, cpuPercent: Math.round(u.cpu * 100) / 100, memBytes: u.rssBytes, memLimit: limit, netRx: 0, netTx: 0 };
  }

  async sendCommand(id: string, command: string): Promise<void> {
    const l = live.get(id);
    if (!l || l.exitCode !== undefined || !l.child.stdin?.writable) throw new Error('Server is not running');
    l.child.stdin.write(command.replace(/[\r\n]+$/g, '') + '\n');
  }

  logs(id: string, tail: number, onData: (c: string) => void, onEnd: () => void): () => void {
    const l = live.get(id);
    if (!l) { onEnd(); return () => undefined; }
    const backlog = l.ring.slice(-Math.min(Math.max(tail, 0), RING_MAX)).join('');
    if (backlog) onData(backlog);
    const d = (c: string) => onData(c);
    l.bus.on('data', d);
    l.bus.once('end', onEnd);
    return () => { l.bus.off('data', d); l.bus.off('end', onEnd); };
  }

  async install(o: InstallOptions, onLine: (l: string) => void): Promise<number> {
    // Installer scripts are written for containers (target dir /mnt/server). Rewrite to the volume path.
    const script = o.script.replace(/\r\n?/g, '\n').split('/mnt/server').join(o.dir);
    const mode = sandboxMode();
    const env = cleanEnv({ ...o.env, SERVER_DIR: o.dir });
    onLine(`[mono] Running install script natively (${mode === 'bwrap' ? 'sandboxed' : 'unsandboxed'})`);
    return new Promise<number>(resolve => {
      const bin = ['bash', 'sh'].includes(o.entrypoint) ? o.entrypoint : 'sh';
      const child = mode === 'bwrap'
        ? spawn('bwrap', [...bwrapArgs(o.dir, script).slice(0, -3), '/bin/' + bin, '-c', script], { env, cwd: o.dir, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn(bin, ['-c', script], { env, cwd: o.dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '';
      const feed = (c: Buffer) => {
        buf += c.toString('utf8');
        const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
        lines.forEach(x => x.trim() && onLine(x));
      };
      child.stdout?.on('data', feed); child.stderr?.on('data', feed);
      const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60_000);
      child.on('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
      child.on('error', e => { onLine(`[mono] ${e.message}`); resolve(127); });
    });
  }

  async updateLimits(spec: ServerSpec): Promise<void> {
    const l = live.get(spec.id);
    if (l) (l as any).limitBytes = Math.max(64, spec.limits.ramMB) * 1048576;
  }
}
