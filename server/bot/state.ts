import { DatabaseSchema, saveDbSync } from '../db';
import { decryptSecret, encryptSecret, maskSecret, newId } from '../hosting/crypto';
import type { ManagerBotActivity, ManagerBotBan, ManagerBotConfig, ManagerBotConfigView } from '../../src/botTypes';

/**
 * Everything the Discord Manager Bot persists lives under one key of the MonoWeb database (`db.managerBot`).
 * The SQLite store keeps unknown top-level keys as-is, so this needs no schema change and is backed up with the rest.
 * The bot token and client secret are AES-GCM encrypted with the same key as node daemon secrets.
 */
export interface BotState {
  config: ManagerBotConfig;
  botTokenEnc: string;
  clientSecretEnc: string;
  clientSecretCheck: 'unchecked' | 'verified' | 'rejected';
  bans: ManagerBotBan[];
  /** Mirror of the VPS nodes the website has handed to the bot (see nodes.ts). */
  nodes: { nodeId: string; name: string; location: string; addedAt: string }[];
  activity: ManagerBotActivity[];
  commandsRun: number;
  /** Guild the slash commands were last registered in (so switching to global registration cleans up). */
  registeredGuildId?: string;
}

export const defaultConfig = (): ManagerBotConfig => ({
  enabled: false, clientId: '', botName: 'MonoNode', prefix: '!', enablePrefix: false, accentColor: '#6b7280', statusText: 'your servers',
  guildId: '', logChannelId: '', ownerIds: [], adminRoleIds: [], staffRoleIds: [], features: { vps: true, hosting: true },
});

export function botState(db: DatabaseSchema): BotState {
  const d = db as any;
  const s: BotState = d.managerBot || (d.managerBot = { config: defaultConfig(), botTokenEnc: '', clientSecretEnc: '', clientSecretCheck: 'unchecked', bans: [], nodes: [], activity: [], commandsRun: 0 });
  const base = defaultConfig();
  s.config = { ...base, ...(s.config || {}), features: { ...base.features, ...(s.config?.features || {}) } };
  if (!Array.isArray(s.bans)) s.bans = [];
  if (!Array.isArray(s.nodes)) s.nodes = [];
  if (!Array.isArray(s.activity)) s.activity = [];
  if (typeof s.commandsRun !== 'number') s.commandsRun = 0;
  if (!s.clientSecretCheck) s.clientSecretCheck = 'unchecked';
  return s;
}

/* ------------------------------------------------------------------ credentials */
export function getCredentials(db: DatabaseSchema): { token: string; clientId: string; clientSecret: string } {
  const s = botState(db);
  let token = '', clientSecret = '';
  try { token = decryptSecret(s.botTokenEnc); } catch { /* app secret changed: admin must re-enter */ }
  try { clientSecret = decryptSecret(s.clientSecretEnc); } catch { /* same */ }
  return { token, clientId: s.config.clientId, clientSecret };
}

export const credentialsComplete = (db: DatabaseSchema): boolean => { const c = getCredentials(db); return !!(c.token && c.clientId); };

export function setCredentials(db: DatabaseSchema, input: { botToken?: unknown; clientId?: unknown; clientSecret?: unknown }): void {
  const s = botState(db);
  const isNew = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !v.includes('•');   // masked echo from the UI = keep the old value
  if (isNew(input.botToken)) s.botTokenEnc = encryptSecret(input.botToken.trim());
  if (isNew(input.clientSecret)) { s.clientSecretEnc = encryptSecret(input.clientSecret.trim()); s.clientSecretCheck = 'unchecked'; }
  if (typeof input.clientId === 'string') s.config.clientId = input.clientId.trim();
  saveDbSync();
}

