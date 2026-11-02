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

// ---------------------------------------------------------------------------------------------
// Move / copy / archive (the Pterodactyl-style file manager actions)
// ---------------------------------------------------------------------------------------------
const MAX_ITEMS = 500;

function isSameOrInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function sizeOfPath(p: string): number {
  const st = fs.lstatSync(p);
  return st.isDirectory() ? diskUsage(p) : st.size;
}
function needList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ITEMS || v.some(x => typeof x !== 'string')) throw new HttpError(400, 'Invalid paths');
  return v as string[];
}
function needDir(p: string, what: string): void {
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new HttpError(404, `${what} does not exist`);
}

/** Move files/folders into an existing folder. Everything is checked first, so a conflict never leaves a half-done move. */
export function moveItems(id: string, rels: unknown, destRel: unknown): number {
  const list = needList(rels);
  const root = fs.realpathSync(volumePath(id));
  const dest = resolveInVolume(id, destRel);
  needDir(dest, 'The destination folder');
  const seen = new Set<string>();
  const plan: { src: string; target: string }[] = [];
  for (const rel of list) {
    const src = resolveInVolume(id, rel);
    if (src === root) throw new HttpError(400, 'Refusing to move the server root');
    if (!fs.existsSync(src)) throw new HttpError(404, `${path.basename(src)} no longer exists`);
    const target = path.join(dest, path.basename(src));
    if (src === target) continue; // already there
    if (fs.statSync(src).isDirectory() && isSameOrInside(src, dest)) throw new HttpError(400, `Cannot move ${path.basename(src)} into itself`);
    if (fs.existsSync(target) || seen.has(target)) throw new HttpError(409, `${path.basename(src)} already exists in the destination`);
    seen.add(target); plan.push({ src, target });
  }
  for (const { src, target } of plan) fs.renameSync(src, target);
  return plan.length;
}

function freeCopyName(dir: string, name: string, isDir: boolean): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const dot = isDir ? -1 : name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, extn = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const c = `${stem} copy${n > 1 ? ' ' + n : ''}${extn}`;
    if (!fs.existsSync(path.join(dir, c))) return c;
  }
  throw new HttpError(409, 'Too many copies of this file');
}

/** Copy into `destRel` (default: next to the original, named "name copy"). Returns the new names. */
export async function copyItems(id: string, rels: unknown, destRel: unknown, limitMB: number): Promise<string[]> {
  const list = needList(rels);
  const root = fs.realpathSync(volumePath(id));
  const srcs = list.map(rel => {
    const src = resolveInVolume(id, rel);
    if (src === root) throw new HttpError(400, 'Refusing to copy the server root');
    if (!fs.existsSync(src)) throw new HttpError(404, `${path.basename(src)} no longer exists`);
    assertRegular(src);
    return src;
  });
  const dest = typeof destRel === 'string' && destRel ? resolveInVolume(id, destRel) : null;
  if (dest) needDir(dest, 'The destination folder');
  let total = 0;
  for (const s of srcs) {
    total += sizeOfPath(s);
    const dir = dest || path.dirname(s);
    if (fs.statSync(s).isDirectory() && isSameOrInside(s, dir) && dest) throw new HttpError(400, `Cannot copy ${path.basename(s)} into itself`);
  }
  checkQuota(id, total, limitMB);
  const made: string[] = [];
  for (const s of srcs) {
    const dir = dest || path.dirname(s);
    const isDir = fs.statSync(s).isDirectory();
    const name = freeCopyName(dir, path.basename(s), isDir);
    const target = path.join(dir, name);
    // a folder copied into its own parent folder must not recurse into the copy being made
    fs.cpSync(s, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true, filter: src => src !== target });
    await chownTree(target);
    made.push(name);
  }
  return made;
}

function cleanNames(dir: string, names: unknown): string[] {
  const list = needList(names).map(n => safeName(n));
  for (const n of list) if (!fs.existsSync(path.join(dir, n))) throw new HttpError(404, `${n} no longer exists`);
  return [...new Set(list)];
}

/** Create `<name>.tar.gz` in `dirRel` from the given child names. */
export async function archive(id: string, dirRel: unknown, names: unknown, archiveName: unknown, limitMB: number): Promise<string> {
  const dir = resolveInVolume(id, dirRel);
  needDir(dir, 'The folder');
  const list = cleanNames(dir, names);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17);
  let name = safeName(typeof archiveName === 'string' && archiveName.trim() ? archiveName.trim() : `archive-${stamp}`);
  if (!/\.tar\.gz$/i.test(name)) name += '.tar.gz';
  const out = path.join(dir, name);
  if (fs.existsSync(out)) throw new HttpError(409, `${name} already exists`);
  checkQuota(id, list.reduce((n, x) => n + sizeOfPath(path.join(dir, x)), 0), limitMB); // upper bound: compressed output is rarely larger
  try { await run('tar', ['-czf', out, '-C', dir, '--', ...list.map(n => './' + n)]); }
  catch (e) { fs.rmSync(out, { force: true }); throw e; }
  chownMaybe(out);
  return name;
}

/** Streams a tar.gz of the selected children to the caller (bulk download, nothing is written to the server's disk). */
export function spawnArchive(id: string, dirRel: unknown, names: unknown): { child: ReturnType<typeof spawn>; filename: string } {
  const dir = resolveInVolume(id, dirRel);
  needDir(dir, 'The folder');
  const list = cleanNames(dir, names);
  const base = path.basename(dir) === path.basename(volumePath(id)) ? 'files' : path.basename(dir);
  const child = spawn('tar', ['-czf', '-', '-C', dir, '--', ...list.map(n => './' + n)], { stdio: ['ignore', 'pipe', 'ignore'] });
  return { child, filename: `${base.replace(/[^\w.-]+/g, '_')}.tar.gz` };
}
