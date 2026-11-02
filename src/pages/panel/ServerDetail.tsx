import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Play, Square, RotateCw, Skull, Terminal, FolderOpen, Archive, Settings, CalendarClock, Package, Users, Clock, Copy, RefreshCw, MapPin, AlertTriangle, Rocket, Activity, Database, SlidersHorizontal, Wifi } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePanel, PanelServer } from '../../components/panel/PanelContext';
import { RenewModal } from '../../components/panel/RenewModal';
import { AdBanner } from '../../components/AdBanner';
import { Badge, Btn, Card, Spinner, cx, fmtDate, fmtMB, statusTone, timeLeft, useToast } from '../../components/ui/kit';
import { ConfirmModal, StatusDot } from '../../components/ui/panelKit';
import { TeamTab } from './server/TeamTab';
import { SchedulesTab } from './server/SchedulesTab';
import { AddonsPanel } from './server/AddonsPanel';
import { ConsoleTab } from './server/ConsoleTab';
import { FilesTab } from './server/FilesTab';
import { BackupsTab } from './server/BackupsTab';
import { ActivityTab } from './server/ActivityTab';
import { DatabasesTab } from './server/DatabasesTab';
import { StartupTab } from './server/StartupTab';
import { SettingsTab } from './server/SettingsTab';

type Tab = 'console' | 'activity' | 'files' | 'databases' | 'schedules' | 'team' | 'backups' | 'startup' | 'settings' | 'addons';

