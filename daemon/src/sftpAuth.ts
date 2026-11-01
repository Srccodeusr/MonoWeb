import crypto from 'crypto';
import { ServerSpec } from './runtime/types';
import { listSpecs } from './state';

/** Format shared with the panel: scrypt$N$r$p$saltB64$hashB64. Only strong, bounded parameters are accepted. */
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const n = Number(N), rr = Number(r), pp = Number(p);
  if (![n, rr, pp].every(Number.isInteger) || n < 1024 || n > 65536 || rr < 1 || rr > 16 || pp < 1 || pp > 4) return false;
  try {
    const want = Buffer.from(hash, 'base64');
    const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: n, r: rr, p: pp, maxmem: 128 * n * rr * 2 });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch { return false; }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${h.toString('base64')}`;
}

const failures = new Map<string, { n: number; until: number }>();
function throttled(key: string): boolean { const f = failures.get(key); return !!f && f.until > Date.now() && f.n >= 8; }
function fail(key: string) { const f = failures.get(key) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 10 * 60_000; failures.set(key, f); }
setInterval(() => { for (const [k, f] of failures) if (f.until < Date.now()) failures.delete(k); }, 60_000).unref();

export interface SftpLogin { spec: ServerSpec; readOnly: boolean }

/** Resolve `<name>.<id8>` + password to exactly one server and verify. Brute force is throttled per IP and per username. */
export function authenticateSftp(username: string, password: string, ip: string): SftpLogin | null {
  const kIp = `ip:${ip}`, kUser = `u:${username}`;
  if (throttled(kIp) || throttled(kUser)) return null;
  const m = /^(.+)\.([a-f0-9]{8})$/.exec(username);
  let result: SftpLogin | null = null;
  if (m) {
    const matches = listSpecs().filter(s => s.id.replace(/-/g, '').startsWith(m[2]) || s.id.startsWith(m[2]));
    if (matches.length === 1) {
      const cred = (matches[0].sftp || []).find(c => c.username === username);
      // Always run a scrypt even when the user is unknown, so timing does not reveal valid usernames.
      const ok = verifyPassword(password, cred?.hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      if (cred && ok) result = { spec: matches[0], readOnly: !!cred.readOnly };
    }
  }
  if (!result) { fail(kIp); fail(kUser); }
  return result;
}
