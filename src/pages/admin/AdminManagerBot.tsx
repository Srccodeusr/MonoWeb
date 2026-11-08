import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, ExternalLink, Network, Play, Plus, RefreshCw, Save, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextArea, TextInput, Toggle, fmtDate, useToast } from '../../components/ui/kit';
import { ConfirmModal, ago } from '../../components/ui/panelKit';
import { apiRequest } from '../../lib/api';
import type { BotStatusCode, ManagerBotActivity, ManagerBotBan, ManagerBotConfigView, ManagerBotNodeView, ManagerBotStatus } from '../../botTypes';

interface Overview { config: ManagerBotConfigView; status: ManagerBotStatus; nodes: ManagerBotNodeView[]; bans: ManagerBotBan[]; activity: ManagerBotActivity[]; configured: boolean }
interface Check { token: string; botTag?: string; applicationId?: string; clientIdMatches?: boolean; secret: string; message: string }
interface NodeSecret { name: string; secret: string; installCommand: string; configureCommand: string }

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await apiRequest<T>(`/admin/manager-bot${path}`, { method: opts.method || 'GET', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (!r.success) throw new Error(r.error?.message || 'Request failed.');
  return r.data as T;
}

const TONE: Record<BotStatusCode, 'green' | 'amber' | 'red' | 'zinc' | 'blue'> = { ONLINE: 'green', STARTING: 'blue', ERROR: 'red', STOPPED: 'zinc', NOT_CONFIGURED: 'amber' };
const LABEL: Record<BotStatusCode, string> = { ONLINE: 'Online', STARTING: 'Starting', ERROR: 'Error', STOPPED: 'Stopped', NOT_CONFIGURED: 'Not configured' };
const lines = (v: string): string[] => v.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
const blankNode = { name: '', location: '', daemonHost: '', daemonPort: 3100, scheme: 'http', publicHost: '', maxVps: 20, portMin: 42000, portMax: 42999, ramMb: 0, diskGb: 0, cpus: 0, overallocatePercent: 0, notes: '' };

type Tab = 'connection' | 'settings' | 'nodes' | 'bans' | 'activity';

export const AdminManagerBot: React.FC = () => {
  const [toast, say] = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>('connection');
  const [form, setForm] = useState<any>(null);               // config being edited + credential inputs
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [nodeForm, setNodeForm] = useState<any>(null);
  const [reveal, setReveal] = useState<NodeSecret | null>(null);
  const [removeNode, setRemoveNode] = useState<ManagerBotNodeView | null>(null);
  const [available, setAvailable] = useState<{ id: string; name: string; location: string }[]>([]);
  const [pick, setPick] = useState('');
  const [banId, setBanId] = useState(''); const [banReason, setBanReason] = useState('');

  const adopt = useCallback((d: Overview, keepForm = false) => {
    setData(d);
    if (!keepForm) setForm({ ...d.config, botToken: '', clientSecret: '', ownerText: d.config.ownerIds.join('\n'), adminText: d.config.adminRoleIds.join('\n'), staffText: d.config.staffRoleIds.join('\n') });
  }, []);
  const load = useCallback(async (keepForm = true) => { try { adopt(await call<Overview>(''), keepForm); } catch (e: any) { say('error', e.message); } }, [adopt, say]);
  const loadAvailable = useCallback(async () => { try { setAvailable((await call<any>('/nodes')).available); } catch { /* shown elsewhere */ } }, []);
  useEffect(() => { load(false); loadAvailable(); }, [load, loadAvailable]);
  useEffect(() => { const t = window.setInterval(() => load(true), 8000); return () => window.clearInterval(t); }, [load]);

  if (!data || !form) return <Spinner />;
  const st = data.status; const cfg = data.config;
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e: any) { say('error', e.message); } finally { setBusy(''); } };

  const body = () => ({
    botToken: form.botToken, clientSecret: form.clientSecret, clientId: form.clientId, enabled: form.enabled, botName: form.botName, prefix: form.prefix, enablePrefix: form.enablePrefix,
    accentColor: form.accentColor, statusText: form.statusText, guildId: form.guildId, logChannelId: form.logChannelId, features: form.features,
    ownerIds: lines(form.ownerText), adminRoleIds: lines(form.adminText), staffRoleIds: lines(form.staffText),
  });
  const save = () => run('save', async () => { adopt(await call<Overview>('', { method: 'PUT', body: body() })); say('success', 'Saved. Restart the bot to apply name, prefix and command changes.'); });
  const start = () => run('start', async () => {
    await call<Overview>('', { method: 'PUT', body: body() });
    try { adopt(await call<Overview>('/start', { method: 'POST' })); say('success', 'The bot is online and its commands are registered.'); }
    catch (e: any) { await load(false); throw e; }
  });
  const stop = () => run('stop', async () => { adopt(await call<Overview>('/stop', { method: 'POST' }), true); say('success', 'Bot stopped.'); });
  const verify = () => run('check', async () => { await call<Overview>('', { method: 'PUT', body: body() }); setCheck(await call<Check>('/check', { method: 'POST' })); await load(false); });
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('success', 'Copied.'));

  const toggleNode = (id: string, enabled: boolean) => run('node', async () => { await call('/nodes/' + id + '/toggle', { method: 'POST', body: { enabled } }); await load(true); await loadAvailable(); });
  const createNode = () => run('node', async () => {
    const r = await call<any>('/nodes', { method: 'POST', body: nodeForm }); setReveal({ name: nodeForm.name, secret: r.secret, installCommand: r.installCommand, configureCommand: r.configureCommand });
    setNodeForm(null); await load(true); await loadAvailable();
  });
  const ban = () => run('ban', async () => { adopt(await call<Overview>('/bans', { method: 'POST', body: { discordId: banId, reason: banReason } }), true); setBanId(''); setBanReason(''); });
  const unban = (id: string) => run('ban', async () => { adopt(await call<Overview>(`/bans/${id}`, { method: 'DELETE' }), true); });

  const tabs: { id: Tab; label: string }[] = [{ id: 'connection', label: 'Connection' }, { id: 'settings', label: 'Settings' }, { id: 'nodes', label: `Nodes (${data.nodes.length})` }, { id: 'bans', label: `Bans (${data.bans.length})` }, { id: 'activity', label: 'Activity' }];
  const running = st.status === 'ONLINE' || st.status === 'STARTING';

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Bot className="h-6 w-6 text-indigo-400" />} title="Discord Manager Bot" subtitle="One bot for VPS and hosting. Enter its credentials here and the website logs it in, loads every command and keeps it running."
        actions={<><Badge tone={TONE[st.status]}>{LABEL[st.status]}</Badge>{running
          ? <><Btn busy={busy === 'start'} onClick={start}><RefreshCw className="h-3.5 w-3.5" />Restart</Btn><Btn variant="danger" busy={busy === 'stop'} onClick={stop}><Square className="h-3.5 w-3.5" />Stop</Btn></>
          : <Btn variant="primary" busy={busy === 'start'} onClick={start}><Play className="h-3.5 w-3.5" />Save and start bot</Btn>}</>} />

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-800">
        {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`px-3.5 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? 'border-amber-400 text-amber-400' : 'border-transparent text-zinc-400 hover:text-white'}`}>{t.label}</button>)}
      </div>

      {tab === 'connection' && <>
        <div className="grid gap-4 lg:grid-cols-3">
          {[['Bot account', st.botTag || '—'], ['Servers', st.status === 'ONLINE' ? String(st.guilds) : '—'], ['Commands loaded', String(st.commands)], ['Latency', st.pingMs !== null ? `${st.pingMs} ms` : '—'], ['Online since', st.startedAt ? ago(st.startedAt) : '—'], ['Commands run', String(st.commandsRun)]].map(([l, v]) =>
            <Card key={l} className="!p-4"><p className="text-[11px] text-zinc-500">{l}</p><p className="text-sm font-semibold text-white mt-0.5 break-all">{v}</p></Card>)}
        </div>
        {st.lastError && <Card className="!p-4 border-red-500/30"><p className="text-xs text-red-300">{st.lastError}</p></Card>}
        {st.warnings.map((w, i) => <Card key={i} className="!p-4 border-amber-500/30"><p className="text-xs text-amber-300">{w}</p></Card>)}

        <Card className="!p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Credentials</h3>
          <p className="text-xs text-zinc-400">From the Discord Developer Portal. Token and secret are stored encrypted and never sent back to the browser. Leave a field untouched to keep the saved value.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Bot token" hint={cfg.botTokenSet ? `Saved: ${cfg.botTokenMasked}` : 'Bot page > Reset Token'}><TextInput type="password" autoComplete="off" value={form.botToken} onChange={e => set('botToken', e.target.value)} placeholder={cfg.botTokenSet ? cfg.botTokenMasked : 'Paste the bot token'} /></Field>
            <Field label="Client ID" hint="General Information > Application ID"><TextInput value={form.clientId} onChange={e => set('clientId', e.target.value)} placeholder="123456789012345678" /></Field>
            <Field label="Client secret" hint={cfg.clientSecretSet ? `Saved: ${cfg.clientSecretMasked}${cfg.clientSecretCheck === 'verified' ? ' (verified)' : cfg.clientSecretCheck === 'rejected' ? ' (rejected by Discord)' : ''}` : 'OAuth2 > Client Secret'}><TextInput type="password" autoComplete="off" value={form.clientSecret} onChange={e => set('clientSecret', e.target.value)} placeholder={cfg.clientSecretSet ? cfg.clientSecretMasked : 'Paste the client secret'} /></Field>
            <div className="self-end"><Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Start automatically with the website" hint="Also set by Start / Stop." /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" busy={busy === 'save'} onClick={save}><Save className="h-3.5 w-3.5" />Save credentials</Btn>
            <Btn busy={busy === 'check'} onClick={verify}><ShieldCheck className="h-3.5 w-3.5" />Check credentials</Btn>
            {st.inviteUrl && <a href={st.inviteUrl} target="_blank" rel="noreferrer"><Btn><ExternalLink className="h-3.5 w-3.5" />Invite bot to a server</Btn></a>}
          </div>
          {check && <p className={`text-xs ${check.token === 'ok' && check.secret !== 'rejected' && check.clientIdMatches !== false ? 'text-emerald-300' : 'text-amber-300'}`}>{check.message}{check.secret === 'verified' ? ' Client secret verified.' : ''}</p>}
        </Card>
        <Card className="!p-5 text-xs text-zinc-400 space-y-1.5">
          <h3 className="text-sm font-bold text-white">What happens when you start it</h3>
          <p>1. The website logs the bot in with this token and loads all {st.commands || 'VPS, hosting and admin'} commands.</p>
          <p>2. Slash commands are registered in Discord{cfg.guildId ? ' for your test server (instant)' : ' globally (can take up to an hour to appear)'}.</p>
          <p>3. VPS nodes marked "Discord bot node" are handed to the bot automatically. Members buy and manage services with their linked website account.</p>
        </Card>
      </>}

      {tab === 'settings' && <>
        <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Identity</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Bot name" hint="Shown in every message"><TextInput value={form.botName} onChange={e => set('botName', e.target.value)} /></Field>
            <Field label="Accent colour"><div className="flex gap-2"><input type="color" value={form.accentColor} onChange={e => set('accentColor', e.target.value)} className="h-10 w-12 rounded bg-zinc-900 border border-zinc-800" /><TextInput value={form.accentColor} onChange={e => set('accentColor', e.target.value)} /></div></Field>
            <Field label="Status text" hint="Shown as &quot;Watching ...&quot;"><TextInput value={form.statusText} onChange={e => set('statusText', e.target.value)} /></Field>
            <Field label="Test server ID" hint="Register slash commands only here (instant). Blank = global."><TextInput value={form.guildId} onChange={e => set('guildId', e.target.value)} /></Field>
            <Field label="Log channel ID" hint="Node and staff events are posted here"><TextInput value={form.logChannelId} onChange={e => set('logChannelId', e.target.value)} /></Field>
          </div>
        </Card>
        <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Commands</h3>
          <Toggle checked={form.enablePrefix} onChange={v => set('enablePrefix', v)} label="Prefix commands" hint="Needs the Message Content Intent enabled in the developer portal. If it is not, the bot starts without it and says so." />
          {form.enablePrefix && <Field label="Prefix"><TextInput value={form.prefix} onChange={e => set('prefix', e.target.value)} className="max-w-[120px]" /></Field>}
          <Toggle checked={form.features.vps} onChange={v => set('features', { ...form.features, vps: v })} label="VPS commands" hint="/vps plans, create, manage, power, ssh, renew, reinstall, exec, logs ..." />
          <Toggle checked={form.features.hosting} onChange={v => set('features', { ...form.features, hosting: v })} label="Hosting commands" hint="/hosting plans, create, list, info, power, renew, upgrade, delete" />
        </Card>
        <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Who can do what</h3>
          <p className="text-xs text-zinc-400">Website admins (linked to Discord) are staff, admin or owner automatically by their website role. These lists add Discord-side access. One ID per line.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Owner user IDs"><TextArea value={form.ownerText} onChange={e => set('ownerText', e.target.value)} /></Field>
            <Field label="Admin role IDs"><TextArea value={form.adminText} onChange={e => set('adminText', e.target.value)} /></Field>
            <Field label="Staff role IDs"><TextArea value={form.staffText} onChange={e => set('staffText', e.target.value)} /></Field>
          </div>
        </Card>
        <div className="flex gap-2"><Btn variant="primary" busy={busy === 'save'} onClick={save}><Save className="h-3.5 w-3.5" />Save settings</Btn>{running && <Btn busy={busy === 'start'} onClick={start}><RefreshCw className="h-3.5 w-3.5" />Save and restart</Btn>}</div>
      </>}

      {tab === 'nodes' && <>
        <Card className="!p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold text-white">Bot nodes</h3><p className="text-xs text-zinc-400 mt-0.5 max-w-xl">VPSes bought in Discord are placed only on these nodes. A node added here or marked "Discord bot node" in VPS Nodes is added to the bot automatically. Nodes cannot be added from Discord.</p></div>
            <Btn variant="primary" onClick={() => setNodeForm({ ...blankNode })}><Plus className="h-3.5 w-3.5" />Add node</Btn>
          </div>
          {!!available.length && <div className="flex flex-wrap gap-2 items-end pt-2 border-t border-zinc-800">
            <Field label="Use an existing VPS node" className="min-w-[240px]"><Select value={pick} onChange={e => setPick(e.target.value)}><option value="">Choose a node...</option>{available.map(n => <option key={n.id} value={n.id}>{n.name} ({n.location})</option>)}</Select></Field>
            <Btn disabled={!pick} busy={busy === 'node'} onClick={() => { toggleNode(pick, true); setPick(''); }}>Add to bot</Btn>
          </div>}
        </Card>
        {!data.nodes.length ? <Card><Empty icon={<Network className="h-10 w-10" />} title="No bot nodes yet" text="Add a node and run the install command on the machine, or switch an existing node over." /></Card> : (
          <div className="grid gap-4 lg:grid-cols-2">{data.nodes.map(n => (
            <Card key={n.id} className="!p-5 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">{n.name}<Badge tone={n.online ? 'green' : 'red'}>{n.online ? 'Online' : 'Offline'}</Badge>{!n.enabled && <Badge tone="amber">Draining</Badge>}</p>
                  <p className="text-[11px] text-zinc-500 font-mono mt-0.5">{n.location} · {n.publicHost}</p></div>
                <Btn size="sm" variant="danger" onClick={() => setRemoveNode(n)}><Trash2 className="h-3.5 w-3.5" />Remove from bot</Btn>
              </div>
              <p className="text-[11px] text-zinc-400">{n.vpsCount}{n.maxVps ? ` / ${n.maxVps}` : ''} VPS · added to the bot {n.addedAt ? ago(n.addedAt) : 'just now'}</p>
              {n.error && <p className="text-xs text-red-300/90">{n.error}</p>}
            </Card>))}</div>)}
      </>}

      {tab === 'bans' && <>
        <Card className="!p-5 space-y-3"><h3 className="text-sm font-bold text-white">Block a member from the bot</h3>
          <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-3 items-end">
            <Field label="Discord user ID"><TextInput value={banId} onChange={e => setBanId(e.target.value)} placeholder="123456789012345678" /></Field>
            <Field label="Reason"><TextInput value={banReason} onChange={e => setBanReason(e.target.value)} /></Field>
            <Btn variant="danger" disabled={!banId} busy={busy === 'ban'} onClick={ban}>Ban</Btn>
          </div>
          <p className="text-[11px] text-zinc-500">Only stops them using the bot. Their website account and services are untouched.</p>
        </Card>
        {!data.bans.length ? <Card><Empty title="No bans" text="Nobody is blocked from the bot." /></Card> : <Card className="!p-0 divide-y divide-zinc-800">{data.bans.map(b => (
          <div key={b.discordId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><p className="text-sm text-white font-mono">{b.discordId}{b.userEmail ? <span className="text-zinc-500 font-sans"> · {b.userEmail}</span> : null}</p><p className="text-[11px] text-zinc-500">{b.reason} · by {b.by} · {ago(b.at)}</p></div>
            <Btn size="sm" onClick={() => unban(b.discordId)}>Unban</Btn>
          </div>))}</Card>}
      </>}

      {tab === 'activity' && (!data.activity.length ? <Card><Empty title="No activity yet" text="Bot starts, node changes, purchases and staff actions appear here." /></Card> : <Card className="!p-0 divide-y divide-zinc-800">{data.activity.map(a => (
        <div key={a.id} className="flex items-start gap-3 px-4 py-2.5"><Badge tone="zinc" className="shrink-0">{a.kind}</Badge><p className="text-xs text-zinc-200 flex-1 min-w-0 break-words">{a.text}</p><span className="text-[10px] text-zinc-500 shrink-0" title={fmtDate(a.at)}>{ago(a.at)}</span></div>))}</Card>)}

      <Modal open={!!nodeForm} onClose={() => setNodeForm(null)} title="Add a bot node" wide footer={<><Btn onClick={() => setNodeForm(null)}>Cancel</Btn><Btn variant="primary" busy={busy === 'node'} onClick={createNode}>Create and add to bot</Btn></>}>
        {nodeForm && <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name"><TextInput value={nodeForm.name} onChange={e => setNodeForm({ ...nodeForm, name: e.target.value })} placeholder="vps-fra-1" /></Field>
          <Field label="Location" hint="Members pick this in /vps create"><TextInput value={nodeForm.location} onChange={e => setNodeForm({ ...nodeForm, location: e.target.value })} placeholder="Frankfurt" /></Field>
          <Field label="Daemon address"><TextInput value={nodeForm.daemonHost} onChange={e => setNodeForm({ ...nodeForm, daemonHost: e.target.value })} placeholder="203.0.113.10" /></Field>
          <Field label="Daemon port"><NumInput value={nodeForm.daemonPort} onChange={v => setNodeForm({ ...nodeForm, daemonPort: v })} min={1} max={65535} /></Field>
          <Field label="Public address" hint="What members SSH to. Blank = daemon address"><TextInput value={nodeForm.publicHost} onChange={e => setNodeForm({ ...nodeForm, publicHost: e.target.value })} /></Field>
          <Field label="Max VPSes" hint="0 = unlimited"><NumInput value={nodeForm.maxVps} onChange={v => setNodeForm({ ...nodeForm, maxVps: v })} min={0} /></Field>
          <Field label="SSH port from"><NumInput value={nodeForm.portMin} onChange={v => setNodeForm({ ...nodeForm, portMin: v })} min={1024} max={65535} /></Field>
          <Field label="SSH port to"><NumInput value={nodeForm.portMax} onChange={v => setNodeForm({ ...nodeForm, portMax: v })} min={1024} max={65535} /></Field>
          <p className="sm:col-span-2 text-[11px] text-zinc-500">More options (RAM, disk and CPU ceilings, https) are in Admin &gt; VPS Nodes. The node shows up there too.</p>
        </div>}
      </Modal>
      <Modal open={!!reveal} onClose={() => setReveal(null)} title={`Install the daemon on ${reveal?.name}`} wide footer={<Btn variant="primary" onClick={() => setReveal(null)}>Done</Btn>}>
        {reveal && <div className="space-y-3 text-xs text-zinc-300">
          <p className="text-amber-300">The node is already in the bot. The secret is shown once: run one of these on the machine, from the <code>vps-daemon</code> folder.</p>
          {[['Installer (Debian/Ubuntu, systemd)', reveal.installCommand], ['Manual', reveal.configureCommand]].map(([l, c]) => <div key={l}><p className="text-zinc-500 mb-1">{l}</p><div className="flex gap-2 items-start rounded-xl border border-zinc-800 bg-zinc-950 p-3"><code className="flex-1 break-all text-[11px] text-emerald-300">{c}</code><button onClick={() => copy(c)} className="text-zinc-400 hover:text-white" aria-label="Copy"><Copy className="h-4 w-4" /></button></div></div>)}
        </div>}
      </Modal>
      <ConfirmModal open={!!removeNode} title="Remove node from the bot?" confirmLabel="Remove from bot" danger onClose={() => setRemoveNode(null)} onConfirm={() => { if (removeNode) toggleNode(removeNode.id, false); setRemoveNode(null); }}>
        {removeNode?.name} stays in Admin &gt; VPS Nodes and keeps its VPSes. It just stops receiving new VPSes bought in Discord.
      </ConfirmModal>
    </div>
  );
};
