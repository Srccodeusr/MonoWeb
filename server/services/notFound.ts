import path from 'path';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isKnownRoute } from '../../src/lib/routing';

/**
 * 404 / SPA-fallback / error handling for the Express server.
 *
 * Mount order in server.ts matters (first match wins):
 *   1. real API routes + routers
 *   2. apiNotFound        -> app.use('/api', ...)   unmatched API call  => JSON 404
 *   3. express.static     -> real files in dist/
 *   4. missingFileGuard   -> missing asset / dotfile                     => plain 404
 *   5. spaFallback        -> GET/HEAD client-side routes                 => index.html
 *   6. finalNotFound      -> anything left (e.g. POST /nope)             => JSON 404
 *   7. errorHandler       -> thrown / next(err) errors                   => generic JSON
 *
 * None of these echo the requested URL, error messages, stack traces or file-system paths.
 */

/** Unmatched /api request (any method, any depth, including bare /api) -> JSON 404. */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({
    success: false,
    error: {
      code: 'API_NOT_FOUND',
      message: 'The requested API endpoint was not found.'
    }
  });
};

/**
 * Anything that looks like a file (has an extension, is under /assets, or contains a dotfile
 * segment) and was not found by express.static is a real 404. Without this, the SPA fallback
 * would answer a missing /assets/index-abc123.js with index.html and a 200, which browsers
 * then refuse to run as a script (wrong MIME type) and CDNs may cache.
 *
 * Note: client-side routes must therefore never contain a "." (none do today).
 */
export const missingFileGuard: RequestHandler = (req, res, next) => {
  const p = req.path;
  const looksLikeFile =
    path.posix.extname(p) !== '' ||
    /^\/assets(\/|$)/i.test(p) ||
    /(^|\/)\./.test(p);

  if (!looksLikeFile) return next();

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(404).type('text/plain').send('Not found');
};

/**
 * Serves the SPA shell for client-side routes. Unknown routes still get index.html (so the
 * React NotFound page renders) but with a real 404 status, so crawlers don't index soft-404s.
 * "Unknown" is decided by the same parseUrlToRoute() the React app uses.
 */
export function spaFallback(distPath: string): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // The shell references hashed asset filenames, so it must never be cached.
    res.setHeader('Cache-Control', 'no-cache');
    res.status(isKnownRoute(req.path) ? 200 : 404);

    // `root` keeps the absolute path out of any error and avoids send's dotfile check
    // tripping over a dot-directory in the deploy path.
    res.sendFile('index.html', { root: distPath }, (err) => {
      if (err) next(err);
    });
  };
}

/** Nothing matched at all (e.g. POST /nope) -> JSON 404. */
export const finalNotFound: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.'
    }
  });
};

/** Last-resort error handler: full detail goes to the server log only, never to the client. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const raw = Number((err as any)?.status ?? (err as any)?.statusCode);
  const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;

  if (status >= 500) {
    console.error(`[Platform] Unhandled error on ${req.method} ${req.path}:`, err);
  }

  const code = status >= 500 ? 'INTERNAL_ERROR' : status === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR';
  const message =
    status >= 500
      ? 'Something went wrong on our side. Please try again.'
      : status === 404
        ? 'The requested resource was not found.'
        : 'The request could not be processed.';

  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ success: false, error: { code, message } });
};
