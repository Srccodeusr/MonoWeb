import React, { useCallback, useEffect, useState } from 'react';
import { Network, Plus, RefreshCw, Trash2, Pencil, Copy, KeyRound, Wifi, Cpu, MemoryStick, HardDrive, ShieldCheck, TerminalSquare } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, Toggle, fmtBytes, fmtMB, useToast } from '../../components/ui/kit';

interface Node { id: string; name: string; locationName: string; locationFlag?: string; fqdn: string; daemonHost: string; daemonPort: number; scheme: 'http' | 'https'; ramMB: number; cpuPercent: number; diskMB: number; overallocatePercent: number; maxServers: number; portMin: number; portMax: number; isPublic: boolean; isMaintenance: boolean; premiumOnly: boolean; notes?: string; status: { online: boolean; runtime?: string; version?: string; platform?: string; error?: string; checkedAt?: string; runtimeInfo?: any; system?: { cpus: number; load: number[]; memTotal: number; memFree: number; diskFree: number; diskTotal: number } }; usage: { ramMB: number; cpuPercent: number; diskMB: number; servers: number } }

const blank = { name: '', locationName: '', locationFlag: '', fqdn: '', daemonHost: '', daemonPort: 3002, scheme: 'http', ramMB: 8192, cpuPercent: 400, diskMB: 102400, overallocatePercent: 0, maxServers: 0, portMin: 20000, portMax: 40000, isPublic: true, isMaintenance: false, premiumOnly: false, notes: '' };
const RUNTIME_LABEL: Record<string, string> = { docker: 'Docker', podman: 'Podman', process: 'Native sandbox' };

