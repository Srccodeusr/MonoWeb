import crypto from 'crypto';
import { DatabaseSchema, getDb, saveDbSync } from '../db';
import { Order, Plan, ProvisionRecord, Product, User } from '../../src/types';
import {
  VpsEvent, VpsInstance, VpsNode, VpsOrder, VpsOsImage, VpsPlan, VpsSettings, VpsStats, VpsView, defaultVpsSettings,
} from '../../src/vpsTypes';
import { decryptSecret, encryptSecret, newId, randomPassword } from '../hosting/crypto';
import { VpsDaemonError, pingVpsNode, vpsDaemon } from './daemonClient';
import { setEphemeralSecret } from '../services/ephemeralSecrets';

export type Db = DatabaseSchema;

/* ============================================================== settings / lookups */
export const vpsSettings = (db: Db): VpsSettings => ({ ...defaultVpsSettings(), ...(db.vpsSettings || {}) });
export const imageById = (db: Db, id: string): VpsOsImage | undefined => db.vpsImages.find(i => i.id === id);
export const nodeOf = (db: Db, v: VpsInstance): VpsNode | undefined => db.vpsNodes.find(n => n.id === v.nodeId);
export const publicHost = (n?: VpsNode | null): string | null => (n ? (n.publicHost || n.daemonHost) : null);
export const dpath = (v: VpsInstance, sub = '', query = ''): string => `/v1/vps/${v.id}${sub}${query}`;
export const addDays = (from: number, days: number): string => new Date(from + days * 86_400_000).toISOString();

export class VpsError extends Error { constructor(public status: number, message: string, public code = 'VPS_ERROR') { super(message); } }

/** Images a plan may be deployed with, restricted to ones the admin left enabled. */
export function allowedImages(db: Db, plan: { images: string[] }): VpsOsImage[] {
  return db.vpsImages.filter(i => i.enabled && (!plan.images?.length || plan.images.includes(i.id))).sort((a, b) => a.sort - b.sort);
}
export function pickImage(db: Db, plan: { images: string[] }, requested?: string): VpsOsImage {
  const list = allowedImages(db, plan);
  const hit = list.find(i => i.id === requested) || list.find(i => i.id === vpsSettings(db).defaultImage) || list[0];
  if (!hit) throw new VpsError(400, 'No operating system is available for this plan right now.', 'NO_IMAGE');
  return hit;
}

/* ============================================================== events + mail */
export function logVpsEvent(db: Db, v: VpsInstance, actor: string, action: string, details = '', ip?: string): void {
  db.vpsEvents.unshift({ id: newId('vev'), vpsId: v.id, userId: v.ownerId, actor, action, details: details.slice(0, 300), ip, createdAt: new Date().toISOString() } as VpsEvent);
  if (db.vpsEvents.length > 4000) db.vpsEvents.length = 4000;
}

export function mailUser(db: Db, userId: string, subject: string, body: string): void {
  const u = db.users.find(x => x.id === userId); if (!u) return;
  const now = Date.now();
  db.mail.unshift({
    id: `mail_${now}_${Math.random().toString(36).slice(2, 8)}`, batchId: `mb_${now}`, senderId: 'system', senderName: 'VPS Hosting', senderRole: 'system' as any,
    recipientId: u.id, recipientName: u.displayName || u.username, recipientEmail: u.email, subject, body, isRead: false, isBroadcast: false, createdAt: new Date(now).toISOString(),
  } as any);
}

/* ============================================================== placement */
export function nodeUsage(db: Db, nodeId: string) {
  const list = db.vpsServers.filter(v => v.nodeId === nodeId);
  return { count: list.length, ramMb: list.reduce((a, v) => a + v.spec.ramMb, 0), diskGb: list.reduce((a, v) => a + v.spec.diskGb, 0), cpu: list.reduce((a, v) => a + v.spec.cpu, 0) };
}

/** Free-capacity check. Count limit always applies; RAM/disk/CPU ceilings only when the admin filled them in (0 = unlimited). */
function fits(db: Db, n: VpsNode, spec: { cpu: number; ramMb: number; diskGb: number }): boolean {
  const u = nodeUsage(db, n.id); const k = 1 + (n.overallocatePercent || 0) / 100;
  if (n.maxVps > 0 && u.count >= n.maxVps) return false;
  if (n.ramMb > 0 && u.ramMb + spec.ramMb > n.ramMb * k) return false;
  if (n.diskGb > 0 && u.diskGb + spec.diskGb > n.diskGb * k) return false;
  if (n.cpus > 0 && u.cpu + spec.cpu > n.cpus * k) return false;
  return true;
}

