import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { config } from './config';
import { HttpError } from './safe';

const WINDOW_S = 60;
const seen = new Map<string, number>(); // nonce -> expiry (ms)

setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of seen) if (exp < now) seen.delete(n);
}, 30_000).unref();

export function bodyHash(body: Buffer): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

/** Canonical string both sides sign. Includes the query string and a hash of the raw body bytes. */
export function canonical(ts: string, nonce: string, method: string, pathWithQuery: string, body: Buffer): string {
  return `${ts}\n${nonce}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHash(body)}`;
}

export function sign(secret: string, ts: string, nonce: string, method: string, pathWithQuery: string, body: Buffer): string {
  return crypto.createHmac('sha256', secret).update(canonical(ts, nonce, method, pathWithQuery, body)).digest('hex');
}

export function clientIp(req: IncomingMessage): string {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

/**
 * Every request must carry a fresh, single-use HMAC signature. There is no permissive mode
 * and no static basic-auth password: the secret never travels over the wire.
 */
export function preAuth(req: IncomingMessage): void {
  if (config.allowedIps.length && !config.allowedIps.includes(clientIp(req))) throw new HttpError(403, 'Forbidden');

  const ts = String(req.headers['x-mono-ts'] || '');
  const nonce = String(req.headers['x-mono-nonce'] || '');
  const sig = String(req.headers['x-mono-sig'] || '');
  if (!ts || !nonce || !sig || nonce.length < 16 || nonce.length > 64 || !/^[0-9a-f]{64}$/i.test(sig)) throw new HttpError(401, 'Unauthorized');

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > WINDOW_S) throw new HttpError(401, 'Request expired');
  if (seen.has(nonce)) throw new HttpError(401, 'Replay detected');
}

/** Cheap checks run BEFORE the body is read, so unauthenticated clients cannot make us buffer large uploads. */
export function authenticate(req: IncomingMessage, body: Buffer): void {
  preAuth(req);
  const ts = String(req.headers['x-mono-ts']);
  const nonce = String(req.headers['x-mono-nonce']);
  const sig = String(req.headers['x-mono-sig']);

  const expected = Buffer.from(sign(config.secret, ts, nonce, req.method || 'GET', req.url || '/', body), 'hex');
  const given = Buffer.from(sig, 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw new HttpError(401, 'Unauthorized');

  seen.set(nonce, Date.now() + WINDOW_S * 2000);
}
