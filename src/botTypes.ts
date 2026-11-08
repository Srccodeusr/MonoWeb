/**
 * Discord Manager Bot (VPS + Hosting): types shared by the server (server/bot/*, server/routes/managerBot.ts)
 * and the admin UI (src/pages/admin/AdminManagerBot.tsx). Secrets (token, client secret) never appear in these views.
 */

export type BotStatusCode = 'NOT_CONFIGURED' | 'STOPPED' | 'STARTING' | 'ONLINE' | 'ERROR';

/** Everything the admin can change except the credentials. */
export interface ManagerBotConfig {
  enabled: boolean;            // start the bot automatically when the website boots
  clientId: string;            // Discord application (client) ID
  botName: string;             // shown in help, the status line and every message
  prefix: string;              // used when prefix commands are on
  enablePrefix: boolean;       // needs the "Message Content Intent" switched on in the Discord developer portal
  accentColor: string;         // #rrggbb accent of every message container
  statusText: string;          // "Watching ..." line under the bot's name
  guildId: string;             // register slash commands in this server only (instant). Blank = global (up to an hour)
  logChannelId: string;        // node events and admin actions are posted here (optional)
  ownerIds: string[];          // Discord user IDs with full control inside Discord
  adminRoleIds: string[];      // Discord role IDs that get the admin tier
  staffRoleIds: string[];      // Discord role IDs that get the staff tier
  features: { vps: boolean; hosting: boolean };
}

export interface ManagerBotConfigView extends ManagerBotConfig {
  botTokenSet: boolean;
  botTokenMasked: string;
  clientSecretSet: boolean;
  clientSecretMasked: string;
  /** Result of the last client-secret check against Discord. */
  clientSecretCheck: 'unchecked' | 'verified' | 'rejected';
}

export interface ManagerBotStatus {
  status: BotStatusCode;
  botTag: string | null;
  botId: string | null;
  guilds: number;
  commands: number;
  pingMs: number | null;
  startedAt: string | null;
  lastError: string | null;
  /** Non-fatal notes, e.g. prefix commands were switched off because the Message Content Intent is not enabled. */
  warnings: string[];
  inviteUrl: string | null;
  commandsRun: number;
}

export interface ManagerBotNodeView {
  id: string;
  name: string;
  location: string;
  online: boolean;
  enabled: boolean;            // accepts new VPSes
  vpsCount: number;
  maxVps: number;              // 0 = unlimited
  publicHost: string;
  addedAt: string;             // when the website added it to the bot
  error?: string;
}

export interface ManagerBotBan { discordId: string; reason: string; by: string; at: string; userEmail?: string }
export interface ManagerBotActivity { id: string; at: string; kind: string; text: string }
