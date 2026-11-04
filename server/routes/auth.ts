import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getDb, saveDbSync } from '../db';
import { generateToken, authMiddleware, createAuditLog, AuthenticatedRequest, JWT_SECRET } from '../auth';
import { User, DiscordAccount } from '../../src/types';
import { evaluateIpRisk, AntiAbuseConfig } from '../utils/ipRiskProvider';
import { getDiscordOAuthRedirectUri, getCurrentInstallationPublicUrl } from '../oauthUrlResolver';
import { verifyFirebaseIdToken, FirebaseTokenError } from '../utils/firebaseVerify';

const router = Router();

// Pre-computed bcrypt hash of a random string, used to keep login timing constant for unknown accounts.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// Rate limiting & abuse protection tracking
interface LoginFailureRecord {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
}

const loginIpFailures = new Map<string, LoginFailureRecord>();
const loginIdentifierFailures = new Map<string, LoginFailureRecord>();
const registrationIpTrack = new Map<string, { count: number; resetAt: number }>();

const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REGISTRATIONS_PER_HOUR = 10;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getClientIp(req: any): string {
  // Only allow test IP overrides in test environments
  if (process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true') {
    const simulated = req.headers['x-simulated-ip'] || req.headers['x-test-ip'];
    if (simulated) return String(simulated).trim();
  }

  // req.ip already honours the app-level "trust proxy" setting (server.ts). Reading X-Forwarded-For by hand let any
  // client choose its own address (bypassing lockouts), and ignoring it behind a proxy put every visitor on one IP.
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

// The tracking maps would otherwise grow forever (one entry per IP / identifier ever seen).
const trackingCleanup = setInterval(() => {
  const now = Date.now();
  for (const map of [loginIpFailures, loginIdentifierFailures]) {
    for (const [key, rec] of map) {
      if (now - rec.firstFailedAt > FAILURE_WINDOW_MS && (!rec.lockedUntil || rec.lockedUntil < now)) map.delete(key);
    }
  }
  for (const [key, rec] of registrationIpTrack) if (now > rec.resetAt) registrationIpTrack.delete(key);
}, 10 * 60 * 1000);
trackingCleanup.unref?.();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const avatarFor = (seed: string) => `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;

/** Escapes text for safe interpolation into an HTML document. */
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** JSON for embedding inside an inline <script>: '<' is escaped so "</script>" in a value cannot end the block. */
const jsonForScript = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function checkLoginLockout(ip: string, identifier: string): { isLocked: boolean; remainingSeconds: number } {
  const now = Date.now();
  // If not loopback, check IP lockout
  if (ip !== '127.0.0.1' && ip !== '::1') {
    const ipRec = loginIpFailures.get(ip);
    if (ipRec && ipRec.lockedUntil && ipRec.lockedUntil > now) {
      return { isLocked: true, remainingSeconds: Math.ceil((ipRec.lockedUntil - now) / 1000) };
    }
  }
  // Check identifier lockout for all environments
  const idRec = loginIdentifierFailures.get(identifier.toLowerCase());
  if (idRec && idRec.lockedUntil && idRec.lockedUntil > now) {
    return { isLocked: true, remainingSeconds: Math.ceil((idRec.lockedUntil - now) / 1000) };
  }
  return { isLocked: false, remainingSeconds: 0 };
}

function recordLoginFailure(ip: string, identifier: string): { locked: boolean; remainingSeconds: number } {
  const now = Date.now();
  
  // Track by IP
  let ipRec = loginIpFailures.get(ip);
  if (!ipRec || now - ipRec.firstFailedAt > FAILURE_WINDOW_MS) {
    ipRec = { count: 1, firstFailedAt: now };
  } else {
    ipRec.count++;
  }
  if (ipRec.count >= MAX_FAILED_ATTEMPTS) {
    ipRec.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  loginIpFailures.set(ip, ipRec);

  // Track by identifier
  const cleanId = identifier.toLowerCase();
  let idRec = loginIdentifierFailures.get(cleanId);
  if (!idRec || now - idRec.firstFailedAt > FAILURE_WINDOW_MS) {
    idRec = { count: 1, firstFailedAt: now };
  } else {
    idRec.count++;
  }
  if (idRec.count >= MAX_FAILED_ATTEMPTS) {
    idRec.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  loginIdentifierFailures.set(cleanId, idRec);

  const locked = (ipRec.lockedUntil !== undefined && ipRec.lockedUntil > now) || (idRec.lockedUntil !== undefined && idRec.lockedUntil > now);
  const remainingSeconds = locked ? Math.ceil(LOCKOUT_DURATION_MS / 1000) : 0;
  return { locked, remainingSeconds };
}

function clearLoginFailures(ip: string, identifier: string) {
  loginIpFailures.delete(ip);
  loginIdentifierFailures.delete(identifier.toLowerCase());
}

function checkRegistrationRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = registrationIpTrack.get(ip);
  if (!rec || now > rec.resetAt) {
    registrationIpTrack.set(ip, { count: 1, resetAt: now + REGISTRATION_WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_REGISTRATIONS_PER_HOUR) {
    return false;
  }
  rec.count++;
  return true;
}

// GET /api/v1/auth/anti-abuse-status - Real configuration status for VPN/Proxy abuse protection
router.get('/anti-abuse-status', async (req, res) => {
  try {
    const db = await getDb();
    const hasKey = !!(process.env.VPN_CHECK_API_KEY || process.env.PROXYCHECK_KEY || (db.settings as any).antiAbuse?.apiKey);
    if (!hasKey) {
      return res.json({
        success: true,
        data: {
          status: 'NOT_CONFIGURED',
          message: 'VPN/Proxy Detection: NOT CONFIGURED',
          enabled: false
        }
      });
    }
    return res.json({
      success: true,
      data: {
        status: 'CONFIGURED',
        provider: 'proxycheck',
        enabled: true
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// GET /api/v1/auth/config - Public auth provider availability and public client configuration
router.get('/config', async (req, res) => {
  try {
    const db = await getDb();
    const authProviders = db.settings.authProviders || {
      emailPassword: { enabled: true },
      google: { enabled: true },
      discord: { enabled: true }
    };

    const googleSettings = authProviders.google || { enabled: true };
    const discordSettings = authProviders.discord || { enabled: true };
    const emailSettings = authProviders.emailPassword || { enabled: true };

    res.json({
      success: true,
      data: {
        emailPasswordEnabled: emailSettings.enabled !== false,
        googleEnabled: googleSettings.enabled !== false,
        discordEnabled: discordSettings.enabled !== false,
        registrationEnabled: db.settings.registrationEnabled !== false,
        firebaseConfig: {
          apiKey: googleSettings.firebaseApiKey || process.env.VITE_FIREBASE_API_KEY || '',
          authDomain: googleSettings.firebaseAuthDomain || process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
          projectId: googleSettings.firebaseProjectId || process.env.VITE_FIREBASE_PROJECT_ID || '',
          storageBucket: googleSettings.firebaseStorageBucket || process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
          messagingSenderId: googleSettings.firebaseMessagingSenderId || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId: googleSettings.firebaseAppId || process.env.VITE_FIREBASE_APP_ID || ''
        },
        discordClientId: discordSettings.clientId || process.env.DISCORD_CLIENT_ID || ''
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username: rawUsername, displayName, email: rawEmail, password } = req.body || {};

    if (!rawUsername || !rawEmail || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Username, email and password are required.' }
      });
    }
    if (typeof rawUsername !== 'string' || typeof rawEmail !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid registration details.' } });
    }
    const username = rawUsername.trim();
    const email = rawEmail.trim();
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Username must be 3-32 characters: letters, numbers, dots, dashes or underscores.' } });
    }
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Please enter a valid email address.' } });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password must be between 8 and 128 characters.' } });
    }

    const clientIp = getClientIp(req);
    if (!checkRegistrationRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        error: { code: 'REGISTRATION_RATE_LIMITED', message: 'Too many registration requests from this network. Please try again later.' }
      });
    }

    const db = await getDb();

    // Anti-Abuse & VPN / Proxy Risk Evaluation
    if (db.settings?.antiAbuse) {
      const riskCheck = await evaluateIpRisk(clientIp, db.settings.antiAbuse);
      if (!riskCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: {
            code: riskCheck.errorCode || 'HIGH_RISK_NETWORK',
            message: riskCheck.reason || 'Network address is flagged by Anti-Abuse security policies.'
          }
        });
      }
    }

    if (db.settings.authProviders?.emailPassword?.enabled === false) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_METHOD_DISABLED', message: 'Email and password authentication is currently disabled by administrator.' }
      });
    }

    if (!db.settings.registrationEnabled) {
      return res.status(403).json({
        success: false,
        error: { code: 'REGISTRATION_DISABLED', message: 'New user registration is currently closed.' }
      });
    }

    const existingUser = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === username.toLowerCase());
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: { code: 'USER_EXISTS', message: 'A user with this email or username already exists.' }
      });
    }

    const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser: User = {
      id: userId,
      username,
      displayName: (typeof displayName === 'string' && displayName.trim() ? displayName.trim() : username).slice(0, 60),
      email: email.toLowerCase(),
      role: 'user',
      avatarUrl: avatarFor(username),
      isSuspended: false,
      emailVerified: true,
      twoFactorEnabled: false,
      authProvider: 'local',
      plan: 'free',
      credits: 10.0, // Welcome credit
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.users.push(newUser);
    db.passwords[userId] = passwordHash;
    saveDbSync();

    const token = generateToken(newUser);
    await createAuditLog(newUser.id, newUser.email, newUser.role, 'USER_REGISTER', 'ACCOUNT', 'User registered account');

    res.cookie('aether_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

    res.json({
      success: true,
      data: {
        token,
        user: newUser
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Registration failed' } });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' }
      });
    }
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid email or password.' } });
    }

    const clientIp = getClientIp(req);
    const lockout = checkLoginLockout(clientIp, email);
    if (lockout.isLocked) {
      res.setHeader('Retry-After', lockout.remainingSeconds.toString());
      return res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_FAILED_ATTEMPTS',
          message: `Too many failed login attempts. Please try again in ${lockout.remainingSeconds} seconds.`
        }
      });
    }

    const db = await getDb();

    if (db.settings.authProviders?.emailPassword?.enabled === false) {
      return res.status(403).json({
        success: false,
        error: { code: 'AUTH_METHOD_DISABLED', message: 'Email and password authentication is currently disabled by administrator.' }
      });
    }

    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === email.toLowerCase());

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH); // same work as a real check so response time doesn't reveal which accounts exist
      const fail = recordLoginFailure(clientIp, email);
      if (fail.locked) {
        res.setHeader('Retry-After', fail.remainingSeconds.toString());
        return res.status(429).json({
          success: false,
          error: {
            code: 'TOO_MANY_FAILED_ATTEMPTS',
            message: `Too many failed login attempts. Please try again in ${fail.remainingSeconds} seconds.`
          }
        });
      }
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const passwordHash = db.passwords[user.id];
    const isMatch = await bcrypt.compare(password, passwordHash || DUMMY_HASH) && !!passwordHash;

    if (!isMatch) {
      const fail = recordLoginFailure(clientIp, email);
      if (fail.locked) {
        res.setHeader('Retry-After', fail.remainingSeconds.toString());
        return res.status(429).json({
          success: false,
          error: {
            code: 'TOO_MANY_FAILED_ATTEMPTS',
            message: `Too many failed login attempts. Please try again in ${fail.remainingSeconds} seconds.`
          }
        });
      }
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    // Only someone who proved they own the account is told it is suspended (previously anyone could probe for it).
    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact support.' }
      });
    }

    // Successful login: clear failure counters
    clearLoginFailures(clientIp, email);

    const token = generateToken(user);
    await createAuditLog(user.id, user.email, user.role, 'USER_LOGIN', 'SESSION', 'Successful user authentication');

    res.cookie('aether_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

    res.json({
      success: true,
      data: {
        token,
        user
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Login failed' } });
  }
});

// POST /api/v1/auth/firebase-verify - Cryptographically verify Firebase ID token and authenticate/register user
const firebaseVerifyHandler = async (req: any, res: any) => {
  try {
    const { idToken, token: fallbackToken } = req.body || {};
    const rawToken = idToken || fallbackToken;

    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'TOKEN_REQUIRED', message: 'Firebase ID token is required for verification.' }
      });
    }

    const db = await getDb();

    // Check if Google Auth is enabled
    if (db.settings.authProviders?.google?.enabled === false) {
      return res.status(403).json({
        success: false,
        error: { code: 'GOOGLE_AUTH_DISABLED', message: 'Google Authentication is currently disabled by administrator.' }
      });
    }

    let verifiedEmail = '';
    let verifiedGoogleId = '';
    let verifiedName = '';
    let verifiedPicture = '';

    // Real verification: signature (Google's certificates), issuer, audience, expiry. Never trust unsigned claims.
    try {
      const projectId = String(db.settings.authProviders?.google?.firebaseProjectId || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
      const claims = await verifyFirebaseIdToken(rawToken, projectId);
      if (!claims.emailVerified) {
        return res.status(403).json({ success: false, error: { code: 'EMAIL_NOT_VERIFIED', message: 'Your Google account email is not verified.' } });
      }
      verifiedEmail = claims.email;
      verifiedGoogleId = claims.uid;
      verifiedName = claims.name;
      verifiedPicture = claims.picture;
    } catch (verifyErr: any) {
      if (verifyErr instanceof FirebaseTokenError) {
        const status = verifyErr.code === 'GOOGLE_NOT_CONFIGURED' ? 503 : verifyErr.code === 'EMAIL_REQUIRED' ? 400 : 401;
        return res.status(status).json({ success: false, error: { code: verifyErr.code, message: verifyErr.message } });
      }
      console.error('[Auth] Firebase token verification failed:', verifyErr);
      return res.status(502).json({ success: false, error: { code: 'VERIFICATION_UNAVAILABLE', message: 'Could not verify your Google sign-in right now. Please try again.' } });
    }

    const cleanEmail = verifiedEmail.trim().toLowerCase();
    const cleanGoogleId = verifiedGoogleId;

    // Find existing user: an already linked Google id wins, otherwise the (now verified) e-mail address
    let user = db.users.find(u => u.googleId && u.googleId === cleanGoogleId) || db.users.find(u => u.email.toLowerCase() === cleanEmail);

    if (user) {
      if (user.isSuspended) {
        return res.status(403).json({
          success: false,
          error: { code: 'ACCOUNT_SUSPENDED', message: 'Your account has been suspended. Please contact support.' }
        });
      }

      if (!user.googleId) {
        user.googleId = cleanGoogleId;
      } else if (user.googleId !== cleanGoogleId) {
        return res.status(403).json({ success: false, error: { code: 'GOOGLE_ACCOUNT_MISMATCH', message: 'This email is linked to a different Google account.' } });
      }
      if (verifiedPicture && (!user.avatarUrl || user.avatarUrl.includes('dicebear'))) {
        user.avatarUrl = verifiedPicture;
      }
      user.updatedAt = new Date().toISOString();
      saveDbSync();

      const sessionToken = generateToken(user);
      await createAuditLog(user.id, user.email, user.role, 'GOOGLE_FIREBASE_VERIFY_LOGIN', 'SESSION', 'Authenticated via verified Firebase ID token');

      res.cookie('aether_token', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

      return res.json({
        success: true,
        message: 'Firebase token verified successfully. User authenticated.',
        data: {
          token: sessionToken,
          user
        }
      });
    }

    // New User Registration
    if (!db.settings.registrationEnabled) {
      return res.status(403).json({
        success: false,
        error: { code: 'REGISTRATION_DISABLED', message: 'New user registration is currently closed.' }
      });
    }

    let baseUsername = (verifiedName || cleanEmail.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 16);
    if (!baseUsername || baseUsername.length < 3) baseUsername = 'google_user';

    let uniqueUsername = baseUsername;
    let counter = 1;
    while (db.users.some(u => u.username.toLowerCase() === uniqueUsername.toLowerCase())) {
      uniqueUsername = `${baseUsername}${counter}`;
      counter++;
    }

    const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 10);

    const newUser: User = {
      id: userId,
      username: uniqueUsername,
      displayName: (verifiedName?.trim() || uniqueUsername).slice(0, 60),
      email: cleanEmail,
      role: 'user',
      avatarUrl: verifiedPicture || avatarFor(uniqueUsername),
      isSuspended: false,
      emailVerified: true,
      twoFactorEnabled: false,
      authProvider: 'google',
      googleId: cleanGoogleId,
      plan: 'free',
      credits: 10.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.users.push(newUser);
    db.passwords[userId] = passwordHash;
    saveDbSync();

    const sessionToken = generateToken(newUser);
    await createAuditLog(newUser.id, newUser.email, newUser.role, 'GOOGLE_FIREBASE_VERIFY_REGISTER', 'ACCOUNT', 'Registered new account via verified Firebase ID token');

    res.cookie('aether_token', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

    return res.json({
      success: true,
      message: 'Account created successfully via verified Firebase ID token.',
      data: {
        token: sessionToken,
        user: newUser
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Firebase token verification failed.' } });
  }
};

router.post('/firebase-verify', firebaseVerifyHandler);
// Legacy path. It used to log anyone in from an unverified e-mail address in the request body (full account takeover),
// so it now only accepts a real Firebase ID token and runs exactly the same verification as /firebase-verify.
router.post('/firebase-google', firebaseVerifyHandler);

// GET /api/v1/auth/discord/url - Generate OAuth2 authorization URL for Discord
router.get('/discord/url', async (req, res) => {
  try {
    const db = await getDb();
    const discordSettings = db.settings.authProviders?.discord;

    if (discordSettings?.enabled === false) {
      return res.status(403).json({
        success: false,
        error: { code: 'DISCORD_AUTH_DISABLED', message: 'Discord login is currently disabled by administrator.' }
      });
    }

    const clientId = discordSettings?.clientId || process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: { code: 'DISCORD_NOT_CONFIGURED', message: 'Discord OAuth Client ID is not configured.' }
      });
    }

    // Check if requesting user is authenticated to embed userId in OAuth state for persistent account linking
    let linkingUserId: string | undefined;
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.aether_token;
    const token = (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken); // never from the query string (it would end up in logs and history)
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded && decoded.id) {
          linkingUserId = decoded.id;
        }
      } catch {}
    }

    const redirectUri = getDiscordOAuthRedirectUri(req, db.settings);
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = jwt.sign({
      nonce,
      userId: linkingUserId || null,
      action: linkingUserId ? 'link' : 'auth'
    }, JWT_SECRET, { expiresIn: '15m' });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify email',
      state,
      prompt: 'consent'
    });

    const authUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;

    // Bind this OAuth attempt to the browser that started it. The callback refuses a state whose nonce does not match
    // this cookie, which stops an attacker from feeding a victim a callback link for the attacker's own Discord login.
    res.cookie('mono_oauth_nonce', nonce, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000, path: '/api/v1/auth/discord' });

    res.json({
      success: true,
      data: {
        url: authUrl,
        state
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// GET /api/v1/auth/discord/callback - OAuth2 callback handler (Popup postMessage & session creation)
router.get('/discord/callback', async (req, res) => {
  let targetOrigin = getCurrentInstallationPublicUrl(req);
  const errorPage = (title: string, message: string, closeAfterMs = 2000) => res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="background:#09090b;color:#f87171;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box;">
            <div style="text-align:center;max-width:420px;">
              <h2>${escapeHtml(title)}</h2>
              <p>${escapeHtml(message)}</p>
              <script>
                (function() {
                  var targetOrigin = ${jsonForScript(targetOrigin)};
                  if (window.opener) {
                    var payload = { type: 'MONONODE_DISCORD_OAUTH_ERROR', success: false, error: ${jsonForScript(message)} };
                    try { window.opener.postMessage(payload, targetOrigin); } catch (e) {}
                    try { window.opener.postMessage({ type: 'DISCORD_AUTH_ERROR', success: false, error: ${jsonForScript(message)} }, targetOrigin); } catch (e) {}
                    setTimeout(function() { try { window.close(); } catch(e){} }, ${closeAfterMs});
                  }
                })();
              </script>
            </div>
          </body>
        </html>
      `);
  try {
    const db = await getDb();
    targetOrigin = getCurrentInstallationPublicUrl(req, db.settings);
    const { code, state, error, error_description } = req.query;

    if (error) {
      return errorPage('Discord Authentication Cancelled', String(error_description || error || 'Discord authorization cancelled'), 1500);
    }

    if (!code) {
      return res.status(400).send('Missing authorization code.');
    }

    // The state is mandatory and must belong to this browser (nonce cookie). Previously an invalid or missing state was
    // silently ignored, which made the flow open to login-CSRF and let the session cookie decide who got linked.
    let stateUserId: string | undefined;
    try {
      const statePayload = jwt.verify(String(state || ''), JWT_SECRET) as any;
      const cookieNonce = req.cookies?.mono_oauth_nonce;
      if (!statePayload || typeof statePayload.nonce !== 'string' || !['auth', 'link'].includes(statePayload.action) || !cookieNonce || cookieNonce !== statePayload.nonce) {
        throw new Error('state mismatch');
      }
      if (statePayload.action === 'link') stateUserId = statePayload.userId || undefined;
    } catch {
      return errorPage('Sign-in Expired', 'This Discord sign-in request is invalid or has expired. Please close this window and try again.');
    }
    res.clearCookie('mono_oauth_nonce', { path: '/api/v1/auth/discord' });

    const discordSettings = db.settings.authProviders?.discord;
    const clientId = discordSettings?.clientId || process.env.DISCORD_CLIENT_ID;
    const clientSecret = discordSettings?.clientSecret || process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = getDiscordOAuthRedirectUri(req, db.settings);

    if (!clientId || !clientSecret) {
      return res.status(500).send('Discord OAuth credentials not configured on server.');
    }

    // Exchange code for token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri
      }).toString()
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return errorPage('Authentication Failed', String(tokenData.error_description || tokenData.error || 'Failed to exchange Discord authorization code.'));
    }

    // Fetch Discord User profile
    const userProfileResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const discordUser = await userProfileResponse.json();
    if (!userProfileResponse.ok || !discordUser.id) {
      return res.status(500).send('Failed to fetch Discord user information.');
    }

    const discordId = discordUser.id;
    // Discord lets people set an e-mail address they never confirmed: it may only be trusted when Discord says it is verified.
    const discordEmail = discordUser.email && discordUser.verified === true ? String(discordUser.email).toLowerCase() : null;
    const discordUsername = discordUser.username;
    const discordAvatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
      : avatarFor(String(discordUsername));

    // Target user to link: prioritizing stateUserId (authenticated user linking account)
    let user = stateUserId ? db.users.find(u => u.id === stateUserId) : null;
    if (stateUserId && !user) {
      return errorPage('Account Not Found', 'The account you were signed in to no longer exists.');
    }

    // Not linking from a session: use the account already linked to this Discord id, or one with the same VERIFIED e-mail.
    // Admin accounts are never matched by e-mail alone - they must already be linked to this exact Discord account.
    if (!user) {
      user = db.users.find(u => u.discordId && u.discordId === discordId)
        || db.users.find(u => discordEmail && u.email.toLowerCase() === discordEmail && u.role !== 'admin' && u.role !== 'super_admin');
    }

    if (user) {
      if (user.isSuspended) {
        return res.send(`
          <!DOCTYPE html>
          <html>
            <body style="background:#09090b;color:#f87171;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
              <div style="text-align:center;">
                <h2>Account Suspended</h2>
                <p>This account is currently suspended. Please contact support.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </div>
            </body>
          </html>
        `);
      }

      // Unlink discordId from any other account to maintain 1:1 integrity
      db.users.forEach(otherUser => {
        if (otherUser.id !== user!.id && otherUser.discordId === discordId) {
          delete otherUser.discordId;
          otherUser.updatedAt = new Date().toISOString();
          if (db.discordLinks && db.discordLinks[otherUser.id]) {
            delete db.discordLinks[otherUser.id];
          }
        }
      });

      user.discordId = discordId;
      if (!user.avatarUrl || user.avatarUrl.includes('dicebear')) {
        user.avatarUrl = discordAvatar;
      }
      user.updatedAt = new Date().toISOString();

      if (!db.discordLinks) db.discordLinks = {};
      const discordAccountData = {
        discordId,
        username: discordUsername,
        globalName: discordUser.global_name || discordUsername,
        avatar: discordAvatar,
        email: discordEmail || user.email,
        linkedAt: new Date().toISOString()
      };
      db.discordLinks[user.id] = discordAccountData;
      saveDbSync();

      const sessionToken = generateToken(user);
      await createAuditLog(user.id, user.email, user.role, 'DISCORD_ACCOUNT_LINKED', 'DISCORD', `Linked Discord account ${discordUsername} (${discordId})`);

      res.cookie('aether_token', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

      return res.send(`
        <!DOCTYPE html>
        <html>
          <body style="background:#09090b;color:#34d399;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
            <div style="text-align:center;">
              <h2>✅ Welcome, ${escapeHtml(user.displayName)}!</h2>
              <p>Discord account authorized and linked successfully.</p>
              <script>
                (function() {
                  var targetOrigin = ${jsonForScript(targetOrigin)};
                  var userData = ${jsonForScript(user)};
                  var token = ${jsonForScript(sessionToken)};
                  var discordAccount = ${jsonForScript(discordAccountData)};
                  if (window.opener) {
                    var payload = {
                      type: 'MONONODE_DISCORD_OAUTH_SUCCESS',
                      success: true,
                      token: token,
                      user: userData,
                      discordAccount: discordAccount
                    };
                    try { window.opener.postMessage(payload, targetOrigin); } catch (e) {}
                    try { window.opener.postMessage({ ...payload, type: 'DISCORD_AUTH_SUCCESS' }, targetOrigin); } catch (e) {}
                    setTimeout(function() { try { window.close(); } catch(e){} }, 200);
                  } else {
                    document.body.innerHTML = '<div style="text-align:center;padding:30px;"><h2>Discord authorization successful</h2><p>You can close this window and return to MonoNode.</p></div>';
                  }
                })();
              </script>
            </div>
          </body>
        </html>
      `);
    }

    // New user registration via Discord
    if (!db.settings.registrationEnabled) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <body style="background:#09090b;color:#f87171;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
            <div style="text-align:center;">
              <h2>Registration Disabled</h2>
              <p>New user registrations are currently closed by administrator.</p>
              <script>setTimeout(() => window.close(), 3000);</script>
            </div>
          </body>
        </html>
      `);
    }

    let baseUsername = String(discordUsername || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
    if (!baseUsername || baseUsername.length < 3) baseUsername = 'discord_user';

    let uniqueUsername = baseUsername;
    let counter = 1;
    while (db.users.some(u => u.username.toLowerCase() === uniqueUsername.toLowerCase())) {
      uniqueUsername = `${baseUsername}${counter}`;
      counter++;
    }

    const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 10);

    const newUser: User = {
      id: userId,
      username: uniqueUsername,
      displayName: String(discordUser.global_name || discordUsername).slice(0, 60),
      email: discordEmail || `${uniqueUsername}@discord.user`,
      role: 'user',
      avatarUrl: discordAvatar,
      isSuspended: false,
      emailVerified: true,
      twoFactorEnabled: false,
      authProvider: 'discord',
      discordId,
      plan: 'free',
      credits: 10.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.users.push(newUser);
    db.passwords[userId] = passwordHash;
    if (!db.discordLinks) db.discordLinks = {};
    const newDiscordAccount = {
      discordId,
      username: discordUsername,
      globalName: discordUser.global_name || discordUsername,
      avatar: discordAvatar,
      email: discordEmail || newUser.email,
      linkedAt: new Date().toISOString()
    };
    db.discordLinks[userId] = newDiscordAccount;
    saveDbSync();

    const sessionToken = generateToken(newUser);
    await createAuditLog(newUser.id, newUser.email, newUser.role, 'DISCORD_REGISTER', 'ACCOUNT', 'Registered new account with Discord');

    res.cookie('aether_token', sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

    return res.send(`
      <!DOCTYPE html>
      <html>
        <body style="background:#09090b;color:#34d399;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center;">
            <h2>✅ Account Created! Welcome, ${escapeHtml(newUser.displayName)}!</h2>
            <p>Authenticating session...</p>
            <script>
              (function() {
                var targetOrigin = ${jsonForScript(targetOrigin)};
                var userData = ${jsonForScript(newUser)};
                var token = ${jsonForScript(sessionToken)};
                var discordAccount = ${jsonForScript(newDiscordAccount)};
                if (window.opener) {
                  var payload = {
                    type: 'MONONODE_DISCORD_OAUTH_SUCCESS',
                    success: true,
                    token: token,
                    user: userData,
                    discordAccount: discordAccount
                  };
                  try { window.opener.postMessage(payload, targetOrigin); } catch (e) {}
                  try { window.opener.postMessage({ ...payload, type: 'DISCORD_AUTH_SUCCESS' }, targetOrigin); } catch (e) {}
                  setTimeout(function() { try { window.close(); } catch(e){} }, 200);
                } else {
                  document.body.innerHTML = '<div style="text-align:center;padding:30px;"><h2>Discord authorization successful</h2><p>You can close this window and return to MonoNode.</p></div>';
                }
              })();
            </script>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('[Auth] Discord callback failed:', err);
    res.status(500).send('Authentication error. Please close this window and try again.');
  }
});

