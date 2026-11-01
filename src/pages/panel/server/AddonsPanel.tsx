import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Search, Star, Check, Coins, Trash2, Download } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { usePanel } from '../../../components/panel/PanelContext';
import { Badge, Btn, Card, Empty, Modal, Spinner, TextInput, cx, fmtDate, money } from '../../../components/ui/kit';

interface Item { id: string; name: string; description: string; iconUrl?: string; category: string; author: string; version: string; priceCoins: number; priceMoney: number; featured: boolean; installs: number; restartAfter: boolean; compatible: boolean; installed: boolean; works: string[] }
interface Catalog { categories: string[]; coinName: string; items: Item[] }
interface Installed { id: string; addonId: string; name: string; version: string; currentVersion?: string; installedAt: string }

/** Browse, buy and install addons for one server; also lists and removes what is installed. Shared by the Addon Store page and the server tab. */
export const AddonsPanel: React.FC<{ serverId: string; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, notify }) => {
  const { data: panel, refresh } = usePanel();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [q, setQ] = useState(''); const [category, setCategory] = useState('');
  const [buy, setBuy] = useState<Item | null>(null); const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const [c, i] = await Promise.all([apiRequest<Catalog>(`/hosting/addons?serverId=${serverId}`), apiRequest<Installed[]>(`/hosting/servers/${serverId}/addons`)]);
    if (c.success && c.data) setCat(c.data); else if (!c.success) notify('error', c.error?.message || 'Could not load addons');
    if (i.success && i.data) setInstalled(i.data);
  }, [serverId]);
  useEffect(() => { setCat(null); load(); }, [load]);

  const shown = useMemo(() => (cat?.items || []).filter(a => a.compatible && (!category || a.category === category) && (!q || (a.name + a.description).toLowerCase().includes(q.toLowerCase()))), [cat, q, category]);
  if (!cat) return <Spinner />;
  const coin = cat.coinName;

  const install = async (a: Item, payWith: 'coins' | 'credits') => {
    setBusy(a.id + payWith);
    const r = await apiRequest(`/hosting/servers/${serverId}/addons/${a.id}/install`, { method: 'POST', body: JSON.stringify({ payWith }) });
    setBusy('');
    if (r.success) { notify('success', `${a.name} installed`); setBuy(null); await Promise.all([load(), refresh()]); } else notify('error', r.error?.message || 'Install failed');
  };
  const uninstall = async (i: Installed) => { if (!window.confirm(`Remove ${i.name}? Its files are deleted from the server.`)) return; setBusy('u' + i.id); const r = await apiRequest(`/hosting/servers/${serverId}/addons/${i.id}`, { method: 'DELETE' }); setBusy(''); if (r.success) { notify('success', 'Removed'); load(); } else notify('error', r.error?.message || 'Failed'); };
  const priceText = (a: Item) => (a.priceCoins || a.priceMoney ? [a.priceCoins ? `${a.priceCoins} ${coin}` : '', a.priceMoney ? money(a.priceMoney, panel?.currencySymbol) : ''].filter(Boolean).join(' or ') : 'Free');

  return (
    <div className="space-y-4">
      {installed.length > 0 && (
        <Card className="!p-0 overflow-hidden"><h3 className="text-xs font-bold text-white px-4 py-3 border-b border-zinc-800">Installed on this server</h3>
          <ul className="divide-y divide-zinc-800/70">{installed.map(i => (
            <li key={i.id} className="px-4 py-2.5 flex items-center gap-3 text-xs"><Package className="h-4 w-4 text-zinc-500 shrink-0" /><span className="flex-1 min-w-0"><b className="text-zinc-100">{i.name}</b> <span className="text-zinc-600">v{i.version} · {fmtDate(i.installedAt)}</span>{i.currentVersion && i.currentVersion !== i.version && <Badge tone="amber" className="ml-2">v{i.currentVersion} available</Badge>}</span>
              <Btn size="sm" variant="danger" busy={busy === 'u' + i.id} onClick={() => uninstall(i)}><Trash2 className="h-3 w-3" />Remove</Btn></li>))}</ul></Card>)}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" /><TextInput className="pl-9" placeholder="Search addons…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">{['', ...cat.categories].map(c => <button key={c || 'all'} onClick={() => setCategory(c)} className={cx('px-3 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap', category === c ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-zinc-800 text-zinc-500 hover:text-zinc-200')}>{c || 'All'}</button>)}</div>
      </div>

      {shown.length === 0 ? <Card><Empty icon={<Package className="h-10 w-10" />} title="No addons found" text={cat.items.length === 0 ? 'The store has no addons yet.' : 'Nothing matches your filters, or nothing is compatible with this server\'s software.'} /></Card> : (
        <div className="grid sm:grid-cols-2 gap-3">{shown.map(a => (
          <Card key={a.id} className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 shrink-0 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center">{a.iconUrl ? <img src={a.iconUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-amber-400" />}</div>
              <div className="min-w-0"><p className="text-sm font-bold text-white flex items-center gap-1.5 truncate">{a.name}{a.featured && <Star className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />}</p><p className="text-[11px] text-zinc-500">{a.category} · by {a.author} · v{a.version}</p></div>
            </div>
            <p className="text-xs text-zinc-400 line-clamp-3 flex-1">{a.description}</p>
            <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
              <span className={cx('text-xs font-bold flex items-center gap-1', a.priceCoins || a.priceMoney ? 'text-amber-300' : 'text-emerald-400')}>{a.priceCoins > 0 && <Coins className="h-3.5 w-3.5" />}{priceText(a)}</span>
              {a.installed ? <Badge tone="green"><Check className="h-3 w-3 mr-1" />Installed</Badge> : <Btn size="sm" variant="primary" onClick={() => (a.priceCoins || a.priceMoney ? setBuy(a) : install(a, 'coins'))} busy={busy === a.id + 'coins'}><Download className="h-3.5 w-3.5" />Install</Btn>}
            </div>
          </Card>))}</div>)}

      <Modal open={!!buy} onClose={() => setBuy(null)} title={buy ? `Install ${buy.name}` : ''} footer={buy && <>
        <Btn onClick={() => setBuy(null)}>Cancel</Btn>
        {buy.priceMoney > 0 && <Btn busy={busy === buy.id + 'credits'} disabled={(panel?.user.credits ?? 0) < buy.priceMoney} onClick={() => install(buy, 'credits')}>Pay {money(buy.priceMoney, panel?.currencySymbol)} credits</Btn>}
        {buy.priceCoins > 0 && <Btn variant="primary" busy={busy === buy.id + 'coins'} disabled={(panel?.user.coins ?? 0) < buy.priceCoins} onClick={() => install(buy, 'coins')}><Coins className="h-3.5 w-3.5" />{buy.priceCoins} {coin}</Btn>}</>}>
        {buy && <div className="space-y-3 text-xs text-zinc-300"><p>{buy.description}</p><p className="text-zinc-500">Works with: {buy.works.join(', ')}.{buy.restartAfter && ' The server restarts after installing.'}</p>
          {buy.priceCoins > 0 && (panel?.user.coins ?? 0) < buy.priceCoins && <p className="text-red-300">You need {(buy.priceCoins - (panel?.user.coins ?? 0)).toLocaleString()} more {coin}.</p>}</div>}
      </Modal>
    </div>
  );
};
