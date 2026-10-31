import React, { useEffect, useState } from 'react';
import { Check, Crown, Server, Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { fmtMB, money, cx } from './ui/kit';
import type { BillingPeriod, HostingPlan } from '../hostingTypes';

interface Row extends HostingPlan { prices: Record<string, { total: number; perMonth: number; saved: number }> }

/** Public pricing for the native hosting plans: pick monthly / half-yearly / yearly (or any period the admin defines). */
export const HostingPlansSection: React.FC<{ onNavigate: (page: string, params?: any) => void }> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [data, setData] = useState<{ currencySymbol: string; periods: BillingPeriod[]; plans: Row[] } | null>(null);
  const [period, setPeriod] = useState('');
  useEffect(() => {
    apiRequest<any>('/hosting-public/plans').then(r => { if (r.success && r.data?.plans?.length) { setData(r.data); setPeriod((r.data.periods.find((p: BillingPeriod) => p.id === 'yearly') || r.data.periods[0])?.id || ''); } });
  }, []);
  if (!data || !period) return null;
  const go = (planFree: boolean) => (user ? onNavigate(planFree ? 'server-create' : 'upgrade') : onNavigate('register'));

  return (
    <section className="max-w-6xl mx-auto px-4 pt-10" aria-labelledby="hosting-plans-title">
      <div className="text-center space-y-3 mb-8">
        <h2 id="hosting-plans-title" className="text-2xl sm:text-3xl font-extrabold text-white">Hosting plans</h2>
        <p className="text-sm text-zinc-400">Start free. Upgrade for more servers, more power and no ads.</p>
        <div className="inline-flex flex-wrap justify-center gap-1.5 p-1 rounded-2xl bg-zinc-900 border border-zinc-800">
          {data.periods.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)} className={cx('px-4 py-2 rounded-xl text-xs font-semibold transition-colors', period === p.id ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white')}>
              {p.label}{p.discountPercent > 0 && <span className={cx('ml-1.5 text-[10px]', period === p.id ? 'text-zinc-900' : 'text-emerald-400')}>-{p.discountPercent}%</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.plans.map(p => {
          const pr = p.prices[period];
          return (
            <div key={p.id} className={cx('rounded-3xl border p-6 flex flex-col', p.isPopular ? 'border-amber-500/50 bg-amber-500/[0.05] shadow-xl shadow-amber-500/5' : 'border-zinc-800 bg-zinc-900/50')}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-white flex items-center gap-2">{!p.isFree && <Crown className="h-4 w-4 text-amber-400" />}{p.name}</h3>{p.isPopular && <span className="text-[9px] font-black tracking-wider bg-amber-500 text-zinc-950 px-2 py-0.5 rounded">POPULAR</span>}</div>
              <p className="text-xs text-zinc-500 mt-1">{p.tagline}</p>
              <p className="mt-5 text-4xl font-extrabold text-white">{p.isFree ? 'Free' : money(pr.perMonth, data.currencySymbol)}{!p.isFree && <span className="text-sm text-zinc-500 font-medium">/mo</span>}</p>
              {!p.isFree && <p className="text-[11px] text-zinc-500 mt-1">{money(pr.total, data.currencySymbol)} billed {data.periods.find(x => x.id === period)?.label.toLowerCase()}{pr.saved > 0 && <span className="text-emerald-400"> · save {money(pr.saved, data.currencySymbol)}</span>}</p>}
              <ul className="mt-5 space-y-2 text-xs text-zinc-300 flex-1">
                <li className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-zinc-500" />{p.serverLimit} server{p.serverLimit === 1 ? '' : 's'}</li>
                <li className="flex items-center gap-2"><MemoryStick className="h-3.5 w-3.5 text-zinc-500" />{fmtMB(p.perServer.ramMB)} RAM each</li>
                <li className="flex items-center gap-2"><Cpu className="h-3.5 w-3.5 text-zinc-500" />{p.perServer.cpuPercent}% CPU each</li>
                <li className="flex items-center gap-2"><HardDrive className="h-3.5 w-3.5 text-zinc-500" />{fmtMB(p.perServer.diskMB)} storage each</li>
                {p.highlights.slice(0, 4).map((h, i) => <li key={i} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />{h}</li>)}
              </ul>
              <button onClick={() => go(p.isFree)} className={cx('mt-6 w-full py-3 rounded-xl text-sm font-bold transition-colors', p.isPopular ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700 text-white')}>{p.isFree ? 'Start free' : user ? 'Upgrade' : 'Get started'}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
};
