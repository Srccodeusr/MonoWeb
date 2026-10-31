import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb, saveDbSync, DatabaseSchema } from '../db';
import { authMiddleware, AuthenticatedRequest, createAuditLog } from '../auth';
import { User } from '../../src/types';
import { HostServer, StoreItem } from '../../src/hostingTypes';
import { newId } from '../hosting/crypto';
import { allow } from '../hosting/ratelimit';
import { HostingError, liveLimits, pushSpec, renewServer, userCaps } from '../hosting/serverService';
import { getClientIp } from '../services/requestProtection';

const router = Router();
router.use(authMiddleware);

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });
const wrap = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response, _n: NextFunction) => {
  try { await fn(req, res); } catch (e: any) {
    if (res.headersSent) return;
    if (e instanceof HostingError) return err(res, e.status, e.code, e.message);
    console.error('[Economy]', e?.message || e); err(res, 500, 'INTERNAL', 'Something went wrong.');
  }
};

const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

export function addCoins(db: DatabaseSchema, user: User, amount: number, reason: string, ref?: string): void {
  user.coins = Math.max(0, Math.round(((user.coins || 0) + amount) * 100) / 100);
  db.coinTx.unshift({ id: newId('ctx'), userId: user.id, amount, balanceAfter: user.coins, reason, ref, createdAt: new Date().toISOString() });
  if (db.coinTx.length > 20000) db.coinTx.length = 20000;
}

const doneToday = (db: DatabaseSchema, userId: string, kind: 'ad' | 'blog', purpose?: 'coins' | 'renew') =>
  db.earnSessions.filter(s => s.userId === userId && s.kind === kind && s.claimedAt && new Date(s.claimedAt).getTime() >= startOfDay() && (!purpose || s.purpose === purpose));

// ----------------------------------------------------------------------------------------- wallet
router.get('/wallet', wrap(async (req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!; const u = db.users.find(x => x.id === req.user!.id)!;
  const bonusReady = hs.economy.dailyBonus > 0 && (!u.lastDailyBonusAt || new Date(u.lastDailyBonusAt).getTime() < startOfDay());
  res.json({
    success: true,
    data: {
      enabled: hs.economy.enabled, coinName: hs.economy.coinName, coins: u.coins || 0, credits: u.credits,
      dailyBonus: { amount: hs.economy.dailyBonus, ready: bonusReady },
      today: { ads: doneToday(db, u.id, 'ad').length, blogs: doneToday(db, u.id, 'blog').length, adMax: hs.economy.adReward.maxPerDay, blogMax: hs.economy.blogMaxPerDay },
      history: db.coinTx.filter(t => t.userId === u.id).slice(0, 50),
    },
  });
}));

router.post('/daily', wrap(async (req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!; const u = db.users.find(x => x.id === req.user!.id)!;
  if (!hs.economy.enabled || hs.economy.dailyBonus <= 0) return err(res, 403, 'DISABLED', 'Daily bonus is not available.');
  if (u.lastDailyBonusAt && new Date(u.lastDailyBonusAt).getTime() >= startOfDay()) return err(res, 429, 'ALREADY_CLAIMED', 'You already claimed today\'s bonus.');
  u.lastDailyBonusAt = new Date().toISOString();
  addCoins(db, u, hs.economy.dailyBonus, 'Daily bonus'); saveDbSync();
  res.json({ success: true, data: { coins: u.coins } });
}));

// ----------------------------------------------------------------------------------------- earn (ads / blogs)
router.get('/earn/options', wrap(async (req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!; const now = new Date();
  const rewardAds = db.ads.filter(a => a.isActive && a.placement === ('reward' as any) && (!a.startDate || new Date(a.startDate) <= now) && (!a.endDate || new Date(a.endDate) >= now))
    .map(a => ({ id: a.id, title: a.title, description: a.description, imageUrl: a.imageUrl, destinationUrl: a.destinationUrl }));
  const caps = userCaps(db, req.user!);
  res.json({
    success: true,
    data: {
      coinName: hs.economy.coinName,
      ad: { enabled: hs.economy.enabled || hs.renew.ads.enabled, seconds: hs.economy.adReward.seconds, coins: hs.economy.adReward.coins, renewSeconds: hs.renew.ads.watchSeconds, renewHours: hs.renew.ads.extendHours, items: rewardAds },
      blogs: hs.renew.blog.items.filter(b => b.isActive).map(b => ({ id: b.id, title: b.title, url: b.url, seconds: b.seconds, rewardCoins: b.rewardCoins, renewHours: b.renewHours })),
      renewAllowed: { ads: hs.renew.ads.enabled && caps.plan.renewal.methods.includes('ads'), blog: hs.renew.blog.enabled && caps.plan.renewal.methods.includes('blog') },
    },
  });
}));

