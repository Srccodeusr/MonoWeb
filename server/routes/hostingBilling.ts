import { Router, Request, Response } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, createAuditLog, AuthenticatedRequest } from '../auth';
import { Order } from '../../src/types';
import { periodPrice } from '../hosting/plans';
import { newId } from '../hosting/crypto';
import { allow } from '../hosting/ratelimit';
import { userCaps } from '../hosting/serverService';
import { applyCoupon, fulfillHostingOrder, getStripeConfig, publicBaseUrl } from '../hosting/billing';
import { createCheckoutSession, retrieveSession, verifyWebhook } from '../hosting/stripe';

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });

// ===================================================================== public: plans / pricing
export const publicRouter = Router();

publicRouter.get('/plans', async (_req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!;
  const plans = db.hostingPlans.filter(p => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({
    success: true,
    data: {
      currencySymbol: db.settings.currencySymbol || '$', currencyCode: db.settings.currencyCode || 'USD',
      periods: hs.periods,
      plans: plans.map(p => ({ ...p, prices: Object.fromEntries(hs.periods.map(per => [per.id, periodPrice(p, per)])) })),
    },
  });
});

// ===================================================================== authed
const router = Router();
router.use(authMiddleware);

router.get('/me', async (req: AuthenticatedRequest, res) => {
  const db = await getDb();
  const caps = userCaps(db, req.user!);
  res.json({ success: true, data: { planId: caps.plan.id, planName: caps.plan.name, isFree: caps.plan.isFree, expiresAt: req.user!.planExpiresAt, tempPlan: req.user!.tempPlan, stripe: !!getStripeConfig(db), methods: methodsFor(db) } });
});

function methodsFor(db: Awaited<ReturnType<typeof getDb>>) {
  const g: any = db.settings.paymentGateways || {};
  return {
    stripe: !!getStripeConfig(db), credits: true,
    upi: !!g.upi?.enabled, bank: !!g.bank?.enabled, crypto: !!g.crypto?.enabled, giftCard: !!g.giftCard?.enabled,
    instructions: { upi: g.upi?.enabled ? { upiId: g.upi.upiId, merchantName: g.upi.merchantName, qrCodeUrl: g.upi.qrCodeUrl, text: g.upi.instructions } : undefined, bank: g.bank?.enabled ? { bankName: g.bank.bankName, accountNumber: g.bank.accountNumber, ifsc: g.bank.ifsc, accountHolder: g.bank.accountHolder, text: g.bank.instructions } : undefined, crypto: g.crypto?.enabled ? { walletAddress: g.crypto.walletAddress, network: g.crypto.network, text: g.crypto.instructions } : undefined },
  };
}

router.post('/checkout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!allow(`hcheckout:${req.user!.id}`, 10, 10 * 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many checkout attempts. Please wait.');
    const db = await getDb(); const hs = db.settings.hosting!;
    const user = db.users.find(u => u.id === req.user!.id)!;
    const plan = db.hostingPlans.find(p => p.id === req.body?.planId && p.isActive);
    const period = hs.periods.find(p => p.id === req.body?.periodId);
    if (!plan || plan.isFree) return err(res, 404, 'PLAN_NOT_FOUND', 'That plan is not available.');
    if (!period) return err(res, 400, 'PERIOD_REQUIRED', 'Choose a billing period.');
    const method = String(req.body?.method || '');

    let price = periodPrice(plan, period).total;
    let coupon;
    try { ({ price, coupon } = applyCoupon(db, req.body?.coupon, price)); } catch (e: any) { return err(res, e.status || 400, e.code || 'COUPON', e.message); }

    const base: Order = {
      id: newId('ord'), userId: user.id, userEmail: user.email, planId: plan.id, planName: `${plan.name} (${period.label})`, billingCycle: period.months >= 12 ? 'yearly' : 'monthly',
      kind: 'hosting_plan', hostingPlanId: plan.id, hostingPeriodId: period.id, amount: price, currency: db.settings.currencyCode || 'USD', status: 'pending', paymentMethod: method,
      couponCode: coupon?.code, createdAt: new Date().toISOString(),
    };

    if (price <= 0) { // fully discounted
      base.paymentMethod = 'Coupon'; db.orders.unshift(base); await fulfillHostingOrder(db, base);
      return res.json({ success: true, data: { orderId: base.id, status: 'paid' } });
    }

    if (method === 'credits') {
      if (user.credits < price) return err(res, 402, 'INSUFFICIENT_CREDITS', `You need ${db.settings.currencySymbol || '$'}${price.toFixed(2)} in credits (balance ${db.settings.currencySymbol || '$'}${user.credits.toFixed(2)}).`);
      user.credits = Math.round((user.credits - price) * 100) / 100;
      base.paymentMethod = 'Account Credits'; db.orders.unshift(base);
      await fulfillHostingOrder(db, base);
      await createAuditLog(user.id, user.email, user.role, 'HOSTING_PLAN_PURCHASED', base.id, `Bought ${base.planName} with credits`);
      return res.json({ success: true, data: { orderId: base.id, status: 'paid' } });
    }

    if (method === 'stripe') {
      const cfg = getStripeConfig(db);
      if (!cfg) return err(res, 400, 'STRIPE_DISABLED', 'Card payments are not available right now.');
      base.paymentMethod = 'Stripe (Card)';
      db.orders.unshift(base); saveDbSync();
      const origin = publicBaseUrl(req);
      try {
        const session = await createCheckoutSession(cfg, {
          orderId: base.id, userId: user.id, email: user.email, name: `${plan.name} - ${period.label}`, description: plan.tagline, amount: price,
          // After payment the customer lands directly on the server overview (the old dashboard no longer exists).
          successUrl: `${origin}/servers?paid=1&order=${base.id}`, cancelUrl: `${origin}/upgrade?cancelled=1`,
        });
        base.stripeSessionId = session.id; saveDbSync();
        return res.json({ success: true, data: { orderId: base.id, status: 'pending', redirectUrl: session.url } });
      } catch (e: any) {
        base.status = 'failed'; base.adminNote = `Stripe error: ${e.message}`; saveDbSync();
        return err(res, 502, 'STRIPE_ERROR', e.message || 'Could not start card checkout.');
      }
    }

    // Manual gateways (UPI / bank / crypto / gift card): pending until staff approve (same queue as today).
    const ref = typeof req.body?.transactionRef === 'string' ? req.body.transactionRef.trim().slice(0, 200) : '';
    const g: any = db.settings.paymentGateways || {};
    const allowed = { upi: g.upi?.enabled, bank: g.bank?.enabled, crypto: g.crypto?.enabled, giftcard: g.giftCard?.enabled } as Record<string, boolean>;
    if (!allowed[method]) return err(res, 400, 'METHOD_UNAVAILABLE', 'That payment method is not available.');
    if (!ref) return err(res, 400, 'REF_REQUIRED', 'Enter your transaction reference / gift card code.');
    if (db.orders.some(o => o.userId === user.id && o.kind === 'hosting_plan' && o.status === 'pending' && o.hostingPlanId === plan.id && !o.stripeSessionId)) return err(res, 400, 'DUPLICATE_PENDING', 'You already have a pending order for this plan awaiting verification.');
    base.paymentMethod = { upi: 'UPI', bank: 'Bank Transfer', crypto: 'Crypto', giftcard: 'Gift Card' }[method]!; base.transactionRef = ref;
    db.orders.unshift(base); saveDbSync();
    await createAuditLog(user.id, user.email, user.role, 'HOSTING_ORDER_SUBMITTED', base.id, `Submitted ${base.paymentMethod} order for ${base.planName}`);
    res.json({ success: true, data: { orderId: base.id, status: 'pending', pendingApproval: true } });
  } catch (e: any) {
    console.error('[HostingBilling] checkout', e?.message || e);
    err(res, 500, 'INTERNAL', 'Checkout failed. Please try again.');
  }
});

