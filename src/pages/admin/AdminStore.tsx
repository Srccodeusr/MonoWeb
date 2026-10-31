import React, { useCallback, useEffect, useState } from 'react';
import { ShoppingBag, Plus, Pencil, Trash2, Coins, History } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, Toggle, cx, fmtDate, fmtMB, useToast } from '../../components/ui/kit';
import type { StoreItem } from '../../hostingTypes';

const TYPES: Record<string, string> = { spec_upgrade: 'Spec upgrade (RAM / CPU / disk)', renew: 'Server renewal', temp_premium: 'Temporary premium', server_pack: 'Boosted server (individual server with better specs)', slot: 'Extra server slot' };
const blank = (type = 'spec_upgrade'): any => ({ type, name: '', description: '', priceCoins: 100, priceMoney: 0, isActive: true, sortOrder: 10, stock: 0, perUserLimit: 0, upgrade: { ramMB: 256, cpuPercent: 0, diskMB: 0, durationDays: 7, maxPerServer: 1 }, renewDays: 7, premiumPlanId: '', premiumDays: 3, slots: 1, pack: { ramMB: 2048, cpuPercent: 150, diskMB: 4096, swapMB: 0, backups: 2, databases: 1, validityDays: 30 } });

export const AdminStore: React.FC = () => {
  const [toast, say] = useToast();
  const [items, setItems] = useState<StoreItem[] | null>(null);
  const [plans, setPlans] = useState<{ id: string; name: string; isFree: boolean }[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'items' | 'ledger'>('items');
  const load = useCallback(async () => {
    const [s, p, l] = await Promise.all([apiRequest<StoreItem[]>('/admin/hosting/store'), apiRequest('/admin/hosting/plans'), apiRequest('/admin/hosting/economy/ledger')]);
    if (s.success && s.data) setItems(s.data); if (p.success) setPlans(p.data); if (l.success) setLedger(l.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!items) return <Spinner />;
  const e = (k: string, v: any) => setEdit((c: any) => ({ ...c, [k]: v }));
  const sub = (g: string, k: string, v: any) => setEdit((c: any) => ({ ...c, [g]: { ...c[g], [k]: v } }));

  const save = async () => {
    setBusy(true);
    const r = await apiRequest(edit.id ? `/admin/hosting/store/${edit.id}` : '/admin/hosting/store', { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(edit) }); setBusy(false);
    if (r.success) { say('success', 'Item saved'); setEdit(null); load(); } else say('error', r.error?.message || 'Failed');
  };
  const del = async (i: StoreItem) => { if (!window.confirm(`Delete "${i.name}"?`)) return; await apiRequest(`/admin/hosting/store/${i.id}`, { method: 'DELETE' }); load(); };
  const summary = (i: StoreItem) => i.type === 'spec_upgrade' && i.upgrade ? `${i.upgrade.ramMB ? `+${fmtMB(i.upgrade.ramMB)} RAM ` : ''}${i.upgrade.cpuPercent ? `+${i.upgrade.cpuPercent}% CPU ` : ''}${i.upgrade.diskMB ? `+${fmtMB(i.upgrade.diskMB)} disk ` : ''}· ${i.upgrade.durationDays ? i.upgrade.durationDays + 'd' : 'permanent'}`
    : i.type === 'renew' ? `+${i.renewDays} days` : i.type === 'temp_premium' ? `${i.premiumDays} days of ${plans.find(p => p.id === i.premiumPlanId)?.name || '?'}` : i.type === 'slot' ? `+${i.slots} slot(s)` : i.pack ? `${fmtMB(i.pack.ramMB)} / ${i.pack.cpuPercent}% / ${fmtMB(i.pack.diskMB)} · ${i.pack.validityDays}d` : '';

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<ShoppingBag className="h-6 w-6 text-amber-400" />} title="Store & Economy" subtitle="Items users buy with coins (or money): spec upgrades, renewals, temporary premium and boosted servers. Earning rates live in Expiry & Renewals → Economy."
        actions={<Btn variant="primary" onClick={() => setEdit(blank())}><Plus className="h-4 w-4" />New item</Btn>} />
      <div className="flex gap-1 border-b border-zinc-800">{(['items', 'ledger'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={cx('px-4 py-2.5 text-xs font-semibold capitalize border-b-2', tab === t ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500')}>{t === 'items' ? `Items (${items.length})` : 'Coin ledger'}</button>)}</div>

      {tab === 'items' && (items.length === 0 ? <Card><Empty icon={<ShoppingBag className="h-12 w-12" />} title="The store is empty" /></Card> : (
        <Card className="!p-0 overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]">
          <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-500 font-mono text-[10px] uppercase"><tr><th className="p-3">Item</th><th className="p-3">Type</th><th className="p-3">Effect</th><th className="p-3">Price</th><th className="p-3">Sold</th><th className="p-3" /></tr></thead>
          <tbody className="divide-y divide-zinc-800/60">{items.map(i => <tr key={i.id} className={cx('hover:bg-zinc-900/70', !i.isActive && 'opacity-50')}>
            <td className="p-3"><p className="font-semibold text-zinc-100">{i.name}</p><p className="text-[10px] text-zinc-600 truncate max-w-[220px]">{i.description}</p></td><td className="p-3 text-zinc-400">{i.type.replace('_', ' ')}</td><td className="p-3 text-zinc-400">{summary(i)}</td>
            <td className="p-3 font-mono"><span className="text-amber-300">{i.priceCoins ? `${i.priceCoins} 🪙` : ''}</span>{i.priceMoney > 0 && <span className="text-zinc-400"> ${i.priceMoney}</span>}</td><td className="p-3 font-mono text-zinc-400">{i.sold}{i.stock ? ` / ${i.stock}` : ''}</td>
            <td className="p-3"><div className="flex justify-end gap-1.5">{!i.isActive && <Badge>off</Badge>}<Btn size="sm" onClick={() => setEdit(JSON.parse(JSON.stringify({ ...blank(i.type), ...i })))}><Pencil className="h-3.5 w-3.5" /></Btn><Btn size="sm" variant="danger" onClick={() => del(i)}><Trash2 className="h-3.5 w-3.5" /></Btn></div></td></tr>)}</tbody></table></Card>))}

      {tab === 'ledger' && <Card className="!p-0 overflow-hidden">{ledger.length === 0 ? <Empty icon={<History className="h-10 w-10" />} title="No coin activity yet" /> : <ul className="divide-y divide-zinc-800/70 max-h-[60vh] overflow-y-auto">{ledger.map(t => <li key={t.id} className="flex items-center justify-between px-4 py-2.5 text-xs"><span className="min-w-0"><b className="text-zinc-200">{t.username}</b> <span className="text-zinc-500">{t.reason}</span><span className="block text-[10px] text-zinc-600">{fmtDate(t.createdAt)}</span></span><span className={cx('font-mono font-bold shrink-0', t.amount >= 0 ? 'text-emerald-400' : 'text-red-400')}><Coins className="inline h-3 w-3 mr-1" />{t.amount > 0 ? '+' : ''}{t.amount}</span></li>)}</ul>}</Card>}

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? `Edit ${edit.name}` : 'New store item'} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!edit?.name} onClick={save}>Save item</Btn></>}>
        {edit && <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Type"><Select value={edit.type} disabled={!!edit.id} onChange={ev => e('type', ev.target.value)}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><Field label="Name"><TextInput value={edit.name} onChange={ev => e('name', ev.target.value)} /></Field></div>
          <Field label="Description"><TextInput value={edit.description} onChange={ev => e('description', ev.target.value)} /></Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Field label="Price (coins)"><NumInput value={edit.priceCoins} onChange={v => e('priceCoins', v)} /></Field><Field label="Price (money)" hint="0 = coins only"><NumInput value={edit.priceMoney} step={0.5} onChange={v => e('priceMoney', v)} /></Field><Field label="Stock" hint="0 = unlimited"><NumInput value={edit.stock} onChange={v => e('stock', v)} /></Field><Field label="Per-user limit" hint="0 = unlimited"><NumInput value={edit.perUserLimit} onChange={v => e('perUserLimit', v)} /></Field></div>
          {edit.type === 'spec_upgrade' && <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3.5"><Field label="+RAM"><NumInput value={edit.upgrade.ramMB} onChange={v => sub('upgrade', 'ramMB', v)} suffix="MB" /></Field><Field label="+CPU"><NumInput value={edit.upgrade.cpuPercent} onChange={v => sub('upgrade', 'cpuPercent', v)} suffix="%" /></Field><Field label="+Disk"><NumInput value={edit.upgrade.diskMB} onChange={v => sub('upgrade', 'diskMB', v)} suffix="MB" /></Field><Field label="Lasts" hint="0 = forever"><NumInput value={edit.upgrade.durationDays} onChange={v => sub('upgrade', 'durationDays', v)} suffix="days" /></Field><Field label="Max stack"><NumInput value={edit.upgrade.maxPerServer} onChange={v => sub('upgrade', 'maxPerServer', v)} /></Field></div>}
          {edit.type === 'renew' && <Field label="Extends a server by" hint="Only sold while 'Renew with coins' is enabled in Expiry & Renewals."><NumInput value={edit.renewDays} onChange={v => e('renewDays', v)} suffix="days" /></Field>}
          {edit.type === 'temp_premium' && <div className="grid sm:grid-cols-2 gap-3"><Field label="Grants plan"><Select value={edit.premiumPlanId} onChange={ev => e('premiumPlanId', ev.target.value)}><option value="">Choose…</option>{plans.filter(p => !p.isFree).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><Field label="Duration"><NumInput value={edit.premiumDays} onChange={v => e('premiumDays', v)} suffix="days" /></Field></div>}
          {edit.type === 'slot' && <Field label="Server slots added"><NumInput value={edit.slots} onChange={v => e('slots', v)} /></Field>}
          {edit.type === 'server_pack' && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3.5"><Field label="RAM"><NumInput value={edit.pack.ramMB} onChange={v => sub('pack', 'ramMB', v)} suffix="MB" /></Field><Field label="CPU"><NumInput value={edit.pack.cpuPercent} onChange={v => sub('pack', 'cpuPercent', v)} suffix="%" /></Field><Field label="Disk"><NumInput value={edit.pack.diskMB} onChange={v => sub('pack', 'diskMB', v)} suffix="MB" /></Field><Field label="Swap"><NumInput value={edit.pack.swapMB} onChange={v => sub('pack', 'swapMB', v)} suffix="MB" /></Field><Field label="Backups"><NumInput value={edit.pack.backups} onChange={v => sub('pack', 'backups', v)} /></Field><Field label="Databases"><NumInput value={edit.pack.databases} onChange={v => sub('pack', 'databases', v)} /></Field><Field label="Valid for"><NumInput value={edit.pack.validityDays} onChange={v => sub('pack', 'validityDays', v)} suffix="days" /></Field></div>}
          <div className="grid sm:grid-cols-2 gap-3"><Toggle checked={edit.isActive} onChange={v => e('isActive', v)} label="Available in store" /><Field label="Sort order"><NumInput value={edit.sortOrder} onChange={v => e('sortOrder', v)} /></Field></div>
        </div>}
      </Modal>
    </div>
  );
};
