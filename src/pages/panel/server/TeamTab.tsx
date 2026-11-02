import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Trash2, Pencil, Users } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, Spinner, TextInput, cx } from '../../../components/ui/kit';
import { Locked } from '../../../components/panel/Locked';

const LABEL: Record<string, string> = { 'console.read': 'View console', 'console.command': 'Send commands', power: 'Start / stop', 'files.read': 'View files', 'files.write': 'Edit files', backups: 'Backups', schedules: 'Scheduled tasks', addons: 'Addons', sftp: 'SFTP access', settings: 'Settings' };
const PRESETS: { name: string; perms: string[] }[] = [
  { name: 'Viewer', perms: ['console.read', 'files.read'] },
  { name: 'Operator', perms: ['console.read', 'console.command', 'power', 'files.read'] },
  { name: 'Manager', perms: ['console.read', 'console.command', 'power', 'files.read', 'files.write', 'backups', 'schedules', 'addons'] },
];
interface Data { allowed: boolean; limit: number; planName: string; permissions: string[]; items: { id: string; userId: string; username: string; email?: string; permissions: string[]; createdAt: string }[] }

const PermPicker: React.FC<{ all: string[]; value: string[]; onChange: (v: string[]) => void }> = ({ all, value, onChange }) => (
  <div className="space-y-2.5">
    <div className="flex gap-1.5 flex-wrap">{PRESETS.map(p => <Btn key={p.name} size="sm" variant="dark" onClick={() => onChange(p.perms)}>{p.name}</Btn>)}<Btn size="sm" variant="dark" onClick={() => onChange(all)}>Everything</Btn></div>
    <div className="grid grid-cols-2 gap-1.5">{all.map(p => { const on = value.includes(p); return (
      <button type="button" key={p} onClick={() => onChange(on ? value.filter(x => x !== p) : [...value, p])} className={cx('text-left text-xs rounded-lg border px-3 py-2 transition-colors', on ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300')}>{on ? '✓ ' : ''}{LABEL[p] || p}</button>); })}</div>
  </div>
);

export const TeamTab: React.FC<{ serverId: string; onUpgrade: () => void; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, onUpgrade, notify }) => {
  const [d, setD] = useState<Data | null>(null);
  const [form, setForm] = useState<{ id?: string; identifier: string; permissions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiRequest<Data>(`/hosting/servers/${serverId}/subusers`); if (r.success && r.data) setD(r.data); }, [serverId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;
  if (!d.allowed) return <Locked title="Invite users" text={`Give friends or teammates their own access to this server with fine-grained permissions. Extra users are available on paid plans (you are on ${d.planName}).`} onUpgrade={onUpgrade} />;

  const save = async () => {
    if (!form) return; setBusy(true);
    const r = form.id ? await apiRequest(`/hosting/servers/${serverId}/subusers/${form.id}`, { method: 'PATCH', body: JSON.stringify({ permissions: form.permissions }) })
      : await apiRequest(`/hosting/servers/${serverId}/subusers`, { method: 'POST', body: JSON.stringify({ identifier: form.identifier, permissions: form.permissions }) });
    setBusy(false);
    if (r.success) { notify('success', form.id ? 'Permissions updated' : 'User added'); setForm(null); load(); } else notify('error', r.error?.message || 'Failed');
  };
  const remove = async (id: string, name: string) => { if (!window.confirm(`Remove ${name} from this server?`)) return; const r = await apiRequest(`/hosting/servers/${serverId}/subusers/${id}`, { method: 'DELETE' }); if (r.success) { notify('success', 'Removed'); load(); } else notify('error', r.error?.message || 'Failed'); };

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <p className="text-xs text-zinc-400"><b className="text-zinc-200">{d.items.length}</b> of {d.limit} users</p>
        <Btn size="sm" variant="primary" disabled={d.items.length >= d.limit} onClick={() => setForm({ identifier: '', permissions: PRESETS[1].perms })}><UserPlus className="h-3.5 w-3.5" />Add user</Btn>
      </div>
      {d.items.length === 0 ? <Empty icon={<Users className="h-10 w-10" />} title="No users yet" text="Add someone by username or email. They need an account already." /> : (
        <ul className="divide-y divide-zinc-800/70">{d.items.map(m => (
          <li key={m.id} className="px-4 py-3 flex items-start gap-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">{m.username}</p><p className="text-[11px] text-zinc-600">{m.email}</p>
              <div className="flex flex-wrap gap-1 mt-2">{m.permissions.map(p => <Badge key={p}>{LABEL[p] || p}</Badge>)}</div></div>
            <Btn size="sm" onClick={() => setForm({ id: m.id, identifier: m.username, permissions: m.permissions })} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Btn>
            <Btn size="sm" variant="danger" onClick={() => remove(m.id, m.username)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Btn>
          </li>))}</ul>)}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Permissions for ${form.identifier}` : 'Add a user'} footer={<><Btn onClick={() => setForm(null)}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!form || form.permissions.length === 0 || (!form.id && !form.identifier.trim())} onClick={save}>{form?.id ? 'Save' : 'Add user'}</Btn></>}>
        {form && <div className="space-y-4">
          {!form.id && <Field label="Username or email"><TextInput value={form.identifier} onChange={e => setForm({ ...form, identifier: e.target.value })} placeholder="their-username" autoFocus /></Field>}
          <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Permissions</p><PermPicker all={d.permissions} value={form.permissions} onChange={v => setForm({ ...form, permissions: v })} /></div>
          <p className="text-[11px] text-zinc-500">Users can never delete the server, renew it, or manage users.</p>
        </div>}
      </Modal>
    </Card>
  );
};
