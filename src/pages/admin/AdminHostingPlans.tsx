import React, { useCallback, useEffect, useState } from 'react';
import { Crown, Plus, Pencil, Trash2, Star, Server, Cpu, MemoryStick, HardDrive, Clock, Save, Eye, EyeOff } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextArea, TextInput, Toggle, cx, fmtMB, money, useToast } from '../../components/ui/kit';
import type { BillingPeriod, HostingPlan } from '../../hostingTypes';

const blankPlan = (): any => ({ name: '', tagline: '', isFree: false, isActive: true, isPopular: false, sortOrder: 10, monthlyPrice: 5, priceOverrides: {}, serverLimit: 3, perServer: { ramMB: 1024, cpuPercent: 100, diskMB: 2048, swapMB: 0, backups: 2, databases: 0, ports: 0, pids: 512 }, accountCaps: { ramMB: 0, cpuPercent: 0, diskMB: 0 }, features: { noAds: true, directRenewal: true, subusers: false, scheduledTasks: false, backups: true, chooseNode: false, switchNode: false, discordRole: false, giveaways: false }, renewal: { validityDays: 0, methods: ['payment'] }, highlights: [] });
const FEATURES: [string, string, string][] = [['noAds', 'No ads', 'Hide all ads for this plan'], ['directRenewal', 'Direct renewal', 'Renew without watching ads'], ['backups', 'Backups', 'Create and restore backups'], ['subusers', 'Subusers', 'Invite team members'], ['scheduledTasks', 'Scheduled tasks', ''], ['chooseNode', 'Choose node', 'Pick a node when deploying'], ['switchNode', 'Switch nodes', 'Move servers between nodes'], ['discordRole', 'Discord role', ''], ['giveaways', 'Exclusive giveaways', '']];
const METHODS: [string, string][] = [['ads', 'Watch an ad'], ['blog', 'Read an article'], ['coins', 'Spend coins'], ['payment', 'Pay (plan renewal)']];

