import React, { useEffect, useState } from 'react';
import { Server, Network, Users, DollarSign, Coins, Megaphone, CheckCircle2, Circle, ArrowRight, AlertTriangle, Layers } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, PageHeader, Spinner, money } from '../../components/ui/kit';

interface Stats { nodes: { total: number; online: number }; servers: { total: number; byStatus: Record<string, number>; expiringSoon: number }; users: { total: number; premium: number }; revenue: { total: number; last30: number; pending: number }; economy: { coinsInCirculation: number; purchases30: number }; ads: { active: number; impressions: number; clicks: number } }

const Tile: React.FC<{ icon: any; label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void }> = ({ icon: I, label, value, sub, onClick }) => (
  <button onClick={onClick} disabled={!onClick} className="text-left rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 disabled:hover:border-zinc-800 p-4 transition-colors">
    <div className="flex items-center justify-between text-zinc-500"><span className="text-[10px] font-mono uppercase tracking-wider">{label}</span><I className="h-4 w-4" /></div>
    <p className="text-2xl font-extrabold text-white mt-2">{value}</p>{sub && <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>}
  </button>
);

export const AdminHosting: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const [s, setS] = useState<Stats | null>(null);
  const [setup, setSetup] = useState<{ stripe: boolean; images: number; plans: number } | null>(null);
  useEffect(() => {
    (async () => {
      const [a, st, im, pl] = await Promise.all([apiRequest<Stats>('/admin/hosting/stats'), apiRequest('/admin/hosting/stripe'), apiRequest('/admin/hosting/images'), apiRequest('/admin/hosting/plans')]);
      if (a.success && a.data) setS(a.data);
      setSetup({ stripe: !!st.data?.enabled, images: im.data?.length || 0, plans: pl.data?.length || 0 });
    })();
  }, []);
  if (!s || !setup) return <Spinner />;
  const steps = [
    { done: s.nodes.total > 0, label: 'Add your first node (a machine running the daemon)', go: 'admin-nodes' },
    { done: s.nodes.online > 0, label: 'Make sure at least one node shows Online', go: 'admin-nodes' },
    { done: setup.images > 0, label: 'Enable the software images users can deploy', go: 'admin-images' },
    { done: setup.plans > 0, label: 'Review plans, limits and prices', go: 'admin-hosting-plans' },
    { done: setup.stripe, label: 'Connect Stripe so users can pay by card (optional)', go: 'admin-stripe' },
  ];
  const pct = Math.round((steps.filter(x => x.done).length / steps.length) * 100);
  return (
    <div className="space-y-5">
      <PageHeader icon={<Layers className="h-6 w-6 text-amber-400" />} title="Hosting Overview" subtitle="Everything about the hosting platform at a glance." />
      {pct < 100 && (
        <Card accent className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-white">Setup guide</h2><span className="text-xs font-mono text-amber-300">{pct}%</span></div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${pct}%` }} /></div>
          <ul className="space-y-1.5">{steps.map((x, i) => <li key={i} className="flex items-center gap-2.5 text-xs">{x.done ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> : <Circle className="h-4 w-4 text-zinc-600 shrink-0" />}<span className={x.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}>{x.label}</span>{!x.done && <button onClick={() => onNavigate(x.go)} className="ml-auto text-amber-300 flex items-center gap-1 hover:underline shrink-0">Open<ArrowRight className="h-3 w-3" /></button>}</li>)}</ul>
        </Card>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Network} label="Nodes" value={`${s.nodes.online}/${s.nodes.total}`} sub="online" onClick={() => onNavigate('admin-nodes')} />
        <Tile icon={Server} label="Servers" value={s.servers.total} sub={`${s.servers.byStatus.running || 0} running · ${s.servers.expiringSoon} expiring <24h`} onClick={() => onNavigate('admin-servers')} />
        <Tile icon={Users} label="Accounts" value={s.users.total} sub={`${s.users.premium} on a paid plan`} onClick={() => onNavigate('admin-accounts')} />
        <Tile icon={DollarSign} label="Revenue (30d)" value={money(s.revenue.last30)} sub={`${money(s.revenue.total)} all time · ${s.revenue.pending} pending`} onClick={() => onNavigate('admin-billing')} />
        <Tile icon={Coins} label="Coins in circulation" value={s.economy.coinsInCirculation.toLocaleString()} sub={`${s.economy.purchases30} store purchases (30d)`} onClick={() => onNavigate('admin-store')} />
        <Tile icon={Megaphone} label="Ads" value={s.ads.active} sub={`${s.ads.impressions.toLocaleString()} views · ${s.ads.clicks.toLocaleString()} clicks`} onClick={() => onNavigate('admin-ads')} />
      </div>
      {s.servers.expiringSoon > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{s.servers.expiringSoon} server(s) expire within 24 hours. Expired servers are deleted automatically 24 hours later.<Badge tone="amber" className="ml-auto">auto</Badge></div>}
      <Card className="flex flex-wrap gap-2">{[['admin-hosting-settings', 'Expiry & renewals'], ['admin-hosting-plans', 'Plans & limits'], ['admin-store', 'Store & economy'], ['admin-ads', 'Ad Center'], ['admin-stripe', 'Stripe setup']].map(([p, l]) => <Btn key={p} onClick={() => onNavigate(p)}>{l}</Btn>)}</Card>
    </div>
  );
};
