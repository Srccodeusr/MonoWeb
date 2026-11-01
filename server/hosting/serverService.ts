import { getDb, saveDbSync, DatabaseSchema } from '../db';
import { User } from '../../src/types';
import { HostImage, HostNode, HostServer, HostingPlan, PerServerLimits, Entitlement } from '../../src/hostingTypes';
import { daemon, DaemonError, pingNode } from './daemonClient';
import { effectivePlan } from './plans';
import { resolveAccess, can } from './access';
import { evaluateServer, extendFrom } from './lifecycle';
import { newServerId } from './crypto';

export class HostingError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new HostingError(status, code, message); };

// ---------------------------------------------------------------------------------------------
// Limits & entitlements
// ---------------------------------------------------------------------------------------------
export interface UserCaps {
  plan: HostingPlan;
  serverLimit: number;
  perServer: PerServerLimits;
  used: number;
  noAds: boolean;
}

export function userServers(db: DatabaseSchema, userId: string): HostServer[] {
  return db.servers.filter(s => s.ownerId === userId);
}

export function userCaps(db: DatabaseSchema, user: User): UserCaps {
  const plan = effectivePlan(user, db.hostingPlans, db.settings.hosting!)!;
  const o = user.hostingOverrides || {};
  // Servers made from a store "server pack" live outside the plan's slot count.
  const packServers = new Set(db.entitlements.filter(e => e.userId === user.id && e.serverId).map(e => e.serverId!));
  const used = userServers(db, user.id).filter(s => !packServers.has(s.id)).length;
  return {
    plan,
    serverLimit: (o.serverLimit ?? plan.serverLimit) + (user.extraSlots || 0),
    perServer: {
      ...plan.perServer,
      ramMB: o.ramMB ?? plan.perServer.ramMB,
      cpuPercent: o.cpuPercent ?? plan.perServer.cpuPercent,
      diskMB: o.diskMB ?? plan.perServer.diskMB,
    },
    used,
    noAds: plan.features.noAds,
  };
}

/** Live limits for a server: base snapshot plus every upgrade that has not lapsed. */
export function liveLimits(s: HostServer, now = Date.now()): HostServer['limits'] {
  const l = { ...s.limits };
  for (const u of s.upgrades || []) {
    if (u.until && new Date(u.until).getTime() <= now) continue;
    l.ramMB += u.ramMB; l.cpuPercent += u.cpuPercent; l.diskMB += u.diskMB;
  }
  return l;
}

// ---------------------------------------------------------------------------------------------
// Nodes: capacity, ports
// ---------------------------------------------------------------------------------------------
export function nodeUsage(db: DatabaseSchema, nodeId: string) {
  const list = db.servers.filter(s => s.nodeId === nodeId);
  return list.reduce((a, s) => { const l = liveLimits(s); return { ramMB: a.ramMB + l.ramMB, cpuPercent: a.cpuPercent + l.cpuPercent, diskMB: a.diskMB + l.diskMB, servers: a.servers + 1 }; }, { ramMB: 0, cpuPercent: 0, diskMB: 0, servers: 0 });
}

export function fits(db: DatabaseSchema, node: HostNode, need: { ramMB: number; cpuPercent: number; diskMB: number }): boolean {
  const u = nodeUsage(db, node.id), f = 1 + node.overallocatePercent / 100;
  if (node.maxServers && u.servers >= node.maxServers) return false;
  return (!node.ramMB || u.ramMB + need.ramMB <= node.ramMB * f)
    && (!node.cpuPercent || u.cpuPercent + need.cpuPercent <= node.cpuPercent * f)
    && (!node.diskMB || u.diskMB + need.diskMB <= node.diskMB * f);
}

export function freePorts(db: DatabaseSchema, node: HostNode, count: number): number[] | null {
  const taken = new Set<number>();
  db.servers.filter(s => s.nodeId === node.id).forEach(s => s.ports.forEach(p => taken.add(p.host)));
  const out: number[] = [];
  // random start so ports are not trivially guessable/sequential
  const span = node.portMax - node.portMin + 1;
  const start = Math.floor(Math.random() * span);
  for (let i = 0; i < span && out.length < count; i++) {
    const p = node.portMin + ((start + i) % span);
    if (!taken.has(p)) out.push(p);
  }
  return out.length === count ? out : null;
}

