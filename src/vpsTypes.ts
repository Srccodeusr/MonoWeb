/**
 * MonoNode native VPS hosting: types shared by the server (server/vps/*, server/routes/vps*.ts) and the UI.
 * Kept separate from src/types.ts and src/hostingTypes.ts so this module is purely additive.
 */

export interface VpsNodeStatus {
  online: boolean;
  checkedAt?: string;
  version?: string;
  runtime?: string;
  error?: string;
  system?: { cpus: number; memTotalMb: number; memFreeMb: number; diskTotalMb?: number; diskFreeMb?: number; loadavg: number[]; uptimeS?: number; vpsCount?: number; vpsRunning?: number };
}

export interface VpsNode {
  id: string;
  name: string;
  location: string;            // shown in the deploy wizard ("Frankfurt")
  daemonHost: string;          // address the PANEL calls
  daemonPort: number;
  scheme: 'http' | 'https';
  publicHost: string;          // address CUSTOMERS ssh to (falls back to daemonHost)
  secretEnc: string;           // AES-GCM encrypted daemon secret (never sent to the browser)
  maxVps: number;              // 0 = unlimited
  portMin: number;             // SSH port range handed out to VPSes on this node
  portMax: number;
  /** Optional resource ceilings used for placement (0 = not enforced). */
  ramMb: number;
  diskGb: number;
  cpus: number;
  overallocatePercent: number;
  enabled: boolean;            // accepts NEW VPSes (turn off to drain a node)
  notes?: string;
  status: VpsNodeStatus;
  createdAt: string;
}

export interface VpsOsImage {
  id: string;                  // "ubuntu-22.04" (stable key stored on each VPS)
  label: string;               // "Ubuntu 22.04 LTS"
  base: string;                // docker base image, Debian/Ubuntu family ("ubuntu:22.04")
  enabled: boolean;
  sort: number;
}

export interface VpsPlan {
  id: string;
  name: string;
  description: string;
  cpu: number;                 // vCPU (fractions allowed)
  ramMb: number;
  diskGb: number;
  bandwidthGb: number;         // informational (not enforced by Docker)
  price: number;
  periodDays: number;
  images: string[];            // allowed VpsOsImage ids
  enabled: boolean;            // on sale in the panel deploy page
  isPopular: boolean;
  sort: number;
  /** When set, website checkout orders for this catalogue plan (db.plans) are deployed with this profile. */
  catalogPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export type VpsState = 'installing' | 'running' | 'offline' | 'error' | 'suspended' | 'expired';

export interface VpsInstance {
  id: string;                  // also the daemon-side id (lowercase uuid)
  ownerId: string;
  planId: string;
  planName: string;
  orderId?: string;            // VpsOrder id
  name: string;
  nodeId: string;
  image: string;
  sshPort: number;
  rootPasswordEnc: string;
  spec: { cpu: number; ramMb: number; diskGb: number; bandwidthGb: number };
  status: VpsState;            // last known state; live state is merged in by the API
  suspended: boolean;
  suspendReason?: string;
  diskEnforced?: boolean;
  lastError?: string;
  adminNote?: string;
  createdAt: string;
  expiresAt: string;
  expiredAt?: string;
  notifiedExpiry?: boolean;
  renewCount: number;
}

export type VpsOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'declined' | 'failed';

export interface VpsOrder {
  id: string;
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  kind: 'deploy' | 'renew';
  vpsId?: string;
  image: string;
  name: string;
  location: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  creditsHeld: boolean;
  billingOrderId?: string;     // linked MonoWeb Order (db.orders) so revenue and customer billing history stay in one place
  source: 'panel' | 'checkout' | 'admin';
  status: VpsOrderStatus;
  error?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VpsEvent {
  id: string;
  vpsId: string;
  userId: string;              // VPS owner
  actor: string;               // email / "system"
  action: string;              // POWER_START, REINSTALL, SUSPEND ...
  details: string;
  ip?: string;
  createdAt: string;
}

export interface VpsSettings {
  enabled: boolean;            // master switch for the native VPS module
  /** instant = deploy the moment payment (account credits) is taken. manual = staff approve each VPS order. */
  paymentMode: 'instant' | 'manual';
  /** Route website checkout orders of the VPS product to the native module (otherwise they go to the external panel link). */
  handleCheckoutOrders: boolean;
  defaultImage: string;
  maxVpsPerUser: number;       // 0 = unlimited
  /** Days an expired VPS is kept (stopped) before it is deleted for good. 0 = keep until an admin deletes it. */
  deleteAfterExpiryDays: number;
  reminderHours: number;       // mail the owner this many hours before expiry (0 = off)
  allowRenewal: boolean;
  allowReinstall: boolean;
  allowTerminal: boolean;      // dashboard command runner (exec)
  allowSshx: boolean;
  allowFileManager: boolean;
  announcement: string;        // optional banner shown on every VPS page
  newVpsNote: string;          // shown on the deploy page ("Provisioned within a minute")
}

export const defaultVpsSettings = (): VpsSettings => ({
  enabled: true, paymentMode: 'instant', handleCheckoutOrders: true, defaultImage: 'ubuntu-22.04', maxVpsPerUser: 5,
  deleteAfterExpiryDays: 7, reminderHours: 72, allowRenewal: true, allowReinstall: true, allowTerminal: true, allowSshx: true, allowFileManager: true,
  announcement: '', newVpsNote: '',
});

export const defaultVpsImages = (): VpsOsImage[] => [
  { id: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS', base: 'ubuntu:22.04', enabled: true, sort: 1 },
  { id: 'ubuntu-24.04', label: 'Ubuntu 24.04 LTS', base: 'ubuntu:24.04', enabled: true, sort: 2 },
  { id: 'debian-12', label: 'Debian 12', base: 'debian:12', enabled: true, sort: 3 },
  { id: 'ubuntu-20.04', label: 'Ubuntu 20.04 LTS', base: 'ubuntu:20.04', enabled: false, sort: 4 },
  { id: 'debian-11', label: 'Debian 11', base: 'debian:11', enabled: false, sort: 5 },
];

export const defaultVpsPlans = (now: string): VpsPlan[] => [
  { name: 'Nano', cpu: 1, ramMb: 1024, diskGb: 20, bandwidthGb: 1000, price: 3.99 },
  { name: 'Micro', cpu: 2, ramMb: 2048, diskGb: 40, bandwidthGb: 2000, price: 7.99, isPopular: true },
  { name: 'Pro', cpu: 4, ramMb: 8192, diskGb: 100, bandwidthGb: 5000, price: 19.99 },
].map((p, i) => ({
  id: `vplan_${p.name.toLowerCase()}`, description: '', periodDays: 30, images: ['ubuntu-22.04', 'ubuntu-24.04', 'debian-12'], enabled: true, isPopular: false, sort: i, createdAt: now, updatedAt: now, ...p,
}));

/** What the browser receives for a VPS (no secrets, node internals trimmed). */
export interface VpsView {
  id: string;
  name: string;
  status: VpsState | 'unknown';
  suspended: boolean;
  suspendReason: string | null;
  image: string;
  imageLabel: string;
  spec: VpsInstance['spec'];
  host: string | null;
  sshPort: number;
  expiresAt: string;
  expiredAt?: string;
  createdAt: string;
  startedAt: string | null;
  planId: string;
  planName: string;
  renewCount: number;
  node: { name: string; location: string } | null;
  nodeOnline: boolean;
  nodeError: string | null;
  lastError: string | null;
}

export interface VpsStats { cpuPct: number; ramUsedMb: number; diskUsedMb: number; netRxMb: number; netTxMb: number }
