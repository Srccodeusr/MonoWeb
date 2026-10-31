import { BillingPeriod, HostingPlan, HostingSettings } from '../../src/hostingTypes';

export const DEFAULT_PERIODS: BillingPeriod[] = [
  { id: 'monthly', label: 'Monthly', months: 1, discountPercent: 0 },
  { id: 'halfyearly', label: '6 Months', months: 6, discountPercent: 5 },
  { id: 'yearly', label: '1 Year', months: 12, discountPercent: 10 },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

export function periodPrice(plan: HostingPlan, period: BillingPeriod): { total: number; perMonth: number; saved: number; base: number } {
  const base = r2(plan.monthlyPrice * period.months);
  const override = plan.priceOverrides?.[period.id];
  const total = override !== undefined && override >= 0 ? r2(override) : r2(base * (1 - period.discountPercent / 100));
  return { total, perMonth: period.months ? r2(total / period.months) : total, saved: Math.max(0, r2(base - total)), base };
}

export function periodEndDate(from: Date, period: BillingPeriod): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + period.months);
  return d;
}

export interface UserPlanState { planId?: string; planExpiresAt?: string; tempPlan?: { planId: string; until: string } }

/**
 * Which plan applies to the user right now:
 * a live temporary premium beats everything, then a paid plan that has not expired, else the free plan.
 */
export function effectivePlan(user: UserPlanState, plans: HostingPlan[], settings: HostingSettings, now = Date.now()): HostingPlan | undefined {
  const byId = (id?: string) => plans.find(p => p.id === id && p.isActive !== false) || plans.find(p => p.id === id);
  if (user.tempPlan && new Date(user.tempPlan.until).getTime() > now) {
    const t = byId(user.tempPlan.planId);
    if (t) return t;
  }
  if (user.planId) {
    const p = byId(user.planId);
    if (p && (p.isFree || !user.planExpiresAt || new Date(user.planExpiresAt).getTime() > now)) return p;
  }
  return byId(settings.freePlanId) || plans.find(p => p.isFree) || plans[0];
}

export function defaultPlans(now: string): HostingPlan[] {
  const base = {
    isActive: true, createdAt: now, updatedAt: now, priceOverrides: {} as Record<string, number>,
    accountCaps: { ramMB: 0, cpuPercent: 0, diskMB: 0 },
  };
  return [
    {
      ...base, id: 'plan_free', name: 'Free', tagline: 'Ad-supported 24/7 hosting', isFree: true, isPopular: false, sortOrder: 1,
      monthlyPrice: 0, serverLimit: 2,
      perServer: { ramMB: 512, cpuPercent: 50, diskMB: 1024, swapMB: 0, backups: 0, databases: 0, ports: 0, pids: 256 },
      features: { noAds: false, directRenewal: false, subusers: false, scheduledTasks: false, backups: false, chooseNode: false, switchNode: false, discordRole: false, giveaways: false },
      renewal: { validityDays: 7, methods: ['ads', 'blog'] },
      highlights: ['2 servers', '512 MB RAM per server', '1 GB storage', 'Renew by watching an ad or reading a blog'],
    },
    {
      ...base, id: 'plan_premium', name: 'Premium', tagline: 'More servers, more power, no ads', isFree: false, isPopular: true, sortOrder: 2,
      monthlyPrice: 2.5, serverLimit: 4,
      perServer: { ramMB: 1024, cpuPercent: 100, diskMB: 1536, swapMB: 256, backups: 3, databases: 1, ports: 1, pids: 512 },
      features: { noAds: true, directRenewal: true, subusers: true, scheduledTasks: true, backups: true, chooseNode: true, switchNode: true, discordRole: true, giveaways: true },
      renewal: { validityDays: 0, methods: ['payment', 'coins'] },
      highlights: ['4 servers', '1 GB RAM per server', '1.5 GB storage', 'No ads, direct renewals, backups'],
    },
  ];
}

export function defaultHostingSettings(): HostingSettings {
  return {
    enabled: true,
    periods: DEFAULT_PERIODS,
    freePlanId: 'plan_free',
    topBar: { enabled: true, message: 'Welcome to our hosting platform. Need help?', links: [{ label: 'Join our Discord', url: '' }] },
    promos: {
      upgradeCard: true, hostingCard: true,
      hostingCardTitle: 'Looking for 24/7 Premium Hosting?',
      hostingCardText: 'Experience fast and powerful servers with our Premium Nodes. Powerful CPUs, fast NVMe storage and more features.',
      hostingCardCta: 'View Plans', hostingCardUrl: '/pricing',
    },
    expiry: { defaultValidityDays: 7, reminderHours: 24 },
    renew: {
      ads: { enabled: true, watchSeconds: 15, extendHours: 24, maxPerDay: 5 },
      blog: { enabled: true, maxPerDay: 5, items: [] },
      coins: { enabled: false, priceCoins: 100, extendDays: 7 },
    },
    economy: { enabled: true, coinName: 'Coins', adReward: { coins: 5, seconds: 15, maxPerDay: 20, cooldownSec: 30 }, blogMaxPerDay: 10, dailyBonus: 10 },
    wizard: { maxNameLength: 50 },
    ads: { globalEnabled: true, hideForPremium: true, maxEventsStored: 5000 },
  };
}

