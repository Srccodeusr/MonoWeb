import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Btn, Modal, TextInput, cx } from './kit';

/** Extra building blocks for the server pages (dropdown menus, dialogs, checkbox). Same zinc/amber tokens as kit.tsx. */

export const TabHeader: React.FC<{ title: string; subtitle: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h2>
      <p className="text-xs sm:text-sm text-zinc-400 mt-1">{subtitle}</p>
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

export const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean; className?: string }> = ({ checked, onChange, label, indeterminate, className }) => (
  <button type="button" role="checkbox" aria-checked={indeterminate ? 'mixed' : checked} aria-label={label} onClick={e => { e.stopPropagation(); onChange(!checked); }}
    className={cx('h-[18px] w-[18px] shrink-0 rounded-[5px] border flex items-center justify-center transition-colors', checked || indeterminate ? 'bg-amber-500 border-amber-500 text-zinc-950' : 'border-zinc-600 bg-zinc-950 hover:border-zinc-400', className)}>
    {checked && <Check className="h-3 w-3" strokeWidth={3.5} />}{!checked && indeterminate && <span className="h-0.5 w-2 bg-zinc-950 rounded" />}
  </button>
);

export interface MenuItem { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; }
export type MenuEntry = MenuItem | 'divider';

/** A small dropdown: opens under the trigger, closes on outside click / Escape / choosing an item. */
export const Menu: React.FC<{ label: React.ReactNode; items: MenuEntry[]; align?: 'left' | 'right'; variant?: 'ghost' | 'primary' | 'dark'; size?: 'sm' | 'md'; chevron?: boolean; iconOnly?: boolean; ariaLabel?: string; disabled?: boolean; className?: string }> =
  ({ label, items, align = 'left', variant = 'ghost', size = 'md', chevron = true, iconOnly, ariaLabel, disabled, className }) => {
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!open) return;
      const down = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
      const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
      document.addEventListener('mousedown', down); document.addEventListener('touchstart', down); document.addEventListener('keydown', key);
      return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key); };
    }, [open]);
    return (
      <div ref={box} className={cx('relative inline-block', className)}>
        <Btn type="button" variant={variant} size={size} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)} className={iconOnly ? '!px-2' : ''}>
          {label}{chevron && !iconOnly && <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />}
        </Btn>
        {open && (
          <div role="menu" className={cx('absolute top-full mt-1.5 z-50 min-w-[11.5rem] rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60 p-1.5', align === 'right' ? 'right-0' : 'left-0')}>
            {items.map((it, i) => it === 'divider'
              ? <div key={i} className="h-px bg-zinc-800 my-1" />
              : <button key={i} role="menuitem" type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
                  className={cx('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed', it.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-zinc-200 hover:bg-zinc-800')}>
                  {it.icon && <span className="text-zinc-500 [&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>}{it.label}
                </button>)}
          </div>
        )}
      </div>
    );
  };

export const PromptModal: React.FC<{ open: boolean; title: string; label: string; initial?: string; placeholder?: string; confirmLabel: string; busy?: boolean; hint?: string; type?: string; onClose: () => void; onSubmit: (value: string) => void; secondary?: { label: string; placeholder?: string; initial?: string; optional?: boolean }; onSubmit2?: (a: string, b: string) => void }> =
  ({ open, title, label, initial = '', placeholder, confirmLabel, busy, hint, type = 'text', onClose, onSubmit, secondary, onSubmit2 }) => {
    const [v, setV] = useState(initial); const [v2, setV2] = useState(secondary?.initial || '');
    useEffect(() => { if (open) { setV(initial); setV2(secondary?.initial || ''); } }, [open, initial, secondary?.initial]);
    const submit = () => { const t = v.trim(); if (!t) return; if (secondary && onSubmit2) onSubmit2(t, v2.trim()); else onSubmit(t); };
    return (
      <Modal open={open} onClose={onClose} title={title} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.trim()} onClick={submit}>{confirmLabel}</Btn></>}>
        <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-4">
          <label className="block"><span className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">{label}</span>
            <TextInput autoFocus type={type} value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} onFocus={e => type === 'text' && e.currentTarget.select()} autoComplete="off" spellCheck={false} />
            {hint && <span className="block text-[11px] text-zinc-500 mt-1">{hint}</span>}
          </label>
          {secondary && <label className="block"><span className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">{secondary.label}{secondary.optional && ' (optional)'}</span>
            <TextInput value={v2} placeholder={secondary.placeholder} onChange={e => setV2(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    );
  };

export const ConfirmModal: React.FC<{ open: boolean; title: string; children: React.ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onClose: () => void; onConfirm: () => void }> =
  ({ open, title, children, confirmLabel, danger, busy, onClose, onConfirm }) => (
    <Modal open={open} onClose={onClose} title={title} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Btn></>}>
      <div className="text-sm text-zinc-300 leading-relaxed">{children}</div>
    </Modal>
  );

export const StatusDot: React.FC<{ tone: 'green' | 'amber' | 'red' | 'zinc' | 'blue'; pulse?: boolean }> = ({ tone, pulse }) => (
  <span className={cx('inline-block h-2 w-2 rounded-full', { green: 'bg-emerald-500', amber: 'bg-amber-400', red: 'bg-red-500', zinc: 'bg-zinc-500', blue: 'bg-sky-400' }[tone], pulse && 'animate-pulse')} />
);

/** "5 minutes ago" without pulling in a date library. */
export function ago(iso?: string, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
export function duration(ms: number): string {
  const s = Math.floor(ms / 1000); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
