import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Cpu, HardDrive, MemoryStick, Package } from 'lucide-react';
import { Card, cx, fmtMB } from '../../../components/ui/kit';
import { TabHeader, duration } from '../../../components/ui/panelKit';
import { VpsDetail } from '../vpsApi';

const Meter: React.FC<{ icon: React.ReactNode; label: string; value: string; of: string; pct: number }> = ({ icon, label, value, of, pct }) => {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <Card className="!p-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">{icon}{label}</p>
      <p className="mt-2 text-xl font-extrabold text-white font-mono">{value}<span className="text-xs font-medium text-zinc-500"> / {of}</span></p>
      <div className="mt-3 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className={cx('h-full rounded-full transition-all', p > 90 ? 'bg-red-500' : p > 70 ? 'bg-amber-400' : 'bg-emerald-500')} style={{ width: `${p}%` }} /></div>
    </Card>
  );
};

export const OverviewTab: React.FC<{ d: VpsDetail; running: boolean }> = ({ d, running }) => {
  const { vps, stats, plan } = d; const s = vps.spec;
  return (
    <div className="space-y-4">
      <TabHeader title="Overview" subtitle={running ? 'Live resource usage, refreshed every few seconds.' : 'Start the VPS to see live usage.'} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Meter icon={<Cpu className="h-3 w-3" />} label="CPU" value={`${stats.cpuPct.toFixed(0)}%`} of={`${s.cpu * 100}%`} pct={stats.cpuPct / s.cpu} />
        <Meter icon={<MemoryStick className="h-3 w-3" />} label="Memory" value={fmtMB(stats.ramUsedMb)} of={fmtMB(s.ramMb)} pct={(stats.ramUsedMb / s.ramMb) * 100} />
        <Meter icon={<HardDrive className="h-3 w-3" />} label="Disk" value={fmtMB(stats.diskUsedMb)} of={`${s.diskGb} GB`} pct={(stats.diskUsedMb / (s.diskGb * 1024)) * 100} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="!p-4 flex items-center gap-3"><ArrowDownToLine className="h-5 w-5 text-sky-400" /><div><p className="text-[10px] font-mono uppercase text-zinc-500">Network in</p><p className="font-mono text-white">{stats.netRxMb.toFixed(1)} MB</p></div></Card>
        <Card className="!p-4 flex items-center gap-3"><ArrowUpFromLine className="h-5 w-5 text-violet-400" /><div><p className="text-[10px] font-mono uppercase text-zinc-500">Network out</p><p className="font-mono text-white">{stats.netTxMb.toFixed(1)} MB</p></div></Card>
      </div>
      <Card className="!p-5">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Package className="h-4 w-4 text-amber-400" />Details</h3>
        <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
          {([['Plan', plan.name], ['Operating system', vps.imageLabel], ['Location', vps.node?.location || '—'], ['Uptime', running && vps.startedAt ? duration(Date.now() - new Date(vps.startedAt).getTime()) : '—'],
            ['Bandwidth', s.bandwidthGb ? `${s.bandwidthGb} GB / month (fair use)` : 'Unmetered (fair use)'], ['Renewals', String(vps.renewCount)]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-zinc-800/60 pb-2"><dt className="text-zinc-500">{k}</dt><dd className="text-zinc-200 font-mono text-right">{v}</dd></div>))}
        </dl>
      </Card>
    </div>
  );
};
