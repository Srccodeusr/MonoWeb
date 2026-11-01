import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Play, Square, RotateCw, Skull, Terminal, FolderOpen, Archive, Settings, CalendarClock, Package, Users, Clock, Copy, RefreshCw, Trash2, MapPin, AlertTriangle, Rocket } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePanel, PanelServer } from '../../components/panel/PanelContext';
import { RenewModal } from '../../components/panel/RenewModal';
import { AdBanner } from '../../components/AdBanner';
import { Badge, Btn, Card, Field, Spinner, TextInput, cx, fmtDate, fmtMB, statusTone, timeLeft, useToast } from '../../components/ui/kit';
import { TeamTab } from './server/TeamTab';
import { SchedulesTab } from './server/SchedulesTab';
import { AddonsPanel } from './server/AddonsPanel';
import { SftpCard } from './server/SftpCard';
import { MoveCard } from './server/MoveCard';
import { ConsoleTab } from './server/ConsoleTab';
import { FilesTab } from './server/FilesTab';
import { BackupsTab } from './server/BackupsTab';

type Tab = 'console' | 'files' | 'backups' | 'schedules' | 'addons' | 'team' | 'settings';

export const ServerDetail: React.FC<{ id: string; onNavigate: (p: string, params?: any) => void }> = ({ id, onNavigate }) => {
  const { data: panel, refresh } = usePanel();
  const [toast, say] = useToast();
  const [server, setServer] = useState<PanelServer | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('console');
  const [busy, setBusy] = useState('');
  const [renew, setRenew] = useState(false);
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [vars, setVars] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await apiRequest<PanelServer>(`/hosting/servers/${id}`);
    if (r.success && r.data) setServer(r.data); else if (r.error?.code === 'NOT_FOUND') setMissing(true);
  }, [id]);
  useEffect(() => { load(); const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 5000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { if (server && !name) { setName(server.name); setDesc(server.description); setVars(Object.fromEntries(server.variables.map(v => [v.env, v.value]))); } }, [server]);

  if (missing) return <Card className="text-center py-12"><p className="text-sm text-zinc-300">Server not found.</p><Btn className="mt-4" onClick={() => onNavigate('servers')}>Back to servers</Btn></Card>;
  if (!server) return <Spinner />;

  const owner = server.role === 'owner';
  const has = (p: string) => owner || server.permissions.includes(p);
  const usable = !['expired', 'suspended', 'transferring'].includes(server.status);
  const running = server.status === 'running' || server.status === 'starting';
  const tl = timeLeft(server.expiresAt);
  const sym = panel?.currencySymbol || '$';
  void sym;
  const primary = server.ports[0];

  const power = async (action: string) => {
    setBusy(action);
    const r = await apiRequest(`/hosting/servers/${id}/power`, { method: 'POST', body: JSON.stringify({ action }) });
    setBusy(''); if (!r.success) say('error', r.error?.message || 'Power action failed.'); await load();
  };
  const saveSettings = async () => {
    setBusy('save');
    const r = await apiRequest(`/hosting/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ name, description: desc, variables: vars }) });
    setBusy(''); if (r.success) { say('success', 'Settings saved. Restart the server to apply variable changes.'); refresh(); load(); } else say('error', r.error?.message || 'Could not save.');
  };
  const del = async () => {
    if (!window.confirm(`Permanently delete “${server.name}” and all its files? This cannot be undone.`)) return;
    setBusy('del'); const r = await apiRequest(`/hosting/servers/${id}`, { method: 'DELETE' }); setBusy('');
    if (r.success) { await refresh(); onNavigate('servers'); } else say('error', r.error?.message || 'Delete failed.');
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('success', 'Copied'));

  const tabs = ([
    { id: 'console', label: 'Console', icon: Terminal, show: has('console.read') },
    { id: 'files', label: 'Files', icon: FolderOpen, show: has('files.read') },
    { id: 'backups', label: 'Backups', icon: Archive, show: has('backups') },
    { id: 'schedules', label: 'Schedules', icon: CalendarClock, show: has('schedules') },
    { id: 'addons', label: 'Addons', icon: Package, show: has('addons') },
    { id: 'team', label: 'Team', icon: Users, show: owner },
    { id: 'settings', label: 'Settings', icon: Settings, show: has('settings') || has('sftp') || owner },
  ] as { id: Tab; label: string; icon: any; show: boolean }[]).filter(t => t.show);
  const activeTab: Tab = tabs.some(t => t.id === tab) ? tab : (tabs[0]?.id || 'console');

  return (
    <div className="space-y-4">
      {toast}
      <button onClick={() => onNavigate('servers')} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200"><ArrowLeft className="h-3.5 w-3.5" />All servers</button>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-white truncate flex items-center gap-2">{server.name}<Badge tone={statusTone(server.status)}>{server.status.replace('_', ' ')}</Badge>{!owner && <Badge tone="blue">Shared with you</Badge>}</h1>
            <p className="text-xs text-zinc-500 mt-1 flex items-center gap-3 flex-wrap"><span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{server.location}</span><span>{server.image?.name}</span><span>{fmtMB(server.limits.ramMB)} · {server.limits.cpuPercent}% CPU · {fmtMB(server.limits.diskMB)}</span></p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Btn size="sm" variant="success" busy={busy === 'start'} disabled={!usable || !has('power') || running || server.status === 'installing'} onClick={() => power('start')}><Play className="h-3.5 w-3.5" />Start</Btn>
            <Btn size="sm" busy={busy === 'restart'} disabled={!usable || !has('power') || server.status === 'installing'} onClick={() => power('restart')}><RotateCw className="h-3.5 w-3.5" />Restart</Btn>
            <Btn size="sm" busy={busy === 'stop'} disabled={!running || !has('power')} onClick={() => power('stop')}><Square className="h-3.5 w-3.5" />Stop</Btn>
            <Btn size="sm" variant="danger" busy={busy === 'kill'} disabled={!running || !has('power')} onClick={() => window.confirm('Force-kill the process? Unsaved data may be lost.') && power('kill')}><Skull className="h-3.5 w-3.5" />Kill</Btn>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-2.5 text-xs">
          {primary && (
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-mono text-zinc-500 uppercase">Address</p><p className="font-mono text-zinc-200 truncate">{server.address}:{primary.host}</p></div><button onClick={() => copy(`${server.address}:${primary.host}`)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500" aria-label="Copy address"><Copy className="h-3.5 w-3.5" /></button></div>
          )}
          <div className={cx('rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2', server.status === 'expired' ? 'bg-red-500/10 border-red-500/30' : tl.urgent ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-950 border-zinc-800')}>
            <div><p className="text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-1"><Clock className="h-3 w-3" />Expires</p><p className={cx('font-mono', server.status === 'expired' ? 'text-red-300' : tl.urgent ? 'text-amber-300' : 'text-zinc-200')}>{server.expiresAt ? `${fmtDate(server.expiresAt)} · ${tl.text}` : 'Never'}</p></div>
            {server.expiresAt && owner && <Btn size="sm" variant={server.status === 'expired' || tl.urgent ? 'primary' : 'dark'} onClick={() => setRenew(true)}><RefreshCw className="h-3.5 w-3.5" />Renew</Btn>}
          </div>
        </div>

        {server.status === 'expired' && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><span>Expired {fmtDate(server.expiredAt)}. This server is deleted automatically 24 hours after expiry unless you renew.</span></div>}
        {server.status === 'transferring' && <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200"><b>Moving to another node…</b> {server.transfer?.step}</div>}
        {server.status === 'suspended' && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200">This server is suspended. Contact support for details.</div>}
        {server.status === 'installing' && <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-2.5 text-xs text-sky-200 flex gap-2 items-start"><Rocket className="h-4 w-4 shrink-0 mt-px animate-pulse" /><div className="min-w-0"><b>Installing…</b> the server starts automatically when this finishes.{server.installLog?.length ? <pre className="mt-2 text-[10px] font-mono text-sky-300/80 max-h-24 overflow-y-auto whitespace-pre-wrap">{server.installLog.slice(-8).join('\n')}</pre> : null}</div></div>}
        {server.status === 'install_failed' && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-2.5 text-xs text-red-200"><b>Installation failed.</b>{server.installLog?.length ? <pre className="mt-2 text-[10px] font-mono text-red-300/80 whitespace-pre-wrap">{server.installLog.slice(-6).join('\n')}</pre> : null} Delete this server and try again, or contact support.</div>}
      </Card>

      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto no-scrollbar">
        {tabs.map(t => { const I = t.icon; return <button key={t.id} onClick={() => setTab(t.id)} className={cx('flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap', activeTab === t.id ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500 hover:text-zinc-200')}><I className="h-3.5 w-3.5" />{t.label}</button>; })}
      </div>

      {activeTab === 'console' && <ConsoleTab serverId={id} running={running} canSend={usable && has('console.command')} cpuLimit={server.limits.cpuPercent} />}
      {activeTab === 'files' && <FilesTab serverId={id} writable={usable && has('files.write')} notify={say} />}
      {activeTab === 'backups' && <BackupsTab serverId={id} writable={usable} onUpgrade={() => onNavigate('upgrade')} notify={say} />}
      {activeTab === 'schedules' && <SchedulesTab serverId={id} onUpgrade={() => onNavigate('upgrade')} notify={say} />}
      {activeTab === 'addons' && <AddonsPanel serverId={id} notify={say} />}
      {activeTab === 'team' && <TeamTab serverId={id} onUpgrade={() => onNavigate('upgrade')} notify={say} />}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {has('settings') && <Card className="space-y-4">
            <h2 className="text-sm font-bold text-white">General</h2>
            <Field label="Server name"><TextInput value={name} maxLength={60} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Description"><TextInput value={desc} maxLength={191} onChange={e => setDesc(e.target.value)} /></Field>
            {server.variables.map(v => <Field key={v.env} label={v.name} hint={v.description}><TextInput className="font-mono text-xs" value={vars[v.env] ?? ''} onChange={e => setVars(p => ({ ...p, [v.env]: e.target.value }))} /></Field>)}
            <div className="flex justify-end"><Btn variant="primary" busy={busy === 'save'} onClick={saveSettings}>Save changes</Btn></div>
          </Card>}
          {has('sftp') && <SftpCard serverId={id} onUpgrade={() => onNavigate('upgrade')} notify={say} />}
          {owner && <MoveCard serverId={id} status={server.status} onUpgrade={() => onNavigate('upgrade')} onDone={() => { refresh(); load(); }} notify={say} />}
          <Card className="space-y-2">
            <h2 className="text-sm font-bold text-white">Network</h2>
            {server.ports.map(p => <p key={p.host} className="text-xs font-mono text-zinc-300">{p.label || 'Port'}: <span className="text-amber-300">{server.address}:{p.host}</span></p>)}
          </Card>
          {server.upgrades.length > 0 && <Card><h2 className="text-sm font-bold text-white mb-2">Active upgrades</h2>{server.upgrades.map(u => <p key={u.id} className="text-xs text-zinc-400">+{u.ramMB ? `${u.ramMB} MB RAM ` : ''}{u.cpuPercent ? `+${u.cpuPercent}% CPU ` : ''}{u.diskMB ? `+${u.diskMB} MB disk` : ''} · {u.until ? `until ${fmtDate(u.until)}` : 'permanent'}</p>)}</Card>}
          {owner && <Card className="border-red-500/20 space-y-3"><h2 className="text-sm font-bold text-red-300">Danger zone</h2><p className="text-xs text-zinc-500">Deleting a server removes all of its files and backups immediately.</p><Btn variant="danger" busy={busy === 'del'} onClick={del}><Trash2 className="h-3.5 w-3.5" />Delete server</Btn></Card>}
        </div>
      )}
      {!panel?.plan.noAds && <AdBanner placement="console" />}
      <RenewModal server={server} open={renew} onClose={() => setRenew(false)} onNavigate={onNavigate} notify={say} />
    </div>
  );
};
