import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, Plus, Pencil, Trash2, RotateCcw, Image as ImageIcon, Upload, Copy, Eye, MousePointerClick, Power } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, Toggle, cx, useToast } from '../../components/ui/kit';
import type { AdItem } from '../../types';

const PLACEMENTS: [string, string, string][] = [
  ['overview', 'Servers overview', 'Below the server list (the main page after login and payment)'],
  ['create', 'Create server', 'Under the creation wizard'],
  ['console', 'Server page', 'Bottom of every server page'],
  ['store', 'Store & Earn', 'Under the store and earn pages'],
  ['footer', 'Every panel page', 'Footer banner across the whole panel'],
  ['reward', 'Rewarded (earn / renew)', 'Shown full-size while users earn coins or renew; never passive'],
];
const TYPES = [['banner', 'Banner'], ['image', 'Image only'], ['card', 'Card (text + CTA)'], ['sponsored', 'Sponsored card']];
const blank = (): any => ({ title: '', description: '', imageUrl: '', destinationUrl: '', type: 'banner', placement: 'overview', priority: 5, frequencyCapPerSession: 0, ctaLabel: '', badge: 'AD', showToPremium: false, maxImpressions: 0, maxClicks: 0, startDate: '', endDate: '', isActive: true });
interface Media { id: string; filename: string; url: string; size: number }
interface Day { date: string; impressions: number; clicks: number }

