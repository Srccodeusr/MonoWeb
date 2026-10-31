import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

/** Shared building blocks for the hosting panel + admin pages (same zinc/amber look as the rest of MonoNode). */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Card: React.FC<{ className?: string; children: React.ReactNode; accent?: boolean }> = ({ className, children, accent }) => (
  <div className={cx('rounded-2xl border p-4 sm:p-5', accent ? 'border-amber-500/25 bg-amber-500/[0.04]' : 'border-zinc-800 bg-zinc-900/60', className)}>{children}</div>
);

export const PageHeader: React.FC<{ icon?: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }> = ({ icon, title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
    <div className="min-w-0">
      <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">{icon}<span className="truncate">{title}</span></h1>
      {subtitle && <p className="text-xs text-zinc-400 mt-1 max-w-2xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'dark' | 'success'; size?: 'sm' | 'md'; busy?: boolean };
export const Btn: React.FC<BtnProps> = ({ variant = 'ghost', size = 'md', busy, className, children, disabled, ...rest }) => {
  const v = {
    primary: 'bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shadow-lg shadow-amber-500/10',
    ghost: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200',
    dark: 'bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20',
    success: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20',
  }[variant];
  return (
    <button {...rest} disabled={disabled || busy} className={cx('inline-flex items-center justify-center gap-1.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold', size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-4 py-2.5 text-xs', v, className)}>
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}
    </button>
  );
};

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }> = ({ label, hint, children, className, right }) => (
  <label className={cx('block', className)}>
    <span className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5"><span>{label}</span>{right}</span>
    {children}
    {hint && <span className="block text-[11px] text-zinc-500 mt-1">{hint}</span>}
  </label>
);

const inputCls = 'w-full rounded-xl bg-zinc-950 border border-zinc-800 focus:border-amber-500/60 focus:outline-none px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors';
export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} {...p} className={cx(inputCls, className)} />);
TextInput.displayName = 'TextInput';
export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className, ...p }) => <textarea {...p} className={cx(inputCls, 'font-mono text-xs min-h-[90px]', className)} />;
export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className, children, ...p }) => <select {...p} className={cx(inputCls, 'appearance-none', className)}>{children}</select>;

/** Number input that keeps '' while typing and reports numbers. */
export const NumInput: React.FC<{ value: number | undefined; onChange: (n: number) => void; min?: number; max?: number; step?: number; className?: string; suffix?: string }> = ({ value, onChange, min, max, step, className, suffix }) => (
  <div className="relative">
    <input type="number" inputMode="decimal" value={Number.isFinite(value as number) ? value : ''} min={min} max={max} step={step}
      onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} className={cx(inputCls, suffix && 'pr-12', className)} />
    {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-500">{suffix}</span>}
  </div>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-center gap-3 text-left w-full group">
    <span className={cx('relative h-5 w-9 rounded-full transition-colors shrink-0', checked ? 'bg-amber-500' : 'bg-zinc-700')}>
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </span>
    {(label || hint) && <span><span className="block text-xs font-semibold text-zinc-200">{label}</span>{hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}</span>}
  </button>
);

export const Badge: React.FC<{ tone?: 'green' | 'amber' | 'red' | 'zinc' | 'blue'; children: React.ReactNode; className?: string }> = ({ tone = 'zinc', children, className }) => {
  const t = { green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20', red: 'bg-red-500/10 text-red-400 border-red-500/20', zinc: 'bg-zinc-800 text-zinc-400 border-zinc-700', blue: 'bg-sky-500/10 text-sky-400 border-sky-500/20' }[tone];
  return <span className={cx('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono border whitespace-nowrap', t, className)}>{children}</span>;
};

export const statusTone = (s: string): 'green' | 'amber' | 'red' | 'zinc' | 'blue' =>
  s === 'running' ? 'green' : ['installing', 'starting'].includes(s) ? 'blue' : ['expired', 'suspended', 'install_failed'].includes(s) ? 'red' : 'zinc';

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }> = ({ open, onClose, title, children, wide, footer }) => {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={cx('w-full bg-zinc-900 border border-zinc-800 sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

export function useToast(): [React.ReactNode, (type: 'success' | 'error', message: string) => void] {
  const [t, setT] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((type: 'success' | 'error', message: string) => {
    setT({ type, message }); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(null), 4500);
  }, []);
  const node = t ? (
    <div className={cx('fixed bottom-5 right-5 left-5 sm:left-auto z-[90] sm:max-w-sm flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-xs font-medium', t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200' : 'bg-red-950/90 border-red-500/30 text-red-200')} role="status">
      {t.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />}<span>{t.message}</span>
    </div>
  ) : null;
  return [node, show];
}

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
);

export const Empty: React.FC<{ icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="flex flex-col items-center text-center py-14 px-6">
    {icon && <div className="mb-4 text-zinc-700">{icon}</div>}
    <p className="text-sm font-bold text-zinc-200">{title}</p>
    {text && <p className="text-xs text-zinc-500 mt-1.5 max-w-sm">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ---------- formatting helpers ----------
export const fmtMB = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`);
export const fmtBytes = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(0)} MB` : `${Math.round(b / 1024)} KB`);
export const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export function timeLeft(iso?: string, now = Date.now()): { text: string; ms: number; urgent: boolean } {
  if (!iso) return { text: 'Never expires', ms: Infinity, urgent: false };
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { text: 'Expired', ms, urgent: true };
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return { text: d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`, ms, urgent: ms < 86400000 };
}
export const money = (n: number, sym = '$') => `${sym}${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '')}`;
