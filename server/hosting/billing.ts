import { Request } from 'express';
import { DatabaseSchema, saveDbSync } from '../db';
import { Order } from '../../src/types';
import { BillingPeriod, HostServer, HostingPlan } from '../../src/hostingTypes';
import { decryptSecret } from './crypto';
import { periodEndDate, periodPrice } from './plans';
import { pushSpec } from './serverService';
import { StripeConfig } from './stripe';

export function getStripeConfig(db: DatabaseSchema): (StripeConfig & { publishableKey: string; enabled: boolean }) | null {
  const g: any = db.settings.paymentGateways?.stripe;
  if (!g?.enabled || !g.secretKey) return null;
  return { enabled: true, secretKey: decryptSecret(g.secretKey), webhookSecret: decryptSecret(g.webhookSecret || ''), currency: (g.currency || db.settings.currencyCode || 'usd').toLowerCase(), publishableKey: g.publishableKey || '' };
}

/** Public origin used for Stripe redirect URLs. APP_URL wins; Host header is only trusted outside production. */
export function publicBaseUrl(req: Request): string {
  const env = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  if (process.env.NODE_ENV === 'production') throw new Error('APP_URL must be set in production for payment redirects.');
  return `${req.protocol}://${req.get('host')}`;
}

export function applyCoupon(db: DatabaseSchema, code: string | undefined, price: number): { price: number; coupon?: (typeof db.coupons)[number] } {
  if (!code || !String(code).trim()) return { price };
  const c = db.coupons.find(x => x.code.toUpperCase() === String(code).trim().toUpperCase() && x.isActive);
  if (!c) throw Object.assign(new Error('Invalid or expired promotional code.'), { status: 404, code: 'INVALID_COUPON' });
  if (c.usageLimit && c.timesUsed >= c.usageLimit) throw Object.assign(new Error('Promotional code has reached its maximum usage limit.'), { status: 400, code: 'COUPON_EXHAUSTED' });
  const p = c.discountType === 'percent' ? price * (1 - c.discountValue / 100) : price - c.discountValue;
  return { price: Math.max(0, Math.round(p * 100) / 100), coupon: c };
}

export function quote(plan: HostingPlan, period: BillingPeriod) { return periodPrice(plan, period); }

/**
 * Idempotently turns a paid hosting order into an active plan:
 *  - sets/extends the account's plan (stacks on remaining time of the same plan)
 *  - lifts the user's existing servers to the new plan's specs and ties their expiry to the plan end
 */
export async function fulfillHostingOrder(db: DatabaseSchema, order: Order): Promise<void> {
  if ((order as any).fulfilledAt) return;
  const user = db.users.find(u => u.id === order.userId);
  const plan = db.hostingPlans.find(p => p.id === order.hostingPlanId);
  const period = db.settings.hosting!.periods.find(p => p.id === order.hostingPeriodId);
  order.status = 'paid';
  (order as any).fulfilledAt = new Date().toISOString();
  if (!user || !plan || !period) { saveDbSync(); return; }

  const now = new Date();
  const stackFrom = user.hostingPlanId === plan.id && user.planExpiresAt && new Date(user.planExpiresAt) > now ? new Date(user.planExpiresAt) : now;
  user.hostingPlanId = plan.id;
  user.planExpiresAt = periodEndDate(stackFrom, period).toISOString();
  user.plan = plan.id;
  user.updatedAt = now.toISOString();
  if (order.couponCode) { const c = db.coupons.find(x => x.code === order.couponCode); if (c) c.timesUsed = (c.timesUsed || 0) + 1; }

  const toPush: HostServer[] = [];
  for (const s of db.servers.filter(x => x.ownerId === user.id && !x.entitlementId)) {
    const ps = plan.perServer;
    s.limits = { ramMB: Math.max(s.limits.ramMB, ps.ramMB), cpuPercent: Math.max(s.limits.cpuPercent, ps.cpuPercent), diskMB: Math.max(s.limits.diskMB, ps.diskMB), swapMB: Math.max(s.limits.swapMB, ps.swapMB), pids: Math.max(s.limits.pids, ps.pids), backups: Math.max(s.limits.backups, ps.backups), databases: Math.max(s.limits.databases, ps.databases) };
    s.planId = plan.id;
    s.expiresAt = user.planExpiresAt; s.expiredAt = undefined; s.notifiedExpiry = false;
    if (s.status === 'expired') s.status = 'offline';
    toPush.push(s);
  }
  saveDbSync();
  await Promise.allSettled(toPush.map(s => pushSpec(db, s)));
}
