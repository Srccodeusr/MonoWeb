import React, { useEffect, useState } from 'react';
import {
  ShieldAlert, Users, Package, ShoppingBag, Tag, Megaphone, LifeBuoy, FileText, Sliders, ArrowLeft, LogOut,
  Sparkles, MessageSquare, Scale, Key, Link2, Mail, Network, Server, Boxes, Crown, CreditCard, Timer, Layers, UserCog, Palette, ScrollText, Menu, X, Receipt, Cloud, HardDrive, Disc3, SlidersHorizontal, History, ShoppingCart
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

interface AdminSidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

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

export const AdminSidebar: React.FC<AdminSidebarProps> = ({ currentPage, onNavigate }) => {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [currentPage]);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);

  const nav = (
    <>
      <div className="p-4 border-b border-amber-500/20 bg-amber-500/5">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider"><ShieldAlert className="h-4 w-4" /><span>Admin Control Plane</span></div>
        <p className="text-[11px] text-zinc-400 mt-1">Hosting platform + panel console</p>
      </div>
      <div className="p-3 space-y-4 overflow-y-auto flex-1">
        {GROUPS.map(g => (
          <div key={g.title}>
            <p className="px-3.5 mb-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map(it => {
                const I = it.icon; const on = currentPage === it.page;
                return (
                  <button key={it.page} onClick={() => onNavigate(it.page)} aria-current={on ? 'page' : undefined}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${on ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>
                    <I className={`h-4 w-4 shrink-0 ${on ? '' : it.tone || ''}`} /><span className="truncate">{it.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-zinc-800/80 space-y-2">
        <button onClick={() => onNavigate('servers')} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 transition-colors">
          <ArrowLeft className="h-4 w-4 text-amber-400" /><span>Exit to My Servers</span>
        </button>
        <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-900/60 border border-zinc-800">
          <div className="text-xs text-amber-400 font-semibold truncate">{user?.displayName || user?.email}</div>
          <button onClick={() => logout()} className="p-1 rounded text-zinc-400 hover:text-rose-400" aria-label="Log out"><LogOut className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-amber-500/20 bg-zinc-950/80 backdrop-blur-md flex-col sticky top-16 h-[calc(100vh-4rem)]">{nav}</aside>

      {/* Mobile: floating menu button + drawer (the old sidebar was desktop-only, leaving admin unusable on phones) */}
      <button onClick={() => setOpen(true)} className="lg:hidden fixed bottom-5 left-5 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-full bg-amber-500 text-zinc-950 text-xs font-bold shadow-xl shadow-black/50" aria-label="Open admin menu"><Menu className="h-4 w-4" />Admin menu</button>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-[82%] max-w-xs bg-zinc-950 border-r border-amber-500/20 flex flex-col">
            <button onClick={() => setOpen(false)} className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800" aria-label="Close"><X className="h-4 w-4" /></button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
};
