import os from 'os';
import fs from 'fs';
import path from 'path';
import { route, openSse, MB, Ctx } from './http';
import { config } from './config';
import { log } from './log';
import { HttpError, assertId, assertImage, assertPublicUrl, resolveInVolume, safeName, validateEnv, validatePorts, volumePath } from './safe';
import { getRuntime } from './runtime';
import { ServerSpec, Limits } from './runtime/types';
import * as store from './state';
import * as fsops from './fsops';
import * as recycle from './recycle';
import * as backup from './backup';
import { safeDownload } from './download';
import * as transfer from './transfer';
import * as addons from './addons';

const num = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

function buildSpec(id: string, b: any, prev?: ServerSpec | null): ServerSpec {
  const l = b?.limits || {};
  const limits: Limits = {
    ramMB: num(l.ramMB, 16, 1_048_576, prev?.limits.ramMB ?? 512),
    cpuPercent: num(l.cpuPercent, 5, 6400, prev?.limits.cpuPercent ?? 100),
    diskMB: num(l.diskMB, 0, 100_000_000, prev?.limits.diskMB ?? 1024),
    swapMB: num(l.swapMB, 0, 1_048_576, prev?.limits.swapMB ?? 0),
    pids: num(l.pids, 16, 4096, prev?.limits.pids ?? 512),
  };
  const image = typeof b?.image === 'string' && b.image ? assertImage(b.image) : (prev?.image || '');
  const startup = typeof b?.startup === 'string' ? b.startup : prev?.startup || '';
  if (startup.length > 4096 || startup.includes('\0')) throw new HttpError(400, 'Invalid startup command');
  const stopCommand = typeof b?.stopCommand === 'string' ? b.stopCommand.slice(0, 128) : prev?.stopCommand ?? 'stop';
  const sftp = b?.sftp !== undefined ? validateSftp(b.sftp) : prev?.sftp || [];
  return { id, image, startup, stopCommand, env: b?.env !== undefined ? validateEnv(b.env) : prev?.env || {}, ports: b?.ports !== undefined ? validatePorts(b.ports) : prev?.ports || [], limits, sftp };
}

function validateSftp(v: unknown): NonNullable<ServerSpec['sftp']> {
  if (!Array.isArray(v) || v.length > 32) throw new HttpError(400, 'Invalid sftp list');
  return v.map(c => {
    if (typeof c?.username !== 'string' || !/^[A-Za-z0-9._-]{1,64}\.[a-f0-9]{8}$/.test(c.username)) throw new HttpError(400, 'Invalid sftp username');
    if (typeof c?.hash !== 'string' || !/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(c.hash)) throw new HttpError(400, 'Invalid sftp hash');
    return { username: c.username, hash: c.hash, readOnly: !!c.readOnly };
  });
}

function needSpec(id: string): ServerSpec {
  const s = store.loadSpec(assertId(id));
  if (!s) throw new HttpError(404, 'Server is not registered on this node');
  return s;
}

const installing = new Set<string>();
const diskExceeded = new Set<string>();

