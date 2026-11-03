import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, Clock, FolderOpen, KeyRound, MapPin, Play, RefreshCw, RotateCw, Settings, Skull, Square, Terminal, Wifi, Wallet, LayoutDashboard } from 'lucide-react';
import { Badge, Btn, Card, Empty, Modal, Spinner, cx, fmtDate, fmtMB, money, timeLeft, useToast } from '../../components/ui/kit';
import { ConfirmModal, StatusDot } from '../../components/ui/panelKit';
import { STATUS_LABEL, VpsDetail, vpsCall, vpsTone } from './vpsApi';
import { OverviewTab } from './tabs/OverviewTab';
import { ConsoleTab } from './tabs/ConsoleTab';
import { FilesTab } from './tabs/FilesTab';
import { SshTab } from './tabs/SshTab';
import { ActivityTab } from './tabs/ActivityTab';
import { SettingsTab } from './tabs/SettingsTab';

type Tab = 'overview' | 'console' | 'files' | 'ssh' | 'activity' | 'settings';

export const VpsServer: React.FC<{ id: string; onNavigate: (p: string, params?: any) => void }> = ({ id, onNavigate }) => {
  const [toast, say] = useToast();
  const [d, setD] = useState<VpsDetail | null>(null); const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>(() => (['overview', 'console', 'files', 'ssh', 'activity', 'settings'].includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'overview'));
  const [busy, setBusy] = useState(''); const [killAsk, setKillAsk] = useState(false); const [renew, setRenew] = useState(false); const [renewBusy, setRenewBusy] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    try { const r = await vpsCall<VpsDetail>(`/${id}`); if (alive.current) { setD(r); setErr(''); } }
    catch (e: any) { if (alive.current) setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { if (renew) vpsCall<{ credits: number }>('/catalog').then(c => setCredits(c.credits)).catch(() => undefined); }, [renew]);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', `#${t}`); };

  if (err && !d) return <Card><Empty icon={<AlertTriangle className="h-10 w-10" />} title="VPS unavailable" text={err} action={<Btn variant="primary" onClick={() => onNavigate('vps-list')}>Back to My VPS</Btn>} /></Card>;
  if (!d) return <Spinner label="Loading VPS…" />;
  const { vps, settings, plan } = d;
  const running = vps.status === 'running'; const blocked = vps.suspended || vps.status === 'installing'; const tl = timeLeft(vps.expiresAt); const expired = vps.status === 'expired';
  const power = async (action: string) => {
    setBusy(action);
    try { await vpsCall(`/${id}/power`, { method: 'POST', body: { action } }); say('success', `${action[0].toUpperCase()}${action.slice(1)} sent.`); await load(); }
    catch (e: any) { say('error', e.message); } finally { setBusy(''); }
  };
  const doRenew = async () => {
    setRenewBusy(true);
    try { await vpsCall(`/${id}/renew`, { method: 'POST' }); say('success', 'VPS renewed.'); setRenew(false); await load(); }
    catch (e: any) { say('error', e.message); } finally { setRenewBusy(false); }
  };

  const tabs = ([
    { id: 'overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard, group: 0, show: true },
    { id: 'console', label: 'Terminal & Logs', short: 'Terminal', icon: Terminal, group: 0, show: true },
    { id: 'files', label: 'File Manager', short: 'Files', icon: FolderOpen, group: 0, show: settings.allowFileManager },
    { id: 'ssh', label: 'SSH Access', short: 'SSH', icon: KeyRound, group: 0, show: true },
    { id: 'activity', label: 'Activity', short: 'Activity', icon: Activity, group: 0, show: true },
    { id: 'settings', label: 'Settings', short: 'Settings', icon: Settings, group: 1, show: true },
  ] as { id: Tab; label: string; short: string; icon: any; group: number; show: boolean }[]).filter(t => t.show);
  const activeTab: Tab = tabs.some(t => t.id === tab) ? tab : 'overview';
  const sym = settings.currencySymbol;

  return (
    <div className="space-y-4">
      {toast}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-zinc-500">
        <button onClick={() => onNavigate('vps-list')} className="flex items-center gap-1.5 hover:text-zinc-200"><ArrowLeft className="h-3.5 w-3.5" />My VPS</button><span className="text-zinc-700">/</span><span className="text-zinc-300 font-semibold truncate">{vps.name}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-600 hidden sm:block">ID: {vps.id.slice(0, 8)}</span>
      </nav>

      <Card className="relative overflow-hidden space-y-4">
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white truncate flex items-center gap-2.5 flex-wrap">{vps.name}
              <Badge tone={vpsTone(vps.status)}><StatusDot tone={vpsTone(vps.status)} pulse={vps.status === 'installing'} /><span className="ml-1.5 uppercase">{STATUS_LABEL[vps.status] || vps.status}</span></Badge></h1>
            <p className="text-xs text-zinc-400 mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap"><span>{vps.imageLabel}</span><span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{vps.node?.location || 'Unknown'}</span>
              <span className="font-mono">{vps.spec.cpu} vCPU · {fmtMB(vps.spec.ramMb)} RAM · {vps.spec.diskGb} GB disk</span></p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Btn size="sm" variant="success" busy={busy === 'start'} disabled={blocked || running} onClick={() => power('start')}><Play className="h-3.5 w-3.5" />Start</Btn>
            <Btn size="sm" busy={busy === 'restart'} disabled={blocked} onClick={() => power('restart')}><RotateCw className="h-3.5 w-3.5" />Restart</Btn>
            <Btn size="sm" busy={busy === 'stop'} disabled={blocked || !running} onClick={() => power('stop')}><Square className="h-3.5 w-3.5" />Stop</Btn>
            <Btn size="sm" variant="danger" busy={busy === 'kill'} disabled={blocked || !running} onClick={() => setKillAsk(true)}><Skull className="h-3.5 w-3.5" />Kill</Btn>
          </div>
        </div>

        <div className="relative grid sm:grid-cols-2 gap-2.5 text-xs">
          <div className="rounded-xl bg-zinc-950/90 border border-zinc-800 px-3.5 py-2.5"><p className="text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-1"><Wifi className="h-3 w-3" />SSH address</p><p className="font-mono text-zinc-200 mt-0.5 truncate">{vps.host ? `root@${vps.host} -p ${vps.sshPort}` : 'Not assigned'}</p></div>
          <div className={cx('rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2', expired ? 'bg-red-500/10 border-red-500/30' : tl.urgent ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-950/90 border-zinc-800')}>
            <div><p className="text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-1"><Clock className="h-3 w-3" />Expires</p><p className={cx('font-mono mt-0.5', expired ? 'text-red-300' : tl.urgent ? 'text-amber-300' : 'text-zinc-200')}>{fmtDate(vps.expiresAt)} · {tl.text}</p></div>
            {settings.allowRenewal && plan.periodDays > 0 && <Btn size="sm" variant={expired || tl.urgent ? 'primary' : 'dark'} onClick={() => setRenew(true)}><RefreshCw className="h-3.5 w-3.5" />Renew</Btn>}
          </div>
        </div>

        {settings.announcement && <div className="relative rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200">{settings.announcement}</div>}
        {expired && <div className="relative rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><span>Expired {fmtDate(vps.expiredAt)}. The VPS is stopped. Renew it to bring it back online; expired VPSes are eventually deleted.</span></div>}
        {vps.suspended && !expired && <div className="relative rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200">This VPS is suspended{vps.suspendReason ? `: ${vps.suspendReason}` : ''}. Contact support for details.</div>}
        {vps.status === 'installing' && <div className="relative rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200">Your VPS is being installed. This page updates automatically.</div>}
        {vps.lastError && <div className="relative rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200"><b>Problem:</b> {vps.lastError}</div>}
        {!vps.nodeOnline && !blocked && <div className="relative rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-200">The host node is not responding right now, so live stats and controls are unavailable. {vps.nodeError}</div>}
      </Card>

      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
        <aside className="hidden lg:block sticky top-36 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-2.5" aria-label="VPS navigation">
          {[0, 1].map(g => (
            <div key={g} className={g ? 'mt-3 pt-3 border-t border-zinc-800' : ''}>
              <p className="px-3 pb-1.5 pt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">{g === 0 ? 'Management' : 'Configuration'}</p>
              {tabs.filter(t => t.group === g).map(t => { const I = t.icon; const on = activeTab === t.id; return (
                <button key={t.id} onClick={() => go(t.id)} aria-current={on ? 'page' : undefined} className={cx('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left', on ? 'bg-amber-500/10 text-amber-300' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100')}><I className="h-4 w-4 shrink-0" />{t.label}</button>); })}
            </div>))}
        </aside>
        <div className="lg:hidden -mx-4 sm:mx-0 border-y sm:border sm:rounded-2xl border-zinc-800 bg-zinc-900/60 overflow-x-auto no-scrollbar sticky top-[8.25rem] z-20 backdrop-blur" role="tablist">
          <div className="flex min-w-max">{tabs.map(t => { const I = t.icon; const on = activeTab === t.id; return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => go(t.id)} className={cx('flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors', on ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-200')}><I className="h-3.5 w-3.5" />{t.short}</button>); })}</div>
        </div>
        <main className="min-w-0 lg:col-start-2 lg:row-start-1">
          {activeTab === 'overview' && <OverviewTab d={d} running={running} />}
          {activeTab === 'console' && <ConsoleTab id={id} running={running} blocked={blocked} allowTerminal={settings.allowTerminal} />}
          {activeTab === 'files' && <FilesTab id={id} running={running} blocked={blocked} notify={say} />}
          {activeTab === 'ssh' && <SshTab id={id} blocked={blocked} allowSshx={settings.allowSshx} notify={say} />}
          {activeTab === 'activity' && <ActivityTab id={id} />}
          {activeTab === 'settings' && <SettingsTab d={d} blocked={blocked} notify={say} reload={load} onNavigate={onNavigate} />}
        </main>
      </div>

      <ConfirmModal open={killAsk} title="Force-kill the VPS?" confirmLabel="Kill VPS" danger onClose={() => setKillAsk(false)} onConfirm={() => { setKillAsk(false); power('kill'); }}>Everything is stopped immediately. Unsaved data may be lost.</ConfirmModal>
      <Modal open={renew} onClose={() => setRenew(false)} title="Renew VPS" footer={<><Btn onClick={() => setRenew(false)}>Cancel</Btn><Btn variant="primary" busy={renewBusy} disabled={credits !== null && credits < plan.price} onClick={doRenew}>Pay {money(plan.price, sym)} & renew</Btn></>}>
        <div className="space-y-3 text-sm text-zinc-300">
          <p>Extend <b className="text-white">{vps.name}</b> by <b className="text-white">{plan.periodDays} days</b> ({plan.name}). The time is added to what is left{expired ? '; the VPS starts again right after payment' : ''}.</p>
          <p className="flex items-center gap-2 text-xs text-zinc-400"><Wallet className="h-4 w-4" />Account credits: <b className={credits !== null && credits < plan.price ? 'text-red-400' : 'text-white'}>{credits === null ? '…' : money(credits, sym)}</b>
            {credits !== null && credits < plan.price && <button className="text-amber-400 hover:underline" onClick={() => onNavigate('billing')}>Add credits</button>}</p>
        </div>
      </Modal>
    </div>
  );
};
