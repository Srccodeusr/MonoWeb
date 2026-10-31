import React, { useCallback, useEffect, useState } from 'react';
import { Users, Search, RefreshCw, Crown, Coins, Server, SlidersHorizontal, Ban } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, fmtDate, fmtMB, useToast } from '../../components/ui/kit';

interface Acc { id: string; username: string; displayName: string; email: string; role: string; isSuspended: boolean; credits: number; coins: number; planId: string | null; planName: string; planExpiresAt: string | null; tempPlan: { planId: string; until: string } | null; extraSlots: number; overrides: { serverLimit?: number; ramMB?: number; cpuPercent?: number; diskMB?: number }; servers: number; createdAt: string }

export const AdminAccounts: React.FC = () => {
  const [toast, say] = useToast();
  const [rows, setRows] = useState<Acc[] | null>(null);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [coinAmt, setCoinAmt] = useState(0);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => { const r = await apiRequest<Acc[]>(`/admin/hosting/accounts?search=${encodeURIComponent(q)}`); if (r.success && r.data) setRows(r.data); }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { apiRequest('/admin/hosting/plans').then(r => r.success && setPlans(r.data.map((p: any) => ({ id: p.id, name: p.name })))); }, []);

  const open = async (a: Acc) => {
    const r = await apiRequest(`/admin/hosting/accounts/${a.id}`); if (!r.success) return say('error', r.error?.message || 'Failed');
    setSel(r.data); setCoinAmt(0);
    setForm({ planId: a.planId || '', planExpiresAt: a.planExpiresAt ? a.planExpiresAt.slice(0, 16) : '', addDays: 0, extraSlots: a.extraSlots, ov: { ...a.overrides } });
  };
  const save = async () => {
    setBusy('save');
    const body: any = { planId: form.planId || null, extraSlots: form.extraSlots, overrides: form.ov, addDays: form.addDays || undefined };
    if (form.planExpiresAt) body.planExpiresAt = new Date(form.planExpiresAt).toISOString(); else body.planExpiresAt = null;
    const r = await apiRequest(`/admin/hosting/accounts/${sel.id}/hosting`, { method: 'PATCH', body: JSON.stringify(body) }); setBusy('');
    if (r.success) { say('success', 'Account updated'); setSel(null); load(); } else say('error', r.error?.message || 'Failed');
  };
  const coins = async () => { if (!coinAmt) return; setBusy('coins'); const r = await apiRequest(`/admin/hosting/accounts/${sel.id}/coins`, { method: 'POST', body: JSON.stringify({ amount: coinAmt, reason: 'Admin adjustment' }) }); setBusy(''); if (r.success) { say('success', `Balance is now ${r.data.coins}`); setSel({ ...sel, coins: r.data.coins }); setCoinAmt(0); load(); } else say('error', r.error?.message || 'Failed'); };
  const suspendServers = async (suspend: boolean) => { const r = await apiRequest(`/admin/hosting/accounts/${sel.id}/suspend-servers`, { method: 'POST', body: JSON.stringify({ suspend }) }); say(r.success ? 'success' : 'error', r.success ? `${r.data.affected} server(s) ${suspend ? 'suspended' : 'unsuspended'}` : r.error?.message || 'Failed'); };
  const ov = (k: string, v: number) => setForm((f: any) => ({ ...f, ov: { ...f.ov, [k]: v || undefined } }));

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Users className="h-6 w-6 text-amber-400" />} title="Account Management" subtitle="Hosting plan, server limits, coins and per-account overrides for every customer. (Roles and bans stay under Users.)" actions={<Btn onClick={load}><RefreshCw className="h-4 w-4" /></Btn>} />
      <Card><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" /><TextInput className="pl-9" placeholder="Search username, email or id…" value={q} onChange={e => setQ(e.target.value)} /></div></Card>
      {!rows ? <Spinner /> : rows.length === 0 ? <Card><Empty icon={<Users className="h-12 w-12" />} title="No accounts match" /></Card> : (
        <Card className="!p-0 overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-500 font-mono text-[10px] uppercase"><tr><th className="p-3">Account</th><th className="p-3">Plan</th><th className="p-3">Servers</th><th className="p-3">Coins</th><th className="p-3">Credits</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-zinc-800/60">{rows.map(a => (
              <tr key={a.id} className="hover:bg-zinc-900/70">
                <td className="p-3"><p className="font-semibold text-zinc-100 flex items-center gap-1.5">{a.username}{a.isSuspended && <Badge tone="red">banned</Badge>}{a.role !== 'user' && <Badge tone="amber">{a.role}</Badge>}</p><p className="text-[10px] text-zinc-600">{a.email}</p></td>
                <td className="p-3"><span className="flex items-center gap-1 text-zinc-200">{a.planId && <Crown className="h-3 w-3 text-amber-400" />}{a.planName}</span>{a.planExpiresAt && <p className="text-[10px] text-zinc-600">until {fmtDate(a.planExpiresAt)}</p>}{a.tempPlan && <p className="text-[10px] text-sky-400">temp premium</p>}</td>
                <td className="p-3 font-mono text-zinc-300">{a.servers}{a.extraSlots > 0 && <span className="text-zinc-600"> (+{a.extraSlots} slots)</span>}{Object.keys(a.overrides).length > 0 && <Badge tone="blue" className="ml-1.5">overrides</Badge>}</td>
                <td className="p-3 font-mono text-amber-300">{a.coins.toLocaleString()}</td><td className="p-3 font-mono text-zinc-400">${a.credits.toFixed(2)}</td>
                <td className="p-3 text-right"><Btn size="sm" onClick={() => open(a)}><SlidersHorizontal className="h-3.5 w-3.5" />Manage</Btn></td>
              </tr>))}</tbody>
          </table>
        </Card>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} wide title={sel ? `${sel.username} · ${sel.email}` : ''} footer={<><Btn onClick={() => setSel(null)}>Close</Btn><Btn variant="primary" busy={busy === 'save'} onClick={save}>Save hosting settings</Btn></>}>
        {sel && <div className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Paid plan"><Select value={form.planId} onChange={e => setForm({ ...form, planId: e.target.value })}><option value="">Free (default)</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Plan expires at"><TextInput type="datetime-local" value={form.planExpiresAt} onChange={e => setForm({ ...form, planExpiresAt: e.target.value })} /></Field>
            <Field label="Add days to plan" hint="Stacks on remaining time."><NumInput value={form.addDays} onChange={v => setForm({ ...form, addDays: v })} suffix="days" /></Field>
            <Field label="Extra server slots"><NumInput value={form.extraSlots} onChange={v => setForm({ ...form, extraSlots: v })} /></Field>
          </div>
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Per-account overrides <span className="normal-case text-zinc-600">(empty = use plan)</span></p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Server limit"><NumInput value={form.ov.serverLimit} onChange={v => ov('serverLimit', v)} /></Field>
              <Field label="RAM / server"><NumInput value={form.ov.ramMB} onChange={v => ov('ramMB', v)} suffix="MB" /></Field>
              <Field label="CPU / server"><NumInput value={form.ov.cpuPercent} onChange={v => ov('cpuPercent', v)} suffix="%" /></Field>
              <Field label="Disk / server"><NumInput value={form.ov.diskMB} onChange={v => ov('diskMB', v)} suffix="MB" /></Field>
            </div></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 flex flex-wrap items-end gap-3">
            <Field label={`Coins (balance ${sel.coins.toLocaleString()})`} className="w-40"><NumInput value={coinAmt} onChange={setCoinAmt} /></Field>
            <Btn busy={busy === 'coins'} disabled={!coinAmt} onClick={coins}><Coins className="h-3.5 w-3.5" />{coinAmt < 0 ? 'Remove' : 'Grant'} coins</Btn>
            <span className="ml-auto flex gap-2"><Btn size="sm" variant="danger" onClick={() => window.confirm('Suspend ALL of this user\'s servers?') && suspendServers(true)}><Ban className="h-3.5 w-3.5" />Suspend servers</Btn><Btn size="sm" onClick={() => suspendServers(false)}>Unsuspend</Btn></span>
          </div>
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1"><Server className="h-3 w-3" />Servers ({sel.servers.length})</p>
            {sel.servers.length === 0 ? <p className="text-xs text-zinc-600">None.</p> : <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">{sel.servers.map((s: any) => <li key={s.id} className="flex items-center justify-between px-3 py-2 text-xs"><span className="text-zinc-200">{s.name}</span><span className="font-mono text-zinc-500">{fmtMB(s.limits.ramMB)} · {s.status} · {s.expiresAt ? fmtDate(s.expiresAt) : 'no expiry'}</span></li>)}</ul>}</div>
        </div>}
      </Modal>
    </div>
  );
};
