import React, { useCallback, useEffect, useState } from 'react';
import { Server, Search, RefreshCw, Ban, CheckCircle2, Trash2, Pencil, Clock, Play, Square, RotateCw, Wrench } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, fmtDate, fmtMB, statusTone, timeLeft, useToast } from '../../components/ui/kit';

interface Row { id: string; name: string; status: string; suspendedReason?: string; owner: { id: string; username: string; email: string } | null; node: { id: string; name: string; location: string } | null; image: string; limits: { ramMB: number; cpuPercent: number; diskMB: number; swapMB: number; backups: number; databases: number }; ports: number[]; createdAt: string; expiresAt?: string; expiredAt?: string; renewCount: number }

export const AdminServers: React.FC = () => {
  const [toast, say] = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [nodeId, setNodeId] = useState('');
  const [nodes, setNodes] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState<any>(null); const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const p = new URLSearchParams({ search: q, status, nodeId });
    const r = await apiRequest<Row[]>(`/admin/hosting/servers?${p}`); if (r.success && r.data) setRows(r.data);
  }, [q, status, nodeId]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { apiRequest('/admin/hosting/nodes').then(r => r.success && setNodes(r.data.map((n: any) => ({ id: n.id, name: n.name })))); }, []);

  const act = async (key: string, fn: () => Promise<any>, ok: string) => { setBusy(key); const r = await fn(); setBusy(''); say(r.success ? 'success' : 'error', r.success ? ok : r.error?.message || 'Failed'); if (r.success) load(); return r; };
  const post = (id: string, path: string, body: any = {}) => apiRequest(`/admin/hosting/servers/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });

  const suspend = (s: Row) => { const reason = window.prompt('Reason for suspension (shown to the user)', 'Terms of service violation'); if (reason !== null) act('s' + s.id, () => post(s.id, 'suspend', { reason }), 'Server suspended'); };
  const del = (s: Row) => { if (!window.confirm(`Delete "${s.name}" and ALL its data?`)) return; act('d' + s.id, async () => { const r = await apiRequest(`/admin/hosting/servers/${s.id}`, { method: 'DELETE' }); if (!r.success && window.confirm(`${r.error?.message}\n\nForce-remove the record anyway?`)) return apiRequest(`/admin/hosting/servers/${s.id}?force=1`, { method: 'DELETE' }); return r; }, 'Server deleted'); };
  const saveEdit = async () => {
    const { id, name, ramMB, cpuPercent, diskMB, swapMB, backups, databases, ownerId, expiresAt } = edit;
    const r = await act('save', () => apiRequest(`/admin/hosting/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ name, ramMB, cpuPercent, diskMB, swapMB, backups, databases, ownerId: ownerId || undefined, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }) }), 'Server updated');
    if (r.success) setEdit(null);
  };

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Server className="h-6 w-6 text-amber-400" />} title="Server Management" subtitle="Every customer server across all nodes. Suspend, edit limits, extend expiry, reinstall or delete."
        actions={<Btn onClick={load}><RefreshCw className="h-4 w-4" /></Btn>} />
      <Card className="grid sm:grid-cols-[1fr_160px_160px] gap-2.5">
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" /><TextInput className="pl-9" placeholder="Search name, id, owner, email…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <Select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['installing', 'offline', 'running', 'suspended', 'expired', 'install_failed'].map(s => <option key={s}>{s}</option>)}</Select>
        <Select value={nodeId} onChange={e => setNodeId(e.target.value)}><option value="">All nodes</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</Select>
      </Card>
      {!rows ? <Spinner /> : rows.length === 0 ? <Card><Empty icon={<Server className="h-12 w-12" />} title="No servers match" /></Card> : (
        <Card className="!p-0 overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[860px]">
            <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-500 font-mono text-[10px] uppercase"><tr><th className="p-3">Server</th><th className="p-3">Owner</th><th className="p-3">Node</th><th className="p-3">Specs</th><th className="p-3">Expiry</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-zinc-800/60">
              {rows.map(s => { const tl = timeLeft(s.expiresAt); return (
                <tr key={s.id} className="hover:bg-zinc-900/70">
                  <td className="p-3"><p className="font-semibold text-zinc-100">{s.name}</p><p className="text-[10px] font-mono text-zinc-600">{s.image} · {s.id.slice(0, 8)}</p></td>
                  <td className="p-3 text-zinc-300">{s.owner?.username || '—'}<p className="text-[10px] text-zinc-600">{s.owner?.email}</p></td>
                  <td className="p-3 text-zinc-400">{s.node?.name}<p className="text-[10px] text-zinc-600">{s.node?.location} · :{s.ports[0]}</p></td>
                  <td className="p-3 font-mono text-zinc-400">{fmtMB(s.limits.ramMB)} · {s.limits.cpuPercent}% · {fmtMB(s.limits.diskMB)}</td>
                  <td className="p-3"><span className={tl.urgent ? 'text-amber-300' : 'text-zinc-400'}>{s.expiresAt ? tl.text : 'Never'}</span><p className="text-[10px] text-zinc-600">{s.renewCount} renewal{s.renewCount === 1 ? '' : 's'}</p></td>
                  <td className="p-3"><Badge tone={statusTone(s.status)}>{s.status}</Badge>{s.suspendedReason && <p className="text-[10px] text-red-400/80 mt-1 max-w-[140px] truncate" title={s.suspendedReason}>{s.suspendedReason}</p>}</td>
                  <td className="p-3"><div className="flex justify-end gap-1 flex-wrap">
                    {s.status === 'suspended' ? <Btn size="sm" variant="success" busy={busy === 'u' + s.id} onClick={() => act('u' + s.id, () => post(s.id, 'unsuspend'), 'Unsuspended')}><CheckCircle2 className="h-3.5 w-3.5" /></Btn> : <Btn size="sm" busy={busy === 's' + s.id} onClick={() => suspend(s)} aria-label="Suspend"><Ban className="h-3.5 w-3.5" /></Btn>}
                    <Btn size="sm" onClick={() => act('x' + s.id, () => post(s.id, 'extend', { days: Number(window.prompt('Extend by how many days?', '7')) || 0 }), 'Expiry extended')} aria-label="Extend"><Clock className="h-3.5 w-3.5" /></Btn>
                    <Btn size="sm" onClick={() => act('p' + s.id, () => post(s.id, 'power', { action: 'start' }), 'Started')} aria-label="Start"><Play className="h-3.5 w-3.5" /></Btn>
                    <Btn size="sm" onClick={() => act('k' + s.id, () => post(s.id, 'power', { action: 'kill' }), 'Stopped')} aria-label="Kill"><Square className="h-3.5 w-3.5" /></Btn>
                    <Btn size="sm" onClick={() => window.confirm('Reinstall? Install script runs again over existing files.') && act('r' + s.id, () => post(s.id, 'reinstall'), 'Reinstalling')} aria-label="Reinstall"><RotateCw className="h-3.5 w-3.5" /></Btn>
                    <Btn size="sm" onClick={() => setEdit({ id: s.id, name: s.name, ...s.limits, ownerId: '', expiresAt: s.expiresAt ? s.expiresAt.slice(0, 16) : '' })} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Btn>
                    <Btn size="sm" variant="danger" busy={busy === 'd' + s.id} onClick={() => del(s)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Btn>
                  </div></td>
                </tr>); })}
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit server" footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" onClick={saveEdit} busy={busy === 'save'}>Save</Btn></>}>
        {edit && <div className="space-y-4">
          <Field label="Name"><TextInput value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RAM"><NumInput value={edit.ramMB} onChange={v => setEdit({ ...edit, ramMB: v })} suffix="MB" /></Field>
            <Field label="CPU"><NumInput value={edit.cpuPercent} onChange={v => setEdit({ ...edit, cpuPercent: v })} suffix="%" /></Field>
            <Field label="Disk"><NumInput value={edit.diskMB} onChange={v => setEdit({ ...edit, diskMB: v })} suffix="MB" /></Field>
            <Field label="Swap"><NumInput value={edit.swapMB} onChange={v => setEdit({ ...edit, swapMB: v })} suffix="MB" /></Field>
            <Field label="Backups"><NumInput value={edit.backups} onChange={v => setEdit({ ...edit, backups: v })} /></Field>
            <Field label="Databases"><NumInput value={edit.databases} onChange={v => setEdit({ ...edit, databases: v })} /></Field>
          </div>
          <Field label="Expires at" hint="Clear to make it never expire."><TextInput type="datetime-local" value={edit.expiresAt} onChange={e => setEdit({ ...edit, expiresAt: e.target.value })} /></Field>
          <Field label="Transfer to user id (optional)"><TextInput value={edit.ownerId} onChange={e => setEdit({ ...edit, ownerId: e.target.value })} placeholder="user_…" className="font-mono text-xs" /></Field>
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Wrench className="h-3 w-3" />Limit changes apply on the node immediately; RAM/CPU on a running server update live (Docker) or at next restart.</p>
        </div>}
      </Modal>
      <p className="text-[11px] text-zinc-600 text-center">Last refreshed {fmtDate(new Date().toISOString())}</p>
    </div>
  );
};
