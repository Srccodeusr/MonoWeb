import { Router, Response } from 'express';
import { getDb, saveDbSync } from '../db';
import { authMiddleware, createAuditLog, AuthenticatedRequest } from '../auth';
import { createProvisionRecord, runProvisioning } from '../services/provisioningService';
import { peekEphemeralSecret } from '../services/ephemeralSecrets';
import { Order } from '../../src/types';

const router = Router();

/** Why a coupon can't be used right now (revoked / expired), or null when it is fine. */
function couponUnusable(coupon: { status?: string; expiresAt?: string }): string | null {
  if (coupon.status === 'revoked') return 'Invalid or expired promotional code.';
  if (coupon.expiresAt) {
    const t = new Date(coupon.expiresAt).getTime();
    if (!isNaN(t) && t < Date.now()) return 'This promotional code has expired.';
  }
  return null;
}

/** A coupon code from untrusted input as a clean string ('' when it isn't one). */
function cleanCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 64) : '';
}

// GET /api/v1/billing/orders
router.get('/orders', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const userOrders = db.orders.filter(o => o.userId === req.user!.id);
  res.json({ success: true, data: userOrders });
});

// POST /api/v1/billing/coupons/validate - Check a coupon without redeeming it
router.post('/coupons/validate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const code = cleanCode(req.body?.code);
  if (!code) return res.status(400).json({ success: false, error: { code: 'CODE_REQUIRED', message: 'Coupon code required' } });

  const db = await getDb();
  const coupon = db.coupons.find(c => c.code.toUpperCase() === code.toUpperCase() && c.isActive);

  if (!coupon) {
    return res.status(404).json({ success: false, error: { code: 'INVALID_COUPON', message: 'Invalid or expired promotional code.' } });
  }
  const unusable = couponUnusable(coupon);
  if (unusable) return res.status(400).json({ success: false, error: { code: 'INVALID_COUPON', message: unusable } });

  if (coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit) {
    return res.status(400).json({ success: false, error: { code: 'COUPON_EXHAUSTED', message: 'Promotional code has reached its maximum usage limit.' } });
  }

  res.json({
    success: true,
    data: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue }
  });
});

// POST /api/v1/billing/redeem-coupon - Validate and apply a coupon to the user's account credits
router.post('/redeem-coupon', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const code = cleanCode(req.body?.code);
  if (!code) {
    return res.status(400).json({ success: false, error: { code: 'CODE_REQUIRED', message: 'Coupon code required' } });
  }

  const db = await getDb();
  const coupon = db.coupons.find(c => c.code.toUpperCase() === code.toUpperCase() && c.isActive);

  if (!coupon) {
    return res.status(404).json({ success: false, error: { code: 'INVALID_COUPON', message: 'Invalid or expired promotional code.' } });
  }
  const unusable = couponUnusable(coupon);
  if (unusable) return res.status(400).json({ success: false, error: { code: 'INVALID_COUPON', message: unusable } });

  if (coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit) {
    return res.status(400).json({ success: false, error: { code: 'COUPON_EXHAUSTED', message: 'Promotional code has reached its maximum usage limit.' } });
  }

  const user = db.users.find(u => u.id === req.user!.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

  // Fixed-value coupons are applied directly as account credits.
  // Percent coupons have no purchase to discount here, so they are validated but not auto-applied as credits.
  if (coupon.discountType === 'fixed') {
    // One redemption per account: without this a single fixed coupon could be redeemed in a loop for unlimited credits.
    const redeemedBy: string[] = ((coupon as any).redeemedBy ||= []);
    if (redeemedBy.includes(user.id)) {
      return res.status(400).json({ success: false, error: { code: 'COUPON_ALREADY_USED', message: 'You have already redeemed this promotional code.' } });
    }
    redeemedBy.push(user.id);
    user.credits = parseFloat(((user.credits || 0) + coupon.discountValue).toFixed(2));
    coupon.timesUsed = (coupon.timesUsed || 0) + 1;
    user.updatedAt = new Date().toISOString();
    saveDbSync();

    await createAuditLog(user.id, user.email, user.role, 'COUPON_REDEEMED', coupon.id, `Redeemed coupon '${coupon.code}' for $${coupon.discountValue.toFixed(2)} credits`);

    return res.json({
      success: true,
      message: `Coupon redeemed! $${coupon.discountValue.toFixed(2)} added to your account credits.`,
      data: { newBalance: user.credits, coupon: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue } }
    });
  }

  res.json({
    success: true,
    message: `Coupon '${coupon.code}' is valid for ${coupon.discountValue}% off at checkout.`,
    data: { coupon: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue } }
  });
});

