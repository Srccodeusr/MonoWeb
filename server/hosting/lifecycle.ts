import { HostServer } from '../../src/hostingTypes';

/**
 * Server expiry policy.
 *
 *   expiresAt reached   -> server is STOPPED and marked "expired" (admin controls how long servers live via
 *                          plan validity days / renewal settings, never how long they linger afterwards)
 *   +24 hours, unrenewed -> server is DELETED (volume wiped). This is intentionally a constant, not a setting.
 */
export const DELETE_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;

export type LifecycleAction = 'none' | 'expire' | 'delete' | 'remind';

export function evaluateServer(s: Pick<HostServer, 'expiresAt' | 'expiredAt' | 'status' | 'notifiedExpiry'>, now: number, reminderHours: number): LifecycleAction {
  if (!s.expiresAt) return 'none';
  const exp = new Date(s.expiresAt).getTime();
  if (Number.isNaN(exp)) return 'none';
  if (s.status === 'expired' || s.expiredAt) {
    const since = new Date(s.expiredAt || s.expiresAt).getTime();
    // Renewed servers get expiresAt moved into the future and expiredAt cleared by renew(); guard anyway.
    if (exp > now) return 'none';
    return now - since >= DELETE_AFTER_EXPIRY_MS ? 'delete' : 'none';
  }
  if (exp <= now) return 'expire';
  if (!s.notifiedExpiry && exp - now <= reminderHours * 3600_000) return 'remind';
  return 'none';
}

/** Renewal extends from whichever is later: now or the current expiry, so early renewals never lose time. */
export function extendFrom(currentExpiresAt: string | undefined, addMs: number, now: number): Date {
  const cur = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0;
  return new Date(Math.max(now, Number.isFinite(cur) ? cur : 0) + addMs);
}
