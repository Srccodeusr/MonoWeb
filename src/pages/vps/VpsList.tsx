import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, Cloud, Cpu, HardDrive, MapPin, MemoryStick, Plus } from 'lucide-react';
import { Badge, Btn, Card, Empty, Spinner, fmtMB, timeLeft } from '../../components/ui/kit';
import { StatusDot } from '../../components/ui/panelKit';
import { VpsView } from '../../vpsTypes';
import { STATUS_LABEL, VpsSettingsPublic, vpsCall, vpsTone } from './vpsApi';

const VpsCard: React.FC<{ v: VpsView; onOpen: () => void }> = ({ v, onOpen }) => {
  const tl = timeLeft(v.expiresAt); const expired = v.status === 'expired';
  return (
    <button onClick={onOpen} className={`group text-left w-full rounded-2xl border bg-zinc-900/60 hover:bg-zinc-900 transition-colors p-4 ${expired ? 'border-red-500/30' : 'border-zinc-800 hover:border-zinc-700'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{v.name}</p>
          <p className="text-[11px] text-zinc-500 truncate mt-0.5 font-mono">{v.host ? `${v.host}:${v.sshPort}` : 'Address pending'}</p>
        </div>
        <Badge tone={vpsTone(v.status)}><StatusDot tone={vpsTone(v.status)} pulse={v.status === 'installing'} /><span className="ml-1.5">{STATUS_LABEL[v.status] || v.status}</span></Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 text-[11px]">
        <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500 flex items-center gap-1"><Cpu className="h-3 w-3" />CPU</p><p className="font-mono text-zinc-200 mt-0.5">{v.spec.cpu} vCPU</p></div>
        <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500 flex items-center gap-1"><MemoryStick className="h-3 w-3" />RAM</p><p className="font-mono text-zinc-200 mt-0.5">{fmtMB(v.spec.ramMb)}</p></div>
        <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500 flex items-center gap-1"><HardDrive className="h-3 w-3" />Disk</p><p className="font-mono text-zinc-200 mt-0.5">{v.spec.diskGb} GB</p></div>
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-zinc-500 min-w-0"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{v.node?.location || 'Unknown'} · {v.imageLabel}</span></span>
        <span className={`flex items-center gap-1 font-mono shrink-0 ${expired ? 'text-red-400' : tl.urgent ? 'text-amber-400' : 'text-zinc-500'}`}><Clock className="h-3 w-3" />{expired ? 'Renew now' : tl.text}</span>
      </div>
    </button>
  );
};

export const VpsList: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const [list, setList] = useState<VpsView[] | null>(null); const [settings, setSettings] = useState<VpsSettingsPublic | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => { try { const d = await vpsCall<{ vps: VpsView[]; settings: VpsSettingsPublic }>('/'); setList(d.vps); setSettings(d.settings); setErr(''); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { load(); const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 8000); return () => window.clearInterval(t); }, [load]);
  if (err && !list) return <Card><Empty icon={<AlertTriangle className="h-10 w-10" />} title="Could not load your VPS" text={err} action={<Btn variant="primary" onClick={load}>Retry</Btn>} /></Card>;
  if (!list) return <Spinner label="Loading your VPS…" />;
  const expired = list.filter(v => v.status === 'expired');
  return (
    <div className="space-y-4">
      <Card className="!p-5 sm:!p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2"><Cloud className="h-6 w-6 text-amber-400" />My VPS</h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1.5">Full root access, SSH, a browser terminal and a file manager. Pick a VPS to manage it.</p>
          </div>
          {settings?.enabled !== false && <Btn variant="primary" onClick={() => onNavigate('vps-deploy')}><Plus className="h-3.5 w-3.5" />Deploy a VPS</Btn>}
        </div>
      </Card>
      {settings?.announcement && <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-200">{settings.announcement}</div>}
      {expired.length > 0 && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200 flex items-start gap-2.5"><AlertTriangle className="h-4 w-4 shrink-0 mt-px" /><span><b>{expired.length} VPS{expired.length > 1 ? 'es have' : ' has'} expired.</b> Open {expired.length > 1 ? 'them' : 'it'} and renew before {expired.length > 1 ? 'they are' : 'it is'} deleted.</span></div>}
      {!list.length
        ? <Card><Empty icon={<Cloud className="h-10 w-10" />} title="No VPS yet" text="Deploy a VPS and it is online in under a minute." action={<Btn variant="primary" onClick={() => onNavigate('vps-deploy')}>Deploy a VPS</Btn>} /></Card>
        : <div className="grid gap-3 sm:grid-cols-2">{list.map(v => <VpsCard key={v.id} v={v} onOpen={() => onNavigate('vps-server', { id: v.id })} />)}</div>}
    </div>
  );
};
