import { ActivityType, Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { DatabaseSchema, getDb, saveDbSync } from '../db';
import type { BotStatusCode, ManagerBotStatus } from '../../src/botTypes';
import { allCommands, clearCommands, handleInteraction, handlePrefixMessage, slashJSON, takeRuns, pendingRuns } from './framework';
import { registerGeneralCommands } from './general';
import { registerHostingCommands } from './hosting';
import { registerVpsCommands } from './vps';
import { onNodesChanged } from './nodes';
import { botState, credentialsComplete, getCredentials, logActivity, setLogSink } from './state';
import { box, message, payload, setBrand, botName } from './ui';

/**
 * Lifecycle of the Discord Manager Bot. The admin enters the credentials in the website; this module logs the bot in,
 * loads every command, registers the slash commands, and keeps running inside the website process.
 */
let client: any = null;
let status: BotStatusCode = 'STOPPED';
let startedAt: string | null = null;
let lastError: string | null = null;
let warnings: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Start/stop/restart never overlap. */
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };

const inviteUrl = (id: string) => `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot%20applications.commands&permissions=3072`;

export function getStatus(db: DatabaseSchema): ManagerBotStatus {
  const s = botState(db); const creds = getCredentials(db);
  let code: BotStatusCode = status;
  if (status === 'STOPPED' && !credentialsComplete(db)) code = 'NOT_CONFIGURED';
  const ready = client?.isReady?.();
  return {
    status: code, botTag: ready ? client.user.tag : null, botId: ready ? client.user.id : null, guilds: ready ? client.guilds.cache.size : 0, commands: allCommands().length,
    pingMs: ready ? Math.round(client.ws.ping) : null, startedAt, lastError, warnings: [...warnings], inviteUrl: creds.clientId ? inviteUrl(creds.clientId) : null, commandsRun: s.commandsRun + pendingRuns(),
  };
}

function loadCommands(): void { clearCommands(); registerGeneralCommands(); registerVpsCommands(); registerHostingCommands(); }

function flushRuns(): void {
  const n = takeRuns(); if (!n) return;
  getDb().then(db => { botState(db).commandsRun += n; saveDbSync(); }).catch(() => undefined);
}

async function login(token: string, withPrefix: boolean): Promise<any> {
  const intents = [GatewayIntentBits.Guilds];
  if (withPrefix) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent);
  const c = new Client({ intents, partials: [Partials.Channel, Partials.Message] });
  const ready = new Promise<void>((resolve, reject) => { c.once('ready', () => resolve()); c.once('error', reject); setTimeout(() => reject(new Error('Timed out waiting for Discord (30s). Check the token and the server network.')), 30_000).unref?.(); });
  try { await c.login(token); await ready; } catch (e) { try { c.destroy(); } catch { /* ignore */ } throw e; }
  return c;
}

async function registerSlash(db: DatabaseSchema, appId: string, token: string): Promise<void> {
  const s = botState(db); const rest = new REST({ version: '10' }).setToken(token); const body = slashJSON(); const guild = s.config.guildId;
  if (s.registeredGuildId && s.registeredGuildId !== guild) { await rest.put(Routes.applicationGuildCommands(appId, s.registeredGuildId), { body: [] }).catch(() => undefined); }
  if (guild) await rest.put(Routes.applicationGuildCommands(appId, guild), { body }); else await rest.put(Routes.applicationCommands(appId), { body });
  s.registeredGuildId = guild || undefined; saveDbSync();
}

