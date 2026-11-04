import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw, Search } from 'lucide-react';
import { Btn, Card, Empty, PageHeader, Select, Spinner, TextInput, useToast } from '../../components/ui/kit';
import { ago } from '../../components/ui/panelKit';
import { VpsEvent } from '../../vpsTypes';
import { adminVps } from '../vps/vpsApi';

type E = VpsEvent & { vpsName: string; ownerEmail: string };
const ACTIONS = ['VPS_CREATED', 'ADMIN_CREATED', 'POWER_START', 'POWER_STOP', 'POWER_RESTART', 'POWER_KILL', 'SUSPENDED', 'UNSUSPENDED', 'EXPIRED', 'VPS_EXPIRED', 'EXTENDED', 'RENEWED', 'RESIZED', 'REINSTALLED', 'REINSTALL_FAILED', 'PASSWORD_RESET', 'PASSWORD_REVEALED', 'CREDENTIALS_VIEWED', 'OWNER_CHANGED', 'SSHX_STARTED'];

export const AdminVpsActivity: React.FC = () => {
  const [toast, say] = useToast(); const [rows, setRows] = useState<E[] | null>(null); const [search, setSearch] = useState(''); const [action, setAction] = useState('');
  const load = useCallback(async () => { try { const q = new URLSearchParams(); if (search) q.set('search', search); if (action) q.set('action', action); setRows(await adminVps<E[]>(`/events?${q}`)); } catch (e: any) { say('error', e.message); } }, [search, action, say]);
  useEffect(() => { const t = window.setTimeout(load, 250); return () => window.clearTimeout(t); }, [load]);
  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<History className="h-6 w-6 text-amber-400" />} title="VPS Activity" subtitle="Everything that happened to customer VPSes: power, billing, credential access and staff actions. Admin actions are also in Audit Logs." actions={<Btn size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Btn>} />
      <div className="flex flex-wrap gap-2"><div className="relative flex-1 min-w-[220px]"><Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" /><TextInput className="!pl-9" placeholder="Search actor, action, details…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select className="!w-56" value={action} onChange={e => setAction(e.target.value)}><option value="">All actions</option>{ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</Select></div>
      {!rows ? <Spinner /> : !rows.length ? <Card><Empty icon={<History className="h-10 w-10" />} title="No activity" /></Card> : (
        <Card className="!p-0 divide-y divide-zinc-800/60">{rows.map(e => (
          <div key={e.id} className="px-4 py-3 flex items-start justify-between gap-3 text-xs">
            <div className="min-w-0"><p className="font-mono font-semibold text-zinc-200">{e.action.replace(/_/g, ' ')} <span className="text-zinc-500 font-sans font-normal">· {e.vpsName}</span></p>
              <p className="text-zinc-500 mt-0.5 truncate">{e.details ? `${e.details} · ` : ''}by {e.actor}{e.ownerEmail ? ` · owner ${e.ownerEmail}` : ''}{e.ip ? ` · ${e.ip}` : ''}</p></div>
            <span className="text-zinc-600 shrink-0">{ago(e.createdAt)}</span>
          </div>))}</Card>)}
    </div>
  );
};
