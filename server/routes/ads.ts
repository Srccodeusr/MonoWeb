import { Router, Request } from 'express';
import { getDb, saveDb } from '../db';
import { authenticateUser, requireAdmin, optionalUser } from '../auth';
import { AdItem, AdPlacement, AdType } from '../../src/types';
import { effectivePlan } from '../hosting/plans';
import { getClientIp } from '../services/requestProtection';
import { allow } from '../hosting/ratelimit';

const router = Router();

const PLACEMENTS: AdPlacement[] = ['overview', 'servers', 'create', 'upgrade', 'store', 'console', 'billing', 'public', 'login', 'footer', 'popup', 'reward'];
const TYPES: AdType[] = ['banner', 'card', 'announcement', 'sponsored', 'image', 'popup'];
const LEGACY: Record<string, AdPlacement> = { dashboard: 'overview' };

/** Only http(s) and same-site paths may be ad destinations: blocks javascript:/data: URLs (stored XSS via window.open). */
function cleanUrl(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
  return /^(https?:\/\/[^\s]+|\/[^\s]*)$/.test(t) && !t.startsWith('//') ? t : '';
}
const str = (v: unknown, max: number, def = '') => (typeof v === 'string' ? v.trim().slice(0, max) : def);
const num = (v: unknown, min: number, max: number, def: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : def; };
const date = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/** Whitelist: the old route did Object.assign(ad, req.body), allowing overwrite of id/impressions/clicks. */
function sanitizeAd(b: any, e?: AdItem): Omit<AdItem, 'id' | 'impressions' | 'clicks' | 'createdAt'> {
  const title = str(b?.title, 120, e?.title);
  if (!title) throw new Error('Title is required.');
  const dest = cleanUrl(b?.destinationUrl ?? e?.destinationUrl);
  if (!dest) throw new Error('Destination must be an http(s) URL or a site path starting with /.');
  const placement = PLACEMENTS.includes(b?.placement) ? b.placement : LEGACY[b?.placement] || e?.placement || 'overview';
  return {
    title, description: str(b?.description, 300, e?.description), imageUrl: cleanUrl(b?.imageUrl ?? e?.imageUrl) || undefined, destinationUrl: dest,
    type: TYPES.includes(b?.type) ? b.type : e?.type || 'banner', placement, priority: num(b?.priority, 0, 100, e?.priority ?? 1), frequencyCapPerSession: num(b?.frequencyCapPerSession, 0, 100, e?.frequencyCapPerSession ?? 0),
    ctaLabel: str(b?.ctaLabel, 30, e?.ctaLabel), badge: str(b?.badge, 20, e?.badge), showToPremium: typeof b?.showToPremium === 'boolean' ? b.showToPremium : e?.showToPremium ?? false,
    maxImpressions: num(b?.maxImpressions, 0, 1e9, e?.maxImpressions ?? 0), maxClicks: num(b?.maxClicks, 0, 1e9, e?.maxClicks ?? 0),
    startDate: date(b?.startDate ?? e?.startDate), endDate: date(b?.endDate ?? e?.endDate), isActive: typeof b?.isActive === 'boolean' ? b.isActive : e?.isActive ?? true,
  };
}

const live = (ad: AdItem, now: Date) => ad.isActive && (!ad.startDate || new Date(ad.startDate) <= now) && (!ad.endDate || new Date(ad.endDate) >= now)
  && (!ad.maxImpressions || (ad.impressions || 0) < ad.maxImpressions) && (!ad.maxClicks || (ad.clicks || 0) < ad.maxClicks);

