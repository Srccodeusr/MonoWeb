import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { Card, Empty, Spinner } from '../../../components/ui/kit';
import { TabHeader, ago } from '../../../components/ui/panelKit';
import { VpsEvent } from '../../../vpsTypes';
import { vpsCall } from '../vpsApi';

export const ActivityTab: React.FC<{ id: string }> = ({ id }) => {
  const [list, setList] = useState<VpsEvent[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { vpsCall<VpsEvent[]>(`/${id}/activity`).then(setList).catch(e => setErr(e.message)); }, [id]);
  return (
    <div className="space-y-4">
      <TabHeader title="Activity" subtitle="Power actions, logins to the credentials page, renewals and staff actions on this VPS." />
      {err ? <Card><Empty title="Could not load activity" text={err} /></Card> : !list ? <Spinner /> : !list.length ? <Card><Empty icon={<Activity className="h-10 w-10" />} title="Nothing yet" /></Card> : (
        <Card className="!p-0 divide-y divide-zinc-800/70">
          {list.map(e => (
            <div key={e.id} className="px-4 py-3 flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0"><p className="font-mono font-semibold text-zinc-200">{e.action.replace(/_/g, ' ')}</p><p className="text-zinc-500 mt-0.5 truncate">{e.details ? `${e.details} · ` : ''}{e.actor}{e.ip ? ` · ${e.ip}` : ''}</p></div>
              <span className="text-zinc-600 shrink-0">{ago(e.createdAt)}</span>
            </div>))}
        </Card>)}
    </div>
  );
};
