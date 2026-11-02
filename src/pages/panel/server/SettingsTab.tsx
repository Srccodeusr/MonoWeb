import React, { useEffect, useState } from 'react';
import { Server as ServerIcon, Trash2, Image as ImageIcon, Network, Pencil, Repeat, RotateCw, Save, AlertTriangle, Crown } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { PanelServer } from '../../../components/panel/PanelContext';
import { Badge, Btn, Card, Field, Select, Spinner, TextInput, Toggle, cx, fmtDate } from '../../../components/ui/kit';
import { Checkbox, ConfirmModal, TabHeader } from '../../../components/ui/panelKit';
import { MoveCard } from './MoveCard';

interface Meta { serverId: string; node: { name: string; location: string } | null; backgroundUrl: string; imageId: string; eggs: { id: string; name: string; software: string; category: string; minRamMB: number }[] }
type Notify = (t: 'success' | 'error', m: string) => void;

const Section: React.FC<{ icon: React.ReactNode; title: string; badge?: React.ReactNode; tone?: 'danger'; children: React.ReactNode }> = ({ icon, title, badge, tone, children }) => (
  <Card className={cx('space-y-4', tone === 'danger' && 'border-red-500/20')}>
    <h3 className="text-base font-bold text-white flex items-center gap-2.5"><span className={tone === 'danger' ? 'text-red-400' : 'text-amber-400'}>{icon}</span>{title}{badge}</h3>
    {children}
  </Card>
);

