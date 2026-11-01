import fs from 'fs';
import path from 'path';
import { HttpError, resolveInVolume, safeName, volumePath } from './safe';
import { safeDownload } from './download';
import { diskUsage, chownTree, run, remove } from './fsops';

export interface AddonFile { url: string; path: string; extract: boolean }
const MAX_ADDON_BYTES = 256 * 1024 * 1024;

const rel = (id: string, abs: string) => '/' + path.relative(fs.realpathSync(volumePath(id)), abs).split(path.sep).join('/');

function archiveNames(archive: string): Promise<string> {
  return /\.zip$/i.test(archive) ? run('unzip', ['-Z1', archive]) : run('tar', ['-tzf', archive]);
}

/** Downloads each file into the server volume (SSRF-guarded, quota-checked). Returns the paths created, for clean uninstall. */
export async function installFiles(id: string, files: AddonFile[], diskLimitMB: number): Promise<string[]> {
  if (!Array.isArray(files) || files.length === 0 || files.length > 20) throw new HttpError(400, 'Invalid addon file list');
  const created: string[] = [];
  const vol = volumePath(id);
  for (const f of files) {
    const dirAbs = resolveInVolume(id, path.posix.dirname('/' + String(f.path || '')));
    const target = path.join(dirAbs, safeName(path.posix.basename(String(f.path || ''))));
    fs.mkdirSync(dirAbs, { recursive: true });
    await safeDownload(String(f.url), target, MAX_ADDON_BYTES);
    if (diskLimitMB && diskUsage(vol, diskLimitMB * 1048576) > diskLimitMB * 1048576) {
      fs.rmSync(target, { force: true });
      throw new HttpError(507, 'Not enough disk space for this addon');
    }
    if (f.extract) {
      if (!/\.(zip|tar\.gz|tgz)$/i.test(target)) { fs.rmSync(target, { force: true }); throw new HttpError(400, 'Only .zip and .tar.gz archives can be extracted'); }
      const names = await archiveNames(target);
      if (names.split('\n').some(n => n.startsWith('/') || n.split('/').includes('..'))) { fs.rmSync(target, { force: true }); throw new HttpError(400, 'Archive contains unsafe paths'); }
      if (/\.zip$/i.test(target)) await run('unzip', ['-o', '-q', target, '-d', dirAbs]);
      else await run('tar', ['-xzf', target, '-C', dirAbs, '--no-same-owner', '--no-same-permissions']);
      fs.rmSync(target, { force: true });
      const tops = [...new Set(names.split('\n').map(n => n.replace(/^\.\//, '').split('/')[0]).filter(Boolean))];
      for (const t of tops) created.push(rel(id, path.join(dirAbs, t)));
    } else created.push(rel(id, target));
  }
  await chownTree(vol);
  return [...new Set(created)];
}

export function removePaths(id: string, paths: string[]): number {
  return remove(id, (paths || []).slice(0, 500));
}
