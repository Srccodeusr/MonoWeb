import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Cloud, DollarSign, HardDrive, Network, RefreshCw, ShoppingCart, Users } from 'lucide-react';
import { Badge, Btn, Card, PageHeader, Spinner, fmtMB, money } from '../../../components/ui/kit';
import { ago } from '../../../components/ui/panelKit';
import { VpsEvent } from '../../../vpsTypes';
import { adminVps } from '../../vps/vpsApi';

interface Overview {
  enabled: boolean; nodes: { total: number; online: number; accepting: number };
  vps: { total: number; byStatus: Record<string, number>; expiringSoon: number; owners: number }; orders: { pending: number; failed: number };
  revenue: { total: number; last30: number; renewals30: number }; allocation: { ramMb: number; diskGb: number; cpu: number; capRamMb: number; capDiskGb: number };
  plans: number; images: number; alerts: { level: 'red' | 'amber'; text: string; page?: string }[]; recent: VpsEvent[];
}
const Stat: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; onClick?: () => void }> = ({ icon, label, value, sub, onClick }) => (
  <Card className={`!p-4 ${onClick ? 'cursor-pointer hover:border-zinc-700' : ''}`}><div onClick={onClick}><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">{icon}{label}</p><p className="mt-2 text-2xl font-extrabold text-white">{value}</p>{sub && <p className="text-[11px] text-zinc-500 mt-1">{sub}</p>}</div></Card>
);
const Bar: React.FC<{ label: string; used: number; cap: number; fmt: (n: number) => string }> = ({ label, used, cap, fmt }) => {
  const p = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return <div><div className="flex justify-between text-xs"><span className="text-zinc-400">{label}</span><span className="font-mono text-zinc-200">{fmt(used)}{cap > 0 ? ` / ${fmt(cap)}` : ''}</span></div>
    {cap > 0 ? <div className="mt-1.5 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full ${p > 90 ? 'bg-red-500' : p > 70 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${p}%` }} /></div> : <p className="text-[10px] text-zinc-600 mt-1">Set node RAM/disk totals to see capacity.</p>}</div>;
};

export const AdminVpsOverview: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const [o, setO] = useState<Overview | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setO(await adminVps<Overview>('/overview')); setErr(''); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 20000); return () => window.clearInterval(t); }, [load]);
  if (err && !o) return <Card className="!p-6 text-sm text-red-300">{err}</Card>;
  if (!o) return <Spinner label="Loading VPS overview…" />;
  const s = o.vps.byStatus;
  return (
    <div className="space-y-5">
      <PageHeader icon={<Cloud className="h-6 w-6 text-amber-400" />} title="VPS Overview" subtitle="Native VPS hosting: nodes, customer servers, orders and revenue at a glance."
        actions={<>{!o.enabled && <Badge tone="red">Module disabled</Badge>}<Btn size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" />Refresh</Btn></>} />
      {o.alerts.length > 0 && <div className="space-y-2">{o.alerts.map((a, i) => (
        <button key={i} onClick={() => a.page && onNavigate(a.page)} className={`w-full text-left rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2.5 ${a.level === 'red' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}><AlertTriangle className="h-4 w-4 shrink-0" />{a.text}</button>))}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<HardDrive className="h-3 w-3" />} label="VPS servers" value={o.vps.total} sub={`${s.running || 0} running · ${s.offline || 0} offline · ${(s.suspended || 0) + (s.expired || 0)} suspended/expired`} onClick={() => onNavigate('admin-vps-servers')} />
        <Stat icon={<Network className="h-3 w-3" />} label="Nodes online" value={`${o.nodes.online}/${o.nodes.total}`} sub={`${o.nodes.accepting} accepting new VPSes`} onClick={() => onNavigate('admin-vps-nodes')} />
        <Stat icon={<ShoppingCart className="h-3 w-3" />} label="Pending orders" value={o.orders.pending} sub={o.orders.failed ? `${o.orders.failed} failed` : 'Nothing stuck'} onClick={() => onNavigate('admin-vps-orders')} />
        <Stat icon={<DollarSign className="h-3 w-3" />} label="Revenue (30 d)" value={money(o.revenue.last30)} sub={`${money(o.revenue.total)} all time · ${o.revenue.renewals30} renewals`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Allocation across nodes</h3>
          <Bar label="RAM sold" used={o.allocation.ramMb} cap={o.allocation.capRamMb} fmt={fmtMB} /><Bar label="Disk sold" used={o.allocation.diskGb * 1024} cap={o.allocation.capDiskGb * 1024} fmt={mb => `${Math.round(mb / 1024)} GB`} />
          <p className="text-xs text-zinc-500 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{o.vps.owners} customers · {o.vps.expiringSoon} VPS expiring within 3 days · {o.plans} plans · {o.images} OS images</p></Card>
        <Card className="!p-5"><h3 className="text-sm font-bold text-white mb-3">Recent activity</h3>
          {!o.recent.length ? <p className="text-xs text-zinc-500">No activity yet.</p> : <div className="space-y-2">{o.recent.map(e => <div key={e.id} className="flex items-center justify-between gap-3 text-xs"><span className="font-mono text-zinc-300 truncate">{e.action.replace(/_/g, ' ')} <span className="text-zinc-600">· {e.actor}</span></span><span className="text-zinc-600 shrink-0">{ago(e.createdAt)}</span></div>)}</div>}
          <button className="mt-3 text-xs text-amber-400 hover:underline" onClick={() => onNavigate('admin-vps-activity')}>View all activity</button></Card>
      </div>
    </div>
  );
};