export const ServerDetail: React.FC<{ id: string; onNavigate: (p: string, params?: any) => void }> = ({ id, onNavigate }) => {
  const { data: panel, refresh } = usePanel();
  const [toast, say] = useToast();
  const [server, setServer] = useState<PanelServer | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('console');
  const [busy, setBusy] = useState('');
  const [renew, setRenew] = useState(false);
  const [killAsk, setKillAsk] = useState(false);
  const [bg, setBg] = useState('');

  const load = useCallback(async () => {
    const r = await apiRequest<PanelServer>(`/hosting/servers/${id}`);
    if (r.success && r.data) setServer(r.data); else if (r.error?.code === 'NOT_FOUND') setMissing(true);
  }, [id]);
  useEffect(() => { load(); const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { apiRequest<{ backgroundUrl: string }>(`/hosting/servers/${id}/meta`).then(r => { if (r.success && r.data) setBg(r.data.backgroundUrl); }); }, [id]);

  if (missing) return <Card className="text-center py-12"><p className="text-sm text-zinc-300">Server not found.</p><Btn className="mt-4" onClick={() => onNavigate('servers')}>Back to servers</Btn></Card>;
  if (!server) return <Spinner />;

  const owner = server.role === 'owner';
  const has = (p: string) => owner || server.permissions.includes(p);
  const usable = !['expired', 'suspended', 'transferring'].includes(server.status);
  const running = server.status === 'running' || server.status === 'starting';
  const tl = timeLeft(server.expiresAt);
  const primary = server.ports[0];

  const power = async (action: string) => {
    setBusy(action);
    const r = await apiRequest(`/hosting/servers/${id}/power`, { method: 'POST', body: JSON.stringify({ action }) });
    setBusy(''); if (!r.success) say('error', r.error?.message || 'Power action failed.'); await load();
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('success', 'Copied'));

  const tabs = ([
    { id: 'console', label: 'Console', short: 'Console', icon: Terminal, group: 0, show: has('console.read') },
    { id: 'activity', label: 'Activity', short: 'Activity', icon: Activity, group: 0, show: has('settings') },
    { id: 'files', label: 'File Manager', short: 'Files', icon: FolderOpen, group: 0, show: has('files.read') },
    { id: 'databases', label: 'Databases', short: 'Databases', icon: Database, group: 0, show: has('settings') },
    { id: 'schedules', label: 'Tasks', short: 'Tasks', icon: CalendarClock, group: 0, show: has('schedules') },
    { id: 'team', label: 'Users', short: 'Users', icon: Users, group: 0, show: owner },
    { id: 'backups', label: 'Backups', short: 'Backups', icon: Archive, group: 0, show: has('backups') },
    { id: 'startup', label: 'Startup', short: 'Startup', icon: SlidersHorizontal, group: 1, show: has('settings') },
    { id: 'settings', label: 'Settings', short: 'Settings', icon: Settings, group: 1, show: has('settings') || owner },
    { id: 'addons', label: 'Addons', short: 'Addons', icon: Package, group: 1, show: has('addons') },
  ] as { id: Tab; label: string; short: string; icon: any; group: number; show: boolean }[]).filter(t => t.show);
  const activeTab: Tab = tabs.some(t => t.id === tab) ? tab : (tabs[0]?.id || 'console');
  const upgrade = () => onNavigate('upgrade');

  return (
    <div className="space-y-4">
      {toast}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-zinc-500">
        <button onClick={() => onNavigate('servers')} className="flex items-center gap-1.5 hover:text-zinc-200"><ArrowLeft className="h-3.5 w-3.5" />Servers</button><span className="text-zinc-700">/</span><span className="text-zinc-300 font-semibold truncate">{server.name}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-600 hidden sm:block">ID: {server.id.slice(0, 8)}</span>
      </nav>

      <Card className="relative overflow-hidden space-y-4">
        {bg && <><img src={bg} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover opacity-30 pointer-events-none" onError={e => { e.currentTarget.style.display = 'none'; }} /><div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/70 to-zinc-950/30 pointer-events-none" /></>}
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white truncate flex items-center gap-2.5 flex-wrap">{server.name}<Badge tone={statusTone(server.status)}><StatusDot tone={statusTone(server.status)} pulse={server.status === 'starting' || server.status === 'installing'} /><span className="ml-1.5 uppercase">{server.status.replace('_', ' ')}</span></Badge>{!owner && <Badge tone="blue">Shared with you</Badge>}</h1>
            <p className="text-xs text-zinc-400 mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap"><span>{server.image?.name}</span><span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{server.location}</span><span className="font-mono">{fmtMB(server.limits.ramMB)} RAM · {server.limits.cpuPercent}% CPU · {fmtMB(server.limits.diskMB)} disk</span></p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Btn size="sm" variant="success" busy={busy === 'start'} disabled={!usable || !has('power') || running || server.status === 'installing'} onClick={() => power('start')}><Play className="h-3.5 w-3.5" />Start</Btn>
            <Btn size="sm" busy={busy === 'restart'} disabled={!usable || !has('power') || server.status === 'installing'} onClick={() => power('restart')}><RotateCw className="h-3.5 w-3.5" />Restart</Btn>
            <Btn size="sm" busy={busy === 'stop'} disabled={!running || !has('power')} onClick={() => power('stop')}><Square className="h-3.5 w-3.5" />Stop</Btn>
            <Btn size="sm" variant="danger" busy={busy === 'kill'} disabled={!running || !has('power')} onClick={() => setKillAsk(true)}><Skull className="h-3.5 w-3.5" />Kill</Btn>
          </div>
        </div>

        <div className="relative grid sm:grid-cols-2 gap-2.5 text-xs">
          {primary && (
            <div className="rounded-xl bg-zinc-950/90 border border-zinc-800 px-3.5 py-2.5 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-1"><Wifi className="h-3 w-3" />Address</p><p className="font-mono text-zinc-200 truncate">{server.address}:{primary.host}</p></div><button onClick={() => copy(`${server.address}:${primary.host}`)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500" aria-label="Copy address"><Copy className="h-3.5 w-3.5" /></button></div>
          )}
          <div className={cx('rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2', server.status === 'expired' ? 'bg-red-500/10 border-red-500/30' : tl.urgent ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-950/90 border-zinc-800')}>
            <div><p className="text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-1"><Clock className="h-3 w-3" />Expires</p><p className={cx('font-mono', server.status === 'expired' ? 'text-red-300' : tl.urgent ? 'text-amber-300' : 'text-zinc-200')}>{server.expiresAt ? `${fmtDate(server.expiresAt)} · ${tl.text}` : 'Never'}</p></div>
            {server.expiresAt && owner && <Btn size="sm" variant={server.status === 'expired' || tl.urgent ? 'primary' : 'dark'} onClick={() => setRenew(true)}><RefreshCw className="h-3.5 w-3.5" />Renew</Btn>}
          </div>
        </div>

        {server.status === 'expired' && <div className="relative rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><span>Expired {fmtDate(server.expiredAt)}. This server is deleted automatically 24 hours after expiry unless you renew.</span></div>}
        {server.status === 'transferring' && <div className="relative rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200"><b>Moving to another node…</b> {server.transfer?.step}</div>}
        {server.status === 'suspended' && <div className="relative rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200">This server is suspended. Contact support for details.</div>}
        {server.status === 'installing' && <div className="relative rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200 flex gap-2 items-start"><Rocket className="h-4 w-4 shrink-0 mt-px animate-pulse" /><div className="min-w-0"><b>Installing…</b> the server starts automatically when this finishes.{server.installLog?.length ? <pre className="mt-2 text-[10px] font-mono text-sky-300/80 max-h-24 overflow-y-auto whitespace-pre-wrap">{server.installLog.slice(-8).join('\n')}</pre> : null}</div></div>}
        {server.status === 'install_failed' && <div className="relative rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200"><b>Installation failed.</b>{server.installLog?.length ? <pre className="mt-2 text-[10px] font-mono text-red-300/80 whitespace-pre-wrap">{server.installLog.slice(-6).join('\n')}</pre> : null} Open Settings and choose Reinstall Server, or contact support.</div>}
      </Card>

      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
        {/* Desktop: management sidebar */}
        <aside className="hidden lg:block sticky top-36 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-2.5" aria-label="Server navigation">
          {[0, 1].map(g => (
            <div key={g} className={g ? 'mt-3 pt-3 border-t border-zinc-800' : ''}>
              <p className="px-3 pb-1.5 pt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">{g === 0 ? 'Management' : 'Configuration'}</p>
              {tabs.filter(t => t.group === g).map(t => { const I = t.icon; const on = activeTab === t.id; return (
                <button key={t.id} onClick={() => setTab(t.id)} aria-current={on ? 'page' : undefined} className={cx('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left', on ? 'bg-amber-500/10 text-amber-300 border border-amber-500/25 font-semibold' : 'border border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900')}><I className="h-4 w-4 shrink-0" />{t.label}</button>); })}
            </div>))}
        </aside>

        {/* Mobile / tablet: horizontal tab strip */}
        <div className="lg:hidden -mx-4 sm:mx-0 border-y sm:border sm:rounded-2xl border-zinc-800 bg-zinc-900/60 overflow-x-auto no-scrollbar sticky top-[8.25rem] z-20 backdrop-blur" role="tablist">
          <div className="flex min-w-max">
            {tabs.map(t => { const I = t.icon; const on = activeTab === t.id; return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)} className={cx('flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors', on ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-200')}><I className="h-3.5 w-3.5" />{t.short}</button>); })}
          </div>
        </div>

        <main className="min-w-0 lg:col-start-2 lg:row-start-1">
          {activeTab === 'console' && <ConsoleTab server={server} running={running} canSend={usable && has('console.command')} />}
          {activeTab === 'activity' && <ActivityTab serverId={id} notify={say} />}
          {activeTab === 'files' && <FilesTab serverId={id} writable={usable && has('files.write')} notify={say} onUpgrade={upgrade} />}
          {activeTab === 'databases' && <DatabasesTab serverId={id} onUpgrade={upgrade} notify={say} />}
          {activeTab === 'schedules' && <SchedulesTab serverId={id} onUpgrade={upgrade} notify={say} />}
          {activeTab === 'team' && <TeamTab serverId={id} onUpgrade={upgrade} notify={say} />}
          {activeTab === 'backups' && <BackupsTab serverId={id} writable={usable} onUpgrade={upgrade} notify={say} />}
          {activeTab === 'startup' && <StartupTab serverId={id} canEdit={usable && has('settings')} notify={say} onSaved={load} />}
          {activeTab === 'settings' && <SettingsTab server={server} owner={owner} canEdit={has('settings')} onNavigate={onNavigate} refresh={refresh} reload={load} onBackground={setBg} notify={say} />}
          {activeTab === 'addons' && <AddonsPanel serverId={id} notify={say} />}
        </main>
      </div>

      {!panel?.plan.noAds && <AdBanner placement="console" />}
      <RenewModal server={server} open={renew} onClose={() => setRenew(false)} onNavigate={onNavigate} notify={say} />
      <ConfirmModal open={killAsk} title="Force-kill the server?" confirmLabel="Kill process" danger onClose={() => setKillAsk(false)} onConfirm={() => { setKillAsk(false); power('kill'); }}>The process is stopped immediately. Unsaved data may be lost.</ConfirmModal>
    </div>
  );
};
