import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Network, Pencil, Plus, RefreshCw, ScanSearch, Trash2, Wifi } from 'lucide-react';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextArea, TextInput, Toggle, fmtMB, useToast } from '../../components/ui/kit';
import { ConfirmModal, ago } from '../../components/ui/panelKit';
import { VpsNode } from '../../vpsTypes';
import { adminVps } from '../vps/vpsApi';

type N = Omit<VpsNode, 'secretEnc'> & { usage: { count: number; ramMb: number; diskGb: number; cpu: number } };
const blank = { name: '', location: '', daemonHost: '', daemonPort: 3100, scheme: 'http', publicHost: '', maxVps: 20, portMin: 42000, portMax: 42999, ramMb: 0, diskGb: 0, cpus: 0, overallocatePercent: 0, enabled: true, notes: '' };

export const AdminVpsNodes: React.FC = () => {
  const [toast, say] = useToast(); const [nodes, setNodes] = useState<N[] | null>(null); const [form, setForm] = useState<any>(null); const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState<{ name: string; secret: string; installCommand: string; configureCommand: string } | null>(null);
  const [del, setDel] = useState<N | null>(null); const [testing, setTesting] = useState(''); const [rec, setRec] = useState<{ node: N; orphans: { id: string; status: string }[]; missing: { id: string; name: string }[]; ok: number } | null>(null);
  const load = useCallback(async () => { try { setNodes(await adminVps<N[]>('/nodes')); } catch (e: any) { say('error', e.message); } }, [say]);
  useEffect(() => { load(); const t = window.setInterval(load, 20000); return () => window.clearInterval(t); }, [load]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (form.id) { await adminVps(`/nodes/${form.id}`, { method: 'PUT', body: form }); say('success', 'Node updated.'); }
      else { const r = await adminVps<any>('/nodes', { method: 'POST', body: form }); setReveal({ name: form.name, ...r }); }
      setForm(null); load();
    } catch (e: any) { say('error', e.message); } finally { setSaving(false); }
  };
  const test = async (n: N) => { setTesting(n.id); try { await adminVps(`/nodes/${n.id}/test`, { method: 'POST' }); say('success', `${n.name} is online.`); } catch (e: any) { say('error', e.message); } finally { setTesting(''); load(); } };
  const rotate = async (n: N) => { try { const r = await adminVps<any>(`/nodes/${n.id}/rotate-secret`, { method: 'POST' }); setReveal({ name: n.name, ...r }); load(); } catch (e: any) { say('error', e.message); } };
  const reconcile = async (n: N) => { try { setRec({ node: n, ...(await adminVps<any>(`/nodes/${n.id}/reconcile`)) }); } catch (e: any) { say('error', e.message); } };
  const prune = async () => { if (!rec) return; try { const r = await adminVps<{ removed: number }>(`/nodes/${rec.node.id}/prune`, { method: 'POST', body: { ids: rec.orphans.map(o => o.id) } }); say('success', `Removed ${r.removed} orphan container(s).`); setRec(null); } catch (e: any) { say('error', e.message); } };
  const remove = async () => { if (!del) return; try { await adminVps(`/nodes/${del.id}`, { method: 'DELETE' }); say('success', 'Node removed.'); setDel(null); load(); } catch (e: any) { say('error', e.message); setDel(null); } };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('success', 'Copied.'));

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Network className="h-6 w-6 text-amber-400" />} title="VPS Nodes" subtitle="Machines running the MonoVPS daemon. Customer VPSes are Docker containers placed on the least-loaded node with free capacity."
        actions={<Btn variant="primary" onClick={() => setForm({ ...blank })}><Plus className="h-3.5 w-3.5" />Add node</Btn>} />
      {!nodes ? <Spinner /> : !nodes.length ? <Card><Empty icon={<Network className="h-10 w-10" />} title="No nodes yet" text="Add a node, then run the generated install command on the machine (see vps-daemon/README.md)." action={<Btn variant="primary" onClick={() => setForm({ ...blank })}>Add node</Btn>} /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">{nodes.map(n => {
          const sys = n.status?.system; const ram = sys ? Math.round((1 - sys.memFreeMb / sys.memTotalMb) * 100) : null;
          return (
            <Card key={n.id} className="!p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">{n.name}<Badge tone={n.status?.online ? 'green' : 'red'}>{n.status?.online ? 'Online' : 'Offline'}</Badge>{!n.enabled && <Badge tone="amber">Draining</Badge>}</p>
                  <p className="text-[11px] text-zinc-500 font-mono mt-0.5">{n.location} · {n.scheme}://{n.daemonHost}:{n.daemonPort}</p></div>
                <div className="flex gap-1 shrink-0">
                  <Btn size="sm" busy={testing === n.id} onClick={() => test(n)}><Wifi className="h-3.5 w-3.5" />Test</Btn>
                  <Btn size="sm" onClick={() => setForm({ ...n })}><Pencil className="h-3.5 w-3.5" /></Btn>
                </div>
              </div>
              {n.status?.online ? <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500">VPSes</p><p className="font-mono text-zinc-200">{n.usage.count}{n.maxVps ? ` / ${n.maxVps}` : ''}</p></div>
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500">Host RAM used</p><p className="font-mono text-zinc-200">{ram}% of {sys ? fmtMB(sys.memTotalMb) : '?'}</p></div>
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500">Disk free</p><p className="font-mono text-zinc-200">{sys?.diskFreeMb !== undefined ? fmtMB(sys.diskFreeMb) : '—'}</p></div>
              </div> : <p className="text-xs text-red-300/90">{n.status?.error || 'Not checked yet'}</p>}
              <p className="text-[10px] text-zinc-600">v{n.status?.version || '?'} · {n.status?.runtime || '—'} · SSH ports {n.portMin}-{n.portMax} · checked {ago(n.status?.checkedAt)}{n.usage.count ? ` · sold ${fmtMB(n.usage.ramMb)} RAM / ${n.usage.diskGb} GB disk` : ''}</p>
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-800">
                <Btn size="sm" disabled={!n.status?.online} onClick={() => reconcile(n)}><ScanSearch className="h-3.5 w-3.5" />Reconcile</Btn>
                <Btn size="sm" onClick={() => rotate(n)}><RefreshCw className="h-3.5 w-3.5" />Rotate secret</Btn>
                <Btn size="sm" variant="danger" className="ml-auto" onClick={() => setDel(n)}><Trash2 className="h-3.5 w-3.5" />Remove</Btn>
              </div>
            </Card>);
        })}</div>)}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit node' : 'Add VPS node'} wide footer={<><Btn onClick={() => setForm(null)}>Cancel</Btn><Btn variant="primary" busy={saving} onClick={save}>{form?.id ? 'Save' : 'Create node'}</Btn></>}>
        {form && <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name"><TextInput value={form.name} onChange={e => set('name', e.target.value)} placeholder="vps-fra-1" /></Field>
          <Field label="Location" hint="Shown to customers"><TextInput value={form.location} onChange={e => set('location', e.target.value)} placeholder="Frankfurt" /></Field>
          <Field label="Daemon address" hint="Where the panel reaches the daemon"><TextInput value={form.daemonHost} onChange={e => set('daemonHost', e.target.value)} placeholder="203.0.113.10" /></Field>
          <Field label="Daemon port"><NumInput value={form.daemonPort} onChange={v => set('daemonPort', v)} min={1} max={65535} /></Field>
          <Field label="Scheme"><Select value={form.scheme} onChange={e => set('scheme', e.target.value)}><option value="http">http</option><option value="https">https (daemon has TLS_CERT/TLS_KEY)</option></Select></Field>
          <Field label="Public address" hint="What customers SSH to. Blank = daemon address"><TextInput value={form.publicHost} onChange={e => set('publicHost', e.target.value)} /></Field>
          <Field label="SSH port from"><NumInput value={form.portMin} onChange={v => set('portMin', v)} min={1024} max={65535} /></Field>
          <Field label="SSH port to"><NumInput value={form.portMax} onChange={v => set('portMax', v)} min={1024} max={65535} /></Field>
          <Field label="Max VPSes" hint="0 = unlimited"><NumInput value={form.maxVps} onChange={v => set('maxVps', v)} min={0} /></Field>
          <Field label="Overallocate %" hint="Applied to the totals below"><NumInput value={form.overallocatePercent} onChange={v => set('overallocatePercent', v)} min={0} max={500} /></Field>
          <Field label="Sellable RAM (MB)" hint="0 = not limited"><NumInput value={form.ramMb} onChange={v => set('ramMb', v)} min={0} /></Field>
          <Field label="Sellable disk (GB)" hint="0 = not limited"><NumInput value={form.diskGb} onChange={v => set('diskGb', v)} min={0} /></Field>
          <Field label="Sellable vCPUs" hint="0 = not limited"><NumInput value={form.cpus} onChange={v => set('cpus', v)} min={0} step={0.5} /></Field>
          <div className="self-end"><Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Accepts new VPSes" hint="Turn off to drain the node" /></div>
          <Field label="Notes" className="sm:col-span-2"><TextArea value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></Field>
        </div>}
      </Modal>
      <Modal open={!!reveal} onClose={() => setReveal(null)} title={`Install the daemon on ${reveal?.name}`} wide footer={<Btn variant="primary" onClick={() => setReveal(null)}>Done</Btn>}>
        {reveal && <div className="space-y-3 text-xs text-zinc-300">
          <p className="text-amber-300">The secret is shown once. Run one of these on the node, from the <code>vps-daemon</code> folder:</p>
          {[['Installer (Debian/Ubuntu, systemd)', reveal.installCommand], ['Manual', reveal.configureCommand]].map(([l, c]) => <div key={l}><p className="text-zinc-500 mb-1">{l}</p><div className="flex gap-2 items-start rounded-xl border border-zinc-800 bg-zinc-950 p-3"><code className="flex-1 break-all text-[11px] text-emerald-300">{c}</code><button onClick={() => copy(c)} className="text-zinc-400 hover:text-white" aria-label="Copy"><Copy className="h-4 w-4" /></button></div></div>)}
          <p className="text-zinc-500">Open the daemon port to this panel only, and the SSH port range to everyone. Then press Test.</p>
        </div>}
      </Modal>
      <Modal open={!!rec} onClose={() => setRec(null)} title={`Reconcile ${rec?.node.name}`} footer={<>{!!rec?.orphans.length && <Btn variant="danger" onClick={prune}>Remove {rec.orphans.length} orphan(s)</Btn>}<Btn onClick={() => setRec(null)}>Close</Btn></>}>
        {rec && <div className="space-y-3 text-xs">
          <p className="text-zinc-300">{rec.ok} VPS record(s) match a container.</p>
          <div><p className="font-semibold text-white">Orphan containers ({rec.orphans.length})</p><p className="text-zinc-500">Running on the node but unknown to the panel (e.g. after a failed order). Safe to remove.</p>{rec.orphans.map(o => <p key={o.id} className="font-mono text-amber-300 mt-1">{o.id} · {o.status}</p>)}</div>
          <div><p className="font-semibold text-white">Missing containers ({rec.missing.length})</p><p className="text-zinc-500">Panel records whose container is gone. Reinstall or delete them in VPS Servers.</p>{rec.missing.map(o => <p key={o.id} className="font-mono text-red-300 mt-1">{o.name} · {o.id}</p>)}</div>
        </div>}
      </Modal>
      <ConfirmModal open={!!del} title="Remove node?" confirmLabel="Remove" danger onClose={() => setDel(null)} onConfirm={remove}>{del?.name} is removed from the panel. The daemon on the machine keeps running until you uninstall it.</ConfirmModal>
    </div>
  );
};
