import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Trash2, RotateCcw, Folder, File as FileIcon, Info } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Empty, Spinner } from '../../../components/ui/kit';
import { Checkbox, ConfirmModal, TabHeader } from '../../../components/ui/panelKit';

interface Item { id: string; name: string; dir: string; type: 'file' | 'dir'; size: number; deletedAt: string; expiresAt: string }
const sizeText = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : b >= 1024 ? `${(b / 1024).toFixed(2)} KiB` : `${b} B`);
const left = (iso: string) => { const ms = new Date(iso).getTime() - Date.now(); if (ms <= 0) return 'now'; const d = Math.ceil(ms / 86400000); if (d > 1) return `${d} days`; const h = Math.ceil(ms / 3600000); return h > 1 ? `${h} hours` : 'under 1 hour'; };

export const RecycleBin: React.FC<{ serverId: string; writable: boolean; notify: (t: 'success' | 'error', m: string) => void; onBack: () => void }> = ({ serverId, writable, notify, onBack }) => {
  const [data, setData] = useState<{ retentionDays: number; items: Item[] } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<null | 'selected' | 'all'>(null);
  const base = `/hosting/servers/${serverId}/recycle`;
  const load = useCallback(async () => { const r = await apiRequest(base); if (r.success) { setData(r.data); setSel(new Set()); } else { notify('error', r.error?.message || 'Could not load the recycle bin.'); setData({ retentionDays: 3, items: [] }); } }, [serverId]);
  useEffect(() => { load(); }, [load]);

  const run = async (op: 'restore' | 'purge', all: boolean) => {
    setBusy(op + (all ? 'all' : 'sel'));
    const r = await apiRequest(`${base}/${op}`, { method: 'POST', body: JSON.stringify(all ? { all: true } : { ids: [...sel] }) });
    setBusy(''); setConfirm(null);
    if (r.success) { notify('success', op === 'restore' ? 'Restored' : 'Deleted permanently'); load(); } else notify('error', r.error?.message || 'Action failed.');
  };

  if (!data) return <Spinner />;
  const items = data.items; const anySel = sel.size > 0;
  return (
    <div className="space-y-4">
      <TabHeader title="Recycle Bin" subtitle="Deleted files are kept here and can be restored." />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Btn variant="dark" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" />Back to File Manager</Btn>
        {writable && <div className="flex flex-wrap items-center gap-2">
          <Btn disabled={!anySel} busy={busy === 'restoresel'} onClick={() => run('restore', false)}><RotateCcw className="h-3.5 w-3.5" />Restore selected</Btn>
          <Btn variant="dark" disabled={!anySel} onClick={() => setConfirm('selected')}>Delete selected</Btn>
          <Btn variant="dark" disabled={items.length === 0} busy={busy === 'restoreall'} onClick={() => run('restore', true)}>Restore all</Btn>
          <Btn variant="danger" disabled={items.length === 0} onClick={() => setConfirm('all')}>Delete all permanently</Btn>
        </div>}
      </div>
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-xs text-amber-100 flex items-start gap-2.5"><Info className="h-4 w-4 shrink-0 mt-px text-amber-400" /><span>Items in the recycle bin still count towards your storage limit and are <b>automatically deleted after {data.retentionDays} days</b>.</span></div>

      <Card className="!p-0 overflow-hidden">
        {items.length === 0 ? <Empty icon={<Trash2 className="h-10 w-10" />} title="The recycle bin is empty" text="Files you delete in the File Manager show up here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[560px]">
              <thead><tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                <th className="py-3 pl-4 pr-2 w-8"><Checkbox checked={sel.size === items.length} indeterminate={sel.size > 0 && sel.size < items.length} label="Select all" onChange={v => setSel(v ? new Set(items.map(i => i.id)) : new Set())} /></th>
                <th className="py-3 px-2 font-medium">Name</th><th className="py-3 px-2 font-medium">Original location</th><th className="py-3 px-2 font-medium text-right">Size</th><th className="py-3 pl-2 pr-4 font-medium text-right">Auto-deletes in</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-800/70">
                {items.map(i => (
                  <tr key={i.id} className={sel.has(i.id) ? 'bg-amber-500/[0.06]' : 'hover:bg-zinc-900/70'}>
                    <td className="py-3 pl-4 pr-2"><Checkbox checked={sel.has(i.id)} label={`Select ${i.name}`} onChange={v => setSel(s => { const n = new Set(s); if (v) n.add(i.id); else n.delete(i.id); return n; })} /></td>
                    <td className="py-3 px-2 text-sm text-zinc-100"><span className="flex items-center gap-2.5 min-w-0">{i.type === 'dir' ? <Folder className="h-4 w-4 text-amber-400 shrink-0" /> : <FileIcon className="h-4 w-4 text-zinc-500 shrink-0" />}<span className="truncate">{i.name}</span></span></td>
                    <td className="py-3 px-2 text-xs font-mono text-zinc-500">{i.dir}</td>
                    <td className="py-3 px-2 text-xs font-mono text-zinc-400 text-right whitespace-nowrap">{sizeText(i.size)}</td>
                    <td className="py-3 pl-2 pr-4 text-xs text-zinc-300 text-right whitespace-nowrap">{left(i.expiresAt)}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal open={!!confirm} title="Delete permanently?" confirmLabel="Delete permanently" danger busy={busy.startsWith('purge')} onClose={() => setConfirm(null)} onConfirm={() => run('purge', confirm === 'all')}>
        {confirm === 'all' ? <>Everything in the recycle bin ({items.length} item{items.length === 1 ? '' : 's'}) will be deleted for good. This cannot be undone.</> : <>{sel.size} selected item{sel.size === 1 ? '' : 's'} will be deleted for good. This cannot be undone.</>}
      </ConfirmModal>
    </div>
  );
};