export function pickNode(db: Db, spec: { cpu: number; ramMb: number; diskGb: number }, location?: string): VpsNode | null {
  const load = (n: VpsNode) => { const u = nodeUsage(db, n.id); return n.ramMb > 0 ? u.ramMb / n.ramMb : n.maxVps > 0 ? u.count / n.maxVps : u.count / 1000; };
  const c = db.vpsNodes.filter(n => n.enabled && n.status?.online !== false && (!location || n.location === location) && fits(db, n, spec)).sort((a, b) => load(a) - load(b));
  return c[0] || null;
}

function allocPort(db: Db, node: VpsNode): number {
  const taken = new Set(db.vpsServers.filter(v => v.nodeId === node.id).map(v => v.sshPort));
  for (let p = node.portMin; p <= node.portMax; p++) if (!taken.has(p)) return p;
  throw new VpsError(409, `Node "${node.name}" has no free SSH ports.`, 'NO_PORTS');
}

/* ============================================================== provisioning */
export interface ProvisionOpts {
  owner: User;
  plan: Pick<VpsPlan, 'id' | 'name' | 'cpu' | 'ramMb' | 'diskGb' | 'bandwidthGb' | 'periodDays' | 'images'>;
  image: VpsOsImage;
  name?: string;
  nodeId?: string;
  location?: string;
  orderId?: string;
  periodDays?: number;
}

/** Creates the VPS on the least-loaded eligible node. Port + record are reserved synchronously (no await in between) so parallel buys never collide. */
export async function provisionVps(db: Db, o: ProvisionOpts): Promise<{ vps: VpsInstance; password: string }> {
  const spec = { cpu: o.plan.cpu, ramMb: o.plan.ramMb, diskGb: o.plan.diskGb };
  const node = o.nodeId ? db.vpsNodes.find(n => n.id === o.nodeId) : pickNode(db, spec, o.location || undefined);
  if (!node || (!o.nodeId && !node.enabled)) throw new VpsError(503, 'No VPS node has free capacity right now. Please try again shortly.', 'NO_CAPACITY');
  const id = crypto.randomUUID(); const sshPort = allocPort(db, node); const password = randomPassword(20);
  const now = Date.now();
  const rec: VpsInstance = {
    id, ownerId: o.owner.id, planId: o.plan.id, planName: o.plan.name, orderId: o.orderId, name: (o.name || `${o.plan.name} VPS`).trim().slice(0, 40) || `${o.plan.name} VPS`,
    nodeId: node.id, image: o.image.id, sshPort, rootPasswordEnc: encryptSecret(password),
    spec: { cpu: o.plan.cpu, ramMb: o.plan.ramMb, diskGb: o.plan.diskGb, bandwidthGb: o.plan.bandwidthGb || 0 },
    status: 'installing', suspended: false, createdAt: new Date(now).toISOString(), expiresAt: addDays(now, o.periodDays || o.plan.periodDays || 30), renewCount: 0,
  };
  db.vpsServers.push(rec); saveDbSync();
  try {
    const r = await vpsDaemon<{ diskEnforced?: boolean }>(node, 'POST', '/v1/vps', {
      id, image: o.image.id, base: o.image.base, cpu: rec.spec.cpu, ramMb: rec.spec.ramMb, diskGb: rec.spec.diskGb, hostname: `vps-${id.slice(0, 6)}`, sshPort, rootPassword: password,
    }, 15 * 60_000);
    rec.status = 'running'; rec.diskEnforced = r.diskEnforced !== false; rec.lastError = undefined;
  } catch (e: any) {
    db.vpsServers = db.vpsServers.filter(v => v.id !== id); saveDbSync();
    vpsDaemon(node, 'DELETE', `/v1/vps/${id}`, undefined, 30_000).catch(() => undefined);   // the daemon cleans up after itself; this covers an unlucky timeout
    throw e instanceof VpsError || e instanceof VpsDaemonError ? e : new VpsError(502, e?.message || 'Provisioning failed.');
  }
  logVpsEvent(db, rec, 'system', 'VPS_CREATED', `${rec.planName} on ${node.name} (${o.image.label})`);
  saveDbSync();
  return { vps: rec, password };
}

