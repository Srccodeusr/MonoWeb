import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert, Users, Package, ShoppingBag, Tag, Megaphone, LifeBuoy, FileText, Sliders, ArrowLeft, LogOut, Search, ChevronDown,
  Sparkles, MessageSquare, Bot, Scale, Key, Link2, Mail, Network, Server, Boxes, Crown, CreditCard, Timer, Layers, UserCog, Palette, ScrollText, Menu, X, Receipt, Cloud, HardDrive, Disc3, SlidersHorizontal, History, ShoppingCart
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useBranding } from '../lib/BrandingContext';

/**
 * The admin area as one control panel: a single top bar + a single sidebar (desktop) or drawer (mobile).
 * It replaces the old public Navbar + AdminSidebar combo on admin pages, which showed two different admin menus.
 */
interface Item { page: string; label: string; icon: React.ComponentType<{ className?: string }>; tone?: string }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [{ page: 'admin-dashboard', label: 'System Overview', icon: Sliders }, { page: 'admin-hosting', label: 'Hosting Overview', icon: Layers }] },
  { title: 'Hosting', items: [
    { page: 'admin-nodes', label: 'Nodes', icon: Network },
    { page: 'admin-servers', label: 'Server Management', icon: Server },
    { page: 'admin-accounts', label: 'Account Management', icon: UserCog },
    { page: 'admin-images', label: 'Software Images', icon: Boxes },
    { page: 'admin-addons', label: 'Addon Store', icon: Package },
  ] },
  { title: 'VPS Hosting', items: [
    { page: 'admin-vps', label: 'VPS Overview', icon: Cloud },
    { page: 'admin-vps-servers', label: 'VPS Servers', icon: HardDrive },
    { page: 'admin-vps-nodes', label: 'VPS Nodes', icon: Network },
    { page: 'admin-vps-plans', label: 'VPS Plans', icon: Layers },
    { page: 'admin-vps-orders', label: 'VPS Orders', icon: ShoppingCart },
    { page: 'admin-vps-images', label: 'OS Images', icon: Disc3 },
    { page: 'admin-vps-settings', label: 'VPS Settings', icon: SlidersHorizontal },
    { page: 'admin-vps-activity', label: 'VPS Activity', icon: History },
  ] },
  { title: 'Plans & Revenue', items: [
    { page: 'admin-hosting-plans', label: 'Plans & Limits', icon: Crown },
    { page: 'admin-hosting-settings', label: 'Expiry & Renewals', icon: Timer },
    { page: 'admin-store', label: 'Store & Economy', icon: ShoppingBag },
    { page: 'admin-stripe', label: 'Stripe Setup', icon: CreditCard },
    { page: 'admin-billing', label: 'Orders & Payments', icon: Receipt },
    { page: 'admin-coupons', label: 'Coupons', icon: Tag },
    { page: 'admin-products', label: 'Legacy Products', icon: Package },
  ] },
  { title: 'Growth', items: [
    { page: 'admin-ads', label: 'Ad Center', icon: Sparkles, tone: 'text-amber-400' },
    { page: 'admin-announcements', label: 'Announcements', icon: Megaphone },
  ] },
  { title: 'Community', items: [
    { page: 'admin-users', label: 'User Accounts', icon: Users },
    { page: 'admin-support', label: 'Support Desk', icon: LifeBuoy },
    { page: 'admin-mail', label: 'Mail', icon: Mail },
    { page: 'admin-discord', label: 'Discord Bot', icon: MessageSquare, tone: 'text-indigo-400' },
    { page: 'admin-manager-bot', label: 'Discord Manager Bot', icon: Bot, tone: 'text-indigo-400' },
  ] },
  { title: 'System', items: [
    { page: 'admin-panel-link', label: 'External Panel Link', icon: Link2 },
    { page: 'admin-appearance', label: 'Appearance', icon: Palette },
    { page: 'admin-legal', label: 'Legal Pages', icon: Scale },
    { page: 'admin-audit-logs', label: 'Audit Logs', icon: ScrollText },
    { page: 'admin-api-keys', label: 'API Keys', icon: Key },
    { page: 'admin-settings', label: 'Platform Settings', icon: FileText },
  ] },
];

const STORE_KEY = 'admin_nav_collapsed';
const loadCollapsed = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

