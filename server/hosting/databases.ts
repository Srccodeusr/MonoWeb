import { randomPassword } from './crypto';

/**
 * Per-server MySQL/MariaDB databases. The panel talks to ONE database host (set in .env, see env.example) with an admin
 * account that is allowed to CREATE DATABASE / CREATE USER / GRANT. Every server database gets its own user that can only
 * touch its own schema.
 */
export interface DbHostConfig { host: string; port: number; user: string; password: string; publicHost: string; publicPort: number }

export function dbHostConfig(): DbHostConfig | null {
  const host = (process.env.DB_HOST_ADDRESS || '').trim();
  const user = (process.env.DB_HOST_ADMIN_USER || '').trim();
  if (!host || !user) return null;
  const port = parseInt(process.env.DB_HOST_PORT || '3306', 10) || 3306;
  return {
    host, port, user, password: process.env.DB_HOST_ADMIN_PASSWORD || '',
    publicHost: (process.env.DB_HOST_PUBLIC_ADDRESS || host).trim(),
    publicPort: parseInt(process.env.DB_HOST_PUBLIC_PORT || String(port), 10) || port,
  };
}

async function connect(cfg: DbHostConfig) {
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, connectTimeout: 8000, multipleStatements: false });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'db';

/** Names are generated here from [a-z0-9_] only, never taken verbatim from the user, so they are safe as identifiers. */
export function makeNames(serverId: string, label: string): { name: string; username: string } {
  const short = serverId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const rnd = Math.random().toString(36).slice(2, 6);
  return { name: `s${short}_${slug(label)}_${rnd}`.slice(0, 64), username: `u${short}_${rnd}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32) };
}

export async function createDatabase(cfg: DbHostConfig, name: string, username: string): Promise<string> {
  const password = randomPassword(24);
  const conn = await connect(cfg);
  try {
    const mysql = await import('mysql2/promise');
    const db = mysql.escapeId(name); const user = mysql.escape(username);
    await conn.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    try {
      await conn.query(`CREATE USER ${user}@'%' IDENTIFIED BY ${mysql.escape(password)}`);
      await conn.query(`GRANT ALL PRIVILEGES ON ${db}.* TO ${user}@'%'`);
      await conn.query('FLUSH PRIVILEGES');
    } catch (e) { await conn.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => undefined); throw e; }
  } finally { await conn.end().catch(() => undefined); }
  return password;
}

export async function rotatePassword(cfg: DbHostConfig, username: string): Promise<string> {
  const password = randomPassword(24);
  const conn = await connect(cfg);
  try {
    const mysql = await import('mysql2/promise');
    await conn.query(`ALTER USER ${mysql.escape(username)}@'%' IDENTIFIED BY ${mysql.escape(password)}`);
  } finally { await conn.end().catch(() => undefined); }
  return password;
}

export async function dropDatabase(cfg: DbHostConfig, name: string, username: string): Promise<void> {
  const conn = await connect(cfg);
  try {
    const mysql = await import('mysql2/promise');
    await conn.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(name)}`);
    await conn.query(`DROP USER IF EXISTS ${mysql.escape(username)}@'%'`);
    await conn.query('FLUSH PRIVILEGES');
  } finally { await conn.end().catch(() => undefined); }
}
