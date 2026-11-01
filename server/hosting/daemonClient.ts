import crypto from 'crypto';
import { HostNode } from '../../src/hostingTypes';
import { decryptSecret } from './crypto';

export class DaemonError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function nodeBase(node: HostNode): string {
  return `${node.scheme}://${node.daemonHost}:${node.daemonPort}`;
}

/** Must match daemon/src/auth.ts canonical(): ts \n nonce \n METHOD \n path?query \n sha256(body). */
function headers(secret: string, method: string, pathWithQuery: string, body: Buffer): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(`${ts}\n${nonce}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHash}`).digest('hex');
  return { 'X-Mono-Ts': ts, 'X-Mono-Nonce': nonce, 'X-Mono-Sig': sig };
}

export interface CallOptions { timeoutMs?: number; raw?: boolean }

export async function daemonFetch(node: HostNode, method: string, pathWithQuery: string, body?: unknown, opts: CallOptions = {}): Promise<Response> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const h: Record<string, string> = headers(decryptSecret(node.secretEnc), method, pathWithQuery, payload);
  if (payload.length) h['Content-Type'] = 'application/json';
  try {
    return await fetch(nodeBase(node) + pathWithQuery, {
      method, headers: h, body: payload.length ? payload : undefined,
      signal: opts.timeoutMs === 0 ? undefined : AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e: any) {
    throw new DaemonError(502, `Node "${node.name}" is unreachable (${e?.cause?.code || e?.message || 'network error'}).`);
  }
}

/**
 * Signed request whose body may be a stream (node-to-node transfers). The checksum of the payload is carried in the
 * signed query string instead of a body hash, and the daemon only accepts this form on its stream routes.
 */
export async function daemonRaw(node: HostNode, method: string, pathWithQuery: string, opts: { body?: any; timeoutMs?: number } = {}): Promise<Response> {
  const ts = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex');
  const bodyMarker = opts.body ? 'UNSIGNED-PAYLOAD' : crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  const sig = crypto.createHmac('sha256', decryptSecret(node.secretEnc)).update(`${ts}\n${nonce}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyMarker}`).digest('hex');
  try {
    return await fetch(nodeBase(node) + pathWithQuery, {
      method, headers: { 'X-Mono-Ts': ts, 'X-Mono-Nonce': nonce, 'X-Mono-Sig': sig },
      body: opts.body, duplex: opts.body ? 'half' : undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 30 * 60_000),
    } as any);
  } catch (e: any) {
    throw new DaemonError(502, `Node "${node.name}" is unreachable (${e?.cause?.code || e?.message || 'network error'}).`);
  }
}

export async function daemon<T = any>(node: HostNode, method: string, pathWithQuery: string, body?: unknown, opts: CallOptions = {}): Promise<T> {
  const res = await daemonFetch(node, method, pathWithQuery, body, opts);
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-json */ }
  if (!res.ok) throw new DaemonError(res.status === 401 ? 502 : res.status, res.status === 401 ? `Node "${node.name}" rejected the panel's signature. Re-run the configure command on the node.` : (json.error || `Daemon error ${res.status}`));
  return json as T;
}

export async function pingNode(node: HostNode): Promise<{ ping: any; system: any }> {
  const ping = await daemon(node, 'GET', '/v1/ping', undefined, { timeoutMs: 6000 });
  const system = await daemon(node, 'GET', '/v1/system', undefined, { timeoutMs: 6000 });
  return { ping, system };
}

/** The one-line command shown in Admin > Nodes after adding a node (same flow as the AirLink "Configure" button). */
export function configureCommand(panelUrl: string, secret: string, port: number, panelIp?: string, sftpPort = 0): string {
  return `cd daemon && npm install && npm run build && npm run configure -- --panel ${panelUrl} --key ${secret} --port ${port}${panelIp ? ` --allow ${panelIp}` : ''}${sftpPort ? ` --sftp ${sftpPort}` : ''} && npm start`;
}
