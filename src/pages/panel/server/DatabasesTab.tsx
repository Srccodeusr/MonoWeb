import React, { useCallback, useEffect, useState } from 'react';
import { Database, Plus, Copy, Eye, EyeOff, RefreshCw, Trash2, Lock } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Empty, Spinner } from '../../../components/ui/kit';
import { ConfirmModal, PromptModal, TabHeader } from '../../../components/ui/panelKit';

interface Db { id: string; label: string; name: string; username: string; password: string; host: string; port: number; createdAt: string }
interface Data { configured: boolean; limit: number; items: Db[] }

const Row: React.FC<{ label: string; value: string; secret?: boolean; shown?: boolean; onCopy: (v: string) => void }> = ({ label, value, secret, shown, onCopy }) => (
  <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 flex items-center justify-between gap-2 min-w-0">
    <div className="min-w-0"><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</p><p className="font-mono text-xs text-zinc-200 truncate">{secret && !shown ? '••••••••••••••••' : value}</p></div>
    <button onClick={() => onCopy(value)} className="text-zinc-500 hover:text-amber-300 shrink-0" aria-label={`Copy ${label}`}><Copy className="h-3.5 w-3.5" /></button>
  </div>
);

export const DatabasesTab: React.FC<{ serverId: string; onUpgrade: () => void; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, onUpgrade, notify }) => {
  const [d, setD] = useState<Data | null>(null);
  const [create, setCreate] = useState(false);
  const [del, setDel] = useState<Db | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const base = `/hosting/servers/${serverId}/databases`;
  const load = useCallback(async () => { const r = await apiRequest<Data>(base); if (r.success && r.data) setD(r.data); else { notify('error', r.error?.message || 'Could not load databases.'); setD({ configured: false, limit: 0, items: [] }); } }, [serverId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;
  const copy = (v: string) => navigator.clipboard?.writeText(v).then(() => notify('success', 'Copied'));
  const call = async (key: string, fn: () => Promise<any>, ok: string) => { setBusy(key); const r = await fn(); setBusy(''); if (r.success) { notify('success', ok); await load(); return true; } notify('error', r.error?.message || 'Failed.'); return false; };

  return (
    <div className="space-y-4">
      <TabHeader title="Databases" subtitle="MySQL databases for your server" actions={d.limit > 0 && d.configured ? <><span className="text-xs text-zinc-400"><b className="text-zinc-200">{d.items.length}</b> of {d.limit} used</span><Btn variant="primary" disabled={d.items.length >= d.limit} onClick={() => setCreate(true)}><Plus className="h-3.5 w-3.5" />New database</Btn></> : undefined} />
      {d.limit <= 0 ? (
        <Card><Empty icon={<Lock className="h-10 w-10" />} title="Databases are a Premium feature" text="Upgrade your plan to add MySQL databases to this server." action={<Btn variant="primary" onClick={onUpgrade}>View plans</Btn>} /></Card>
      ) : !d.configured ? (
        <Card><Empty icon={<Database className="h-10 w-10" />} title="Databases are not available yet" text="The platform has no database host configured. An administrator needs to set DB_HOST_ADDRESS and the admin login in the panel’s .env file." /></Card>
      ) : d.items.length === 0 ? (
        <Card><Empty icon={<Database className="h-10 w-10" />} title="No databases yet" text="Create one and connect to it from your bot or app with the details shown here." action={<Btn variant="primary" onClick={() => setCreate(true)}><Plus className="h-3.5 w-3.5" />New database</Btn>} /></Card>
      ) : d.items.map(x => (
        <Card key={x.id} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 min-w-0"><Database className="h-4 w-4 text-amber-400 shrink-0" /><span className="truncate">{x.label}</span></h3>
            <div className="flex gap-1.5 shrink-0">
              <Btn size="sm" onClick={() => setShown(s => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} aria-label={shown.has(x.id) ? 'Hide password' : 'Show password'}>{shown.has(x.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Btn>
              <Btn size="sm" busy={busy === 'r' + x.id} onClick={() => call('r' + x.id, () => apiRequest(`${base}/${x.id}/rotate`, { method: 'POST', body: '{}' }), 'New password generated')}><RefreshCw className="h-3.5 w-3.5" />New password</Btn>
              <Btn size="sm" variant="danger" onClick={() => setDel(x)} aria-label="Delete database"><Trash2 className="h-3.5 w-3.5" /></Btn>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <Row label="Database" value={x.name} onCopy={copy} /><Row label="Username" value={x.username} onCopy={copy} />
            <Row label="Host" value={`${x.host}:${x.port}`} onCopy={copy} /><Row label="Password" value={x.password} secret shown={shown.has(x.id)} onCopy={copy} />
          </div>
          <Row label="Connection URL" value={`mysql://${encodeURIComponent(x.username)}:${encodeURIComponent(x.password)}@${x.host}:${x.port}/${x.name}`} secret shown={shown.has(x.id)} onCopy={copy} />
        </Card>))}

      <PromptModal open={create} title="New database" label="Name" placeholder="my-bot" confirmLabel="Create database" busy={busy === 'new'} hint="Only used to recognise it in this list. 1–24 letters, numbers, spaces, dashes or underscores." onClose={() => setCreate(false)}
        onSubmit={async label => { if (await call('new', () => apiRequest(base, { method: 'POST', body: JSON.stringify({ label }) }), 'Database created')) setCreate(false); }} />
      <ConfirmModal open={!!del} title="Delete database?" confirmLabel="Delete database" danger busy={busy === 'del'} onClose={() => setDel(null)} onConfirm={async () => { if (del && await call('del', () => apiRequest(`${base}/${del.id}`, { method: 'DELETE' }), 'Database deleted')) setDel(null); }}>
        <b className="text-white">{del?.label}</b> and all of its tables will be deleted permanently. This cannot be undone.
      </ConfirmModal>
    </div>
  );
};