async function doStart(): Promise<void> {
  if (client) await doStop(false);
  const db = await getDb(); const s = botState(db); const creds = getCredentials(db);
  warnings = []; lastError = null;
  if (!creds.token || !creds.clientId) { status = 'STOPPED'; lastError = 'Bot token and client ID are required.'; throw new Error(lastError); }
  status = 'STARTING'; setBrand(s.config.botName, s.config.accentColor); loadCommands();
  try {
    let withPrefix = s.config.enablePrefix; let c: any;
    try { c = await login(creds.token, withPrefix); }
    catch (e: any) {
      if (withPrefix && (e?.code === 'DisallowedIntents' || /disallowed intents/i.test(String(e?.message)))) {
        warnings.push('Prefix commands are off: the Message Content Intent is not enabled for this bot. Turn it on in the Discord developer portal (Bot page), then restart. Slash commands work normally.');
        withPrefix = false; c = await login(creds.token, false);
      } else throw e;
    }
    client = c;
    if (s.config.clientId && s.config.clientId !== c.user.id) warnings.push(`The Client ID in settings (${s.config.clientId}) does not match the bot's application (${c.user.id}). The real application ID is used for commands.`);
    c.on('interactionCreate', (i: any) => { handleInteraction(i, c).catch(e => console.error('[Manager Bot] interaction error:', e?.message || e)); });
    if (withPrefix) c.on('messageCreate', (m: any) => { handlePrefixMessage(m, c, botState(db).config.prefix).catch(() => undefined); });
    c.on('error', (e: any) => { lastError = e?.message || String(e); });
    c.on('shardDisconnect', () => { if (status === 'ONLINE') lastError = 'Disconnected from Discord, reconnecting...'; });
    c.on('shardResume', () => { lastError = null; });
    c.user.setPresence({ activities: s.config.statusText ? [{ name: s.config.statusText, type: ActivityType.Watching }] : [], status: 'online' });

    try { await registerSlash(db, c.user.id, creds.token); }
    catch (e: any) { warnings.push(`Slash commands could not be registered: ${e?.message || e}. ${s.config.guildId ? 'Check that the bot is in that server and was invited with the applications.commands scope.' : ''}`.trim()); }

    setLogSink(text => {
      const id = botState(db).config.logChannelId; if (!id || !client?.isReady?.()) return;
      client.channels.fetch(id).then((ch: any) => ch?.send?.(message(payload(box({ title: `${botName()} log`, text }))))).catch(() => undefined);
    });
    if (!flushTimer) { flushTimer = setInterval(flushRuns, 60_000); flushTimer.unref?.(); }
    status = 'ONLINE'; startedAt = new Date().toISOString();
    await onNodesChanged();
    logActivity(db, 'BOT_ONLINE', `${c.user.tag} is online in ${c.guilds.cache.size} server(s) with ${allCommands().length} commands.`, false);
    console.log(`[Manager Bot] ${c.user.tag} is online (${allCommands().length} commands, ${c.guilds.cache.size} servers)`);
  } catch (e: any) {
    status = 'ERROR'; lastError = e?.message || 'Login failed'; client = null; console.error('[Manager Bot] start failed:', lastError); throw new Error(lastError!);
  }
}

async function doStop(log = true): Promise<void> {
  setLogSink(null); flushRuns();
  if (client) { try { client.destroy(); } catch { /* ignore */ } client = null; }
  status = 'STOPPED'; startedAt = null;
  if (log) { const db = await getDb(); logActivity(db, 'BOT_STOPPED', 'The bot was stopped.', false); }
}

export const startBot = () => serial(doStart);
export const stopBot = () => serial(() => doStop(true));
export const restartBot = () => serial(async () => { await doStop(false); await doStart(); });

/** Called once when the website boots. Never throws. */
export async function autostartManagerBot(): Promise<void> {
  try { const db = await getDb(); if (botState(db).config.enabled && credentialsComplete(db)) await startBot(); } catch (e: any) { console.warn('[Manager Bot] autostart failed:', e?.message || e); }
}

/* ================================================================== credential checks (no gateway needed) */
export interface CredentialCheck { token: 'ok' | 'invalid' | 'missing' | 'unreachable'; botTag?: string; applicationId?: string; clientIdMatches?: boolean; secret: 'verified' | 'rejected' | 'missing' | 'unchecked'; message: string }

export async function checkCredentials(db: DatabaseSchema): Promise<CredentialCheck> {
  const creds = getCredentials(db); const s = botState(db);
  const out: CredentialCheck = { token: creds.token ? 'unreachable' : 'missing', secret: creds.clientSecret ? 'unchecked' : 'missing', message: '' };
  if (creds.token) {
    try {
      const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${creds.token}` }, signal: AbortSignal.timeout(8000) });
      if (r.status === 401) out.token = 'invalid';
      else if (r.ok) { const j: any = await r.json(); out.token = 'ok'; out.botTag = j.discriminator && j.discriminator !== '0' ? `${j.username}#${j.discriminator}` : j.username; out.applicationId = j.id; out.clientIdMatches = !creds.clientId || creds.clientId === j.id; }
    } catch { out.token = 'unreachable'; }
  }
  if (creds.clientId && creds.clientSecret) {
    try {
      const r = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}` }, body: 'grant_type=client_credentials&scope=identify', signal: AbortSignal.timeout(8000) });
      if (r.ok) out.secret = 'verified'; else if (r.status === 400 || r.status === 401) { const j: any = await r.json().catch(() => ({})); out.secret = j?.error === 'invalid_client' || r.status === 401 ? 'rejected' : 'verified'; }
    } catch { /* network: stays unchecked */ }
    if (out.secret === 'verified' || out.secret === 'rejected') { s.clientSecretCheck = out.secret; saveDbSync(); }
  }
  out.message = out.token === 'missing' ? 'Enter the bot token first.' : out.token === 'invalid' ? 'Discord rejected the bot token.' : out.token === 'unreachable' ? 'Could not reach Discord from this server.'
    : out.clientIdMatches === false ? `The token belongs to application ${out.applicationId}, but the Client ID field says ${creds.clientId}.` : out.secret === 'rejected' ? 'The token works, but Discord rejected the client secret.' : `Token is valid for ${out.botTag}.`;
  return out;
}

