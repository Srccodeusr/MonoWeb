import React, { useCallback, useEffect, useState } from 'react';
import { Disc3, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Spinner, TextInput, Toggle, useToast } from '../../../components/ui/kit';
import { ConfirmModal } from '../../../components/ui/panelKit';
import { VpsOsImage } from '../../../vpsTypes';
import { adminVps } from '../../vps/vpsApi';

type I = VpsOsImage & { inUse: number };
export const AdminVpsImages: React.FC = () => {
  const [toast, say] = useToast(); const [list, setList] = useState<I[] | null>(null); const [form, setForm] = useState<any>(null); const [saving, setSaving] = useState(false); const [del, setDel] = useState<I | null>(null);
  const load = useCallback(async () => { try { setList(await adminVps<I[]>('/images')); } catch (e: any) { say('error', e.message); } }, [say]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const save = async () => { setSaving(true); try { await adminVps(form.isNew ? '/images' : `/images/${form.id}`, { method: form.isNew ? 'POST' : 'PUT', body: form }); say('success', 'Image saved.'); setForm(null); load(); } catch (e: any) { say('error', e.message); } finally { setSaving(false); } };
  const remove = async () => { if (!del) return; try { await adminVps(`/images/${del.id}`, { method: 'DELETE' }); say('success', 'Image deleted.'); } catch (e: any) { say('error', e.message); } setDel(null); load(); };
  const flip = async (i: I) => { try { await adminVps(`/images/${i.id}`, { method: 'PUT', body: { ...i, enabled: !i.enabled } }); load(); } catch (e: any) { say('error', e.message); } };
  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Disc3 className="h-6 w-6 text-amber-400" />} title="OS Images" subtitle="Operating systems customers can install. Each is a Debian/Ubuntu-family Docker base image; the daemon builds it with sshd on first use."
        actions={<Btn variant="primary" onClick={() => setForm({ isNew: true, id: '', label: '', base: '', enabled: true, sort: (list?.length || 0) + 1 })}><Plus className="h-3.5 w-3.5" />Add image</Btn>} />
      {!list ? <Spinner /> : !list.length ? <Card><Empty icon={<Disc3 className="h-10 w-10" />} title="No images" text="Customers cannot deploy until at least one image is enabled." /></Card> : (
        <Card className="!p-0 divide-y divide-zinc-800/60">{list.map(i => (
          <div key={i.id} className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="min-w-0"><p className="font-semibold text-zinc-100 flex items-center gap-2">{i.label}{!i.enabled && <Badge tone="zinc">Disabled</Badge>}</p><p className="text-zinc-500 font-mono mt-0.5">{i.id} · {i.base} · {i.inUse} VPS</p></div>
            <div className="flex items-center gap-2"><Toggle checked={i.enabled} onChange={() => flip(i)} /><Btn size="sm" onClick={() => setForm({ ...i })}><Pencil className="h-3.5 w-3.5" /></Btn><Btn size="sm" variant="danger" onClick={() => setDel(i)}><Trash2 className="h-3.5 w-3.5" /></Btn></div>
          </div>))}</Card>)}
      <p className="text-[11px] text-zinc-500">The first deploy of an image on a node takes a few minutes (it is built and cached). Only bases matching the daemon's ALLOWED_BASE_PREFIXES (default ubuntu:, debian:) are accepted.</p>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.isNew ? 'Add image' : 'Edit image'} footer={<><Btn onClick={() => setForm(null)}>Cancel</Btn><Btn variant="primary" busy={saving} onClick={save}>Save</Btn></>}>
        {form && <div className="space-y-4">
          <Field label="Id" hint="Permanent key, e.g. ubuntu-22.04"><TextInput value={form.id} disabled={!form.isNew} onChange={e => set('id', e.target.value)} /></Field>
          <Field label="Label"><TextInput value={form.label} onChange={e => set('label', e.target.value)} placeholder="Ubuntu 22.04 LTS" /></Field>
          <Field label="Docker base image"><TextInput value={form.base} onChange={e => set('base', e.target.value)} placeholder="ubuntu:22.04" /></Field>
          <Field label="Sort order"><NumInput value={form.sort} onChange={v => set('sort', v)} /></Field>
          <Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Available to customers" />
        </div>}
      </Modal>
      <ConfirmModal open={!!del} title="Delete image?" confirmLabel="Delete" danger onClose={() => setDel(null)} onConfirm={remove}>{del?.label} is removed. This fails while VPSes use it (disable it instead).</ConfirmModal>
    </div>
  );
};
