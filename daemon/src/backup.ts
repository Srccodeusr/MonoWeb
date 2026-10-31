import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from './config';
import { HttpError, assertId, volumePath } from './safe';
import { run } from './fsops';

const dirFor = (id: string) => path.join(config.backupsDir, assertId(id));
function backupFile(id: string, backupId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(backupId)) throw new HttpError(400, 'Invalid backup id');
  return path.join(dirFor(id), `${backupId}.tar.gz`);
}

export async function createBackup(id: string, maxBytes: number): Promise<{ id: string; size: number; checksum: string }> {
  const vol = volumePath(id);
  if (!fs.existsSync(vol)) throw new HttpError(404, 'Server volume not found');
  fs.mkdirSync(dirFor(id), { recursive: true, mode: 0o750 });
  const backupId = crypto.randomUUID();
  const file = backupFile(id, backupId);
  await run('tar', ['-czf', file, '--exclude=./node_modules', '--exclude=./.cache', '-C', vol, '.']);
  const size = fs.statSync(file).size;
  if (maxBytes > 0 && size > maxBytes) { fs.rmSync(file, { force: true }); throw new HttpError(413, 'Backup exceeds the storage allowed by the plan'); }
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { id: backupId, size, checksum };
}

export async function restoreBackup(id: string, backupId: string): Promise<void> {
  const file = backupFile(id, backupId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
  // Validate archive member names BEFORE wiping the volume (zip-slip / absolute path guard).
  const names = await run('tar', ['-tzf', file]);
  if (names.split('\n').some(n => n.startsWith('/') || n.split('/').includes('..'))) throw new HttpError(400, 'Backup contains unsafe paths');
  const vol = volumePath(id);
  for (const e of fs.readdirSync(vol)) fs.rmSync(path.join(vol, e), { recursive: true, force: true });
  await run('tar', ['-xzf', file, '-C', vol, '--no-same-owner', '--no-same-permissions']);
}

export function deleteBackup(id: string, backupId: string): void { fs.rmSync(backupFile(id, backupId), { force: true }); }
export function backupStream(id: string, backupId: string): { stream: fs.ReadStream; size: number } {
  const file = backupFile(id, backupId);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
  return { stream: fs.createReadStream(file), size: fs.statSync(file).size };
}
export function deleteAllBackups(id: string): void { fs.rmSync(dirFor(id), { recursive: true, force: true }); }
