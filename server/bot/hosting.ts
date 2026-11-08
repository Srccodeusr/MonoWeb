import { DatabaseSchema, saveDbSync } from '../db';
import { User } from '../../src/types';
import { HostServer } from '../../src/hostingTypes';
import { Order } from '../../src/types';
import { createAuditLog } from '../auth';
import { Access, accessibleServers, can, resolveAccess } from '../hosting/access';
import { DaemonError, daemon } from '../hosting/daemonClient';
import { newId } from '../hosting/crypto';
import { allow } from '../hosting/ratelimit';
import { periodPrice } from '../hosting/plans';
import { fulfillHostingOrder } from '../hosting/billing';
import { HostingError, createServer, destroyServer, dropStateCache, liveLimits, liveState, nodeFor, pushSpec, renewServer, userCaps } from '../hosting/serverService';
import { AcCtx, BotError, Choice, Cmd, confirmReply, onConfirm, register } from './framework';
import { logActivity } from './state';
import { Reply, box, code, kv, mb, money, notice, payload, stateWord, when } from './ui';

const sym = (db: DatabaseSchema) => db.settings.currencySymbol || '$';
const norm = (s: string) => String(s || '').trim().toLowerCase();
const limitsText = (l: { ramMB: number; cpuPercent: number; diskMB: number }) => `${mb(l.ramMB)} RAM, ${l.cpuPercent}% CPU, ${mb(l.diskMB)} disk`;

function asBotError(e: any): never {
  if (e instanceof BotError) throw e;
  if (e instanceof HostingError) throw new BotError(e.message, 'Hosting request failed');
  if (e instanceof DaemonError) throw new BotError(e.message, 'Node error');
  throw e;
}

/* ================================================================== lookups */
function findServer(db: DatabaseSchema, user: User, ident?: string): { server: HostServer; acc: Access } {
  const list = accessibleServers(db, user.id).map(x => x.server).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!list.length) throw new BotError('You have no servers yet. Deploy one with /hosting create.', 'No servers', 'warn');
  let hit: HostServer | undefined;
  if (!ident) { if (list.length === 1) hit = list[0]; else throw new BotError(`You have ${list.length} servers. Name the one you mean: ${list.slice(0, 8).map(s => code(s.name)).join(', ')}.`, 'Which server?', 'warn'); }
  else {
    const q = norm(ident);
    hit = list.find(s => s.id === q) || list.find(s => s.id.startsWith(q)) || list.find(s => norm(s.name) === q) || (/^\d{1,3}$/.test(q) ? list[+q - 1] : undefined) || (list.filter(s => norm(s.name).includes(q)).length === 1 ? list.find(s => norm(s.name).includes(q)) : undefined);
  }
  if (!hit) throw new BotError(`No server matches "${String(ident).slice(0, 40)}". Use /hosting list.`, 'Server not found', 'warn');
  const acc = resolveAccess(db, user.id, hit.id); if (!acc) throw new BotError('Server not found.', 'Server not found', 'warn');
  return { server: hit, acc };
}

const acServer = (c: AcCtx, q: string): Choice[] => !c.user ? [] : accessibleServers(c.db, c.user.id).map(x => x.server).filter(s => norm(s.name).includes(norm(q))).slice(0, 25).map(s => ({ name: `${s.name} (${s.id.slice(0, 6)})`, value: s.id }));
const acSoftware = (c: AcCtx, q: string): Choice[] => c.db.images.filter(i => i.isActive && (norm(i.name).includes(norm(q)) || norm(i.software).includes(norm(q)))).slice(0, 25).map(i => ({ name: `${i.name} (${i.category})`, value: i.id }));
const acLocation = (c: AcCtx, q: string): Choice[] => [...new Set(c.db.nodes.filter(n => n.isPublic && !n.isMaintenance && n.status?.online).map(n => n.locationName))].filter(l => norm(l).includes(norm(q))).slice(0, 25).map(l => ({ name: l, value: l }));
const acPlan = (c: AcCtx, q: string): Choice[] => c.db.hostingPlans.filter(p => p.isActive && !p.isFree && norm(p.name).includes(norm(q))).slice(0, 25).map(p => ({ name: `${p.name} - ${money(p.monthlyPrice, sym(c.db))}/month`, value: p.id }));
const acPeriod = (c: AcCtx): Choice[] => (c.db.settings.hosting?.periods || []).map(p => ({ name: p.label, value: p.id }));

