import fs from 'fs';
import path from 'path';
import { config } from './config';
import { MB } from './http';
import { resolveInVolume, volumePath, HttpError } from './safe';
import { diskUsage } from './fsops';

/**
 * Filesystem semantics for one SFTP session, confined to ONE server volume.
 * Independent of the SSH library so it can be tested directly.
 */
export type SftpErrorCode = 'NO_SUCH_FILE' | 'PERMISSION_DENIED' | 'FAILURE' | 'OP_UNSUPPORTED' | 'EOF' | 'BAD_MESSAGE';
export class SftpError extends Error { constructor(public code: SftpErrorCode, message?: string) { super(message || code); } }

export interface Attrs { mode: number; uid: number; gid: number; size: number; atime: number; mtime: number }
export interface DirEntry { filename: string; longname: string; attrs: Attrs }

const PF = { READ: 1, WRITE: 2, APPEND: 4, CREAT: 8, TRUNC: 16, EXCL: 32 };
const C = fs.constants;
const MAX_HANDLES = 64;

type Handle = { kind: 'file'; fd: number; write: boolean; bytes: number } | { kind: 'dir'; entries: DirEntry[]; done: boolean };

function toAttrs(st: fs.Stats): Attrs {
  return { mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) };
}
function longname(name: string, a: Attrs): string {
  const t = (a.mode & C.S_IFMT) === C.S_IFDIR ? 'd' : '-';
  const bits = ['r', 'w', 'x'];
  let perm = ''; for (let i = 8; i >= 0; i--) perm += a.mode & (1 << i) ? bits[(8 - i) % 3] : '-';
  return `${t}${perm} 1 mono mono ${String(a.size).padStart(10)} ${new Date(a.mtime * 1000).toISOString().slice(0, 10)} ${name}`;
}

export class SftpSession {
  private handles = new Map<number, Handle>();
  private next = 1;
  private usage = { at: 0, bytes: 0 };

  constructor(private serverId: string, private readOnly: boolean, private diskLimitMB: number) {}

  /** Every user path goes through here: confined to the volume, symlinks never followed at the leaf. */
  private resolve(p: string): string {
    try { return resolveInVolume(this.serverId, p); }
    catch (e) { throw new SftpError(e instanceof HttpError && e.status === 404 ? 'NO_SUCH_FILE' : 'PERMISSION_DENIED'); }
  }
  private lstatSafe(abs: string): fs.Stats {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch (e: any) { throw this.map(e); }
    if (st.isSymbolicLink()) throw new SftpError('NO_SUCH_FILE', 'symlinks are not available');
    return st;
  }
  private map(e: any): SftpError {
    if (e instanceof SftpError) return e;
    switch (e?.code) {
      case 'ENOENT': case 'ENOTDIR': return new SftpError('NO_SUCH_FILE');
      case 'EACCES': case 'EPERM': case 'ELOOP': return new SftpError('PERMISSION_DENIED');
      default: return new SftpError('FAILURE', e?.message);
    }
  }
  private mustWrite() { if (this.readOnly) throw new SftpError('PERMISSION_DENIED', 'read-only login'); }
  private virtual(abs: string): string {
    const root = fs.realpathSync(volumePath(this.serverId));
    const rel = path.relative(root, abs);
    return '/' + rel.split(path.sep).filter(Boolean).join('/');
  }
  private quotaLeft(extra: number): void {
    if (!this.diskLimitMB) return;
    const limit = this.diskLimitMB * MB;
    if (Date.now() - this.usage.at > 3000) this.usage = { at: Date.now(), bytes: diskUsage(volumePath(this.serverId), limit * 2) };
    if (this.usage.bytes + extra > limit) throw new SftpError('FAILURE', 'disk quota exceeded');
    this.usage.bytes += extra;
  }
  private alloc(h: Handle): number {
    if (this.handles.size >= MAX_HANDLES) throw new SftpError('FAILURE', 'too many open handles');
    const id = this.next++; this.handles.set(id, h); return id;
  }
  private get(id: number): Handle { const h = this.handles.get(id); if (!h) throw new SftpError('BAD_MESSAGE', 'invalid handle'); return h; }

  realpath(p: string): string { const abs = this.resolve(p || '/'); return this.virtual(abs); }

  stat(p: string): Attrs { return toAttrs(this.lstatSafe(this.resolve(p))); } // symlinks are refused, so stat == lstat

  fstat(id: number): Attrs {
    const h = this.get(id); if (h.kind !== 'file') throw new SftpError('BAD_MESSAGE');
    try { return toAttrs(fs.fstatSync(h.fd)); } catch (e: any) { throw this.map(e); }
  }

