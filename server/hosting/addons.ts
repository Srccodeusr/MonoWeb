import { DatabaseSchema, saveDbSync } from '../db';
import { User } from '../../src/types';
import { Addon, AddonInstall, HostServer } from '../../src/hostingTypes';
import { daemon } from './daemonClient';
import { newId } from './crypto';
import { addCoinsTo } from './coins';
import { HostingError, nodeFor, pushSpec } from './serverService';

const fail = (status: number, code: string, message: string): never => { throw new HostingError(status, code, message); };

export function isCompatible(addon: Addon, server: HostServer): boolean {
  return addon.compatibleImageIds.length === 0 || addon.compatibleImageIds.includes(server.imageId);
}

export function publicAddon(db: DatabaseSchema, a: Addon, server?: HostServer) {
  const installed = server ? db.addonInstalls.some(i => i.serverId === server.id && i.addonId === a.id) : false;
  return {
    id: a.id, name: a.name, slug: a.slug, description: a.description, iconUrl: a.iconUrl, category: a.category, author: a.author, version: a.version,
    priceCoins: a.priceCoins, priceMoney: a.priceMoney, featured: a.featured, installs: a.installs, restartAfter: a.restartAfter,
    compatible: server ? isCompatible(a, server) : true, installed,
    works: a.compatibleImageIds.length === 0 ? ['All software'] : a.compatibleImageIds.map(id => db.images.find(i => i.id === id)?.name).filter(Boolean),
  };
}

/** Charges, downloads the files on the node, records the install. Refunds automatically if the node fails. */
export async function installAddon(db: DatabaseSchema, user: User, server: HostServer, addon: Addon, payWith: 'coins' | 'credits', running: boolean): Promise<AddonInstall> {
  if (!addon.isActive) fail(404, 'NOT_FOUND', 'That addon is not available.');
  if (!isCompatible(addon, server)) fail(400, 'INCOMPATIBLE', 'This addon does not work with that server\'s software.');
  if (db.addonInstalls.some(i => i.serverId === server.id && i.addonId === addon.id)) fail(409, 'INSTALLED', 'Already installed on this server.');
  if (['suspended', 'expired', 'installing', 'install_failed', 'transferring'].includes(server.status)) fail(409, 'BAD_STATE', 'The server is not in a state that allows installs.');

  // charge (check-and-deduct is synchronous, so two simultaneous requests cannot both pass)
  let charged: { kind: 'coins' | 'credits'; amount: number } | null = null;
  if (addon.priceCoins > 0 || addon.priceMoney > 0) {
    if (payWith === 'credits') {
      if (addon.priceMoney <= 0) fail(400, 'NO_MONEY_PRICE', 'This addon is paid in coins.');
      if (user.credits < addon.priceMoney) fail(402, 'INSUFFICIENT_CREDITS', 'Not enough account credits.');
      user.credits = Math.round((user.credits - addon.priceMoney) * 100) / 100; charged = { kind: 'credits', amount: addon.priceMoney };
    } else {
      if (addon.priceCoins <= 0) fail(400, 'NO_COIN_PRICE', 'This addon is paid with account credits.');
      if ((user.coins || 0) < addon.priceCoins) fail(402, 'INSUFFICIENT_COINS', `You need ${addon.priceCoins} coins.`);
      addCoinsTo(db, user, -addon.priceCoins, `Addon: ${addon.name}`, `addon:${addon.id}`); charged = { kind: 'coins', amount: addon.priceCoins };
    }
  }
  const refund = () => {
    if (!charged) return;
    if (charged.kind === 'credits') user.credits = Math.round((user.credits + charged.amount) * 100) / 100;
    else addCoinsTo(db, user, charged.amount, `Refund: ${addon.name}`, `addon:${addon.id}:refund`);
  };

  try {
    const node = nodeFor(db, server);
    const r = await daemon<{ paths: string[] }>(node, 'POST', `/v1/servers/${server.id}/addon/install`, { files: addon.files }, { timeoutMs: 6 * 60_000 });
    if (running && addon.postCommand) await daemon(node, 'POST', `/v1/servers/${server.id}/command`, { command: addon.postCommand }).catch(() => undefined);
    if (running && addon.restartAfter) { await pushSpec(db, server); await daemon(node, 'POST', `/v1/servers/${server.id}/power`, { action: 'restart' }, { timeoutMs: 90_000 }).catch(() => undefined); }
    const rec: AddonInstall = { id: newId('ain'), serverId: server.id, addonId: addon.id, userId: user.id, version: addon.version, paths: r.paths, installedAt: new Date().toISOString() };
    db.addonInstalls.push(rec); addon.installs = (addon.installs || 0) + 1; saveDbSync();
    return rec;
  } catch (e) { refund(); saveDbSync(); throw e; }
}

export async function uninstallAddon(db: DatabaseSchema, server: HostServer, install: AddonInstall): Promise<void> {
  if (['suspended', 'transferring'].includes(server.status)) fail(409, 'BAD_STATE', 'The server is not in a state that allows changes.');
  await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/addon/remove`, { paths: install.paths }, { timeoutMs: 60_000 });
  db.addonInstalls = db.addonInstalls.filter(i => i.id !== install.id); saveDbSync();
}
