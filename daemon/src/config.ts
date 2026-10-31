import fs from 'fs';
import path from 'path';

/** Tiny .env reader so the daemon needs zero runtime dependencies. */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(process.cwd(), '.env'));

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();
const int = (k: string, d: number): number => {
  const n = parseInt(env(k), 10);
  return Number.isFinite(n) ? n : d;
};

const dataDir = path.resolve(env('DATA_DIR', './data'));

export const config = {
  secret: env('DAEMON_SECRET'),
  host: env('DAEMON_HOST', '0.0.0.0'),
  port: int('DAEMON_PORT', 3002),
  allowedIps: env('ALLOWED_IPS').split(',').map(s => s.trim()).filter(Boolean),
  tlsCert: env('TLS_CERT'),
  tlsKey: env('TLS_KEY'),
  runtime: env('RUNTIME', 'auto').toLowerCase() as 'auto' | 'docker' | 'podman' | 'process',
  socket: env('CONTAINER_SOCKET', process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  ociRuntime: env('OCI_RUNTIME'),
  processSandbox: env('PROCESS_SANDBOX', 'auto').toLowerCase() as 'auto' | 'bwrap' | 'none',
  dataDir,
  volumesDir: path.resolve(env('VOLUMES_DIR', path.join(dataDir, 'volumes'))),
  backupsDir: path.resolve(env('BACKUPS_DIR', path.join(dataDir, 'backups'))),
  portMin: int('PORT_MIN', 20000),
  portMax: int('PORT_MAX', 40000),
  uid: int('CONTAINER_UID', 1000),
  gid: int('CONTAINER_GID', 1000),
  imagePrefixes: env('ALLOWED_IMAGE_PREFIXES').split(',').map(s => s.trim()).filter(Boolean),
  allowPrivateDownloads: env('ALLOW_PRIVATE_DOWNLOADS') === 'true',
  version: '3.0.0',
};

const WEAK = new Set(['', 'key', 'changeme', 'change_me', '00000000000000000000000000000000', 'secret', 'password']);

/** Refuse to boot with a missing/weak secret (the old daemon defaulted to a zero key). */
export function assertConfig(): void {
  if (WEAK.has(config.secret.toLowerCase()) || config.secret.length < 32) {
    throw new Error('DAEMON_SECRET is missing or weak (need >= 32 chars). Run: npm run configure -- --panel <url> --key <secret from panel>');
  }
  if (config.portMin < 1024 || config.portMax > 65535 || config.portMin >= config.portMax) {
    throw new Error('PORT_MIN/PORT_MAX must satisfy 1024 <= min < max <= 65535');
  }
  for (const d of [config.dataDir, config.volumesDir, config.backupsDir]) fs.mkdirSync(d, { recursive: true, mode: 0o750 });
}