export async function destroyVps(db: Db, v: VpsInstance, force = false): Promise<void> {
  const node = nodeOf(db, v);
  if (node) {
    try { await vpsDaemon(node, 'DELETE', dpath(v), undefined, 60_000); }
    catch (e: any) { if (!(e instanceof VpsDaemonError && (e.status === 404)) && !force) throw e; }
  }
  db.vpsServers = db.vpsServers.filter(x => x.id !== v.id);
  statCache.delete(v.id);
  saveDbSync();
}

/** Pushes new CPU/RAM limits to the running container (disk size cannot be changed live). */
export async function resizeVps(db: Db, v: VpsInstance, spec: { cpu: number; ramMb: number }): Promise<void> {
  const node = nodeOf(db, v); if (!node) throw new VpsError(409, 'The node for this VPS was removed.');
  await vpsDaemon(node, 'POST', dpath(v, '/resize'), { cpu: spec.cpu, ramMb: spec.ramMb }, 20_000);
  v.spec.cpu = spec.cpu; v.spec.ramMb = spec.ramMb; saveDbSync();
}

export const rootPassword = (v: VpsInstance): string => decryptSecret(v.rootPasswordEnc);

/* ============================================================== live state + views */
const statCache = new Map<string, { at: number; val: LiveState }>();
export interface LiveState { status: 'running' | 'offline' | 'missing' | 'unknown'; startedAt: string | null; stats: VpsStats; nodeOnline: boolean; nodeError: string | null }
const ZERO: VpsStats = { cpuPct: 0, ramUsedMb: 0, diskUsedMb: 0, netRxMb: 0, netTxMb: 0 };

export async function liveState(db: Db, v: VpsInstance, maxAgeMs = 2500): Promise<LiveState> {
  const hit = statCache.get(v.id); if (hit && Date.now() - hit.at < maxAgeMs) return hit.val;
  const node = nodeOf(db, v); let val: LiveState;
  if (!node) val = { status: 'unknown', startedAt: null, stats: ZERO, nodeOnline: false, nodeError: 'The node for this VPS was removed.' };
  else {
    try {
      const s = await vpsDaemon<any>(node, 'GET', dpath(v), undefined, 8000);
      val = { status: s.status === 'missing' ? 'missing' : s.status === 'running' ? 'running' : 'offline', startedAt: s.startedAt || null, nodeOnline: true, nodeError: null,
        stats: { cpuPct: +s.cpuPct || 0, ramUsedMb: +s.ramUsedMb || 0, diskUsedMb: +s.diskUsedMb || 0, netRxMb: +s.netRxMb || 0, netTxMb: +s.netTxMb || 0 } };
    } catch (e: any) { val = { status: 'unknown', startedAt: null, stats: ZERO, nodeOnline: false, nodeError: e?.message || 'unreachable' }; }
  }
  statCache.set(v.id, { at: Date.now(), val }); return val;
}
export const forgetLive = (id: string) => statCache.delete(id);

export function viewOf(db: Db, v: VpsInstance, live?: LiveState): VpsView {
  const n = nodeOf(db, v); const img = imageById(db, v.image);
  let status: VpsView['status'] = v.suspended ? (v.suspendReason === 'expired' ? 'expired' : 'suspended') : v.status;
  if (!v.suspended && v.status !== 'installing' && live) status = live.status === 'running' ? 'running' : live.status === 'offline' ? 'offline' : live.status === 'missing' ? 'error' : 'unknown';
  return {
    id: v.id, name: v.name, status, suspended: v.suspended, suspendReason: v.suspendReason || null, image: v.image, imageLabel: img?.label || v.image, spec: v.spec,
    host: publicHost(n), sshPort: v.sshPort, expiresAt: v.expiresAt, expiredAt: v.expiredAt, createdAt: v.createdAt, startedAt: live?.startedAt || null,
    planId: v.planId, planName: v.planName, renewCount: v.renewCount, node: n ? { name: n.name, location: n.location } : null,
    nodeOnline: live ? live.nodeOnline : true, nodeError: live?.nodeError || null, lastError: v.lastError || (live?.status === 'missing' ? 'The VPS container is missing on its node. Contact support.' : null),
  };
}

/* ============================================================== billing helpers (account credits) */
const round2 = (n: number) => parseFloat(n.toFixed(2));

