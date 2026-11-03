import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, File as FileIcon, Folder, FolderPlus, FilePlus, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Btn, Card, Empty, Modal, Spinner, TextArea, fmtBytes } from '../../../components/ui/kit';
import { ConfirmModal, PromptModal, TabHeader, ago } from '../../../components/ui/panelKit';
import { vpsCall } from '../vpsApi';

interface Entry { name: string; dir: boolean; link: boolean; size: number; modified: number }
const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
const parent = (p: string) => { const s = p.split('/').filter(Boolean); s.pop(); return '/' + s.join('/'); };
// Daemon 1.0 could send NaN timestamps for odd file names; never let one bad row crash the whole tab.
const when = (ms: number) => (Number.isFinite(ms) && ms > 0 ? ago(new Date(ms).toISOString()) : '—');

export const FilesTab: React.FC<{ id: string; running: boolean; blocked: boolean; notify: (t: 'success' | 'error', m: string) => void }> = ({ id, running, blocked, notify }) => {
  const [dir, setDir] = useState('/root'); const [files, setFiles] = useState<Entry[] | null>(null); const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ path: string; content: string; isNew?: boolean } | null>(null); const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState<null | 'file' | 'folder' | { rename: Entry } | { del: Entry }>(null); const [working, setWorking] = useState(false);
  const can = running && !blocked;

  const load = useCallback(async (p = dir) => {
    setFiles(null); setErr('');
    try { const r = await vpsCall<{ files: Entry[] }>(`/${id}/files?path=${encodeURIComponent(p)}`); setFiles(r.files); setDir(p); }
    catch (e: any) { setErr(e.message); setFiles([]); }
  }, [id, dir]);
  useEffect(() => { if (can) load('/root'); else { setFiles([]); setErr(blocked ? 'This VPS is not available.' : 'Start the VPS to browse its files.'); } /* eslint-disable-next-line */ }, [can]);

  const open = async (f: Entry) => {
    const p = join(dir, f.name);
    if (f.dir) return load(p);
    try { const r = await vpsCall<{ content: string }>(`/${id}/file?path=${encodeURIComponent(p)}`); setEdit({ path: p, content: r.content }); } catch (e: any) { notify('error', e.message); }
  };
  const save = async () => {
    if (!edit) return; setSaving(true);
    try { await vpsCall(`/${id}/file`, { method: 'PUT', body: { path: edit.path, content: edit.content } }); notify('success', 'File saved.'); setEdit(null); load(); } catch (e: any) { notify('error', e.message); } finally { setSaving(false); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => { setWorking(true); try { await fn(); notify('success', ok); setAsk(null); await load(); } catch (e: any) { notify('error', e.message); } finally { setWorking(false); } };
  const crumbs = dir.split('/').filter(Boolean);

  return (
    <div className="space-y-4">
      <TabHeader title="File Manager" subtitle="Browse and edit files inside your VPS (text files up to 2 MB). Use SFTP for large transfers."
        actions={<><Btn size="sm" disabled={!can} onClick={() => setAsk('file')}><FilePlus className="h-3.5 w-3.5" />New file</Btn><Btn size="sm" disabled={!can} onClick={() => setAsk('folder')}><FolderPlus className="h-3.5 w-3.5" />New folder</Btn><Btn size="sm" disabled={!can} onClick={() => load()}><RefreshCw className="h-3.5 w-3.5" /></Btn></>} />
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-zinc-800 text-xs font-mono overflow-x-auto no-scrollbar">
          <button onClick={() => can && load('/')} className="text-zinc-400 hover:text-amber-300">/</button>
          {crumbs.map((c, i) => <React.Fragment key={i}><ChevronRight className="h-3 w-3 text-zinc-700 shrink-0" /><button onClick={() => can && load('/' + crumbs.slice(0, i + 1).join('/'))} className="text-zinc-300 hover:text-amber-300 whitespace-nowrap">{c}</button></React.Fragment>)}
        </div>
        {!files ? <Spinner /> : err ? <Empty title="Files unavailable" text={err} /> : (
          <div className="divide-y divide-zinc-800/60">
            {dir !== '/' && <button onClick={() => load(parent(dir))} className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-zinc-400 hover:bg-zinc-800/40"><Folder className="h-4 w-4 text-zinc-600" />.. (up)</button>}
            {!files.length && <p className="px-4 py-8 text-center text-xs text-zinc-500">This folder is empty.</p>}
            {files.map(f => (
              <div key={f.name} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/40">
                <button onClick={() => open(f)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {f.dir ? <Folder className="h-4 w-4 text-amber-400 shrink-0" /> : <FileIcon className="h-4 w-4 text-zinc-500 shrink-0" />}
                  <span className="text-xs text-zinc-200 truncate">{f.name}{f.link ? ' →' : ''}</span>
                </button>
                <span className="hidden sm:block text-[11px] text-zinc-600 w-20 text-right">{f.dir ? '' : fmtBytes(f.size)}</span><span className="hidden md:block text-[11px] text-zinc-600 w-28 text-right">{when(f.modified)}</span>
                <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                  <button title="Rename" disabled={!can} onClick={() => setAsk({ rename: f })} className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
                  <button title="Delete" disabled={!can} onClick={() => setAsk({ del: f })} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>))}
          </div>)}
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.path || ''} wide footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={saving} onClick={save}><Save className="h-3.5 w-3.5" />Save</Btn></>}>
        {edit && <TextArea value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} spellCheck={false} className="!min-h-[380px] w-full" />}
      </Modal>
      <PromptModal open={ask === 'file'} title="New file" label="File name" placeholder="notes.txt" confirmLabel="Create" busy={working} onClose={() => setAsk(null)} onSubmit={n => { const name = n.trim(); if (name && !name.includes('/')) { setAsk(null); setEdit({ path: join(dir, name), content: '', isNew: true }); } else notify('error', 'Enter a file name without slashes.'); }} />
      <PromptModal open={ask === 'folder'} title="New folder" label="Folder name" confirmLabel="Create" busy={working} onClose={() => setAsk(null)} onSubmit={n => act(() => vpsCall(`/${id}/files/mkdir`, { method: 'POST', body: { path: join(dir, n.trim()) } }), 'Folder created.')} />
      <PromptModal open={!!ask && typeof ask === 'object' && 'rename' in ask} title="Rename" label="New name" initial={ask && typeof ask === 'object' && 'rename' in ask ? ask.rename.name : ''} confirmLabel="Rename" busy={working} onClose={() => setAsk(null)}
        onSubmit={n => ask && typeof ask === 'object' && 'rename' in ask && act(() => vpsCall(`/${id}/files/rename`, { method: 'POST', body: { from: join(dir, ask.rename.name), to: join(dir, n.trim()) } }), 'Renamed.')} />
      <ConfirmModal open={!!ask && typeof ask === 'object' && 'del' in ask} title="Delete permanently?" confirmLabel="Delete" danger busy={working} onClose={() => setAsk(null)}
        onConfirm={() => ask && typeof ask === 'object' && 'del' in ask && act(() => vpsCall(`/${id}/files/delete`, { method: 'POST', body: { path: join(dir, ask.del.name) } }), 'Deleted.')}>
        <b>{ask && typeof ask === 'object' && 'del' in ask ? ask.del.name : ''}</b> will be removed from the VPS. This cannot be undone.
      </ConfirmModal>
    </div>
  );
};