export function registerRoutes(): void {
  route('GET', '/v1/ping', async () => {
    const rt = await getRuntime();
    return { ok: true, version: config.version, runtime: rt.name, runtimeInfo: await rt.info(), platform: process.platform, arch: process.arch, hostname: os.hostname(), tls: !!config.tlsCert, portRange: [config.portMin, config.portMax] };
  });

  route('GET', '/v1/system', () => {
    const total = os.totalmem(), free = os.freemem();
    let diskTotal = 0, diskFree = 0;
    try { const s = fs.statfsSync(config.volumesDir); diskTotal = s.blocks * s.bsize; diskFree = s.bavail * s.bsize; } catch { /* unsupported */ }
    return { cpus: os.cpus().length, load: os.loadavg(), memTotal: total, memFree: free, diskTotal, diskFree, uptime: os.uptime(), servers: store.listSpecs().length };
  });

  // ---- lifecycle -------------------------------------------------------------------------------
  route('PUT', '/v1/servers/:id', async ({ params, body }) => {
    const id = assertId(params.id);
    const spec = buildSpec(id, body, store.loadSpec(id));
    fsops.ensureVolume(id);
    store.saveSpec(spec);
    await (await getRuntime()).updateLimits(spec).catch(() => undefined);
    return { ok: true, spec };
  });

  route('DELETE', '/v1/servers/:id', async ({ params }) => {
    const id = assertId(params.id);
    const rt = await getRuntime();
    await rt.remove(id);
    const dir = volumePath(id); // validated: can no longer be ../..
    fs.rmSync(dir, { recursive: true, force: true });
    backup.deleteAllBackups(id); recycle.removeBin(id);
    store.deleteSpec(id); store.clearInstall(id); diskExceeded.delete(id);
    return { ok: true };
  });

  route('GET', '/v1/servers/:id/state', async ({ params }) => {
    const id = assertId(params.id);
    const rt = await getRuntime();
    const spec = store.loadSpec(id);
    return { power: await rt.state(id), install: store.getInstall(id), registered: !!spec, diskExceeded: diskExceeded.has(id) };
  });

  route('POST', '/v1/servers/:id/install', async ({ params, body }) => {
    const id = assertId(params.id);
    const spec = needSpec(id);
    if (installing.has(id)) throw new HttpError(409, 'Install already running');
    const rt = await getRuntime();
    const image = typeof body.image === 'string' && body.image ? assertImage(body.image) : spec.image;
    const script = typeof body.script === 'string' ? body.script : '';
    if (script.length > 256 * 1024) throw new HttpError(413, 'Install script too large');
    const entrypoint = ['bash', 'sh', 'ash'].includes(body.entrypoint) ? body.entrypoint : 'bash';
    const env = validateEnv(body.env);
    const files: { url: string; path: string }[] = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
    const dir = fsops.ensureVolume(id);

    installing.add(id);
    store.setInstall(id, 'installing', 'Install started');
    void (async () => {
      try {
        for (const f of files) {
          const target = path.join(resolveInVolume(id, path.posix.dirname('/' + String(f.path || ''))), safeName(path.posix.basename(String(f.path || ''))));
          store.setInstall(id, 'installing', `Downloading ${path.basename(target)}`);
          await safeDownload(String(f.url), target, 512 * MB);
        }
        if (script.trim()) {
          const code = await rt.install({ id, dir, image: image || spec.image, script, entrypoint, env }, line => store.setInstall(id, 'installing', line));
          if (code !== 0) throw new Error(`Install script exited with code ${code}`);
        }
        store.setInstall(id, 'installed', 'Installation complete');
      } catch (e: any) {
        log.warn(`Install failed for ${id}: ${e?.message}`);
        store.setInstall(id, 'failed', e?.message || 'Install failed');
      } finally { installing.delete(id); }
    })();
    return { ok: true, state: 'installing' };
  });

  route('POST', '/v1/servers/:id/power', async ({ params, body }) => {
    const id = assertId(params.id);
    const spec = needSpec(id);
    const rt = await getRuntime();
    const action = String(body.action);
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) throw new HttpError(400, 'Invalid action');
    const inst = store.getInstall(id);
    if ((action === 'start' || action === 'restart') && inst?.state === 'installing') throw new HttpError(409, 'Server is still installing');
    if ((action === 'start' || action === 'restart') && inst?.state === 'failed') throw new HttpError(409, 'Installation failed. Reinstall the server first.');
    if (action === 'start' || action === 'restart') {
      if (spec.limits.diskMB && fsops.diskUsage(volumePath(id), spec.limits.diskMB * MB) > spec.limits.diskMB * MB) {
        diskExceeded.add(id);
        throw new HttpError(507, 'Disk limit exceeded. Free up space before starting.');
      }
      diskExceeded.delete(id);
      if (!spec.startup.trim()) throw new HttpError(400, 'No startup command configured');
    }
    if (action === 'start' && (await rt.state(id)).state === 'running') return { ok: true, action, already: true }; // idempotent: never restarts a running server by accident
    if (action === 'stop' || action === 'restart') await rt.stop(spec);
    if (action === 'kill') await rt.kill(id);
    if (action === 'start' || action === 'restart') await rt.start(spec, fsops.ensureVolume(id));
    return { ok: true, action };
  }, 64 * 1024);

  route('POST', '/v1/servers/:id/command', async ({ params, body }) => {
    const id = assertId(params.id);
    needSpec(id);
    const cmd = String(body.command ?? '');
    if (!cmd.trim() || cmd.length > 2048 || cmd.includes('\0')) throw new HttpError(400, 'Invalid command');
    await (await getRuntime()).sendCommand(id, cmd);
    return { ok: true };
  });

  route('GET', '/v1/servers/:id/stats', async ({ params }) => {
    const id = assertId(params.id);
    const spec = needSpec(id);
    const rt = await getRuntime();
    const s = await rt.stats(id, spec);
    const disk = fsops.diskUsage(volumePath(id)) + recycle.usage(id); // the recycle bin counts towards the limit
    return { ...s, diskBytes: disk, diskLimit: spec.limits.diskMB * MB };
  });

  route('GET', '/v1/servers/:id/logs', async ({ params, query, req, res }) => {
    const id = assertId(params.id);
    needSpec(id);
    const rt = await getRuntime();
    const send = openSse(res);
    const stopStream = rt.logs(id, Number(query.get('tail') || 200), chunk => send('log', JSON.stringify(chunk)), () => { send('end', '1'); res.end(); });
    const beat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(beat); stopStream(); });
  });

  // ---- files -----------------------------------------------------------------------------------
  const limitMB = (id: string) => needSpec(id).limits.diskMB;

  route('GET', '/v1/servers/:id/files', ({ params, query }) => ({ path: query.get('path') || '/', entries: fsops.list(assertId(params.id), query.get('path') || '/') }));
  route('GET', '/v1/servers/:id/files/content', ({ params, query }) => ({ content: fsops.readText(assertId(params.id), query.get('path') || '') }));
  route('PUT', '/v1/servers/:id/files/content', ({ params, body }) => { fsops.writeText(assertId(params.id), body.path, body.content, limitMB(params.id)); return { ok: true }; }, 8 * MB);
  route('POST', '/v1/servers/:id/files/mkdir', ({ params, body }) => { fsops.mkdir(assertId(params.id), body.path || '/', body.name); return { ok: true }; });
  route('POST', '/v1/servers/:id/files/rename', ({ params, body }) => { fsops.rename(assertId(params.id), body.from, body.to); return { ok: true }; });
  route('POST', '/v1/servers/:id/files/delete', ({ params, body }) => ({ ok: true, deleted: body.permanent === true ? fsops.remove(assertId(params.id), body.paths) : recycle.moveToBin(assertId(params.id), body.paths) }));
  route('POST', '/v1/servers/:id/files/pull', async ({ params, body }) => {
    const id = assertId(params.id); const spec = needSpec(id);
    const dir = resolveInVolume(id, body.path || '/');
    const url = await assertPublicUrl(String(body.url || ''));
    const guess = (() => { try { return decodeURIComponent(path.posix.basename(url.pathname)); } catch { return ''; } })();
    const name = safeName(String(body.name || guess || 'download'));
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) throw new HttpError(409, `${name} already exists in that folder`);
    fs.mkdirSync(dir, { recursive: true });
    const used = fsops.diskUsage(volumePath(id)) + recycle.usage(id);
    const room = spec.limits.diskMB ? Math.max(0, spec.limits.diskMB * MB - used) : 512 * MB;
    if (!room) throw new HttpError(507, 'Disk limit reached for this server');
    await safeDownload(url.toString(), dest, Math.min(room, 512 * MB));
    await fsops.chownTree(dest);
    return { ok: true, name, size: fs.statSync(dest).size };
  }, 64 * 1024);

  route('POST', '/v1/servers/:id/files/move', ({ params, body }) => { const id = assertId(params.id); needSpec(id); return { ok: true, moved: fsops.moveItems(id, body.paths, body.dest) }; });
  route('POST', '/v1/servers/:id/files/copy', async ({ params, body }) => { const id = assertId(params.id); const spec = needSpec(id); return { ok: true, names: await fsops.copyItems(id, body.paths, body.dest, spec.limits.diskMB) }; });
  route('POST', '/v1/servers/:id/files/archive', async ({ params, body }) => { const id = assertId(params.id); const spec = needSpec(id); return { ok: true, name: await fsops.archive(id, body.path || '/', body.names, body.name, spec.limits.diskMB) }; }, 64 * 1024);
  route('POST', '/v1/servers/:id/files/bulk-download', ({ params, body, req, res }) => {
    const id = assertId(params.id); needSpec(id);
    const { child, filename } = fsops.spawnArchive(id, body.path || '/', body.names);
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff' });
    child.stdout!.pipe(res);
    child.on('error', () => res.destroy());
    req.on('close', () => { if (!child.killed) child.kill('SIGKILL'); });
  });

  // ---- recycle bin -----------------------------------------------------------------------------
  route('GET', '/v1/servers/:id/recycle', ({ params }) => { const id = assertId(params.id); needSpec(id); return { retentionDays: recycle.RETENTION_DAYS, items: recycle.list(id) }; });
  route('POST', '/v1/servers/:id/recycle/restore', ({ params, body }) => { const id = assertId(params.id); needSpec(id); return { ok: true, restored: recycle.restore(id, body.ids, body.all === true) }; });
  route('POST', '/v1/servers/:id/recycle/purge', ({ params, body }) => { const id = assertId(params.id); needSpec(id); return { ok: true, purged: recycle.purge(id, body.ids, body.all === true) }; });
  route('POST', '/v1/servers/:id/files/extract', async ({ params, body }) => { await fsops.extract(assertId(params.id), body.path, body.dest || '/'); return { ok: true }; });
  route('POST', '/v1/servers/:id/files/upload', ({ params, body }) => {
    const data = Buffer.from(String(body.data || ''), 'base64');
    if (!data.length) throw new HttpError(400, 'Empty upload');
    fsops.upload(assertId(params.id), body.path || '/', body.name, data, limitMB(params.id));
    return { ok: true, size: data.length };
  }, 40 * MB);
  route('GET', '/v1/servers/:id/files/download', ({ params, query, res }) => {
    const { p, size } = fsops.filePath(assertId(params.id), query.get('path') || '');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Content-Disposition': `attachment; filename="${path.basename(p).replace(/["\r\n]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(p).pipe(res);
  });

  // ---- addons ----------------------------------------------------------------------------------
  route('POST', '/v1/servers/:id/addon/install', async ({ params, body }) => {
    const id = assertId(params.id); const spec = needSpec(id);
    const paths = await addons.installFiles(id, body.files, spec.limits.diskMB);
    return { ok: true, paths };
  });
  route('POST', '/v1/servers/:id/addon/remove', ({ params, body }) => { const id = assertId(params.id); needSpec(id); return { ok: true, removed: addons.removePaths(id, body.paths) }; });

  // ---- node-to-node transfer -------------------------------------------------------------------
  route('POST', '/v1/servers/:id/transfer/prepare', async ({ params }) => {
    const id = assertId(params.id); needSpec(id);
    if ((await (await getRuntime()).state(id)).state !== 'offline') throw new HttpError(409, 'Stop the server before transferring it');
    return transfer.prepareExport(id);
  });
  route('GET', '/v1/servers/:id/transfer/:fileId', ({ params, res }) => {
    assertId(params.id);
    const { stream, size } = transfer.exportStream(params.fileId);
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': size });
    stream.pipe(res);
  });
  route('DELETE', '/v1/servers/:id/transfer/:fileId', ({ params }) => { assertId(params.id); transfer.deleteExport(params.fileId); return { ok: true }; });
  route('PUT', '/v1/servers/:id/transfer', async ({ params, query, req }) => {
    const id = assertId(params.id); needSpec(id);
    await transfer.importArchive(id, req, String(query.get('sha256') || ''), Number(query.get('size')));
    return { ok: true };
  }, 0, { stream: true });

  // ---- backups ---------------------------------------------------------------------------------
  route('POST', '/v1/servers/:id/backups', async ({ params, body }) => backup.createBackup(assertId(params.id), num(body.maxBytes, 0, Number.MAX_SAFE_INTEGER, 0)));
  route('POST', '/v1/servers/:id/backups/:backupId/restore', async ({ params }) => {
    const id = assertId(params.id);
    const spec = needSpec(id);
    const rt = await getRuntime();
    if ((await rt.state(id)).state !== 'offline') await rt.stop(spec);
    await backup.restoreBackup(id, params.backupId);
    return { ok: true };
  });
  route('DELETE', '/v1/servers/:id/backups/:backupId', ({ params }) => { backup.deleteBackup(assertId(params.id), params.backupId); return { ok: true }; });
  route('GET', '/v1/servers/:id/backups/:backupId/download', ({ params, res }) => {
    const { stream, size } = backup.backupStream(assertId(params.id), params.backupId);
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': size, 'Content-Disposition': `attachment; filename="${params.backupId}.tar.gz"` });
    stream.pipe(res);
  });
}

/** Periodic disk-quota enforcement (containers cannot portably enforce disk, so we do). */
export function startWatchdogs(): void {
  setInterval(async () => {
    try {
      const rt = await getRuntime();
      for (const spec of store.listSpecs()) {
        if (!spec.limits.diskMB) continue;
        const st = await rt.state(spec.id);
        if (st.state !== 'running') continue;
        if (fsops.diskUsage(volumePath(spec.id), spec.limits.diskMB * MB * 1.1) > spec.limits.diskMB * MB * 1.1) {
          diskExceeded.add(spec.id);
          log.warn(`Server ${spec.id} exceeded its disk limit; stopping`);
          await rt.stop(spec).catch(() => rt.kill(spec.id));
        }
      }
    } catch (e) { log.error('disk watchdog', e); }
  }, 60_000).unref();
}
export type { Ctx };