export function selectableNodes(db: DatabaseSchema, image: HostImage, plan: HostingPlan) {
  return db.nodes.filter(n => n.isPublic && !n.isMaintenance && n.status?.online
    && (!n.premiumOnly || !plan.isFree)
    && (image.runtime !== 'container' || n.status.runtime !== 'process')
    && (image.runtime !== 'process' || n.status.runtime === 'process'));
}

/** Host ports -> port mappings. Container images keep their fixed in-container port; 'any' images listen on the host port itself. */
export function buildPorts(img: HostImage, hostPorts: number[]): HostServer['ports'] {
  return hostPorts.map((host, i) => {
    const def = img.ports[i];
    return { host, container: img.runtime === 'container' && def ? def.container : host, proto: def?.proto || 'tcp', label: def?.label || 'Extra' };
  });
}

// ---------------------------------------------------------------------------------------------
// Variables & startup
// ---------------------------------------------------------------------------------------------
function validateVars(image: HostImage, input: Record<string, unknown> | undefined, allowAll: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of image.variables) {
    let val = v.default;
    if (input && input[v.env] !== undefined && (v.userEditable || allowAll)) val = String(input[v.env]);
    if (val.length > 500 || /[\0\r\n]/.test(val)) fail(400, 'INVALID_VARIABLE', `${v.name}: invalid value.`);
    if (v.rules === 'required' && !val) fail(400, 'INVALID_VARIABLE', `${v.name} is required.`);
    else if (v.rules === 'number' && val !== '' && !/^-?\d+(\.\d+)?$/.test(val)) fail(400, 'INVALID_VARIABLE', `${v.name} must be a number.`);
    else if (v.rules.startsWith('/') && v.rules.lastIndexOf('/') > 0) {
      const last = v.rules.lastIndexOf('/');
      let re: RegExp | null = null;
      try { re = new RegExp(v.rules.slice(1, last), v.rules.slice(last + 1)); } catch { /* bad admin regex: skip */ }
      if (re && !re.test(val)) fail(400, 'INVALID_VARIABLE', `${v.name} has an invalid format.`);
    }
    out[v.env] = val;
  }
  return out;
}

export function renderStartup(startup: string, env: Record<string, string>): string {
  return startup.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, k) => env[k] ?? '');
}

// ---------------------------------------------------------------------------------------------
// Daemon sync
// ---------------------------------------------------------------------------------------------
export function nodeFor(db: DatabaseSchema, s: HostServer): HostNode {
  const n = db.nodes.find(x => x.id === s.nodeId);
  if (!n) fail(502, 'NODE_MISSING', 'The node hosting this server no longer exists.');
  return n!;
}

/** SFTP logins the node should accept for this server right now (plan feature, permission and server state all apply). */
export function sftpLogins(db: DatabaseSchema, s: HostServer): { username: string; hash: string; readOnly: boolean }[] {
  if (['suspended', 'expired', 'transferring'].includes(s.status)) return [];
  const owner = db.users.find(u => u.id === s.ownerId);
  if (!owner || !effectivePlan(owner, db.hostingPlans, db.settings.hosting!)?.features.sftp) return [];
  if (!db.nodes.find(n => n.id === s.nodeId)?.sftpPort) return [];
  const out: { username: string; hash: string; readOnly: boolean }[] = [];
  for (const c of db.sftpCreds.filter(x => x.serverId === s.id)) {
    const acc = resolveAccess(db, c.userId, s.id);
    if (!acc || !can(acc, 'sftp')) continue;
    out.push({ username: c.username, hash: c.passwordHash, readOnly: c.readOnly || !can(acc, 'files.write') });
  }
  return out;
}

export function specFor(db: DatabaseSchema, s: HostServer) {
  const image = db.images.find(i => i.id === s.imageId);
  const l = liveLimits(s);
  const env = { ...s.variables, SERVER_MEMORY: String(l.ramMB), SERVER_IP: '0.0.0.0', SERVER_PORT: String(s.ports[0]?.container ?? s.ports[0]?.host ?? '') };
  return {
    image: s.dockerImage, startup: renderStartup(image?.startup || '', env), stopCommand: image?.stopCommand || 'stop', env,
    ports: s.ports.map(p => ({ host: p.host, container: p.container, proto: p.proto })),
    limits: { ramMB: l.ramMB, cpuPercent: l.cpuPercent, diskMB: l.diskMB, swapMB: l.swapMB, pids: l.pids },
    sftp: sftpLogins(db, s),
  };
}

