import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Copy, ShieldOff, Terminal } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Badge, Btn, Card, Modal, Spinner } from '../../../components/ui/kit';
import { Locked } from '../../../components/panel/Locked';

interface Info { planAllows: boolean; nodeOffers: boolean; host: string; port: number; username: string; hasPassword: boolean; readOnly: boolean }

export const SftpCard: React.FC<{ serverId: string; onUpgrade: () => void; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, onUpgrade, notify }) => {
  const [i, setI] = useState<Info | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string; host: string; port: number } | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await apiRequest<Info>(`/hosting/servers/${serverId}/sftp`); if (r.success && r.data) setI(r.data); }, [serverId]);
  useEffect(() => { load(); }, [load]);
  if (!i) return <Spinner />;
  if (!i.planAllows) return <Locked title="SFTP file access" text="Connect FileZilla, WinSCP or any SFTP client straight to your server files. Available on paid plans." onUpgrade={onUpgrade} />;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => notify('success', 'Copied'));
  const make = async () => { setBusy('make'); const r = await apiRequest(`/hosting/servers/${serverId}/sftp`, { method: 'POST' }); setBusy(''); if (r.success) { setSecret(r.data); load(); } else notify('error', r.error?.message || 'Failed'); };
  const revoke = async () => { if (!window.confirm('Revoke your SFTP access?')) return; setBusy('rev'); const r = await apiRequest(`/hosting/servers/${serverId}/sftp`, { method: 'DELETE' }); setBusy(''); if (r.success) { notify('success', 'SFTP access revoked'); load(); } else notify('error', r.error?.message || 'Failed'); };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-white flex items-center gap-2"><Terminal className="h-4 w-4 text-amber-400" />SFTP access</h2>{i.hasPassword && <Badge tone={i.readOnly ? 'amber' : 'green'}>{i.readOnly ? 'Read-only' : 'Active'}</Badge>}</div>
      {!i.nodeOffers ? <p className="text-xs text-zinc-500">This server's node does not offer SFTP yet. An administrator can enable it on the node.</p> : (
        <>
          <div className="grid sm:grid-cols-3 gap-2 text-xs">
            {[['Host', i.host], ['Port', String(i.port)], ['Username', i.username]].map(([l, v]) => <div key={l} className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2.5 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-mono uppercase text-zinc-500">{l}</p><p className="font-mono text-zinc-200 truncate">{v}</p></div><button onClick={() => copy(v)} className="text-zinc-500 hover:text-amber-300" aria-label={`Copy ${l}`}><Copy className="h-3.5 w-3.5" /></button></div>)}
          </div>
          <p className="text-[11px] text-zinc-500">Password login only. Your login can only see this server's files, never other servers, and symlinks are not followed.</p>
          <div className="flex gap-2"><Btn variant="primary" busy={busy === 'make'} onClick={make}><KeyRound className="h-3.5 w-3.5" />{i.hasPassword ? 'Reset password' : 'Create SFTP password'}</Btn>{i.hasPassword && <Btn variant="danger" busy={busy === 'rev'} onClick={revoke}><ShieldOff className="h-3.5 w-3.5" />Revoke</Btn>}</div>
        </>)}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Your SFTP password" footer={<Btn variant="primary" onClick={() => setSecret(null)}>I saved it</Btn>}>
        {secret && <div className="space-y-4 text-xs"><p className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-3 py-2.5">This password is shown <b>once</b>. We only store a hash, so if you lose it, reset it.</p>
          <div className="rounded-xl bg-black border border-zinc-800 p-3 font-mono text-[12px] break-all text-emerald-300 flex items-center justify-between gap-3"><span>{secret.password}</span><button onClick={() => copy(secret.password)} aria-label="Copy password"><Copy className="h-4 w-4 text-zinc-400" /></button></div>
          <p className="text-zinc-400">Connect to <code className="text-amber-300">sftp://{secret.username}@{secret.host}:{secret.port}</code></p></div>}
      </Modal>
    </Card>
  );
};
