import React, { useState, useEffect, useRef } from 'react';
import {
  Search, Shield, HelpCircle,
  Activity, User, Sparkles, BookOpen,
  CreditCard, Tag, ArrowRight, X, Package,
  Users, Megaphone, ShoppingBag, MessageSquare, Link2, Server
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: string, params?: any) => void;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  category: 'navigation' | 'admin';
  icon: any;
  action: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose, onNavigate }) => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      loadSearchData();
    } else {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const loadSearchData = () => {
    const list: SearchItem[] = [
      {
        id: 'nav_dashboard',
        title: 'My Servers',
        subtitle: 'View your credit balance, recent orders, and quick links',
        category: 'navigation',
        icon: User,
        action: () => onNavigate('servers')
      },
      {
        id: 'nav_vps',
        title: 'My VPS',
        subtitle: 'Manage your virtual private servers: power, terminal, files and SSH',
        category: 'navigation',
        icon: Server,
        action: () => onNavigate('vps-list')
      },
      {
        id: 'nav_pricing',
        title: 'Pricing & Plans',
        subtitle: 'Browse Bot & VPS hosting plans',
        category: 'navigation',
        icon: Sparkles,
        action: () => onNavigate('pricing')
      },
      {
        id: 'nav_billing',
        title: 'Billing & Invoices',
        subtitle: 'Manage account credits, orders, and payment methods',
        category: 'navigation',
        icon: CreditCard,
        action: () => onNavigate('billing')
      },
      {
        id: 'nav_support',
        title: 'Support Helpdesk',
        subtitle: 'Submit tickets and view support staff replies',
        category: 'navigation',
        icon: HelpCircle,
        action: () => onNavigate('support')
      },
      {
        id: 'nav_settings',
        title: 'Account Settings',
        subtitle: 'Profile, password, Discord link & notification webhooks',
        category: 'navigation',
        icon: User,
        action: () => onNavigate('settings')
      },
      {
        id: 'nav_status',
        title: 'Public Infrastructure Status',
        subtitle: 'Real-time telemetry, uptime and component health',
        category: 'navigation',
        icon: Activity,
        action: () => onNavigate('status')
      },
      {
        id: 'nav_docs',
        title: 'Documentation & Guides',
        subtitle: 'API guides, billing FAQs & troubleshooting',
        category: 'navigation',
        icon: BookOpen,
        action: () => onNavigate('docs')
      }
    ];

    if (user && ['admin', 'super_admin'].includes(user.role)) {
      list.push(
        {
          id: 'admin_dash',
          title: 'Admin Overview',
          subtitle: 'Platform revenue, order and account metrics',
          category: 'admin',
          icon: Shield,
          action: () => onNavigate('admin-dashboard')
        },
        {
          id: 'admin_users',
          title: 'Admin User Management',
          subtitle: 'Role assignments, credit adjustments & accounts',
          category: 'admin',
          icon: Users,
          action: () => onNavigate('admin-users')
        },
        {
          id: 'admin_products',
          title: 'Admin Products & Plans',
          subtitle: 'Configure hosting plans, pricing and specs',
          category: 'admin',
          icon: Package,
          action: () => onNavigate('admin-products')
        },
        {
          id: 'admin_billing',
          title: 'Admin Orders & Billing',
          subtitle: 'Review orders, transactions and payment gateways',
          category: 'admin',
          icon: ShoppingBag,
          action: () => onNavigate('admin-billing')
        },
        {
          id: 'admin_panel_link',
          title: 'Panel Integration',
          subtitle: 'Link your hosting panel and monitor auto-provisioning',
          category: 'admin',
          icon: Link2,
          action: () => onNavigate('admin-panel-link')
        },
        {
          id: 'admin_coupons',
          title: 'Admin Coupons & Promotions',
          subtitle: 'Create discount codes and promotional vouchers',
          category: 'admin',
          icon: Tag,
          action: () => onNavigate('admin-coupons')
        },
        {
          id: 'admin_announcements',
          title: 'Admin Announcements',
          subtitle: 'Site-wide banners and customer announcements',
          category: 'admin',
          icon: Megaphone,
          action: () => onNavigate('admin-announcements')
        },
        {
          id: 'admin_vps',
          title: 'Admin VPS Hosting',
          subtitle: 'VPS servers, nodes, plans, orders and OS images',
          category: 'admin',
          icon: Server,
          action: () => onNavigate('admin-vps')
        },
        {
          id: 'admin_vps_servers',
          title: 'Admin VPS Servers',
          subtitle: 'Suspend, extend, resize, reinstall or delete customer VPSes',
          category: 'admin',
          icon: Server,
          action: () => onNavigate('admin-vps-servers')
        },
        {
          id: 'admin_discord',
          title: 'Admin Discord Integration',
          subtitle: 'Bot credentials, OAuth & notification routing',
          category: 'admin',
          icon: MessageSquare,
          action: () => onNavigate('admin-discord')
        }
      );
    }

    setItems(list);
  };

  const filteredItems = items.filter(item => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < filteredItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 px-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-zinc-800 bg-zinc-900/60">
          <Search className="h-5 w-5 text-amber-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, billing, or admin tools... (Ctrl+K)"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono text-zinc-400 bg-zinc-800 rounded border border-zinc-700">
            ESC
          </kbd>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No matching pages found for "{query}".
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition ${
                    isSelected ? 'bg-amber-500/10 border border-amber-500/30 text-white' : 'hover:bg-zinc-900 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg ${
                      item.category === 'admin' ? 'bg-rose-500/10 text-rose-400' :
                      'bg-zinc-800 text-zinc-400'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="truncate">
                      <div className="text-xs font-semibold truncate flex items-center gap-2">
                        <span>{item.title}</span>
                        {item.category === 'admin' && (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-800">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">{item.subtitle}</div>
                    </div>
                  </div>

                  <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-amber-400 opacity-100' : 'opacity-0'}`} />
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-950 text-[10px] text-zinc-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>Use <kbd className="font-mono bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">↑</kbd> <kbd className="font-mono bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">↓</kbd> to navigate</span>
            <span><kbd className="font-mono bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">Enter</kbd> to select</span>
          </div>
          <span>Quick Search</span>
        </div>
      </div>
    </div>
  );
};
