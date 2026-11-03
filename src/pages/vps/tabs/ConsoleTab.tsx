import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Terminal as TermIcon } from 'lucide-react';
import { Btn, Card, cx } from '../../../components/ui/kit';
import { TabHeader } from '../../../components/ui/panelKit';
import { vpsCall } from '../vpsApi';

interface Line { kind: 'cmd' | 'out' | 'err' | 'sys'; text: string }

export const ConsoleTab: React.FC<{ id: string; running: boolean; blocked: boolean; allowTerminal: boolean }> = ({ id, running, blocked, allowTerminal }) => {
  const [mode, setMode] = useState<'terminal' | 'logs'>(allowTerminal ? 'terminal' : 'logs');
  const [lines, setLines] = useState<Line[]>([{ kind: 'sys', text: 'Command runner: each command runs as root with a 30 s limit. For interactive programs use SSH or sshx.' }]);
  const [cwd, setCwd] = useState('/root'); const [cmd, setCmd] = useState(''); const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>([]); const [hi, setHi] = useState(-1);
  const [log, setLog] = useState(''); const [logBusy, setLogBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [lines, log, mode]);

  const loadLogs = useCallback(async () => { setLogBusy(true); try { setLog((await vpsCall<{ log: string }>(`/${id}/logs`)).log || '(no output yet)'); } catch (e: any) { setLog(`Could not load logs: ${e.message}`); } finally { setLogBusy(false); } }, [id]);
  useEffect(() => { if (mode === 'logs') loadLogs(); }, [mode, loadLogs]);

  const run = async () => {
    const c = cmd.trim(); if (!c || busy) return;
    setCmd(''); setHist(h => [c, ...h].slice(0, 50)); setHi(-1); setBusy(true); setLines(l => [...l, { kind: 'cmd', text: `${cwd} # ${c}` }]);
    try {
      const r = await vpsCall<{ output: string; code: number; cwd: string }>(`/${id}/exec`, { method: 'POST', body: { cmd: c, cwd } });
      setLines(l => [...l, ...(r.output ? [{ kind: (r.code ? 'err' : 'out') as Line['kind'], text: r.output.replace(/\n$/, '') }] : [])]); if (r.cwd) setCwd(r.cwd);
    } catch (e: any) { setLines(l => [...l, { kind: 'err', text: e.message }]); } finally { setBusy(false); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') run();
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(hist.length - 1, hi + 1); if (hist[n] !== undefined) { setHi(n); setCmd(hist[n]); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const n = hi - 1; setHi(n); setCmd(n >= 0 ? hist[n] : ''); }
  };
  const canType = running && !blocked;

  return (
    <div className="space-y-4">
      <TabHeader title="Terminal & Logs" subtitle="Run commands as root, or read the VPS boot output."
        actions={<div className="flex rounded-xl border border-zinc-800 overflow-hidden text-xs font-semibold">
          {allowTerminal && <button onClick={() => setMode('terminal')} className={cx('px-3.5 py-2', mode === 'terminal' ? 'bg-amber-500/10 text-amber-300' : 'text-zinc-400 hover:text-zinc-200')}>Terminal</button>}
          <button onClick={() => setMode('logs')} className={cx('px-3.5 py-2', mode === 'logs' ? 'bg-amber-500/10 text-amber-300' : 'text-zinc-400 hover:text-zinc-200')}>Logs</button></div>} />
      <Card className="!p-0 overflow-hidden">
        <div ref={box} className="h-[420px] overflow-y-auto bg-black/60 p-4 font-mono text-[12px] leading-relaxed">
          {mode === 'logs'
            ? <pre className="whitespace-pre-wrap break-words text-zinc-300">{log || 'Loading…'}</pre>
            : lines.map((l, i) => <pre key={i} className={cx('whitespace-pre-wrap break-words', l.kind === 'cmd' ? 'text-amber-300 mt-2' : l.kind === 'err' ? 'text-red-300' : l.kind === 'sys' ? 'text-zinc-500' : 'text-zinc-200')}>{l.text}</pre>)}
        </div>
        {mode === 'terminal' ? (
          <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2.5">
            <TermIcon className="h-4 w-4 text-zinc-600 shrink-0" /><span className="font-mono text-[11px] text-zinc-500 truncate max-w-[40%]">{cwd} #</span>
            <input value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={onKey} disabled={!canType || busy} autoComplete="off" spellCheck={false} placeholder={canType ? 'Type a command and press Enter' : 'Start the VPS to run commands'} className="flex-1 min-w-0 bg-transparent font-mono text-[12px] text-zinc-100 placeholder-zinc-600 focus:outline-none disabled:opacity-50" />
            <Btn size="sm" variant="primary" busy={busy} disabled={!canType || !cmd.trim()} onClick={run}>Run</Btn>
          </div>
        ) : <div className="flex justify-end border-t border-zinc-800 bg-zinc-950 px-3 py-2.5"><Btn size="sm" busy={logBusy} onClick={loadLogs}><RefreshCw className="h-3.5 w-3.5" />Refresh</Btn></div>}
      </Card>
    </div>
  );
};
