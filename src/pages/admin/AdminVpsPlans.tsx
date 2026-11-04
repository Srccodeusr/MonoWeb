import React, { useCallback, useEffect, useState } from 'react';
import { EyeOff, Layers, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextInput, Toggle, fmtMB, money, useToast } from '../../components/ui/kit';
import { ConfirmModal } from '../../components/ui/panelKit';
import { VpsOsImage, VpsPlan } from '../../vpsTypes';
import { adminVps } from '../vps/vpsApi';

type P = VpsPlan & { inUse: number };
const blank = { name: '', description: '', cpu: 1, ramMb: 1024, diskGb: 20, bandwidthGb: 1000, price: 5, periodDays: 30, images: [] as string[], enabled: true, isPopular: false, sort: 0, catalogPlanId: '' };

export const AdminVpsPlans: React.FC = () => {
  const [toast, say] = useToast(); const [data, setData] = useState<{ plans: P[]; catalogPlans: { id: string; name: string; priceMonthly: number }[]; images: VpsOsImage[] } | null>(null);
  const [form, setForm] = useState<any>(null); const [saving, setSaving] = useState(false); const [del, setDel] = useState<P | null>(null);
  const load = useCallback(async () => { try { setData(await adminVps('/plans')); } catch (e: any) { say('error', e.message); } }, [say]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await adminVps(form.id ? `/plans/${form.id}` : '/plans', { method: form.id ? 'PUT' : 'POST', body: form }); say('success', 'Plan saved.'); setForm(null); load(); } catch (e: any) { say('error', e.message); } finally { setSaving(false); }
  };
  const remove = async () => { if (!del) return; try { await adminVps(`/plans/${del.id}`, { method: 'DELETE' }); say('success', 'Plan deleted.'); } catch (e: any) { say('error', e.message); } setDel(null); load(); };
  const toggleImg = (id: string) => set('images', form.images.includes(id) ? form.images.filter((x: string) => x !== id) : [...form.images, id]);

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Layers className="h-6 w-6 text-amber-400" />} title="VPS Plans" subtitle="What customers can buy in the panel. Link a plan to a website plan so orders from the website checkout deploy with these specs."
        actions={<Btn variant="primary" onClick={() => setForm({ ...blank })}><Plus className="h-3.5 w-3.5" />New plan</Btn>} />
      {!data ? <Spinner /> : !data.plans.length ? <Card><Empty icon={<Layers className="h-10 w-10" />} title="No plans" action={<Btn variant="primary" onClick={() => setForm({ ...blank })}>Create plan</Btn>} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.plans.map(p => (
          <Card key={p.id} className="!p-5 space-y-3">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-bold text-white flex items-center gap-1.5 flex-wrap">{p.name}{p.isPopular && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />}{!p.enabled && <Badge tone="zinc"><EyeOff className="h-3 w-3 mr-1 inline" />Hidden</Badge>}</p>
              <p className="text-lg font-extrabold text-white mt-1">{money(p.price)}<span className="text-xs font-medium text-zinc-500"> / {p.periodDays} days</span></p></div>
              <div className="flex gap-1"><Btn size="sm" onClick={() => setForm({ ...p, catalogPlanId: p.catalogPlanId || '' })}><Pencil className="h-3.5 w-3.5" /></Btn><Btn size="sm" variant="danger" onClick={() => setDel(p)}><Trash2 className="h-3.5 w-3.5" /></Btn></div></div>
            <p className="text-xs font-mono text-zinc-400">{p.cpu} vCPU · {fmtMB(p.ramMb)} · {p.diskGb} GB · {p.bandwidthGb ? `${p.bandwidthGb} GB bw` : 'no bw cap'}</p>
            <p className="text-[11px] text-zinc-500">{p.inUse} active VPS{p.catalogPlanId ? ` · linked to website plan ${data.catalogPlans.find(c => c.id === p.catalogPlanId)?.name || p.catalogPlanId}` : ''}</p>
          </Card>))}</div>)}
      <Modal open={!!form} onClose={() => setForm(null)} wide title={form?.id ? 'Edit plan' : 'New VPS plan'} footer={<><Btn onClick={() => setForm(null)}>Cancel</Btn><Btn variant="primary" busy={saving} onClick={save}>Save</Btn></>}>
        {form && data && <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name"><TextInput value={form.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="Price"><NumInput value={form.price} onChange={v => set('price', v)} min={0} step={0.5} /></Field>
          <Field label="vCPU"><NumInput value={form.cpu} onChange={v => set('cpu', v)} min={0.25} max={64} step={0.25} /></Field>
          <Field label="RAM (MB)"><NumInput value={form.ramMb} onChange={v => set('ramMb', v)} min={256} step={256} /></Field>
          <Field label="Disk (GB)" hint="Hard limit only on xfs+pquota nodes"><NumInput value={form.diskGb} onChange={v => set('diskGb', v)} min={1} /></Field>
          <Field label="Bandwidth (GB / month)" hint="Informational, not enforced"><NumInput value={form.bandwidthGb} onChange={v => set('bandwidthGb', v)} min={0} /></Field>
          <Field label="Billing period (days)"><NumInput value={form.periodDays} onChange={v => set('periodDays', v)} min={1} max={3650} /></Field>
          <Field label="Sort order"><NumInput value={form.sort} onChange={v => set('sort', v)} /></Field>
          <Field label="Description" className="sm:col-span-2"><TextInput value={form.description} onChange={e => set('description', e.target.value)} /></Field>
          <Field label="Linked website plan" hint="Website checkout orders for that plan deploy with this profile" className="sm:col-span-2"><Select value={form.catalogPlanId} onChange={e => set('catalogPlanId', e.target.value)}><option value="">None (panel only)</option>{data.catalogPlans.map(c => <option key={c.id} value={c.id}>{c.name} ({money(c.priceMonthly)}/mo)</option>)}</Select></Field>
          <div className="sm:col-span-2"><p className="text-xs font-semibold text-zinc-300 mb-2">Allowed operating systems <span className="text-zinc-500 font-normal">(none ticked = all enabled images)</span></p>
            <div className="flex flex-wrap gap-2">{data.images.map(i => <button key={i.id} type="button" onClick={() => toggleImg(i.id)} className={`rounded-lg border px-3 py-1.5 text-xs ${form.images.includes(i.id) ? 'border-amber-500/60 bg-amber-500/10 text-amber-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}>{i.label}{!i.enabled && ' (disabled)'}</button>)}</div></div>
          <Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="On sale" hint="Hidden plans still renew for existing VPSes" /><Toggle checked={form.isPopular} onChange={v => set('isPopular', v)} label="Mark as popular" />
        </div>}
      </Modal>
      <ConfirmModal open={!!del} title="Delete plan?" confirmLabel="Delete" danger onClose={() => setDel(null)} onConfirm={remove}>{del?.name} will be removed. This fails if a VPS still uses it (hide it instead).</ConfirmModal>
    </div>
  );
};
