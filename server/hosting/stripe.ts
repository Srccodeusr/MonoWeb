import crypto from 'crypto';

/**
 * Stripe Checkout over plain REST: no SDK, so the platform stays light.
 * Money only moves after the signed webhook confirms payment (never trust the browser redirect).
 */
const API = 'https://api.stripe.com/v1';

export interface StripeConfig { secretKey: string; webhookSecret: string; currency: string }

function form(obj: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') p.append(k, String(v));
  return p.toString();
}

async function stripeFetch(cfg: Pick<StripeConfig, 'secretKey'>, method: 'GET' | 'POST', path: string, params?: Record<string, any>): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.secretKey}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? form(params || {}) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe HTTP ${res.status}`);
  return json;
}

/** Validates the secret key and reports the account + mode so the admin gets instant feedback. */
export async function testStripe(cfg: Pick<StripeConfig, 'secretKey'>): Promise<{ accountId: string; livemode: boolean; country?: string; chargesEnabled?: boolean }> {
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(cfg.secretKey)) throw new Error('That does not look like a Stripe secret key (expected sk_test_… or sk_live_…).');
  const acct = await stripeFetch(cfg, 'GET', '/account');
  return { accountId: acct.id, livemode: cfg.secretKey.includes('_live_'), country: acct.country, chargesEnabled: acct.charges_enabled };
}

export interface CheckoutInput {
  orderId: string;
  userId: string;
  email: string;
  name: string;           // line item name
  description?: string;
  amount: number;         // major units, e.g. 2.5
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(cfg: StripeConfig, i: CheckoutInput): Promise<{ id: string; url: string }> {
  const cents = Math.round(i.amount * 100);
  if (cents < 50) throw new Error('Stripe requires a minimum charge of 0.50.');
  const s = await stripeFetch(cfg, 'POST', '/checkout/sessions', {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    customer_email: i.email,
    client_reference_id: i.orderId,
    'metadata[orderId]': i.orderId,
    'metadata[userId]': i.userId,
    'payment_intent_data[metadata][orderId]': i.orderId,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': cfg.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': cents,
    'line_items[0][price_data][product_data][name]': i.name.slice(0, 120),
    'line_items[0][price_data][product_data][description]': i.description?.slice(0, 300),
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  if (!s.url) throw new Error('Stripe did not return a checkout URL.');
  return { id: s.id, url: s.url };
}

export async function retrieveSession(cfg: Pick<StripeConfig, 'secretKey'>, id: string): Promise<any> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new Error('Bad session id');
  return stripeFetch(cfg, 'GET', `/checkout/sessions/${id}`);
}

/**
 * Verify a Stripe-Signature header against the RAW request body.
 * Header: t=timestamp,v1=hexsig[,v1=...]. Signed payload: `${t}.${raw}`. 5 minute tolerance.
 */
export function verifyWebhook(raw: Buffer, header: string | undefined, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = parts.find(p => p[0] === 't')?.[1];
  const sigs = parts.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return sigs.some(s => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    const b = Buffer.from(s, 'hex');
    return b.length === expected.length && crypto.timingSafeEqual(b, expected);
  });
}