export const AdminNodes: React.FC = () => {
  const [toast, say] = useToast();
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState<{ secret: string; command: string; name: string } | null>(null);
  const [testing, setTesting] = useState('');

  const load = useCallback(async () => { const r = await apiRequest<Node[]>('/admin/hosting/nodes'); if (r.success && r.data) setNodes(r.data); }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 20000); return () => window.clearInterval(t); }, [load]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const editing = !!form.id;
    const r = await apiRequest(editing ? `/admin/hosting/nodes/${form.id}` : '/admin/hosting/nodes', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) });
    setSaving(false);
    if (!r.success) return say('error', r.error?.message || 'Could not save the node.');
    setForm(null); load();
    if (!editing) setReveal({ secret: r.data.secret, command: r.data.command, name: r.data.node.name });
    else say('success', 'Node updated.');
  };
  const test = async (n: Node) => { setTesting(n.id); const r = await apiRequest(`/admin/hosting/nodes/${n.id}/test`, { method: 'POST' }); setTesting(''); say(r.success ? 'success' : 'error', r.success ? `${n.name} is online.` : r.error?.message || 'Unreachable.'); load(); };
  const rotate = async (n: Node) => { if (!window.confirm(`Rotate the secret for ${n.name}? The node goes offline until you re-run the configure command.`)) return; const r = await apiRequest(`/admin/hosting/nodes/${n.id}/rotate-secret`, { method: 'POST' }); if (r.success) setReveal({ secret: r.data.secret, command: r.data.command, name: n.name }); else say('error', r.error?.message || 'Failed.'); load(); };
  const del = async (n: Node) => { if (!window.confirm(`Delete node ${n.name}?`)) return; const r = await apiRequest(`/admin/hosting/nodes/${n.id}`, { method: 'DELETE' }); if (r.success) { say('success', 'Node deleted.'); load(); } else say('error', r.error?.message || 'Failed.'); };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('success', 'Copied to clipboard'));

  if (!nodes) return <Spinner />;
  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Network className="h-6 w-6 text-amber-400" />} title="Nodes" subtitle="Machines that run customer servers. Works on any VPS, with Docker, Podman, gVisor/Kata or the built-in native sandbox for hosts that cannot run containers."
        actions={<><Btn onClick={load}><RefreshCw className="h-4 w-4" /></Btn><Btn variant="primary" onClick={() => setForm({ ...blank })}><Plus className="h-4 w-4" />Add node</Btn></>} />

      {nodes.length === 0 ? <Card><Empty icon={<Network className="h-12 w-12" />} title="No nodes yet" text="Add a node to get a one-line command that installs and links the daemon on your VPS." action={<Btn variant="primary" onClick={() => setForm({ ...blank })}><Plus className="h-4 w-4" />Add your first node</Btn>} /></Card> : (
        <div className="grid lg:grid-cols-2 gap-4">
          {nodes.map(n => {
            const sys = n.status.system;
            return (
              <Card key={n.id} className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-bold text-white flex items-center gap-2 truncate">{n.name}<Badge tone={n.status.online ? 'green' : 'red'}>{n.status.online ? 'Online' : 'Offline'}</Badge>{n.isMaintenance && <Badge tone="amber">Maintenance</Badge>}{!n.isPublic && <Badge>Hidden</Badge>}{n.premiumOnly && <Badge tone="amber">Premium</Badge>}</p><p className="text-[11px] text-zinc-500 font-mono mt-1">{n.locationFlag} {n.locationName} · {n.scheme}://{n.daemonHost}:{n.daemonPort}</p></div>
                  <div className="flex gap-1 shrink-0"><Btn size="sm" busy={testing === n.id} onClick={() => test(n)}><Wifi className="h-3.5 w-3.5" />Test</Btn><Btn size="sm" onClick={() => setForm({ ...n })} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Btn></div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {[['RAM', MemoryStick, n.usage.ramMB, n.ramMB, fmtMB], ['CPU', Cpu, n.usage.cpuPercent, n.cpuPercent, (v: number) => `${v}%`], ['Disk', HardDrive, n.usage.diskMB, n.diskMB, fmtMB]].map(([l, I, used, cap, f]: any) => {
                    const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
                    return <div key={l} className="rounded-xl bg-zinc-950 border border-zinc-800 p-2.5"><p className="text-zinc-500 flex items-center gap-1"><I className="h-3 w-3" />{l}</p><p className="font-mono text-zinc-200 mt-1">{f(used)} <span className="text-zinc-600">/ {cap ? f(cap) : '∞'}</span></p><div className="h-1 rounded-full bg-zinc-800 mt-1.5"><div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div></div>;
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                  <span>{n.usage.servers} server{n.usage.servers === 1 ? '' : 's'}</span>
                  <span>Ports {n.portMin}–{n.portMax}</span>
                  {n.status.online ? <><span className="text-zinc-300">{RUNTIME_LABEL[n.status.runtime || ''] || n.status.runtime}</span><span>daemon v{n.status.version}</span>{sys && <span>host {sys.cpus} CPU · {fmtBytes(sys.memFree)} free RAM · {fmtBytes(sys.diskFree)} free disk</span>}</> : <span className="text-red-400">{n.status.error || 'Not connected yet. Run the configure command on the node.'}</span>}
                </div>
                <div className="flex justify-between pt-3 border-t border-zinc-800"><Btn size="sm" onClick={() => rotate(n)}><KeyRound className="h-3.5 w-3.5" />Configure / rotate secret</Btn><Btn size="sm" variant="danger" onClick={() => del(n)}><Trash2 className="h-3.5 w-3.5" />Delete</Btn></div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.id ? `Edit ${form.name}` : 'Add node'} footer={<><Btn onClick={() => setForm(null)}>Cancel</Btn><Btn variant="primary" busy={saving} disabled={!form?.name || !form?.fqdn || !form?.locationName} onClick={save}>{form?.id ? 'Save' : 'Create node'}</Btn></>}>
        {form && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Node name"><TextInput value={form.name} onChange={e => set('name', e.target.value)} placeholder="Frankfurt-1" /></Field>
              <Field label="Location (shown to users)"><div className="flex gap-2"><TextInput className="!w-16 text-center" value={form.locationFlag || ''} onChange={e => set('locationFlag', e.target.value)} placeholder="🇩🇪" maxLength={8} /><TextInput value={form.locationName} onChange={e => set('locationName', e.target.value)} placeholder="Germany" /></div></Field>
              <Field label="Public address (FQDN / IP)" hint="What customers connect to."><TextInput value={form.fqdn} onChange={e => set('fqdn', e.target.value)} placeholder="de1.example.com" /></Field>
              <Field label="Daemon address" hint="What the panel calls. Leave empty to use the public address."><TextInput value={form.daemonHost || ''} onChange={e => set('daemonHost', e.target.value)} placeholder="same as public" /></Field>
              <Field label="Daemon port"><NumInput value={form.daemonPort} onChange={v => set('daemonPort', v)} min={1} max={65535} /></Field>
              <Field label="Daemon protocol"><Select value={form.scheme} onChange={e => set('scheme', e.target.value)}><option value="http">HTTP (use only on a private network / behind a tunnel)</option><option value="https">HTTPS (recommended)</option></Select></Field>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Total RAM"><NumInput value={form.ramMB} onChange={v => set('ramMB', v)} suffix="MB" /></Field>
              <Field label="Total CPU" hint="100 = 1 core"><NumInput value={form.cpuPercent} onChange={v => set('cpuPercent', v)} suffix="%" /></Field>
              <Field label="Total disk"><NumInput value={form.diskMB} onChange={v => set('diskMB', v)} suffix="MB" /></Field>
              <Field label="Over-allocation" hint="0 = strict"><NumInput value={form.overallocatePercent} onChange={v => set('overallocatePercent', v)} suffix="%" /></Field>
              <Field label="Max servers" hint="0 = unlimited"><NumInput value={form.maxServers} onChange={v => set('maxServers', v)} /></Field>
              <Field label="Port range"><div className="flex gap-1.5 items-center"><NumInput value={form.portMin} onChange={v => set('portMin', v)} /><span className="text-zinc-600">–</span><NumInput value={form.portMax} onChange={v => set('portMax', v)} /></div></Field>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3.5">
              <Toggle checked={form.isPublic} onChange={v => set('isPublic', v)} label="Visible to users" hint="Shown in the create wizard" />
              <Toggle checked={form.premiumOnly} onChange={v => set('premiumOnly', v)} label="Premium only" hint="Hidden from free plans" />
              <Toggle checked={form.isMaintenance} onChange={v => set('isMaintenance', v)} label="Maintenance" hint="No new servers" />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!reveal} onClose={() => setReveal(null)} wide title={`Link ${reveal?.name}`} footer={<Btn variant="primary" onClick={() => setReveal(null)}>I ran it, close</Btn>}>
        {reveal && (
          <div className="space-y-4 text-xs text-zinc-300">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex gap-2"><ShieldCheck className="h-4 w-4 text-amber-400 shrink-0 mt-px" /><span>This secret is shown <b>only once</b> and stored encrypted. If you lose it, use “Configure / rotate secret”.</span></div>
            <ol className="list-decimal list-inside space-y-1.5 text-zinc-400"><li>SSH into the new VPS and copy the <code className="text-amber-300">daemon/</code> folder of this project there (Node.js 20+ required).</li><li>Run the command below in that folder. It installs, builds, writes the config (mode 600) and starts the daemon.</li><li>Open port <b className="text-zinc-200">{reveal.command.match(/--port (\d+)/)?.[1]}</b> to the panel's IP only, then press <b>Test</b> on the node card.</li></ol>
            <div><div className="flex items-center justify-between mb-1.5"><span className="text-[10px] font-mono uppercase text-zinc-500 flex items-center gap-1"><TerminalSquare className="h-3 w-3" />Run on the node</span><button onClick={() => copy(reveal.command)} className="text-amber-300 flex items-center gap-1"><Copy className="h-3 w-3" />Copy</button></div><pre className="rounded-xl bg-black border border-zinc-800 p-3 font-mono text-[11px] text-emerald-300 whitespace-pre-wrap break-all">{reveal.command}</pre></div>
            <div><div className="flex items-center justify-between mb-1.5"><span className="text-[10px] font-mono uppercase text-zinc-500">Secret key</span><button onClick={() => copy(reveal.secret)} className="text-amber-300 flex items-center gap-1"><Copy className="h-3 w-3" />Copy</button></div><pre className="rounded-xl bg-black border border-zinc-800 p-3 font-mono text-[11px] text-zinc-300 break-all whitespace-pre-wrap">{reveal.secret}</pre></div>
          </div>
        )}
      </Modal>
    </div>
  );
};
