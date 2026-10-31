import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Gift, History } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePanel } from '../../components/panel/PanelContext';
import { EarnFlow } from '../../components/panel/EarnFlow';
import { AdBanner } from '../../components/AdBanner';
import { Btn, Card, PageHeader, Spinner, fmtDate, useToast, cx } from '../../components/ui/kit';

interface Wallet { enabled: boolean; coinName: string; coins: number; dailyBonus: { amount: number; ready: boolean }; today: { ads: number; blogs: number; adMax: number; blogMax: number }; history: { id: string; amount: number; reason: string; createdAt: string }[] }

export const Earn: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const { refresh, data: panel } = usePanel();
  const [toast, say] = useToast();
  const [w, setW] = useState<Wallet | null>(null);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(async () => { const r = await apiRequest<Wallet>('/economy/wallet'); if (r.success && r.data) setW(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  if (!w) return <Spinner />;
  if (!w.enabled) return <Card className="text-center py-12 text-sm text-zinc-400">The rewards economy is currently disabled.</Card>;

  const daily = async () => { const r = await apiRequest('/economy/daily', { method: 'POST' }); if (r.success) { say('success', `+${w.dailyBonus.amount} ${w.coinName}`); load(); refresh(); } else say('error', r.error?.message || 'Could not claim.'); };

  return (
    <div className="space-y-4">
      {toast}
      <PageHeader icon={<Gift className="h-6 w-6 text-amber-400" />} title={`Earn ${w.coinName}`} subtitle={`Watch sponsored messages and read articles to earn ${w.coinName}. Spend them in the Store on upgrades, renewals and more.`}
        actions={<Btn variant="primary" onClick={() => onNavigate('store')}>Open Store</Btn>} />
      <div className="grid sm:grid-cols-3 gap-3">
        <Card accent><p className="text-[10px] font-mono uppercase text-zinc-500">Balance</p><p className="text-3xl font-extrabold text-amber-300 mt-1 flex items-center gap-2"><Coins className="h-6 w-6" />{w.coins.toLocaleString()}</p></Card>
        <Card><p className="text-[10px] font-mono uppercase text-zinc-500">Today</p><p className="text-xs text-zinc-300 mt-2">Ads {w.today.ads}/{w.today.adMax}<br />Articles {w.today.blogs}/{w.today.blogMax}</p></Card>
        <Card className="flex flex-col justify-between"><p className="text-[10px] font-mono uppercase text-zinc-500">Daily bonus</p><Btn className="mt-2" variant={w.dailyBonus.ready ? 'primary' : 'dark'} disabled={!w.dailyBonus.ready || w.dailyBonus.amount <= 0} onClick={daily}>{w.dailyBonus.ready ? `Claim +${w.dailyBonus.amount}` : 'Come back tomorrow'}</Btn></Card>
      </div>
      <Card><h2 className="text-sm font-bold text-white mb-3">Earn now</h2><EarnFlow key={nonce} purpose="coins" onDone={r => { say('success', `+${r.reward ?? 0} ${w.coinName}`); setNonce(n => n + 1); load(); refresh(); }} onError={m => say('error', m)} /></Card>
      <Card className="!p-0 overflow-hidden"><h2 className="text-sm font-bold text-white px-5 py-3.5 border-b border-zinc-800 flex items-center gap-2"><History className="h-4 w-4 text-zinc-500" />History</h2>
        {w.history.length === 0 ? <p className="text-xs text-zinc-500 text-center py-8">Nothing yet.</p> : <ul className="divide-y divide-zinc-800/70">{w.history.map(h => <li key={h.id} className="flex items-center justify-between px-5 py-2.5 text-xs"><span className="text-zinc-300 min-w-0 truncate">{h.reason}<span className="block text-[10px] text-zinc-600">{fmtDate(h.createdAt)}</span></span><span className={cx('font-mono font-bold', h.amount >= 0 ? 'text-emerald-400' : 'text-red-400')}>{h.amount > 0 ? '+' : ''}{h.amount}</span></li>)}</ul>}
      </Card>
      {!panel?.plan.noAds && <AdBanner placement="store" />}
    </div>
  );
};
