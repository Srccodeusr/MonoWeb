import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Shield, HelpCircle, Activity, User, LogIn,
  Sparkles, Search, Menu, X, LayoutDashboard, CreditCard, LifeBuoy,
  Settings, LogOut, Sliders, Users, Package,
  Megaphone, ShoppingBag, MessageSquare, Palette, FileText,
  Tag, Key, Scale, Link2, Mail
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import { apiRequest } from '../lib/api';
import { MonoLogo } from './MonoLogo';

interface NavbarProps {
  currentPage: string;
  onNavigate: (page: string, params?: any) => void;
  onOpenSearch?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentPage,
  onNavigate,
  onOpenSearch
}) => {
  const { user, logout } = useAuth();
  const { accentClasses } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadMailCount, setUnreadMailCount] = useState(0);

  const handleNav = (page: string, params?: any) => {
    onNavigate(page, params);
    setMobileMenuOpen(false);
  };

  // Poll the mailbox unread count for the navbar mail icon badge
  useEffect(() => {
    if (!user) {
      setUnreadMailCount(0);
      return;
    }

    let cancelled = false;
    const fetchUnreadCount = async () => {
      const res = await apiRequest('/mail/unread-count');
      if (!cancelled && res.success && res.data) {
        setUnreadMailCount(res.data.count || 0);
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, currentPage]);

  // Close on ESC key, prevent background body scroll when open & close on desktop resize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };

    const handleResize = () => {
      if (window.innerWidth >= 1024 && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };

    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleResize);
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileMenuOpen]);

  const isAdmin = user && ['admin', 'super_admin', 'support', 'moderator'].includes(user.role);
  const isAdminRoute = currentPage.startsWith('admin-');

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8">

        {/* Logo */}
        <MonoLogo onClick={() => handleNav('home')} />

        {/* Navigation links (Desktop) */}
        <nav className="hidden lg:flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleNav('home')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === 'home' ? 'text-white bg-zinc-800/60' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleNav('bot')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === 'bot' ? 'text-white bg-zinc-800/60' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
          >
            Bot Hosting
          </button>
          <button
            type="button"
            onClick={() => handleNav('vps')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === 'vps' ? 'text-white bg-zinc-800/60' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
          >
            VPS Hosting
          </button>
          <button
            type="button"
            onClick={() => handleNav('pricing')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === 'pricing' ? 'text-white bg-zinc-800/60' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
          >
            Pricing
          </button>
          <button
            type="button"
            onClick={() => handleNav('status')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${currentPage === 'status' ? 'text-white bg-zinc-800/60' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Status
          </button>
          <button
            type="button"
            onClick={() => handleNav('docs')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${currentPage === 'docs' ? 'text-white bg-zinc-800/60' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
          >
            Docs
          </button>
        </nav>

        {/* Right CTA */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {onOpenSearch && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenSearch();
              }}
              className="hidden sm:flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-xl text-xs text-zinc-400 bg-zinc-900/80 hover:bg-zinc-800/80 hover:text-white border border-zinc-800 transition focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              title="Search everything (Ctrl+K)"
              aria-label="Search command palette"
            >
              <Search className="h-4 w-4 text-zinc-400" />
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden md:inline-flex px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-zinc-950 rounded border border-zinc-800">
                ⌘K
              </kbd>
            </button>
          )}

          {user && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleNav('mail');
              }}
              className="relative h-11 w-11 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 border border-zinc-800/80 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              title="Mailbox"
              aria-label="Open mailbox"
            >
              <Mail className="h-4 w-4" />
              {unreadMailCount > 0 && (
                <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white bg-gradient-to-r ${accentClasses.gradient} flex items-center justify-center`}>
                  {unreadMailCount > 9 ? '9+' : unreadMailCount}
                </span>
              )}
            </button>
          )}

          {user ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('admin-dashboard');
                  }}
                  className="hidden md:flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Admin Panel
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleNav('dashboard');
                }}
                className={`hidden sm:flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r ${accentClasses.gradient} shadow-md hover:opacity-95 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50`}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Dashboard</span>
              </button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleNav('login');
                }}
                className="px-3 sm:px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleNav('register');
                }}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r ${accentClasses.gradient} shadow-md ${accentClasses.shadow} hover:opacity-95 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50`}
              >
                <Sparkles className="h-4 w-4" />
                <span>Get Started</span>
              </button>
            </div>
          )}

          {/* Mobile/Tablet hamburger menu toggle - GUARANTEED ALWAYS VISIBLE below 1024px */}
          <button
            type="button"
            id="mobile-hamburger-trigger"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMobileMenuOpen((prev) => !prev);
            }}
            className="h-11 w-11 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white hover:bg-zinc-900 lg:hidden transition-colors border border-zinc-800/80 shrink-0 select-none z-40 min-h-[44px] min-w-[44px] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
          >
            {mobileMenuOpen ? <X className="h-5 w-5 text-amber-400" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile / Tablet Full-Featured Navigation Drawer Overlay via Portal */}
      {mobileMenuOpen && createPortal(
        <div
          id="mobile-navigation-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 z-[9999] lg:hidden flex justify-end"
        >
          {/* Backdrop Blur Overlay */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMobileMenuOpen(false);
            }}
            aria-hidden="true"
          />

          {/* Drawer Slide-Over Panel */}
          <div className="relative w-full max-w-[min(86vw,340px)] sm:max-w-[min(400px,78vw)] bg-zinc-950 border-l border-zinc-800/80 p-4 sm:p-5 flex flex-col justify-between h-full overflow-y-auto shadow-2xl z-10 animate-in slide-in-from-right duration-200 pt-safe pb-safe pl-safe pr-safe">
            <div className="space-y-5">
              {/* Drawer Top Header */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
                <MonoLogo onClick={() => handleNav('home')} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMobileMenuOpen(false);
                  }}
                  className="h-11 w-11 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 shrink-0 min-h-[44px] min-w-[44px] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  aria-label="Close navigation drawer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Quick Search inside Mobile Drawer */}
              {onOpenSearch && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMobileMenuOpen(false);
                    onOpenSearch();
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                >
                  <div className="flex items-center gap-2.5">
                    <Search className="h-4 w-4 text-amber-400" />
                    <span>Search Panel & Commands</span>
                  </div>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-zinc-950 rounded border border-zinc-800">⌘K</kbd>
                </button>
              )}

              {/* Logged In User Workspace Navigation */}
              {user && (
                <div className="space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 px-1">
                    {isAdminRoute ? 'Admin Control Plane' : 'Customer Workspace'}
                  </div>

                  <div className="space-y-1">
                    {isAdminRoute ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-dashboard')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-dashboard' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Sliders className="h-4 w-4 text-amber-400" /> System Overview
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-users')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-users' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Users className="h-4 w-4" /> User Accounts
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-products')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-products' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Package className="h-4 w-4" /> Products & Plans
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-billing')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-billing' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <ShoppingBag className="h-4 w-4" /> Orders & Billing
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-panel-link')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-panel-link' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Link2 className="h-4 w-4" /> Panel Integration
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-coupons')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-coupons' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Tag className="h-4 w-4" /> Coupons
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-announcements')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-announcements' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Megaphone className="h-4 w-4" /> Announcements
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-discord')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-discord' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <MessageSquare className="h-4 w-4" /> Discord Integration
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-appearance')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-appearance' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Palette className="h-4 w-4" /> Fonts & Themes
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-support')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-support' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <LifeBuoy className="h-4 w-4" /> Support Queue
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-mail')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-mail' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Mail className="h-4 w-4" /> Mail Center
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-audit-logs')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-audit-logs' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <FileText className="h-4 w-4" /> Audit Trail
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-api-keys')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-api-keys' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Key className="h-4 w-4" /> REST API Keys
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-legal')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-legal' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Scale className="h-4 w-4" /> Legal & Policies
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('admin-settings')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'admin-settings' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Sliders className="h-4 w-4" /> Platform Settings
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('dashboard')}
                          className="w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-zinc-300 hover:bg-zinc-900"
                        >
                          <User className="h-4 w-4 text-amber-400" /> Switch to My Account
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleNav('dashboard')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'dashboard' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <LayoutDashboard className="h-4 w-4" /> Dashboard
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('billing')}
                          className={`w-full flex items-center justify-between px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'billing' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <div className="flex items-center gap-3">
                            <CreditCard className="h-4 w-4" /> Billing & Credits
                          </div>
                          <span className="font-mono text-emerald-400 font-bold">${user?.credits?.toFixed(2) || '0.00'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('support')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'support' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <LifeBuoy className="h-4 w-4" /> Support Tickets
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('mail')}
                          className={`w-full flex items-center justify-between px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'mail' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <div className="flex items-center gap-3">
                            <Mail className="h-4 w-4" /> Mail
                          </div>
                          {unreadMailCount > 0 && (
                            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white bg-gradient-to-r ${accentClasses.gradient} flex items-center justify-center`}>
                              {unreadMailCount > 9 ? '9+' : unreadMailCount}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('activity')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'activity' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Activity className="h-4 w-4" /> Activity Log
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNav('settings')}
                          className={`w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold ${currentPage === 'settings' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-zinc-300 hover:bg-zinc-900'}`}
                        >
                          <Settings className="h-4 w-4" /> User Settings
                        </button>

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleNav('admin-dashboard')}
                            className="w-full flex items-center gap-3 px-3.5 py-3 min-h-[44px] rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          >
                            <Shield className="h-4 w-4" /> Admin Control Plane
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Public Pages */}
              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 px-1">
                  Explore
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleNav('home')}
                    className={`px-3 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-left transition-colors ${currentPage === 'home' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('bot')}
                    className={`px-3 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-left transition-colors ${currentPage === 'bot' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    Bot Hosting
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('vps')}
                    className={`px-3 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-left transition-colors ${currentPage === 'vps' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    VPS Hosting
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('pricing')}
                    className={`px-3 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-left transition-colors ${currentPage === 'pricing' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    Pricing
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('status')}
                    className={`px-3 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-left transition-colors flex items-center gap-1.5 ${currentPage === 'status' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Status
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNav('docs')}
                    className={`px-3 py-3 min-h-[44px] rounded-xl text-xs font-semibold text-left transition-colors ${currentPage === 'docs' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    Docs
                  </button>
                </div>
              </div>
            </div>

            {/* Footer User Profile & Sign Out */}
            {user ? (
              <div className="pt-4 border-t border-zinc-800 mt-6 space-y-3">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-zinc-900 border border-zinc-800">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <img
                      src={user.avatarUrl || 'https://api.dicebear.com/7.x/identicon/svg?seed=user'}
                      alt="Avatar"
                      className="h-9 w-9 rounded-xl object-cover bg-zinc-800 shrink-0"
                    />
                    <div className="truncate">
                      <div className="text-xs font-bold text-white truncate">{user.displayName || user.username}</div>
                      <div className="text-[10px] text-zinc-400 font-mono truncate">{user.email}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { logout(); setMobileMenuOpen(false); }}
                    title="Sign Out"
                    className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-4 border-t border-zinc-800 mt-6 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleNav('login')}
                  className="w-full py-3 min-h-[44px] rounded-xl text-xs font-semibold text-zinc-200 bg-zinc-900 border border-zinc-800"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => handleNav('register')}
                  className={`w-full py-3 min-h-[44px] rounded-xl text-xs font-bold text-white bg-gradient-to-r ${accentClasses.gradient} shadow-md`}
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};
