import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CalendarPlus, Eye, HardDrive, KeyRound, Play, Plus, RefreshCw, RotateCw, Search, Skull, Square, Trash2, UserCog, Maximize2, CheckCircle2 } from 'lucide-react';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, fmtDate, fmtMB, timeLeft, useToast } from '../../components/ui/kit';
import { ConfirmModal, PromptModal, ago } from '../../components/ui/panelKit';
import { VpsEvent, VpsOrder, VpsOsImage, VpsPlan, VpsView } from '../../vpsTypes';
import { STATUS_LABEL, adminVps, vpsTone } from '../vps/vpsApi';

type Row = VpsView & { owner: { id: string; email: string; username: string } | null; nodeId: string; nodeName: string; adminNote: string; diskEnforced: boolean };
type Detail = Row & { live: { status: string; stats: { cpuPct: number; ramUsedMb: number; diskUsedMb: number }; nodeOnline: boolean; nodeError: string | null }; events: VpsEvent[]; orders: VpsOrder[] };
type Act = null | 'suspend' | 'extend' | 'resize' | 'owner' | 'delete' | 'reinstall' | 'reset' | 'note';

export const AdminVpsServers: React.FC = () => {
  const [toast, say] = useToast(); const [rows, setRows] = useState<Row[] | null>(null); const [search, setSearch] = useState(''); const [status, setStatus] = useState('');
  const [sel, setSel] = useState<Detail | null>(null); const [act, setAct] = useState<Act>(null); const [busy, setBusy] = useState(false); const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [create, setCreate] = useState<any>(null); const [meta, setMeta] = useState<{ plans: VpsPlan[]; images: VpsOsImage[]; nodes: { id: string; name: string }[] } | null>(null);
  const [f, setF] = useState<any>({});

  const load = useCallback(async () => {
    try { const q = new URLSearchParams(); if (search) q.set('search', search); if (status) q.set('status', status); setRows(await adminVps<Row[]>(`/servers?${q}`)); } catch (e: any) { say('error', e.message); }
  }, [search, status, say]);
  useEffect(() => { const t = window.setTimeout(load, 250); return () => window.clearTimeout(t); }, [load]);
  const open = async (id: string) => { try { setSel(await adminVps<Detail>(`/servers/${id}`)); } catch (e: any) { say('error', e.message); } };
  const refresh = async () => { if (sel) await open(sel.id); load(); };
  const run = async (fn: () => Promise<any>, ok: string, closeAct = true) => { setBusy(true); try { const r = await fn(); say('success', ok); if (closeAct) setAct(null); await refresh(); return r; } catch (e: any) { say('error', e.message); } finally { setBusy(false); } };
  const post = (p: string, body?: any) => adminVps(`/servers/${sel!.id}${p}`, { method: 'POST', body });
  const openCreate = async () => {
    setCreate({ email: '', planId: '', image: '', nodeId: '', name: '', days: 30 });
    if (!meta) { try { const [p, n] = await Promise.all([adminVps<any>('/plans'), adminVps<any[]>('/nodes')]); setMeta({ plans: p.plans, images: p.images, nodes: n.map(x => ({ id: x.id, name: x.name })) }); } catch (e: any) { say('error', e.message); } }
  };
  const submitCreate = async () => { setBusy(true); try { await adminVps('/servers', { method: 'POST', body: create }); say('success', 'VPS created.'); setCreate(null); load(); } catch (e: any) { say('error', e.message); } finally { setBusy(false); } };
  const s = sel;

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<HardDrive className="h-6 w-6 text-amber-400" />} title="VPS Servers" subtitle="Every customer VPS. Open one to manage power, term, resources, access and ownership."
        actions={<><Btn size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Btn><Btn variant="primary" onClick={openCreate}><Plus className="h-3.5 w-3.5" />Create VPS</Btn></>} />
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]"><Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" /><TextInput className="!pl-9" placeholder="Search name, owner email, node, id…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select className="!w-44" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['running', 'offline', 'installing', 'suspended', 'expired', 'error'].map(x => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</Select>
      </div>
      {!rows ? <Spinner /> : !rows.length ? <Card><Empty icon={<HardDrive className="h-10 w-10" />} title="No VPS found" /></Card> : (
        <Card className="!p-0 overflow-x-auto"><table className="w-full text-xs min-w-[760px]"><thead><tr className="text-left text-[10px] font-mono uppercase text-zinc-500 border-b border-zinc-800"><th className="px-4 py-3">VPS</th><th>Owner</th><th>Node</th><th>Specs</th><th>Expires</th><th>Status</th></tr></thead>
          <tbody className="divide-y divide-zinc-800/60">{rows.map(r => (
            <tr key={r.id} onClick={() => open(r.id)} className="cursor-pointer hover:bg-zinc-800/40">
              <td className="px-4 py-3"><p className="font-semibold text-zinc-100">{r.name}</p><p className="font-mono text-[10px] text-zinc-600">{r.id.slice(0, 8)} · {r.planName}</p></td>
              <td className="text-zinc-300">{r.owner?.email || '—'}</td><td className="text-zinc-400">{r.nodeName}</td>
              <td className="font-mono text-zinc-400">{r.spec.cpu}c · {fmtMB(r.spec.ramMb)} · {r.spec.diskGb}G</td><td className="text-zinc-400">{timeLeft(r.expiresAt).text}<span className="block text-[10px] text-zinc-600">{fmtDate(r.expiresAt)}</span></td>
              <td><Badge tone={vpsTone(r.status)}>{STATUS_LABEL[r.status] || r.status}</Badge></td></tr>))}</tbody></table></Card>)}

      <Modal open={!!s} onClose={() => setSel(null)} wide title={s ? `${s.name}` : ''} footer={<Btn onClick={() => setSel(null)}>Close</Btn>}>
        {s && <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={vpsTone(s.status)}>{STATUS_LABEL[s.status] || s.status}</Badge><span className="text-zinc-500 font-mono">{s.id}</span>{!s.diskEnforced && <Badge tone="amber">No disk quota</Badge>}</div>
          <div className="grid sm:grid-cols-2 gap-2">{([['Owner', s.owner?.email || '—'], ['Plan', s.planName], ['Node', `${s.nodeName} (${s.node?.location || '?'})`], ['Address', s.host ? `${s.host}:${s.sshPort}` : '—'], ['Image', s.imageLabel], ['Resources', `${s.spec.cpu} vCPU · ${fmtMB(s.spec.ramMb)} · ${s.spec.diskGb} GB`], ['Created', fmtDate(s.createdAt)], ['Expires', fmtDate(s.expiresAt)], ['Live usage', `${s.live.stats.cpuPct.toFixed(0)}% CPU · ${fmtMB(s.live.stats.ramUsedMb)} RAM`], ['Renewals', String(s.renewCount)]] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-zinc-800/60 pb-1.5"><span className="text-zinc-500">{k}</span><span className="text-zinc-200 text-right font-mono truncate">{v}</span></div>)}</div>
          {(s.lastError || s.live.nodeError) && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{s.lastError || s.live.nodeError}</p>}
          {s.suspended && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">Suspended: {s.suspendReason}</p>}
          {s.adminNote && <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-300 whitespace-pre-wrap">Note: {s.adminNote}</p>}
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" variant="success" onClick={() => run(() => post('/power', { action: 'start' }), 'Start sent.', false)}><Play className="h-3.5 w-3.5" />Start</Btn>
            <Btn size="sm" onClick={() => run(() => post('/power', { action: 'restart' }), 'Restart sent.', false)}><RotateCw className="h-3.5 w-3.5" />Restart</Btn>
            <Btn size="sm" onClick={() => run(() => post('/power', { action: 'stop' }), 'Stop sent.', false)}><Square className="h-3.5 w-3.5" />Stop</Btn>
            <Btn size="sm" variant="danger" onClick={() => run(() => post('/power', { action: 'kill' }), 'Kill sent.', false)}><Skull className="h-3.5 w-3.5" />Kill</Btn>
            <span className="w-px bg-zinc-800 mx-1" />
            {s.suspended ? <Btn size="sm" variant="success" onClick={() => run(() => post('/unsuspend', {}), 'Unsuspended.', false)}><CheckCircle2 className="h-3.5 w-3.5" />Unsuspend</Btn> : <Btn size="sm" variant="danger" onClick={() => { setF({ reason: '' }); setAct('suspend'); }}><Ban className="h-3.5 w-3.5" />Suspend</Btn>}
            <Btn size="sm" onClick={() => { setF({ days: 30 }); setAct('extend'); }}><CalendarPlus className="h-3.5 w-3.5" />Extend</Btn>
            <Btn size="sm" onClick={() => { setF({ cpu: s.spec.cpu, ramMb: s.spec.ramMb }); setAct('resize'); }}><Maximize2 className="h-3.5 w-3.5" />Resize</Btn>
            <Btn size="sm" onClick={() => { setF({ email: '' }); setAct('owner'); }}><UserCog className="h-3.5 w-3.5" />Transfer</Btn>
            <Btn size="sm" onClick={() => { setF({ note: s.adminNote }); setAct('note'); }}>Note</Btn>
            <Btn size="sm" onClick={async () => { try { const r = await post('/reveal-password') as any; setSecret({ title: 'Root password (audited)', value: r.password }); } catch (e: any) { say('error', e.message); } }}><Eye className="h-3.5 w-3.5" />Show password</Btn>
            <Btn size="sm" onClick={() => setAct('reset')}><KeyRound className="h-3.5 w-3.5" />Reset password</Btn>
            <Btn size="sm" onClick={() => { setF({ image: s.image }); setAct('reinstall'); }}><RefreshCw className="h-3.5 w-3.5" />Reinstall</Btn>
            {s.status === 'error' && <Btn size="sm" onClick={() => run(() => post('/clear-error'), 'Error cleared.', false)}>Clear error</Btn>}
            <Btn size="sm" variant="danger" className="ml-auto" onClick={() => setAct('delete')}><Trash2 className="h-3.5 w-3.5" />Delete</Btn>
          </div>
          <div><p className="font-semibold text-white mb-1.5">Recent activity</p>{!s.events.length ? <p className="text-zinc-500">None.</p> : <div className="max-h-44 overflow-y-auto space-y-1">{s.events.slice(0, 20).map(e => <p key={e.id} className="flex justify-between gap-3"><span className="text-zinc-300 truncate font-mono">{e.action.replace(/_/g, ' ')} <span className="text-zinc-600">{e.details} · {e.actor}</span></span><span className="text-zinc-600 shrink-0">{ago(e.createdAt)}</span></p>)}</div>}</div>
        </div>}
      </Modal>

      <PromptModal open={act === 'suspend'} title="Suspend VPS" label="Reason (shown to the customer)" placeholder="Abuse report #1234" confirmLabel="Suspend" busy={busy} onClose={() => setAct(null)} onSubmit={v => run(() => post('/suspend', { reason: v }), 'Suspended.')} />
      <PromptModal open={act === 'extend'} title="Extend term" label="Days to add" initial="30" type="number" confirmLabel="Extend" busy={busy} onClose={() => setAct(null)} onSubmit={v => run(() => post('/extend', { days: Number(v) }), 'Extended.')} />
      <PromptModal open={act === 'owner'} title="Transfer ownership" label="New owner email" confirmLabel="Transfer" busy={busy} onClose={() => setAct(null)} onSubmit={v => run(() => post('/transfer-owner', { email: v }), 'Owner changed.')} />
      <PromptModal open={act === 'note'} title="Staff note" label="Note (only staff see this)" initial={s?.adminNote || ''} confirmLabel="Save" busy={busy} onClose={() => setAct(null)} onSubmit={v => run(() => adminVps(`/servers/${s!.id}`, { method: 'PATCH', body: { adminNote: v } }), 'Saved.')} />
      <Modal open={act === 'resize'} onClose={() => setAct(null)} title="Resize CPU / RAM" footer={<><Btn onClick={() => setAct(null)}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={() => run(() => post('/resize', { cpu: f.cpu, ramMb: f.ramMb }), 'Resized live.')}>Apply</Btn></>}>
        <div className="grid grid-cols-2 gap-4"><Field label="vCPU"><NumInput value={f.cpu} onChange={v => setF({ ...f, cpu: v })} min={0.25} max={64} step={0.25} /></Field><Field label="RAM (MB)"><NumInput value={f.ramMb} onChange={v => setF({ ...f, ramMb: v })} min={256} step={256} /></Field></div>
        <p className="text-[11px] text-zinc-500 mt-3">Applied to the running container instantly. Disk size cannot be changed live.</p>
      </Modal>
      <Modal open={act === 'reinstall'} onClose={() => setAct(null)} title="Reinstall (erases all data)" footer={<><Btn onClick={() => setAct(null)}>Cancel</Btn><Btn variant="danger" busy={busy} onClick={() => run(() => post('/reinstall', { image: f.image }), 'Reinstalled.')}>Erase & reinstall</Btn></>}>
        <Field label="Image"><TextInput value={f.image || ''} onChange={e => setF({ ...f, image: e.target.value })} placeholder="ubuntu-22.04" /></Field><p className="text-[11px] text-zinc-500 mt-2">Use an image id from the OS Images page. The root password is reset.</p>
      </Modal>
      <ConfirmModal open={act === 'reset'} title="Reset root password?" confirmLabel="Reset" busy={busy} onClose={() => setAct(null)} onConfirm={async () => { setBusy(true); try { const r = await post('/reset-password') as any; setAct(null); setSecret({ title: 'New root password', value: r.password }); } catch (e: any) { say('error', e.message); } finally { setBusy(false); } }}>A new random password is set inside the VPS and stored for the customer.</ConfirmModal>
      <Modal open={act === 'delete'} onClose={() => setAct(null)} title="Delete VPS permanently" footer={<><Btn onClick={() => setAct(null)}>Cancel</Btn><Btn variant="danger" busy={busy} onClick={() => run(async () => { await adminVps(`/servers/${s!.id}${f.force ? '?force=1' : ''}`, { method: 'DELETE' }); setSel(null); }, 'VPS deleted.')}>Delete</Btn></>}>
        <p className="text-xs text-zinc-300">The container and all its data are destroyed and the customer is notified.</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={!!f.force} onChange={e => setF({ ...f, force: e.target.checked })} />Force: remove the record even if the node is unreachable (may leave an orphan container)</label>
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title={secret?.title || ''} footer={<Btn variant="primary" onClick={() => setSecret(null)}>Done</Btn>}><code className="block break-all rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-amber-300">{secret?.value}</code></Modal>
      <Modal open={!!create} onClose={() => setCreate(null)} wide title="Create VPS for a customer (no charge)" footer={<><Btn onClick={() => setCreate(null)}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={submitCreate}>Create</Btn></>}>
        {create && <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Customer email"><TextInput value={create.email} onChange={e => setCreate({ ...create, email: e.target.value })} /></Field>
          <Field label="Plan"><Select value={create.planId} onChange={e => setCreate({ ...create, planId: e.target.value })}><option value="">Select…</option>{meta?.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.cpu}c/{fmtMB(p.ramMb)}/{p.diskGb}G</option>)}</Select></Field>
          <Field label="Image"><Select value={create.image} onChange={e => setCreate({ ...create, image: e.target.value })}><option value="">Default</option>{meta?.images.filter(i => i.enabled).map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
          <Field label="Node"><Select value={create.nodeId} onChange={e => setCreate({ ...create, nodeId: e.target.value })}><option value="">Automatic</option>{meta?.nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
          <Field label="Name"><TextInput value={create.name} onChange={e => setCreate({ ...create, name: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Days of service"><NumInput value={create.days} onChange={v => setCreate({ ...create, days: v })} min={1} max={3650} /></Field>
        </div>}
      </Modal>
    </div>
  );
};
