import { DatabaseSchema, getDb, saveDbSync } from '../db';
import { createAuditLog } from '../auth';
import { logVpsEvent, mailUser, nodeOf, forgetLive, refreshVpsNodes, dpath } from '../vps/service';
import { vpsDaemon } from '../vps/daemonClient';
import { stopQuietly, userCaps } from '../hosting/serverService';
import { Cmd, Tier, allCommands, answer, hasTier, onComponent, register, tierFor, userByDiscord, BotError } from './framework';
import { botNodes, nodeViews, onNodesChanged } from './nodes';
import { addBan, botState, findBan, removeBan, logActivity } from './state';
import { Reply, box, code, kv, linkBtn, money, notice, payload, row, select, trunc, when, botName } from './ui';

const sym = (db: DatabaseSchema) => db.settings.currencySymbol || '$';
export const siteUrl = (): string => (process.env.APP_URL || '').trim().replace(/\/+$/, '');

/* ================================================================== help */
const CATS: { key: string; label: string; blurb: string }[] = [
  { key: 'general', label: 'General', blurb: 'Help, status and links' },
  { key: 'account', label: 'Account', blurb: 'Your linked website account' },
  { key: 'vps', label: 'VPS', blurb: 'Deploy and manage virtual servers' },
  { key: 'hosting', label: 'Hosting', blurb: 'Bot and game servers' },
  { key: 'admin', label: 'Staff and admin', blurb: 'Moderation tools' },
];

function usageLine(c: Cmd): string { return `/${c.name}${(c.options || []).map(o => (o.required ? ` <${o.name}>` : ` [${o.name}]`)).join('')}`; }

function helpReply(tier: Tier, category?: string): Reply {
  const visible = allCommands().filter(c => hasTier(tier, c.tier || 'customer'));
  const cats = CATS.filter(c => visible.some(v => v.category === c.key));
  const menu = select('mb|help', 'Browse a category', cats.map(c => ({ label: c.label, value: c.key, description: c.blurb, default: c.key === category })));
  if (!category) return payload(box({ title: `${botName()} help`, text: [`Deploy and manage VPS and hosting servers from Discord. Everything runs on your website account: link Discord there first (use /link).`, '', ...cats.map(c => `**${c.label}:** ${c.blurb} (${visible.filter(v => v.category === c.key).length} commands)`)], rows: [menu] }));
  const list = visible.filter(c => c.category === category);
  return payload(box({ title: CATS.find(c => c.key === category)?.label || category, text: list.map(c => `**${usageLine(c)}**\n${c.description}`).join('\n'), rows: [menu] }));
}

onComponent('help', async (i, _p, db) => { await answer(i, helpReply(tierFor(db, i.user.id, i.member?.roles?.cache ? [...i.member.roles.cache.keys()] : []), i.values?.[0])); });

/* ================================================================== admin helpers */
function actor(db: DatabaseSchema, discordId: string): { id: string; email: string; role: string } {
  const u = userByDiscord(db, discordId); return u ? { id: u.id, email: u.email, role: u.role } : { id: `discord:${discordId}`, email: `discord:${discordId}`, role: 'owner' };
}
const audit = (db: DatabaseSchema, discordId: string, action: string, target: string, details: string) => { const a = actor(db, discordId); return createAuditLog(a.id, a.email, a.role, action, target, details); };

function lookupTarget(db: DatabaseSchema, ident: string): { kind: 'vps'; id: string } | { kind: 'server'; id: string } | null {
  const q = ident.trim().toLowerCase(); if (q.length < 6) return null;
  const v = db.vpsServers.find(x => x.id === q) || db.vpsServers.find(x => x.id.startsWith(q)); if (v) return { kind: 'vps', id: v.id };
  const s = db.servers.find(x => x.id === q) || db.servers.find(x => x.id.startsWith(q)); return s ? { kind: 'server', id: s.id } : null;
}

const idOpt = { name: 'id', description: 'VPS or server ID (first 6+ characters work)', required: true };

