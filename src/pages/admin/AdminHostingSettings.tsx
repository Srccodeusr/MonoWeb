import React, { useEffect, useState } from 'react';
import { Settings2, Save, Plus, Trash2, Timer, Megaphone, Coins, PanelTop, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Btn, Card, Field, NumInput, PageHeader, Spinner, TextInput, Toggle, cx, useToast } from '../../components/ui/kit';

type Tab = 'expiry' | 'renew' | 'economy' | 'panel';

export const AdminHostingSettings: React.FC = () => {
  const [toast, say] = useToast();
  const [s, setS] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('expiry');
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiRequest('/admin/hosting/settings').then(r => r.success && setS(r.data)); }, []);
  if (!s) return <Spinner />;
  const up = (path: string[], v: any) => setS((cur: any) => { const n = { ...cur }; let o = n; path.slice(0, -1).forEach(k => { o[k] = { ...o[k] }; o = o[k]; }); o[path[path.length - 1]] = v; return n; });
  const save = async () => { setBusy(true); const { plans: _p, ...body } = s; const r = await apiRequest('/admin/hosting/settings', { method: 'PUT', body: JSON.stringify(body) }); setBusy(false); if (r.success) { say('success', 'Settings saved'); setS({ ...r.data, plans: s.plans }); } else say('error', r.error?.message || 'Failed'); };
  const blogs = s.renew.blog.items as any[];

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Settings2 className="h-6 w-6 text-amber-400" />} title="Expiry, Renewals & Panel" subtitle="Control how long servers live, how users renew them, how coins are earned, and what the panel shows." actions={<Btn variant="primary" busy={busy} onClick={save}><Save className="h-4 w-4" />Save changes</Btn>} />
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto no-scrollbar">{([['expiry', 'Expiry', Timer], ['renew', 'Renewals', Megaphone], ['economy', 'Economy', Coins], ['panel', 'Panel & ads', PanelTop]] as const).map(([k, l, I]) => <button key={k} onClick={() => setTab(k)} className={cx('flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap', tab === k ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500')}><I className="h-3.5 w-3.5" />{l}</button>)}</div>

      {tab === 'expiry' && <Card className="space-y-5">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex gap-3"><ShieldAlert className="h-5 w-5 text-red-400 shrink-0" /><div className="text-xs text-zinc-300 space-y-1"><p className="font-bold text-white">How expiry works</p><p>A server lives for the number of days set by its plan (<b>Plans → Renewal → server lifetime</b>) or the default below. When that time is up it is <b>stopped and marked expired</b>. If the owner has not renewed <b>24 hours</b> later, it is <b>permanently deleted</b> from the node. That 24-hour window is fixed in the code and can not be changed from here.</p></div></div>
        <div className="grid sm:grid-cols-2 gap-4"><Field label="Default server lifetime" hint="Used when a plan does not set its own lifetime."><NumInput value={s.expiry.defaultValidityDays} min={1} onChange={v => up(['expiry', 'defaultValidityDays'], v)} suffix="days" /></Field><Field label="Send expiry reminder" hint="Hours before expiry (inbox message)."><NumInput value={s.expiry.reminderHours} min={1} onChange={v => up(['expiry', 'reminderHours'], v)} suffix="hours" /></Field></div>
        <Toggle checked={s.enabled} onChange={v => up(['enabled'], v)} label="Allow new server creation" hint="Turn off to freeze deployments platform-wide (existing servers keep running)." />
      </Card>}

      {tab === 'renew' && <div className="space-y-4">
        <Card className="space-y-4"><Toggle checked={s.renew.ads.enabled} onChange={v => up(['renew', 'ads', 'enabled'], v)} label="Renew by watching an ad" hint="Server-verified countdown, then the server is extended." />
          {s.renew.ads.enabled && <div className="grid sm:grid-cols-3 gap-3"><Field label="Watch time"><NumInput value={s.renew.ads.watchSeconds} onChange={v => up(['renew', 'ads', 'watchSeconds'], v)} suffix="sec" /></Field><Field label="Extends by"><NumInput value={s.renew.ads.extendHours} onChange={v => up(['renew', 'ads', 'extendHours'], v)} suffix="hours" /></Field><Field label="Max per user per day"><NumInput value={s.renew.ads.maxPerDay} onChange={v => up(['renew', 'ads', 'maxPerDay'], v)} /></Field></div>}
          <p className="text-[11px] text-zinc-600">Ads shown here come from the Ad Center with placement <b>reward</b>. With none configured, a plain “sponsored” screen is shown.</p></Card>
        <Card className="space-y-4"><Toggle checked={s.renew.blog.enabled} onChange={v => up(['renew', 'blog', 'enabled'], v)} label="Renew by reading a blog / article" hint="Opens your link in a new tab; user must stay for the set time." />
          <Field label="Max articles per user per day"><NumInput value={s.renew.blog.maxPerDay} onChange={v => up(['renew', 'blog', 'maxPerDay'], v)} /></Field>
          <div className="space-y-2">{blogs.map((b, i) => <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.2fr_2fr_80px_80px_80px_auto] gap-2 items-end rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <Field label="Title"><TextInput value={b.title} onChange={ev => up(['renew', 'blog', 'items'], blogs.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} /></Field>
            <Field label="URL"><TextInput value={b.url} placeholder="https://" onChange={ev => up(['renew', 'blog', 'items'], blogs.map((x, j) => (j === i ? { ...x, url: ev.target.value } : x)))} className="font-mono text-xs" /></Field>
            <Field label="Seconds"><NumInput value={b.seconds} onChange={v => up(['renew', 'blog', 'items'], blogs.map((x, j) => (j === i ? { ...x, seconds: v } : x)))} /></Field>
            <Field label="Renews (h)"><NumInput value={b.renewHours} onChange={v => up(['renew', 'blog', 'items'], blogs.map((x, j) => (j === i ? { ...x, renewHours: v } : x)))} /></Field>
            <Field label="Coins"><NumInput value={b.rewardCoins} onChange={v => up(['renew', 'blog', 'items'], blogs.map((x, j) => (j === i ? { ...x, rewardCoins: v } : x)))} /></Field>
            <Btn size="sm" variant="danger" onClick={() => up(['renew', 'blog', 'items'], blogs.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Btn></div>)}
            <Btn size="sm" onClick={() => up(['renew', 'blog', 'items'], [...blogs, { id: `blog_${Date.now().toString(36)}`, title: '', url: '', seconds: 20, rewardCoins: 5, renewHours: 24, isActive: true }])}><Plus className="h-3.5 w-3.5" />Add article</Btn></div></Card>
        <Card className="space-y-4"><Toggle checked={s.renew.coins.enabled} onChange={v => up(['renew', 'coins', 'enabled'], v)} label="Renew with coins" hint="Also unlocks the 'Renew' items in the Store. Plans must list 'coins' as a renewal method." />
          {s.renew.coins.enabled && <div className="grid sm:grid-cols-2 gap-3"><Field label="Price"><NumInput value={s.renew.coins.priceCoins} onChange={v => up(['renew', 'coins', 'priceCoins'], v)} suffix="coins" /></Field><Field label="Extends by"><NumInput value={s.renew.coins.extendDays} onChange={v => up(['renew', 'coins', 'extendDays'], v)} suffix="days" /></Field></div>}</Card>
      </div>}

      {tab === 'economy' && <Card className="space-y-5">
        <Toggle checked={s.economy.enabled} onChange={v => up(['economy', 'enabled'], v)} label="Enable the economy" hint="Coins, Earn page and Store." />
        <div className="grid sm:grid-cols-2 gap-4"><Field label="Currency name"><TextInput value={s.economy.coinName} maxLength={20} onChange={ev => up(['economy', 'coinName'], ev.target.value)} /></Field><Field label="Daily login bonus"><NumInput value={s.economy.dailyBonus} onChange={v => up(['economy', 'dailyBonus'], v)} suffix="coins" /></Field></div>
        <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Sponsored message reward</p><div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><Field label="Coins"><NumInput value={s.economy.adReward.coins} onChange={v => up(['economy', 'adReward', 'coins'], v)} /></Field><Field label="Watch time"><NumInput value={s.economy.adReward.seconds} onChange={v => up(['economy', 'adReward', 'seconds'], v)} suffix="sec" /></Field><Field label="Max / day"><NumInput value={s.economy.adReward.maxPerDay} onChange={v => up(['economy', 'adReward', 'maxPerDay'], v)} /></Field><Field label="Cooldown"><NumInput value={s.economy.adReward.cooldownSec} onChange={v => up(['economy', 'adReward', 'cooldownSec'], v)} suffix="sec" /></Field></div></div>
        <Field label="Max articles per day for coins" className="max-w-xs"><NumInput value={s.economy.blogMaxPerDay} onChange={v => up(['economy', 'blogMaxPerDay'], v)} /></Field>
      </Card>}

      {tab === 'panel' && <div className="space-y-4">
        <Card className="space-y-4"><Toggle checked={s.topBar.enabled} onChange={v => up(['topBar', 'enabled'], v)} label="Announcement bar" hint="The green strip at the top of every panel page." />
          <Field label="Message"><TextInput value={s.topBar.message} maxLength={300} onChange={ev => up(['topBar', 'message'], ev.target.value)} /></Field>
          {s.topBar.links.map((l: any, i: number) => <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2"><TextInput placeholder="Label" value={l.label} onChange={ev => up(['topBar', 'links'], s.topBar.links.map((x: any, j: number) => (j === i ? { ...x, label: ev.target.value } : x)))} /><TextInput placeholder="https://…" className="font-mono text-xs" value={l.url} onChange={ev => up(['topBar', 'links'], s.topBar.links.map((x: any, j: number) => (j === i ? { ...x, url: ev.target.value } : x)))} /><Btn size="sm" variant="danger" onClick={() => up(['topBar', 'links'], s.topBar.links.filter((_: any, j: number) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Btn></div>)}
          <Btn size="sm" disabled={s.topBar.links.length >= 4} onClick={() => up(['topBar', 'links'], [...s.topBar.links, { label: '', url: '' }])}><Plus className="h-3.5 w-3.5" />Add link</Btn></Card>
        <Card className="space-y-4"><h3 className="text-sm font-bold text-white">Overview promo cards</h3>
          <Toggle checked={s.promos.upgradeCard} onChange={v => up(['promos', 'upgradeCard'], v)} label="Upgrade card (free users)" />
          <Toggle checked={s.promos.hostingCard} onChange={v => up(['promos', 'hostingCard'], v)} label="Hosting promo card" />
          {s.promos.hostingCard && <div className="grid sm:grid-cols-2 gap-3"><Field label="Title"><TextInput value={s.promos.hostingCardTitle} onChange={ev => up(['promos', 'hostingCardTitle'], ev.target.value)} /></Field><Field label="Button text"><TextInput value={s.promos.hostingCardCta} onChange={ev => up(['promos', 'hostingCardCta'], ev.target.value)} /></Field><Field label="Text" className="sm:col-span-2"><TextInput value={s.promos.hostingCardText} onChange={ev => up(['promos', 'hostingCardText'], ev.target.value)} /></Field><Field label="Button link"><TextInput value={s.promos.hostingCardUrl} onChange={ev => up(['promos', 'hostingCardUrl'], ev.target.value)} className="font-mono text-xs" /></Field></div>}</Card>
        <Card className="space-y-3"><h3 className="text-sm font-bold text-white">Advertising (global)</h3>
          <Toggle checked={s.ads.globalEnabled} onChange={v => up(['ads', 'globalEnabled'], v)} label="Show ads platform-wide" hint="Master switch. Individual campaigns are managed in the Ad Center." />
          <Toggle checked={s.ads.hideForPremium} onChange={v => up(['ads', 'hideForPremium'], v)} label="Hide ads for plans with “No ads”" />
          <Field label="Max stored ad events" hint="Older impression/click events are discarded beyond this (keeps the database light)." className="max-w-xs"><NumInput value={s.ads.maxEventsStored} onChange={v => up(['ads', 'maxEventsStored'], v)} /></Field></Card>
      </div>}
    </div>
  );
};
