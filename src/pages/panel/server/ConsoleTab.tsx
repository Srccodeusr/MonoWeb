import React, { useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, TextInput, fmtBytes } from '../../../components/ui/kit';

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const MAX_LINES = 1200;

interface Stats { running: boolean; cpuPercent: number; memBytes: number; memLimit: number; diskBytes: number; diskLimit: number; netRx: number; netTx: number }

const Bar: React.FC<{ label: string; value: string; pct: number }> = ({ label, value, pct }) => (
  <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2.5">
    <div className="flex justify-between text-[10px] font-mono text-zinc-500"><span>{label}</span><span className="text-zinc-300">{value}</span></div>
    <div className="h-1 rounded-full bg-zinc-800 mt-2 overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
  </div>
);

export const ConsoleTab: React.FC<{ serverId: string; running: boolean; canSend: boolean; cpuLimit: number }> = ({ serverId, running, canSend, cpuLimit }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const history = useRef<string[]>([]); const hIdx = useRef(-1);
  const box = useRef<HTMLDivElement>(null); const stick = useRef(true);

  // Live console over a fetch stream (EventSource cannot send the Authorization header).
  useEffect(() => {
    const ctrl = new AbortController(); let alive = true; let pending = '';
    const push = (text: string) => {
      const parts = (pending + text.replace(ANSI, '')).split(/\r?\n|\r(?!\n)/); pending = parts.pop() ?? '';
      if (parts.length) setLines(l => { const n = l.concat(parts); return n.length > MAX_LINES ? n.slice(-MAX_LINES) : n; });
    };
    const run = async () => {
      while (alive) {
        try {
          const res = await fetch(`/api/v1/hosting/servers/${serverId}/console`, { headers: { Authorization: `Bearer ${localStorage.getItem('aether_token') || ''}` }, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error('console unavailable');
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf('\n\n')) >= 0) {
              const ev = buf.slice(0, i); buf = buf.slice(i + 2);
              const name = /^event: (.+)$/m.exec(ev)?.[1]; const data = ev.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
              if (name === 'log' && data) { try { push(JSON.parse(data)); } catch { /* ignore */ } }
            }
          }
        } catch { /* reconnect below */ }
        if (alive) await new Promise(r => setTimeout(r, 3000));
      }
    };
    setLines([]); run();
    return () => { alive = false; ctrl.abort(); };
  }, [serverId, running]);

  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines]);

  useEffect(() => {
    let alive = true;
    const tick = async () => { const r = await apiRequest<Stats>(`/hosting/servers/${serverId}/stats`); if (alive && r.success) setStats(r.data || null); };
    tick(); const t = window.setInterval(tick, 5000); return () => { alive = false; window.clearInterval(t); };
  }, [serverId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); const c = cmd.trim(); if (!c) return;
    setSending(true); history.current.unshift(c); hIdx.current = -1; setCmd('');
    const r = await apiRequest(`/hosting/servers/${serverId}/command`, { method: 'POST', body: JSON.stringify({ command: c }) });
    setSending(false);
    if (!r.success) setLines(l => [...l, `[panel] ${r.error?.message || 'Command failed'}`]);
  };

  const memPct = stats && stats.memLimit ? (stats.memBytes / stats.memLimit) * 100 : 0;
  const diskPct = stats && stats.diskLimit ? (stats.diskBytes / stats.diskLimit) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Bar label="CPU" value={stats ? `${stats.cpuPercent.toFixed(1)}% / ${cpuLimit}%` : '—'} pct={stats ? (stats.cpuPercent / cpuLimit) * 100 : 0} />
        <Bar label="MEMORY" value={stats ? `${fmtBytes(stats.memBytes)} / ${fmtBytes(stats.memLimit)}` : '—'} pct={memPct} />
        <Bar label="DISK" value={stats ? `${fmtBytes(stats.diskBytes)} / ${fmtBytes(stats.diskLimit)}` : '—'} pct={diskPct} />
        <Bar label="NETWORK" value={stats ? `↓${fmtBytes(stats.netRx)} ↑${fmtBytes(stats.netTx)}` : '—'} pct={0} />
      </div>
      <div className="rounded-2xl border border-zinc-800 bg-black overflow-hidden">
        <div ref={box} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} className="h-[46vh] min-h-[260px] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-all">
          {lines.length === 0 ? <span className="text-zinc-600">Waiting for output… start the server to see logs.</span> : lines.map((l, i) => <div key={i}>{l || '\u00a0'}</div>)}
        </div>
        <form onSubmit={send} className="flex items-center gap-2 border-t border-zinc-800 p-2 bg-zinc-950">
          <span className="text-amber-500 font-mono text-xs pl-2">$</span>
          <TextInput value={cmd} onChange={e => setCmd(e.target.value)} disabled={!canSend || !running} placeholder={running ? 'Type a command and press Enter' : 'Server is offline'} maxLength={2048} autoComplete="off" spellCheck={false}
            onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); hIdx.current = Math.min(history.current.length - 1, hIdx.current + 1); setCmd(history.current[hIdx.current] || ''); } if (e.key === 'ArrowDown') { e.preventDefault(); hIdx.current = Math.max(-1, hIdx.current - 1); setCmd(history.current[hIdx.current] || ''); } }}
            className="!bg-transparent !border-0 !px-1 font-mono text-xs" />
          <Btn type="button" size="sm" onClick={() => setLines([])} aria-label="Clear"><Trash2 className="h-3.5 w-3.5" /></Btn>
          <Btn type="submit" size="sm" variant="primary" busy={sending} disabled={!canSend || !running || !cmd.trim()}><Send className="h-3.5 w-3.5" /></Btn>
        </form>
      </div>
    </div>
  );
};