const cmds: Cmd[] = [
  { name: 'help', category: 'general', description: 'Show what this bot can do', options: [{ name: 'category', description: 'Open one category', choices: CATS.map(c => ({ name: c.label, value: c.key })) }], async run(ctx) { const db = await getDb(); await ctx.reply(helpReply(tierFor(db, ctx.user.id, ctx.roleIds), ctx.args.category)); } },
  { name: 'ping', category: 'general', description: 'Check that the bot is alive', async run(ctx) { await ctx.reply(payload(notice('info', 'Pong', `Gateway latency ${Math.round(ctx.client.ws.ping)} ms.`), true)); } },
  {
    name: 'about', category: 'general', description: 'About this bot',
    async run(ctx) {
      const up = ctx.client.uptime ? Math.floor(ctx.client.uptime / 60000) : 0; const url = siteUrl();
      await ctx.reply(payload(box({ title: botName(), text: [kv([['Servers', ctx.client.guilds.cache.size], ['Commands', allCommands().length], ['Uptime', `${Math.floor(up / 60)}h ${up % 60}m`], ['Website', url || undefined]]), 'Part of your hosting platform. VPS and hosting servers you buy here appear on the website and the other way round.'], rows: url ? [row(linkBtn(url, 'Open website'))] : undefined })));
    },
  },
  {
    name: 'link', category: 'account', description: 'See how to link your Discord account to the website',
    async run(ctx) {
      const db = await getDb(); const u = userByDiscord(db, ctx.user.id); const url = siteUrl();
      if (u) return void (await ctx.reply(payload(notice('success', 'Linked', `Discord is linked to ${code(u.email)}. Disconnect or change it in your website Settings.`), true)));
      await ctx.reply(payload(box({ title: 'Link your account', tone: 'warn', text: ['1. Sign in on the website.', '2. Open Settings and connect your Discord account.', '3. Come back and run any command.'], rows: url ? [row(linkBtn(`${url}/settings`, 'Open settings'))] : undefined }), true));
    },
  },
  {
    name: 'account', category: 'account', aliases: ['balance', 'me'], description: 'Your credits, coins, plan and services',
    async run(ctx) {
      const { db, user } = await ctx.need(); const caps = userCaps(db, user); const hs = db.settings.hosting!;
      await ctx.reply(payload(box({
        title: user.displayName || user.username,
        text: kv([['Email', user.email], ['Credits', money(user.credits, sym(db))], [hs.economy.enabled ? hs.economy.coinName : 'Coins', user.coins || 0], ['Hosting plan', `${caps.plan.name}${user.planExpiresAt && !caps.plan.isFree ? `, until ${when(user.planExpiresAt, 'D')}` : ''}`], ['VPS', db.vpsServers.filter(v => v.ownerId === user.id).length], ['Servers', `${caps.used} of ${caps.serverLimit}`]]),
        footer: 'Add credits on the website Billing page',
      }), true));
    },
  },
  {
    name: 'nodes', category: 'general', description: 'Which locations and nodes the bot deploys VPS on',
    async run(ctx) {
      const db = await getDb(); const views = nodeViews(db);
      const hostOnline = db.nodes.filter(n => n.status?.online).length;
      await ctx.reply(payload(box({
        title: 'Nodes',
        text: [views.length ? views.map(n => `**${n.name}**, ${n.location}, ${n.online ? 'Online' : 'Offline'}${n.enabled ? '' : ' (not accepting new VPS)'}, ${n.vpsCount}${n.maxVps ? ` of ${n.maxVps}` : ''} VPS`).join('\n') : 'No VPS node is connected to the bot yet.', `**Hosting nodes online:** ${hostOnline} of ${db.nodes.length}`],
      })));
    },
  },

  /* ---------------------------------------------------------------- staff + admin (small on purpose: the website has the full console) */
  {
    name: 'admin lookup', category: 'admin', tier: 'staff', description: 'Look up a member: account, services, bans', options: [{ name: 'user', description: 'Discord user', type: 'user', required: true }],
    async run(ctx) {
      const db = await getDb(); const target = ctx.args.user; const u = userByDiscord(db, target.id); const ban = findBan(db, target.id);
      if (!u) return void (await ctx.reply(payload(notice('warn', 'Not linked', `${trunc(target.username, 40)} has no linked website account.${ban ? ` Bot ban: ${ban.reason}` : ''}`), true)));
      const vps = db.vpsServers.filter(v => v.ownerId === u.id); const srv = db.servers.filter(s => s.ownerId === u.id);
      await ctx.reply(payload(box({
        title: `${u.displayName || u.username}`,
        text: [kv([['Email', u.email], ['Role', u.role], ['Website account', u.isSuspended ? 'Suspended' : 'Active'], ['Credits', money(u.credits, sym(db))], ['Coins', u.coins || 0], ['Bot ban', ban ? ban.reason : 'None']]),
          `**VPS (${vps.length}):** ${vps.slice(0, 8).map(v => `${v.name} ${code(v.id.slice(0, 8))}${v.suspended ? ' suspended' : ''}`).join(', ') || 'none'}`,
          `**Servers (${srv.length}):** ${srv.slice(0, 8).map(s => `${s.name} ${code(s.id.slice(0, 8))}${s.status === 'suspended' ? ' suspended' : ''}`).join(', ') || 'none'}`],
      }), true));
    },
  },
  {
    name: 'admin stats', category: 'admin', tier: 'staff', description: 'Platform numbers at a glance',
    async run(ctx) {
      const db = await getDb(); const s = botState(db);
      await ctx.reply(payload(box({ title: 'Platform stats', text: kv([['Users', db.users.length], ['VPS', `${db.vpsServers.length} (${db.vpsServers.filter(v => v.suspended).length} suspended)`], ['Hosting servers', db.servers.length], ['Bot nodes', `${botNodes(db).filter(n => n.status?.online).length} online of ${botNodes(db).length}`], ['Bot bans', s.bans.length], ['Commands run', s.commandsRun]]) }), true));
    },
  },
  {
    name: 'admin suspend', category: 'admin', tier: 'staff', description: 'Suspend a VPS or hosting server', options: [idOpt, { name: 'reason', description: 'Shown to the owner', rest: true }],
    async run(ctx) {
      const db = await getDb(); const t = lookupTarget(db, String(ctx.args.id)); if (!t) throw new BotError('No VPS or server matches that ID.', 'Not found', 'warn');
      const reason = String(ctx.args.reason || 'Suspended by staff').slice(0, 100); await ctx.defer(true); const a = actor(db, ctx.user.id);
      if (t.kind === 'vps') {
        const v = db.vpsServers.find(x => x.id === t.id)!; v.suspended = true; v.suspendReason = reason; v.status = 'suspended'; saveDbSync(); forgetLive(v.id);
        const n = nodeOf(db, v); if (n) await vpsDaemon(n, 'POST', dpath(v, '/power'), { action: 'stop' }, 40_000).catch(() => undefined);
        logVpsEvent(db, v, a.email, 'SUSPENDED', `${reason} via Discord`); mailUser(db, v.ownerId, `VPS "${v.name}" was suspended`, `Your VPS "${v.name}" was suspended.\n\nReason: ${reason}`); saveDbSync();
        await audit(db, ctx.user.id, 'VPS_SUSPENDED', v.id, reason); logActivity(db, 'SUSPEND', `${a.email} suspended VPS ${v.name}`);
      } else {
        const s = db.servers.find(x => x.id === t.id)!; s.status = 'suspended'; s.suspendedReason = reason; saveDbSync(); await stopQuietly(db, s);
        await audit(db, ctx.user.id, 'SERVER_SUSPENDED', s.id, reason); logActivity(db, 'SUSPEND', `${a.email} suspended server ${s.name}`);
      }
      await ctx.reply(payload(notice('success', 'Suspended', `${code(String(ctx.args.id).slice(0, 12))} is suspended. Reason: ${reason}`), true));
    },
  },
  {
    name: 'admin unsuspend', category: 'admin', tier: 'staff', description: 'Lift a suspension', options: [idOpt],
    async run(ctx) {
      const db = await getDb(); const t = lookupTarget(db, String(ctx.args.id)); if (!t) throw new BotError('No VPS or server matches that ID.', 'Not found', 'warn');
      await ctx.defer(true); const a = actor(db, ctx.user.id);
      if (t.kind === 'vps') {
        const v = db.vpsServers.find(x => x.id === t.id)!; v.suspended = false; v.suspendReason = undefined; v.status = 'offline'; v.expiredAt = undefined;
        if (Date.parse(v.expiresAt) < Date.now()) v.expiresAt = new Date(Date.now() + 86_400_000).toISOString();
        saveDbSync(); forgetLive(v.id); const n = nodeOf(db, v); if (n) await vpsDaemon(n, 'POST', dpath(v, '/power'), { action: 'start' }, 40_000).catch(() => undefined);
        logVpsEvent(db, v, a.email, 'UNSUSPENDED', 'via Discord'); saveDbSync(); await audit(db, ctx.user.id, 'VPS_UNSUSPENDED', v.id, v.name);
      } else {
        const s = db.servers.find(x => x.id === t.id)!; s.status = 'offline'; s.suspendedReason = undefined; saveDbSync(); await audit(db, ctx.user.id, 'SERVER_UNSUSPENDED', s.id, 'Unsuspended');
      }
      logActivity(db, 'UNSUSPEND', `${a.email} lifted a suspension`);
      await ctx.reply(payload(notice('success', 'Suspension lifted', `${code(String(ctx.args.id).slice(0, 12))} can be used again.`), true));
    },
  },
  {
    name: 'admin ban', category: 'admin', tier: 'admin', description: 'Block a member from using the bot', options: [{ name: 'user', description: 'Discord user', type: 'user', required: true }, { name: 'reason', description: 'Reason', rest: true }],
    async run(ctx) {
      const db = await getDb(); const target = ctx.args.user;
      if (hasTier(tierFor(db, target.id, []), 'staff')) throw new BotError('You cannot ban staff.', 'Not allowed');
      addBan(db, target.id, String(ctx.args.reason || ''), actor(db, ctx.user.id).email); logActivity(db, 'BAN', `${actor(db, ctx.user.id).email} banned ${target.username} (${target.id}) from the bot`);
      await ctx.reply(payload(notice('success', 'Banned', `${trunc(target.username, 40)} can no longer use the bot. Their website account and services are untouched.`), true));
    },
  },
  {
    name: 'admin unban', category: 'admin', tier: 'admin', description: 'Allow a banned member again', options: [{ name: 'user', description: 'Discord user', type: 'user', required: true }],
    async run(ctx) {
      const db = await getDb(); const ok = removeBan(db, ctx.args.user.id); if (ok) logActivity(db, 'UNBAN', `${actor(db, ctx.user.id).email} unbanned ${ctx.args.user.username}`);
      await ctx.reply(payload(ok ? notice('success', 'Unbanned', 'They can use the bot again.') : notice('info', 'Not banned', 'That member has no bot ban.'), true));
    },
  },
  {
    name: 'admin sync', category: 'admin', tier: 'admin', cooldown: 15, description: 'Re-check nodes now and refresh the bot node list',
    async run(ctx) {
      await ctx.defer(true); const db = await getDb();
      await refreshVpsNodes(); await onNodesChanged(); const nodes = botNodes(db);
      await ctx.reply(payload(notice('success', 'Synced', `${nodes.filter(n => n.status?.online).length} of ${nodes.length} bot nodes are online. Nodes are added and removed in the website admin panel.`), true));
    },
  },
];

export function registerGeneralCommands(): void { for (const c of cmds) register(c); }
