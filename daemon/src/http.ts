import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import fs from 'fs';
import { config } from './config';
import { authenticate, preAuth, UNSIGNED_PAYLOAD } from './auth';
import { HttpError } from './safe';
import { log } from './log';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  raw: Buffer;
}
type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; maxBody: number; stream: boolean }

const routes: Route[] = [];
const MB = 1024 * 1024;

/** `opts.stream`: the handler consumes `ctx.req` itself (large transfers). Auth then signs an UNSIGNED-PAYLOAD marker and the route must verify its own checksum. */
export function route(method: string, pattern: string, handler: Handler, maxBody = 1 * MB, opts: { stream?: boolean } = {}): void {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, maxBody, stream: !!opts.stream });
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // A slow client must not hold a connection open forever: allow 20 s + 5 s per MB of the route's body limit.
    const timer = setTimeout(() => { reject(new HttpError(408, 'Request body timeout')); req.destroy(); }, 20_000 + Math.ceil(limit / MB) * 5_000);
    req.on('end', () => clearTimeout(timer)); req.on('close', () => clearTimeout(timer));
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://daemon');
    const method = (req.method || 'GET').toUpperCase();
    const hit = routes.find(r => r.method === method && r.re.test(url.pathname));
    // Unknown routes answer 404 only after auth so scanners learn nothing about the API surface.
    preAuth(req);
    const raw = hit?.stream ? Buffer.alloc(0) : await readBody(req, hit?.maxBody ?? 64 * 1024);
    authenticate(req, hit?.stream ? UNSIGNED_PAYLOAD : raw);
    if (!hit) throw new HttpError(404, 'Not found');

    const m = hit.re.exec(url.pathname)!;
    const params: Record<string, string> = {};
    hit.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { throw new HttpError(400, 'Bad path'); } });

    let body: any = {};
    if (raw.length && (req.headers['content-type'] || '').startsWith('application/json')) {
      try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
    }
    const result = await hit.handler({ req, res, params, query: url.searchParams, body, raw });
    if (!res.writableEnded && !res.headersSent && result !== undefined) sendJson(res, 200, result);
  } catch (err: any) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    log.error('Unhandled error', err?.message || err);
    sendJson(res, 500, { error: 'Internal error' });
  }
}

export function startHttp(): http.Server | https.Server {
  const handler = (req: IncomingMessage, res: ServerResponse) => { void dispatch(req, res); };
  const server = config.tlsCert && config.tlsKey
    ? https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey), minVersion: 'TLSv1.2' }, handler)
    : http.createServer(handler);
  server.headersTimeout = 20_000;
  server.requestTimeout = 0; // streaming transfers can legitimately take long; body reads are bounded per route instead
  server.maxHeadersCount = 50;
  server.listen(config.port, config.host, () => log.info(`Daemon listening on ${config.tlsCert ? 'https' : 'http'}://${config.host}:${config.port}`));
  return server;
}

/** Server-sent events helper used for live console output. */
export function openSse(res: ServerResponse): (event: string, data: string) => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  return (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n` + data.split('\n').map(l => `data: ${l}`).join('\n') + '\n\n');
  };
}
export { MB };
