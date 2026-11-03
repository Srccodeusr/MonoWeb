import express, { Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';

import { authMiddleware, AuthenticatedRequest } from './server/auth';
import { getDb } from './server/db';

import authRoutes from './server/routes/auth';
import publicRoutes from './server/routes/public';
import billingRoutes from './server/routes/billing';
import supportRoutes from './server/routes/support';
import mailRoutes from './server/routes/mail';
import adminRoutes from './server/routes/admin';
import adsRoutes from './server/routes/ads';
import discordRoutes from './server/routes/discord';
import statusRoutes from './server/routes/status';
import apiKeysRoutes from './server/routes/apiKeys';
import hostingRoutes from './server/routes/hosting';
import hostingExtraRoutes from './server/routes/hostingExtra';
import hostingToolsRoutes, { activityHook } from './server/routes/hostingTools';
import { startScheduleRunner } from './server/hosting/schedules';
import hostingAdminRoutes, { serveMedia } from './server/routes/hostingAdmin';
import hostingBillingRoutes, { publicRouter as hostingPublicRoutes, stripeWebhook } from './server/routes/hostingBilling';
import economyRoutes from './server/routes/economy';
import vpsRoutes from './server/routes/vps';
import vpsAdminRoutes from './server/routes/vpsAdmin';
import { startVpsScheduler } from './server/vps/service';
import { startHostingScheduler } from './server/hosting/serverService';
import { generalApiRateLimiter, sensitiveAuthRateLimiter, safePayloadErrorHandler } from './server/services/requestProtection';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Reverse proxy trust. `true` (the old default) lets ANY client spoof its IP through X-Forwarded-For and
  // bypass every rate limit/ban. Default is now ONE proxy hop in production (Nginx/Caddy/Cloudflare tunnel),
  // none in development. Override with TRUST_PROXY=<hops|false|loopback|CIDR list>.
  {
    const tp = (process.env.TRUST_PROXY ?? '').trim();
    if (tp === 'false' || tp === '0') app.set('trust proxy', false);
    else if (tp === 'true') app.set('trust proxy', 1);
    else if (/^\d+$/.test(tp)) app.set('trust proxy', parseInt(tp, 10));
    else if (tp) app.set('trust proxy', tp);
    else app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
  }
  app.disable('x-powered-by');

  // Security headers (no extra dependency).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self' https://checkout.stripe.com");
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

  // Stripe needs the RAW body to verify its signature, so this MUST come before express.json().
  app.post('/api/v1/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);

  // Basic Body Parsers with error interception
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(safePayloadErrorHandler);

  // General API Request Protection
  app.use('/api', generalApiRateLimiter);

  // Helper Cookie Parser (null-prototype object; malformed escapes no longer throw on every request)
  app.use((req, res, next) => {
    req.cookies = Object.create(null);
    const rc = req.headers.cookie;
    if (rc) {
      rc.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        const key = parts.shift()!.trim();
        if (!key || key === '__proto__') return;
        const raw = parts.join('=');
        try { req.cookies[key] = decodeURIComponent(raw); } catch { req.cookies[key] = raw; }
      });
    }
    next();
  });

  // CSRF defence for cookie-authenticated writes: when a state-changing request carries the session cookie but no
  // Authorization/API-key header (i.e. the browser attached it automatically), its Origin must be ours.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!req.cookies?.aether_token || req.headers.authorization || req.headers['x-api-key']) return next();
    const origin = req.headers.origin as string | undefined;
    const host = req.headers.host;
    let ok = false;
    if (origin) { try { const o = new URL(origin); ok = o.host === host || (process.env.APP_URL ? o.origin === new URL(process.env.APP_URL).origin : false); } catch { ok = false; } }
    if (!ok) return res.status(403).json({ success: false, error: { code: 'CSRF_BLOCKED', message: 'Cross-site request blocked.' } });
    next();
  });

  // CORS & Allowed Origins Middleware
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedEnv = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean) : [];
    const appUrl = process.env.APP_URL ? process.env.APP_URL.trim().replace(/\/+$/, '') : null;

    const allowedSet = new Set([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      ...(appUrl ? [appUrl] : []),
      ...allowedEnv
    ]);

    // Only explicitly allowed origins get credentialed CORS (previously every origin did unless NODE_ENV=production).
    if (origin && (allowedSet.has(origin) || allowedSet.has('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'Platform API', timestamp: new Date().toISOString() });
  });

  // API Routes FIRST
  app.get('/api/v1/settings/appearance', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDb();
    const defaultAnimationSettings = {
      enabled: true,
      pageTransitions: true,
      initialPanelAnimation: true,
      intensity: 'normal' as const
    };
    const settings = db.settings.animationSettings || defaultAnimationSettings;
    res.json({ success: true, data: settings });
  });

  app.get('/api/v1/settings/social-links', async (req, res) => {
    const db = await getDb();
    const socialLinks = db.settings.socialLinks || {
      discord: db.settings.discordUrl || '',
      twitter: '',
      github: ''
    };
    res.json({ success: true, data: socialLinks });
  });

  app.use('/api/v1/auth', sensitiveAuthRateLimiter, authRoutes);
  app.use('/api/v1/account', authRoutes);
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/plans', publicRoutes);
  app.use('/api/v1/billing', billingRoutes);
  app.use('/api/v1/support', supportRoutes);
  app.use('/api/v1/mail', mailRoutes);
  app.get('/api/v1/media/:id', serveMedia);
  app.use('/api/v1/hosting-public', hostingPublicRoutes);
  app.use('/api/v1/hosting/billing', hostingBillingRoutes);
  app.use('/api/v1/hosting', activityHook); // records server activity for every mutating request that succeeds
  app.use('/api/v1/hosting', hostingRoutes);
  app.use('/api/v1/hosting', hostingExtraRoutes);
  app.use('/api/v1/hosting', hostingToolsRoutes);
  app.use('/api/v1/economy', economyRoutes);
  app.use('/api/v1/admin/hosting', hostingAdminRoutes);
  app.use('/api/v1/vps', vpsRoutes);                    // customer VPS panel (must not be shadowed by /api/v1/admin)
  app.use('/api/v1/admin/vps', vpsAdminRoutes);         // admin VPS console (before the generic /admin router)
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/ads', adsRoutes);
  app.use('/api/v1/discord', discordRoutes);
  app.use('/api/v1/status', statusRoutes);
  app.use('/api/v1/api-keys', apiKeysRoutes);

  // Catch-all for missing API routes - must return JSON, not HTML.
  // Mounted with app.use (not app.all('/api/*', ...)) so it also matches
  // '/api' itself, not just paths with a segment after it. It sits after
  // every real '/api/v1/*' router above and before the Vite/static/SPA
  // block below, so it always wins for API paths and never falls through
  // to index.html. Only the path is echoed back (no query string, no
  // server file paths, no stack traces) so nothing internal leaks.
  app.use('/api', (req, res) => {
    const requestedPath = req.originalUrl.split('?')[0];
    res.status(404).json({
      success: false,
      error: {
        code: 'API_NOT_FOUND',
        message: `The API endpoint '${requestedPath}' does not exist on this server.`
      }
    });
  });

  // Vite Integration for SPA Development and Production Serving
  if (process.env.NODE_ENV !== 'production') {
    // Dynamically imported so the entire Vite/esbuild/Rollup dev toolchain
    // is never touched (or required to be installed) in production.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite content-hashes everything under /assets, so those are safe
        // to cache forever. Everything else (favicon, logo svgs, etc.) gets
        // a short/no-cache policy in case it's updated in place.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');

      // We only reach here when express.static above couldn't find a
      // matching file. A request whose last path segment has a file
      // extension (.js, .css, .png, .map, .woff2, ...) was for a specific
      // static asset that genuinely doesn't exist — serving index.html
      // for that would silently swap a missing file for a 200 HTML page
      // (masking broken deploys/bad cache references), so it gets a real
      // 404 instead. No filesystem path is included in the response.
      // Real client-side app routes are always extensionless, so this
      // check never misclassifies one of those.
      const looksLikeStaticAsset = /\.[a-zA-Z0-9]+$/.test(req.path) && !req.path.endsWith('.html');
      if (looksLikeStaticAsset) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'ASSET_NOT_FOUND',
            message: 'The requested file was not found.'
          }
        });
      }

      // Anything else is a client-side route: hand off to the SPA shell.
      // The HTML shell references hashed asset filenames, so it must never
      // be cached — otherwise clients can get stuck on stale asset links.
      // The app's own router (src/lib/routing.ts) then decides whether this
      // path is a real page or renders the in-app <NotFound /> component.
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind and Listen on Port 3000
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Platform] Server running on http://0.0.0.0:${PORT}`);
    startHostingScheduler();
    startScheduleRunner();
    startVpsScheduler();
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Platform] Port ${PORT} in use, existing listener may still be handling requests.`);
    } else {
      console.error('[Platform] Server listener error:', err);
    }
  });

  return server;
}

startServer().catch(err => {
  console.error('[Platform] Fatal server startup error:', err);
});
