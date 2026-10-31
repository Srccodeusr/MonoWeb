import http, { IncomingMessage } from 'http';
import { config } from '../config';
import { log } from '../log';
import { assertImage } from '../safe';
import { Runtime, ServerSpec, PowerState, Stats, InstallOptions } from './types';

/**
 * Minimal Docker Engine API client over the unix socket (no dockerode dependency).
 * Podman exposes the same API on its own socket, so this class drives both.
 * Sandboxed OCI runtimes (gVisor `runsc`, Kata, Sysbox) are selected with OCI_RUNTIME.
 */
function request(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<{ status: number; data: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      socketPath: config.socket, method, path,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: timeoutMs,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data: any = raw;
        try { data = raw ? JSON.parse(raw) : {}; } catch { /* plain text */ }
        resolve({ status: res.statusCode || 0, data, raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Container engine timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function stream(method: string, path: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: config.socket, method, path }, res => resolve(res));
    req.on('error', reject);
    req.end();
  });
}

const name = (id: string) => `mono_${id}`;
const installerName = (id: string) => `mono_install_${id}`;

async function ensureImage(image: string, onLine?: (s: string) => void): Promise<void> {
  assertImage(image);
  const inspect = await request('GET', `/images/${encodeURI(image)}/json`);
  if (inspect.status === 200) return;
  onLine?.(`Pulling image ${image} ...`);
  const [from, tag] = image.includes(':') && !image.split('/').pop()!.includes('@') ? [image.slice(0, image.lastIndexOf(':')), image.slice(image.lastIndexOf(':') + 1)] : [image, 'latest'];
  const res = await stream('POST', `/images/create?fromImage=${encodeURIComponent(from)}&tag=${encodeURIComponent(tag)}`);
  await new Promise<void>((resolve, reject) => {
    let last = '';
    res.on('data', (c: Buffer) => {
      for (const line of c.toString().split('\n')) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          if (j.error) { reject(new Error(j.error)); return; }
          if (j.status && j.status !== last && !j.progress) { last = j.status; onLine?.(j.status); }
        } catch { /* ignore */ }
      }
    });
    res.on('end', resolve);
    res.on('error', reject);
  });
}

function hostConfig(spec: ServerSpec, dir: string): Record<string, unknown> {
  const mem = Math.max(64, spec.limits.ramMB) * 1024 * 1024;
  const portBindings: Record<string, { HostPort: string }[]> = {};
  for (const p of spec.ports) {
    const key = `${p.container}/${p.proto || 'tcp'}`;
    (portBindings[key] ||= []).push({ HostPort: String(p.host) });
  }
  const hc: Record<string, unknown> = {
    Binds: [`${dir}:/home/container`],
    PortBindings: portBindings,
    Memory: mem,
    MemorySwap: mem + Math.max(0, spec.limits.swapMB) * 1024 * 1024,
    NanoCpus: Math.round(Math.max(10, spec.limits.cpuPercent) / 100 * 1e9),
    PidsLimit: spec.limits.pids > 0 ? spec.limits.pids : 512,
    RestartPolicy: { Name: 'no' },
    // Hardening: drop every capability, then add back only what ordinary apps need.
    CapDrop: ['ALL'],
    CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE', 'FOWNER', 'NET_BIND_SERVICE'],
    SecurityOpt: ['no-new-privileges:true'],
    Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=128m' },
    Ulimits: [{ Name: 'nofile', Soft: 4096, Hard: 8192 }],
    LogConfig: { Type: 'json-file', Config: { 'max-size': '5m', 'max-file': '2' } },
    Privileged: false,
  };
  if (config.ociRuntime) hc.Runtime = config.ociRuntime;
  return hc;
}

export class DockerRuntime implements Runtime {
  constructor(public readonly name: 'docker' | 'podman' = 'docker') {}

  static async probe(): Promise<{ ok: boolean; podman: boolean; version?: string }> {
    try {
      const r = await request('GET', '/version', undefined, 3000);
      if (r.status !== 200) return { ok: false, podman: false };
      const podman = JSON.stringify(r.data?.Components || '').toLowerCase().includes('podman');
      return { ok: true, podman, version: r.data?.Version };
    } catch { return { ok: false, podman: false }; }
  }

