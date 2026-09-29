import React, { useState, useEffect, useRef } from 'react';
import {
  Bot, ShieldCheck, ArrowRight, CheckCircle2, Server, Users,
  Headphones, Gauge, Lock, RotateCw, ChevronDown,
  Terminal, Database, UserPlus, CreditCard, Play, Cpu
} from 'lucide-react';
import { motion } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';
import { apiRequest } from '../../lib/api';
import { Plan } from '../../types';
import { HeroSlider } from '../../components/HeroSlider';
import { Reveal, ScrollProgress, useHeroScroll, useScrollingFlag, useSmoothWheel } from '../../components/animation/ScrollFx';

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

interface ProductCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  price: number;
  features: string[];
  cta: string;
  page: string;
  onNavigate: (page: string) => void;
}

// Module-level on purpose: a component declared inside Home gets a new identity every render and remounts.
const ProductCard: React.FC<ProductCardProps> = ({ icon: Icon, title, price, features, cta, page, onNavigate }) => (
  <div className="h-full rounded-3xl border border-zinc-300 bg-white p-8 sm:p-10 lg:p-12 flex flex-col justify-between shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
    <div className="space-y-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-950 text-white">
        <Icon className="h-8 w-8" />
      </div>
      <div>
        <h3 className="text-2xl sm:text-3xl font-bold text-zinc-950 font-display">{title}</h3>
        <p className="text-sm text-zinc-500 mt-2">Starting at</p>
        <p className="text-5xl sm:text-6xl font-bold text-zinc-950 font-display tracking-tight">
          ${price.toFixed(2)}<span className="text-base font-medium text-zinc-500 tracking-normal">/month</span>
        </p>
      </div>
      <ul className="space-y-3.5 text-sm sm:text-base text-zinc-700">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-zinc-950 shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
    <button
      onClick={() => onNavigate(page)}
      className="w-full py-4 rounded-2xl font-semibold text-base bg-zinc-950 text-white hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 mt-10"
    >
      {cta} <ArrowRight className="h-5 w-5" />
    </button>
  </div>
);

