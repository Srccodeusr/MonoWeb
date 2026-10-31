import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { config } from './config';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Server ids are UUID-ish. This is the single gate that prevents ../ ids reaching rm -rf / docker names. */
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/;
export function assertId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'Invalid server id');
  return id;
}

export function volumePath(id: string): string {
  assertId(id);
  const p = path.join(config.volumesDir, id);
  if (path.dirname(p) !== config.volumesDir) throw new HttpError(400, 'Invalid server id');
  return p;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a user supplied relative path inside a server volume.
 * - rejects NUL bytes and absolute-looking escapes
 * - resolves symlinks on the deepest existing ancestor and re-checks containment,
 *   so a symlink created by the (untrusted) server process cannot point outside the volume.
 */
export function resolveInVolume(id: string, rel: unknown): string {
  const base = volumePath(id);
  if (!fs.existsSync(base)) throw new HttpError(404, 'Server volume not found');
  const realBase = fs.realpathSync(base);
  const clean = typeof rel === 'string' ? rel : '/';
  if (clean.includes('\0')) throw new HttpError(400, 'Invalid path');
  const target = path.resolve(realBase, '.' + path.posix.normalize('/' + clean.replace(/\\/g, '/')));
  if (!isInside(realBase, target)) throw new HttpError(400, 'Path escapes server directory');

  let probe = target;
  while (!fs.existsSync(probe) && probe !== realBase) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (!isInside(realBase, realProbe)) throw new HttpError(400, 'Path escapes server directory');
  return target;
}

export function safeName(name: unknown): string {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\/\\\0]/.test(name) || name === '.' || name === '..') {
    throw new HttpError(400, 'Invalid file name');
  }
  return name;
}

export interface PortMap { host: number; container: number; proto?: 'tcp' | 'udp' }
export function validatePorts(ports: unknown): PortMap[] {
  if (ports === undefined || ports === null) return [];
  if (!Array.isArray(ports) || ports.length > 16) throw new HttpError(400, 'Invalid ports');
  return ports.map(p => {
    const host = Number(p?.host), container = Number(p?.container);
    const proto = p?.proto === 'udp' ? 'udp' : 'tcp';
    if (!Number.isInteger(host) || !Number.isInteger(container) || container < 1 || container > 65535) throw new HttpError(400, 'Invalid port mapping');
    if (host < config.portMin || host > config.portMax || host === config.port) throw new HttpError(400, `Host port ${host} outside allowed range ${config.portMin}-${config.portMax}`);
    return { host, container, proto };
  });
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export function validateEnv(env: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env || typeof env !== 'object') return out;
  const entries = Object.entries(env as Record<string, unknown>);
  if (entries.length > 128) throw new HttpError(400, 'Too many environment variables');
  for (const [k, v] of entries) {
    if (!ENV_KEY.test(k)) throw new HttpError(400, `Invalid env var name: ${k}`);
    const s = String(v ?? '');
    if (s.length > 8192 || s.includes('\0')) throw new HttpError(400, `Invalid env var value for ${k}`);
    out[k] = s;
  }
  return out;
}

export function assertImage(image: unknown): string {
  if (typeof image !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._\/:@-]{1,254}$/.test(image)) throw new HttpError(400, 'Invalid image name');
  if (config.imagePrefixes.length && !config.imagePrefixes.some(p => image.startsWith(p))) throw new HttpError(403, 'Image not allowed on this node');
  return image;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

/** SSRF guard for installer downloads: https/http only, public addresses only, re-checked on every redirect. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Only http/https URLs are allowed');
  if (config.allowPrivateDownloads) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) throw new HttpError(400, 'Downloads from private/internal addresses are blocked');
  return u;
}