  open(p: string, flags: number): number {
    const writing = !!(flags & (PF.WRITE | PF.APPEND | PF.CREAT | PF.TRUNC));
    if (writing) this.mustWrite();
    const abs = this.resolve(p);
    let oflags = writing ? ((flags & PF.READ) ? C.O_RDWR : C.O_WRONLY) : C.O_RDONLY;
    if (flags & PF.CREAT) oflags |= C.O_CREAT;
    if (flags & PF.EXCL) oflags |= C.O_EXCL;
    if (flags & PF.TRUNC) oflags |= C.O_TRUNC;
    if (flags & PF.APPEND) oflags |= C.O_APPEND;
    oflags |= C.O_NOFOLLOW; // never open through a symlink planted by the server process
    try {
      if (fs.existsSync(abs) && !(flags & PF.EXCL)) { const st = this.lstatSafe(abs); if (st.isDirectory()) throw new SftpError('FAILURE', 'is a directory'); }
      const fd = fs.openSync(abs, oflags, 0o644);
      if (writing && process.getuid?.() === 0) { try { fs.fchownSync(fd, config.uid, config.gid); } catch { /* ignore */ } }
      return this.alloc({ kind: 'file', fd, write: writing, bytes: 0 });
    } catch (e: any) { throw this.map(e); }
  }

  read(id: number, offset: number, length: number): Buffer {
    const h = this.get(id); if (h.kind !== 'file') throw new SftpError('BAD_MESSAGE');
    const len = Math.min(Math.max(length, 0), 256 * 1024);
    const buf = Buffer.alloc(len);
    try { const n = fs.readSync(h.fd, buf, 0, len, offset); if (n === 0) throw new SftpError('EOF'); return buf.subarray(0, n); }
    catch (e: any) { throw this.map(e); }
  }

  write(id: number, offset: number, data: Buffer): void {
    const h = this.get(id); if (h.kind !== 'file' || !h.write) throw new SftpError('PERMISSION_DENIED');
    this.quotaLeft(data.length);
    try { let done = 0; while (done < data.length) done += fs.writeSync(h.fd, data, done, data.length - done, offset + done); h.bytes += data.length; }
    catch (e: any) { throw this.map(e); }
  }

  close(id: number): void {
    const h = this.handles.get(id); if (!h) throw new SftpError('BAD_MESSAGE');
    this.handles.delete(id); if (h.kind === 'file') { try { fs.closeSync(h.fd); } catch { /* ignore */ } }
  }
  closeAll(): void { for (const id of [...this.handles.keys()]) { try { this.close(id); } catch { /* ignore */ } } }

  opendir(p: string): number {
    const abs = this.resolve(p); const st = this.lstatSafe(abs);
    if (!st.isDirectory()) throw new SftpError('FAILURE', 'not a directory');
    const entries: DirEntry[] = [];
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.isSymbolicLink()) continue;
      try { const a = toAttrs(fs.lstatSync(path.join(abs, d.name))); entries.push({ filename: d.name, longname: longname(d.name, a), attrs: a }); } catch { /* raced */ }
    }
    return this.alloc({ kind: 'dir', entries, done: false });
  }
  readdir(id: number): DirEntry[] {
    const h = this.get(id); if (h.kind !== 'dir') throw new SftpError('BAD_MESSAGE');
    if (h.done) throw new SftpError('EOF');
    h.done = true; return h.entries;
  }

  mkdir(p: string): void { this.mustWrite(); try { const abs = this.resolve(p); fs.mkdirSync(abs); if (process.getuid?.() === 0) fs.chownSync(abs, config.uid, config.gid); } catch (e: any) { throw this.map(e); } }
  rmdir(p: string): void { this.mustWrite(); const abs = this.resolve(p); this.notRoot(abs); try { const st = this.lstatSafe(abs); if (!st.isDirectory()) throw new SftpError('FAILURE'); fs.rmdirSync(abs); } catch (e: any) { throw this.map(e); } }
  remove(p: string): void { this.mustWrite(); const abs = this.resolve(p); this.notRoot(abs); try { const st = this.lstatSafe(abs); if (st.isDirectory()) throw new SftpError('FAILURE', 'is a directory'); fs.unlinkSync(abs); } catch (e: any) { throw this.map(e); } }
  rename(from: string, to: string): void {
    this.mustWrite(); const a = this.resolve(from), b = this.resolve(to); this.notRoot(a);
    try { this.lstatSafe(a); if (fs.existsSync(b)) throw new SftpError('FAILURE', 'destination exists'); fs.renameSync(a, b); } catch (e: any) { throw this.map(e); }
  }
  private notRoot(abs: string) { if (abs === fs.realpathSync(volumePath(this.serverId))) throw new SftpError('PERMISSION_DENIED', 'cannot modify the server root'); }
}
