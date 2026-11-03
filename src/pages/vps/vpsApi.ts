import { apiRequest } from '../../lib/api';
import { VpsStats, VpsView } from '../../vpsTypes';

/** Thin wrappers over apiRequest that resolve with `data` or throw Error(message), so pages can use try/catch + toast. */
async function call<T>(base: string, path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await apiRequest<T>(`${base}${path}`, { method: opts.method || 'GET', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (!r.success) throw new Error(r.error?.message || 'Request failed.');
  return r.data as T;
}
export const vpsCall = <T = any>(path: string, opts?: { method?: string; body?: unknown }) => call<T>('/vps', path, opts);
export const adminVps = <T = any>(path: string, opts?: { method?: string; body?: unknown }) => call<T>('/admin/vps', path, opts);

export interface VpsSettingsPublic { enabled: boolean; paymentMode: 'instant' | 'manual'; allowRenewal: boolean; allowReinstall: boolean; allowTerminal: boolean; allowSshx: boolean; allowFileManager: boolean; announcement: string; newVpsNote: string; maxVpsPerUser: number; currencySymbol: string }
export interface VpsDetail { vps: VpsView; stats: VpsStats; plan: { name: string; price: number; periodDays: number }; settings: VpsSettingsPublic; diskEnforced: boolean }
export const STATUS_LABEL: Record<string, string> = { running: 'Running', offline: 'Offline', installing: 'Installing', suspended: 'Suspended', expired: 'Expired', error: 'Error', unknown: 'Unknown' };
/** kit.statusTone knows running/installing/expired/suspended; map the rest onto its tones. */
export const vpsTone = (s: string): 'green' | 'amber' | 'red' | 'zinc' | 'blue' => (s === 'running' ? 'green' : s === 'installing' ? 'blue' : ['expired', 'suspended', 'error'].includes(s) ? 'red' : s === 'unknown' ? 'amber' : 'zinc');
