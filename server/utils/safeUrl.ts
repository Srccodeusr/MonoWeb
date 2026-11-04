import dns from 'dns';
import net from 'net';

/**
 * SSRF protection for URLs that users can make the server call (webhooks).
 * A URL is only accepted when it is http(s) and EVERY address its host resolves to is a public one.
 * The resolved address is then pinned for the actual request (see `pinnedLookup`) so a DNS answer that
 * changes between the check and the request ("DNS rebinding") cannot reach an internal service.
 */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true; // not an IP at all: refuse
}

export class UnsafeUrlError extends Error {}

/** Resolves `rawUrl` and returns the parsed URL plus the vetted address, or throws UnsafeUrlError. */
export async function assertPublicHttpUrl(rawUrl: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UnsafeUrlError('The URL is not valid.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http:// and https:// URLs are allowed.');
  if (url.username || url.password) throw new UnsafeUrlError('URLs with embedded credentials are not allowed.');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost') || host.toLowerCase().endsWith('.internal')) {
    throw new UnsafeUrlError('Local and internal addresses are not allowed.');
  }

  let records: { address: string; family: number }[];
  if (net.isIP(host)) records = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  else {
    try { records = await dns.promises.lookup(host, { all: true }); }
    catch { throw new UnsafeUrlError('The host name could not be resolved.'); }
  }
  if (!records.length || records.some(r => isPrivateAddress(r.address))) {
    throw new UnsafeUrlError('Local, private and internal network addresses are not allowed.');
  }
  return { url, address: records[0].address, family: records[0].family === 6 ? 6 : 4 };
}

/** A `lookup` function for http(s).request that always answers with the already vetted address. */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (_host: string, options: any, cb: any) => {
    if (typeof options === 'function') cb = options;
    if (options && typeof options === 'object' && options.all) return cb(null, [{ address, family }]);
    return cb(null, address, family);
  };
}
