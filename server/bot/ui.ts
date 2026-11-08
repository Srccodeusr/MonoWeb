import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize,
  StringSelectMenuBuilder, TextDisplayBuilder,
} from 'discord.js';

/**
 * One visual language for every message: a Components V2 container with a small brand line, a title, text, and optional
 * button / select rows. No emojis anywhere: state is written out ("Running", "Offline") and tone is the accent colour.
 */
export type Tone = 'info' | 'success' | 'error' | 'warn';
const TONE: Record<Exclude<Tone, 'info'>, number> = { success: 0x2ecc71, error: 0xed4245, warn: 0xf1c40f };

const brand = { name: 'MonoNode', accent: 0x6b7280 };
export function setBrand(name: string, accentHex: string): void {
  brand.name = name || 'MonoNode';
  const n = parseInt(String(accentHex || '').replace('#', ''), 16); brand.accent = Number.isFinite(n) ? n : 0x6b7280;
}
export const botName = (): string => brand.name;

export const V2 = MessageFlags.IsComponentsV2;
export const EPHEMERAL = MessageFlags.Ephemeral;
export const flags = (ephemeral?: boolean): number => (ephemeral ? V2 | EPHEMERAL : V2);

/* ------------------------------------------------------------------ text helpers */
export const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const code = (s: string | number): string => `\`${String(s).replace(/`/g, "'")}\``;
export const block = (s: string, lang = '', max = 1800): string => `\`\`\`${lang}\n${trunc(String(s).replace(/```/g, "'''"), max)}\n\`\`\``;
export const when = (iso?: string | number, style: 'R' | 'f' | 'D' = 'R'): string => {
  const t = typeof iso === 'number' ? iso : Date.parse(iso || ''); return Number.isFinite(t) ? `<t:${Math.floor(t / 1000)}:${style}>` : 'never';
};
export const mb = (n: number): string => (n >= 1024 ? `${+(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} GB` : `${n} MB`);
export const money = (n: number, sym = '$'): string => `${sym}${(Math.round(n * 100) / 100).toFixed(2)}`;
export const kv = (pairs: [string, string | number | undefined | null][]): string => pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `**${k}:** ${v}`).join('\n');

/* ------------------------------------------------------------------ components */
export type BtnStyle = 'primary' | 'secondary' | 'success' | 'danger';
const STYLE: Record<BtnStyle, number> = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
export const btn = (id: string, label: string, style: BtnStyle = 'secondary', disabled = false) =>
  new ButtonBuilder().setCustomId(id.slice(0, 100)).setLabel(label.slice(0, 80)).setStyle(STYLE[style]).setDisabled(disabled);
export const linkBtn = (url: string, label: string) => new ButtonBuilder().setURL(url).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Link);
export const row = (...items: any[]) => new ActionRowBuilder<any>().addComponents(...items);
export const select = (id: string, placeholder: string, options: { label: string; value: string; description?: string; default?: boolean }[]) =>
  new ActionRowBuilder<any>().addComponents(new StringSelectMenuBuilder().setCustomId(id.slice(0, 100)).setPlaceholder(placeholder.slice(0, 100)).addOptions(
    options.slice(0, 25).map(o => ({ label: trunc(o.label, 100), value: o.value.slice(0, 100), description: o.description ? trunc(o.description, 100) : undefined, default: o.default }))));

/* ------------------------------------------------------------------ containers */
export interface BoxOptions { title: string; tone?: Tone; text?: string | string[]; rows?: any[]; footer?: string }

export function box(o: BoxOptions): ContainerBuilder {
  const c = new ContainerBuilder().setAccentColor(o.tone && o.tone !== 'info' ? TONE[o.tone] : brand.accent);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(`-# ${brand.name}\n### ${o.title}`, 400)));
  const body = (Array.isArray(o.text) ? o.text.filter(Boolean).join('\n') : o.text || '').trim();
  if (body) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(body, 3400)));
  }
  if (o.rows?.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    for (const r of o.rows.slice(0, 5)) c.addActionRowComponents(r);
  }
  if (o.footer) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(`-# ${o.footer}`, 300)));
  return c;
}

export const notice = (tone: Tone, title: string, text?: string | string[]) => box({ title, tone, text });
/** What a command hands back: components + whether only the invoking user should see it. */
export interface Reply { components: any[]; ephemeral?: boolean }
export const payload = (container: ContainerBuilder | ContainerBuilder[], ephemeral = false): Reply => ({ components: Array.isArray(container) ? container : [container], ephemeral });
export const message = (r: Reply) => ({ components: r.components, flags: flags(r.ephemeral), allowedMentions: { parse: [] as string[] } });

/** Status word used in lists and panels. */
export const stateWord = (s: string): string => ({ running: 'Running', offline: 'Offline', installing: 'Installing', starting: 'Starting', suspended: 'Suspended', expired: 'Expired', error: 'Error', install_failed: 'Install failed', transferring: 'Transferring', unknown: 'Unknown', missing: 'Missing' } as Record<string, string>)[s] || s;