// Polled by the overview page after Stripe redirects back. Falls back to asking Stripe directly if the webhook is late.
router.get('/orders/:id', async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const order = db.orders.find(o => o.id === req.params.id && o.userId === req.user!.id && o.kind === 'hosting_plan');
  if (!order) return err(res, 404, 'NOT_FOUND', 'Order not found.');
  if (order.status === 'pending' && order.stripeSessionId && req.query.sync === '1' && allow(`osync:${order.id}`, 6, 60_000)) {
    const cfg = getStripeConfig(db);
    if (cfg) {
      try {
        const s = await retrieveSession(cfg, order.stripeSessionId);
        if (s.payment_status === 'paid' && s.client_reference_id === order.id && s.amount_total === Math.round(order.amount * 100) && String(s.currency).toLowerCase() === cfg.currency) await fulfillHostingOrder(db, order);
        else if (s.status === 'expired') { order.status = 'failed'; saveDbSync(); }
      } catch { /* keep pending */ }
    }
  }
  res.json({ success: true, data: { id: order.id, status: order.status, planName: order.planName, amount: order.amount } });
});

router.get('/orders', async (req: AuthenticatedRequest, res) => {
  const db = await getDb();
  res.json({ success: true, data: db.orders.filter(o => o.userId === req.user!.id && o.kind === 'hosting_plan').map(o => ({ id: o.id, planName: o.planName, amount: o.amount, status: o.status, method: o.paymentMethod, createdAt: o.createdAt })) });
});

export default router;

// ===================================================================== Stripe webhook (RAW body; mounted before express.json)
export async function stripeWebhook(req: Request, res: Response) {
  try {
    const db = await getDb();
    const cfg = getStripeConfig(db);
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!cfg?.webhookSecret || !verifyWebhook(raw, req.headers['stripe-signature'] as string | undefined, cfg.webhookSecret)) {
      return res.status(400).json({ success: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid signature.' } });
    }
    const event = JSON.parse(raw.toString('utf8'));
    if (db.processedWebhooks.includes(event.id)) return res.json({ received: true, duplicate: true });

    const obj = event.data?.object || {};
    const orderId = obj.client_reference_id || obj.metadata?.orderId;
    const order = db.orders.find(o => o.id === orderId && o.kind === 'hosting_plan');
    if (order && order.status === 'pending') {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const amountOk = obj.amount_total === Math.round(order.amount * 100) && String(obj.currency).toLowerCase() === cfg.currency;
        if (obj.payment_status === 'paid' && amountOk && (!order.stripeSessionId || order.stripeSessionId === obj.id)) await fulfillHostingOrder(db, order);
        else if (obj.payment_status === 'paid' && !amountOk) { order.adminNote = 'Stripe amount/currency mismatch - needs manual review.'; saveDbSync(); }
      } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') { order.status = 'failed'; saveDbSync(); }
    }
    db.processedWebhooks.push(event.id);
    if (db.processedWebhooks.length > 2000) db.processedWebhooks = db.processedWebhooks.slice(-1000);
    saveDbSync();
    res.json({ received: true });
  } catch (e: any) {
    console.error('[Stripe webhook]', e?.message || e);
    res.status(500).json({ success: false });
  }
}
