import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Search, Terminal, FolderOpen, Archive, Users, Settings, Power, Database, CalendarClock, KeyRound, Package, Server } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Empty, Spinner, TextInput, fmtDate } from '../../../components/ui/kit';
import { TabHeader, ago } from '../../../components/ui/panelKit';

interface Entry { id: string; at: string; userId: string; username: string; event: string; detail: string; ip?: string }
const ICONS: Record<string, React.ReactNode> = { power: <Power />, console: <Terminal />, file: <FolderOpen />, backup: <Archive />, user: <Users />, task: <CalendarClock />, sftp: <KeyRound />, startup: <Settings />, settings: <Settings />, database: <Database />, addon: <Package />, server: <Server /> };

export const ActivityTab: React.FC<{ serverId: string; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, notify }) => {
  const [items, setItems] = useState<Entry[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    const r = await apiRequest<{ items: Entry[] }>(`/hosting/servers/${serverId}/activity?limit=150`);
    if (r.success && r.data) setItems(r.data.items); else { notify('error', r.error?.message || 'Could not load activity.'); setItems([]); }
  }, [serverId]);
  useEffect(() => { load(); }, [load]);
  if (!items) return <Spinner />;
  const s = q.trim().toLowerCase();
  const shown = items.filter(e => !s || `${e.username} ${e.detail}`.toLowerCase().includes(s));
  return (
    <div className="space-y-4">
      <TabHeader title="Activity" subtitle="Everything that happened on this server, newest first" actions={<Btn onClick={load}><RefreshCw className="h-3.5 w-3.5" />Refresh</Btn>} />
      <div className="relative"><Search className="h-4 w-4 text-zinc-600 absolute left-3.5 top-1/2 -translate-y-1/2" /><TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search activity…" className="!pl-10" aria-label="Search activity" /></div>
      <Card className="!p-0 overflow-hidden">
        {shown.length === 0 ? <Empty icon={<Activity className="h-10 w-10" />} title={q ? 'No activity matches your search' : 'No activity yet'} text="Power actions, file changes, backups and settings changes will appear here." /> : (
          <ul className="divide-y divide-zinc-800/70">
            {shown.map(e => (
              <li key={e.id} className="flex items-start gap-3.5 px-4 py-3.5">
                <span className="h-9 w-9 shrink-0 rounded-xl bg-zinc-950 border border-zinc-800 text-amber-400 flex items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{ICONS[e.event.split('.')[0]] || <Activity />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100 break-words"><b className="font-semibold text-white">{e.username}</b> <span className="text-zinc-400">·</span> {e.detail}</p>
                  <p className="text-[11px] text-zinc-600 font-mono mt-0.5" title={fmtDate(e.at)}>{ago(e.at)}{e.ip ? ` · ${e.ip}` : ''}</p>
                </div>
              </li>))}
          </ul>)}
      </Card>
    </div>
  );
};
