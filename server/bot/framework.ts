import crypto from 'crypto';
import { DatabaseSchema, getDb } from '../db';
import { User } from '../../src/types';
import { botState, findBan } from './state';
import { Reply, Tone, box, btn, message, notice, payload, row, trunc, flags, V2 } from './ui';

/* ================================================================== errors */
/** A problem the user should read: wrong input, no permission, not enough credits... Anything else is logged and reported with a reference id. */
export class BotError extends Error {
  constructor(message: string, public title = 'Request denied', public tone: Tone = 'error', public rows?: any[]) { super(message); }
}
export class UsageError extends BotError { constructor(message: string, public hint?: string) { super(message, 'Invalid usage', 'warn'); } }

/* ================================================================== tiers */
export type Tier = 'customer' | 'staff' | 'admin' | 'owner';
export const RANK: Record<Tier, number> = { customer: 0, staff: 1, admin: 2, owner: 3 };
export const hasTier = (have: Tier, need: Tier): boolean => RANK[have] >= RANK[need];

export function userByDiscord(db: DatabaseSchema, discordId: string): User | undefined {
  const direct = db.users.find(u => u.discordId === discordId);
  if (direct) return direct;
  const linked = Object.entries(db.discordLinks || {}).find(([, l]) => l?.discordId === discordId);
  return linked ? db.users.find(u => u.id === linked[0]) : undefined;
}

export function tierFor(db: DatabaseSchema, discordId: string, roleIds: string[]): Tier {
  const cfg = botState(db).config;
  if (cfg.ownerIds.includes(discordId)) return 'owner';
  let best: Tier = 'customer';
  const bump = (t: Tier) => { if (RANK[t] > RANK[best]) best = t; };
  const u = userByDiscord(db, discordId);
  if (u && !u.isSuspended) { if (u.role === 'super_admin') bump('owner'); else if (u.role === 'admin') bump('admin'); else if (u.role === 'support' || u.role === 'moderator') bump('staff'); }
  if (roleIds.some(r => cfg.adminRoleIds.includes(r))) bump('admin');
  if (roleIds.some(r => cfg.staffRoleIds.includes(r))) bump('staff');
  return best;
}

/* ================================================================== command model */
export type OptType = 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'channel' | 'role';
export interface Choice { name: string; value: string | number }
export interface AcCtx { db: DatabaseSchema; discordId: string; user: User | undefined; get: (name: string) => string | undefined }
export interface Opt {
  name: string; description: string; type?: OptType; required?: boolean; rest?: boolean; min?: number; max?: number;
  choices?: Choice[]; autocomplete?: (c: AcCtx, query: string) => Choice[] | Promise<Choice[]>;
}
export type Category = 'general' | 'account' | 'vps' | 'hosting' | 'admin';
export interface Cmd {
  name: string;                  // "ping" or "vps list" (one or two words)
  aliases?: string[];
  description: string;           // <= 100 chars
  category: Category;
  tier?: Tier;
  options?: Opt[];
  cooldown?: number;             // seconds, default 2
  guildOnly?: boolean;
  run: (ctx: Ctx) => Promise<void>;
}

const TYPE: Record<OptType, number> = { string: 3, integer: 4, boolean: 5, user: 6, channel: 7, role: 8, number: 10 };
const GROUPS: Record<string, string> = { vps: 'Deploy and manage your VPS', hosting: 'Deploy and manage bot and game servers', admin: 'Staff and admin tools' };

const commands = new Map<string, Cmd>();
const aliasMap = new Map<string, Cmd>();

export function register(cmd: Cmd): boolean {
  const bad = !/^[a-z0-9_-]+( [a-z0-9_-]+)?$/.test(cmd.name) ? `bad name "${cmd.name}"` : !cmd.description || cmd.description.length > 100 ? `${cmd.name}: description required (max 100)` : typeof cmd.run !== 'function' ? `${cmd.name}: missing run()` : commands.has(cmd.name) ? `duplicate "${cmd.name}"` : '';
  if (bad) { console.warn(`[Manager Bot] command rejected: ${bad}`); return false; }
  let optional = false;
  for (const o of cmd.options || []) {
    if (!/^[a-z0-9_-]{1,32}$/.test(o.name) || !o.description || o.description.length > 100) { console.warn(`[Manager Bot] command rejected: ${cmd.name} has a bad option "${o.name}"`); return false; }
    if (o.required && optional) { console.warn(`[Manager Bot] command rejected: ${cmd.name} required option after optional`); return false; }
    if (!o.required) optional = true;
  }
  cmd.tier = cmd.tier || 'customer'; cmd.options = (cmd.options || []).map(o => ({ type: 'string' as OptType, ...o }));
  commands.set(cmd.name, cmd);
  for (const a of cmd.aliases || []) if (!aliasMap.has(a) && !commands.has(a)) aliasMap.set(a, cmd);
  return true;
}
export const clearCommands = () => { commands.clear(); aliasMap.clear(); };
export const allCommands = (): Cmd[] => [...commands.values()];
export const getCommand = (name: string): Cmd | undefined => commands.get(name);

