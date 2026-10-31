/**
 * MonoNode hosting: types for the native panel that replaces the external Pterodactyl link.
 * Kept in its own file so src/types.ts only needs a few additive fields.
 */

export type PeriodId = 'monthly' | 'halfyearly' | 'yearly' | string;

export interface BillingPeriod {
  id: PeriodId;
  label: string;          // "Monthly", "6 Months", "1 Year"
  months: number;
  discountPercent: number; // applied to monthlyPrice * months
}

export interface PerServerLimits {
  ramMB: number;
  cpuPercent: number;     // 100 = one full core
  diskMB: number;
  swapMB: number;
  backups: number;
  databases: number;
  ports: number;          // extra host ports besides the image defaults
  pids: number;
}

export interface PlanFeatures {
  noAds: boolean;
  directRenewal: boolean;  // can pay-renew without watching ads
  subusers: boolean;
  scheduledTasks: boolean;
  backups: boolean;
  chooseNode: boolean;
  switchNode: boolean;
  discordRole: boolean;
  giveaways: boolean;
}

export type RenewMethod = 'ads' | 'blog' | 'coins' | 'payment';

export interface HostingPlan {
  id: string;
  name: string;
  tagline: string;
  isFree: boolean;
  isActive: boolean;
  isPopular: boolean;
  sortOrder: number;
  monthlyPrice: number;
  /** Optional hard price per period id; otherwise computed from monthlyPrice and the period discount. */
  priceOverrides: Record<string, number>;
  serverLimit: number;               // how many servers the account may create
  perServer: PerServerLimits;        // specs every server created under this plan receives
  /** Optional whole-account ceilings (0 = unlimited). */
  accountCaps: { ramMB: number; cpuPercent: number; diskMB: number };
  features: PlanFeatures;
  renewal: {
    validityDays: number;            // lifetime of a server before it needs renewing (free-style plans); 0 = tied to plan period
    methods: RenewMethod[];
  };
  highlights: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HostNodeStatus {
  online: boolean;
  checkedAt?: string;
  version?: string;
  runtime?: string;
  runtimeInfo?: Record<string, unknown>;
  platform?: string;
  hostname?: string;
  error?: string;
  system?: { cpus: number; load: number[]; memTotal: number; memFree: number; diskTotal: number; diskFree: number; uptime: number };
}

export interface HostNode {
  id: string;
  name: string;
  locationName: string;        // shown in the create wizard ("Germany")
  locationFlag?: string;
  fqdn: string;                // address users connect to
  daemonHost: string;          // address the panel calls (often the same as fqdn)
  daemonPort: number;
  scheme: 'http' | 'https';
  secretEnc: string;           // AES-GCM encrypted daemon secret (never sent to the browser)
  ramMB: number;
  cpuPercent: number;
  diskMB: number;
  overallocatePercent: number; // 0 = strict
  maxServers: number;          // 0 = unlimited
  portMin: number;
  portMax: number;
  isPublic: boolean;           // false = hidden from the wizard (admin-only)
  isMaintenance: boolean;
  premiumOnly: boolean;
  notes?: string;
  status: HostNodeStatus;
  createdAt: string;
}

export interface ImageVariable {
  name: string;
  env: string;
  default: string;
  description: string;
  userEditable: boolean;
  /** Simple validation: 'required', 'number', or a regex wrapped in /…/ */
  rules: string;
}

export interface HostImage {
  id: string;
  name: string;               // "Node.js"
  software: string;           // label in the Software dropdown
  category: string;           // "Coding Languages" | "Websites" | "Database" | "Games" | ...
  description: string;
  iconUrl?: string;
  dockerImages: Record<string, string>;   // label -> image
  defaultImage: string;       // label key
  startup: string;            // supports {{VAR}} and {{SERVER_PORT}}
  stopCommand: string;
  ports: { label: string; container: number; proto: 'tcp' | 'udp' }[];
  variables: ImageVariable[];
  install: { image: string; entrypoint: 'bash' | 'sh' | 'ash'; script: string; files: { url: string; path: string }[] };
  runtime: 'any' | 'container' | 'process';
  minRamMB: number;
  isActive: boolean;
  createdAt: string;
}

export type ServerState = 'installing' | 'offline' | 'running' | 'starting' | 'suspended' | 'expired' | 'install_failed';

export interface HostServer {
  id: string;                  // also the daemon-side id
  ownerId: string;
  name: string;
  description: string;
  nodeId: string;
  imageId: string;
  dockerImage: string;
  planId: string;              // plan at creation (limits snapshot below is what actually applies)
  entitlementId?: string;
  limits: { ramMB: number; cpuPercent: number; diskMB: number; swapMB: number; pids: number; backups: number; databases: number };
  ports: { host: number; container: number; proto: 'tcp' | 'udp'; label?: string }[];
  variables: Record<string, string>;
  upgrades: { id: string; storeItemId: string; ramMB: number; cpuPercent: number; diskMB: number; until?: string; appliedAt: string }[];
  status: ServerState;
  suspendedReason?: string;
  createdAt: string;
  expiresAt?: string;          // undefined = never expires (e.g. premium-bound until plan ends is handled by lifecycle)
  expiredAt?: string;          // set the moment it expired; deletion happens exactly 24h later
  lastRenewedAt?: string;
  renewCount: number;
  notifiedExpiry?: boolean;
}

export interface HostBackup {
  id: string;
  serverId: string;
  name: string;
  size: number;
  checksum: string;
  createdAt: string;
}

export type StoreItemType = 'spec_upgrade' | 'renew' | 'temp_premium' | 'server_pack' | 'slot';

export interface StoreItem {
  id: string;
  type: StoreItemType;
  name: string;
  description: string;
  iconUrl?: string;
  priceCoins: number;
  priceMoney: number;          // 0 = coins only
  isActive: boolean;
  sortOrder: number;
  stock: number;               // 0 = unlimited
  perUserLimit: number;        // 0 = unlimited
  sold: number;
  // spec_upgrade
  upgrade?: { ramMB: number; cpuPercent: number; diskMB: number; durationDays: number; maxPerServer: number };
  // renew
  renewDays?: number;
  // temp_premium
  premiumPlanId?: string;
  premiumDays?: number;
  // server_pack: grants an entitlement = one extra server with its own specs
  pack?: { ramMB: number; cpuPercent: number; diskMB: number; swapMB: number; backups: number; databases: number; validityDays: number };
  // slot: +N server slots
  slots?: number;
  createdAt: string;
}

export interface Entitlement {
  id: string;
  userId: string;
  storeItemId: string;
  name: string;
  pack: NonNullable<StoreItem['pack']>;
  serverId?: string;           // set once consumed by a server
  createdAt: string;
}

export interface CoinTx {
  id: string;
  userId: string;
  amount: number;              // + earn / - spend
  balanceAfter: number;
  reason: string;
  ref?: string;
  createdAt: string;
}

export interface EarnSession {
  id: string;
  token: string;
  userId: string;
  kind: 'ad' | 'blog';
  refId: string;               // ad id or blog id
  purpose: 'coins' | 'renew';
  serverId?: string;
  minSeconds: number;
  ip: string;
  createdAt: string;
  claimedAt?: string;
}

export interface MediaItem {
  id: string;
  filename: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

export interface BlogLink {
  id: string;
  title: string;
  url: string;
  seconds: number;
  rewardCoins: number;
  renewHours: number;
  isActive: boolean;
}

export interface HostingSettings {
  enabled: boolean;
  periods: BillingPeriod[];
  freePlanId: string;
  topBar: { enabled: boolean; message: string; links: { label: string; url: string }[] };
  promos: { upgradeCard: boolean; hostingCard: boolean; hostingCardTitle: string; hostingCardText: string; hostingCardCta: string; hostingCardUrl: string };
  expiry: {
    /** Days a server lives before it must be renewed (plans may override with renewal.validityDays). */
    defaultValidityDays: number;
    reminderHours: number;
    // NOTE: deletion 24h after expiry is HARD-CODED in server/hosting/lifecycle.ts and intentionally not configurable.
  };
  renew: {
    ads: { enabled: boolean; watchSeconds: number; extendHours: number; maxPerDay: number };
    blog: { enabled: boolean; maxPerDay: number; items: BlogLink[] };
    coins: { enabled: boolean; priceCoins: number; extendDays: number };
  };
  economy: {
    enabled: boolean;
    coinName: string;
    adReward: { coins: number; seconds: number; maxPerDay: number; cooldownSec: number };
    blogMaxPerDay: number;
    dailyBonus: number;
  };
  wizard: { maxNameLength: number };
  ads: { globalEnabled: boolean; hideForPremium: boolean; maxEventsStored: number };
}

export interface HostingPublicSettings {
  topBar: HostingSettings['topBar'];
  promos: HostingSettings['promos'];
  periods: BillingPeriod[];
  economy: { enabled: boolean; coinName: string };
  renew: { ads: boolean; blog: boolean; coins: boolean };
  currencySymbol: string;
}
