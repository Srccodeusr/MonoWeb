import React, { useEffect, useState } from 'react';
import { Folder, CornerLeftUp, Loader2 } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Modal, TextInput, cx } from '../../../components/ui/kit';

/** Normalises a typed path: leading "/", no "//" or "." parts, ".." walks up (never above the server root). */
export function normPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return '/' + out.join('/');
}

/** "Move to" / "Copy to" dialog: type a folder (relative to /home/container) or click through the folders. */
export const FolderPicker: React.FC<{ open: boolean; title: string; confirmLabel: string; serverId: string; initial: string; count: number; busy?: boolean; hint?: string; onClose: () => void; onSubmit: (dest: string) => void }> =
  ({ open, title, confirmLabel, serverId, initial, count, busy, hint, onClose, onSubmit }) => {
    const [text, setText] = useState(initial);
    const [dirs, setDirs] = useState<string[]>([]);
    const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
    useEffect(() => { if (open) setText(initial); }, [open, initial]);
    const path = normPath(text);

    useEffect(() => {
      if (!open) return;
      let alive = true; setState('loading');
      const t = window.setTimeout(async () => {
        const r = await apiRequest(`/hosting/servers/${serverId}/files?path=${encodeURIComponent(path)}`);
        if (!alive) return;
        if (r.success) { setDirs((r.data.entries as { name: string; type: string }[]).filter(e => e.type === 'dir').map(e => e.name)); setState('ok'); } else { setDirs([]); setState('missing'); }
      }, 200);
      return () => { alive = false; window.clearTimeout(t); };
    }, [open, path, serverId]);

    const go = (p: string) => setText(normPath(p));
    return (
      <Modal open={open} onClose={onClose} title={title} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={state !== 'ok'} onClick={() => onSubmit(path)}>{confirmLabel}</Btn></>}>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Destination folder</span>
            <div className="flex items-center rounded-xl bg-zinc-950 border border-zinc-800 focus-within:border-amber-500/60 overflow-hidden">
              <span className="pl-3 pr-1 text-xs font-mono text-zinc-600 shrink-0">/home/container</span>
              <TextInput autoFocus value={text} onChange={e => setText(e.target.value)} spellCheck={false} autoComplete="off" aria-label="Destination folder" className="!border-0 !bg-transparent !pl-0 font-mono !text-xs" />
            </div>
          </label>
          <p className="text-[11px] text-zinc-500">{count} item{count === 1 ? '' : 's'} → <span className="font-mono text-zinc-300">/home/container{path === '/' ? '/' : path + '/'}</span>{hint ? <> · {hint}</> : null}</p>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 max-h-56 overflow-y-auto divide-y divide-zinc-800/70" role="listbox" aria-label="Folders">
            {path !== '/' && <button onClick={() => go(path + '/..')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-zinc-400 hover:bg-zinc-900 text-left"><CornerLeftUp className="h-4 w-4" />Parent folder</button>}
            {state === 'loading' && <p className="px-3.5 py-4 text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading folders…</p>}
            {state === 'missing' && <p className="px-3.5 py-4 text-xs text-red-300">That folder does not exist. Pick an existing folder, or create it first with Create → New Folder.</p>}
            {state === 'ok' && dirs.length === 0 && <p className="px-3.5 py-4 text-xs text-zinc-600">No subfolders here.</p>}
            {state === 'ok' && dirs.map(d => <button key={d} onClick={() => go(`${path}/${d}`)} className={cx('w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-zinc-200 hover:bg-zinc-900 text-left')}><Folder className="h-4 w-4 text-amber-400" /><span className="truncate">{d}</span></button>)}
          </div>
        </div>
      </Modal>
    );
  };