function resolve(tokens: string[]): { cmd: Cmd; used: number } | null {
  for (let n = Math.min(2, tokens.length); n >= 1; n--) {
    const key = tokens.slice(0, n).join(' '); const cmd = commands.get(key) || aliasMap.get(key);
    if (cmd) return { cmd, used: n };
  }
  return null;
}

const optJSON = (o: Opt) => {
  const j: any = { type: TYPE[o.type || 'string'], name: o.name, description: o.description, required: !!o.required };
  if (o.choices) j.choices = o.choices.slice(0, 25).map(c => ({ name: String(c.name).slice(0, 100), value: c.value }));
  else if (o.autocomplete) j.autocomplete = true;
  if (o.min !== undefined && (o.type === 'integer' || o.type === 'number')) j.min_value = o.min;
  if (o.max !== undefined && (o.type === 'integer' || o.type === 'number')) j.max_value = o.max;
  return j;
};

/** Slash command definitions: "vps list" becomes /vps list. Required options are always listed before optional ones. */
export function slashJSON(): any[] {
  const top = new Map<string, any>();
  for (const cmd of commands.values()) {
    const parts = cmd.name.split(' ');
    const options = (cmd.options || []).map(optJSON);
    if (parts.length === 1) { top.set(parts[0], { name: parts[0], description: cmd.description, type: 1, options }); continue; }
    if (!top.has(parts[0])) top.set(parts[0], { name: parts[0], description: GROUPS[parts[0]] || `${parts[0]} commands`, type: 1, options: [] });
    top.get(parts[0]).options.push({ type: 1, name: parts[1], description: cmd.description, options });
  }
  return [...top.values()].slice(0, 100);
}

/* ================================================================== arguments (prefix commands) */
function tokenize(input: string): { value: string; start: number }[] {
  const out: { value: string; start: number }[] = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push({ value: m[1] ?? m[2] ?? m[3], start: m.index });
  return out;
}
export const usageOf = (prefix: string, cmd: Cmd): string => `Usage: ${'`'}${prefix}${cmd.name}${(cmd.options || []).map(o => (o.required ? ` <${o.name}>` : ` [${o.name}]`)).join('')}${'`'}`;