// GET /api/v1/billing/payment-methods
router.get('/payment-methods', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  res.json({
    success: true,
    data: db.settings.paymentGateways || {
      upi: { enabled: false, upiId: '', merchantName: '', qrCodeUrl: '', instructions: '' },
      bank: { enabled: false, bankName: '', accountNumber: '', ifsc: '', accountHolder: '', instructions: '' },
      crypto: { enabled: false, walletAddress: '', network: '', instructions: '' },
      stripe: { enabled: false, instructions: '' },
      giftCard: { enabled: false, amazonEnabled: false, amazonInstructions: '', playStoreEnabled: false, playStoreInstructions: '' }
    }
  });
});

// POST /api/v1/billing/add-credits
//
// EVERY deposit lands as 'pending' and is only credited when a staff member
// approves it (POST /admin/orders/:id/approve). There is no payment processor
// wired into this app, so nothing here can be trusted to have actually been
// paid until a human has checked the UTR / reference / gift card code.
router.post('/add-credits', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { amount, paymentMethod, transactionRef, proofUrl, methodType, giftCardType } = req.body;
  const numAmount = Number(amount);

  if (!Number.isFinite(numAmount) || numAmount < 1) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_AMOUNT', message: 'Minimum deposit amount is $1.00.' } });
  }
  if (numAmount > 100000) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_AMOUNT', message: 'Maximum deposit amount is $100,000.' } });
  }

  const db = await getDb();
  const user = db.users.find(u => u.id === req.user!.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

  const normalizedType = String(methodType || '').toLowerCase();
  const normalizedLabel = String(paymentMethod || '').toLowerCase();
  const isGiftCard = normalizedType === 'giftcard' || normalizedLabel.includes('gift card');

  // "Instant Card" used to credit the balance immediately without any payment
  // being taken. Until a real card processor is integrated it must not be
  // possible to mint credits this way.
  const isCard = !isGiftCard && (normalizedType === 'stripe' || normalizedLabel.includes('stripe') || normalizedLabel.includes('card'));
  if (isCard) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'CARD_UNAVAILABLE',
        message: 'Instant card payments are not available. Please pay with UPI, bank transfer, crypto or a gift card — your credits are added once a staff member verifies the payment.'
      }
    });
  }

  const resolvedGiftCardType: 'amazon' | 'playstore' | undefined = isGiftCard
    ? (giftCardType === 'playstore' ? 'playstore' : 'amazon')
    : undefined;

  const ref = typeof transactionRef === 'string' ? transactionRef.trim().slice(0, 200) : '';
  if (!ref) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'REF_REQUIRED',
        message: isGiftCard
          ? 'Please enter the gift card code before submitting.'
          : 'Please provide Transaction Reference / UTR Number after completing payment.'
      }
    });
  }

  const order: Order = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: user.id,
    userEmail: user.email,
    planId: 'credit_deposit',
    planName: 'Account Credits Deposit',
    billingCycle: 'monthly',
    amount: numAmount,
    currency: db.settings.currencyCode || 'USD',
    status: 'pending',
    paymentMethod: paymentMethod || 'Manual Payment',
    transactionRef: ref,
    giftCardType: resolvedGiftCardType,
    proofUrl: typeof proofUrl === 'string' && /^https?:\/\//i.test(proofUrl.trim()) ? proofUrl.trim().slice(0, 500) : undefined, // only http(s): a javascript: link would run when staff click it
    createdAt: new Date().toISOString()
  };

  db.orders.unshift(order);
  saveDbSync();

  await createAuditLog(user.id, user.email, user.role, 'DEPOSIT_SUBMITTED', order.id, `Submitted ${order.paymentMethod} deposit of $${numAmount.toFixed(2)} (ref ${ref}) — awaiting staff verification`);

  res.json({
    success: true,
    message: isGiftCard
      ? `Gift card code submitted for verification! Our team will verify it and credit $${numAmount.toFixed(2)} to your balance once approved.`
      : `Payment submitted for verification! Transaction Ref: ${ref}. Admin will verify and credit $${numAmount.toFixed(2)} shortly.`,
    data: { newBalance: user.credits, order, pendingApproval: true }
  });
});