router.post('/earn/start', wrap(async (req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!; const u = db.users.find(x => x.id === req.user!.id)!;
  const kind = req.body?.kind === 'blog' ? 'blog' : 'ad';
  const purpose = req.body?.purpose === 'renew' ? 'renew' : 'coins';
  const ip = getClientIp(req);
  if (!allow(`earn:${u.id}`, 12, 60_000) || !allow(`earnip:${ip}`, 40, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many requests.');

  let minSeconds = 0; let refId = String(req.body?.refId || ''); let payload: any = {};
  let serverId: string | undefined;
  if (purpose === 'coins') {
    if (!hs.economy.enabled) return err(res, 403, 'DISABLED', 'The economy is disabled.');
  } else {
    serverId = String(req.body?.serverId || '');
    const s = db.servers.find(x => x.id === serverId && x.ownerId === u.id);
    if (!s) return err(res, 404, 'NOT_FOUND', 'Server not found.');
    const caps = userCaps(db, u);
    if (!caps.plan.renewal.methods.includes(kind === 'ad' ? 'ads' : 'blog')) return err(res, 403, 'NOT_ALLOWED', 'Your plan cannot renew this way.');
  }

  if (kind === 'ad') {
    if (purpose === 'renew' && !hs.renew.ads.enabled) return err(res, 403, 'DISABLED', 'Renewing with ads is disabled.');
    minSeconds = purpose === 'renew' ? hs.renew.ads.watchSeconds : hs.economy.adReward.seconds;
    const max = purpose === 'renew' ? hs.renew.ads.maxPerDay : hs.economy.adReward.maxPerDay;
    if (doneToday(db, u.id, 'ad', purpose).length >= max) return err(res, 429, 'DAILY_LIMIT', 'Daily limit reached. Try again tomorrow.');
    if (purpose === 'coins' && hs.economy.adReward.cooldownSec) {
      const last = doneToday(db, u.id, 'ad', 'coins').map(x => new Date(x.claimedAt!).getTime()).sort().pop() || 0;
      if (Date.now() - last < hs.economy.adReward.cooldownSec * 1000) return err(res, 429, 'COOLDOWN', 'Please wait a moment before the next ad.');
    }
    const rewardAds = db.ads.filter(a => a.isActive && a.placement === ('reward' as any));
    const ad = rewardAds.find(a => a.id === refId) || rewardAds[Math.floor(Math.random() * rewardAds.length)];
    if (ad) { refId = ad.id; payload = { title: ad.title, description: ad.description, imageUrl: ad.imageUrl, destinationUrl: ad.destinationUrl }; ad.impressions = (ad.impressions || 0) + 1; }
    else refId = 'house';
  } else {
    const item = hs.renew.blog.items.find(b => b.id === refId && b.isActive);
    if (!item) return err(res, 404, 'NOT_FOUND', 'That article is not available.');
    if (purpose === 'renew' && !hs.renew.blog.enabled) return err(res, 403, 'DISABLED', 'Renewing with blogs is disabled.');
    const max = purpose === 'renew' ? hs.renew.blog.maxPerDay : hs.economy.blogMaxPerDay;
    if (doneToday(db, u.id, 'blog', purpose).length >= max) return err(res, 429, 'DAILY_LIMIT', 'Daily limit reached. Try again tomorrow.');
    if (db.earnSessions.some(s => s.userId === u.id && s.kind === 'blog' && s.refId === item.id && s.claimedAt && new Date(s.claimedAt).getTime() >= startOfDay())) return err(res, 429, 'ALREADY_READ', 'You already read this article today.');
    minSeconds = item.seconds; payload = { title: item.title, url: item.url };
  }

  // One open session at a time; stale ones are dropped.
  db.earnSessions = db.earnSessions.filter(s => s.claimedAt || (Date.now() - new Date(s.createdAt).getTime()) < 20 * 60_000).slice(-5000);
  db.earnSessions = db.earnSessions.filter(s => !(s.userId === u.id && !s.claimedAt));
  const session = { id: newId('earn'), token: crypto.randomBytes(24).toString('base64url'), userId: u.id, kind, refId, purpose, serverId, minSeconds, ip, createdAt: new Date().toISOString() } as any;
  db.earnSessions.push(session); saveDbSync();
  res.json({ success: true, data: { token: session.token, minSeconds, ...payload } });
}));

router.post('/earn/claim', wrap(async (req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!; const u = db.users.find(x => x.id === req.user!.id)!;
  const s = db.earnSessions.find(x => x.token === String(req.body?.token || '') && x.userId === u.id);
  if (!s || s.claimedAt) return err(res, 400, 'INVALID_SESSION', 'This reward was already claimed or expired.');
  const elapsed = (Date.now() - new Date(s.createdAt).getTime()) / 1000;
  if (elapsed > 20 * 60) return err(res, 400, 'EXPIRED', 'This session expired. Start again.');
  if (elapsed < s.minSeconds) return err(res, 400, 'TOO_EARLY', `Keep it open for ${Math.ceil(s.minSeconds - elapsed)} more seconds.`);
  s.claimedAt = new Date().toISOString();

  if (s.purpose === 'coins') {
    const reward = s.kind === 'ad' ? hs.economy.adReward.coins : (hs.renew.blog.items.find(b => b.id === s.refId)?.rewardCoins ?? 0);
    addCoins(db, u, reward, s.kind === 'ad' ? 'Watched an ad' : 'Read an article', s.refId); saveDbSync();
    return res.json({ success: true, data: { coins: u.coins, reward } });
  }
  const server = db.servers.find(x => x.id === s.serverId && x.ownerId === u.id);
  if (!server) return err(res, 404, 'NOT_FOUND', 'Server not found.');
  const hours = s.kind === 'ad' ? hs.renew.ads.extendHours : (hs.renew.blog.items.find(b => b.id === s.refId)?.renewHours ?? 0);
  renewServer(db, server, hours * 3600_000);
  await pushSpec(db, server).catch(() => undefined);
  res.json({ success: true, data: { expiresAt: server.expiresAt, hours } });
}));

// ----------------------------------------------------------------------------------------- store
const publicItem = (db: DatabaseSchema, i: StoreItem, userId: string) => ({
  id: i.id, type: i.type, name: i.name, description: i.description, iconUrl: i.iconUrl, priceCoins: i.priceCoins, priceMoney: i.priceMoney,
  stock: i.stock ? Math.max(0, i.stock - i.sold) : null, perUserLimit: i.perUserLimit,
  purchased: db.coinTx.filter(t => t.userId === userId && t.ref === `store:${i.id}`).length,
  detail: i.upgrade || i.pack || (i.renewDays ? { renewDays: i.renewDays } : i.premiumDays ? { premiumDays: i.premiumDays } : i.slots ? { slots: i.slots } : null),
  disabledReason: i.type === 'renew' && !db.settings.hosting!.renew.coins.enabled ? 'Renewing with coins is turned off right now.' : undefined,
});

router.get('/store', wrap(async (req, res) => {
  const db = await getDb();
  res.json({ success: true, data: db.storeItems.filter(i => i.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(i => publicItem(db, i, req.user!.id)) });
}));

router.post('/store/:id/buy', wrap(async (req, res) => {
  const db = await getDb(); const hs = db.settings.hosting!; const u = db.users.find(x => x.id === req.user!.id)!;
  if (!allow(`buy:${u.id}`, 10, 60_000)) return err(res, 429, 'RATE_LIMIT', 'Too many purchases. Slow down.');
  const item = db.storeItems.find(i => i.id === req.params.id && i.isActive);
  if (!item) return err(res, 404, 'NOT_FOUND', 'Item not found.');
  if (!hs.economy.enabled) return err(res, 403, 'DISABLED', 'The store is closed.');
  if (item.stock && item.sold >= item.stock) return err(res, 409, 'SOLD_OUT', 'Sold out.');
  const ref = `store:${item.id}`;
  const bought = db.coinTx.filter(t => t.userId === u.id && t.ref === ref).length;
  if (item.perUserLimit && bought >= item.perUserLimit) return err(res, 409, 'LIMIT', 'You reached the purchase limit for this item.');

  const payWith = req.body?.payWith === 'credits' ? 'credits' : 'coins';
  let server: HostServer | undefined;
  if (item.type === 'spec_upgrade' || item.type === 'renew') {
    server = db.servers.find(s => s.id === String(req.body?.serverId || '') && s.ownerId === u.id);
    if (!server) return err(res, 400, 'SERVER_REQUIRED', 'Choose one of your servers.');
  }
  if (item.type === 'renew' && !hs.renew.coins.enabled) return err(res, 403, 'DISABLED', 'Renewing with the store is turned off.');
  if (item.type === 'spec_upgrade' && server && (server.upgrades || []).filter(x => x.storeItemId === item.id && (!x.until || new Date(x.until) > new Date())).length >= (item.upgrade?.maxPerServer || 1)) return err(res, 409, 'MAX_STACK', 'This server already has the maximum of this upgrade.');

  // charge
  if (payWith === 'credits') {
    if (item.priceMoney <= 0) return err(res, 400, 'NO_MONEY_PRICE', 'This item can only be bought with coins.');
    if (u.credits < item.priceMoney) return err(res, 402, 'INSUFFICIENT_CREDITS', 'Not enough account credits.');
    u.credits = Math.round((u.credits - item.priceMoney) * 100) / 100;
  } else {
    if (item.priceCoins <= 0) return err(res, 400, 'NO_COIN_PRICE', 'This item can only be bought with money.');
    if ((u.coins || 0) < item.priceCoins) return err(res, 402, 'INSUFFICIENT_COINS', `You need ${item.priceCoins} ${hs.economy.coinName}.`);
    addCoins(db, u, -item.priceCoins, `Bought ${item.name}`, ref);
  }
  const refund = () => { if (payWith === 'credits') u.credits = Math.round((u.credits + item.priceMoney) * 100) / 100; else addCoins(db, u, item.priceCoins, `Refund: ${item.name}`, ref + ':refund'); };

  try {
    const now = Date.now();
    if (item.type === 'spec_upgrade' && server && item.upgrade) {
      server.upgrades = server.upgrades || [];
      server.upgrades.push({ id: newId('upg'), storeItemId: item.id, ramMB: item.upgrade.ramMB, cpuPercent: item.upgrade.cpuPercent, diskMB: item.upgrade.diskMB, until: item.upgrade.durationDays ? new Date(now + item.upgrade.durationDays * 86400_000).toISOString() : undefined, appliedAt: new Date(now).toISOString() });
      try { await pushSpec(db, server); } catch (e) { server.upgrades.pop(); throw e; }
    } else if (item.type === 'renew' && server) {
      renewServer(db, server, (item.renewDays || 7) * 86400_000);
      await pushSpec(db, server).catch(() => undefined);
    } else if (item.type === 'temp_premium') {
      const planId = item.premiumPlanId || 'plan_premium';
      if (!db.hostingPlans.some(p => p.id === planId)) throw new HostingError(400, 'PLAN_MISSING', 'The premium plan for this item no longer exists.');
      const cur = u.tempPlan && u.tempPlan.planId === planId && new Date(u.tempPlan.until).getTime() > now ? new Date(u.tempPlan.until).getTime() : now;
      u.tempPlan = { planId, until: new Date(cur + (item.premiumDays || 1) * 86400_000).toISOString() };
    } else if (item.type === 'server_pack' && item.pack) {
      db.entitlements.push({ id: newId('ent'), userId: u.id, storeItemId: item.id, name: item.name, pack: item.pack, createdAt: new Date(now).toISOString() });
    } else if (item.type === 'slot') {
      u.extraSlots = (u.extraSlots || 0) + (item.slots || 1);
    }
  } catch (e) { refund(); throw e; }

  if (payWith === 'credits') db.coinTx.unshift({ id: newId('ctx'), userId: u.id, amount: 0, balanceAfter: u.coins || 0, reason: `Bought ${item.name} with credits`, ref, createdAt: new Date().toISOString() });
  item.sold = (item.sold || 0) + 1; saveDbSync();
  await createAuditLog(u.id, u.email, u.role, 'STORE_PURCHASE', item.id, `Bought "${item.name}" with ${payWith}`);
  res.json({ success: true, data: { coins: u.coins || 0, credits: u.credits, message: item.type === 'server_pack' ? 'Server pack added. Create your boosted server from the Create page.' : 'Purchase complete.' } });
}));

void liveLimits;
export default router;