// GET /api/v1/ads?placement=overview
router.get('/', async (req: Request, res) => {
  try {
    const db = await getDb(); const hs = db.settings.hosting!;
    const raw = String(req.query.placement || 'overview');
    const placement = (LEGACY[raw] || raw) as AdPlacement;
    if (!hs.ads.globalEnabled) return res.json({ success: true, ads: [], hidden: 'disabled' });
    const user = await optionalUser(req);
    const premium = user ? effectivePlan(user, db.hostingPlans, hs)?.features.noAds : false;
    if (premium && hs.ads.hideForPremium) return res.json({ success: true, ads: [], hidden: 'premium' });
    const now = new Date();
    // 'reward' ads are only served through the earn flow, never as passive placements.
    const ads = (db.ads || []).filter(a => a.placement === placement && placement !== 'reward' && live(a, now)).sort((a, b) => b.priority - a.priority || Math.random() - 0.5)
      .map(({ id, title, description, imageUrl, destinationUrl, type, placement: pl, ctaLabel, badge, frequencyCapPerSession, priority }) => ({ id, title, description, imageUrl, destinationUrl, type, placement: pl, ctaLabel, badge, frequencyCapPerSession, priority }));
    res.json({ success: true, ads });
  } catch (err: any) { res.status(500).json({ success: false, error: { message: 'Failed to fetch ads.' } }); }
});

// Event recording: throttled per IP+ad, and the event log is capped so it cannot grow the database without bound.
async function record(req: Request, res: any, type: 'impression' | 'click') {
  try {
    const ad = ((await getDb()).ads || []).find(a => a.id === req.params.id);
    if (ad && allow(`ad:${type}:${getClientIp(req)}:${ad.id}`, type === 'click' ? 3 : 10, 60_000)) {
      const db = await getDb();
      if (type === 'impression') ad.impressions = (ad.impressions || 0) + 1; else ad.clicks = (ad.clicks || 0) + 1;
      const cap = db.settings.hosting?.ads.maxEventsStored ?? 5000;
      if (cap > 0) {
        db.adEvents = db.adEvents || [];
        db.adEvents.push({ id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, adId: ad.id, type, timestamp: new Date().toISOString() });
        if (db.adEvents.length > cap) db.adEvents = db.adEvents.slice(-cap);
      }
      void saveDb();
    }
    res.json({ success: true });
  } catch { res.status(500).json({ success: false }); }
}
router.post('/:id/impression', (req, res) => record(req, res, 'impression'));
router.post('/:id/click', (req, res) => record(req, res, 'click'));

// ---- admin (Ad Center) ----------------------------------------------------------------------
router.get('/admin/list', authenticateUser, requireAdmin, async (_req, res) => {
  const db = await getDb();
  const day = 86400_000; const now = Date.now();
  const events = db.adEvents || [];
  const series = Array.from({ length: 14 }, (_, i) => {
    const start = now - (13 - i) * day; const d = new Date(start).toISOString().slice(0, 10);
    const ev = events.filter(e => e.timestamp.slice(0, 10) === d);
    return { date: d, impressions: ev.filter(e => e.type === 'impression').length, clicks: ev.filter(e => e.type === 'click').length };
  });
  res.json({ success: true, ads: db.ads || [], series, settings: db.settings.hosting!.ads });
});

router.post('/admin/create', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const ad: AdItem = { id: `ad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...sanitizeAd(req.body), impressions: 0, clicks: 0, createdAt: new Date().toISOString() };
    db.ads.push(ad); await saveDb(); res.status(201).json({ success: true, ad });
  } catch (e: any) { res.status(400).json({ success: false, error: { message: e.message } }); }
});

router.put('/admin/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const db = await getDb(); const ad = db.ads.find(a => a.id === req.params.id);
    if (!ad) return res.status(404).json({ success: false, error: { message: 'Ad not found.' } });
    Object.assign(ad, sanitizeAd(req.body, ad)); await saveDb(); res.json({ success: true, ad });
  } catch (e: any) { res.status(400).json({ success: false, error: { message: e.message } }); }
});

router.post('/admin/:id/reset-stats', authenticateUser, requireAdmin, async (req, res) => {
  const db = await getDb(); const ad = db.ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ success: false, error: { message: 'Ad not found.' } });
  ad.impressions = 0; ad.clicks = 0; db.adEvents = (db.adEvents || []).filter(e => e.adId !== ad.id); await saveDb(); res.json({ success: true });
});

router.delete('/admin/:id', authenticateUser, requireAdmin, async (req, res) => {
  const db = await getDb(); db.ads = db.ads.filter(a => a.id !== req.params.id); db.adEvents = (db.adEvents || []).filter(e => e.adId !== req.params.id); await saveDb();
  res.json({ success: true });
});

export default router;