/** The config the browser sees: no secrets, only whether they are set. */
export function configView(db: DatabaseSchema): ManagerBotConfigView {
  const s = botState(db); const c = getCredentials(db);
  return { ...s.config, botTokenSet: !!c.token, botTokenMasked: c.token ? maskSecret(c.token) : '', clientSecretSet: !!c.clientSecret, clientSecretMasked: c.clientSecret ? maskSecret(c.clientSecret) : '', clientSecretCheck: s.clientSecretCheck };
}

/* ------------------------------------------------------------------ config sanitising */
const snowflake = /^\d{15,25}$/;
const ids = (v: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(v)) return fallback;
  return [...new Set(v.map(x => String(x).trim()).filter(x => snowflake.test(x)))].slice(0, 50);
};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const text = (v: unknown, d: string, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : d);

export function applyConfigPatch(db: DatabaseSchema, patch: any): ManagerBotConfig {
  const s = botState(db); const c = s.config; const p = patch || {};
  c.enabled = bool(p.enabled, c.enabled);
  c.botName = text(p.botName, c.botName, 32) || 'MonoNode';
  const prefix = text(p.prefix, c.prefix, 5); c.prefix = prefix && !/\s/.test(prefix) ? prefix : c.prefix;
  c.enablePrefix = bool(p.enablePrefix, c.enablePrefix);
  const color = text(p.accentColor, c.accentColor, 7); c.accentColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : c.accentColor;
  c.statusText = text(p.statusText, c.statusText, 100);
  const guild = text(p.guildId, c.guildId, 25); c.guildId = guild === '' || snowflake.test(guild) ? guild : c.guildId;
  const log = text(p.logChannelId, c.logChannelId, 25); c.logChannelId = log === '' || snowflake.test(log) ? log : c.logChannelId;
  c.ownerIds = ids(p.ownerIds, c.ownerIds); c.adminRoleIds = ids(p.adminRoleIds, c.adminRoleIds); c.staffRoleIds = ids(p.staffRoleIds, c.staffRoleIds);
  if (p.features && typeof p.features === 'object') c.features = { vps: bool(p.features.vps, c.features.vps), hosting: bool(p.features.hosting, c.features.hosting) };
  if (typeof p.clientId === 'string') { const id = p.clientId.trim(); if (id === '' || snowflake.test(id)) c.clientId = id; }
  saveDbSync();
  return c;
}

/* ------------------------------------------------------------------ bans */
export const findBan = (db: DatabaseSchema, discordId: string): ManagerBotBan | undefined => botState(db).bans.find(b => b.discordId === discordId);
export function addBan(db: DatabaseSchema, discordId: string, reason: string, by: string): ManagerBotBan {
  const s = botState(db); s.bans = s.bans.filter(b => b.discordId !== discordId);
  const u = db.users.find(x => x.discordId === discordId);
  const ban: ManagerBotBan = { discordId, reason: reason.slice(0, 200) || 'No reason given', by, at: new Date().toISOString(), userEmail: u?.email };
  s.bans.unshift(ban); if (s.bans.length > 2000) s.bans.length = 2000; saveDbSync(); return ban;
}
export function removeBan(db: DatabaseSchema, discordId: string): boolean {
  const s = botState(db); const n = s.bans.length; s.bans = s.bans.filter(b => b.discordId !== discordId); if (s.bans.length !== n) { saveDbSync(); return true; } return false;
}

/* ------------------------------------------------------------------ activity + log channel */
let logSink: ((message: string) => void) | null = null;
/** The running bot registers itself here so node and admin events can also be posted to the log channel. */
export const setLogSink = (fn: ((message: string) => void) | null) => { logSink = fn; };

export function logActivity(db: DatabaseSchema, kind: string, message: string, announce = true): void {
  const s = botState(db);
  s.activity.unshift({ id: newId('bact'), at: new Date().toISOString(), kind, text: message.slice(0, 300) });
  if (s.activity.length > 300) s.activity.length = 300;
  saveDbSync();
  if (announce && logSink) { try { logSink(message); } catch { /* the log channel is best effort */ } }
}