export const AdminShell: React.FC<{ currentPage: string; onNavigate: (page: string) => void; onOpenSearch: () => void; children: React.ReactNode }> = ({ currentPage, onNavigate, onOpenSearch, children }) => {
  const { user, logout } = useAuth();
  const { brandName } = useBranding();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);

  useEffect(() => { setOpen(false); }, [currentPage]);
  // The admin pages scroll inside #admin-main, not the window, so App's scrollTo(0) never reset them: opening a page
  // from the middle of a long one left the new page scrolled down.
  useEffect(() => { document.getElementById('admin-main')?.scrollTo({ top: 0 }); }, [currentPage]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); };
  }, [open]);
  const toggle = (t: string) => setCollapsed(c => { const n = c.includes(t) ? c.filter(x => x !== t) : [...c, t]; try { localStorage.setItem(STORE_KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });

  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => GROUPS.map(g => ({ ...g, items: q ? g.items.filter(i => i.label.toLowerCase().includes(q)) : g.items })).filter(g => g.items.length), [q]);
  const current = GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.title }))).find(i => i.page === currentPage);

  const nav = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-zinc-800/80">
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter pages…" aria-label="Filter admin pages" className="w-full rounded-xl bg-zinc-900 border border-zinc-800 focus:border-amber-500/60 focus:outline-none pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600" />
        </div>
      </div>
      <nav className="p-3 space-y-3 overflow-y-auto flex-1 min-h-0" aria-label="Admin navigation">
        {groups.length === 0 && <p className="text-xs text-zinc-600 px-2 py-6 text-center">No pages match “{filter}”.</p>}
        {groups.map(g => {
          const shut = !q && collapsed.includes(g.title);
          return (
            <div key={g.title}>
              <button onClick={() => toggle(g.title)} aria-expanded={!shut} className="w-full flex items-center justify-between px-3 mb-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600 hover:text-zinc-400">
                {g.title}<ChevronDown className={`h-3 w-3 transition-transform ${shut ? '-rotate-90' : ''}`} />
              </button>
              {!shut && <div className="space-y-0.5">
                {g.items.map(it => {
                  const I = it.icon; const on = currentPage === it.page;
                  return (
                    <button key={it.page} onClick={() => onNavigate(it.page)} aria-current={on ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${on ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold' : 'border border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>
                      <I className={`h-4 w-4 shrink-0 ${on ? '' : it.tone || ''}`} /><span className="truncate">{it.label}</span>
                    </button>
                  );
                })}
              </div>}
            </div>
          );
        })}
      </nav>
      <div className="p-3 border-t border-zinc-800/80 space-y-2">
        <button onClick={() => onNavigate('servers')} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 transition-colors"><ArrowLeft className="h-4 w-4 text-amber-400" />Exit to My Servers</button>
        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-900/60 border border-zinc-800">
          <div className="min-w-0"><p className="text-xs text-amber-400 font-semibold truncate">{user?.displayName || user?.username || user?.email}</p><p className="text-[10px] text-zinc-500 font-mono truncate">{user?.role}</p></div>
          <button onClick={() => logout()} className="p-1.5 rounded text-zinc-400 hover:text-rose-400" aria-label="Log out"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-dvh min-h-0 bg-transparent">
      <header className="h-14 shrink-0 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md flex items-center gap-3 px-3 sm:px-4 z-30">
        <button onClick={() => setOpen(true)} className="lg:hidden h-10 w-10 flex items-center justify-center rounded-xl border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900" aria-label="Open admin menu" aria-expanded={open}><Menu className="h-5 w-5" /></button>
        <button onClick={() => onNavigate('admin-dashboard')} className="flex items-center gap-2.5 min-w-0 text-left">
          <span className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 flex items-center justify-center shrink-0"><ShieldAlert className="h-4 w-4" /></span>
          <span className="min-w-0 hidden sm:block"><span className="block text-sm font-bold text-white leading-tight truncate">{brandName || 'Platform'} Control Panel</span><span className="block text-[10px] text-zinc-500 font-mono leading-tight">Admin</span></span>
        </button>
        <div className="hidden md:flex items-center gap-1.5 text-xs text-zinc-500 ml-4 min-w-0" aria-label="Breadcrumb">
          <span>Admin</span>{current && <><span className="text-zinc-700">/</span><span>{current.group}</span><span className="text-zinc-700">/</span><span className="text-zinc-200 font-semibold truncate">{current.label}</span></>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onOpenSearch} className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl border border-zinc-800 bg-zinc-900 text-xs text-zinc-400 hover:text-white"><Search className="h-3.5 w-3.5" />Search<kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-zinc-950 rounded border border-zinc-800">⌘K</kbd></button>
          <button onClick={onOpenSearch} className="sm:hidden h-10 w-10 flex items-center justify-center rounded-xl border border-zinc-800 text-zinc-300" aria-label="Search"><Search className="h-4 w-4" /></button>
          <button onClick={() => onNavigate('servers')} className="hidden md:flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"><ArrowLeft className="h-3.5 w-3.5" />My servers</button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="hidden lg:flex w-64 shrink-0 border-r border-zinc-800/80 bg-zinc-950/80 min-h-0">{nav}</aside>
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:p-6 flex flex-col" id="admin-main">
          <div className="flex-1 flex flex-col">{children}</div>
          <footer className="pt-6 mt-8 border-t border-zinc-900/80 text-[11px] text-zinc-600 font-mono">© 2025–2026 {brandName || 'Platform'} · Admin Control Panel</footer>
        </main>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-[84%] max-w-xs bg-zinc-950 border-r border-zinc-800 flex flex-col pb-[env(safe-area-inset-bottom)]">
            <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-zinc-800/80">
              <span className="flex items-center gap-2 text-sm font-bold text-white"><ShieldAlert className="h-4 w-4 text-amber-400" />Admin menu</span>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800" aria-label="Close menu"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 min-h-0">{nav}</div>
          </aside>
        </div>
      )}
    </div>
  );
};