async function convert(o: Opt, raw: string, client: any): Promise<any> {
  switch (o.type) {
    case 'integer': { if (!/^-?\d+$/.test(raw)) throw new UsageError(`${o.name} must be a whole number.`); const n = parseInt(raw, 10); if (o.min !== undefined && n < o.min) throw new UsageError(`${o.name} must be at least ${o.min}.`); if (o.max !== undefined && n > o.max) throw new UsageError(`${o.name} must be at most ${o.max}.`); return n; }
    case 'number': { const n = Number(raw); if (!Number.isFinite(n)) throw new UsageError(`${o.name} must be a number.`); return n; }
    case 'boolean': { if (/^(true|yes|on|1|y)$/i.test(raw)) return true; if (/^(false|no|off|0|n)$/i.test(raw)) return false; throw new UsageError(`${o.name} must be yes or no.`); }
    case 'user': { const m = /^<@!?(\d{15,25})>$|^(\d{15,25})$/.exec(raw); if (!m) throw new UsageError(`${o.name} must be a user mention or ID.`); try { return await client.users.fetch(m[1] || m[2]); } catch { throw new UsageError('I could not find that user.'); } }
    case 'role': { const m = /^<@&(\d{15,25})>$|^(\d{15,25})$/.exec(raw); if (!m) throw new UsageError(`${o.name} must be a role mention or ID.`); return { id: m[1] || m[2] }; }
    case 'channel': { const m = /^<#(\d{15,25})>$|^(\d{15,25})$/.exec(raw); if (!m) throw new UsageError(`${o.name} must be a channel mention or ID.`); return { id: m[1] || m[2] }; }
    default: {
      if (o.choices) { const c = o.choices.find(x => String(x.value).toLowerCase() === raw.toLowerCase() || String(x.name).toLowerCase() === raw.toLowerCase()); if (!c) throw new UsageError(`${o.name} must be one of: ${o.choices.map(x => x.value).join(', ')}.`); return c.value; }
      return raw;
    }
  }
}

async function parseArgs(cmd: Cmd, tokens: { value: string; start: number }[], raw: string, client: any, prefix: string): Promise<Record<string, any>> {
  const args: Record<string, any> = {}; let i = 0;
  for (const o of cmd.options || []) {
    if (i >= tokens.length) { if (o.required) throw new UsageError(`Missing ${o.name}.`, usageOf(prefix, cmd)); continue; }
    if (o.rest) { const v = raw.slice(tokens[i].start).trim(); args[o.name] = o.type === 'string' || !o.type ? v : await convert(o, v, client); i = tokens.length; break; }
    args[o.name] = await convert(o, tokens[i].value, client); i++;
  }
  return args;
}

/* ================================================================== context */
export class Ctx {
  state: 'none' | 'deferred' | 'replied' = 'none';
  response: any = null;
  tier: Tier = 'customer';
  constructor(public client: any, public cmd: Cmd, public args: Record<string, any>, public prefix: string, public interaction: any = null, public msg: any = null) {}

  get user() { return this.interaction ? this.interaction.user : this.msg.author; }
  get guild() { return (this.interaction || this.msg).guild || null; }
  get isSlash(): boolean { return !!this.interaction; }
  get roleIds(): string[] { const m = (this.interaction || this.msg).member; return m?.roles?.cache ? [...m.roles.cache.keys()] : []; }

  /** The website account linked to this Discord user. Throws a friendly error when there is none. */
  async need(): Promise<{ db: DatabaseSchema; user: User }> {
    const db = await getDb(); const u = userByDiscord(db, this.user.id);
    if (!u) throw new BotError(`Your Discord account is not linked to a ${botState(db).config.botName} website account yet. Sign in on the website, open Settings and connect Discord, then run this command again.`, 'Account not linked', 'warn');
    if (u.isSuspended) throw new BotError('Your website account is suspended. Contact support.', 'Account suspended');
    return { db, user: u };
  }

  async defer(ephemeral = false): Promise<void> {
    if (this.state !== 'none') return; this.state = 'deferred';
    if (this.interaction) await this.interaction.deferReply({ flags: ephemeral ? 64 : undefined });
    else this.msg.channel?.sendTyping?.().catch(() => undefined);
  }

  async reply(r: Reply): Promise<any> {
    const body = message(r);
    if (this.interaction) {
      if (this.state === 'none') { await this.interaction.reply(body); this.state = 'replied'; this.response = await this.interaction.fetchReply().catch(() => null); }
      else if (this.state === 'deferred') { this.response = await this.interaction.editReply({ components: r.components, flags: V2 }); this.state = 'replied'; }
      else this.response = await this.interaction.followUp(body);
      return this.response;
    }
    try { this.response = await this.msg.reply({ ...body, flags: V2, allowedMentions: { parse: [], repliedUser: false } }); }
    catch { this.response = await this.msg.channel.send({ ...body, flags: V2 }); }
    this.state = 'replied'; return this.response;
  }

  /** Sensitive output (passwords): private reply to slash commands, direct message for prefix commands. Returns false if it could not be delivered privately. */
  async secret(r: Reply): Promise<boolean> {
    if (this.interaction) { await this.reply({ ...r, ephemeral: true }); return true; }
    try { await this.user.send({ components: r.components, flags: V2 }); return true; } catch { return false; }
  }
}

/* ================================================================== pending confirmations */
interface Pending { userId: string; type: string; data: any; expires: number }
const pending = new Map<string, Pending>();
setInterval(() => { const n = Date.now(); for (const [k, p] of pending) if (p.expires < n) pending.delete(k); }, 5 * 60_000).unref?.();

export type ConfirmHandler = (i: any, data: any, user: User, db: DatabaseSchema) => Promise<Reply>;
const confirmHandlers = new Map<string, ConfirmHandler>();
export const onConfirm = (type: string, h: ConfirmHandler) => { confirmHandlers.set(type, h); };

/** A confirm / cancel prompt. The payload stays on the server; the buttons only carry a short token. */
export function confirmReply(userId: string, type: string, data: any, o: { title: string; text: string | string[]; label?: string; danger?: boolean }): Reply {
  const token = crypto.randomBytes(5).toString('hex'); pending.set(token, { userId, type, data, expires: Date.now() + 5 * 60_000 });
  return payload(box({ title: o.title, tone: o.danger ? 'warn' : 'info', text: o.text, rows: [row(btn(`mb|ok|${token}`, o.label || 'Confirm', o.danger ? 'danger' : 'success'), btn(`mb|no|${token}`, 'Cancel'))] }), true);
}

/* ================================================================== component routing */
export type CompHandler = (i: any, parts: string[], db: DatabaseSchema, user: User | undefined) => Promise<void>;
const comps = new Map<string, CompHandler>();
export const onComponent = (key: string, h: CompHandler) => { comps.set(key, h); };

/** Answer a button / select interaction: update the message it came from, or send a new (private) reply. */
export async function answer(i: any, r: Reply, mode: 'update' | 'reply' = 'update'): Promise<void> {
  const body = message(r);
  if (i.deferred || i.replied) { await i.editReply({ components: r.components, flags: V2 }); return; }
  if (mode === 'update') await i.update({ components: r.components, flags: V2 }); else await i.reply(body);
}

async function handleComponent(i: any): Promise<void> {
  const parts = String(i.customId || '').split('|'); if (parts[0] !== 'mb') return;
  const db = await getDb(); const ban = findBan(db, i.user.id);
  if (ban) return void i.reply(message(payload(notice('error', 'Access removed', ban.reason), true))).catch(() => undefined);
  const user = userByDiscord(db, i.user.id);
  try {
    if (parts[1] === 'ok' || parts[1] === 'no') {
      const p = pending.get(parts[2]);
      if (!p || p.expires < Date.now()) return await answer(i, payload(notice('warn', 'This prompt expired', 'Run the command again.'), true));
      if (p.userId !== i.user.id) return await i.reply(message(payload(notice('warn', 'Not your prompt', 'Run the command yourself to get your own.'), true)));
      pending.delete(parts[2]);
      if (parts[1] === 'no') return await answer(i, payload(notice('info', 'Cancelled', 'Nothing was changed.'), true));
      const h = confirmHandlers.get(p.type); const u = userByDiscord(db, i.user.id);
      if (!h || !u) return await answer(i, payload(notice('error', 'Could not finish', 'That action is no longer available.'), true));
      await i.deferUpdate();
      return await answer(i, await h(i, p.data, u, db));
    }
    const h = comps.get(parts[1]); if (!h) return;
    await h(i, parts.slice(2), db, user);
  } catch (e: any) {
    const r = e instanceof BotError ? payload(notice(e.tone, e.title, e.message), true) : payload(notice('error', 'Something went wrong', `Reference ${reportError(e, `component:${parts[1]}`)}`), true);
    try { if (i.deferred || i.replied) await i.editReply({ components: r.components, flags: V2 }); else await i.reply(message(r)); } catch { /* interaction expired */ }
  }
}

/* ================================================================== gates + dispatch */
const cooldowns = new Map<string, number>();
const running = new Set<string>();   // a command already running for this user (double clicks, repeated slash calls)
setInterval(() => { const n = Date.now(); for (const [k, t] of cooldowns) if (t < n) cooldowns.delete(k); }, 60_000).unref?.();
let runsPending = 0;
export const pendingRuns = (): number => runsPending;
export function takeRuns(): number { const n = runsPending; runsPending = 0; return n; }

export function reportError(err: any, where: string): string {
  const id = crypto.randomBytes(3).toString('hex'); console.error(`[Manager Bot] ${id} ${where}:`, err?.stack || err?.message || err); return id;
}

async function execute(ctx: Ctx, silentDenials: boolean): Promise<void> {
  const cmd = ctx.cmd;
  const deny = async (tone: Tone, title: string, text: string) => { if (silentDenials && tone === 'error') return; await ctx.reply(payload(notice(tone, title, text), true)); };
  try {
    const db = await getDb(); const cfg = botState(db).config;
    const ban = findBan(db, ctx.user.id);
    if (ban) return await deny('error', 'Access removed', `You can no longer use this bot. Reason: ${ban.reason}`);
    ctx.tier = tierFor(db, ctx.user.id, ctx.roleIds);
    if (cmd.category === 'vps' && !cfg.features.vps) return await deny('warn', 'VPS commands are off', 'The VPS module is switched off for this bot.');
    if (cmd.category === 'hosting' && !cfg.features.hosting) return await deny('warn', 'Hosting commands are off', 'The hosting module is switched off for this bot.');
    if (!hasTier(ctx.tier, cmd.tier || 'customer')) return await deny('error', 'No access', `This command needs the ${cmd.tier} tier.`);
    if (cmd.guildOnly && !ctx.guild) return await deny('warn', 'Server only', 'Use this command inside a server.');
    const key = `${ctx.user.id}:${cmd.name}`; const until = cooldowns.get(key) || 0;
    if (until > Date.now() || running.has(key)) return await deny('warn', 'Slow down', `Try again in ${Math.max(1, Math.ceil((until - Date.now()) / 1000))}s.`);
    running.add(key); runsPending++;
    try { await cmd.run(ctx); cooldowns.set(key, Date.now() + (cmd.cooldown ?? 2) * 1000); }
    catch (e) { if (!(e instanceof BotError)) cooldowns.set(key, Date.now() + (cmd.cooldown ?? 2) * 1000); throw e; }   // a typo (BotError) does not cost a cooldown
    finally { running.delete(key); }
  } catch (e: any) {
    try {
      if (e instanceof BotError) await ctx.reply(payload(box({ title: e.title, tone: e.tone, text: [e.message, e instanceof UsageError && e.hint ? e.hint : ''], rows: e.rows }), true));
      else await ctx.reply(payload(notice('error', 'Something went wrong', `That command failed. Reference ${reportError(e, `cmd:${cmd.name} user:${ctx.user.id}`)}`), true));
    } catch (inner) { reportError(inner, 'error-reply'); }
  }
}

export async function handleSlash(interaction: any, client: any): Promise<void> {
  const sub = interaction.options.getSubcommand(false);
  const cmd = commands.get(sub ? `${interaction.commandName} ${sub}` : interaction.commandName);
  if (!cmd) return void interaction.reply(message(payload(notice('warn', 'Command not available', 'That command is no longer available.'), true))).catch(() => undefined);
  const args: Record<string, any> = {};
  for (const o of cmd.options || []) {
    const g = interaction.options; let v: any;
    switch (o.type) { case 'integer': v = g.getInteger(o.name); break; case 'number': v = g.getNumber(o.name); break; case 'boolean': v = g.getBoolean(o.name); break; case 'user': v = g.getUser(o.name); break; case 'role': v = g.getRole(o.name); break; case 'channel': v = g.getChannel(o.name); break; default: v = g.getString(o.name); }
    if (v !== null && v !== undefined) args[o.name] = v;
  }
  await execute(new Ctx(client, cmd, args, '/', interaction), false);
}

export async function handleAutocomplete(interaction: any): Promise<void> {
  try {
    const sub = interaction.options.getSubcommand(false);
    const cmd = commands.get(sub ? `${interaction.commandName} ${sub}` : interaction.commandName);
    const focused = interaction.options.getFocused(true);
    const opt = cmd?.options?.find(o => o.name === focused.name);
    if (!cmd || !opt?.autocomplete) return await interaction.respond([]);
    const db = await getDb(); if (findBan(db, interaction.user.id)) return await interaction.respond([]);
    const list = await opt.autocomplete({ db, discordId: interaction.user.id, user: userByDiscord(db, interaction.user.id), get: (n: string) => interaction.options.getString(n) ?? undefined }, String(focused.value || ''));
    await interaction.respond(list.slice(0, 25).map(c => ({ name: trunc(String(c.name), 100), value: typeof c.value === 'number' ? c.value : String(c.value).slice(0, 100) })));
  } catch { try { await interaction.respond([]); } catch { /* timed out */ } }
}

export async function handlePrefixMessage(msg: any, client: any, prefix: string): Promise<void> {
  if (msg.author.bot || msg.system || !msg.content) return;
  const content = String(msg.content).trim(); const mention = new RegExp(`^<@!?${client.user.id}>\\s*`);
  let raw: string;
  if (mention.test(content)) raw = content.replace(mention, '').trim();
  else if (content.startsWith(prefix)) raw = content.slice(prefix.length).trim();
  else return;
  if (!raw) raw = 'help';
  const tokens = tokenize(raw); const hit = resolve(tokens.map(t => t.value.toLowerCase())); if (!hit) return;
  const ctx = new Ctx(client, hit.cmd, {}, prefix, null, msg);
  try { ctx.args = await parseArgs(hit.cmd, tokens.slice(hit.used), raw, client, prefix); }
  catch (e: any) { if (e instanceof BotError) return void ctx.reply(payload(box({ title: e.title, tone: e.tone, text: [e.message, e instanceof UsageError ? e.hint || usageOf(prefix, hit.cmd) : ''] }))).catch(() => undefined); return void reportError(e, 'args'); }
  await execute(ctx, true);
}

export async function handleInteraction(interaction: any, client: any): Promise<void> {
  if (interaction.isChatInputCommand?.()) return handleSlash(interaction, client);
  if (interaction.isAutocomplete?.()) return handleAutocomplete(interaction);
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) return handleComponent(interaction);
}

void flags;
