import React, { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Pencil, Trash2, Star, Power } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Spinner, TextInput, Toggle, cx, useToast } from '../../components/ui/kit';
import type { Addon } from '../../hostingTypes';

const blank = (): any => ({ name: '', category: 'Plugins', author: '', version: '1.0.0', description: '', iconUrl: '', priceCoins: 0, priceMoney: 0, isActive: true, featured: false, compatibleImageIds: [], files: [{ url: '', path: '/', extract: false }], postCommand: '', restartAfter: false });

export const AdminAddons: React.FC = () => {
  const [toast, say] = useToast();
  const [items, setItems] = useState<Addon[] | null>(null);
  const [images, setImages] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState<any>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiRequest<any>('/admin/hosting/addons'); if (r.success && r.data) { setItems(r.data.items); setImages(r.data.images); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!items) return <Spinner />;
  const e = (k: string, v: any) => setEdit((c: any) => ({ ...c, [k]: v }));
  const setFile = (i: number, patch: any) => e('files', edit.files.map((f: any, j: number) => (j === i ? { ...f, ...patch } : f)));

  const save = async () => {
    setBusy(true);
    const r = await apiRequest(edit.id ? `/admin/hosting/addons/${edit.id}` : '/admin/hosting/addons', { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(edit) }); setBusy(false);
    if (r.success) { say('success', 'Addon saved'); setEdit(null); load(); } else say('error', r.error?.message || 'Failed');
  };
  const toggle = async (a: Addon) => { await apiRequest(`/admin/hosting/addons/${a.id}`, { method: 'PUT', body: JSON.stringify({ ...a, isActive: !a.isActive }) }); load(); };
  const del = async (a: Addon) => {
    if (!window.confirm(`Delete "${a.name}"?`)) return;
    let r = await apiRequest(`/admin/hosting/addons/${a.id}`, { method: 'DELETE' });
    if (!r.success && window.confirm(`${r.error?.message}\n\nDelete anyway?`)) r = await apiRequest(`/admin/hosting/addons/${a.id}?force=1`, { method: 'DELETE' });
    if (r.success) { say('success', 'Deleted'); load(); }
  };

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Package className="h-6 w-6 text-amber-400" />} title="Addon Store" subtitle="Your own marketplace: plugins, mods and templates that users install into their servers with one click. Free, or priced in coins and/or credits."
        actions={<Btn variant="primary" onClick={() => setEdit(blank())}><Plus className="h-4 w-4" />New addon</Btn>} />
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-[11px] text-zinc-400">Addons are <b className="text-zinc-200">file downloads</b>: the node fetches each URL (private/internal addresses are blocked), writes it to the path you set and can unpack .zip/.tar.gz. They never run scripts on your nodes. The two bundled examples are disabled until you replace their placeholder URLs.</div>
      {items.length === 0 ? <Card><Empty icon={<Package className="h-12 w-12" />} title="No addons yet" action={<Btn variant="primary" onClick={() => setEdit(blank())}>Create the first addon</Btn>} /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{items.map(a => (
          <Card key={a.id} className={cx('space-y-3', !a.isActive && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-bold text-white truncate flex items-center gap-1.5">{a.name}{a.featured && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}</p><p className="text-[11px] text-zinc-500">{a.category} · v{a.version} · {a.author}</p></div><Badge tone={a.isActive ? 'green' : 'zinc'}>{a.isActive ? 'Live' : 'Off'}</Badge></div>
            <p className="text-xs text-zinc-400 line-clamp-2">{a.description}</p>
            <div className="flex flex-wrap gap-1"><Badge tone="amber">{a.priceCoins || a.priceMoney ? [a.priceCoins ? `${a.priceCoins} coins` : '', a.priceMoney ? `$${a.priceMoney}` : ''].filter(Boolean).join(' / ') : 'Free'}</Badge><Badge>{a.installs} installs</Badge><Badge>{a.files.length} file{a.files.length === 1 ? '' : 's'}</Badge><Badge>{a.compatibleImageIds.length ? `${a.compatibleImageIds.length} image(s)` : 'All images'}</Badge></div>
            <div className="flex gap-1.5 pt-2 border-t border-zinc-800"><Btn size="sm" onClick={() => setEdit(JSON.parse(JSON.stringify({ ...blank(), ...a, postCommand: a.postCommand || '' })))}><Pencil className="h-3.5 w-3.5" />Edit</Btn><Btn size="sm" onClick={() => toggle(a)}><Power className="h-3.5 w-3.5" />{a.isActive ? 'Disable' : 'Enable'}</Btn><Btn size="sm" variant="danger" className="ml-auto" onClick={() => del(a)}><Trash2 className="h-3.5 w-3.5" /></Btn></div>
          </Card>))}</div>)}

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? `Edit ${edit.name}` : 'New addon'} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!edit?.name || !edit?.files?.[0]?.url} onClick={save}>Save addon</Btn></>}>
        {edit && <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Name"><TextInput value={edit.name} onChange={ev => e('name', ev.target.value)} /></Field><Field label="Category"><TextInput value={edit.category} onChange={ev => e('category', ev.target.value)} placeholder="Plugins" /></Field><Field label="Author"><TextInput value={edit.author} onChange={ev => e('author', ev.target.value)} /></Field><Field label="Version"><TextInput value={edit.version} onChange={ev => e('version', ev.target.value)} /></Field></div>
          <Field label="Description"><TextInput value={edit.description} maxLength={500} onChange={ev => e('description', ev.target.value)} /></Field>
          <Field label="Icon URL (optional)"><TextInput value={edit.iconUrl || ''} onChange={ev => e('iconUrl', ev.target.value)} className="font-mono text-xs" placeholder="https://… or /api/v1/media/…" /></Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Field label="Price (coins)" hint="0 = free"><NumInput value={edit.priceCoins} onChange={v => e('priceCoins', v)} /></Field><Field label="Price (credits)"><NumInput value={edit.priceMoney} step={0.5} onChange={v => e('priceMoney', v)} /></Field><div className="pt-5"><Toggle checked={edit.isActive} onChange={v => e('isActive', v)} label="Live" /></div><div className="pt-5"><Toggle checked={edit.featured} onChange={v => e('featured', v)} label="Featured" /></div></div>
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Works with <span className="normal-case text-zinc-600">(none selected = every image)</span></p><div className="flex flex-wrap gap-1.5">{images.map(i => { const on = edit.compatibleImageIds.includes(i.id); return <button type="button" key={i.id} onClick={() => e('compatibleImageIds', on ? edit.compatibleImageIds.filter((x: string) => x !== i.id) : [...edit.compatibleImageIds, i.id])} className={cx('px-3 py-1.5 rounded-lg text-xs border', on ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-zinc-800 text-zinc-500')}>{i.name}</button>; })}</div></div>
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Files to install</p>
            {edit.files.map((f: any, i: number) => <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1.4fr_auto_auto] gap-2 mb-2 items-center rounded-xl border border-zinc-800 bg-zinc-950 p-2.5"><TextInput className="font-mono text-xs" placeholder="https://download-url" value={f.url} onChange={ev => setFile(i, { url: ev.target.value })} /><TextInput className="font-mono text-xs" placeholder="/plugins/name.jar" value={f.path} onChange={ev => setFile(i, { path: ev.target.value })} /><Toggle checked={f.extract} onChange={v => setFile(i, { extract: v })} label="Unpack" /><Btn size="sm" variant="danger" disabled={edit.files.length <= 1} onClick={() => e('files', edit.files.filter((_: any, j: number) => j !== i))}><Trash2 className="h-3 w-3" /></Btn></div>)}
            <Btn size="sm" disabled={edit.files.length >= 20} onClick={() => e('files', [...edit.files, { url: '', path: '/', extract: false }])}><Plus className="h-3 w-3" />Add file</Btn></div>
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Console command after install" hint="Sent only if the server is running, e.g. reload"><TextInput className="font-mono text-xs" value={edit.postCommand || ''} onChange={ev => e('postCommand', ev.target.value)} /></Field><div className="pt-5"><Toggle checked={edit.restartAfter} onChange={v => e('restartAfter', v)} label="Restart server after install" /></div></div>
        </div>}
      </Modal>
    </div>
  );
};