export const AdminHostingPlans: React.FC = () => {
  const [toast, say] = useToast();
  const [plans, setPlans] = useState<HostingPlan[] | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [tab, setTab] = useState<'general' | 'limits' | 'features' | 'renewal'>('general');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([apiRequest<HostingPlan[]>('/admin/hosting/plans'), apiRequest('/admin/hosting/settings')]);
    if (p.success && p.data) setPlans(p.data); if (s.success) setSettings(s.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!plans || !settings) return <Spinner />;

  const periods: BillingPeriod[] = settings.periods;
  const setPeriod = (i: number, k: keyof BillingPeriod, v: any) => setSettings({ ...settings, periods: periods.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const saveSettings = async () => {
    setBusy('settings'); const { plans: _p, ...body } = settings;
    const r = await apiRequest('/admin/hosting/settings', { method: 'PUT', body: JSON.stringify(body) }); setBusy('');
    say(r.success ? 'success' : 'error', r.success ? 'Billing periods saved' : r.error?.message || 'Failed'); if (r.success) load();
  };
  const savePlan = async () => {
    setBusy('plan'); const body = { ...edit, highlights: Array.isArray(edit.highlights) ? edit.highlights : String(edit.highlights).split('\n') };
    const r = await apiRequest(edit.id ? `/admin/hosting/plans/${edit.id}` : '/admin/hosting/plans', { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); setBusy('');
    if (r.success) { say('success', 'Plan saved'); setEdit(null); load(); } else say('error', r.error?.message || 'Failed');
  };
  const del = async (p: HostingPlan) => { if (!window.confirm(`Delete plan "${p.name}"? Accounts on it fall back to the free plan.`)) return; const r = await apiRequest(`/admin/hosting/plans/${p.id}`, { method: 'DELETE' }); say(r.success ? 'success' : 'error', r.success ? 'Deleted' : r.error?.message || 'Failed'); load(); };
  const toggle = async (p: HostingPlan) => { const r = await apiRequest(`/admin/hosting/plans/${p.id}`, { method: 'PUT', body: JSON.stringify({ ...p, isActive: !p.isActive }) }); if (r.success) load(); };
  const e = (path: string[], v: any) => setEdit((cur: any) => { const n = { ...cur }; let o = n; path.slice(0, -1).forEach(k => { o[k] = { ...o[k] }; o = o[k]; }); o[path[path.length - 1]] = v; return n; });

  return (
    <div className="space-y-6">
      {toast}
      <PageHeader icon={<Crown className="h-6 w-6 text-amber-400" />} title="Plans & Resource Limits" subtitle="Everything a plan gives: price per billing period, how many servers an account can create, the specs every server receives, and perks. All of it is yours to change."
        actions={<Btn variant="primary" onClick={() => { setEdit(blankPlan()); setTab('general'); }}><Plus className="h-4 w-4" />New plan</Btn>} />

      {/* Billing periods */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2"><div><h2 className="text-sm font-bold text-white">Billing periods</h2><p className="text-[11px] text-zinc-500">Monthly, half-yearly, yearly… add or remove periods. Price = monthly price × months × (1 − discount).</p></div><Btn variant="primary" size="sm" busy={busy === 'settings'} onClick={saveSettings}><Save className="h-3.5 w-3.5" />Save periods</Btn></div>
        <div className="space-y-2">{periods.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_110px_auto] sm:grid-cols-[160px_100px_120px_1fr_auto] gap-2 items-end">
            <Field label={i === 0 ? 'Label' : ''}><TextInput value={p.label} onChange={ev => setPeriod(i, 'label', ev.target.value)} /></Field>
            <Field label={i === 0 ? 'Months' : ''}><NumInput value={p.months} min={1} max={60} onChange={v => setPeriod(i, 'months', v)} /></Field>
            <Field label={i === 0 ? 'Discount' : ''}><NumInput value={p.discountPercent} min={0} max={90} onChange={v => setPeriod(i, 'discountPercent', v)} suffix="%" /></Field>
            <span className="hidden sm:block text-[11px] text-zinc-600 pb-3 font-mono">id: {p.id}</span>
            <Btn size="sm" variant="danger" disabled={periods.length <= 1} onClick={() => setSettings({ ...settings, periods: periods.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Btn>
          </div>))}</div>
        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-zinc-800">
          <Btn size="sm" disabled={periods.length >= 8} onClick={() => setSettings({ ...settings, periods: [...periods, { id: `p${Date.now().toString(36).slice(-4)}`, label: 'New period', months: 3, discountPercent: 0 }] })}><Plus className="h-3.5 w-3.5" />Add period</Btn>
          <Field label="Default free plan" className="w-56"><Select value={settings.freePlanId} onChange={ev => setSettings({ ...settings, freePlanId: ev.target.value })}>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </div>
      </Card>

      {/* Plans */}
      {plans.length === 0 ? <Card><Empty icon={<Crown className="h-12 w-12" />} title="No plans" /></Card> : (
        <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map(p => (
            <Card key={p.id} accent={p.isPopular} className={cx('space-y-4 flex flex-col', !p.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2"><div><p className="text-base font-extrabold text-white flex items-center gap-2">{p.name}{p.isPopular && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />}</p><p className="text-[11px] text-zinc-500 mt-0.5">{p.tagline}</p></div><div className="flex flex-col items-end gap-1">{p.isFree && <Badge tone="green">Free</Badge>}{!p.isActive && <Badge>Hidden</Badge>}{settings.freePlanId === p.id && <Badge tone="blue">Default</Badge>}</div></div>
              <p className="text-2xl font-extrabold text-amber-300">{p.isFree ? 'Free' : <>{money(p.monthlyPrice)}<span className="text-xs text-zinc-500 font-medium">/mo</span></>}</p>
              {!p.isFree && <div className="flex flex-wrap gap-1">{periods.map(per => { const ov = p.priceOverrides?.[per.id]; const total = ov ?? Math.round(p.monthlyPrice * per.months * (1 - per.discountPercent / 100) * 100) / 100; return <Badge key={per.id}>{per.label}: {money(total)}{ov !== undefined && '*'}</Badge>; })}</div>}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2 text-zinc-400 flex items-center gap-1.5"><Server className="h-3 w-3" /><b className="text-zinc-100">{p.serverLimit}</b> servers</div>
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2 text-zinc-400 flex items-center gap-1.5"><MemoryStick className="h-3 w-3" /><b className="text-zinc-100">{fmtMB(p.perServer.ramMB)}</b> RAM</div>
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2 text-zinc-400 flex items-center gap-1.5"><Cpu className="h-3 w-3" /><b className="text-zinc-100">{p.perServer.cpuPercent}%</b> CPU</div>
                <div className="rounded-lg bg-zinc-950 px-2.5 py-2 text-zinc-400 flex items-center gap-1.5"><HardDrive className="h-3 w-3" /><b className="text-zinc-100">{fmtMB(p.perServer.diskMB)}</b> disk</div>
                <div className="col-span-2 rounded-lg bg-zinc-950 px-2.5 py-2 text-zinc-400 flex items-center gap-1.5"><Clock className="h-3 w-3" />{p.renewal.validityDays ? `Servers live ${p.renewal.validityDays} days per renewal` : 'Servers last as long as the plan period'} · renew: {p.renewal.methods.join(', ') || 'none'}</div>
              </div>
              <div className="flex gap-2 mt-auto pt-3 border-t border-zinc-800"><Btn size="sm" onClick={() => { setEdit({ ...blankPlan(), ...p, highlights: p.highlights }); setTab('general'); }}><Pencil className="h-3.5 w-3.5" />Edit</Btn><Btn size="sm" onClick={() => toggle(p)}>{p.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{p.isActive ? 'Hide' : 'Show'}</Btn><Btn size="sm" variant="danger" className="ml-auto" onClick={() => del(p)}><Trash2 className="h-3.5 w-3.5" /></Btn></div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? `Edit ${edit.name}` : 'New plan'} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={busy === 'plan'} disabled={!edit?.name} onClick={savePlan}>Save plan</Btn></>}>
        {edit && <div className="space-y-5">
          <div className="flex gap-1 border-b border-zinc-800">{(['general', 'limits', 'features', 'renewal'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={cx('px-3.5 py-2 text-xs font-semibold capitalize border-b-2', tab === t ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500')}>{t}</button>)}</div>
          {tab === 'general' && <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Plan name"><TextInput value={edit.name} onChange={ev => e(['name'], ev.target.value)} /></Field><Field label="Tagline"><TextInput value={edit.tagline} onChange={ev => e(['tagline'], ev.target.value)} /></Field></div>
            <div className="grid sm:grid-cols-3 gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3.5"><Toggle checked={edit.isFree} onChange={v => e(['isFree'], v)} label="Free plan" hint="No payment needed" /><Toggle checked={edit.isActive} onChange={v => e(['isActive'], v)} label="Visible" /><Toggle checked={edit.isPopular} onChange={v => e(['isPopular'], v)} label="Highlighted" hint="Pre-selected on Upgrade" /></div>
            {!edit.isFree && <><Field label="Monthly price"><NumInput value={edit.monthlyPrice} min={0} step={0.5} onChange={v => e(['monthlyPrice'], v)} /></Field>
              <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Per-period price override <span className="normal-case text-zinc-600">(blank = automatic with the period discount)</span></p>
                <div className="grid sm:grid-cols-3 gap-3">{periods.map(per => { const auto = Math.round(edit.monthlyPrice * per.months * (1 - per.discountPercent / 100) * 100) / 100; return <Field key={per.id} label={`${per.label} · auto ${money(auto)}`}><TextInput type="number" step="0.01" min="0" value={edit.priceOverrides?.[per.id] ?? ''} placeholder={String(auto)} onChange={ev => { const o = { ...edit.priceOverrides }; if (ev.target.value === '') delete o[per.id]; else o[per.id] = Number(ev.target.value); e(['priceOverrides'], o); }} /></Field>; })}</div></div></>}
            <Field label="Sort order"><NumInput value={edit.sortOrder} onChange={v => e(['sortOrder'], v)} /></Field>
            <Field label="Highlights (one per line)"><TextArea value={Array.isArray(edit.highlights) ? edit.highlights.join('\n') : edit.highlights} onChange={ev => e(['highlights'], ev.target.value.split('\n'))} /></Field>
          </div>}
          {tab === 'limits' && <div className="space-y-5">
            <Field label="Servers an account can create" hint="The server creation limit for this plan."><NumInput value={edit.serverLimit} min={0} onChange={v => e(['serverLimit'], v)} /></Field>
            <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Specs every server on this plan receives</p><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="RAM"><NumInput value={edit.perServer.ramMB} onChange={v => e(['perServer', 'ramMB'], v)} suffix="MB" /></Field><Field label="CPU" hint="100 = 1 core"><NumInput value={edit.perServer.cpuPercent} onChange={v => e(['perServer', 'cpuPercent'], v)} suffix="%" /></Field>
              <Field label="Disk"><NumInput value={edit.perServer.diskMB} onChange={v => e(['perServer', 'diskMB'], v)} suffix="MB" /></Field><Field label="Swap"><NumInput value={edit.perServer.swapMB} onChange={v => e(['perServer', 'swapMB'], v)} suffix="MB" /></Field>
              <Field label="Backups"><NumInput value={edit.perServer.backups} onChange={v => e(['perServer', 'backups'], v)} /></Field><Field label="Databases"><NumInput value={edit.perServer.databases} onChange={v => e(['perServer', 'databases'], v)} /></Field>
              <Field label="Extra ports"><NumInput value={edit.perServer.ports} onChange={v => e(['perServer', 'ports'], v)} /></Field><Field label="Max processes"><NumInput value={edit.perServer.pids} onChange={v => e(['perServer', 'pids'], v)} /></Field></div></div>
            <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Whole-account ceilings <span className="normal-case text-zinc-600">(0 = unlimited)</span></p><div className="grid grid-cols-3 gap-3">
              <Field label="Total RAM"><NumInput value={edit.accountCaps.ramMB} onChange={v => e(['accountCaps', 'ramMB'], v)} suffix="MB" /></Field><Field label="Total CPU"><NumInput value={edit.accountCaps.cpuPercent} onChange={v => e(['accountCaps', 'cpuPercent'], v)} suffix="%" /></Field><Field label="Total disk"><NumInput value={edit.accountCaps.diskMB} onChange={v => e(['accountCaps', 'diskMB'], v)} suffix="MB" /></Field></div></div>
          </div>}
          {tab === 'features' && <div className="grid sm:grid-cols-2 gap-3">{FEATURES.map(([k, l, h]) => <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5"><Toggle checked={!!edit.features[k]} onChange={v => e(['features', k], v)} label={l} hint={h} /></div>)}</div>}
          {tab === 'renewal' && <div className="space-y-4">
            <Field label="Server lifetime per renewal (days)" hint="0 = servers expire when the paid plan period ends. Otherwise each server needs renewing every N days. After expiry a server is deleted 24 hours later (fixed, not configurable)."><NumInput value={edit.renewal.validityDays} min={0} onChange={v => e(['renewal', 'validityDays'], v)} suffix="days" /></Field>
            <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Allowed renewal methods</p><div className="grid sm:grid-cols-2 gap-2">{METHODS.map(([k, l]) => <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"><Toggle checked={edit.renewal.methods.includes(k)} onChange={v => e(['renewal', 'methods'], v ? [...edit.renewal.methods, k] : edit.renewal.methods.filter((m: string) => m !== k))} label={l} /></div>)}</div>
              <p className="text-[11px] text-zinc-600 mt-2">Each method also has to be switched on globally under Expiry &amp; Renewals.</p></div>
          </div>}
        </div>}
      </Modal>
    </div>
  );
};
