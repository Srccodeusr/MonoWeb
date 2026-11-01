import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { config } from './config';
import { HttpError, assertId, volumePath } from './safe';
import { run, chownTree, ensureVolume } from './fsops';

/**
 * Node-to-node server transfer ("switch node").
 *   source: prepare (tar.gz + sha256) -> export stream -> cleanup
 *   target: import stream. The expected sha256/size travel in the SIGNED query string, so a tampered or truncated
 *           body is detected even though a streaming body cannot be hashed up front.
 */
const dir = () => path.join(config.dataDir, 'transfer');
const FILE_RE = /^[a-f0-9]{32}$/;
const fileOf = (fileId: string) => { if (!FILE_RE.test(fileId)) throw new HttpError(400, 'Invalid transfer id'); return path.join(dir(), `${fileId}.tar.gz`); };

export function sweepOldTransfers(): void {
  try { for (const f of fs.readdirSync(dir())) { const p = path.join(dir(), f); if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600_000) fs.rmSync(p, { force: true }); } } catch { /* none yet */ }
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256'); const s = fs.createReadStream(file);
    s.on('data', c => h.update(c)); s.on('end', () => resolve(h.digest('hex'))); s.on('error', reject);
  });
}

export async function prepareExport(id: string): Promise<{ fileId: string; size: number; sha256: string }> {
  const vol = volumePath(assertId(id));
  if (!fs.existsSync(vol)) throw new HttpError(404, 'Server volume not found');
  fs.mkdirSync(dir(), { recursive: true, mode: 0o750 });
  const fileId = crypto.randomBytes(16).toString('hex'); const file = fileOf(fileId);
  await run('tar', ['-czf', file, '-C', vol, '.']);
  const size = fs.statSync(file).size;
  if (size > config.maxTransferMB * 1048576) { fs.rmSync(file, { force: true }); throw new HttpError(413, 'Server is larger than this node allows to transfer'); }
  return { fileId, size, sha256: await hashFile(file) };
}

export function exportStream(fileId: string): { stream: fs.ReadStream; size: number } {
  const file = fileOf(fileId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Transfer file not found');
  return { stream: fs.createReadStream(file), size: fs.statSync(file).size };
}
export function deleteExport(fileId: string): void { fs.rmSync(fileOf(fileId), { force: true }); }

export async function importArchive(id: string, req: IncomingMessage, sha256: string, size: number): Promise<void> {
  assertId(id);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'Invalid checksum');
  if (!Number.isInteger(size) || size <= 0 || size > config.maxTransferMB * 1048576) throw new HttpError(413, 'Invalid or too large transfer size');
  fs.mkdirSync(dir(), { recursive: true, mode: 0o750 });
  const tmp = path.join(dir(), `in-${crypto.randomBytes(8).toString('hex')}.tar.gz`);
  try {
    const got = await new Promise<{ n: number; hash: string }>((resolve, reject) => {
      const h = crypto.createHash('sha256'); const out = fs.createWriteStream(tmp, { mode: 0o640 }); let n = 0;
      req.on('data', (c: Buffer) => { n += c.length; if (n > size) { req.destroy(); out.destroy(); reject(new HttpError(413, 'Body larger than declared size')); return; } h.update(c); });
      req.pipe(out);
      out.on('finish', () => resolve({ n, hash: h.digest('hex') }));
      out.on('error', reject); req.on('error', reject); req.on('aborted', () => reject(new HttpError(400, 'Upload aborted')));
    });
    if (got.n !== size) throw new HttpError(400, 'Transfer was truncated');
    if (got.hash !== sha256) throw new HttpError(400, 'Checksum mismatch: transfer rejected');

    const names = await run('tar', ['-tzf', tmp]);
    if (names.split('\n').some(n => n.startsWith('/') || n.split('/').includes('..'))) throw new HttpError(400, 'Archive contains unsafe paths');
    const vol = ensureVolume(id);
    for (const e of fs.readdirSync(vol)) fs.rmSync(path.join(vol, e), { recursive: true, force: true });
    await run('tar', ['-xzf', tmp, '-C', vol, '--no-same-owner', '--no-same-permissions']);
    await chownTree(vol);
  } finally { fs.rmSync(tmp, { force: true }); }
}
