import React, { useState, useEffect } from 'react';
import {
  Bot, ShieldCheck, ArrowRight, CheckCircle2, Sparkles, Server, Users,
  Headphones, Gauge, Lock, RotateCw, ChevronDown, Star,
  Rocket, Terminal, Database
} from 'lucide-react';
import { motion } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';
import { apiRequest } from '../../lib/api';
import { Plan } from '../../types';

interface HomeProps {
  onNavigate: (page: string) => void;
}

const FALLBACK_BOT_FEATURES = [
  '24/7 process watchdog',
  'Environment variables & secrets manager',
  'Setup & configuration support included',
  'Low latency connection to bot gateways'
];

const FALLBACK_VPS_FEATURES = [
  'High-clock dedicated vCPU cores',
  'Full root access, any OS image',
  'Free MySQL/Postgres database & subdomain',
  'Routine backups & uptime monitoring'
];

const TICKER_ITEMS = [
  '99.99% UPTIME SLA',
  'DISCORD BOT HOSTING',
  'FULL ROOT ACCESS VPS',
  '24/7 PROCESS WATCHDOG',
  'REAL HUMAN SUPPORT',
  'FREE MIGRATION ASSISTANCE'
];

const FAQS = [
  {
    q: 'How fast can my bot or server go live?',
    a: 'Once your payment is verified by our team, your service is set up and your credentials are delivered to your dashboard. Bot Hosting is designed for quick deployment; VPS plans come with full root access.'
  },
  {
    q: 'What runtimes does Bot Hosting support?',
    a: 'Node.js (v18-v22), Python (3.9-3.12), Bun, and Go are supported, with automatic restart on crash and an environment variables & secrets manager.'
  },
  {
    q: 'Can you help me move over from another host?',
    a: 'Yes. Free migration assistance is available — open a support ticket from your dashboard and our team will help you get moved.'
  },
  {
    q: 'What payment methods do you accept?',
    a: 'The payment methods currently enabled are shown at checkout — by default that includes UPI, bank transfer, and gift card redemption.'
  },
  {
    q: "What's included with VPS Hosting?",
    a: 'VPS plans include high-clock dedicated vCPU cores, full root access with any OS image, a free MySQL/Postgres database & subdomain, and routine backups with uptime monitoring.'
  }
];

