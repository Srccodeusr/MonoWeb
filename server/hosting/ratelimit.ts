const buckets = new Map<string, { n: number; reset: number }>();
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60_000).unref?.();

/** Returns true when the action is allowed. Keyed limiter for per-user/per-IP throttling of expensive actions. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return true; }
  if (b.n >= max) return false;
  b.n++; return true;
}
