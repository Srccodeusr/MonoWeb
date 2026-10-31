import React, { useState, useEffect } from 'react';
import {
  Gamepad2, Bot, Server, Cloud, Cpu, HardDrive, Globe, Database, Zap, Rocket, Box,
  Monitor, Terminal, Layers, Check, ArrowRight, type LucideIcon
} from 'lucide-react';
import { useTheme } from '../../lib/ThemeContext';
import { apiRequest } from '../../lib/api';
import { Plan, Product } from '../../types';
import { HostingPlansSection } from '../../components/HostingPlansSection';

interface PricingProps {
  onNavigate: (page: string, params?: any) => void;
}

// GET /public/products strips panel internals, so only the display fields matter here.
type PublicProduct = Pick<Product, 'id' | 'name' | 'description' | 'category' | 'icon' | 'isActive' | 'sortOrder'>;

export interface PricingCategory {
  product: PublicProduct;
  plans: Plan[];
}

/**
 * Turns the live category (product) list + plan list into the tabs shown on the
 * pricing page. A category only gets a tab when it is active AND has at least
 * one active plan, so:
 *   - a deleted category can never linger as an empty tab, and
 *   - plans that point at a missing / hidden category are simply not shown.
 */
export function buildCategories(products: PublicProduct[], plans: Plan[]): PricingCategory[] {
  return [...products]
    .filter(p => p.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(product => ({
      product,
      plans: plans.filter(pl => pl.productId === product.id && pl.isActive !== false)
    }))
    .filter(c => c.plans.length > 0);
}

// Category icons are stored by name (admin types e.g. "Server" or "Bot").
const ICONS: Record<string, LucideIcon> = {
  gamepad2: Gamepad2, bot: Bot, server: Server, cloud: Cloud, cpu: Cpu, harddrive: HardDrive,
  globe: Globe, database: Database, zap: Zap, rocket: Rocket, box: Box, monitor: Monitor,
  terminal: Terminal, layers: Layers
};

export function resolveIcon(name?: string): LucideIcon {
  return ICONS[String(name || '').trim().toLowerCase()] || Server;
}

// Full class names (not built dynamically) so Tailwind can see and generate them.
const ACCENTS = [
  'bg-violet-600 text-white shadow-lg shadow-violet-500/20',
  'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20',
  'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20',
  'bg-amber-600 text-white shadow-lg shadow-amber-500/20',
  'bg-rose-600 text-white shadow-lg shadow-rose-500/20',
  'bg-sky-600 text-white shadow-lg shadow-sky-500/20'
];

// Keep the original look for the two built-in categories; rotate for new ones.
function accentFor(product: PublicProduct, index: number): string {
  if (product.category === 'bot') return ACCENTS[0];
  if (product.category === 'vps') return ACCENTS[1];
  return ACCENTS[2 + (index % (ACCENTS.length - 2))];
}

export const Pricing: React.FC<PricingProps> = ({ onNavigate }) => {
  const { accentClasses } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [categories, setCategories] = useState<PricingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPricing = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [productsRes, plansRes] = await Promise.all([
        apiRequest('/public/products'),
        apiRequest('/public/plans')
      ]);
      if (productsRes.success && plansRes.success && Array.isArray(productsRes.data) && Array.isArray(plansRes.data)) {
        setCategories(buildCategories(productsRes.data, plansRes.data));
      } else {
        setLoadError(productsRes.error?.message || plansRes.error?.message || 'Could not load plans.');
      }
    } catch (err: any) {
      console.error('Failed to load pricing:', err);
      setLoadError(err?.message || 'Could not load plans.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPricing();
  }, []);

  // Derived, not stored: if the selected category disappears (deleted / emptied
  // while the page is open) we fall back to the first one instead of showing nothing.
  const active = categories.find(c => c.product.id === selectedId) || categories[0];
  const activePlans = active ? active.plans : [];

  return (
    <div className="space-y-12 py-8 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      {/* Native hosting plans (monthly / half-yearly / yearly, set by the admin) */}
      <HostingPlansSection onNavigate={onNavigate} />

      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <h1 className="text-4xl font-extrabold text-white">Transparent, Scalable Pricing</h1>
        <p className="text-sm text-zinc-400">
          No hidden fees or bandwidth limits. Select your product and get started with straightforward checkout.
        </p>

        {/* Category Switcher — one tab per live category */}
        {categories.length > 0 && (
          <div className="pt-4 flex flex-wrap items-center justify-center gap-2">
            {categories.map((c, i) => {
              const Icon = resolveIcon(c.product.icon);
              const isActive = active?.product.id === c.product.id;
              return (
                <button
                  key={c.product.id}
                  onClick={() => setSelectedId(c.product.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    isActive ? accentFor(c.product, i) : 'bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{c.product.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {active?.product.description && (
          <p className="text-xs text-zinc-500 max-w-xl mx-auto">{active.product.description}</p>
        )}

        {/* Billing Cycle Switcher */}
        {categories.length > 0 && (
          <div className="pt-2 flex items-center justify-center gap-3">
            <span className={`text-xs ${billingCycle === 'monthly' ? 'text-white font-bold' : 'text-zinc-500'}`}>Monthly</span>
            <button
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
              className="w-11 h-6 rounded-full bg-zinc-800 p-1 flex items-center relative"
            >
              <div className={`h-4 w-4 rounded-full bg-violet-500 transition-transform ${billingCycle === 'yearly' ? 'translate-x-5' : ''}`} />
            </button>
            <span className={`text-xs ${billingCycle === 'yearly' ? 'text-white font-bold' : 'text-zinc-500'}`}>
              Yearly (17% OFF)
            </span>
          </div>
        )}
      </div>

      {/* Plans Grid */}
      {loading ? (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500"></div>
        </div>
      ) : loadError ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-sm text-rose-400">{loadError}</p>
          <button
            onClick={loadPricing}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold"
          >
            Try again
          </button>
        </div>
      ) : activePlans.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No plans are available right now. Please check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {activePlans.map((p) => {
            const price = billingCycle === 'yearly' ? (p.priceYearly / 12).toFixed(2) : p.priceMonthly.toFixed(2);
            return (
              <div
                key={p.id}
                className={`rounded-3xl p-6 bg-zinc-900/80 border flex flex-col justify-between relative transition-all ${
                  p.isPopular ? 'border-violet-500 shadow-xl shadow-violet-500/10 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {p.isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold bg-violet-600 text-white uppercase tracking-wider">
                    Popular Choice
                  </div>
                )}

                <div className="space-y-4">
                  <h3 className="text-xl font-bold text-white">{p.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-white">${price}</span>
                    <span className="text-xs text-zinc-400">/mo</span>
                  </div>

                  <div className="space-y-2 text-xs pt-4 border-t border-zinc-800 text-zinc-300">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400" />
                      <span>{p.ramMB >= 1024 ? `${p.ramMB / 1024}GB RAM` : `${p.ramMB}MB RAM`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400" />
                      <span>{p.cpuCores} vCPU Core{p.cpuCores > 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400" />
                      <span>{p.diskGB}GB NVMe Storage</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400" />
                      <span>{p.backupLimit} Backup Slot{p.backupLimit > 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400" />
                      <span>{p.databaseLimit} Database Instance{p.databaseLimit > 1 ? 's' : ''}</span>
                    </div>
                    {p.features && p.features.slice(0, 2).map((feat, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => onNavigate('checkout', { planId: p.id, billingCycle })}
                  className={`w-full mt-6 py-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all ${
                    p.isPopular
                      ? `bg-gradient-to-r ${accentClasses.gradient} text-white shadow-md hover:opacity-95`
                      : 'bg-zinc-800 text-white hover:bg-zinc-700'
                  }`}
                >
                  <span>Get Started</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
