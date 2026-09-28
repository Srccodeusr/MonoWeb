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
import { generalApiRateLimiter, sensitiveAuthRateLimiter, safePayloadErrorHandler } from './server/services/requestProtection';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Enable reverse proxy trust (Cloud Run, Nginx, Cloudflare, Caddy)
  if (process.env.TRUST_PROXY !== 'false' && process.env.TRUST_PROXY !== '0') {
    app.set('trust proxy', true);
  }

  // Basic Body Parsers with error interception
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(safePayloadErrorHandler);

  // General API Request Protection
  app.use('/api', generalApiRateLimiter);

  // Helper Cookie Parser
  app.use((req, res, next) => {
    req.cookies = {};
    const rc = req.headers.cookie;
    if (rc) {
      rc.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        req.cookies[parts.shift()!.trim()] = decodeURI(parts.join('='));
      });
    }
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

    if (origin && (allowedSet.has(origin) || allowedSet.has('*') || process.env.NODE_ENV !== 'production')) {
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
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/ads', adsRoutes);
  app.use('/api/v1/discord', discordRoutes);
  app.use('/api/v1/status', statusRoutes);
  app.use('/api/v1/api-keys', apiKeysRoutes);

  // Catch-all for missing API routes - must return JSON, not HTML
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'API_NOT_FOUND',
        message: `The API endpoint '${req.originalUrl}' does not exist on this server.`
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
      // The HTML shell references hashed asset filenames, so it must never
      // be cached — otherwise clients can get stuck on stale asset links.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind and Listen on Port 3000
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Platform] Server running on http://0.0.0.0:${PORT}`);
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
