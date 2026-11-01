import React, { useCallback, useEffect, useState } from 'react';
import { MoveRight, Loader2, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Select, Spinner } from '../../../components/ui/kit';
import { Locked } from '../../../components/panel/Locked';

interface Info { allowed: boolean; planName: string; current: { id: string; name: string; location: string } | null; transfer: { state: 'running' | 'failed'; step?: string; error?: string } | null; targets: { id: string; name: string; location: string; flag?: string; runtime?: string }[] }

export const MoveCard: React.FC<{ serverId: string; status: string; onUpgrade: () => void; onDone: () => void; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, status, onUpgrade, onDone, notify }) => {
  const [i, setI] = useState<Info | null>(null);
  const [target, setTarget] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiRequest<Info>(`/hosting/servers/${serverId}/transfer`); if (r.success && r.data) { setI(r.data); setTarget(t => t || r.data!.targets[0]?.id || ''); } }, [serverId]);
  useEffect(() => { load(); }, [load, status]);
  useEffect(() => { if (status !== 'transferring') return; const t = window.setInterval(load, 3000); return () => window.clearInterval(t); }, [status, load]);
  if (!i) return <Spinner />;
  if (!i.allowed) return <Locked title="Move to another node" text="Switch your server to a different location or node without losing a single file. Available on paid plans." onUpgrade={onUpgrade} />;

  const start = async () => {
    if (!window.confirm('The server will be stopped, copied to the new node and started again. Its address and port will change. Continue?')) return;
    setBusy(true); const r = await apiRequest(`/hosting/servers/${serverId}/transfer`, { method: 'POST', body: JSON.stringify({ nodeId: target }) }); setBusy(false);
    if (r.success) { notify('success', 'Moving your server…'); onDone(); load(); } else notify('error', r.error?.message || 'Could not start the move.');
  };
  const dismiss = async () => { await apiRequest(`/hosting/servers/${serverId}/transfer/dismiss`, { method: 'POST' }); load(); onDone(); };

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-bold text-white flex items-center gap-2"><MoveRight className="h-4 w-4 text-amber-400" />Move to another node</h2>
      <p className="text-xs text-zinc-500">Currently on <b className="text-zinc-300">{i.current?.name}</b> ({i.current?.location}).</p>
      {status === 'transferring' || i.transfer?.state === 'running' ? (
        <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 px-3.5 py-3 text-xs text-sky-200 flex items-center gap-2.5"><Loader2 className="h-4 w-4 animate-spin" /><span><b>Moving…</b> {i.transfer?.step}. This can take a few minutes for large servers; do not delete or edit the server meanwhile.</span></div>
      ) : (
        <>
          {i.transfer?.state === 'failed' && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3.5 py-3 text-xs text-red-200 flex gap-2 items-start"><AlertTriangle className="h-4 w-4 shrink-0 mt-px" /><span className="flex-1">The last move failed and your server is safe where it was: {i.transfer.error}</span><button onClick={dismiss} className="underline shrink-0">Dismiss</button></div>}
          {i.targets.length === 0 ? <p className="text-xs text-zinc-500">No other node can host this server right now.</p> : (
            <div className="flex flex-col sm:flex-row gap-2"><Select value={target} onChange={e => setTarget(e.target.value)}>{i.targets.map(n => <option key={n.id} value={n.id}>{n.flag} {n.name} · {n.location}</option>)}</Select><Btn variant="primary" busy={busy} disabled={!target || status !== 'offline' && status !== 'running'} onClick={start} className="shrink-0">Move server</Btn></div>)}
        </>)}
    </Card>
  );
};
