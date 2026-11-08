import { DatabaseSchema, getDb } from '../db';
import { VpsNode } from '../../src/vpsTypes';
import type { ManagerBotNodeView } from '../../src/botTypes';
import { nodeUsage } from '../vps/service';
import { botState, logActivity } from './state';

/**
 * Bot nodes = VPS nodes the admin marked "Discord bot node" (Admin > VPS Nodes, or Admin > Discord Manager Bot > Nodes).
 * The website is the source of truth: the bot reads db.vpsNodes live, and this module keeps a small registry mirror
 * (db.managerBot.nodes) so the admin panel can show "added to the bot at ..." and so additions/removals are announced.
 * Nothing in Discord can add or remove a node.
 */
export const isBotNode = (n: VpsNode): boolean => n.discordBot === true;
export const botNodes = (db: DatabaseSchema): VpsNode[] => db.vpsNodes.filter(isBotNode);

/** Brings the registry in line with the node list. Returns what changed (callers announce it). */
export function syncBotNodes(db: DatabaseSchema): { added: VpsNode[]; removed: { nodeId: string; name: string }[] } {
  const s = botState(db);
  const live = new Map(botNodes(db).map(n => [n.id, n]));
  const added: VpsNode[] = [];
  for (const n of live.values()) {
    const known = s.nodes.find(x => x.nodeId === n.id);
    if (!known) { s.nodes.push({ nodeId: n.id, name: n.name, location: n.location, addedAt: new Date().toISOString() }); added.push(n); }
    else { known.name = n.name; known.location = n.location; }
  }
  const removed = s.nodes.filter(x => !live.has(x.nodeId)).map(x => ({ nodeId: x.nodeId, name: x.name }));
  if (removed.length) s.nodes = s.nodes.filter(x => live.has(x.nodeId));
  return { added, removed };
}

/** Sync + log. Called after every node change in the admin API and when the bot starts. Safe to call any time. */
export async function onNodesChanged(): Promise<void> {
  try {
    const db = await getDb();
    const { added, removed } = syncBotNodes(db);
    for (const n of added) logActivity(db, 'NODE_ADDED', `Node "${n.name}" (${n.location}) was added to the bot automatically.`);
    for (const r of removed) logActivity(db, 'NODE_REMOVED', `Node "${r.name}" is no longer a bot node.`);
  } catch (e: any) { console.warn('[Manager Bot] node sync failed:', e?.message || e); }
}

/* ------------------------------------------------------------------ placement (bot nodes only) */
function fits(db: DatabaseSchema, n: VpsNode, spec: { cpu: number; ramMb: number; diskGb: number }): boolean {
  const u = nodeUsage(db, n.id); const k = 1 + (n.overallocatePercent || 0) / 100;
  if (n.maxVps > 0 && u.count >= n.maxVps) return false;
  if (n.ramMb > 0 && u.ramMb + spec.ramMb > n.ramMb * k) return false;
  if (n.diskGb > 0 && u.diskGb + spec.diskGb > n.diskGb * k) return false;
  if (n.cpus > 0 && u.cpu + spec.cpu > n.cpus * k) return false;
  return true;
}

export function pickBotNode(db: DatabaseSchema, spec: { cpu: number; ramMb: number; diskGb: number }, location?: string): VpsNode | null {
  const load = (n: VpsNode) => { const u = nodeUsage(db, n.id); return n.ramMb > 0 ? u.ramMb / n.ramMb : n.maxVps > 0 ? u.count / n.maxVps : u.count / 1000; };
  const c = botNodes(db).filter(n => n.enabled && n.status?.online !== false && (!location || n.location.toLowerCase() === location.toLowerCase()) && fits(db, n, spec)).sort((a, b) => load(a) - load(b));
  return c[0] || null;
}

export const botLocations = (db: DatabaseSchema): string[] => [...new Set(botNodes(db).filter(n => n.enabled).map(n => n.location))];

export function nodeViews(db: DatabaseSchema): ManagerBotNodeView[] {
  const s = botState(db);
  return botNodes(db).map(n => ({
    id: n.id, name: n.name, location: n.location, online: n.status?.online === true, enabled: n.enabled, vpsCount: nodeUsage(db, n.id).count, maxVps: n.maxVps,
    publicHost: n.publicHost || n.daemonHost, addedAt: s.nodes.find(x => x.nodeId === n.id)?.addedAt || '', error: n.status?.online === false ? n.status.error : undefined,
  }));
}