export const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const { pageAnimationsEnabled, brandName, socialLinks, discordUrl } = useBranding();
  const joinUrl = socialLinks?.discord || discordUrl;
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

  // scroll-driven effects: hero parallax (+ pause its animations off-screen), inertial wheel scrolling
  const heroRef = useRef<HTMLDivElement>(null);
  const heroLayerRef = useRef<HTMLDivElement>(null);
  useHeroScroll(heroRef, heroLayerRef, animate);
  useScrollingFlag(animate);
  useSmoothWheel(animate);

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

  const sectionWrap = 'mx-auto max-w-6xl px-4 sm:px-6 lg:px-8';
  const eyebrow = 'text-sm font-semibold text-zinc-500';

  return (
    <motion.div {...motionDivProps} className="relative isolate">

      {/* ================= HERO (auto-rotating: Bot Hosting <-> VPS Hosting) ================= */}
      <div ref={heroRef} className="hero-wrap">
        <div ref={heroLayerRef} className="hero-layer">
          <HeroSlider botPrice={minBotPrice} vpsPrice={minVpsPrice} autoplay={animate} onNavigate={onNavigate} />
        </div>
      </div>

      {/* ================= TICKER ================= */}
      <motion.div {...motionChildProps} className="-mx-4 lg:-mx-6 border-y border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className={`flex w-max whitespace-nowrap py-4 text-xs sm:text-sm font-bold tracking-widest text-zinc-400 font-mono ${animate ? 'animate-marquee' : ''}`}>
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} className="flex items-center">
              <span className="px-6">{item}</span>
              <span className="text-zinc-700">•</span>
            </span>
          ))}
        </div>
      </motion.div>

      {/* ================= LIGHT SECTION (Products + How it works + Stats merged) ================= */}
      <motion.section {...motionChildProps} className="-mx-4 lg:-mx-6 bg-zinc-100">
        <div className={`${sectionWrap} py-24 sm:py-32 lg:py-40 space-y-24 sm:space-y-32`}>

          {/* Products */}
          <div>
            <Reveal className="max-w-2xl mb-12 sm:mb-16 space-y-3">
              <span className={eyebrow}>Purchase</span>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-zinc-950 font-display">Our Products</h2>
              <p className="text-base sm:text-lg text-zinc-600">
                Two products, done properly — no confusing tiers, no filler hosting types.
              </p>
            </Reveal>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
              <Reveal className="h-full" speed={0.5}><ProductCard icon={Bot} title="Bot Hosting" price={minBotPrice} features={botFeatures} cta="Learn More" page="bot" onNavigate={onNavigate} /></Reveal>
              <Reveal className="h-full" delay={0.15} speed={1}><ProductCard icon={Server} title="VPS Hosting" price={minVpsPrice} features={vpsFeatures} cta="Learn More" page="vps" onNavigate={onNavigate} /></Reveal>
            </div>
          </div>

          {/* How it works — a genuine sequence */}
          <div className="border-t border-zinc-300 pt-20 sm:pt-28">
            <Reveal className="max-w-2xl mb-12 sm:mb-16 space-y-3">
              <span className={eyebrow}>How it works</span>
              <h2 className="text-3xl sm:text-5xl font-bold text-zinc-950 font-display">Live in three steps</h2>
              <p className="text-base sm:text-lg text-zinc-600">From sign-up to a running bot or server, without the back-and-forth.</p>
            </Reveal>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              {[
                { icon: UserPlus, title: 'Create a free account', text: 'Sign up in a minute and open your dashboard — no card needed to look around.' },
                { icon: CreditCard, title: 'Pick a plan and pay', text: 'Choose Bot or VPS hosting and pay with the methods shown at checkout, like UPI, bank transfer or gift card.' },
                { icon: Play, title: 'Deploy from your dashboard', text: 'Once payment is verified, your credentials land in the dashboard and you can go live.' }
              ].map(({ icon: Icon, title, text }, i) => (
                <Reveal as="li" delay={i * 0.14} key={title} className="rounded-3xl bg-white border border-zinc-300 p-8 sm:p-10 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                      <Icon className="h-7 w-7" />
                    </div>
                    <span className="font-display text-5xl font-bold text-zinc-300">{i + 1}</span>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-bold text-zinc-950 font-display">{title}</h3>
                  <p className="text-sm sm:text-base text-zinc-600 leading-relaxed">{text}</p>
                </Reveal>
              ))}
            </ol>
          </div>

          {/* Stats */}
          <div className="border-t border-zinc-300 pt-20 sm:pt-28 text-center">
            <Reveal><h2 className="text-3xl sm:text-5xl font-bold text-zinc-950 font-display">
              Built for developers and server owners
            </h2>
            <p className="text-base sm:text-lg text-zinc-600 mt-4 max-w-2xl mx-auto">
              Straightforward hosting, transparent pricing, and a team that actually answers tickets.
            </p></Reveal>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-10 mt-14">
              {[
                { icon: Gauge, value: '99.99%', label: 'Uptime SLA' },
                { icon: Headphones, value: '24/7', label: 'Process watchdog' },
                { icon: Bot, value: '2', label: 'Focused products' },
                { icon: Users, value: 'Human', label: 'Support, not bots' }
              ].map(({ icon: Icon, value, label }, i) => (
                <Reveal key={label} delay={i * 0.1} speed={0.35 + (i % 2) * 0.5} className="p-4">
                  <Icon className="h-7 w-7 text-zinc-950 mx-auto mb-4" />
                  <div className="text-4xl sm:text-6xl font-bold text-zinc-950 font-display tracking-tight">{value}</div>
                  <div className="text-sm sm:text-base text-zinc-600 mt-2">{label}</div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </motion.section>

      {/* ================= DARK SECTION (Infrastructure + Runtimes + FAQ + CTA merged) ================= */}
      <motion.section {...motionChildProps} className="-mx-4 lg:-mx-6 bg-black">
        <div className={`${sectionWrap} py-24 sm:py-32 lg:py-40 space-y-24 sm:space-y-32`}>

          {/* Infrastructure */}
          <div className="text-center">
            <span className={eyebrow}>Infrastructure</span>
            <h2 className={`text-4xl sm:text-5xl lg:text-6xl font-bold font-display mt-3 leading-tight ${animate ? 'mono-heading-shimmer' : 'text-white'}`}>
              Built for Uptime
            </h2>
            <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mt-5 leading-relaxed">
              {brandName} keeps your bots and servers running with process watchdogs, routine backups, uptime monitoring, and a team that answers tickets.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mt-14">
              {[
                { icon: RotateCw, label: 'Auto-restart on crash' },
                { icon: ShieldCheck, label: 'Uptime monitoring' },
                { icon: Database, label: 'Routine backups' },
                { icon: Lock, label: 'Full root access' },
                { icon: Terminal, label: 'Multi-runtime bots' },
                { icon: Headphones, label: 'Real human support' }
              ].map(({ icon: Icon, label }, i) => (
                <Reveal key={label} delay={(i % 3) * 0.1} speed={0.25 + (i % 3) * 0.3} className="rounded-3xl"><div className="h-full p-8 sm:p-10 rounded-3xl bg-zinc-900/60 border border-zinc-800 flex flex-col items-center gap-4 text-center hover:border-zinc-600 transition-colors">
                  <Icon className="h-8 w-8 text-white" />
                  <span className="text-base sm:text-lg font-semibold text-zinc-200 leading-snug">{label}</span>
                </div></Reveal>
              ))}
            </div>
          </div>

          {/* Runtimes */}
          <div className="border-t border-zinc-800 pt-20 sm:pt-28 grid lg:grid-cols-[1fr_1.3fr] gap-12 lg:gap-20 items-center">
            <div className="space-y-4">
              <span className={eyebrow}>Runtimes</span>
              <h2 className="text-3xl sm:text-5xl font-bold text-white font-display">Run what you already build</h2>
              <p className="text-base sm:text-lg text-zinc-400 leading-relaxed">
                Bring your bot as it is. Bot Hosting supports the runtimes below, and a VPS gives you full root access with any OS image.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:gap-5">
              {[
                { name: 'Node.js', note: 'v18 – v22' },
                { name: 'Python', note: '3.9 – 3.12' },
                { name: 'Bun', note: 'Fast JS runtime' },
                { name: 'Go', note: 'Compiled binaries' }
              ].map(r => (
                <div key={r.name} className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 sm:p-8 flex items-center gap-4">
                  <div className="h-12 w-12 shrink-0 rounded-xl bg-white text-zinc-950 flex items-center justify-center">
                    <Cpu className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-lg sm:text-xl font-bold text-white font-display">{r.name}</div>
                    <div className="text-sm text-zinc-400">{r.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div className="border-t border-zinc-800 pt-20 sm:pt-28">
            <div className="mx-auto max-w-3xl">
              <div className="text-center mb-12 space-y-3">
                <span className={eyebrow}>Support</span>
                <h2 className={`text-3xl sm:text-5xl font-bold font-display ${animate ? 'mono-heading-shimmer' : 'text-white'}`}>Frequently Asked Questions</h2>
              </div>
              <div className="space-y-3.5">
                {FAQS.map((item, i) => {
                  const isOpen = openFaq === i;
                  return (
                    <div key={i} className="rounded-3xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                      <button
                        onClick={() => setOpenFaq(isOpen ? null : i)}
                        className="w-full flex items-center justify-between gap-4 p-6 sm:p-7 text-left"
                        aria-expanded={isOpen}
                      >
                        <span className="text-base sm:text-lg font-semibold text-white">{item.q}</span>
                        <ChevronDown className={`h-5 w-5 text-zinc-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && (
                        <div className="px-6 sm:px-7 pb-6 sm:pb-7 -mt-2">
                          <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">{item.a}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Final CTA */}
          <div className="rounded-[2rem] bg-white p-10 sm:p-16 lg:p-20 text-center space-y-6 shadow-2xl">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-bold text-zinc-950 font-display">Ready to launch?</h2>
            <p className="text-zinc-600 text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
              Create a free account and deploy your first bot or server in minutes. Free migration assistance available.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 pt-3">
              <button
                onClick={() => onNavigate('register')}
                className="px-9 py-4 rounded-2xl font-semibold text-white bg-zinc-950 hover:bg-zinc-800 hover:scale-[1.01] active:scale-[0.99] transition-all text-base"
              >
                Create Free Account
              </button>
              <button
                onClick={() => onNavigate('pricing')}
                className="px-9 py-4 rounded-2xl font-semibold text-zinc-700 bg-zinc-100 border border-zinc-300 hover:bg-zinc-200 hover:scale-[1.01] active:scale-[0.99] transition-all text-base"
              >
                Browse All Plans
              </button>
              {joinUrl && (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="px-9 py-4 rounded-2xl font-semibold text-zinc-950 bg-emerald-500 hover:bg-emerald-400 transition-colors text-base text-center"
                >
                  Join our Discord
                </a>
              )}
            </div>
          </div>
        </div>
      </motion.section>

      {animate && <ScrollProgress />}
    </motion.div>
  );
};