function assertUsable(s: HostServer): void {
  if (s.status === 'suspended') throw new BotError(`This server is suspended${s.suspendedReason ? `: ${s.suspendedReason}` : ''}. Contact support.`, 'Server unavailable', 'warn');
  if (s.status === 'expired') throw new BotError('This server has expired. Renew it with /hosting renew.', 'Server expired', 'warn');
  if (s.status === 'transferring') throw new BotError('This server is being moved to another node. Try again when it finishes.', 'Server busy', 'warn');
}

/* ================================================================== operations */
async function doPower(db: DatabaseSchema, server: HostServer, acc: Access, action: string): Promise<void> {
  if (!can(acc, 'power')) throw new BotError('You do not have permission to control this server.', 'No permission');
  if (action !== 'kill' && action !== 'stop') assertUsable(server);
  if (!allow(`bot:hpower:${server.id}`, 10, 60_000)) throw new BotError('Too many power actions. Wait a minute.', 'Slow down', 'warn');
  try { await pushSpec(db, server); await daemon(nodeFor(db, server), 'POST', `/v1/servers/${server.id}/power`, { action }, { timeoutMs: 60_000 }); } catch (e) { asBotError(e); }
  dropStateCache(server.id);
}

async function doRenew(db: DatabaseSchema, user: User, server: HostServer): Promise<{ price: number; coinName: string }> {
  const hs = db.settings.hosting!; const caps = userCaps(db, user);
  if (!hs.renew.coins.enabled || !caps.plan.renewal.methods.includes('coins')) throw new BotError('Renewing with coins is not enabled for your plan. Use the website to renew another way.', 'Renewal unavailable');
  const price = hs.renew.coins.priceCoins;
  if ((user.coins || 0) < price) throw new BotError(`You need ${price} ${hs.economy.coinName} (you have ${user.coins || 0}).`, 'Not enough coins');
  user.coins = (user.coins || 0) - price;
  db.coinTx.unshift({ id: newId('ctx'), userId: user.id, amount: -price, balanceAfter: user.coins, reason: `Renewed server "${server.name}" via Discord`, ref: server.id, createdAt: new Date().toISOString() });
  renewServer(db, server, hs.renew.coins.extendDays * 86400_000); await pushSpec(db, server).catch(() => undefined);
  return { price, coinName: hs.economy.coinName };
}

/* ================================================================== views */
async function serverView(db: DatabaseSchema, user: User, s: HostServer, acc: Access): Promise<Reply> {
  const live = await liveState(db, s); const node = db.nodes.find(n => n.id === s.nodeId); const img = db.images.find(i => i.id === s.imageId);
  const addr = node ? node.fqdn : '';
  return payload(box({
    title: s.name,
    text: [
      kv([['Status', stateWord(live.status)], ['Software', img?.name || s.imageId], ['Limits', limitsText(liveLimits(s))], ['Location', node ? `${node.locationName} (${node.name})` : 'node removed'], ['Role', acc.role === 'owner' ? 'Owner' : 'Team member'], ['Expires', s.expiresAt ? when(s.expiresAt) : 'never']]),
      s.ports.length ? `**Connect:** ${s.ports.map(p => code(`${addr}:${p.host}`) + (p.label ? ` ${p.label}` : '')).join(', ')}` : '',
      s.suspendedReason ? `**Suspended:** ${s.suspendedReason}` : '',
    ],
    footer: `ID ${s.id}`,
  }), true);
}

