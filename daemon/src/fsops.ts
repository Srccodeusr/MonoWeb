import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { config } from './config';
import { HttpError, resolveInVolume, safeName, volumePath } from './safe';
import { usage as recycleUsage } from './recycle';

export interface Entry { name: string; type: 'file' | 'dir'; size: number; modified: string; mode: string }

const MAX_EDIT_BYTES = 5 * 1024 * 1024;

export function ensureVolume(id: string): string {
  const dir = volumePath(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  try { if (process.getuid?.() === 0) fs.chownSync(dir, config.uid, config.gid); } catch { /* not root */ }
  return dir;
}

export function list(id: string, rel: string): Entry[] {
  const dir = resolveInVolume(id, rel);
  if (!fs.statSync(dir).isDirectory()) throw new HttpError(400, 'Not a directory');
  const out: Entry[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isSymbolicLink()) continue; // never surface symlinks: they are the classic escape vector
    try {
      const st = fs.lstatSync(path.join(dir, d.name));
      out.push({ name: d.name, type: d.isDirectory() ? 'dir' : 'file', size: d.isDirectory() ? 0 : st.size, modified: st.mtime.toISOString(), mode: (st.mode & 0o777).toString(8) });
    } catch { /* raced with delete */ }
  }
  return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

function assertRegular(p: string): fs.Stats {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) throw new HttpError(400, 'Symlinks are not accessible');
  return st;
}

export function readText(id: string, rel: string): string {
  const p = resolveInVolume(id, rel);
  const st = assertRegular(p);
  if (!st.isFile()) throw new HttpError(400, 'Not a file');
  if (st.size > MAX_EDIT_BYTES) throw new HttpError(413, 'File too large to edit in the browser (max 5 MB)');
  return fs.readFileSync(p, 'utf8');
}

export function diskUsage(dir: string, cap = Infinity): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else { try { total += fs.lstatSync(p).size; } catch { /* gone */ } }
      if (total > cap) return total;
    }
  }
  return total;
}

function checkQuota(id: string, extra: number, limitMB: number): void {
  if (!limitMB) return;
  if (diskUsage(volumePath(id), limitMB * 1048576) + recycleUsage(id) + extra > limitMB * 1048576) throw new HttpError(507, 'Disk limit reached for this server');
}

export function writeText(id: string, rel: string, content: string, limitMB: number): void {
  if (typeof content !== 'string') throw new HttpError(400, 'content must be a string');
  const p = resolveInVolume(id, rel);
  if (fs.existsSync(p)) assertRegular(p);
  checkQuota(id, Buffer.byteLength(content), limitMB);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  chownMaybe(p);
}

export function upload(id: string, rel: string, name: string, data: Buffer, limitMB: number): void {
  const dir = resolveInVolume(id, rel);
  const p = path.join(dir, safeName(name));
  if (fs.existsSync(p)) assertRegular(p);
  checkQuota(id, data.length, limitMB);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, data);
  chownMaybe(p);
}

export function mkdir(id: string, rel: string, name: string): void {
  const p = path.join(resolveInVolume(id, rel), safeName(name));
  fs.mkdirSync(p, { recursive: true });
  chownMaybe(p);
}

export function rename(id: string, from: string, to: string): void {
  const a = resolveInVolume(id, from), b = resolveInVolume(id, to);
  if (a === volumePath(id) || !fs.existsSync(a)) throw new HttpError(404, 'Source not found');
  if (fs.existsSync(b)) throw new HttpError(409, 'Destination already exists');
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(a, b);
}

export function remove(id: string, paths: string[]): number {
  if (!Array.isArray(paths) || paths.length > 500) throw new HttpError(400, 'Invalid paths');
  let n = 0;
  const root = fs.realpathSync(volumePath(id));
  for (const rel of paths) {
    const p = resolveInVolume(id, rel);
    if (p === root) throw new HttpError(400, 'Refusing to delete the server root');
    fs.rmSync(p, { recursive: true, force: true }); n++;
  }
  return n;
}

export function filePath(id: string, rel: string): { p: string; size: number } {
  const p = resolveInVolume(id, rel);
  const st = assertRegular(p);
  if (!st.isFile()) throw new HttpError(400, 'Not a file');
  return { p, size: st.size };
}

export function chownTree(dir: string): Promise<void> {
  // Files extracted/downloaded by a root daemon must belong to the container user or the server cannot write to them.
  if (process.getuid?.() !== 0) return Promise.resolve();
  return run('chown', ['-R', `${config.uid}:${config.gid}`, dir]).then(() => undefined, () => undefined);
}

function chownMaybe(p: string): void {
  try { if (process.getuid?.() === 0) fs.chownSync(p, config.uid, config.gid); } catch { /* ignore */ }
}

/** Extract .zip/.tar.gz using system tools with traversal-safe flags; refuses archives that contain ../ or absolute paths. */
export async function extract(id: string, rel: string, destRel: string): Promise<void> {
  const archive = resolveInVolume(id, rel);
  const dest = resolveInVolume(id, destRel);
  assertRegular(archive);
  fs.mkdirSync(dest, { recursive: true });
  const isZip = /\.zip$/i.test(archive);
  const listCmd = isZip ? ['unzip', ['-Z1', archive]] : ['tar', ['-tzf', archive]];
  const names = await run(listCmd[0] as string, listCmd[1] as string[]);
  if (names.split('\n').some(n => n.startsWith('/') || n.split('/').includes('..'))) throw new HttpError(400, 'Archive contains unsafe paths');
  if (isZip) await run('unzip', ['-o', '-q', archive, '-d', dest]);
  else await run('tar', ['-xzf', archive, '-C', dest, '--no-same-owner', '--no-same-permissions']);
}

export function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (err += d));
    c.on('error', e => reject(new HttpError(500, `${cmd} unavailable: ${e.message}`)));
    c.on('exit', code => (code === 0 ? resolve(out) : reject(new HttpError(500, `${cmd} failed: ${err.slice(0, 200)}`))));
  });
}
