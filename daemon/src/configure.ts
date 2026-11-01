import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Usage: npm run configure -- --panel https://panel.example.com --key <secret> [--port 3002] [--allow 1.2.3.4] [--sftp 2022]
 * Mirrors the AirLink "Configure node" flow: the panel shows this exact command after you add the node.
 * The secret is written to .env with mode 600 (never echoed back).
 */
function arg(name: string, short?: string): string {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if ((a[i] === `--${name}` || (short && a[i] === `-${short}`)) && a[i + 1]) return a[i + 1];
  return '';
}

async function main(): Promise<void> {
  const panel = arg('panel', 'p').replace(/\/+$/, '');
  const key = arg('key', 'k');
  if (!panel || !key) { console.error('Usage: npm run configure -- --panel <url> --key <secret> [--port 3002] [--allow <panel-ip>]'); process.exit(1); }
  if (key.length < 32) { console.error('The secret from the panel must be at least 32 characters.'); process.exit(1); }
  try {
    const r = await fetch(`${panel}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    console.log('Panel reachable.');
  } catch (e: any) { console.warn(`Warning: could not reach the panel (${e.message}). Continuing, the daemon does not need outbound access to it.`); }

  const file = path.join(process.cwd(), '.env');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
  const set = (src: string, k: string, v: string) => (new RegExp(`^${k}=.*$`, 'm').test(src) ? src.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${src.trimEnd()}\n${k}=${v}\n`);
  let out = set(existing, 'DAEMON_SECRET', key);
  const port = arg('port'); if (port) out = set(out, 'DAEMON_PORT', port);
  const allow = arg('allow'); if (allow) out = set(out, 'ALLOWED_IPS', allow);
  const sftp = arg('sftp'); if (sftp) out = set(out, 'SFTP_PORT', sftp);
  fs.writeFileSync(file, out, { mode: 0o600 });
  console.log(`Wrote ${file} (fingerprint ${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}). Start the daemon with: npm start`);
}
main();
