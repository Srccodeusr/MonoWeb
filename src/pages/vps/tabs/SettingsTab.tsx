import React, { useState } from 'react';
import { Copy, KeyRound, Pencil, RefreshCw, Wallet } from 'lucide-react';
import { Btn, Card, Field, Select, TextInput } from '../../../components/ui/kit';
import { ConfirmModal, PromptModal, TabHeader } from '../../../components/ui/panelKit';
import { VpsDetail, vpsCall } from '../vpsApi';
import { Modal } from '../../../components/ui/kit';

export const SettingsTab: React.FC<{ d: VpsDetail; blocked: boolean; notify: (t: 'success' | 'error', m: string) => void; reload: () => void; onNavigate: (p: string, params?: any) => void }> = ({ d, blocked, notify, reload }) => {
  const { vps, settings } = d;
  const [rename, setRename] = useState(false); const [pwAsk, setPwAsk] = useState(false); const [newPw, setNewPw] = useState('');
  const [rein, setRein] = useState(false); const [confirm, setConfirm] = useState(''); const [image, setImage] = useState(vps.image); const [images, setImages] = useState<{ id: string; label: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const openReinstall = async () => {
    setRein(true); setConfirm('');
    if (!images) { try { const c = await vpsCall<{ plans: { id: string; images: { id: string; label: string }[] }[] }>('/catalog'); const p = c.plans.find(x => x.id === vps.planId); setImages(p?.images?.length ? p.images : [{ id: vps.image, label: vps.imageLabel }]); } catch { setImages([{ id: vps.image, label: vps.imageLabel }]); } }
  };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { notify('error', e.message); } finally { setBusy(false); } };

  return (
    <div className="space-y-4">
      <TabHeader title="Settings" subtitle="Rename your VPS, reset the root password or reinstall the operating system." />
      <Card className="!p-5 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-bold text-white">Name</h3><p className="text-xs text-zinc-400 mt-0.5">{vps.name}</p></div>
        <Btn size="sm" onClick={() => setRename(true)}><Pencil className="h-3.5 w-3.5" />Rename</Btn>
      </Card>
      <Card className="!p-5 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-bold text-white">Root password</h3><p className="text-xs text-zinc-400 mt-0.5">Generates a new random password and applies it immediately. Existing SSH sessions stay open.</p></div>
        <Btn size="sm" disabled={blocked} onClick={() => setPwAsk(true)}><KeyRound className="h-3.5 w-3.5" />Reset password</Btn>
      </Card>
      {settings.allowReinstall && (
        <Card className="!p-5 flex flex-wrap items-center justify-between gap-3 border-red-500/20">
          <div><h3 className="text-sm font-bold text-white">Reinstall</h3><p className="text-xs text-zinc-400 mt-0.5">Erases <b>everything</b> on the VPS and installs a fresh operating system. The address and SSH port stay the same.</p></div>
          <Btn size="sm" variant="danger" disabled={blocked} onClick={openReinstall}><RefreshCw className="h-3.5 w-3.5" />Reinstall</Btn>
        </Card>)}
      <Card className="!p-5 flex items-center gap-3 text-xs text-zinc-400"><Wallet className="h-4 w-4 text-zinc-500" />Plan: <b className="text-zinc-200">{d.plan.name}</b>. Renew from the button at the top of this page. Want a bigger plan? Deploy a new VPS and move your data over.</Card>
      {!d.diskEnforced && <p className="text-[11px] text-amber-400/80">Note: this node has no hard disk quota, so the disk size shown is a plan label.</p>}

      <PromptModal open={rename} title="Rename VPS" label="Name" initial={vps.name} confirmLabel="Save" busy={busy} onClose={() => setRename(false)}
        onSubmit={n => run(async () => { await vpsCall(`/${vps.id}`, { method: 'PATCH', body: { name: n.trim() } }); setRename(false); notify('success', 'Renamed.'); reload(); })} />
      <ConfirmModal open={pwAsk} title="Reset root password?" confirmLabel="Reset" busy={busy} onClose={() => setPwAsk(false)}
        onConfirm={() => run(async () => { const r = await vpsCall<{ password: string }>(`/${vps.id}/password`, { method: 'POST' }); setPwAsk(false); setNewPw(r.password); })}>A new password is generated and shown once. You can always see it again on the SSH Access tab.</ConfirmModal>
      <Modal open={!!newPw} onClose={() => setNewPw('')} title="New root password" footer={<Btn variant="primary" onClick={() => setNewPw('')}>Done</Btn>}>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3"><code className="flex-1 break-all text-xs text-amber-300">{newPw}</code><button onClick={() => navigator.clipboard?.writeText(newPw)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Copy"><Copy className="h-3.5 w-3.5" /></button></div>
      </Modal>
      <Modal open={rein} onClose={() => setRein(false)} title="Reinstall VPS" footer={<><Btn onClick={() => setRein(false)}>Cancel</Btn><Btn variant="danger" busy={busy} disabled={confirm !== vps.name} onClick={() => run(async () => { await vpsCall(`/${vps.id}/reinstall`, { method: 'POST', body: { confirm, image } }); setRein(false); notify('success', 'Reinstalled. Your root password was reset, check the SSH tab.'); reload(); })}>Erase & reinstall</Btn></>}>
        <div className="space-y-3">
          <p className="text-xs text-red-300">All data on this VPS will be permanently deleted.</p>
          <Field label="Operating system"><Select value={image} onChange={e => setImage(e.target.value)}>{(images || []).map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
          <Field label={`Type "${vps.name}" to confirm`}><TextInput value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
};
