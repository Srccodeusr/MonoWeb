import React, { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Eye, EyeOff, Globe, KeyRound, Power } from 'lucide-react';
import { Badge, Btn, Card, Spinner } from '../../../components/ui/kit';
import { TabHeader } from '../../../components/ui/panelKit';
import { vpsCall } from '../vpsApi';

interface Creds { host: string | null; port: number; username: string; password: string }
const Row: React.FC<{ label: string; value: string; secret?: boolean; onCopy: (v: string) => void }> = ({ label, value, secret, onCopy }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5">
      <div className="min-w-0"><p className="text-[10px] font-mono uppercase text-zinc-500">{label}</p><p className="font-mono text-xs text-zinc-100 truncate mt-0.5">{secret && !show ? '••••••••••••••••••••' : value}</p></div>
      <div className="flex gap-1 shrink-0">{secret && <button onClick={() => setShow(s => !s)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label={show ? 'Hide' : 'Show'}>{show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>}
        <button onClick={() => onCopy(value)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label={`Copy ${label}`}><Copy className="h-3.5 w-3.5" /></button></div>
    </div>
  );
};

export const SshTab: React.FC<{ id: string; blocked: boolean; allowSshx: boolean; notify: (t: 'success' | 'error', m: string) => void }> = ({ id, blocked, allowSshx, notify }) => {
  const [c, setC] = useState<Creds | null>(null); const [err, setErr] = useState('');
  const [sx, setSx] = useState<{ running: boolean; url: string | null } | null>(null); const [sxBusy, setSxBusy] = useState(false);
  useEffect(() => { vpsCall<Creds>(`/${id}/credentials`).then(setC).catch(e => setErr(e.message)); }, [id]);
  const loadSx = useCallback(() => { if (allowSshx) vpsCall<{ running: boolean; url: string | null }>(`/${id}/sshx`).then(setSx).catch(() => setSx({ running: false, url: null })); }, [id, allowSshx]);
  useEffect(() => { loadSx(); }, [loadSx]);
  const copy = (v: string) => { navigator.clipboard?.writeText(v).then(() => notify('success', 'Copied.'), () => notify('error', 'Copy failed.')); };
  const toggle = async () => {
    setSxBusy(true);
    try { setSx(await vpsCall(`/${id}/sshx`, { method: 'POST', body: { action: sx?.running ? 'stop' : 'start' } })); } catch (e: any) { notify('error', e.message); } finally { setSxBusy(false); }
  };
  const cmd = c?.host ? `ssh root@${c.host} -p ${c.port}` : '';
  return (
    <div className="space-y-4">
      <TabHeader title="SSH Access" subtitle="Connect with any SSH client, or share a browser terminal link with sshx." />
      <Card className="!p-5 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-400" />Credentials</h3>
        {err ? <p className="text-xs text-red-300">{err}</p> : !c ? <Spinner /> : (<>
          <Row label="Command" value={cmd || 'Address not assigned yet'} onCopy={copy} />
          <div className="grid sm:grid-cols-2 gap-3"><Row label="Host" value={c.host || '—'} onCopy={copy} /><Row label="Port" value={String(c.port)} onCopy={copy} /><Row label="Username" value={c.username} onCopy={copy} /><Row label="Password" value={c.password} secret onCopy={copy} /></div>
          <p className="text-[11px] text-zinc-500">Change the password from Settings. Opening this page is recorded in the VPS activity log.</p></>)}
      </Card>
      {allowSshx && (
        <Card className="!p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Globe className="h-4 w-4 text-sky-400" />sshx browser terminal {sx?.running && <Badge tone="green">Live</Badge>}</h3>
            <Btn size="sm" variant={sx?.running ? 'danger' : 'primary'} busy={sxBusy} disabled={blocked} onClick={toggle}><Power className="h-3.5 w-3.5" />{sx?.running ? 'Stop session' : 'Start session'}</Btn>
          </div>
          <p className="text-xs text-zinc-400">Starts a collaborative terminal inside the VPS and gives you a link that works in any browser. Needs outbound internet access. Anyone with the link can use the terminal, so stop the session when you are done.</p>
          {sx?.running && sx.url && <div className="flex items-center gap-2"><div className="flex-1 min-w-0"><Row label="Session link" value={sx.url} onCopy={copy} /></div><a href={sx.url} target="_blank" rel="noreferrer" className="shrink-0"><Btn size="sm"><ExternalLink className="h-3.5 w-3.5" />Open</Btn></a></div>}
        </Card>)}
    </div>
  );
};