/* ================================================================== commands */
const cmds: Cmd[] = [
  {
    name: 'hosting plans', category: 'hosting', description: 'See hosting plans and your current plan',
    async run(ctx) {
      const { db, user } = await ctx.need(); const hs = db.settings.hosting!; const caps = userCaps(db, user);
      const plans = db.hostingPlans.filter(p => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
      await ctx.reply(payload(box({
        title: 'Hosting plans',
        text: [`**Your plan:** ${caps.plan.name}${user.planExpiresAt && !caps.plan.isFree ? `, until ${when(user.planExpiresAt, 'D')}` : ''} (${caps.used} of ${caps.serverLimit} servers used)`, '',
          ...plans.map(p => `**${p.name}**: ${p.isFree ? 'free' : `${money(p.monthlyPrice, sym(db))}/month`}, ${p.serverLimit} server${p.serverLimit === 1 ? '' : 's'}, each ${limitsText(p.perServer)}`), '', `**Billing periods:** ${hs.periods.map(p => `${p.label}${p.discountPercent ? ` (${p.discountPercent}% off)` : ''}`).join(', ')}`],
        footer: 'Upgrade with /hosting upgrade',
      }), true));
    },
  },
  {
    name: 'hosting software', category: 'hosting', description: 'List the software you can deploy',
    async run(ctx) {
      const { db } = await ctx.need(); const by = new Map<string, string[]>();
      for (const i of db.images.filter(x => x.isActive)) by.set(i.category, [...(by.get(i.category) || []), i.name]);
      if (!by.size) throw new BotError('No software is available right now.', 'Nothing to deploy', 'warn');
      await ctx.reply(payload(box({ title: 'Software', text: [...by].map(([c, n]) => `**${c}:** ${n.join(', ')}`), footer: 'Deploy with /hosting create' }), true));
    },
  },
  {
    name: 'hosting create', category: 'hosting', cooldown: 8, description: 'Deploy a new bot or game server',
    options: [
      { name: 'software', description: 'What to run', required: true, autocomplete: acSoftware },
      { name: 'name', description: 'Name for the server' },
      { name: 'location', description: 'Where to place it', autocomplete: acLocation },
    ],
    async run(ctx) {
      const { db, user } = await ctx.need();
      if (!db.settings.hosting!.enabled) throw new BotError('Server creation is disabled right now.', 'Hosting off');
      if (!allow(`bot:hcreate:${user.id}`, 5, 10 * 60_000)) throw new BotError('You are creating servers too quickly. Wait a few minutes.', 'Slow down', 'warn');
      const q = norm(ctx.args.software); const actives = db.images.filter(i => i.isActive);
      const img = actives.find(i => i.id === ctx.args.software || norm(i.name) === q) || (actives.filter(i => norm(i.name).includes(q)).length === 1 ? actives.find(i => norm(i.name).includes(q)) : undefined);
      if (!img) throw new BotError(`No software matches "${String(ctx.args.software).slice(0, 40)}". See /hosting software.`, 'Software not found', 'warn');
      await ctx.defer(true);
      let server: HostServer;
      try { server = await createServer(user, { name: String(ctx.args.name || `${img.name} server`).trim().slice(0, 60), imageId: img.id, location: ctx.args.location ? String(ctx.args.location) : undefined }); } catch (e) { return asBotError(e); }
      await createAuditLog(user.id, user.email, user.role, 'SERVER_CREATED', server.id, `Created server "${server.name}" via Discord`);
      logActivity(db, 'SERVER_CREATED', `${user.email} deployed ${img.name}`, false);
      await ctx.reply(payload(notice('success', `${server.name} is installing`, [`${img.name} is being set up. It takes a minute or two. Check progress with /hosting info.`, `Limits: ${limitsText(server.limits)}.`]), true));
    },
  },
  {
    name: 'hosting list', category: 'hosting', description: 'List your servers',
    async run(ctx) {
      const { db, user } = await ctx.need(); await ctx.defer(true);
      const list = accessibleServers(db, user.id).map(x => x.server).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!list.length) return void (await ctx.reply(payload(notice('info', 'Your servers', 'You have no servers yet. Use /hosting software, then /hosting create.'), true)));
      const states = await Promise.all(list.map(s => liveState(db, s)));
      await ctx.reply(payload(box({ title: `Your servers (${list.length})`, text: list.slice(0, 20).map((s, i) => `${i + 1}. **${s.name}**, ${stateWord(states[i].status)}, ${db.images.find(x => x.id === s.imageId)?.name || 'software'}${s.expiresAt ? `, expires ${when(s.expiresAt)}` : ''}`) }), true));
    },
  },
  {
    name: 'hosting info', category: 'hosting', description: 'Details of one server', options: [{ name: 'server', description: 'Which server (name or ID)', autocomplete: acServer }],
    async run(ctx) { const { db, user } = await ctx.need(); await ctx.defer(true); const { server, acc } = findServer(db, user, ctx.args.server); await ctx.reply(await serverView(db, user, server, acc)); },
  },
  {
    name: 'hosting power', category: 'hosting', description: 'Start, stop, restart or kill a server',
    options: [{ name: 'action', description: 'What to do', required: true, choices: [{ name: 'Start', value: 'start' }, { name: 'Stop', value: 'stop' }, { name: 'Restart', value: 'restart' }, { name: 'Kill', value: 'kill' }] }, { name: 'server', description: 'Which server (name or ID)', autocomplete: acServer }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const { server, acc } = findServer(db, user, ctx.args.server); await ctx.defer(true); await doPower(db, server, acc, String(ctx.args.action));
      await ctx.reply(payload(notice('success', `${server.name}: ${ctx.args.action}`, 'The command was sent. Use /hosting info in a few seconds to see the new state.'), true));
    },
  },
  {
    name: 'hosting renew', category: 'hosting', description: 'Extend a server using coins', options: [{ name: 'server', description: 'Which server (name or ID)', autocomplete: acServer }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const { server, acc } = findServer(db, user, ctx.args.server); if (!can(acc, 'owner')) throw new BotError('Only the owner can renew a server.', 'No permission');
      const hs = db.settings.hosting!;
      await ctx.reply(confirmReply(ctx.user.id, 'host.renew', { id: server.id }, { title: 'Confirm renewal', label: 'Renew', text: [kv([['Server', server.name], ['Cost', `${hs.renew.coins.priceCoins} ${hs.economy.coinName}`], ['Adds', `${hs.renew.coins.extendDays} days`], ['Your balance', `${user.coins || 0} ${hs.economy.coinName}`]])] }));
    },
  },
  {
    name: 'hosting delete', category: 'hosting', description: 'Permanently delete a server', options: [{ name: 'server', description: 'Which server (name or ID)', autocomplete: acServer }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const { server, acc } = findServer(db, user, ctx.args.server); if (!can(acc, 'owner')) throw new BotError('Only the owner can delete a server.', 'No permission');
      await ctx.reply(confirmReply(ctx.user.id, 'host.delete', { id: server.id }, { title: 'Delete server', danger: true, label: 'Delete forever', text: [`This permanently deletes ${code(server.name)} with all its files and backups. This cannot be undone.`] }));
    },
  },
  {
    name: 'hosting upgrade', category: 'hosting', cooldown: 5, description: 'Buy or extend a hosting plan with account credits',
    options: [{ name: 'plan', description: 'Plan to buy', required: true, autocomplete: acPlan }, { name: 'period', description: 'Billing period (default: first one)', autocomplete: acPeriod }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const hs = db.settings.hosting!; const q = norm(ctx.args.plan);
      const plan = db.hostingPlans.find(p => p.isActive && !p.isFree && (p.id === ctx.args.plan || norm(p.name) === q)); if (!plan) throw new BotError(`No paid plan matches "${String(ctx.args.plan).slice(0, 40)}". See /hosting plans.`, 'Plan not found', 'warn');
      const pq = norm(ctx.args.period || ''); const period = pq ? hs.periods.find(p => p.id === ctx.args.period || norm(p.label) === pq) : hs.periods[0]; if (!period) throw new BotError(`Unknown period. Options: ${hs.periods.map(p => p.label).join(', ')}.`, 'Period not found', 'warn');
      const price = periodPrice(plan, period).total;
      await ctx.reply(confirmReply(ctx.user.id, 'host.upgrade', { planId: plan.id, periodId: period.id }, { title: 'Confirm plan purchase', label: `Pay ${money(price, sym(db))}`, text: [kv([['Plan', plan.name], ['Period', period.label], ['Price', money(price, sym(db))], ['Your credits', money(user.credits, sym(db))]]), 'Your existing servers are lifted to the new plan automatically.'] }));
    },
  },
];

