import React from 'react';
import { Server, Star, Zap, Plus, MapPin, Cpu, MemoryStick, HardDrive, Clock, Users, ChevronRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { usePanel, PanelServer } from '../../components/panel/PanelContext';
import { AdBanner } from '../../components/AdBanner';
import { Badge, Btn, Card, Empty, Spinner, fmtMB, statusTone, timeLeft } from '../../components/ui/kit';
import { useAuth } from '../../lib/AuthContext';
import { useBranding } from '../../lib/BrandingContext';

const STATUS_LABEL: Record<string, string> = { transferring: 'Moving', running: 'Running', offline: 'Offline', installing: 'Installing', starting: 'Starting', suspended: 'Suspended', expired: 'Expired', install_failed: 'Install failed' };

const ServerCard: React.FC<{ s: PanelServer; onOpen: () => void }> = ({ s, onOpen }) => {
  const tl = timeLeft(s.expiresAt);
  const expired = s.status === 'expired';
  return (
    <button onClick={onOpen} className={`group text-left w-full rounded-2xl border bg-zinc-900/60 hover:bg-zinc-900 transition-colors p-4 ${expired ? 'border-red-500/30' : 'border-zinc-800 hover:border-zinc-700'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate flex items-center gap-1.5">{s.name}{s.role === 'subuser' && <Badge tone="blue">Shared</Badge>}</p>
          <p className="text-[11px] text-zinc-500 truncate mt-0.5">{s.description || s.image?.software || 'No description'}</p>
        </div>
        <Badge tone={statusTone(s.status)}>{s.status === 'running' && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}{STATUS_LABEL[s.status] || s.status}</Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 text-[11px]">
        <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500 flex items-center gap-1"><Cpu className="h-3 w-3" />CPU</p><p className="font-mono text-zinc-200 mt-0.5">{s.limits.cpuPercent}%</p></div>
        <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500 flex items-center gap-1"><MemoryStick className="h-3 w-3" />RAM</p><p className="font-mono text-zinc-200 mt-0.5">{fmtMB(s.limits.ramMB)}</p></div>
        <div className="rounded-lg bg-zinc-950 px-2.5 py-2"><p className="text-zinc-500 flex items-center gap-1"><HardDrive className="h-3 w-3" />Disk</p><p className="font-mono text-zinc-200 mt-0.5">{fmtMB(s.limits.diskMB)}</p></div>
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-zinc-500 min-w-0"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{s.location} · {s.image?.name}</span></span>
        <span className={`flex items-center gap-1 font-mono shrink-0 ${expired ? 'text-red-400' : tl.urgent ? 'text-amber-400' : 'text-zinc-500'}`}><Clock className="h-3 w-3" />{expired ? 'Renew now' : tl.text}</span>
      </div>
    </button>
  );
};

export const ServersOverview: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const { data, loading, error, refresh } = usePanel();
  const { user } = useAuth();
  const { brandName } = useBranding();
  if (loading && !data) return <Spinner label="Loading your servers…" />;
  if (!data) return <Card><Empty icon={<AlertTriangle className="h-10 w-10" />} title="Could not load the panel" text={error || 'Please try again.'} action={<Btn variant="primary" onClick={refresh}>Retry</Btn>} /></Card>;

  const { plan, promos, servers } = data;
  const atLimit = plan.used >= plan.serverLimit;
  const expired = servers.filter(s => s.status === 'expired');
  const brand = brandName || 'MonoNode';

  return (
    <div className="space-y-4">
      {/* Welcome */}
      <Card className="!p-5 sm:!p-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2 flex-wrap">
          Welcome back, {data.user.displayName || user?.username}!
          {!plan.isFree && <Star className="h-5 w-5 text-amber-400 fill-amber-400" aria-label={`${plan.name} member`} />}
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1.5">Select a server below to access the console, file manager, and configurations.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-[11px]"><Server className="h-3 w-3 text-zinc-500" /><b className="text-zinc-100">{data.platform.servers.toLocaleString()}</b><span className="text-zinc-500">Servers</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-[11px]"><Users className="h-3 w-3 text-zinc-500" /><b className="text-zinc-100">{data.platform.users.toLocaleString()}</b><span className="text-zinc-500">Users</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-[11px]"><b className="text-amber-300">{plan.name}</b><span className="text-zinc-500">plan · {plan.used}/{plan.serverLimit} servers</span></span>
        </div>
      </Card>

      {/* Expired warning */}
      {expired.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
          <span><b>{expired.length} server{expired.length > 1 ? 's have' : ' has'} expired.</b> Renew within 24 hours of expiry or {expired.length > 1 ? 'they' : 'it'} will be permanently deleted.</span>
        </div>
      )}

      {/* Upgrade promo (free plan only) */}
      {promos.upgradeCard && plan.isFree && (
        <Card accent className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-center shrink-0"><Star className="h-5 w-5 text-amber-400" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">Upgrade to {brand} Premium</p>
            <p className="text-xs text-zinc-400 mt-0.5">Compare Free vs Premium perks, then choose card checkout from the upgrade screen.</p>
          </div>
          <Btn variant="primary" onClick={() => onNavigate('upgrade')} className="shrink-0">View Premium Perks</Btn>
        </Card>
      )}

      {/* Hosting promo */}
      {promos.hostingCard && (
        <Card className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl border border-zinc-800 bg-zinc-950 flex items-center justify-center shrink-0"><Zap className="h-5 w-5 text-amber-400" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white flex items-center gap-2">{promos.hostingCardTitle}<span className="text-[9px] font-mono px-1.5 py-px rounded bg-zinc-800 text-zinc-500">AD</span></p>
            <p className="text-xs text-zinc-400 mt-0.5">{promos.hostingCardText}</p>
          </div>
          <Btn variant="dark" onClick={() => (promos.hostingCardUrl.startsWith('/') ? (window.location.href = promos.hostingCardUrl) : window.open(promos.hostingCardUrl, '_blank', 'noopener,noreferrer'))} className="shrink-0">{promos.hostingCardCta}</Btn>
        </Card>
      )}

      {/* Servers */}
      <div className="flex items-center justify-between pt-1">
        <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-500">Your servers</h2>
        <div className="flex gap-2">
          <Btn size="sm" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Btn>
          <Btn size="sm" variant="primary" onClick={() => onNavigate('server-create')}><Plus className="h-3.5 w-3.5" />New server</Btn>
        </div>
      </div>

      {servers.length === 0 ? (
        <Card><Empty icon={<Server className="h-14 w-14" />} title="It's quiet here…" text="You do not have any servers yet. Once you create or are assigned a server, it will appear here." action={<Btn variant="primary" onClick={() => onNavigate('server-create')}><Plus className="h-4 w-4" />Create your first server</Btn>} /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {servers.map(s => <ServerCard key={s.id} s={s} onOpen={() => onNavigate('server', { id: s.id })} />)}
          {atLimit && <Card className="flex flex-col justify-center items-center text-center gap-2 border-dashed">
            <p className="text-xs text-zinc-400">Server limit reached ({plan.used}/{plan.serverLimit}).</p>
            <div className="flex gap-2"><Btn size="sm" variant="primary" onClick={() => onNavigate('upgrade')}>Upgrade plan<ChevronRight className="h-3 w-3" /></Btn><Btn size="sm" onClick={() => onNavigate('store')}>Buy a slot</Btn></div>
          </Card>}
        </div>
      )}

      {!plan.noAds && <AdBanner placement="overview" className="pt-2" />}
    </div>
  );
};
