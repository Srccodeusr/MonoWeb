import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, File as FileIcon, Upload, FolderPlus, Trash2, Download, Pencil, ChevronRight, Home, RefreshCw, Archive } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Modal, Spinner, TextArea, TextInput, fmtBytes, fmtDate } from '../../../components/ui/kit';

interface Entry { name: string; type: 'file' | 'dir'; size: number; modified: string }

export const FilesTab: React.FC<{ serverId: string; writable: boolean; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, writable, notify }) => {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const join = (a: string, b: string) => (a === '/' ? `/${b}` : `${a}/${b}`);
  const base = `/hosting/servers/${serverId}/files`;

  const load = useCallback(async (p: string) => {
    setEntries(null);
    const r = await apiRequest(`${base}?path=${encodeURIComponent(p)}`);
    if (r.success) { setEntries(r.data.entries); setPath(p); } else { notify('error', r.error?.message || 'Could not list files.'); setEntries([]); }
  }, [serverId]);
  useEffect(() => { load('/'); }, [load]);

  const open = async (e: Entry) => {
    const p = join(path, e.name);
    if (e.type === 'dir') return load(p);
    if (e.size > 5 * 1024 * 1024) return notify('error', 'This file is too large to edit in the browser. Download it instead.');
    const r = await apiRequest(`${base}/content?path=${encodeURIComponent(p)}`);
    if (r.success) setEditing({ path: p, content: r.data.content }); else notify('error', r.error?.message || 'Could not open the file.');
  };
  const save = async () => {
    if (!editing) return; setSaving(true);
    const r = await apiRequest(`${base}/content`, { method: 'PUT', body: JSON.stringify(editing) }); setSaving(false);
    if (r.success) { notify('success', 'Saved'); setEditing(null); load(path); } else notify('error', r.error?.message || 'Save failed.');
  };
  const act = async (op: string, body: any, ok: string) => {
    const r = await apiRequest(`${base}/${op}`, { method: 'POST', body: JSON.stringify(body) });
    if (r.success) { notify('success', ok); load(path); } else notify('error', r.error?.message || 'Action failed.');
  };
  const upload = async (f: File) => {
    if (f.size > 6 * 1024 * 1024) return notify('error', 'Uploads are limited to 6 MB here. Use git or the install script for larger files.');
    const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(f); });
    act('upload', { path, name: f.name, data }, `Uploaded ${f.name}`);
  };
  const download = async (e: Entry) => {
    const res = await fetch(`/api/v1${base}/download?path=${encodeURIComponent(join(path, e.name))}`, { headers: { Authorization: `Bearer ${localStorage.getItem('aether_token') || ''}` } });
    if (!res.ok) return notify('error', 'Download failed.');
    const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = e.name; a.click(); URL.revokeObjectURL(url);
  };

  const crumbs = path.split('/').filter(Boolean);
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-1 text-xs font-mono text-zinc-400 min-w-0 overflow-x-auto no-scrollbar">
          <button onClick={() => load('/')} className="hover:text-amber-300" aria-label="Root"><Home className="h-3.5 w-3.5" /></button>
          {crumbs.map((c, i) => <React.Fragment key={i}><ChevronRight className="h-3 w-3 text-zinc-700 shrink-0" /><button onClick={() => load('/' + crumbs.slice(0, i + 1).join('/'))} className="hover:text-amber-300 whitespace-nowrap">{c}</button></React.Fragment>)}
        </div>
        <div className="flex gap-1.5">
          <Btn size="sm" onClick={() => load(path)} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Btn>
          {writable && <>
            <Btn size="sm" onClick={() => { const n = window.prompt('New folder name'); if (n) act('mkdir', { path, name: n }, 'Folder created'); }}><FolderPlus className="h-3.5 w-3.5" />Folder</Btn>
            <Btn size="sm" variant="primary" onClick={() => fileInput.current?.click()}><Upload className="h-3.5 w-3.5" />Upload</Btn>
            <input ref={fileInput} type="file" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </>}
        </div>
      </div>
      {entries === null ? <Spinner /> : entries.length === 0 ? <p className="text-center text-xs text-zinc-500 py-12">This folder is empty.</p> : (
        <ul className="divide-y divide-zinc-800/70">
          {path !== '/' && <li><button onClick={() => load('/' + crumbs.slice(0, -1).join('/'))} className="w-full text-left px-4 py-2.5 text-xs text-zinc-500 hover:bg-zinc-900">.. (up)</button></li>}
          {entries.map(e => (
            <li key={e.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-900/70 group">
              <button onClick={() => open(e)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                {e.type === 'dir' ? <Folder className="h-4 w-4 text-amber-400 shrink-0" /> : <FileIcon className="h-4 w-4 text-zinc-500 shrink-0" />}
                <span className="text-xs text-zinc-200 truncate">{e.name}</span>
              </button>
              <span className="hidden sm:block text-[11px] text-zinc-600 font-mono w-20 text-right">{e.type === 'file' ? fmtBytes(e.size) : ''}</span>
              <span className="hidden md:block text-[11px] text-zinc-600 w-36 text-right">{fmtDate(e.modified)}</span>
              <span className="flex gap-1 opacity-60 group-hover:opacity-100">
                {e.type === 'file' && <button onClick={() => download(e)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Download"><Download className="h-3.5 w-3.5" /></button>}
                {writable && e.type === 'file' && /\.(zip|tar\.gz|tgz)$/i.test(e.name) && <button onClick={() => act('extract', { path: join(path, e.name), dest: path }, 'Extracted')} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Extract"><Archive className="h-3.5 w-3.5" /></button>}
                {writable && <button onClick={() => { const n = window.prompt('Rename to', e.name); if (n && n !== e.name) act('rename', { from: join(path, e.name), to: join(path, n) }, 'Renamed'); }} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>}
                {writable && <button onClick={() => window.confirm(`Delete ${e.name}?`) && act('delete', { paths: [join(path, e.name)] }, 'Deleted')} className="p-1.5 rounded hover:bg-red-500/10 text-red-400" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} wide title={editing?.path || ''} footer={<><Btn onClick={() => setEditing(null)}>Close</Btn>{writable && <Btn variant="primary" busy={saving} onClick={save}>Save</Btn>}</>}>
        {editing && <TextArea value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} readOnly={!writable} spellCheck={false} className="!min-h-[50vh] w-full" />}
      </Modal>
    </Card>
  );
};
