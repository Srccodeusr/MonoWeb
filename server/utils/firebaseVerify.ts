import jwt from 'jsonwebtoken';

/**
 * Verifies a Firebase Auth ID token the way Google documents it: RS256 signature against Google's published
 * certificates (matched by the token's `kid`), plus issuer, audience (= Firebase project id), expiry and subject.
 * Previously the server only base64-decoded the payload, so anyone could forge a token for any e-mail address.
 */

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && certCache && certCache.expiresAt > Date.now()) return certCache.certs;
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Could not load Google signing certificates (HTTP ${res.status}).`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1];
  certCache = { certs, expiresAt: Date.now() + Math.max(60, Number(maxAge) || 3600) * 1000 };
  return certs;
}

export interface FirebaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

export class FirebaseTokenError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function verifyFirebaseIdToken(idToken: string, projectId: string): Promise<FirebaseClaims> {
  if (!projectId) throw new FirebaseTokenError('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server (missing Firebase project id).');

  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded && typeof decoded === 'object' ? (decoded.header as any)?.kid : undefined;
  if (!kid) throw new FirebaseTokenError('INVALID_ID_TOKEN', 'Malformed Firebase ID token.');

  let certs = await getCerts();
  if (!certs[kid]) certs = await getCerts(true); // Google rotates keys; refresh once before giving up
  if (!certs[kid]) throw new FirebaseTokenError('INVALID_ID_TOKEN', 'Firebase ID token was signed with an unknown key.');

  let payload: any;
  try {
    payload = jwt.verify(idToken, certs[kid], {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') throw new FirebaseTokenError('ID_TOKEN_EXPIRED', 'Firebase ID token has expired. Please sign in again.');
    throw new FirebaseTokenError('INVALID_ID_TOKEN', 'Firebase ID token could not be verified.');
  }

  if (typeof payload.sub !== 'string' || !payload.sub) throw new FirebaseTokenError('INVALID_ID_TOKEN', 'Firebase ID token has no subject.');
  if (typeof payload.email !== 'string' || !payload.email) throw new FirebaseTokenError('EMAIL_REQUIRED', 'No e-mail address is attached to this Google account.');

  return {
    uid: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' && /^https:\/\//i.test(payload.picture) ? payload.picture : '',
  };
}