  async info() {
    const r = await request('GET', '/info');
    return {
      engine: this.name, containers: r.data?.Containers, running: r.data?.ContainersRunning,
      images: r.data?.Images, ociRuntime: config.ociRuntime || r.data?.DefaultRuntime || 'default',
      runtimes: Object.keys(r.data?.Runtimes || {}), serverVersion: r.data?.ServerVersion,
    };
  }

  async start(spec: ServerSpec, dir: string): Promise<void> {
    await ensureImage(spec.image);
    await this.remove(spec.id);
    const exposed: Record<string, object> = {};
    for (const p of spec.ports) exposed[`${p.container}/${p.proto || 'tcp'}`] = {};
    const env = { ...spec.env, STARTUP: spec.startup, START: spec.startup };
    const created = await request('POST', `/containers/create?name=${name(spec.id)}`, {
      Image: spec.image,
      Hostname: 'mono',
      User: `${config.uid}:${config.gid}`,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      WorkingDir: '/home/container',
      Entrypoint: ['/bin/sh', '-c'],
      Cmd: [spec.startup],
      ExposedPorts: exposed,
      Tty: true, OpenStdin: true, AttachStdin: false, AttachStdout: false, AttachStderr: false,
      HostConfig: hostConfig(spec, dir),
      Labels: { 'mono.server': spec.id },
    });
    if (created.status >= 300) throw new Error(`create failed: ${created.data?.message || created.raw}`);
    const started = await request('POST', `/containers/${name(spec.id)}/start`);
    if (started.status >= 300 && started.status !== 304) throw new Error(`start failed: ${started.data?.message || started.raw}`);
  }

  async stop(spec: ServerSpec): Promise<void> {
    const st = await this.state(spec.id);
    if (st.state === 'offline') return;
    if (spec.stopCommand && spec.stopCommand !== '^C') await this.sendCommand(spec.id, spec.stopCommand).catch(() => undefined);
    const signal = spec.stopCommand === '^C' ? 'SIGINT' : 'SIGTERM';
    await request('POST', `/containers/${name(spec.id)}/stop?t=30&signal=${signal}`, undefined, 45_000);
  }

  async kill(id: string): Promise<void> {
    await request('POST', `/containers/${name(id)}/kill`);
  }

  async remove(id: string): Promise<void> {
    await request('DELETE', `/containers/${name(id)}?force=true&v=true`);
    await request('DELETE', `/containers/${installerName(id)}?force=true&v=true`);
  }

  async state(id: string): Promise<PowerState> {
    const r = await request('GET', `/containers/${name(id)}/json`, undefined, 8000).catch(() => null);
    if (!r || r.status !== 200) return { state: 'offline' };
    const s = r.data?.State || {};
    if (s.Running) return { state: 'running', startedAt: s.StartedAt };
    if (s.Status === 'created' || s.Restarting) return { state: 'starting' };
    return { state: 'offline', exitCode: s.ExitCode };
  }

  async stats(id: string, spec: ServerSpec): Promise<Stats> {
    const empty: Stats = { running: false, cpuPercent: 0, memBytes: 0, memLimit: spec.limits.ramMB * 1048576, netRx: 0, netTx: 0 };
    const st = await this.state(id);
    if (st.state !== 'running') return empty;
    const r = await request('GET', `/containers/${name(id)}/stats?stream=false&one-shot=false`, undefined, 10_000).catch(() => null);
    if (!r || r.status !== 200) return { ...empty, running: true };
    const d = r.data;
    const cpuDelta = (d.cpu_stats?.cpu_usage?.total_usage || 0) - (d.precpu_stats?.cpu_usage?.total_usage || 0);
    const sysDelta = (d.cpu_stats?.system_cpu_usage || 0) - (d.precpu_stats?.system_cpu_usage || 0);
    const cpus = d.cpu_stats?.online_cpus || 1;
    const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0; // fixes NaN/Infinity of the old daemon
    const cache = d.memory_stats?.stats?.inactive_file ?? d.memory_stats?.stats?.cache ?? 0;
    const nets = Object.values<any>(d.networks || {});
    return {
      running: true,
      cpuPercent: Number.isFinite(cpuPercent) ? Math.round(cpuPercent * 100) / 100 : 0,
      memBytes: Math.max(0, (d.memory_stats?.usage || 0) - cache),
      memLimit: d.memory_stats?.limit || spec.limits.ramMB * 1048576,
      netRx: nets.reduce((a, n) => a + (n.rx_bytes || 0), 0),
      netTx: nets.reduce((a, n) => a + (n.tx_bytes || 0), 0),
    };
  }