export function chargeCredits(user: User, amount: number): void {
  if (amount <= 0) return;
  if (user.credits < amount) throw new VpsError(402, `You need $${amount.toFixed(2)} in account credits but your balance is $${user.credits.toFixed(2)}. Add credits on the Billing page.`, 'INSUFFICIENT_CREDITS');
  user.credits = round2(user.credits - amount); user.updatedAt = new Date().toISOString();
}
export function refundCredits(user: User | undefined, amount: number): void {
  if (!user || amount <= 0) return;
  user.credits = round2(user.credits + amount); user.updatedAt = new Date().toISOString();
}

/** Mirrors the purchase into MonoWeb's own order list so revenue, Orders & Payments and the customer's billing history stay complete. */
export function recordBillingOrder(db: Db, user: User, plan: { id: string; name: string }, amount: number, status: Order['status'], extra: Partial<Order> = {}): Order {
  const order: Order = {
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, userId: user.id, userEmail: user.email, planId: plan.id, planName: plan.name, productId: 'prod_vps',
    billingCycle: 'monthly', amount, currency: db.settings.currencyCode || 'USD', status, paymentMethod: amount > 0 ? 'Account Credits' : 'Free Plan', createdAt: new Date().toISOString(), ...extra,
  };
  db.orders.unshift(order); return order;
}

export function newVpsOrder(db: Db, o: Omit<VpsOrder, 'id' | 'createdAt' | 'updatedAt' | 'currency'>): VpsOrder {
  const now = new Date().toISOString();
  const rec: VpsOrder = { id: newId('vord'), currency: db.settings.currencyCode || 'USD', createdAt: now, updatedAt: now, ...o };
  db.vpsOrders.unshift(rec); if (db.vpsOrders.length > 5000) db.vpsOrders.length = 5000;
  return rec;
}
export const touchOrder = (o: VpsOrder, patch: Partial<VpsOrder>) => Object.assign(o, patch, { updatedAt: new Date().toISOString() });

/** Plan price/period for renewals: a VPS profile, or a catalogue plan the VPS was created from ("catalog:<planId>"). */
export function resolveRenewPlan(db: Db, v: VpsInstance): { id: string; name: string; price: number; periodDays: number } | null {
  const vp = db.vpsPlans.find(p => p.id === v.planId); if (vp) return { id: vp.id, name: vp.name, price: vp.price, periodDays: vp.periodDays };
  if (v.planId.startsWith('catalog:')) {
    const cp = db.plans.find(p => p.id === v.planId.slice(8));
    if (cp) return { id: v.planId, name: cp.name, price: cp.priceMonthly, periodDays: 30 };
  }
  return null;
}

/** Extends the term. Revives a VPS that was stopped for expiry. */
export async function extendVps(db: Db, v: VpsInstance, days: number): Promise<void> {
  v.expiresAt = addDays(Math.max(Date.now(), Date.parse(v.expiresAt) || 0), days);
  v.notifiedExpiry = false; v.renewCount = (v.renewCount || 0) + 1;
  if (v.suspended && v.suspendReason === 'expired') {
    v.suspended = false; v.suspendReason = undefined; v.expiredAt = undefined; v.status = 'offline';
    saveDbSync();
    const node = nodeOf(db, v); if (node) await vpsDaemon(node, 'POST', dpath(v, '/power'), { action: 'start' }, 40_000).catch(() => undefined);
  }
  forgetLive(v.id); saveDbSync();
}

/* ============================================================== website checkout / staff-approval path */
export const nativeVpsHandles = (db: Db, product?: Product): boolean => {
  const s = vpsSettings(db);
  return !!product && product.category === 'vps' && s.enabled && s.handleCheckoutOrders && db.vpsNodes.some(n => n.enabled);
};

