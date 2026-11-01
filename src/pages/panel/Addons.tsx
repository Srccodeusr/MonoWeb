import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { usePanel } from '../../components/panel/PanelContext';
import { Btn, Card, Empty, PageHeader, Select, Spinner, useToast } from '../../components/ui/kit';
import { AddonsPanel } from './server/AddonsPanel';

/** The addon store: pick one of your servers, then browse what works with its software. */
export const Addons: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const { data } = usePanel();
  const [toast, say] = useToast();
  const usable = (data?.servers || []).filter(s => s.role === 'owner' || s.permissions.includes('addons'));
  const [serverId, setServerId] = useState('');
  useEffect(() => { if (!serverId && usable[0]) setServerId(usable[0].id); }, [usable.length]);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      {toast}
      <PageHeader icon={<Package className="h-6 w-6 text-amber-400" />} title="Addon Store" subtitle="One-click plugins, mods and templates for your servers. Free or paid with coins." />
      {usable.length === 0 ? <Card><Empty icon={<Package className="h-12 w-12" />} title="You need a server first" text="Addons install into a server. Create one, then come back." action={<Btn variant="primary" onClick={() => onNavigate('server-create')}>Create a server</Btn>} /></Card> : (
        <>
          <Card className="flex items-center gap-3"><span className="text-xs text-zinc-400 shrink-0">Install on</span><Select value={serverId} onChange={e => setServerId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name} · {s.image?.name}</option>)}</Select></Card>
          {serverId && <AddonsPanel serverId={serverId} notify={say} />}
        </>)}
    </div>
  );
};
