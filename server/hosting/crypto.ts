import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

/** Reads (or creates, mode 600) a random secret on disk so we never ship a guessable default. */
function persistedSecret(name: string): string {
  const file = path.join(DATA_DIR, name);
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (v.length >= 32) return v;
  } catch { /* create below */ }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const v = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, v, { mode: 0o600 });
  return v;
}

const PLACEHOLDERS = new Set([
  'super_secret_jwt_key_change_me_in_production',
  'mononode_secret_jwt_key_2026_super_safe',
  'change_me', 'changeme', 'secret',
]);

/** JWT signing secret: env value if it is strong and not a documented placeholder, else a generated persisted one. */
export function resolveJwtSecret(): string {
  const env = (process.env.JWT_SECRET || '').trim();
  if (env.length >= 32 && !PLACEHOLDERS.has(env)) return env;
  if (env) console.warn('[Security] JWT_SECRET is missing/weak/placeholder; using a generated secret from data/.jwt_secret');
  return persistedSecret('.jwt_secret');
}

let masterKey: Buffer | null = null;
function key(): Buffer {
  if (!masterKey) masterKey = crypto.createHash('sha256').update(process.env.APP_SECRET || persistedSecret('.app_secret')).digest();
  return masterKey;
}

/** AES-256-GCM for secrets stored in db.json (node daemon keys, Stripe keys). Format: v1.iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(blob: string): string {
  if (!blob) return '';
  if (!blob.startsWith('v1.')) return blob; // tolerate legacy plaintext values
  const [, iv, tag, data] = blob.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

export function maskSecret(v: string): string {
  if (!v) return '';
  return v.length <= 8 ? '••••••••' : `${v.slice(0, 4)}••••••••${v.slice(-4)}`;
}

/** CSPRNG token (the old AirLink node keys used Math.random). */
export function randomToken(bytes = 36): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
}

/** Daemon-side server id: lowercase uuid, matches the daemon's id regex. */
export function newServerId(): string { return crypto.randomUUID(); }

/** scrypt hash for SFTP passwords. Same format the daemon verifies: scrypt$N$r$p$saltB64$hashB64. */
export function hashSftpPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${h.toString('base64')}`;
}

/** Readable but strong: 24 chars from an unambiguous alphabet. */
export function randomPassword(len = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = ''; for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