/** Merge admin-supplied settings onto defaults and clamp the numbers (never trust the client). */
export function sanitizeHostingSettings(input: any, current: HostingSettings): HostingSettings {
  const d = defaultHostingSettings();
  const n = (v: any, min: number, max: number, def: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
  const b = (v: any, def: boolean) => (typeof v === 'boolean' ? v : def);
  const s = (v: any, max: number, def: string) => (typeof v === 'string' ? v.slice(0, max) : def);
  const url = (v: any) => { const t = typeof v === 'string' ? v.trim() : ''; return /^(https?:\/\/|\/)/.test(t) ? t.slice(0, 500) : ''; };
  const c = current || d;
  const i = input || {};

  const periods: BillingPeriod[] = Array.isArray(i.periods) && i.periods.length
    ? i.periods.slice(0, 8).map((p: any, idx: number) => ({
        id: s(p.id, 24, `p${idx}`).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || `p${idx}`,
        label: s(p.label, 24, 'Period'), months: Math.round(n(p.months, 1, 60, 1)), discountPercent: n(p.discountPercent, 0, 90, 0),
      }))
    : c.periods;

  return {
    enabled: b(i.enabled, c.enabled),
    periods,
    freePlanId: s(i.freePlanId, 64, c.freePlanId),
    topBar: {
      enabled: b(i.topBar?.enabled, c.topBar.enabled), message: s(i.topBar?.message, 300, c.topBar.message),
      links: Array.isArray(i.topBar?.links) ? i.topBar.links.slice(0, 4).map((l: any) => ({ label: s(l.label, 60, ''), url: url(l.url) })).filter((l: any) => l.label) : c.topBar.links,
    },
    promos: {
      upgradeCard: b(i.promos?.upgradeCard, c.promos.upgradeCard), hostingCard: b(i.promos?.hostingCard, c.promos.hostingCard),
      hostingCardTitle: s(i.promos?.hostingCardTitle, 120, c.promos.hostingCardTitle), hostingCardText: s(i.promos?.hostingCardText, 300, c.promos.hostingCardText),
      hostingCardCta: s(i.promos?.hostingCardCta, 40, c.promos.hostingCardCta), hostingCardUrl: url(i.promos?.hostingCardUrl) || c.promos.hostingCardUrl,
    },
    expiry: { defaultValidityDays: Math.round(n(i.expiry?.defaultValidityDays, 1, 3650, c.expiry.defaultValidityDays)), reminderHours: Math.round(n(i.expiry?.reminderHours, 1, 720, c.expiry.reminderHours)) },
    renew: {
      ads: { enabled: b(i.renew?.ads?.enabled, c.renew.ads.enabled), watchSeconds: Math.round(n(i.renew?.ads?.watchSeconds, 5, 120, c.renew.ads.watchSeconds)), extendHours: Math.round(n(i.renew?.ads?.extendHours, 1, 24 * 90, c.renew.ads.extendHours)), maxPerDay: Math.round(n(i.renew?.ads?.maxPerDay, 1, 100, c.renew.ads.maxPerDay)) },
      blog: {
        enabled: b(i.renew?.blog?.enabled, c.renew.blog.enabled), maxPerDay: Math.round(n(i.renew?.blog?.maxPerDay, 1, 100, c.renew.blog.maxPerDay)),
        items: Array.isArray(i.renew?.blog?.items) ? i.renew.blog.items.slice(0, 50).map((x: any, idx: number) => ({
          id: s(x.id, 40, `blog_${Date.now().toString(36)}${idx}`).replace(/[^a-z0-9_-]/gi, ''), title: s(x.title, 120, 'Blog'), url: url(x.url),
          seconds: Math.round(n(x.seconds, 5, 300, 20)), rewardCoins: Math.round(n(x.rewardCoins, 0, 10000, 5)), renewHours: Math.round(n(x.renewHours, 0, 24 * 90, 24)), isActive: b(x.isActive, true),
        })).filter((x: any) => x.url) : c.renew.blog.items,
      },
      coins: { enabled: b(i.renew?.coins?.enabled, c.renew.coins.enabled), priceCoins: Math.round(n(i.renew?.coins?.priceCoins, 1, 1e7, c.renew.coins.priceCoins)), extendDays: Math.round(n(i.renew?.coins?.extendDays, 1, 365, c.renew.coins.extendDays)) },
    },
    economy: {
      enabled: b(i.economy?.enabled, c.economy.enabled), coinName: s(i.economy?.coinName, 20, c.economy.coinName) || 'Coins',
      adReward: { coins: Math.round(n(i.economy?.adReward?.coins, 0, 10000, c.economy.adReward.coins)), seconds: Math.round(n(i.economy?.adReward?.seconds, 5, 120, c.economy.adReward.seconds)), maxPerDay: Math.round(n(i.economy?.adReward?.maxPerDay, 1, 500, c.economy.adReward.maxPerDay)), cooldownSec: Math.round(n(i.economy?.adReward?.cooldownSec, 0, 3600, c.economy.adReward.cooldownSec)) },
      blogMaxPerDay: Math.round(n(i.economy?.blogMaxPerDay, 1, 500, c.economy.blogMaxPerDay)), dailyBonus: Math.round(n(i.economy?.dailyBonus, 0, 10000, c.economy.dailyBonus)),
    },
    wizard: { maxNameLength: Math.round(n(i.wizard?.maxNameLength, 10, 100, c.wizard.maxNameLength)) },
    ads: { globalEnabled: b(i.ads?.globalEnabled, c.ads.globalEnabled), hideForPremium: b(i.ads?.hideForPremium, c.ads.hideForPremium), maxEventsStored: Math.round(n(i.ads?.maxEventsStored, 0, 100000, c.ads.maxEventsStored)) },
  };
}

/** Validates + normalises a plan coming from the admin form. Throws Error(message) on invalid input. */
export function sanitizePlan(input: any, existing?: HostingPlan): Omit<HostingPlan, 'id' | 'createdAt' | 'updatedAt'> {
  const n = (v: any, min: number, max: number, def: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
  const s = (v: any, max: number, def = '') => (typeof v === 'string' ? v.trim().slice(0, max) : def);
  const b = (v: any, def: boolean) => (typeof v === 'boolean' ? v : def);
  const e = existing;
  const name = s(input?.name, 60, e?.name);
  if (!name) throw new Error('Plan name is required.');
  const ps = input?.perServer || {}, ep = e?.perServer;
  const f = input?.features || {}, ef = e?.features;
  const isFree = b(input?.isFree, e?.isFree ?? false);
  const methods = (Array.isArray(input?.renewal?.methods) ? input.renewal.methods : e?.renewal.methods || []).filter((m: string) => ['ads', 'blog', 'coins', 'payment'].includes(m));
  const overrides: Record<string, number> = {};
  for (const [k, v] of Object.entries(input?.priceOverrides || e?.priceOverrides || {})) { const x = Number(v); if (Number.isFinite(x) && x >= 0 && /^[a-z0-9_-]{1,24}$/.test(k)) overrides[k] = x; }
  return {
    name, tagline: s(input?.tagline, 140, e?.tagline), isFree, isActive: b(input?.isActive, e?.isActive ?? true), isPopular: b(input?.isPopular, e?.isPopular ?? false),
    sortOrder: Math.round(n(input?.sortOrder, 0, 999, e?.sortOrder ?? 10)),
    monthlyPrice: isFree ? 0 : n(input?.monthlyPrice, 0, 100000, e?.monthlyPrice ?? 0),
    priceOverrides: isFree ? {} : overrides,
    serverLimit: Math.round(n(input?.serverLimit, 0, 1000, e?.serverLimit ?? 1)),
    perServer: {
      ramMB: Math.round(n(ps.ramMB, 64, 1048576, ep?.ramMB ?? 512)), cpuPercent: Math.round(n(ps.cpuPercent, 5, 6400, ep?.cpuPercent ?? 100)),
      diskMB: Math.round(n(ps.diskMB, 64, 100000000, ep?.diskMB ?? 1024)), swapMB: Math.round(n(ps.swapMB, 0, 1048576, ep?.swapMB ?? 0)),
      backups: Math.round(n(ps.backups, 0, 1000, ep?.backups ?? 0)), databases: Math.round(n(ps.databases, 0, 100, ep?.databases ?? 0)),
      ports: Math.round(n(ps.ports, 0, 16, ep?.ports ?? 0)), pids: Math.round(n(ps.pids, 16, 4096, ep?.pids ?? 512)),
    },
    accountCaps: { ramMB: Math.round(n(input?.accountCaps?.ramMB, 0, 1e9, e?.accountCaps.ramMB ?? 0)), cpuPercent: Math.round(n(input?.accountCaps?.cpuPercent, 0, 1e6, e?.accountCaps.cpuPercent ?? 0)), diskMB: Math.round(n(input?.accountCaps?.diskMB, 0, 1e9, e?.accountCaps.diskMB ?? 0)) },
    features: {
      noAds: b(f.noAds, ef?.noAds ?? false), directRenewal: b(f.directRenewal, ef?.directRenewal ?? false), subusers: b(f.subusers, ef?.subusers ?? false),
      scheduledTasks: b(f.scheduledTasks, ef?.scheduledTasks ?? false), backups: b(f.backups, ef?.backups ?? false), chooseNode: b(f.chooseNode, ef?.chooseNode ?? false),
      switchNode: b(f.switchNode, ef?.switchNode ?? false), discordRole: b(f.discordRole, ef?.discordRole ?? false), giveaways: b(f.giveaways, ef?.giveaways ?? false),
    },
    renewal: { validityDays: Math.round(n(input?.renewal?.validityDays, 0, 3650, e?.renewal.validityDays ?? 7)), methods },
    highlights: (Array.isArray(input?.highlights) ? input.highlights : e?.highlights || []).slice(0, 12).map((h: any) => s(h, 120)).filter(Boolean),
  };
}