export async function pushSpec(db: DatabaseSchema, s: HostServer): Promise<void> {
  await daemon(nodeFor(db, s), 'PUT', `/v1/servers/${s.id}`, specFor(db, s));
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------
export interface CreateInput {
  name: string; description?: string; imageId: string; location?: string; nodeId?: string;
  dockerImageLabel?: string; variables?: Record<string, unknown>; entitlementId?: string;
}

export async function createServer(user: User, input: CreateInput): Promise<HostServer> {
  const db = await getDb();
  const hs = db.settings.hosting!;
  const caps = userCaps(db, user);
  const name = String(input.name || '').trim();
  if (!name || name.length > hs.wizard.maxNameLength || /[\u0000-\u001f<>]/.test(name)) fail(400, 'INVALID_NAME', `Server name must be 1-${hs.wizard.maxNameLength} characters.`);
  const description = String(input.description || '').trim().slice(0, 191);
  if (/[\u0000-\u001f<>]/.test(description)) fail(400, 'INVALID_DESCRIPTION', 'Description contains invalid characters.');

  const image = db.images.find(i => i.id === input.imageId && i.isActive);
  if (!image) fail(404, 'IMAGE_NOT_FOUND', 'That software is not available.');
  const img = image!;

  let ent: Entitlement | undefined;
  let limits: HostServer['limits'];
  let validityMs: number | undefined;
  if (input.entitlementId) {
    ent = db.entitlements.find(e => e.id === input.entitlementId && e.userId === user.id && !e.serverId);
    if (!ent) fail(404, 'ENTITLEMENT_NOT_FOUND', 'That server pack was not found or is already used.');
    const p = ent!.pack;
    limits = { ramMB: p.ramMB, cpuPercent: p.cpuPercent, diskMB: p.diskMB, swapMB: p.swapMB, pids: 512, backups: p.backups, databases: p.databases };
    validityMs = p.validityDays * 86400_000;
  } else {
    if (caps.serverLimit <= 0 || caps.used >= caps.serverLimit) fail(403, 'SERVER_LIMIT', `Your ${caps.plan.name} plan allows ${caps.serverLimit} server${caps.serverLimit === 1 ? '' : 's'}. Upgrade or buy a slot to create more.`);
    const ps = caps.perServer;
    limits = { ramMB: ps.ramMB, cpuPercent: ps.cpuPercent, diskMB: ps.diskMB, swapMB: ps.swapMB, pids: ps.pids, backups: ps.backups, databases: ps.databases };
    const cap = caps.plan.accountCaps;
    const mine = userServers(db, user.id).map(s => liveLimits(s));
    const sum = (k: 'ramMB' | 'cpuPercent' | 'diskMB') => mine.reduce((a, l) => a + l[k], 0) + limits[k];
    if ((cap.ramMB && sum('ramMB') > cap.ramMB) || (cap.cpuPercent && sum('cpuPercent') > cap.cpuPercent) || (cap.diskMB && sum('diskMB') > cap.diskMB)) fail(403, 'ACCOUNT_CAP', 'This would exceed the total resources allowed on your plan.');
  }
  if (limits.ramMB < img.minRamMB) fail(400, 'LOW_RAM', `${img.name} needs at least ${img.minRamMB} MB RAM; your plan gives ${limits.ramMB} MB.`);

  const candidates = selectableNodes(db, img, caps.plan).filter(n => fits(db, n, limits));
  let node: HostNode | undefined;
  if (input.nodeId) {
    if (!caps.plan.features.chooseNode) fail(403, 'NODE_CHOICE', 'Choosing a node is a Premium feature.');
    node = candidates.find(n => n.id === input.nodeId);
  } else {
    const loc = String(input.location || '');
    const inLoc = candidates.filter(n => !loc || n.locationName === loc);
    node = inLoc.sort((a, b) => nodeUsage(db, a.id).ramMB / (a.ramMB || 1) - nodeUsage(db, b.id).ramMB / (b.ramMB || 1))[0];
  }
  if (!node) fail(503, 'NO_CAPACITY', 'No node has capacity in that location right now. Try another location or check back soon.');
  const n = node!;

  const portCount = Math.max(1, img.ports.length) + (ent ? 0 : caps.perServer.ports);
  const hostPorts = freePorts(db, n, portCount);
  if (!hostPorts) fail(503, 'NO_PORTS', 'This node has no free ports.');
  const ports: HostServer['ports'] = buildPorts(img, hostPorts!);

  const label = input.dockerImageLabel && img.dockerImages[input.dockerImageLabel] ? input.dockerImageLabel : img.defaultImage;
  const variables = validateVars(img, input.variables as any, false);

  const now = Date.now();
  const validityDays = ent ? 0 : (caps.plan.renewal.validityDays || 0);
  let expiresAt: string | undefined;
  if (validityMs) expiresAt = new Date(now + validityMs).toISOString();
  else if (validityDays) expiresAt = new Date(now + validityDays * 86400_000).toISOString();
  else if (!caps.plan.isFree && user.planExpiresAt) expiresAt = user.planExpiresAt;
  else if (!caps.plan.isFree && user.tempPlan) expiresAt = user.tempPlan.until;
  else expiresAt = new Date(now + hs.expiry.defaultValidityDays * 86400_000).toISOString();

  const server: HostServer = {
    id: newServerId(), ownerId: user.id, name, description, nodeId: n.id, imageId: img.id,
    dockerImage: img.dockerImages[label], planId: caps.plan.id, entitlementId: ent?.id, limits, ports, variables,
    upgrades: [], status: 'installing', createdAt: new Date(now).toISOString(), expiresAt, renewCount: 0,
  };

  try {
    await pushSpec({ ...db, servers: [...db.servers, server] } as DatabaseSchema, server);
    await daemon(n, 'POST', `/v1/servers/${server.id}/install`, {
      image: img.install.image, script: img.install.script, entrypoint: img.install.entrypoint,
      env: { ...variables, SERVER_MEMORY: String(limits.ramMB) }, files: img.install.files,
    });
  } catch (e: any) {
    await daemon(n, 'DELETE', `/v1/servers/${server.id}`).catch(() => undefined);
    if (e instanceof DaemonError) fail(502, 'NODE_ERROR', e.message);
    throw e;
  }
  db.servers.push(server);
  if (ent) ent.serverId = server.id;
  saveDbSync();
  return server;
}

// ---------------------------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------------------------
const stateCache = new Map<string, { at: number; value: any }>();

export async function liveState(db: DatabaseSchema, s: HostServer): Promise<{ status: HostServer['status']; startedAt?: string; installLog?: string[] }> {
  if (s.status === 'suspended' || s.status === 'expired' || s.status === 'transferring') return { status: s.status };
  const hit = stateCache.get(s.id);
  if (hit && Date.now() - hit.at < 4000) return hit.value;
  let value: { status: HostServer['status']; startedAt?: string; installLog?: string[] };
  try {
    const st = await daemon<any>(nodeFor(db, s), 'GET', `/v1/servers/${s.id}/state`, undefined, { timeoutMs: 4000 });
    if (st.install?.state === 'installing') value = { status: 'installing', installLog: st.install.log };
    else if (st.install?.state === 'failed') value = { status: 'install_failed', installLog: st.install.log };
    else value = { status: st.power?.state === 'running' ? 'running' : st.power?.state === 'starting' ? 'starting' : 'offline', startedAt: st.power?.startedAt };
  } catch { value = { status: s.status === 'installing' ? 'installing' : 'offline' }; }
  stateCache.set(s.id, { at: Date.now(), value });
  return value;
}
export function dropStateCache(id: string) { stateCache.delete(id); }

// ---------------------------------------------------------------------------------------------
// Renew / expire / delete
// ---------------------------------------------------------------------------------------------
export function renewServer(db: DatabaseSchema, s: HostServer, addMs: number): HostServer {
  s.expiresAt = extendFrom(s.expiresAt, addMs, Date.now()).toISOString();
  s.expiredAt = undefined;
  s.notifiedExpiry = false;
  s.lastRenewedAt = new Date().toISOString();
  s.renewCount = (s.renewCount || 0) + 1;
  if (s.status === 'expired') s.status = 'offline';
  saveDbSync();
  dropStateCache(s.id);
  return s;
}

export async function stopQuietly(db: DatabaseSchema, s: HostServer) {
  try { await daemon(nodeFor(db, s), 'POST', `/v1/servers/${s.id}/power`, { action: 'kill' }, { timeoutMs: 15000 }); } catch { /* node offline: lifecycle will retry */ }
}

export async function destroyServer(db: DatabaseSchema, s: HostServer): Promise<void> {
  const node = db.nodes.find(n => n.id === s.nodeId);
  if (node) {
    try { await daemon(node, 'DELETE', `/v1/servers/${s.id}`, undefined, { timeoutMs: 60000 }); }
    catch (e: any) { if (!(e instanceof DaemonError) || e.status !== 404) throw e; }
  }
  db.servers = db.servers.filter(x => x.id !== s.id);
  db.backups = db.backups.filter(b => b.serverId !== s.id);
  db.entitlements.filter(e => e.serverId === s.id).forEach(e => { e.serverId = undefined; });
  stateCache.delete(s.id);
  saveDbSync();
}

function mailUser(db: DatabaseSchema, userId: string, subject: string, body: string) {
  const u = db.users.find(x => x.id === userId); if (!u) return;
  const now = Date.now();
  db.mail.unshift({
    id: `mail_${now}_${Math.random().toString(36).slice(2, 8)}`, batchId: `mb_${now}`, senderId: 'system', senderName: 'Hosting', senderRole: 'system' as any,
    recipientId: u.id, recipientName: u.displayName || u.username, recipientEmail: u.email, subject, body, isRead: false, isBroadcast: false, createdAt: new Date(now).toISOString(),
  } as any);
}

let ticking = false;
/** Runs every minute: expire, delete (24h hard-coded), remind, sync install completion, lapse upgrades. */
export async function lifecycleTick(): Promise<void> {
  if (ticking) return; ticking = true;
  try {
    const db = await getDb();
    const now = Date.now();
    const reminderH = db.settings.hosting?.expiry.reminderHours ?? 24;
    for (const s of [...db.servers]) {
      try {
        if (s.status === 'transferring') continue; // the transfer job owns this server until it finishes
        const action = evaluateServer(s, now, reminderH);
        if (action === 'expire') {
          s.status = 'expired'; s.expiredAt = new Date(now).toISOString(); saveDbSync();
          await stopQuietly(db, s);
          await pushSpec(db, s).catch(() => undefined); // revokes SFTP logins on the node
          mailUser(db, s.ownerId, `Server "${s.name}" has expired`, `Your server "${s.name}" expired and was stopped. Renew it within 24 hours or it will be permanently deleted.`);
        } else if (action === 'delete') {
          await destroyServer(db, s);
          mailUser(db, s.ownerId, `Server "${s.name}" was deleted`, `Your server "${s.name}" was not renewed within 24 hours of expiring and has been permanently deleted.`);
        } else if (action === 'remind') {
          s.notifiedExpiry = true;
          mailUser(db, s.ownerId, `Server "${s.name}" expires soon`, `Your server "${s.name}" expires at ${s.expiresAt}. Renew it from the server page to keep it online.`);
          saveDbSync();
        }
        if (s.upgrades?.some(u => u.until && new Date(u.until).getTime() <= now)) {
          s.upgrades = s.upgrades.filter(u => !u.until || new Date(u.until).getTime() > now);
          saveDbSync();
          await pushSpec(db, s).catch(() => undefined);
        }
        if (s.status === 'installing') {
          const live = await liveState(db, s);
          if (live.status === 'offline') {
            s.status = 'offline'; saveDbSync();
            await daemon(nodeFor(db, s), 'POST', `/v1/servers/${s.id}/power`, { action: 'start' }).catch(() => undefined);
          } else if (live.status === 'install_failed') { s.status = 'install_failed'; saveDbSync(); }
        }
      } catch (e: any) { console.warn(`[Hosting] lifecycle error for ${s.id}: ${e?.message}`); }
    }
    // Plans that lapsed: move user back to free (effectivePlan already ignores the lapsed plan; this just tidies state).
    for (const u of db.users) {
      if (u.tempPlan && new Date(u.tempPlan.until).getTime() <= now) { u.tempPlan = undefined; saveDbSync(); }
    }
  } finally { ticking = false; }
}

export async function refreshNodeStatuses(): Promise<void> {
  const db = await getDb();
  await Promise.allSettled(db.nodes.map(async n => {
    try {
      const { ping, system } = await pingNode(n);
      n.status = { online: true, checkedAt: new Date().toISOString(), version: ping.version, runtime: ping.runtime, runtimeInfo: ping.runtimeInfo, platform: ping.platform, hostname: ping.hostname, system };
    } catch (e: any) {
      n.status = { ...n.status, online: false, checkedAt: new Date().toISOString(), error: e?.message || 'unreachable' };
    }
  }));
  saveDbSync();
}

let timers: NodeJS.Timeout[] = [];
export function startHostingScheduler(): void {
  if (timers.length) return;
  timers.push(setInterval(() => { void lifecycleTick(); }, 60_000));
  timers.push(setInterval(() => { void refreshNodeStatuses(); }, 45_000));
  setTimeout(() => { void refreshNodeStatuses().then(lifecycleTick); }, 3000);
  timers.forEach(t => t.unref?.());
}