/* ================================================================== confirmations */
const owned = (db: DatabaseSchema, user: User, id: string): HostServer => {
  const acc = resolveAccess(db, user.id, id); const s = db.servers.find(x => x.id === id);
  if (!acc || !s || !can(acc, 'owner')) throw new BotError('That server no longer exists or is not yours.', 'Server not found');
  return s;
};

onConfirm('host.renew', async (_i, d: { id: string }, user, db) => {
  const s = owned(db, user, d.id); let r; try { r = await doRenew(db, user, s); } catch (e) { return asBotError(e); }
  return payload(notice('success', 'Renewed', [`${code(s.name)} now runs until ${when(s.expiresAt, 'f')} (${when(s.expiresAt)}).`, `Spent ${r.price} ${r.coinName}.`]), true);
});

onConfirm('host.delete', async (_i, d: { id: string }, user, db) => {
  const s = owned(db, user, d.id);
  try { await destroyServer(db, s); } catch (e) { return asBotError(e); }
  await createAuditLog(user.id, user.email, user.role, 'SERVER_DELETED', s.id, `Deleted server "${s.name}" via Discord`);
  return payload(notice('success', 'Server deleted', `${code(s.name)} was deleted.`), true);
});

onConfirm('host.upgrade', async (_i, d: { planId: string; periodId: string }, user, db) => {
  const hs = db.settings.hosting!; const plan = db.hostingPlans.find(p => p.id === d.planId && p.isActive && !p.isFree); const period = hs.periods.find(p => p.id === d.periodId);
  if (!plan || !period) throw new BotError('That plan is no longer available.', 'Plan not found');
  const price = periodPrice(plan, period).total;
  if (user.credits < price) throw new BotError(`You need ${money(price, sym(db))} in credits (balance ${money(user.credits, sym(db))}). Add credits on the website Billing page.`, 'Not enough credits');
  user.credits = Math.round((user.credits - price) * 100) / 100;
  const order: Order = {
    id: newId('ord'), userId: user.id, userEmail: user.email, planId: plan.id, planName: `${plan.name} (${period.label})`, billingCycle: period.months >= 12 ? 'yearly' : 'monthly', kind: 'hosting_plan',
    hostingPlanId: plan.id, hostingPeriodId: period.id, amount: price, currency: db.settings.currencyCode || 'USD', status: 'pending', paymentMethod: 'Account Credits', createdAt: new Date().toISOString(),
  } as Order;
  db.orders.unshift(order); await fulfillHostingOrder(db, order); saveDbSync();
  await createAuditLog(user.id, user.email, user.role, 'HOSTING_PLAN_PURCHASED', order.id, `Bought ${order.planName} with credits via Discord`);
  return payload(notice('success', 'Plan activated', [`${plan.name} (${period.label}) is active until ${when(user.planExpiresAt, 'D')}.`, `Charged ${money(price, sym(db))}. Credits left: ${money(user.credits, sym(db))}.`]), true);
});

export function registerHostingCommands(): void { for (const c of cmds) register(c); }