  sendCommand(id: string, command: string): Promise<void> {
    // Hijack an attach connection just long enough to write to the container's stdin.
    return new Promise((resolve, reject) => {
      const req = http.request({
        socketPath: config.socket, method: 'POST',
        path: `/containers/${name(id)}/attach?stream=1&stdin=1&stdout=0&stderr=0`,
        headers: { Connection: 'Upgrade', Upgrade: 'tcp' },
      });
      req.on('upgrade', (_res, socket) => {
        socket.write(command.replace(/[\r\n]+$/g, '') + '\n', () => { socket.end(); resolve(); });
      });
      req.on('response', res => { res.resume(); reject(new Error('Container is not accepting input')); });
      req.on('error', reject);
      req.setTimeout(8000, () => req.destroy(new Error('attach timeout')));
      req.end();
    });
  }

  logs(id: string, tail: number, onData: (c: string) => void, onEnd: () => void): () => void {
    let closed = false;
    let res: IncomingMessage | null = null;
    stream('GET', `/containers/${name(id)}/logs?follow=1&stdout=1&stderr=1&tail=${Math.min(Math.max(tail, 0), 1000)}`)
      .then(r => {
        if (closed) { r.destroy(); return; }
        res = r;
        if ((r.statusCode || 500) >= 300) { onEnd(); return; }
        r.on('data', (c: Buffer) => onData(c.toString('utf8')));
        r.on('end', onEnd);
        r.on('error', onEnd);
      }).catch(onEnd);
    return () => { closed = true; res?.destroy(); };
  }

  async install(o: InstallOptions, onLine: (l: string) => void): Promise<number> {
    await ensureImage(o.image, onLine);
    await request('DELETE', `/containers/${installerName(o.id)}?force=true`);
    const hc = hostConfig({ id: o.id, image: o.image, startup: '', stopCommand: '', env: {}, ports: [], limits: { ramMB: 1024, cpuPercent: 100, diskMB: 0, swapMB: 0, pids: 512 } }, o.dir);
    hc.Binds = [`${o.dir}:/mnt/server`];
    hc.CapAdd = ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE', 'FOWNER', 'KILL']; // installers (apt, tar) need a little more
    delete hc.Tmpfs;
    const created = await request('POST', `/containers/create?name=${installerName(o.id)}`, {
      Image: o.image, User: '0:0', Tty: true,
      Entrypoint: [o.entrypoint || 'bash', '-c', o.script.replace(/\r\n?/g, '\n')],
      Env: Object.entries(o.env).map(([k, v]) => `${k}=${v}`),
      HostConfig: hc, // default bridge network: the old daemon ran installers on the HOST network
    });
    if (created.status >= 300) throw new Error(`installer create failed: ${created.data?.message || created.raw}`);

    const logRes = await stream('GET', `/containers/${installerName(o.id)}/logs?follow=1&stdout=1&stderr=1`).catch(() => null);
    const start = await request('POST', `/containers/${installerName(o.id)}/start`);
    if (start.status >= 300) throw new Error(`installer start failed: ${start.data?.message || start.raw}`);
    let buf = '';
    logRes?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
      lines.forEach(l => l.trim() && onLine(l.replace(/[\x00-\x08\x0b-\x1f]/g, '')));
    });
    const waited = await request('POST', `/containers/${installerName(o.id)}/wait`, undefined, 30 * 60_000);
    logRes?.destroy();
    await request('DELETE', `/containers/${installerName(o.id)}?force=true&v=true`);
    return Number(waited.data?.StatusCode ?? 1);
  }

  async updateLimits(spec: ServerSpec): Promise<void> {
    const mem = Math.max(64, spec.limits.ramMB) * 1048576;
    const r = await request('POST', `/containers/${name(spec.id)}/update`, {
      Memory: mem, MemorySwap: mem + Math.max(0, spec.limits.swapMB) * 1048576,
      NanoCpus: Math.round(Math.max(10, spec.limits.cpuPercent) / 100 * 1e9),
      PidsLimit: spec.limits.pids > 0 ? spec.limits.pids : 512,
    });
    if (r.status >= 300 && r.status !== 404) log.warn(`live limit update failed for ${spec.id}: ${r.data?.message}`);
  }
}
