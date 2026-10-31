import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Plus, RotateCcw, Trash2, Lock } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Empty, Spinner, fmtBytes, fmtDate } from '../../../components/ui/kit';

interface B { id: string; name: string; size: number; createdAt: string }

export const BackupsTab: React.FC<{ serverId: string; writable: boolean; onUpgrade: () => void; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, writable, onUpgrade, notify }) => {
  const [data, setData] = useState<{ limit: number; items: B[] } | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await apiRequest(`/hosting/servers/${serverId}/backups`); if (r.success) setData(r.data); }, [serverId]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Spinner />;

  const run = async (key: string, fn: () => Promise<any>, ok: string) => { setBusy(key); const r = await fn(); setBusy(''); if (r.success) { notify('success', ok); load(); } else notify('error', r.error?.message || 'Failed.'); };

  if (data.limit <= 0) return <Card><Empty icon={<Lock className="h-10 w-10" />} title="Backups are a Premium feature" text="Upgrade your plan to snapshot and restore your server with one click." action={<Btn variant="primary" onClick={onUpgrade}>View plans</Btn>} /></Card>;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <p className="text-xs text-zinc-400"><b className="text-zinc-200">{data.items.length}</b> of {data.limit} backups used</p>
        {writable && <Btn size="sm" variant="primary" busy={busy === 'new'} disabled={data.items.length >= data.limit} onClick={() => run('new', () => apiRequest(`/hosting/servers/${serverId}/backups`, { method: 'POST', body: JSON.stringify({}) }), 'Backup created')}><Plus className="h-3.5 w-3.5" />Create backup</Btn>}
      </div>
      {data.items.length === 0 ? <Empty icon={<Archive className="h-10 w-10" />} title="No backups yet" text="Create one before risky changes." /> : (
        <ul className="divide-y divide-zinc-800/70">
          {data.items.map(b => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-3">
              <Archive className="h-4 w-4 text-zinc-500 shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-zinc-200 truncate">{b.name}</p><p className="text-[11px] text-zinc-600">{fmtDate(b.createdAt)} · {fmtBytes(b.size)}</p></div>
              {writable && <Btn size="sm" busy={busy === 'r' + b.id} onClick={() => window.confirm('Restore this backup? Current files will be replaced and the server stopped.') && run('r' + b.id, () => apiRequest(`/hosting/servers/${serverId}/backups/${b.id}/restore`, { method: 'POST', body: '{}' }), 'Backup restored')}><RotateCcw className="h-3.5 w-3.5" />Restore</Btn>}
              <Btn size="sm" variant="danger" busy={busy === 'd' + b.id} onClick={() => window.confirm('Delete this backup?') && run('d' + b.id, () => apiRequest(`/hosting/servers/${serverId}/backups/${b.id}`, { method: 'DELETE' }), 'Backup deleted')} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Btn>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
