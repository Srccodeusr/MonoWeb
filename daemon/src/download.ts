import http from 'http';
import https from 'https';
import fs from 'fs';
import net from 'net';
import dns from 'dns';
import { config } from './config';
import { HttpError, assertPublicUrl, isPrivateAddress } from './safe';

/**
 * Download with SSRF protection at connect time (DNS re-resolved through a guarded lookup,
 * so DNS-rebinding cannot swap in an internal address after validation). Max 5 redirects, size capped.
 */
export async function safeDownload(rawUrl: string, dest: string, maxBytes = 512 * 1024 * 1024, depth = 0): Promise<void> {
  if (depth > 5) throw new HttpError(400, 'Too many redirects');
  const url = await assertPublicUrl(rawUrl);
  const mod = url.protocol === 'https:' ? https : http;

  const guardedLookup: any = (host: string, opts: any, cb: any) => {
    dns.lookup(host, opts, (err, address, family) => {
      if (err) return cb(err);
      const list = Array.isArray(address) ? address : [{ address, family }];
      if (!config.allowPrivateDownloads && list.some((a: any) => isPrivateAddress(a.address))) return cb(new Error('Blocked private address'));
      cb(null, address, family);
    });
  };

  return new Promise<void>((resolve, reject) => {
    const req = mod.get(url, { lookup: net.isIP(url.hostname) ? undefined : guardedLookup, timeout: 30_000, headers: { 'User-Agent': 'MonoNode-Daemon' } }, res => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        safeDownload(new URL(res.headers.location, url).toString(), dest, maxBytes, depth + 1).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); reject(new HttpError(502, `Download failed: HTTP ${code}`)); return; }
      let size = 0;
      const out = fs.createWriteStream(dest, { mode: 0o640 });
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); out.destroy(); fs.rmSync(dest, { force: true }); reject(new HttpError(413, 'Download too large')); }
      });
      res.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Download timeout')));
    req.on('error', reject);
  });
}