// POST /api/v1/billing/checkout - Purchase a plan.
//
// Paid plans NEVER activate on their own: whichever way the customer pays
// (Account Credits or a Gift Card code) the order is created as 'pending' and a
// staff member has to approve it from Admin > Platform Configuration > Pending
// Orders. Approving is what starts provisioning (auto-create on a linked panel,
// or "staff mails the credentials" when no panel is linked); rejecting refunds
// any credits that were held.
//
//   - Account Credits: the price is deducted (held) straight away so the
//     customer can't spend the same balance twice; rejecting gives it back.
//   - Gift Card: no credits are touched; the staff member verifies the code.
//   - Free plans ($0) have no payment to verify, so they activate immediately.
router.post('/checkout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const {
    planId, billingCycle, couponCode, serverName, serverDescription,
    selectedEggOptionId, selectedLocationOptionId,
    paymentMethod, giftCardType, transactionRef
  } = req.body || {};

  if (!planId) {
    return res.status(400).json({ success: false, error: { code: 'PLAN_REQUIRED', message: 'A plan is required to check out.' } });
  }
  const cycle: 'monthly' | 'yearly' = billingCycle === 'yearly' ? 'yearly' : 'monthly';
  const isGiftCard = String(paymentMethod || '').toLowerCase() === 'giftcard';
  const giftCardCode = typeof transactionRef === 'string' ? transactionRef.trim() : '';

  if (isGiftCard && !giftCardCode) {
    return res.status(400).json({ success: false, error: { code: 'REF_REQUIRED', message: 'Please enter the gift card code before submitting.' } });
  }

  const db = await getDb();
  const plan = db.plans.find(p => p.id === planId && p.isActive);
  if (!plan) {
    return res.status(404).json({ success: false, error: { code: 'PLAN_NOT_FOUND', message: 'That plan is not available.' } });
  }
  const product = db.products.find(p => p.id === plan.productId);
  if (!product) {
    return res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'That plan has no associated product.' } });
  }

  // --- Resolve/validate the customer's deployment choices against what this
  // product actually offers. Auto-resolved when there's only one option;
  // required from the client when there's more than one; skipped entirely
  // when the product has none configured (falls back to manual setup later).
  const eggOptions = product.panelEggOptions || [];
  let resolvedEggOptionId: string | undefined;
  if (eggOptions.length > 1) {
    const match = eggOptions.find(o => o.id === selectedEggOptionId);
    if (!match) {
      return res.status(400).json({ success: false, error: { code: 'EGG_OPTION_REQUIRED', message: 'Choose which application to deploy.' } });
    }
    resolvedEggOptionId = match.id;
  } else if (eggOptions.length === 1) {
    resolvedEggOptionId = eggOptions[0].id;
  }

  const locationOptions = product.panelLocationOptions || [];
  let resolvedLocationOptionId: string | undefined;
  if (locationOptions.length > 1) {
    const match = locationOptions.find(o => o.id === selectedLocationOptionId);
    if (!match) {
      return res.status(400).json({ success: false, error: { code: 'LOCATION_OPTION_REQUIRED', message: 'Choose a deploy location.' } });
    }
    resolvedLocationOptionId = match.id;
  } else if (locationOptions.length === 1) {
    resolvedLocationOptionId = locationOptions[0].id;
  }

  const trimmedServerName = typeof serverName === 'string' ? serverName.trim().slice(0, 60) : '';
  const trimmedServerDescription = typeof serverDescription === 'string' ? serverDescription.trim().slice(0, 250) : '';

  const user = db.users.find(u => u.id === req.user!.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });

  // Orders this customer already has waiting for staff approval for this plan.
  const pendingForPlan = db.orders.filter(o => o.userId === user.id && o.planId === plan.id && o.status === 'pending').length;

  if (isGiftCard) {
    // Guard against stacking up duplicate pending gift card requests for the same plan.
    if (pendingForPlan > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'DUPLICATE_PENDING', message: `You already have a pending order for '${plan.name}' awaiting verification.` }
      });
    }
  } else {
    // Enforce the plan's server-slot limit using this user's provisioning history
    // for this plan, plus any orders still waiting for approval.
    const activeStatuses = new Set(['pending', 'creating_account', 'creating_server', 'completed', 'awaiting_manual_setup']);
    const existingForPlan = db.provisions.filter(p => p.userId === user.id && p.planId === plan.id && activeStatuses.has(p.status)).length;
    if (plan.serverLimit && existingForPlan + pendingForPlan >= plan.serverLimit) {
      return res.status(400).json({
        success: false,
        error: { code: 'PLAN_LIMIT_REACHED', message: `You've already reached the server limit (${plan.serverLimit}) for the '${plan.name}' plan.` }
      });
    }
  }

  let price = cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
  let appliedCoupon: (typeof db.coupons)[number] | null = null;

  if (couponCode && String(couponCode).trim()) {
    const coupon = db.coupons.find(c => c.code.toUpperCase() === String(couponCode).trim().toUpperCase() && c.isActive);
    if (!coupon) {
      return res.status(404).json({ success: false, error: { code: 'INVALID_COUPON', message: 'Invalid or expired promotional code.' } });
    }
    const couponProblem = couponUnusable(coupon);
    if (couponProblem) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_COUPON', message: couponProblem } });
    }
    if (coupon.usageLimit && coupon.timesUsed >= coupon.usageLimit) {
      return res.status(400).json({ success: false, error: { code: 'COUPON_EXHAUSTED', message: 'Promotional code has reached its maximum usage limit.' } });
    }
    price = coupon.discountType === 'percent'
      ? parseFloat((price * (1 - Math.min(100, Math.max(0, coupon.discountValue)) / 100)).toFixed(2))
      : Math.max(0, parseFloat((price - coupon.discountValue).toFixed(2)));
    appliedCoupon = coupon;
  }

  const couponNote = appliedCoupon
    ? `Coupon '${appliedCoupon.code}' applied (${appliedCoupon.discountType === 'percent' ? appliedCoupon.discountValue + '%' : '$' + appliedCoupon.discountValue} off)`
    : undefined;

  const baseOrder = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: user.id,
    userEmail: user.email,
    planId: plan.id,
    planName: plan.name,
    productId: product.id,
    billingCycle: cycle,
    amount: price,
    currency: db.settings.currencyCode || 'USD',
    couponCode: appliedCoupon?.code,
    adminNote: couponNote,
    serverName: trimmedServerName || undefined,
    serverDescription: trimmedServerDescription || undefined,
    selectedEggOptionId: resolvedEggOptionId,
    selectedLocationOptionId: resolvedLocationOptionId,
    createdAt: new Date().toISOString()
  };

  // --- Free plan (after any coupon): nothing to verify, activate straight away.
  if (price <= 0) {
    if (appliedCoupon) appliedCoupon.timesUsed = (appliedCoupon.timesUsed || 0) + 1;

    const order: Order = {
      ...baseOrder,
      status: 'paid',
      paymentMethod: 'Free Plan'
    };
    user.plan = plan.id;
    user.updatedAt = new Date().toISOString();
    db.orders.unshift(order);
    saveDbSync();

    await createAuditLog(user.id, user.email, user.role, 'PLAN_PURCHASED', order.id, `Activated free plan '${plan.name}' (${cycle})`);

    const provisionRecord = await createProvisionRecord(order, user, plan, product);
    order.provisionId = provisionRecord.id;
    saveDbSync();

    runProvisioning(provisionRecord.id).catch(() => { /* runProvisioning already handles its own errors */ });

    return res.json({
      success: true,
      message: 'Free plan activated.',
      data: { order, provisionId: provisionRecord.id, newBalance: user.credits }
    });
  }

  // --- Gift Card: pending order, no credits touched. Staff verify the code.
  if (isGiftCard) {
    if (appliedCoupon) appliedCoupon.timesUsed = (appliedCoupon.timesUsed || 0) + 1;

    const order: Order = {
      ...baseOrder,
      status: 'pending',
      paymentMethod: `Gift Card - ${giftCardType === 'playstore' ? 'Google Play' : 'Amazon'}`,
      transactionRef: giftCardCode,
      giftCardType: giftCardType === 'playstore' ? 'playstore' : 'amazon'
    };
    db.orders.unshift(order);
    saveDbSync();

    await createAuditLog(user.id, user.email, user.role, 'PLAN_ORDER_SUBMITTED', order.id, `Submitted gift card order for plan '${plan.name}' (${cycle}), $${price.toFixed(2)} — awaiting staff verification`);

    return res.json({
      success: true,
      message: `Payment submitted! A staff member will verify your gift card and send your credentials for '${plan.name}' once approved.`,
      data: { order, pendingApproval: true, newBalance: user.credits }
    });
  }

  // --- Account Credits: hold the price now, staff approve (or reject + refund) later.
  if (user.credits < price) {
    return res.status(402).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: `You need $${price.toFixed(2)} in account credits for this plan, but your balance is $${user.credits.toFixed(2)}. Add $${(price - user.credits).toFixed(2)} more to continue.`
      }
    });
  }

  user.credits = parseFloat((user.credits - price).toFixed(2));
  user.updatedAt = new Date().toISOString();
  if (appliedCoupon) appliedCoupon.timesUsed = (appliedCoupon.timesUsed || 0) + 1;

  const order: Order = {
    ...baseOrder,
    status: 'pending',
    paymentMethod: 'Account Credits',
    creditsHeld: true
  };
  db.orders.unshift(order);
  saveDbSync();

  await createAuditLog(user.id, user.email, user.role, 'PLAN_ORDER_SUBMITTED', order.id, `Paid $${price.toFixed(2)} in credits for plan '${plan.name}' (${cycle}) — awaiting staff approval`);

  res.json({
    success: true,
    message: `Payment of $${price.toFixed(2)} received. A staff member will verify your order and send your credentials.`,
    data: { order, pendingApproval: true, newBalance: user.credits }
  });
});

// GET /api/v1/billing/provision/:id - Poll provisioning status for the checkout loading screen
router.get('/provision/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const db = await getDb();
  const record = db.provisions.find(p => p.id === req.params.id);
  if (!record) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Provisioning record not found.' } });
  }

  const isOwner = record.userId === req.user!.id;
  const isStaff = ['admin', 'super_admin', 'support', 'moderator'].includes(req.user!.role);
  if (!isOwner && !isStaff) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this order.' } });
  }

  // The plaintext panel password (if one was generated) lives only in memory,
  // never on disk — see server/services/ephemeralSecrets.ts.
  const panelPassword = record.status === 'completed' ? peekEphemeralSecret(`panel_pw:${record.id}`) : null;

  res.json({
    success: true,
    data: {
      id: record.id,
      status: record.status,
      message: record.message,
      planName: record.planName,
      productName: record.productName,
      panelUrl: record.panelUrl,
      panelUsername: record.panelUsername,
      panelPassword: panelPassword || undefined,
      panelServerName: record.panelServerName,
      errorMessage: isStaff ? record.errorMessage : undefined,
      updatedAt: record.updatedAt
    }
  });
});

export default router;