const norm = (s?: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Called by provisioningService for VPS-category orders. Updates the provision record the checkout screen polls. */
export async function provisionFromCheckout(
  record: ProvisionRecord, update: (id: string, patch: Partial<ProvisionRecord>) => Promise<void>,
): Promise<void> {
  const db = await getDb();
  const user = db.users.find(u => u.id === record.userId); const catalog = db.plans.find(p => p.id === record.planId); const product = db.products.find(p => p.id === record.productId);
  const order = db.orders.find(o => o.id === record.orderId);
  if (!user || !catalog || !product) { await update(record.id, { status: 'failed', message: 'Order could not be provisioned.', errorMessage: 'Missing user, plan, or product record.' }); return; }

  // Idempotent: a retry from Admin must not create a second VPS for the same order.
  const done = db.vpsOrders.find(o => o.billingOrderId === record.orderId && o.vpsId && db.vpsServers.some(v => v.id === o.vpsId));
  if (done) { const v = db.vpsServers.find(x => x.id === done.vpsId)!; await update(record.id, { status: 'completed', message: 'Your VPS is ready!', panelUsername: 'root', panelServerName: v.name, panelUrl: `/my-vps/${v.id}` }); return; }

  const s = vpsSettings(db);
  if (s.maxVpsPerUser > 0 && db.vpsServers.filter(v => v.ownerId === user.id).length >= s.maxVpsPerUser) {
    await update(record.id, { status: 'awaiting_manual_setup', message: 'Your order is confirmed, but you have reached the VPS limit for your account. Our team will review it.', errorMessage: `User already owns ${s.maxVpsPerUser} VPS.` });
    return;
  }
  await update(record.id, { status: 'creating_server', message: 'Deploying your VPS...' });

  const linked = db.vpsPlans.find(p => p.catalogPlanId === catalog.id);
  const yearly = order?.billingCycle === 'yearly';
  const profile = linked
    ? { id: linked.id, name: linked.name, cpu: linked.cpu, ramMb: linked.ramMb, diskGb: linked.diskGb, bandwidthGb: linked.bandwidthGb, periodDays: yearly ? 365 : linked.periodDays, images: linked.images }
    : { id: `catalog:${catalog.id}`, name: catalog.name, cpu: catalog.cpuCores, ramMb: catalog.ramMB, diskGb: catalog.diskGB, bandwidthGb: 0, periodDays: yearly ? 365 : 30, images: [] as string[] };

  // The checkout "application" choice doubles as the OS choice; match it to an image by id or label.
  const eggOpt = (product.panelEggOptions || []).find(o => o.id === record.selectedEggOptionId);
  const wanted = eggOpt ? db.vpsImages.find(i => norm(i.id) === norm(eggOpt.id) || norm(i.label) === norm(eggOpt.label) || norm(i.id) === norm(eggOpt.label))?.id : undefined;
  const locOpt = (product.panelLocationOptions || []).find(o => o.id === record.selectedLocationOptionId);
  const location = locOpt ? db.vpsNodes.find(n => norm(n.location) === norm(locOpt.label))?.location : undefined;

  const vo = newVpsOrder(db, { userId: user.id, userEmail: user.email, planId: profile.id, planName: profile.name, kind: 'deploy', image: '', name: record.serverName || '', location: location || '', amount: order?.amount || 0,
    paymentMethod: order?.paymentMethod || '', creditsHeld: false, billingOrderId: record.orderId, source: 'checkout', status: 'paid' });
  try {
    const image = pickImage(db, profile, wanted);
    vo.image = image.id;
    const { vps, password } = await provisionVps(db, { owner: user, plan: profile, image, name: record.serverName || `${catalog.name} VPS`, location, orderId: vo.id, periodDays: profile.periodDays });
    touchOrder(vo, { status: 'fulfilled', vpsId: vps.id, error: undefined }); saveDbSync();
    setEphemeralSecret(`panel_pw:${record.id}`, password);
    await update(record.id, { status: 'completed', message: 'Your VPS is ready! Save the root password below, it is not shown again.', panelUsername: 'root', panelServerName: vps.name, panelUrl: `/my-vps/${vps.id}` });
  } catch (e: any) {
    touchOrder(vo, { status: 'failed', error: e?.message || 'Provisioning failed' }); saveDbSync();
    await update(record.id, { status: 'awaiting_manual_setup', message: 'Payment received. We could not deploy your VPS automatically, so our team will finish it shortly.', errorMessage: e?.message || 'Provisioning failed' });
  }
}

/** Deploys a paid (or staff-approved) panel order. Throws on failure; the caller decides between refund (instant) and "leave pending" (manual). */
export async function fulfilDeployOrder(db: Db, vo: VpsOrder): Promise<VpsInstance> {
  const user = db.users.find(u => u.id === vo.userId); if (!user) throw new VpsError(404, 'The customer for this order no longer exists.');
  const plan = db.vpsPlans.find(p => p.id === vo.planId); if (!plan) throw new VpsError(404, 'The plan for this order no longer exists.');
  const image = pickImage(db, plan, vo.image);
  const { vps } = await provisionVps(db, { owner: user, plan, image, name: vo.name, location: vo.location || undefined, orderId: vo.id, periodDays: plan.periodDays });
  touchOrder(vo, { status: 'fulfilled', vpsId: vps.id, error: undefined, creditsHeld: false });
  const bo = vo.billingOrderId ? db.orders.find(o => o.id === vo.billingOrderId) : undefined;
  if (bo) { bo.status = 'paid'; bo.creditsHeld = false; }
  saveDbSync();
  return vps;
}

/* ============================================================== node refresh + lifecycle scheduler */
export async function refreshVpsNodes(): Promise<void> {
  const db = await getDb();
  await Promise.allSettled(db.vpsNodes.map(async n => {
    try {
      const { ping, system } = await pingVpsNode(n);
      n.status = { online: true, checkedAt: new Date().toISOString(), version: ping.version, runtime: system.runtime,
        system: { cpus: system.cpus, memTotalMb: system.memTotalMb, memFreeMb: system.memFreeMb, diskTotalMb: system.diskTotalMb, diskFreeMb: system.diskFreeMb, loadavg: system.loadavg || [0, 0, 0], uptimeS: system.uptimeS, vpsCount: system.vpsCount, vpsRunning: system.vpsRunning } };
    } catch (e: any) { n.status = { ...n.status, online: false, checkedAt: new Date().toISOString(), error: e?.message || 'unreachable' }; }
  }));
  saveDbSync();
}

let ticking = false;
/** Every minute: expire, remind, delete long-expired VPSes, clear provisioning that was interrupted by a restart. */
export async function vpsLifecycleTick(): Promise<void> {
  if (ticking) return; ticking = true;
  try {
    const db = await getDb(); const s = vpsSettings(db); const now = Date.now();
    for (const v of [...db.vpsServers]) {
      try {
        const exp = Date.parse(v.expiresAt) || 0;
        if (v.status === 'installing' && now - Date.parse(v.createdAt) > 20 * 60_000) { v.status = 'error'; v.lastError = 'Provisioning was interrupted. Ask staff to reinstall or delete this VPS.'; saveDbSync(); continue; }
        if (v.suspended && v.suspendReason === 'expired') {
          const since = Date.parse(v.expiredAt || '') || exp;
          if (s.deleteAfterExpiryDays > 0 && now - since > s.deleteAfterExpiryDays * 86_400_000) {
            await destroyVps(db, v, true);
            mailUser(db, v.ownerId, `VPS "${v.name}" was deleted`, `Your VPS "${v.name}" was not renewed within ${s.deleteAfterExpiryDays} days of expiring and has been permanently deleted.`);
            saveDbSync();
          }
          continue;
        }
        if (!v.suspended && exp && exp <= now) {
          v.suspended = true; v.suspendReason = 'expired'; v.expiredAt = new Date(now).toISOString(); v.status = 'expired'; saveDbSync();
          const n = nodeOf(db, v); if (n) vpsDaemon(n, 'POST', dpath(v, '/power'), { action: 'stop' }, 40_000).catch(() => undefined);
          logVpsEvent(db, v, 'system', 'VPS_EXPIRED', 'Stopped because the term ended');
          mailUser(db, v.ownerId, `VPS "${v.name}" has expired`, `Your VPS "${v.name}" expired and was stopped.${s.allowRenewal ? ' Renew it from the VPS page' : ' Contact support to renew it'}${s.deleteAfterExpiryDays > 0 ? ` within ${s.deleteAfterExpiryDays} days or it will be permanently deleted.` : '.'}`);
          saveDbSync();
        } else if (!v.suspended && !v.notifiedExpiry && s.reminderHours > 0 && exp - now < s.reminderHours * 3_600_000) {
          v.notifiedExpiry = true;
          mailUser(db, v.ownerId, `VPS "${v.name}" expires soon`, `Your VPS "${v.name}" expires on ${new Date(exp).toUTCString()}. Renew it from the VPS page to keep it online.`);
          saveDbSync();
        }
      } catch (e: any) { console.warn(`[VPS] lifecycle error for ${v.id}: ${e?.message}`); }
    }
  } finally { ticking = false; }
}

const timers: NodeJS.Timeout[] = [];
export function startVpsScheduler(): void {
  if (timers.length) return;
  timers.push(setInterval(() => { void vpsLifecycleTick(); }, 60_000));
  timers.push(setInterval(() => { void refreshVpsNodes(); }, 45_000));
  setTimeout(() => { void refreshVpsNodes().then(vpsLifecycleTick); }, 4000);
  timers.forEach(t => t.unref?.());
}
