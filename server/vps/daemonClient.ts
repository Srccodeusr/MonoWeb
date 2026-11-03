import crypto from 'crypto';
import { VpsNode } from '../../src/vpsTypes';
import { decryptSecret } from '../hosting/crypto';

export class VpsDaemonError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Must match vps-daemon/src/index.js authenticate(): ts \n nonce \n METHOD \n path?query \n sha256(body). */
export async function vpsDaemon<T = any>(node: VpsNode, method: string, pathWithQuery: string, body?: unknown, timeoutMs = 25_000): Promise<T> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const ts = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(payload).digest('hex');
  const sig = crypto.createHmac('sha256', decryptSecret(node.secretEnc)).update(`${ts}\n${nonce}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHash}`).digest('hex');
  const headers: Record<string, string> = { 'X-Mono-Ts': ts, 'X-Mono-Nonce': nonce, 'X-Mono-Sig': sig };
  if (payload.length) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${node.scheme}://${node.daemonHost}:${node.daemonPort}${pathWithQuery}`, { method, headers, body: payload.length ? payload : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    throw new VpsDaemonError(502, `VPS node "${node.name}" is unreachable (${e?.cause?.code || e?.message || 'network error'}).`);
  }
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-json */ }
  if (!res.ok) throw new VpsDaemonError(res.status === 401 ? 502 : res.status, res.status === 401 ? `VPS node "${node.name}" rejected the panel's signature. Re-run the configure command on the node.` : (json.error || `Daemon error ${res.status}`));
  return json as T;
}

export async function pingVpsNode(node: VpsNode): Promise<{ ping: any; system: any }> {
  const [ping, system] = await Promise.all([vpsDaemon(node, 'GET', '/v1/ping', undefined, 6000), vpsDaemon(node, 'GET', '/v1/system', undefined, 6000)]);
  return { ping, system };
}

/** The one-line commands shown in Admin > VPS > Nodes (the secret is displayed once). */
export function vpsInstallCommands(panelUrl: string, secret: string, port: number) {
  return {
    installCommand: `sudo bash install.sh --panel ${panelUrl} --key ${secret} --port ${port}`,
    configureCommand: `cd vps-daemon && npm run configure -- --panel ${panelUrl} --key ${secret} --port ${port} && npm start`,
  };
}
