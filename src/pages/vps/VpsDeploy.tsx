import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Cloud, Cpu, HardDrive, MemoryStick, Wallet } from 'lucide-react';
import { Btn, Card, Empty, Field, Select, Spinner, TextInput, cx, fmtMB, money, useToast } from '../../components/ui/kit';
import { VpsSettingsPublic, vpsCall } from './vpsApi';

interface CatalogPlan { id: string; name: string; description: string; cpu: number; ramMb: number; diskGb: number; bandwidthGb: number; price: number; periodDays: number; isPopular: boolean; images: { id: string; label: string }[] }
interface Catalog { plans: CatalogPlan[]; locations: string[]; credits: number; owned: number; settings: VpsSettingsPublic; capacity: boolean }
const periodLabel = (d: number) => (d === 30 ? 'month' : d === 365 ? 'year' : d === 7 ? 'week' : `${d} days`);

export const VpsDeploy: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const [toast, say] = useToast();
  const [cat, setCat] = useState<Catalog | null>(null); const [err, setErr] = useState('');
  const [planId, setPlanId] = useState(''); const [image, setImage] = useState(''); const [name, setName] = useState(''); const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState('');
  useEffect(() => { vpsCall<Catalog>('/catalog').then(c => { setCat(c); const p = c.plans.find(x => x.isPopular) || c.plans[0]; if (p) { setPlanId(p.id); setImage(p.images[0]?.id || ''); } }).catch(e => setErr(e.message)); }, []);
  const plan = useMemo(() => cat?.plans.find(p => p.id === planId), [cat, planId]);
  const sym = cat?.settings.currencySymbol || '$';
  const pick = (p: CatalogPlan) => { setPlanId(p.id); if (!p.images.some(i => i.id === image)) setImage(p.images[0]?.id || ''); };

  if (err) return <Card><Empty icon={<AlertTriangle className="h-10 w-10" />} title="Could not load plans" text={err} /></Card>;
  if (!cat) return <Spinner label="Loading plans…" />;
  const limit = cat.settings.maxVpsPerUser; const atLimit = limit > 0 && cat.owned >= limit;
  const short = !!plan && plan.price > cat.credits;

  const submit = async () => {
    if (!plan) return; setBusy(true);
    try {
      const r = await vpsCall<{ vpsId?: string; pending?: boolean; message?: string }>('/deploy', { method: 'POST', body: { planId: plan.id, image, name: name.trim(), location } });
      if (r.pending) { setDone(r.message || 'Order received.'); return; }
      say('success', 'Your VPS is ready.'); onNavigate('vps-server', { id: r.vpsId });
    } catch (e: any) { say('error', e.message); } finally { setBusy(false); }
  };

  if (done) return (
    <Card className="!p-8 text-center max-w-xl mx-auto">
      <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center"><Check className="h-6 w-6 text-emerald-400" /></div>
      <h2 className="text-xl font-extrabold text-white mt-4">Order received</h2><p className="text-sm text-zinc-400 mt-2">{done}</p>
      <div className="mt-5 flex justify-center gap-2"><Btn variant="primary" onClick={() => onNavigate('vps-list')}>Go to My VPS</Btn></div>
    </Card>
  );

  return (
    <div className="space-y-4">
      {toast}
      <button onClick={() => onNavigate('vps-list')} className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200"><ArrowLeft className="h-3.5 w-3.5" />My VPS</button>
      <Card className="!p-5 sm:!p-6"><h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2"><Cloud className="h-6 w-6 text-amber-400" />Deploy a VPS</h1>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1.5">{cat.settings.newVpsNote || (cat.settings.paymentMode === 'instant' ? 'Paid with your account credits and online within a minute.' : 'Paid with your account credits. Staff verify each order before it is deployed.')}</p></Card>
      {!cat.capacity && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">New deployments are paused: no VPS node is accepting orders right now.</div>}
      {atLimit && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">You already have {cat.owned} of {limit} VPS allowed on your account.</div>}
      {!cat.plans.length ? <Card><Empty icon={<Cloud className="h-10 w-10" />} title="No plans available" text="Check back soon." /></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cat.plans.map(p => (
              <button key={p.id} onClick={() => pick(p)} className={cx('relative text-left rounded-2xl border p-4 transition-colors', p.id === planId ? 'border-amber-500/60 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700')}>
                {p.isPopular && <span className="absolute -top-2 right-4 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-zinc-950">POPULAR</span>}
                <p className="text-sm font-bold text-white">{p.name}</p>
                <p className="mt-1 text-2xl font-extrabold text-white">{money(p.price, sym)}<span className="text-xs font-medium text-zinc-500"> / {periodLabel(p.periodDays)}</span></p>
                <ul className="mt-3 space-y-1.5 text-xs text-zinc-300">
                  <li className="flex items-center gap-2"><Cpu className="h-3.5 w-3.5 text-zinc-500" />{p.cpu} vCPU</li>
                  <li className="flex items-center gap-2"><MemoryStick className="h-3.5 w-3.5 text-zinc-500" />{fmtMB(p.ramMb)} RAM</li>
                  <li className="flex items-center gap-2"><HardDrive className="h-3.5 w-3.5 text-zinc-500" />{p.diskGb} GB disk</li>
                </ul>
                {p.description && <p className="mt-2 text-[11px] text-zinc-500">{p.description}</p>}
              </button>
            ))}
          </div>
          {plan && (
            <Card className="!p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Name" hint="Optional"><TextInput value={name} maxLength={40} placeholder={`${plan.name} VPS`} onChange={e => setName(e.target.value)} /></Field>
                <Field label="Operating system"><Select value={image} onChange={e => setImage(e.target.value)}>{plan.images.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
                <Field label="Location"><Select value={location} onChange={e => setLocation(e.target.value)}><option value="">Automatic (best available)</option>{cat.locations.map(l => <option key={l} value={l}>{l}</option>)}</Select></Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
                <p className="text-xs text-zinc-400 flex items-center gap-2"><Wallet className="h-4 w-4 text-zinc-500" />Account credits: <b className={short ? 'text-red-400' : 'text-white'}>{money(cat.credits, sym)}</b>
                  {short && <button className="text-amber-400 hover:underline" onClick={() => onNavigate('billing')}>Add credits</button>}</p>
                <Btn variant="primary" busy={busy} disabled={!cat.capacity || atLimit || short || !image} onClick={submit}>{plan.price > 0 ? `Pay ${money(plan.price, sym)} & deploy` : 'Deploy for free'}</Btn>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
