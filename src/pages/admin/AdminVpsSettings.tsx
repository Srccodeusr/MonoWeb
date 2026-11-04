import React, { useEffect, useState } from 'react';
import { Save, SlidersHorizontal } from 'lucide-react';
import { Btn, Card, Field, NumInput, PageHeader, Select, Spinner, TextArea, Toggle, useToast } from '../../components/ui/kit';
import { VpsOsImage, VpsSettings } from '../../vpsTypes';
import { adminVps } from '../vps/vpsApi';

export const AdminVpsSettings: React.FC = () => {
  const [toast, say] = useToast(); const [s, setS] = useState<VpsSettings | null>(null); const [images, setImages] = useState<VpsOsImage[]>([]); const [saving, setSaving] = useState(false);
  useEffect(() => { Promise.all([adminVps<VpsSettings>('/settings'), adminVps<VpsOsImage[]>('/images')]).then(([a, b]) => { setS(a); setImages(b); }).catch(e => say('error', e.message)); }, [say]);
  if (!s) return <Spinner />;
  const set = <K extends keyof VpsSettings>(k: K, v: VpsSettings[K]) => setS({ ...s, [k]: v });
  const save = async () => { setSaving(true); try { setS(await adminVps<VpsSettings>('/settings', { method: 'PUT', body: s })); say('success', 'Settings saved.'); } catch (e: any) { say('error', e.message); } finally { setSaving(false); } };
  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<SlidersHorizontal className="h-6 w-6 text-amber-400" />} title="VPS Settings" subtitle="How the native VPS module sells, renews and expires servers." actions={<Btn variant="primary" busy={saving} onClick={save}><Save className="h-3.5 w-3.5" />Save</Btn>} />
      <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Sales</h3>
        <Toggle checked={s.enabled} onChange={v => set('enabled', v)} label="VPS hosting enabled" hint="Off = nobody can deploy; existing VPSes keep running." />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Payment mode" hint="Panel deploys are paid with account credits"><Select value={s.paymentMode} onChange={e => set('paymentMode', e.target.value as VpsSettings['paymentMode'])}><option value="instant">Instant: deploy as soon as credits are taken</option><option value="manual">Manual: staff approve each order (credits held)</option></Select></Field>
          <Field label="Default operating system"><Select value={s.defaultImage} onChange={e => set('defaultImage', e.target.value)}>{images.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
          <Field label="Max VPS per customer" hint="0 = unlimited"><NumInput value={s.maxVpsPerUser} onChange={v => set('maxVpsPerUser', v)} min={0} /></Field>
        </div>
        <Toggle checked={s.handleCheckoutOrders} onChange={v => set('handleCheckoutOrders', v)} label="Deploy website checkout orders natively" hint="VPS-category orders placed through the website checkout are deployed by this module (when a node is enabled) instead of the external panel link." />
      </Card>
      <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Expiry & renewal</h3>
        <div className="grid sm:grid-cols-2 gap-4"><Field label="Delete expired VPS after (days)" hint="0 = keep until deleted by staff"><NumInput value={s.deleteAfterExpiryDays} onChange={v => set('deleteAfterExpiryDays', v)} min={0} /></Field>
          <Field label="Expiry reminder (hours before)" hint="0 = off. Sent to the customer's inbox"><NumInput value={s.reminderHours} onChange={v => set('reminderHours', v)} min={0} /></Field></div>
        <Toggle checked={s.allowRenewal} onChange={v => set('allowRenewal', v)} label="Customers can renew with account credits" />
      </Card>
      <Card className="!p-5 space-y-3"><h3 className="text-sm font-bold text-white">Customer features</h3>
        <Toggle checked={s.allowTerminal} onChange={v => set('allowTerminal', v)} label="Dashboard terminal" hint="Runs commands as root inside the VPS (30 s limit)." />
        <Toggle checked={s.allowFileManager} onChange={v => set('allowFileManager', v)} label="File manager" /><Toggle checked={s.allowSshx} onChange={v => set('allowSshx', v)} label="sshx browser terminal" hint="Downloads sshx from sshx.io inside the VPS." /><Toggle checked={s.allowReinstall} onChange={v => set('allowReinstall', v)} label="Self-service reinstall" /></Card>
      <Card className="!p-5 space-y-4"><h3 className="text-sm font-bold text-white">Messages</h3>
        <Field label="Banner shown on every VPS page"><TextArea value={s.announcement} onChange={e => set('announcement', e.target.value)} placeholder="Maintenance window on Sunday 02:00 UTC…" /></Field>
        <Field label="Note on the deploy page"><TextArea value={s.newVpsNote} onChange={e => set('newVpsNote', e.target.value)} /></Field></Card>
    </div>
  );
};
