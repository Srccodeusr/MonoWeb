import React, { useEffect, useState } from 'react';
import { Server, Plus, Star, ShoppingBag, Coins, User as UserIcon, LogOut, CreditCard, LifeBuoy, Mail, Activity, MoreHorizontal, Info, CheckCircle2, Loader2, Package, Cloud } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { apiRequest } from '../../lib/api';
import { AdBanner } from '../AdBanner';
import { PanelProvider, usePanel } from './PanelContext';
import { cx } from '../ui/kit';

interface Props { currentPage: string; onNavigate: (page: string, params?: any) => void; children: React.ReactNode }

const TABS = [
  { page: 'servers', label: 'Servers', icon: Server, match: ['servers', 'server', 'addons'] },
  { page: 'server-create', label: 'Create', icon: Plus, match: ['server-create'] },
  { page: 'vps-list', label: 'VPS', icon: Cloud, match: ['vps-list', 'vps-server', 'vps-deploy'] },
  { page: 'upgrade', label: 'Upgrade', icon: Star, match: ['upgrade'] },
  { page: 'store', label: 'Store', icon: ShoppingBag, match: ['store'] },
  { page: 'earn', label: 'Earn', icon: Coins, match: ['earn'] },
  { page: 'settings', label: 'Account', icon: UserIcon, match: ['settings'] },
];
const MORE = [
  { page: 'addons', label: 'Addon Store', icon: Package },
  { page: 'billing', label: 'Billing & credits', icon: CreditCard },
  { page: 'support', label: 'Support', icon: LifeBuoy },
  { page: 'mail', label: 'Inbox', icon: Mail },
  { page: 'activity', label: 'Activity', icon: Activity },
];

/** After Stripe returns the customer here (/servers?paid=1&order=…): confirm the order, then drop the query. */
const PaymentWatcher: React.FC = () => {
  const { refresh } = usePanel();
  const [state, setState] = useState<'idle' | 'checking' | 'paid' | 'pending'>('idle');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const order = q.get('order');
    if (q.get('paid') !== '1' || !order || !/^[\w-]{6,64}$/.test(order)) return;
    let stop = false; setState('checking');
    (async () => {
      for (let i = 0; i < 20 && !stop; i++) {
        const res = await apiRequest(`/hosting/billing/orders/${order}?sync=1`);
        if (res.success && res.data?.status === 'paid') { setState('paid'); await refresh(); window.history.replaceState({}, '', '/servers'); setTimeout(() => !stop && setState('idle'), 6000); return; }
        if (res.success && res.data?.status === 'failed') break;
        await new Promise(r => setTimeout(r, 3000));
      }
      if (!stop) { setState('pending'); window.history.replaceState({}, '', '/servers'); }
    })();
    return () => { stop = true; };
  }, [refresh]);
  if (state === 'idle') return null;
  return (
    <div className={cx('mb-4 rounded-xl border px-4 py-3 text-xs flex items-center gap-2.5', state === 'paid' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200')}>
      {state === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'paid' ? <CheckCircle2 className="h-4 w-4" /> : <Info className="h-4 w-4" />}
      {state === 'checking' && 'Payment received, activating your plan…'}
      {state === 'paid' && 'Payment confirmed. Your plan is active and your servers have been upgraded.'}
      {state === 'pending' && 'Your payment is still being confirmed. This page will update automatically once it clears.'}
    </div>
  );
};

const TopBar: React.FC<{ onNavigate: Props['onNavigate'] }> = () => {
  const { data } = usePanel();
  if (!data?.topBar) return null;
  const linkOk = (u: string) => /^(https?:\/\/|\/)/.test(u);
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-2.5 text-[12px] text-emerald-200 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Info className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      <span>{data.topBar.message}</span>
      {data.topBar.links.filter(l => linkOk(l.url)).map((l, i) => (
        <React.Fragment key={i}><span className="text-emerald-700">|</span><a href={l.url} target={l.url.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="underline decoration-emerald-500/50 hover:text-white">{l.label}</a></React.Fragment>
      ))}
    </div>
  );
};

const Shell: React.FC<Props> = ({ currentPage, onNavigate, children }) => {
  const { logout } = useAuth();
  const { data } = usePanel();
  const [more, setMore] = useState(false);
  const active = (t: typeof TABS[number]) => t.match.includes(currentPage);
  const noAds = !!data?.plan.noAds;

  return (
    <div className={cx('w-full mx-auto', currentPage === 'server' || currentPage === 'vps-server' ? 'max-w-7xl' : 'max-w-5xl')}>
      {/* Icon tab strip, same structure as the reference panel: Servers / Create / Upgrade / Store / Earn / Account / More */}
      <nav className="sticky top-16 z-30 -mx-4 lg:mx-0 mb-4 bg-zinc-950/85 backdrop-blur border-b border-zinc-800/80 lg:rounded-2xl lg:border" aria-label="Panel">
        <div className="flex items-stretch justify-between sm:justify-center gap-0.5 px-1 overflow-x-auto no-scrollbar">
          {TABS.map(t => {
            const Icon = t.icon; const on = active(t);
            return (
              <button key={t.page} onClick={() => onNavigate(t.page)} aria-current={on ? 'page' : undefined}
                className={cx('flex-1 sm:flex-none sm:min-w-[84px] flex flex-col items-center gap-0.5 px-3 py-2.5 text-[10px] font-semibold border-b-2 transition-colors', on ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-200')}>
                <Icon className="h-[18px] w-[18px]" />{t.label}
              </button>
            );
          })}
          <div className="relative flex-1 sm:flex-none sm:min-w-[84px]">
            <button onClick={() => setMore(m => !m)} className="w-full h-full flex flex-col items-center gap-0.5 px-3 py-2.5 text-[10px] font-semibold border-b-2 border-transparent text-zinc-500 hover:text-zinc-200"><MoreHorizontal className="h-[18px] w-[18px]" />More</button>
            {more && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMore(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl p-1.5">
                  {MORE.map(m => { const I = m.icon; return <button key={m.page} onClick={() => { setMore(false); onNavigate(m.page); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800"><I className="h-4 w-4 text-zinc-500" />{m.label}</button>; })}
                  <div className="h-px bg-zinc-800 my-1" />
                  <button onClick={() => logout()} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10"><LogOut className="h-4 w-4" />Log out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      <TopBar onNavigate={onNavigate} />
      <div className="mt-4"><PaymentWatcher />{children}</div>

      {!noAds && <div className="mt-8"><AdBanner placement="footer" /></div>}
    </div>
  );
};

export const PanelLayout: React.FC<Props> = props => <PanelProvider><Shell {...props} /></PanelProvider>;
