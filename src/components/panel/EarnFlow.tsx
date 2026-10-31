import React, { useEffect, useRef, useState } from 'react';
import { Play, BookOpen, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Btn, Card, cx } from '../ui/kit';

interface Options {
  coinName: string;
  ad: { enabled: boolean; seconds: number; coins: number; renewSeconds: number; renewHours: number; items: { id: string; title: string }[] };
  blogs: { id: string; title: string; url: string; seconds: number; rewardCoins: number; renewHours: number }[];
  renewAllowed: { ads: boolean; blog: boolean };
}

interface Props {
  purpose: 'coins' | 'renew';
  serverId?: string;
  onDone: (result: { coins?: number; reward?: number; expiresAt?: string; hours?: number }) => void;
  onError: (message: string) => void;
}

interface Session { token: string; minSeconds: number; kind: 'ad' | 'blog'; title?: string; description?: string; imageUrl?: string; destinationUrl?: string; url?: string; startedAt: number }

/**
 * Server-verified rewards: the server records when a session starts and refuses to pay out before the
 * required time has really elapsed, so skipping the countdown client-side gains nothing.
 */
export const EarnFlow: React.FC<Props> = ({ purpose, serverId, onDone, onError }) => {
  const [opts, setOpts] = useState<Options | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();

  useEffect(() => { apiRequest<Options>('/economy/earn/options').then(r => r.success && r.data ? setOpts(r.data) : onError(r.error?.message || 'Could not load options.')); return () => window.clearInterval(timer.current); }, []);

  const start = async (kind: 'ad' | 'blog', refId?: string) => {
    setBusy(true);
    const r = await apiRequest('/economy/earn/start', { method: 'POST', body: JSON.stringify({ kind, purpose, serverId, refId }) });
    setBusy(false);
    if (!r.success || !r.data) return onError(r.error?.message || 'Could not start.');
    const s: Session = { ...r.data, kind, startedAt: Date.now() };
    setSession(s); setLeft(s.minSeconds);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const remain = Math.max(0, s.minSeconds - Math.floor((Date.now() - s.startedAt) / 1000));
      setLeft(remain); if (remain === 0) window.clearInterval(timer.current);
    }, 500);
    if (kind === 'blog' && /^https?:\/\//.test(r.data.url || '')) window.open(r.data.url, '_blank', 'noopener,noreferrer');
  };

  const claim = async () => {
    if (!session) return;
    setBusy(true);
    const r = await apiRequest('/economy/earn/claim', { method: 'POST', body: JSON.stringify({ token: session.token }) });
    setBusy(false);
    if (!r.success) return onError(r.error?.message || 'Could not claim the reward.');
    setSession(null); onDone(r.data || {});
  };

  if (!opts) return <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-500" /></div>;

  if (session) {
    const pct = Math.min(100, ((session.minSeconds - left) / session.minSeconds) * 100);
    const ext = /^https?:\/\//.test(session.destinationUrl || '');
    return (
      <div className="space-y-4">
        <Card className="text-center space-y-3">
          {session.kind === 'ad' ? (
            <>
              <span className="text-[9px] font-mono px-1.5 py-px rounded bg-zinc-800 text-zinc-500">SPONSORED</span>
              {session.imageUrl && <img src={session.imageUrl} alt="" className="mx-auto max-h-40 rounded-xl border border-zinc-800" />}
              <p className="text-sm font-bold text-white">{session.title || 'Thanks for supporting free hosting'}</p>
              {session.description && <p className="text-xs text-zinc-400">{session.description}</p>}
              {session.destinationUrl && <a href={session.destinationUrl} target={ext ? '_blank' : undefined} rel="noopener noreferrer sponsored" className="inline-flex items-center gap-1 text-xs text-amber-300 underline">Visit sponsor<ExternalLink className="h-3 w-3" /></a>}
            </>
          ) : (
            <>
              <BookOpen className="h-8 w-8 mx-auto text-amber-400" />
              <p className="text-sm font-bold text-white">{session.title}</p>
              <p className="text-xs text-zinc-400">The article opened in a new tab. Keep reading, then come back and claim.</p>
              <a href={session.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-300 underline">Re-open article<ExternalLink className="h-3 w-3" /></a>
            </>
          )}
        </Card>
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} /></div>
        <Btn variant="primary" className="w-full !py-3" disabled={left > 0} busy={busy} onClick={claim}>{left > 0 ? `Claim in ${left}s…` : <><CheckCircle2 className="h-4 w-4" />Claim reward</>}</Btn>
      </div>
    );
  }

  const adOk = purpose === 'coins' ? opts.ad.enabled : opts.renewAllowed.ads;
  const blogOk = purpose === 'coins' ? opts.blogs.length > 0 : opts.renewAllowed.blog && opts.blogs.length > 0;
  const adLabel = purpose === 'coins' ? `+${opts.ad.coins} ${opts.coinName} · ${opts.ad.seconds}s` : `+${opts.ad.renewHours}h · ${opts.ad.renewSeconds}s`;
  return (
    <div className="space-y-2.5">
      {adOk && (
        <button onClick={() => start('ad')} disabled={busy} className="w-full flex items-center gap-3 rounded-xl border border-zinc-800 hover:border-amber-500/40 bg-zinc-950 p-3.5 text-left transition-colors disabled:opacity-50">
          <span className="h-9 w-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><Play className="h-4 w-4 text-amber-400" /></span>
          <span className="flex-1"><span className="block text-xs font-bold text-white">Watch a sponsored message</span><span className="block text-[11px] text-zinc-500">{adLabel}</span></span>
        </button>
      )}
      {blogOk && opts.blogs.map(b => (
        <button key={b.id} onClick={() => start('blog', b.id)} disabled={busy} className="w-full flex items-center gap-3 rounded-xl border border-zinc-800 hover:border-amber-500/40 bg-zinc-950 p-3.5 text-left transition-colors disabled:opacity-50">
          <span className="h-9 w-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center"><BookOpen className="h-4 w-4 text-sky-400" /></span>
          <span className="flex-1 min-w-0"><span className="block text-xs font-bold text-white truncate">{b.title}</span><span className="block text-[11px] text-zinc-500">{purpose === 'coins' ? `+${b.rewardCoins} ${opts.coinName}` : `+${b.renewHours}h`} · read for {b.seconds}s</span></span>
        </button>
      ))}
      {!adOk && !blogOk && <p className="text-xs text-zinc-500 text-center py-6">No {purpose === 'renew' ? 'renewal' : 'reward'} activities are available right now.</p>}
      <p className={cx('text-[10px] text-zinc-600 text-center pt-1')}>Daily limits apply. Rewards are verified on the server.</p>
    </div>
  );
};
