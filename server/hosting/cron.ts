/**
 * Minimal, dependency-free 5-field cron (minute hour day-of-month month day-of-week), evaluated in UTC.
 * Supports *, lists (1,5), ranges (1-5), steps (*\/15, 10-50/10) and 0-7 for Sunday. Standard semantics: when BOTH
 * day-of-month and day-of-week are restricted a day matches if EITHER does.
 */
interface Parsed { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean }

function field(src: string, lo: number, hi: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid ${name} field "${src}"`);
    const step = m[2] ? parseInt(m[2], 10) : 1;
    if (step < 1) throw new Error(`Invalid step in ${name}`);
    let a = lo, b = hi;
    if (m[1] !== '*') {
      const [x, y] = m[1].split('-').map(Number);
      a = x; b = y === undefined ? (m[2] ? hi : x) : y;
    }
    if (a < lo || b > hi || a > b) throw new Error(`${name} must be between ${lo} and ${hi}`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Parsed {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error('Use 5 fields: minute hour day-of-month month day-of-week');
  const dow = field(f[4], 0, 7, 'day-of-week'); if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return { min: field(f[0], 0, 59, 'minute'), hour: field(f[1], 0, 23, 'hour'), dom: field(f[2], 1, 31, 'day-of-month'), mon: field(f[3], 1, 12, 'month'), dow, domStar: f[2] === '*' || f[2].startsWith('*/'), dowStar: f[4] === '*' || f[4].startsWith('*/') };
}

function dayMatches(p: Parsed, d: Date): boolean {
  const dom = p.dom.has(d.getUTCDate()), dow = p.dow.has(d.getUTCDay());
  if (!p.domStar && !p.dowStar) return dom || dow;
  return dom && dow;
}

/** First matching minute strictly after `after`, or null if none within ~5 years. */
export function nextRun(expr: string, after: Date): Date | null {
  const p = parseCron(expr);
  const t = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), after.getUTCHours(), after.getUTCMinutes() + 1, 0, 0));
  const limit = t.getTime() + 5 * 366 * 86400_000;
  while (t.getTime() < limit) {
    if (!p.mon.has(t.getUTCMonth() + 1)) { t.setUTCMonth(t.getUTCMonth() + 1, 1); t.setUTCHours(0, 0, 0, 0); continue; }
    if (!dayMatches(p, t)) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0, 0, 0, 0); continue; }
    if (!p.hour.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0); continue; }
    if (!p.min.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0); continue; }
    return t;
  }
  return null;
}

export const MIN_INTERVAL_MINUTES = 5;

/** Returns an error message, or null when the expression is valid AND never fires more often than every 5 minutes. */
export function validateCron(expr: string): string | null {
  try { parseCron(expr); } catch (e: any) { return e.message; }
  let cur = nextRun(expr, new Date('2030-01-01T00:00:00Z'));
  if (!cur) return 'This schedule never runs.';
  for (let i = 0; i < 60; i++) {
    const nxt = nextRun(expr, cur!);
    if (!nxt) return null;
    if ((nxt.getTime() - cur!.getTime()) / 60000 < MIN_INTERVAL_MINUTES) return `Tasks can run at most every ${MIN_INTERVAL_MINUTES} minutes.`;
    cur = nxt;
  }
  return null;
}

export function describeCron(expr: string): string {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return expr;
  const [mi, h, dom, mo, dw] = f;
  if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mo === '*' && dw === '*') return `Every ${mi.slice(2)} minutes`;
  if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mo === '*' && dw === '*') return `Hourly at :${mi.padStart(2, '0')} UTC`;
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mo === '*' && dw === '*') return `Daily at ${h.padStart(2, '0')}:${mi.padStart(2, '0')} UTC`;
  return expr;
}