export const SettingsTab: React.FC<{ server: PanelServer; owner: boolean; canEdit: boolean; onNavigate: (p: string, params?: any) => void; refresh: () => Promise<void>; reload: () => void; onBackground: (url: string) => void; notify: Notify }> =
  ({ server, owner, canEdit, onNavigate, refresh, reload, onBackground, notify }) => {
    const id = server.id;
    const [meta, setMeta] = useState<Meta | null>(null);
    const [bg, setBg] = useState('');
    const [name, setName] = useState(server.name); const [desc, setDesc] = useState(server.description);
    const [egg, setEgg] = useState(''); const [eggReinstall, setEggReinstall] = useState(false);
    const [busy, setBusy] = useState('');
    const [dlg, setDlg] = useState<null | 'delete' | 'reinstall' | 'egg'>(null);
    const [wipe, setWipe] = useState(false);

    useEffect(() => { apiRequest<Meta>(`/hosting/servers/${id}/meta`).then(r => { if (r.success && r.data) { setMeta(r.data); setBg(r.data.backgroundUrl); setEgg(r.data.imageId); } }); }, [id]);
    if (!meta) return <Spinner />;

    const run = async (key: string, fn: () => Promise<any>, ok: string, after?: () => void) => {
      setBusy(key); const r = await fn(); setBusy('');
      if (r.success) { if (ok) notify('success', ok); after?.(); return true; }
      notify('error', r.error?.message || 'Something went wrong.'); return false;
    };
    const api = (path: string, method: string, body?: unknown) => apiRequest(`/hosting/servers/${id}${path}`, { method, body: body ? JSON.stringify(body) : undefined });
    const eggChanged = !!egg && egg !== meta.imageId;
    const busyInstall = server.status === 'installing';

    return (
      <div className="space-y-5">
        <TabHeader title="Server Settings" subtitle="Configure and manage your server settings" />

        <Section icon={<ServerIcon className="h-5 w-5" />} title="Server Information">
          <dl className="text-sm divide-y divide-zinc-800/70">
            <div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-zinc-400">Node</dt><dd className="font-mono text-zinc-100 text-xs">{meta.node?.name || '—'}{meta.node?.location ? <span className="text-zinc-600"> · {meta.node.location}</span> : null}</dd></div>
            <div className="flex items-center justify-between gap-4 py-2.5"><dt className="text-zinc-400">Server ID</dt><dd className="font-mono text-zinc-100 text-xs break-all text-right">{meta.serverId}</dd></div>
          </dl>
        </Section>

        {owner && <Section icon={<Trash2 className="h-5 w-5" />} title="Delete Server" tone="danger">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200 flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />Danger: This action cannot be undone. All data will be permanently lost.</div>
          <p className="text-xs text-zinc-400">Deleting your server will shut down all processes, return resources to your account, and delete all files, backups, databases, and settings associated with this server.</p>
          <div className="flex justify-end"><Btn variant="danger" onClick={() => setDlg('delete')}><Trash2 className="h-3.5 w-3.5" />Delete Server</Btn></div>
        </Section>}

        {canEdit && <Section icon={<ImageIcon className="h-5 w-5" />} title="Change Server Background">
          <Field label="Background image URL"><TextInput value={bg} onChange={e => setBg(e.target.value)} placeholder="https://example.com/image.jpg" inputMode="url" maxLength={500} /></Field>
          <div className="flex justify-end gap-2">
            {meta.backgroundUrl && <Btn onClick={() => run('bgx', () => api('/background', 'PUT', { url: '' }), 'Background removed', () => { setBg(''); setMeta({ ...meta, backgroundUrl: '' }); onBackground(''); })}>Remove</Btn>}
            <Btn busy={busy === 'bg'} disabled={bg.trim() === meta.backgroundUrl} onClick={() => run('bg', () => api('/background', 'PUT', { url: bg.trim() }), 'Background saved', () => { setMeta({ ...meta, backgroundUrl: bg.trim() }); onBackground(bg.trim()); })}><Save className="h-3.5 w-3.5" />Save Background</Btn>
          </div>
        </Section>}

        {owner && <div className="space-y-3">
          <h3 className="text-base font-bold text-white flex items-center gap-2.5"><span className="text-amber-400"><Network className="h-5 w-5" /></span>Switch Node<Badge tone="amber" className="!text-amber-300"><Crown className="h-3 w-3 mr-1" />Premium</Badge></h3>
          <MoveCard serverId={id} status={server.status} onUpgrade={() => onNavigate('upgrade')} onDone={() => { refresh(); reload(); }} notify={notify} />
        </div>}

        {canEdit && <Section icon={<Pencil className="h-5 w-5" />} title="Change Server Details">
          <Field label="Server name"><TextInput value={name} maxLength={60} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Server description"><TextInput value={desc} maxLength={191} onChange={e => setDesc(e.target.value)} /></Field>
          <div className="flex justify-end"><Btn busy={busy === 'det'} disabled={!name.trim() || (name === server.name && desc === server.description)} onClick={() => run('det', () => api('', 'PATCH', { name: name.trim(), description: desc }), 'Server details saved', () => { refresh(); reload(); })}>Save Changes</Btn></div>
        </Section>}

        {owner && <Section icon={<Repeat className="h-5 w-5" />} title="Change Server Egg">
          <p className="text-xs text-zinc-400">Changing your server’s software updates its startup configuration and Docker image. You can optionally reinstall the server, which will wipe all current files. <b className="text-zinc-200">This action cannot be undone.</b></p>
          <Field label="Target egg"><Select value={egg} onChange={e => setEgg(e.target.value)} aria-label="Target egg">{meta.eggs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"><Toggle checked={eggReinstall} onChange={setEggReinstall} label="Reinstall Server" hint="Warning: This may delete files on your server!" /></div>
          <div className="flex justify-end"><Btn variant="primary" disabled={!eggChanged || busyInstall} onClick={() => setDlg('egg')}>Update Egg Configuration</Btn></div>
        </Section>}

        {canEdit && <Section icon={<RotateCw className="h-5 w-5" />} title="Reinstall Server" tone="danger">
          <p className="text-xs text-zinc-400">Stops the server and runs the installation script again. Your files are kept unless you choose to wipe them, but the install script may overwrite some of them.</p>
          <div className="flex justify-end"><Btn variant="danger" disabled={busyInstall} onClick={() => { setWipe(false); setDlg('reinstall'); }}><RotateCw className="h-3.5 w-3.5" />Reinstall Server</Btn></div>
        </Section>}

        <Card className="space-y-2">
          <h3 className="text-sm font-bold text-white">Network</h3>
          {server.ports.map(p => <p key={p.host} className="text-xs font-mono text-zinc-300">{p.label || 'Port'}: <span className="text-amber-300">{server.address}:{p.host}</span></p>)}
          {server.upgrades.length > 0 && <div className="pt-2 border-t border-zinc-800 space-y-1"><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Active upgrades</p>{server.upgrades.map(u => <p key={u.id} className="text-xs text-zinc-400">+{u.ramMB ? `${u.ramMB} MB RAM ` : ''}{u.cpuPercent ? `+${u.cpuPercent}% CPU ` : ''}{u.diskMB ? `+${u.diskMB} MB disk` : ''} · {u.until ? `until ${fmtDate(u.until)}` : 'permanent'}</p>)}</div>}
        </Card>

        <ConfirmModal open={dlg === 'delete'} title="Delete this server?" confirmLabel="Delete forever" danger busy={busy === 'del'} onClose={() => setDlg(null)}
          onConfirm={() => run('del', () => api('', 'DELETE'), '', async () => { await refresh(); onNavigate('servers'); })}>
          <b className="text-white">{server.name}</b> and all of its files, backups and databases will be removed immediately. This cannot be undone.
        </ConfirmModal>
        <ConfirmModal open={dlg === 'reinstall'} title="Reinstall server?" confirmLabel="Reinstall" danger busy={busy === 'rei'} onClose={() => setDlg(null)}
          onConfirm={async () => { if (await run('rei', () => api('/reinstall', 'POST', { wipe }), 'Reinstalling… the server will start again when it finishes.', () => { setDlg(null); reload(); refresh(); })) setDlg(null); }}>
          <p>The server will be stopped and its install script will run again.</p>
          <label className="flex items-center gap-2.5 mt-4 text-xs text-zinc-300 cursor-pointer"><Checkbox checked={wipe} onChange={setWipe} label="Wipe all files first" />Wipe all files first <span className="text-red-400">(cannot be undone)</span></label>
        </ConfirmModal>
        <ConfirmModal open={dlg === 'egg'} title="Change server software?" confirmLabel="Update egg" danger={eggReinstall} busy={busy === 'egg'} onClose={() => setDlg(null)}
          onConfirm={async () => { if (await run('egg', () => api('/egg', 'POST', { imageId: egg, reinstall: eggReinstall }), eggReinstall ? 'Software changed. Reinstalling…' : 'Software changed. Restart the server to apply it.', () => { setMeta({ ...meta, imageId: egg }); reload(); refresh(); })) setDlg(null); }}>
          {eggReinstall ? <>The server will be reinstalled with <b className="text-white">{meta.eggs.find(x => x.id === egg)?.name}</b> and <b className="text-red-400">all current files will be wiped</b>.</> : <>The server will use <b className="text-white">{meta.eggs.find(x => x.id === egg)?.name}</b> the next time it starts. Your files are not touched, but they may not work with the new software.</>}
        </ConfirmModal>
      </div>
    );
  };