export const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const { pageAnimationsEnabled, heroDescription, brandName } = useBranding();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const res = await apiRequest('/public/plans');
        if (res.success && Array.isArray(res.data)) {
          setPlans(res.data);
        } else if (res.error) {
          console.error('Failed to load plans on home:', res.error.message);
        }
      } catch (err: any) {
        console.error('Failed to load plans on home:', err.message || err);
      }
    };

    loadPlans();
  }, []);

  const vpsPlans = plans.filter(p => p.productId === 'prod_vps' || p.id.startsWith('plan_vps_'));
  const botPlans = plans.filter(p => p.productId === 'prod_bot' || p.id.startsWith('plan_bot_'));

  const cheapestVps = vpsPlans.length > 0
    ? [...vpsPlans].sort((a, b) => a.priceMonthly - b.priceMonthly)[0]
    : null;
  const cheapestBot = botPlans.length > 0
    ? [...botPlans].sort((a, b) => a.priceMonthly - b.priceMonthly)[0]
    : null;

  const minVpsPrice = cheapestVps?.priceMonthly ?? 3.5;
  const minBotPrice = cheapestBot?.priceMonthly ?? 0.5;

  const botFeatures = (cheapestBot?.features?.length ? cheapestBot.features : FALLBACK_BOT_FEATURES).slice(0, 5);
  const vpsFeatures = (cheapestVps?.features?.length ? cheapestVps.features : FALLBACK_VPS_FEATURES).slice(0, 5);

  const animate = pageAnimationsEnabled && !prefersReducedMotion;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 120, damping: 18, mass: 0.8 } }
  };

  const motionDivProps = animate ? { variants: containerVariants, initial: 'hidden', animate: 'visible' } : {};
  const motionChildProps = animate ? { variants: itemVariants } : {};

  return (
    <motion.div {...motionDivProps} className="relative isolate">

      {/* ================= HERO (dark) ================= */}
      <motion.section {...motionChildProps} className="relative px-4 sm:px-6 lg:px-8 pt-4 sm:pt-8 pb-10 sm:pb-14">
        {/* Soft ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
          <div
            className="absolute -top-36 left-1/2 -translate-x-1/2 w-[600px] sm:w-[900px] h-[480px] rounded-full opacity-30 blur-[160px]"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 45%, rgba(0,0,0,0) 70%)' }}
          />
        </div>

        <div className="mx-auto max-w-[1080px]">
          <div className="text-center space-y-5 sm:space-y-6 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-semibold text-zinc-100 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>{brandName} Bot &amp; VPS Hosting</span>
            </div>

            <h1 className={`text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight font-display leading-[1.08] ${animate ? 'mono-heading-shimmer' : 'text-white'}`}>
              Hosting, built
              <br />
              without the noise.
            </h1>

            <p className="text-sm sm:text-base md:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              {heroDescription}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-1">
              <button
                onClick={() => onNavigate('register')}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl font-semibold text-zinc-950 bg-white hover:bg-zinc-200 shadow-lg shadow-black/30 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm"
              >
                <Rocket className="h-4 w-4" />
                Get Started Free
              </button>
              <button
                onClick={() => onNavigate('pricing')}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl font-semibold text-white bg-transparent border border-white/20 hover:bg-white/10 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm"
              >
                View All Plans
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 fill-current text-white" /> Real human support</span>
              <span className="hidden sm:inline text-zinc-700">•</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> DDoS-protected network</span>
              <span className="hidden sm:inline text-zinc-700">•</span>
              <span className="flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> Instant deployment</span>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ================= TICKER (full-bleed) ================= */}
      <motion.div {...motionChildProps} className="-mx-4 lg:-mx-6 border-y border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className={`flex w-max whitespace-nowrap py-2.5 text-[11px] font-bold tracking-widest text-zinc-400 font-mono ${animate ? 'animate-marquee' : ''}`}>
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} className="flex items-center">
              <span className="px-4">{item}</span>
              <span className="text-zinc-700">•</span>
            </span>
          ))}
        </div>
      </motion.div>

      {/* ================= OUR PRODUCTS (full-bleed, light) ================= */}
      <motion.section {...motionChildProps} className="-mx-4 lg:-mx-6 bg-zinc-100">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
          <div className="text-center max-w-xl mx-auto mb-10 sm:mb-14 space-y-2">
            <span className="text-xs font-bold tracking-[0.2em] text-zinc-500 uppercase">Purchase</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-zinc-950 font-display">Our Products</h2>
            <p className="text-xs sm:text-sm text-zinc-600">
              Two products, done properly — no confusing tiers, no filler hosting types.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">

            {/* Bot Hosting */}
            <div className="rounded-2xl border border-zinc-300 bg-white p-6 sm:p-7 flex flex-col justify-between shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="space-y-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-950 font-display">Bot Hosting</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Starting at</p>
                  <p className="text-3xl font-bold text-zinc-950">
                    ${minBotPrice.toFixed(2)}<span className="text-sm font-medium text-zinc-500">/month</span>
                  </p>
                </div>
                <ul className="space-y-2 text-xs text-zinc-700">
                  {botFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-zinc-950 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => onNavigate('bot')}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-zinc-950 text-white hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 mt-6"
              >
                Learn More <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {/* VPS Hosting */}
            <div className="rounded-2xl border border-zinc-300 bg-white p-6 sm:p-7 flex flex-col justify-between shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="space-y-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                  <Server className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-950 font-display">VPS Hosting</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Starting at</p>
                  <p className="text-3xl font-bold text-zinc-950">
                    ${minVpsPrice.toFixed(2)}<span className="text-sm font-medium text-zinc-500">/month</span>
                  </p>
                </div>
                <ul className="space-y-2 text-xs text-zinc-700">
                  {vpsFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-zinc-950 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => onNavigate('vps')}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-zinc-950 text-white hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 mt-6"
              >
                Learn More <ArrowRight className="h-4 w-4" />
              </button>
            </div>

          </div>
        </div>
      </motion.section>

      {/* ================= INFRASTRUCTURE (full-bleed, black) ================= */}
      <motion.section {...motionChildProps} className="-mx-4 lg:-mx-6 bg-black">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-14 sm:py-20 text-center">
          <span className="text-xs font-bold tracking-[0.2em] text-zinc-500 uppercase">Infrastructure</span>
          <h2 className={`text-3xl sm:text-4xl font-bold font-display mt-2 leading-tight ${animate ? 'mono-heading-shimmer' : 'text-white'}`}>
            Built for Uptime
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-xl mx-auto mt-3 leading-relaxed">
            {brandName} keeps your bots and servers running with process watchdogs, routine backups, uptime monitoring, and a team that answers tickets.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mt-10">
            {[
              { icon: RotateCw, label: 'Auto-restart on crash' },
              { icon: ShieldCheck, label: 'Uptime monitoring' },
              { icon: Database, label: 'Routine backups' },
              { icon: Lock, label: 'Full root access' },
              { icon: Terminal, label: 'Multi-runtime bots' },
              { icon: Headphones, label: 'Real human support' }
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-col items-center gap-2.5 text-center hover:border-zinc-600 transition-colors">
                <Icon className="h-5 w-5 text-white" />
                <span className="text-[11px] font-semibold text-zinc-300 leading-snug">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ================= STATS (full-bleed, light) ================= */}
      <motion.section {...motionChildProps} className="-mx-4 lg:-mx-6 bg-zinc-100">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-14 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-zinc-950 font-display">
            Built for developers and server owners
          </h2>
          <p className="text-xs sm:text-sm text-zinc-600 mt-2 max-w-lg mx-auto">
            Straightforward hosting, transparent pricing, and a team that actually answers tickets.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mt-10">
            {[
              { icon: Gauge, value: '99.99%', label: 'Uptime SLA' },
              { icon: Headphones, value: '24/7', label: 'Process watchdog' },
              { icon: Bot, value: '2', label: 'Focused products' },
              { icon: Users, value: 'Human', label: 'Support, not bots' }
            ].map(({ icon: Icon, value, label }) => (
              <div key={label} className="p-4">
                <Icon className="h-5 w-5 text-zinc-950 mx-auto mb-2" />
                <div className="text-2xl sm:text-3xl font-bold text-zinc-950 font-display">{value}</div>
                <div className="text-[11px] text-zinc-600 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ================= FAQ ================= */}
      <motion.section {...motionChildProps} className="px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-8 sm:mb-10 space-y-2">
            <span className="text-xs font-bold tracking-[0.2em] text-zinc-500 uppercase">Support</span>
            <h2 className={`text-2xl sm:text-3xl font-bold font-display ${animate ? 'mono-heading-shimmer' : 'text-white'}`}>Frequently Asked Questions</h2>
          </div>

          <div className="space-y-2.5">
            {FAQS.map((item, i) => {
              const isOpen = openFaq === i;
              return (
                <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left"
                  >
                    <span className="text-sm font-semibold text-white">{item.q}</span>
                    <ChevronDown className={`h-4 w-4 text-zinc-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 -mt-1">
                      <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">{item.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* ================= FINAL CTA ================= */}
      <motion.section {...motionChildProps} className="px-4 sm:px-6 lg:px-8 pb-14 sm:pb-20">
        <div className="mx-auto max-w-5xl rounded-3xl bg-white p-8 sm:p-14 text-center space-y-5 shadow-2xl">
          <h2 className="text-2xl sm:text-4xl font-bold text-zinc-950 font-display">
            Ready to launch?
          </h2>
          <p className="text-zinc-600 text-xs sm:text-sm max-w-xl mx-auto leading-relaxed">
            Create a free account and deploy your first bot or server in minutes. Free migration assistance available.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <button
              onClick={() => onNavigate('register')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-semibold text-white bg-zinc-950 hover:bg-zinc-800 hover:scale-[1.01] active:scale-[0.99] transition-all text-sm"
            >
              Create Free Account
            </button>
            <button
              onClick={() => onNavigate('pricing')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-semibold text-zinc-700 bg-zinc-100 border border-zinc-300 hover:bg-zinc-200 hover:scale-[1.01] active:scale-[0.99] transition-all text-sm"
            >
              Browse All Plans
            </button>
          </div>
        </div>
      </motion.section>

    </motion.div>
  );
};