export const AdminAds: React.FC<{ onNavigate?: (p: string) => void }> = ({ onNavigate }) => {
  const [toast, say] = useToast();
  const [ads, setAds] = useState<(AdItem & { maxImpressions?: number })[] | null>(null);
  const [series, setSeries] = useState<Day[]>([]);
  const [globalOn, setGlobalOn] = useState(true);
  const [media, setMedia] = useState<Media[]>([]);
  const [tab, setTab] = useState<'campaigns' | 'media'>('campaigns');
  const [edit, setEdit] = useState<any>(null); const [pick, setPick] = useState(false); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [a, m] = await Promise.all([apiRequest<any>('/ads/admin/list'), apiRequest<Media[]>('/admin/hosting/media')]);
    if (a.success) { setAds(a.ads); setSeries(a.series || []); setGlobalOn(a.settings?.globalEnabled !== false); }
    if (m.success && m.data) setMedia(m.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!ads) return <Spinner />;
  const e = (k: string, v: any) => setEdit((c: any) => ({ ...c, [k]: v }));
  const maxBar = Math.max(1, ...series.map(s => s.impressions));
  const totals = ads.reduce((a, x) => ({ i: a.i + (x.impressions || 0), c: a.c + (x.clicks || 0) }), { i: 0, c: 0 });

  const save = async () => {
    setBusy(true);
    const body = { ...edit, startDate: edit.startDate ? new Date(edit.startDate).toISOString() : undefined, endDate: edit.endDate ? new Date(edit.endDate).toISOString() : undefined };
    const r = await apiRequest(edit.id ? `/ads/admin/${edit.id}` : '/ads/admin/create', { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); setBusy(false);
    if (r.success) { say('success', 'Campaign saved'); setEdit(null); load(); } else say('error', r.error?.message || 'Failed');
  };
  const toggle = async (a: AdItem) => { await apiRequest(`/ads/admin/${a.id}`, { method: 'PUT', body: JSON.stringify({ ...a, isActive: !a.isActive }) }); load(); };
  const del = async (a: AdItem) => { if (window.confirm(`Delete "${a.title}"?`)) { await apiRequest(`/ads/admin/${a.id}`, { method: 'DELETE' }); load(); } };
  const reset = async (a: AdItem) => { if (window.confirm('Reset this campaign\'s statistics?')) { await apiRequest(`/ads/admin/${a.id}/reset-stats`, { method: 'POST' }); load(); } };
  const globalToggle = async (on: boolean) => {
    const s = await apiRequest('/admin/hosting/settings'); if (!s.success) return say('error', 'Could not load settings');
    const { plans: _p, ...body } = s.data; body.ads = { ...body.ads, globalEnabled: on };
    const r = await apiRequest('/admin/hosting/settings', { method: 'PUT', body: JSON.stringify(body) }); if (r.success) { setGlobalOn(on); say('success', on ? 'Ads enabled platform-wide' : 'All ads are now hidden'); } else say('error', r.error?.message || 'Failed');
  };
  const upload = async (f: File) => {
    if (f.size > 3 * 1024 * 1024) return say('error', 'Max 3 MB. Use PNG, JPEG, GIF or WebP.');
    const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); });
    const r = await apiRequest('/admin/hosting/media', { method: 'POST', body: JSON.stringify({ filename: f.name, data }) });
    if (r.success) { say('success', 'Uploaded'); await load(); if (pick && edit) e('imageUrl', r.data.url); setPick(false); } else say('error', r.error?.message || 'Upload failed');
  };
  const delMedia = async (m: Media) => { if (window.confirm('Delete this image? Campaigns using it will show no image.')) { await apiRequest(`/admin/hosting/media/${m.id}`, { method: 'DELETE' }); load(); } };

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Megaphone className="h-6 w-6 text-amber-400" />} title="Ad Center" subtitle="Run ads and banners across the whole platform: pick where they appear, upload images, schedule campaigns and watch performance."
        actions={<><Btn onClick={() => onNavigate?.('admin-hosting-settings')}>Renewal ads</Btn><Btn variant="primary" onClick={() => setEdit(blank())}><Plus className="h-4 w-4" />New campaign</Btn></>} />

      <div className="grid sm:grid-cols-4 gap-3">
        <Card className="flex items-center justify-between sm:col-span-1"><div><p className="text-[10px] font-mono uppercase text-zinc-500">Platform ads</p><p className={cx('text-sm font-bold mt-1', globalOn ? 'text-emerald-400' : 'text-red-400')}>{globalOn ? 'Running' : 'Paused'}</p></div><Toggle checked={globalOn} onChange={globalToggle} /></Card>
        <Card><p className="text-[10px] font-mono uppercase text-zinc-500 flex items-center gap-1"><Eye className="h-3 w-3" />Views</p><p className="text-xl font-extrabold text-white mt-1">{totals.i.toLocaleString()}</p></Card>
        <Card><p className="text-[10px] font-mono uppercase text-zinc-500 flex items-center gap-1"><MousePointerClick className="h-3 w-3" />Clicks</p><p className="text-xl font-extrabold text-white mt-1">{totals.c.toLocaleString()}</p></Card>
        <Card><p className="text-[10px] font-mono uppercase text-zinc-500">CTR</p><p className="text-xl font-extrabold text-amber-300 mt-1">{totals.i ? ((totals.c / totals.i) * 100).toFixed(2) : '0.00'}%</p></Card>
      </div>
      <Card><p className="text-[10px] font-mono uppercase text-zinc-500 mb-3">Last 14 days · views</p>
        <div className="flex items-end gap-1 h-20" role="img" aria-label="Ad views over the last 14 days">{series.map(s => <div key={s.date} className="flex-1 flex flex-col justify-end group relative" title={`${s.date}: ${s.impressions} views, ${s.clicks} clicks`}><div className="bg-amber-500/70 group-hover:bg-amber-400 rounded-t" style={{ height: `${(s.impressions / maxBar) * 100}%`, minHeight: s.impressions ? 2 : 0 }} /></div>)}</div></Card>

      <div className="flex gap-1 border-b border-zinc-800">{(['campaigns', 'media'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={cx('px-4 py-2.5 text-xs font-semibold border-b-2', tab === t ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500')}>{t === 'campaigns' ? `Campaigns (${ads.length})` : `Media library (${media.length})`}</button>)}</div>

      {tab === 'campaigns' && (ads.length === 0 ? <Card><Empty icon={<Megaphone className="h-12 w-12" />} title="No campaigns yet" text="Create a banner, choose where it shows, and it goes live instantly." action={<Btn variant="primary" onClick={() => setEdit(blank())}>Create a campaign</Btn>} /></Card> : (
        <div className="grid lg:grid-cols-2 gap-3">{ads.map(a => { const live = a.isActive; const ctr = a.impressions ? ((a.clicks / a.impressions) * 100).toFixed(1) : '0.0'; return (
          <Card key={a.id} className={cx('flex gap-3', !live && 'opacity-60')}>
            <div className="h-16 w-24 shrink-0 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center">{a.imageUrl ? <img src={a.imageUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-zinc-700" />}</div>
            <div className="min-w-0 flex-1 space-y-1.5"><p className="text-sm font-bold text-white truncate flex items-center gap-2">{a.title}<Badge tone={live ? 'green' : 'zinc'}>{live ? 'Active' : 'Paused'}</Badge></p>
              <p className="text-[11px] text-zinc-500">{PLACEMENTS.find(p => p[0] === (a.placement === 'dashboard' ? 'overview' : a.placement))?.[1] || a.placement} · priority {a.priority}</p>
              <p className="text-[11px] font-mono text-zinc-400">{(a.impressions || 0).toLocaleString()} views · {(a.clicks || 0).toLocaleString()} clicks · {ctr}% CTR</p>
              <div className="flex gap-1.5 pt-1"><Btn size="sm" onClick={() => setEdit({ ...blank(), ...a, startDate: a.startDate?.slice(0, 16) || '', endDate: a.endDate?.slice(0, 16) || '' })}><Pencil className="h-3.5 w-3.5" /></Btn><Btn size="sm" onClick={() => toggle(a)} aria-label="Toggle"><Power className="h-3.5 w-3.5" /></Btn><Btn size="sm" onClick={() => reset(a)} aria-label="Reset stats"><RotateCcw className="h-3.5 w-3.5" /></Btn><Btn size="sm" variant="danger" className="ml-auto" onClick={() => del(a)}><Trash2 className="h-3.5 w-3.5" /></Btn></div></div>
          </Card>); })}</div>))}

      {tab === 'media' && <Card className="space-y-4"><div className="flex items-center justify-between"><p className="text-xs text-zinc-400">Upload banners and images (PNG, JPEG, GIF, WebP · max 3 MB). SVG is blocked for safety.</p><Btn variant="primary" onClick={() => file.current?.click()}><Upload className="h-4 w-4" />Upload</Btn></div>
        {media.length === 0 ? <Empty icon={<ImageIcon className="h-10 w-10" />} title="No images uploaded" /> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{media.map(m => <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden group"><img src={m.url} alt={m.filename} className="h-24 w-full object-cover" loading="lazy" /><div className="p-2 flex items-center gap-1"><span className="text-[10px] text-zinc-500 truncate flex-1">{m.filename}</span><button onClick={() => navigator.clipboard?.writeText(location.origin + m.url).then(() => say('success', 'URL copied'))} className="p-1 text-zinc-500 hover:text-amber-300" aria-label="Copy URL"><Copy className="h-3 w-3" /></button><button onClick={() => delMedia(m)} className="p-1 text-zinc-500 hover:text-red-400" aria-label="Delete"><Trash2 className="h-3 w-3" /></button></div></div>)}</div>}</Card>}
      <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={ev => { const f = ev.target.files?.[0]; if (f) upload(f); ev.target.value = ''; }} />

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? 'Edit campaign' : 'New campaign'} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!edit?.title || !edit?.destinationUrl} onClick={save}>Save campaign</Btn></>}>
        {edit && <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Title"><TextInput value={edit.title} maxLength={120} onChange={ev => e('title', ev.target.value)} /></Field><Field label="Destination URL" hint="https://… or a site path like /pricing"><TextInput value={edit.destinationUrl} onChange={ev => e('destinationUrl', ev.target.value)} className="font-mono text-xs" /></Field></div>
          <Field label="Description (for card style)"><TextInput value={edit.description} maxLength={300} onChange={ev => e('description', ev.target.value)} /></Field>
          <Field label="Banner / image"><div className="flex gap-2"><TextInput value={edit.imageUrl || ''} onChange={ev => e('imageUrl', ev.target.value)} placeholder="Paste an image URL or choose from the library" className="font-mono text-xs" /><Btn onClick={() => setPick(true)}><ImageIcon className="h-4 w-4" />Library</Btn></div></Field>
          {edit.imageUrl && <img src={edit.imageUrl} alt="Preview" className="max-h-24 rounded-xl border border-zinc-800" />}
          <div className="grid sm:grid-cols-2 gap-3"><Field label="Where it appears" hint={PLACEMENTS.find(p => p[0] === edit.placement)?.[2]}><Select value={edit.placement === 'dashboard' ? 'overview' : edit.placement} onChange={ev => e('placement', ev.target.value)}>{PLACEMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><Field label="Style"><Select value={edit.type} onChange={ev => e('type', ev.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Field label="Priority"><NumInput value={edit.priority} min={0} max={100} onChange={v => e('priority', v)} /></Field><Field label="Button text"><TextInput value={edit.ctaLabel || ''} maxLength={30} onChange={ev => e('ctaLabel', ev.target.value)} placeholder="Learn more" /></Field><Field label="Badge"><TextInput value={edit.badge || ''} maxLength={20} onChange={ev => e('badge', ev.target.value)} /></Field><Field label="Per-session cap" hint="0 = ∞"><NumInput value={edit.frequencyCapPerSession} onChange={v => e('frequencyCapPerSession', v)} /></Field></div>
          <div className="grid sm:grid-cols-4 gap-3"><Field label="Start"><TextInput type="datetime-local" value={edit.startDate || ''} onChange={ev => e('startDate', ev.target.value)} /></Field><Field label="End"><TextInput type="datetime-local" value={edit.endDate || ''} onChange={ev => e('endDate', ev.target.value)} /></Field><Field label="Max views" hint="0 = ∞"><NumInput value={edit.maxImpressions} onChange={v => e('maxImpressions', v)} /></Field><Field label="Max clicks" hint="0 = ∞"><NumInput value={edit.maxClicks} onChange={v => e('maxClicks', v)} /></Field></div>
          <div className="grid sm:grid-cols-2 gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3.5"><Toggle checked={edit.isActive} onChange={v => e('isActive', v)} label="Active" /><Toggle checked={edit.showToPremium} onChange={v => e('showToPremium', v)} label="Show to paying users" hint="Normally premium plans are ad-free" /></div>
        </div>}
      </Modal>
      <Modal open={pick} onClose={() => setPick(false)} title="Choose an image" footer={<Btn variant="primary" onClick={() => file.current?.click()}><Upload className="h-4 w-4" />Upload new</Btn>}>
        {media.length === 0 ? <p className="text-xs text-zinc-500 text-center py-6">Nothing uploaded yet.</p> : <div className="grid grid-cols-3 gap-2">{media.map(m => <button key={m.id} onClick={() => { e('imageUrl', m.url); setPick(false); }} className="rounded-lg overflow-hidden border border-zinc-800 hover:border-amber-500"><img src={m.url} alt={m.filename} className="h-20 w-full object-cover" /></button>)}</div>}
      </Modal>
    </div>
  );
};
