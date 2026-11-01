import { getDb, saveDbSync, DatabaseSchema } from '../db';
import { HostNode, HostServer } from '../../src/hostingTypes';
import { daemon, daemonRaw, DaemonError } from './daemonClient';
import { effectivePlan } from './plans';
import { HostingError, buildPorts, dropStateCache, fits, freePorts, liveLimits, nodeFor, pushSpec, selectableNodes, specFor } from './serverService';

/**
 * "Switch node" (paid plans): move a server, with all its files, to another node.
 *   stop -> archive on source (sha256) -> register on target -> STREAM source->target (checksum in the signed URL)
 *   -> verify -> switch records -> delete from source -> start again if it was running.
 * Any failure before the switch rolls back: the target copy is deleted and the server stays where it was.
 */
const fail = (status: number, code: string, message: string): never => { throw new HostingError(status, code, message); };

export function transferTargets(db: DatabaseSchema, server: HostServer): HostNode[] {
  const owner = db.users.find(u => u.id === server.ownerId)!;
  const plan = effectivePlan(owner, db.hostingPlans, db.settings.hosting!)!;
  const img = db.images.find(i => i.id === server.imageId);
  if (!img) return [];
  return selectableNodes(db, img, plan).filter(n => n.id !== server.nodeId && fits(db, n, liveLimits(server)) && !!freePorts(db, n, server.ports.length));
}

/** Validates and starts the transfer; the heavy work continues in the background. */
export function beginTransfer(db: DatabaseSchema, server: HostServer, toNodeId: string): void {
  const owner = db.users.find(u => u.id === server.ownerId)!;
  const plan = effectivePlan(owner, db.hostingPlans, db.settings.hosting!)!;
  if (!plan.features.switchNode) fail(403, 'NOT_IN_PLAN', 'Switching nodes is available on paid plans.');
  if (server.status === 'transferring') fail(409, 'ALREADY', 'This server is already being moved.');
  if (['suspended', 'expired', 'installing', 'install_failed'].includes(server.status)) fail(409, 'BAD_STATE', `A ${server.status.replace('_', ' ')} server cannot be moved.`);
  const dest = transferTargets(db, server).find(n => n.id === toNodeId);
  if (!dest) fail(409, 'NO_TARGET', 'That node is not available for this server (offline, full, incompatible or hidden).');
  const from = nodeFor(db, server);
  server.transfer = { state: 'running', fromNodeId: from.id, toNodeId: dest!.id, startedAt: new Date().toISOString(), step: 'Starting' };
  server.status = 'transferring';
  saveDbSync();
  void runTransfer(server.id).catch(e => console.error('[Transfer] unexpected', e));
}

const step = (s: HostServer, text: string) => { if (s.transfer) { s.transfer.step = text; saveDbSync(); } };

async function runTransfer(serverId: string): Promise<void> {
  const db = await getDb();
  const server = db.servers.find(s => s.id === serverId)!;
  const tr = server.transfer!;
  const src = db.nodes.find(n => n.id === tr.fromNodeId)!, dst = db.nodes.find(n => n.id === tr.toNodeId)!;
  const img = db.images.find(i => i.id === server.imageId)!;
  let wasRunning = false, exportFile = '', registeredOnDest = false;
  const oldPorts = server.ports;

  try {
    step(server, 'Stopping the server');
    const st = await daemon<any>(src, 'GET', `/v1/servers/${server.id}/state`, undefined, { timeoutMs: 8000 }).catch(() => null);
    wasRunning = st?.power?.state === 'running';
    await pushSpec(db, { ...server, status: 'offline' } as HostServer); // make sure the source runs with current limits before it is archived
    if (wasRunning) await daemon(src, 'POST', `/v1/servers/${server.id}/power`, { action: 'stop' }, { timeoutMs: 90_000 });

    step(server, 'Packing files on the source node');
    const prep = await daemon<{ fileId: string; size: number; sha256: string }>(src, 'POST', `/v1/servers/${server.id}/transfer/prepare`, {}, { timeoutMs: 30 * 60_000 });
    exportFile = prep.fileId;

    step(server, 'Preparing the destination node');
    const hostPorts = freePorts(db, dst, server.ports.length);
    if (!hostPorts) throw new HostingError(503, 'NO_PORTS', 'The destination node ran out of free ports.');
    const newPorts = buildPorts(img, hostPorts).map((p, i) => ({ ...p, label: oldPorts[i]?.label || p.label }));
    const moved = { ...server, nodeId: dst.id, ports: newPorts, status: 'offline' } as HostServer;
    await daemon(dst, 'PUT', `/v1/servers/${server.id}`, specFor(db, moved));
    registeredOnDest = true;

    step(server, 'Copying files between nodes');
    const dl = await daemonRaw(src, 'GET', `/v1/servers/${server.id}/transfer/${prep.fileId}`, { timeoutMs: 30 * 60_000 });
    if (!dl.ok || !dl.body) throw new DaemonError(502, 'The source node could not send the archive.');
    const up = await daemonRaw(dst, 'PUT', `/v1/servers/${server.id}/transfer?sha256=${prep.sha256}&size=${prep.size}`, { body: dl.body, timeoutMs: 30 * 60_000 });
    if (!up.ok) { const j: any = await up.json().catch(() => ({})); throw new DaemonError(502, j.error || `The destination node rejected the transfer (${up.status}).`); }

    step(server, 'Switching over');
    server.nodeId = dst.id; server.ports = newPorts; server.status = 'offline'; server.transfer = undefined;
    saveDbSync(); dropStateCache(server.id);
    await pushSpec(db, server).catch(() => undefined);
    await daemon(src, 'DELETE', `/v1/servers/${server.id}/transfer/${prep.fileId}`).catch(() => undefined);
    await daemon(src, 'DELETE', `/v1/servers/${server.id}`, undefined, { timeoutMs: 120_000 }).catch(e => console.warn(`[Transfer] could not remove the old copy of ${server.id} from ${src.name}: ${e.message}`));
    if (wasRunning) await daemon(dst, 'POST', `/v1/servers/${server.id}/power`, { action: 'start' }, { timeoutMs: 60_000 }).catch(() => undefined);
  } catch (e: any) {
    console.error(`[Transfer] ${server.id} failed: ${e?.message}`);
    // Roll back. The records are only switched in the final step and nothing after that can throw, so here the
    // server is still (logically) on the source node: drop the half-copied target and bring the source back up.
    if (exportFile) await daemon(src, 'DELETE', `/v1/servers/${server.id}/transfer/${exportFile}`).catch(() => undefined);
    if (registeredOnDest) await daemon(dst, 'DELETE', `/v1/servers/${server.id}`, undefined, { timeoutMs: 120_000 }).catch(() => undefined);
    server.status = 'offline';
    server.transfer = { ...tr, state: 'failed', error: e?.message || 'Transfer failed', step: undefined };
    saveDbSync(); dropStateCache(server.id);
    if (wasRunning) await daemon(src, 'POST', `/v1/servers/${server.id}/power`, { action: 'start' }, { timeoutMs: 60_000 }).catch(() => undefined);
  }
}
