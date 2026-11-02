import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Trash2, RefreshCw, Search, Send, Wifi, Clock, Cpu, MemoryStick, HardDrive, ArrowDown, ArrowUp, Check } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { PanelServer } from '../../../components/panel/PanelContext';
import { TextInput, cx, fmtBytes, fmtMB } from '../../../components/ui/kit';
import { duration } from '../../../components/ui/panelKit';

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const MAX_LINES = 1200;

interface Stats { running: boolean; cpuPercent: number; memBytes: number; memLimit: number; diskBytes: number; diskLimit: number; netRx: number; netTx: number }
type Socket = 'connecting' | 'connected' | 'offline';

const rate = (bps: number) => (bps >= 1048576 ? `${(bps / 1048576).toFixed(1)} MB/s` : `${(bps / 1024).toFixed(1)} KB/s`);
const lineTone = (l: string) => /\b(ERROR|SEVERE|FATAL|Exception|Traceback)\b/.test(l) ? 'text-red-400' : /\bWARN(ING)?\b/.test(l) ? 'text-amber-300' : l.startsWith('[panel]') ? 'text-sky-300' : 'text-zinc-300';

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; pct?: number; mono?: boolean; className?: string }> = ({ icon, label, value, sub, pct, mono = true, className }) => (
  <div className={cx('rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3.5', className)}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</p>
        <p className={cx('text-sm font-bold text-white mt-1.5 truncate', mono && 'font-mono')}>{value}</p>
      </div>
      <span className="h-8 w-8 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-500 flex items-center justify-center shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
    </div>
    {pct !== undefined && <div className="h-1 rounded-full bg-zinc-800 mt-3 overflow-hidden"><div className={cx('h-full transition-all', pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>}
    {sub && <p className="text-[10px] font-mono text-zinc-600 mt-1.5">{sub}</p>}
  </div>
);

export const ConsoleTab: React.FC<{ server: PanelServer; running: boolean; canSend: boolean }> = ({ server, running, canSend }) => {
  const serverId = server.id;
  const [lines, setLines] = useState<string[]>([]);
  const [cmd, setCmd] = useState('');
  const [filter, setFilter] = useState('');
  const [sending, setSending] = useState(false);
  const [socket, setSocket] = useState<Socket>('connecting');
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [net, setNet] = useState({ rx: 0, tx: 0 });
  const [now, setNow] = useState(Date.now());
  const last = useRef<{ at: number; rx: number; tx: number } | null>(null);
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
        setSocket('connecting');
        try {
          const res = await fetch(`/api/v1/hosting/servers/${serverId}/console`, { headers: { Authorization: `Bearer ${localStorage.getItem('aether_token') || ''}` }, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error('console unavailable');
          if (alive) setSocket('connected');
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
        if (alive) { setSocket('offline'); await new Promise(r => setTimeout(r, 3000)); }
      }
    };
    setLines([]); run();
    return () => { alive = false; ctrl.abort(); };
  }, [serverId, running, nonce]);

  const shown = useMemo(() => { const f = filter.trim().toLowerCase(); return f ? lines.filter(l => l.toLowerCase().includes(f)) : lines; }, [lines, filter]);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [shown]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await apiRequest<Stats>(`/hosting/servers/${serverId}/stats`);
      if (!alive || !r.success) return;
      const s = r.data || null; setStats(s);
      if (s) {
        const t = Date.now(); const p = last.current;
        if (p && t > p.at) setNet({ rx: Math.max(0, (s.netRx - p.rx) / ((t - p.at) / 1000)), tx: Math.max(0, (s.netTx - p.tx) / ((t - p.at) / 1000)) });
        last.current = { at: t, rx: s.netRx, tx: s.netTx };
      }
    };
    tick(); const t = window.setInterval(tick, 5000); return () => { alive = false; window.clearInterval(t); };
  }, [serverId]);

  useEffect(() => { if (!running) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [running]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); const c = cmd.trim(); if (!c) return;
    setSending(true); history.current.unshift(c); hIdx.current = -1; setCmd('');
    const r = await apiRequest(`/hosting/servers/${serverId}/command`, { method: 'POST', body: JSON.stringify({ command: c }) });
    setSending(false);
    if (!r.success) setLines(l => [...l, `[panel] ${r.error?.message || 'Command failed'}`]);
  };
  const copyLogs = () => navigator.clipboard?.writeText(shown.join('\n')).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); });
  const saveLogs = () => { const url = URL.createObjectURL(new Blob([shown.join('\n')], { type: 'text/plain' })); const a = document.createElement('a'); a.href = url; a.download = `${server.name.replace(/[^\w.-]+/g, '_')}-console.log`; a.click(); URL.revokeObjectURL(url); };

  const cpuLimit = server.limits.cpuPercent;
  const memPct = stats && stats.memLimit ? (stats.memBytes / stats.memLimit) * 100 : 0;
  const diskPct = stats && stats.diskLimit ? (stats.diskBytes / stats.diskLimit) * 100 : 0;
  const cpuPct = stats ? (stats.cpuPercent / cpuLimit) * 100 : 0;
  const primary = server.ports[0];
  const uptime = running && server.startedAt ? duration(Math.max(0, now - new Date(server.startedAt).getTime())) : 'Offline';
  const sockTone = socket === 'connected' ? 'text-emerald-400' : socket === 'connecting' ? 'text-amber-300' : 'text-red-400';
  const iconBtn = 'h-9 w-9 inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors';

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-800 bg-zinc-950 text-[11px] font-mono text-zinc-400">Socket: <span className={cx('font-bold uppercase', sockTone)}>{socket}</span></span>
          <span className="inline-flex items-center h-9 px-3 rounded-lg border border-zinc-800 bg-zinc-950 text-[11px] font-mono text-zinc-400">Buffer: <b className="ml-1 text-white">{lines.length}</b></span>
          <div className="relative flex-1 min-w-[150px]">
            <Search className="h-3.5 w-3.5 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <TextInput value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter logs…" className="!h-9 !py-0 !pl-9 !text-xs font-mono" aria-label="Filter logs" />
          </div>
          <button onClick={copyLogs} className={iconBtn} aria-label="Copy logs" title="Copy logs">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}</button>
          <button onClick={saveLogs} className={iconBtn} aria-label="Download logs" title="Download logs"><Download className="h-4 w-4" /></button>
          <button onClick={() => setLines([])} className={iconBtn} aria-label="Clear logs" title="Clear logs"><Trash2 className="h-4 w-4" /></button>
          <button onClick={() => setNonce(n => n + 1)} className={cx(iconBtn, 'text-amber-400')} aria-label="Reconnect console" title="Reconnect"><RefreshCw className="h-4 w-4" /></button>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-black overflow-hidden">
          <div ref={box} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} className="h-[52vh] min-h-[300px] overflow-y-auto p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all">
            {shown.length === 0 ? <span className="text-zinc-600">{filter ? 'No log lines match this filter.' : 'Waiting for output… start the server to see logs.'}</span> : shown.map((l, i) => <div key={i} className={lineTone(l)}>{l || '\u00a0'}</div>)}
          </div>
          <form onSubmit={send} className="flex items-center gap-2 border-t border-zinc-800 p-2 bg-zinc-950">
            <span className="text-amber-500 font-mono text-xs pl-2">$</span>
            <TextInput value={cmd} onChange={e => setCmd(e.target.value)} disabled={!canSend || !running} placeholder={running ? 'Type a command and press Enter' : 'Server is offline'} maxLength={2048} autoComplete="off" spellCheck={false} aria-label="Console command"
              onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); hIdx.current = Math.min(history.current.length - 1, hIdx.current + 1); setCmd(history.current[hIdx.current] || ''); } if (e.key === 'ArrowDown') { e.preventDefault(); hIdx.current = Math.max(-1, hIdx.current - 1); setCmd(history.current[hIdx.current] || ''); } }}
              className="!bg-transparent !border-0 !px-1 font-mono text-xs" />
            <button type="submit" disabled={!canSend || !running || !cmd.trim() || sending} className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-amber-500 text-zinc-950 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-400" aria-label="Send command"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-1 gap-3">
        <StatCard icon={<Wifi />} label="Address" value={primary ? `${server.address}:${primary.host}` : '—'} className="col-span-2 xl:col-span-1" />
        <StatCard icon={<Clock />} label="Uptime" value={uptime} />
        <StatCard icon={<Cpu />} label="CPU load" value={<>{stats ? `${stats.cpuPercent.toFixed(2)}%` : '—'}<span className="text-zinc-600 font-normal"> / {cpuLimit}%</span></>} pct={cpuPct} />
        <StatCard icon={<MemoryStick />} label="Memory" value={<>{stats ? fmtBytes(stats.memBytes) : '—'}<span className="text-zinc-600 font-normal"> / {fmtMB(server.limits.ramMB)}</span></>} pct={memPct} />
        <StatCard icon={<HardDrive />} label="Disk" value={<>{stats ? fmtBytes(stats.diskBytes) : '—'}<span className="text-zinc-600 font-normal"> / {fmtMB(server.limits.diskMB)}</span></>} pct={diskPct} />
        <StatCard icon={<ArrowDown />} label="Network (inbound)" value={rate(net.rx)} />
        <StatCard icon={<ArrowUp />} label="Network (outbound)" value={rate(net.tx)} />
      </div>
    </div>
  );
};
