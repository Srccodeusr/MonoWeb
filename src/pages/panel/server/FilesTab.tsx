import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, File as FileIcon, FileCode, FileText, FileArchive, FileImage, FilePlus, FolderPlus, Upload, FolderUp, Link2, Trash2, Download, Pencil, Archive, Copy, MoreVertical, RefreshCw, Search, ChevronRight, ChevronDown, ArrowLeft, Save, Network, FileUp, CornerLeftUp, MoveRight, CopyPlus, PackagePlus } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Empty, Spinner, TextInput, cx, fmtDate } from '../../../components/ui/kit';
import { Checkbox, ConfirmModal, Menu, PromptModal, TabHeader } from '../../../components/ui/panelKit';
import { SftpCard } from './SftpCard';
import { RecycleBin } from './RecycleBin';
import { FolderPicker } from './FolderPicker';

interface Entry { name: string; type: 'file' | 'dir'; size: number; modified: string }
type Notify = (t: 'success' | 'error', m: string) => void;
type Dialog = null | { kind: 'newFile' } | { kind: 'newFolder' } | { kind: 'pull' } | { kind: 'rename'; entry: Entry } | { kind: 'delete'; names: string[] } | { kind: 'move'; names: string[] } | { kind: 'copy'; names: string[] } | { kind: 'archive'; names: string[] } | { kind: 'leave' };

const MAX_UPLOAD = 6 * 1024 * 1024;
const sizeText = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
const join = (a: string, b: string) => (a === '/' ? `/${b}` : `${a}/${b}`);
const ext = (n: string) => (n.includes('.') ? n.split('.').pop()!.toLowerCase() : '');
const LANGS: Record<string, string> = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', json: 'JSON', py: 'Python', md: 'Markdown', html: 'HTML', css: 'CSS', yml: 'YAML', yaml: 'YAML', sh: 'Shell', properties: 'Properties', txt: 'Plain text', env: 'Env', java: 'Java', xml: 'XML', toml: 'TOML' };

function iconFor(e: Entry) {
  if (e.type === 'dir') return <Folder className="h-[18px] w-[18px] text-amber-400 shrink-0" />;
  const x = ext(e.name);
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'sh', 'java', 'yml', 'yaml', 'toml'].includes(x)) return <FileCode className="h-[18px] w-[18px] text-sky-400/80 shrink-0" />;
  if (['txt', 'md', 'log', 'properties', 'env', 'cfg', 'conf', 'ini'].includes(x)) return <FileText className="h-[18px] w-[18px] text-zinc-400 shrink-0" />;
  if (['zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'jar'].includes(x)) return <FileArchive className="h-[18px] w-[18px] text-purple-400/80 shrink-0" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(x)) return <FileImage className="h-[18px] w-[18px] text-emerald-400/80 shrink-0" />;
  return <FileIcon className="h-[18px] w-[18px] text-zinc-500 shrink-0" />;
}

const readB64 = (f: File) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(f); });