// GET /api/v1/auth/me
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      user: req.user
    }
  });
});

// POST /api/v1/auth/logout
router.post('/logout', (req: AuthenticatedRequest, res: Response) => {
  res.clearCookie('aether_token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Helper to check for safe URL schemes (http, https, relative)
function isSafeUrl(urlStr?: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return true;
  const trimmed = urlStr.trim().toLowerCase();
  if (trimmed === '') return true;
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('file:') || trimmed.startsWith('vbscript:')) {
    return false;
  }
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\'));
}

// PUT /api/v1/auth/profile
router.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { displayName, avatarUrl } = req.body || {};
    const db = await getDb();
    const user = db.users.find(u => u.id === req.user?.id);

    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

    if ((displayName !== undefined && typeof displayName !== 'string') || (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== 'string')) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid profile data.' } });
    }
    if (typeof avatarUrl === 'string' && avatarUrl.length > 2000) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Avatar URL is too long.' } });
    }

    if (avatarUrl) {
      if (!isSafeUrl(avatarUrl)) {
        return res.status(400).json({ success: false, error: { code: 'UNSAFE_URL', message: 'Avatar URL scheme is unsafe. Only http://, https://, or relative paths are allowed.' } });
      }
      user.avatarUrl = avatarUrl.trim();
    }
    if (displayName && displayName.trim()) user.displayName = displayName.trim().slice(0, 60);
    user.updatedAt = new Date().toISOString();

    saveDbSync();

    res.json({ success: true, data: { user } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// PUT & POST /api/v1/auth/change-password - User voluntary password change
const handleChangePassword = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'New password must be between 8 and 128 characters.' } });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'New passwords do not match.' } });
    }

    const db = await getDb();
    const userId = req.user!.id;
    const currentHash = db.passwords[userId];

    // If user previously set a password, verify current password
    if (currentHash) {
      if (typeof currentPassword !== 'string' || !currentPassword) {
        return res.status(400).json({ success: false, error: { code: 'CURRENT_PASSWORD_REQUIRED', message: 'Current password is required.' } });
      }
      // A stolen session must not be able to guess the current password without limit.
      const guardKey = `chpw:${userId}`;
      const clientIp = getClientIp(req);
      const lock = checkLoginLockout(clientIp, guardKey);
      if (lock.isLocked) {
        res.setHeader('Retry-After', lock.remainingSeconds.toString());
        return res.status(429).json({ success: false, error: { code: 'TOO_MANY_FAILED_ATTEMPTS', message: `Too many incorrect attempts. Try again in ${lock.remainingSeconds} seconds.` } });
      }
      const isMatch = await bcrypt.compare(currentPassword, currentHash);
      if (!isMatch) {
        recordLoginFailure(clientIp, guardKey);
        return res.status(400).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' } });
      }

      // Check if new password is identical to current password
      if (await bcrypt.compare(newPassword, currentHash)) {
        return res.status(400).json({ success: false, error: { code: 'SAME_PASSWORD', message: 'New password cannot be identical to your current password.' } });
      }
    }

    db.passwords[userId] = await bcrypt.hash(newPassword, 10);
    const dbUser = db.users.find(u => u.id === userId);
    if (dbUser) {
      dbUser.mustChangePassword = false;
      // Same default as generateToken (1). The old "|| 0" made the first change land on version 1, so existing tokens stayed valid.
      dbUser.tokenVersion = (dbUser.tokenVersion ?? 1) + 1;
      dbUser.updatedAt = new Date().toISOString();
    }
    saveDbSync();

    await createAuditLog(userId, req.user!.email, req.user!.role, 'CHANGE_PASSWORD', 'SECURITY', 'Password changed successfully');

    // All other sessions are now revoked; hand this one a fresh token so the person changing the password stays signed in.
    const freshToken = dbUser ? generateToken(dbUser) : undefined;
    if (freshToken) res.cookie('aether_token', freshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400000 });

    res.json({ success: true, message: 'Password updated successfully.', data: freshToken ? { token: freshToken } : undefined });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
};

router.put('/change-password', authMiddleware, handleChangePassword);
router.post('/change-password', authMiddleware, handleChangePassword);

export default router;

