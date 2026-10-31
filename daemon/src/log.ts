const stamp = () => new Date().toISOString();
const redact = (s: string) => s.replace(/(secret|token|password|key)=([^\s&]+)/gi, '$1=[redacted]');
export const log = {
  info: (...a: unknown[]) => console.log(stamp(), 'INFO ', ...a.map(x => (typeof x === 'string' ? redact(x) : x))),
  warn: (...a: unknown[]) => console.warn(stamp(), 'WARN ', ...a.map(x => (typeof x === 'string' ? redact(x) : x))),
  error: (...a: unknown[]) => console.error(stamp(), 'ERROR', ...a.map(x => (x instanceof Error ? x.message : typeof x === 'string' ? redact(x) : x))),
};