export const FilesTab: React.FC<{ serverId: string; writable: boolean; notify: Notify; onUpgrade: () => void }> = ({ serverId, writable, notify, onUpgrade }) => {
  const [view, setView] = useState<'files' | 'bin'>('files');
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string; saved: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sftpOpen, setSftpOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const base = `/hosting/servers/${serverId}/files`;

  const load = useCallback(async (p: string) => {
    setEntries(null); setSel(new Set()); setSearch('');
    const r = await apiRequest(`${base}?path=${encodeURIComponent(p)}`);
    if (r.success) { setEntries(r.data.entries); setPath(p); } else { notify('error', r.error?.message || 'Could not list files.'); setEntries([]); }
  }, [serverId]);
  useEffect(() => { load('/'); }, [load]);

  const crumbs = path.split('/').filter(Boolean);
  const visible = useMemo(() => { const s = search.trim().toLowerCase(); return (entries || []).filter(e => !s || e.name.toLowerCase().includes(s)); }, [entries, search]);
  const allOn = visible.length > 0 && visible.every(e => sel.has(e.name));

  const act = async (op: string, body: any, ok: string): Promise<boolean> => {
    setBusy(true);
    const r = await apiRequest(`${base}/${op}`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (r.success) { if (ok) notify('success', ok); load(path); return true; }
    notify('error', r.error?.message || 'Action failed.'); return false;
  };

  const openFile = async (e: Entry) => {
    const p = join(path, e.name);
    if (e.size > 5 * 1024 * 1024) return notify('error', 'This file is too large to edit in the browser. Download it instead.');
    const r = await apiRequest(`${base}/content?path=${encodeURIComponent(p)}`);
    if (r.success) setEditing({ path: p, content: r.data.content, saved: r.data.content }); else notify('error', r.error?.message || 'Could not open the file.');
  };
  const openEntry = (e: Entry) => (e.type === 'dir' ? load(join(path, e.name)) : openFile(e));

  const save = async () => {
    if (!editing || !writable) return; setSaving(true);
    const r = await apiRequest(`${base}/content`, { method: 'PUT', body: JSON.stringify({ path: editing.path, content: editing.content }) }); setSaving(false);
    if (r.success) { notify('success', 'File saved'); setEditing({ ...editing, saved: editing.content }); } else notify('error', r.error?.message || 'Save failed.');
  };
  const dirty = !!editing && editing.content !== editing.saved;
  const leaveEditor = () => { if (dirty) setDialog({ kind: 'leave' }); else { setEditing(null); load(path); } };

  const upload = async (items: { file: File; rel: string }[]) => {
    if (!writable || items.length === 0) return;
    setUp({ done: 0, total: items.length }); const failed: string[] = []; let okN = 0;
    for (const { file, rel } of items) {
      const parts = rel.split('/').filter(Boolean); const name = parts.pop() || file.name;
      if (file.size > MAX_UPLOAD) failed.push(`${name} (over 6 MB)`);
      else {
        try {
          const r = await apiRequest(`${base}/upload`, { method: 'POST', body: JSON.stringify({ path: parts.length ? join(path, parts.join('/')) : path, name, data: await readB64(file) }) });
          if (r.success) okN++; else failed.push(`${name} (${r.error?.message || 'failed'})`);
        } catch { failed.push(name); }
      }
      setUp(u => (u ? { ...u, done: u.done + 1 } : u));
    }
    setUp(null); load(path);
    if (okN) notify('success', okN === 1 ? 'Uploaded 1 file' : `Uploaded ${okN} files`);
    if (failed.length) notify('error', `Skipped ${failed.length}: ${failed.slice(0, 2).join(', ')}${failed.length > 2 ? '…' : ''}. Use git, SFTP or “Pull from URL” for large files.`);
  };
  const fromInput = (el: HTMLInputElement) => { const files = [...(el.files || [])]; el.value = ''; upload(files.map(f => ({ file: f, rel: (f as any).webkitRelativePath || f.name }))); };

  const download = async (e: Entry) => {
    const res = await fetch(`/api/v1${base}/download?path=${encodeURIComponent(join(path, e.name))}`, { headers: { Authorization: `Bearer ${localStorage.getItem('aether_token') || ''}` } });
    if (!res.ok) return notify('error', 'Download failed.');
    const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = e.name; a.click(); URL.revokeObjectURL(url);
  };

  const downloadMany = async (names: string[]) => {
    const one = (entries || []).find(e => e.name === names[0]);
    if (names.length === 1 && one?.type === 'file') return download(one);
    notify('success', 'Preparing your download…');
    const res = await fetch(`/api/v1${base}/bulk-download`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('aether_token') || ''}` }, body: JSON.stringify({ path, names }) });
    if (!res.ok) { let m = 'Download failed.'; try { m = (await res.json()).error?.message || m; } catch { /* not json */ } return notify('error', m); }
    const fname = /filename="?([^"]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || 'files.tar.gz';
    const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
  };
  const archiveDefault = useMemo(() => `archive-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 17)}.tar.gz`, [dialog]);

  const rowMenu = (e: Entry) => [
    { label: e.type === 'dir' ? 'Open' : 'Edit', icon: e.type === 'dir' ? <Folder /> : <Pencil />, onClick: () => openEntry(e) },
    ...(writable ? [{ label: 'Rename', icon: <Pencil />, onClick: () => setDialog({ kind: 'rename', entry: e }) }] : []),
    ...(writable ? [{ label: 'Move', icon: <MoveRight />, onClick: () => setDialog({ kind: 'move', names: [e.name] }) }, { label: 'Copy', icon: <CopyPlus />, onClick: () => setDialog({ kind: 'copy', names: [e.name] }) }, { label: 'Archive', icon: <PackagePlus />, onClick: () => setDialog({ kind: 'archive', names: [e.name] }) }] : []),
    { label: e.type === 'dir' ? 'Download as .tar.gz' : 'Download', icon: <Download />, onClick: () => downloadMany([e.name]) },
    ...(writable && e.type === 'file' && /\.(zip|tar\.gz|tgz)$/i.test(e.name) ? [{ label: 'Extract here', icon: <Archive />, onClick: () => act('extract', { path: join(path, e.name), dest: path }, 'Extracted') }] : []),
    { label: 'Copy path', icon: <Copy />, onClick: () => navigator.clipboard?.writeText(join(path, e.name)).then(() => notify('success', 'Path copied')) },
    ...(writable ? ['divider' as const, { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => setDialog({ kind: 'delete', names: [e.name] }) }] : []),
  ];

  if (view === 'bin') return <RecycleBin serverId={serverId} writable={writable} notify={notify} onBack={() => { setView('files'); load(path); }} />;

  // ------------------------------------------------------------------ editor
  if (editing) {
    const lines = editing.content.split('\n').length;
    const lang = LANGS[ext(editing.path)] || 'Plain text';
    const crumbParts = editing.path.split('/').filter(Boolean);
    return (
      <div className="space-y-4" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } }}>
        <TabHeader title="File Editor" subtitle={editing.path} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs font-mono text-zinc-400 min-w-0 overflow-x-auto no-scrollbar"><span className="text-zinc-600">/</span> home <span className="text-zinc-600">/</span> container {crumbParts.map((c, i) => <React.Fragment key={i}><span className="text-zinc-600">/</span><span className={i === crumbParts.length - 1 ? 'text-white font-semibold' : ''}>{c}</span></React.Fragment>)}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="h-9 inline-flex items-center px-3 rounded-lg border border-zinc-800 bg-zinc-950 text-[11px] font-mono text-zinc-400">{lang}</span>
            <Btn onClick={leaveEditor}><ArrowLeft className="h-3.5 w-3.5" />Back</Btn>
            <Btn onClick={() => navigator.clipboard?.writeText(editing.content).then(() => notify('success', 'Copied to clipboard'))}><Copy className="h-3.5 w-3.5" />Copy</Btn>
            {writable && <Btn variant="primary" busy={saving} disabled={!dirty} onClick={save}><Save className="h-3.5 w-3.5" />Save content</Btn>}
          </div>
        </div>
        <div className="flex rounded-2xl border border-zinc-800 bg-black overflow-hidden">
          <pre ref={gutter} aria-hidden className="select-none text-right text-zinc-600 font-mono text-[12px] leading-5 py-3 pl-3 pr-3 overflow-hidden bg-zinc-950 border-r border-zinc-800 h-[62vh] min-w-[3.25rem]">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
          <textarea value={editing.content} readOnly={!writable} spellCheck={false} wrap="off" aria-label={`Contents of ${editing.path}`} autoFocus
            onChange={e => setEditing({ ...editing, content: e.target.value })} onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
            onKeyDown={e => { if (e.key === 'Tab' && writable) { e.preventDefault(); const t = e.currentTarget; t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end'); setEditing({ ...editing, content: t.value }); } }}
            className="flex-1 min-w-0 bg-transparent text-zinc-200 font-mono text-[12px] leading-5 py-3 px-3 outline-none resize-none whitespace-pre overflow-auto h-[62vh]" />
        </div>
        <p className="text-[11px] text-zinc-500">{dirty ? 'You have unsaved changes. ' : ''}{writable ? 'Press Ctrl+S (⌘S on Mac) to save.' : 'You have read-only access to this server’s files.'}</p>
        <ConfirmModal open={dialog?.kind === 'leave'} title="Discard unsaved changes?" confirmLabel="Discard" danger onClose={() => setDialog(null)} onConfirm={() => { setDialog(null); setEditing(null); load(path); }}>Your edits to <b className="font-mono">{editing.path}</b> have not been saved.</ConfirmModal>
      </div>
    );
  }

  // ------------------------------------------------------------------ file list
  const selected = [...sel];
  return (
    <div className="space-y-4" onDragOver={e => { if (writable && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={e => { if (!writable) return; e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files].map(f => ({ file: f, rel: f.name }))); }}>
      <TabHeader title="File Manager" subtitle="Create, edit, and manage files on your server" />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-zinc-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <TextInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files and folders…" className="!pl-10" aria-label="Search files and folders" />
        </div>
        <Btn onClick={() => setView('bin')}><Trash2 className="h-3.5 w-3.5" />Recycle bin</Btn>
        <Btn onClick={() => load(path)} aria-label="Refresh" title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Btn>
      </div>

      <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 min-w-0 overflow-x-auto no-scrollbar">
        <Checkbox checked={allOn} indeterminate={!allOn && sel.size > 0} label="Select all" onChange={v => setSel(v ? new Set(visible.map(e => e.name)) : new Set())} />
        <span className="text-zinc-600 ml-1">/</span><span>home</span><span className="text-zinc-600">/</span>
        <button onClick={() => load('/')} className={cx('hover:text-amber-300', path === '/' && 'text-white font-semibold')}>container</button><span className="text-zinc-600">/</span>
        {crumbs.map((c, i) => <React.Fragment key={i}><button onClick={() => load('/' + crumbs.slice(0, i + 1).join('/'))} className={cx('hover:text-amber-300 whitespace-nowrap', i === crumbs.length - 1 && 'text-white font-semibold')}>{c}</button><span className="text-zinc-600">/</span></React.Fragment>)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Menu label={<><FilePlus className="h-3.5 w-3.5" />Create</>} disabled={!writable} items={[
          { label: 'New File', icon: <FilePlus />, onClick: () => setDialog({ kind: 'newFile' }) },
          { label: 'New Folder', icon: <FolderPlus />, onClick: () => setDialog({ kind: 'newFolder' }) },
        ]} />
        <Menu label={<><Upload className="h-3.5 w-3.5" />Upload</>} disabled={!writable} variant="dark" items={[
          { label: 'Upload Files', icon: <FileUp />, onClick: () => fileInput.current?.click() },
          { label: 'Upload Folder', icon: <FolderUp />, onClick: () => folderInput.current?.click() },
          { label: 'Pull from URL', icon: <Link2 />, onClick: () => setDialog({ kind: 'pull' }) },
        ]} />
        {sel.size > 0 && <>
          <span className="hidden sm:block h-6 w-px bg-zinc-800" />
          <span className="text-[11px] font-mono text-zinc-400">{sel.size} selected</span>
          <Btn size="sm" onClick={() => downloadMany(selected)}><Download className="h-3.5 w-3.5" />Download</Btn>
          {writable && <>
            <Btn size="sm" onClick={() => setDialog({ kind: 'move', names: selected })}><MoveRight className="h-3.5 w-3.5" />Move</Btn>
            <Btn size="sm" onClick={() => setDialog({ kind: 'copy', names: selected })}><CopyPlus className="h-3.5 w-3.5" />Copy</Btn>
            <Btn size="sm" onClick={() => setDialog({ kind: 'archive', names: selected })}><PackagePlus className="h-3.5 w-3.5" />Archive</Btn>
          </>}
        </>}
        <Btn variant="danger" disabled={!writable || sel.size === 0} onClick={() => setDialog({ kind: 'delete', names: selected })} aria-label="Delete selected" title="Delete selected"><Trash2 className="h-3.5 w-3.5" />{sel.size > 0 && <span>{sel.size}</span>}</Btn>
        {up && <span className="text-[11px] font-mono text-amber-300 flex items-center gap-2"><RefreshCw className="h-3 w-3 animate-spin" />Uploading {Math.min(up.done + 1, up.total)} of {up.total}…</span>}
        <input ref={fileInput} type="file" multiple hidden onChange={e => fromInput(e.target)} />
        <input ref={folderInput} type="file" hidden onChange={e => fromInput(e.target)} {...({ webkitdirectory: '', directory: '' } as any)} />
      </div>

      <div className={cx('rounded-2xl border bg-zinc-900/60 overflow-hidden transition-colors', drag ? 'border-amber-400 border-dashed bg-amber-500/5' : 'border-zinc-800')}>
        {entries === null ? <Spinner /> : (
          <ul className="divide-y divide-zinc-800/70">
            {path !== '/' && <li><button onClick={() => load('/' + crumbs.slice(0, -1).join('/'))} className="w-full flex items-center gap-3 px-4 py-3 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"><span className="w-[18px]" /><CornerLeftUp className="h-4 w-4" />Parent folder</button></li>}
            {visible.length === 0 && <li>{search ? <p className="text-center text-xs text-zinc-500 py-12">No files match “{search}”.</p> : <Empty icon={<Folder className="h-10 w-10" />} title="This folder is empty" text={writable ? 'Create a file, or drag files here to upload them.' : undefined} />}</li>}
            {visible.map(e => (
              <li key={e.name} className={cx('flex items-center gap-3 px-4 py-2.5 group transition-colors', sel.has(e.name) ? 'bg-amber-500/[0.06]' : 'hover:bg-zinc-900/80')}>
                <Checkbox checked={sel.has(e.name)} label={`Select ${e.name}`} onChange={v => setSel(s => { const n = new Set(s); if (v) n.add(e.name); else n.delete(e.name); return n; })} />
                <button onClick={() => openEntry(e)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  {iconFor(e)}
                  <span className="min-w-0"><span className="block text-sm text-zinc-100 truncate">{e.name}</span><span className="block sm:hidden text-[10px] text-zinc-600 font-mono">{e.type === 'file' ? `${sizeText(e.size)} · ` : ''}{fmtDate(e.modified)}</span></span>
                </button>
                <span className="hidden sm:block text-[11px] text-zinc-500 font-mono w-20 text-right">{e.type === 'file' ? sizeText(e.size) : ''}</span>
                <span className="hidden md:block text-[11px] text-zinc-500 w-40 text-right">{fmtDate(e.modified)}</span>
                <Menu label={<MoreVertical className="h-4 w-4" />} chevron={false} iconOnly size="sm" variant="dark" align="right" ariaLabel={`Actions for ${e.name}`} items={rowMenu(e)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Card className="!p-0 overflow-hidden">
        <button onClick={() => setSftpOpen(o => !o)} className="w-full flex items-center gap-3.5 px-5 py-4 text-left hover:bg-zinc-900/60" aria-expanded={sftpOpen}>
          <Network className="h-6 w-6 text-amber-400 shrink-0" />
          <span className="flex-1 min-w-0"><span className="block text-sm font-bold text-white">SFTP Connection Details</span><span className="block text-xs text-zinc-500">Click to show host, port, username and quick-connect URL</span></span>
          <ChevronDown className={cx('h-4 w-4 text-zinc-500 transition-transform', sftpOpen && 'rotate-180')} />
        </button>
        {sftpOpen && <div className="border-t border-zinc-800 p-4"><SftpCard serverId={serverId} onUpgrade={onUpgrade} notify={notify} /></div>}
      </Card>

      <PromptModal open={dialog?.kind === 'newFile'} title="New file" label="File name" placeholder="index.js" confirmLabel="Create file" busy={busy} onClose={() => setDialog(null)}
        onSubmit={async name => { if (name.includes('/')) return notify('error', 'File names cannot contain “/”. Create the folder first.'); setBusy(true); const r = await apiRequest(`${base}/content`, { method: 'PUT', body: JSON.stringify({ path: join(path, name), content: '' }) }); setBusy(false); setDialog(null); if (r.success) { await load(path); setEditing({ path: join(path, name), content: '', saved: '' }); } else notify('error', r.error?.message || 'Could not create the file.'); }} />
      <PromptModal open={dialog?.kind === 'newFolder'} title="New folder" label="Folder name" placeholder="plugins" confirmLabel="Create folder" busy={busy} onClose={() => setDialog(null)}
        onSubmit={async name => { if (await act('mkdir', { path, name }, 'Folder created')) setDialog(null); }} />
      <PromptModal open={dialog?.kind === 'pull'} title="Pull from URL" label="File URL" placeholder="https://example.com/file.zip" type="url" confirmLabel="Download to server" busy={busy} hint={`Saved into ${path}. Up to 512 MB, public http(s) links only.`}
        secondary={{ label: 'Save as', placeholder: 'Leave empty to use the name from the link', optional: true }} onSubmit={() => undefined} onClose={() => setDialog(null)}
        onSubmit2={async (url, name) => { if (await act('pull', { url, path, name: name || undefined }, 'File downloaded')) setDialog(null); }} />
      <PromptModal open={dialog?.kind === 'rename'} title="Rename" label="New name" initial={dialog?.kind === 'rename' ? dialog.entry.name : ''} confirmLabel="Rename" busy={busy} onClose={() => setDialog(null)}
        onSubmit={async name => { if (dialog?.kind !== 'rename') return; if (name === dialog.entry.name) return setDialog(null); if (await act('rename', { from: join(path, dialog.entry.name), to: join(path, name) }, 'Renamed')) setDialog(null); }} />
      <FolderPicker open={dialog?.kind === 'move'} title="Move" confirmLabel="Move here" serverId={serverId} initial={path} count={dialog?.kind === 'move' ? dialog.names.length : 0} busy={busy} onClose={() => setDialog(null)}
        onSubmit={async dest => { if (dialog?.kind !== 'move') return; if (await act('move', { paths: dialog.names.map(n => join(path, n)), dest }, `Moved ${dialog.names.length} item${dialog.names.length === 1 ? '' : 's'}`)) setDialog(null); }} />
      <FolderPicker open={dialog?.kind === 'copy'} title="Copy" confirmLabel="Copy here" serverId={serverId} initial={path} count={dialog?.kind === 'copy' ? dialog.names.length : 0} busy={busy} hint="in the same folder, copies are named “… copy”" onClose={() => setDialog(null)}
        onSubmit={async dest => { if (dialog?.kind !== 'copy') return; if (await act('copy', { paths: dialog.names.map(n => join(path, n)), dest: dest === path ? undefined : dest }, `Copied ${dialog.names.length} item${dialog.names.length === 1 ? '' : 's'}`)) setDialog(null); }} />
      <PromptModal open={dialog?.kind === 'archive'} title="Archive" label="Archive name" initial={archiveDefault} confirmLabel="Create archive" busy={busy} hint={dialog?.kind === 'archive' ? `${dialog.names.length} item${dialog.names.length === 1 ? '' : 's'} will be saved as a .tar.gz in ${path}.` : undefined} onClose={() => setDialog(null)}
        onSubmit={async name => { if (dialog?.kind !== 'archive') return; if (await act('archive', { path, names: dialog.names, name }, 'Archive created')) setDialog(null); }} />
      <ConfirmModal open={dialog?.kind === 'delete'} title="Delete" confirmLabel="Move to recycle bin" danger busy={busy} onClose={() => setDialog(null)}
        onConfirm={async () => { if (dialog?.kind !== 'delete') return; if (await act('delete', { paths: dialog.names.map(n => join(path, n)) }, `Moved ${dialog.names.length} item${dialog.names.length === 1 ? '' : 's'} to the recycle bin`)) setDialog(null); }}>
        {dialog?.kind === 'delete' && <>Move <b className="text-white">{dialog.names.length === 1 ? dialog.names[0] : `${dialog.names.length} items`}</b> to the recycle bin? You can restore {dialog.names.length === 1 ? 'it' : 'them'} for 3 days.</>}
      </ConfirmModal>
    </div>
  );
};
