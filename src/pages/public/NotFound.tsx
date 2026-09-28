import React, { useEffect, useState } from 'react';
import { Compass, Bot, Server, Tag, ArrowRight, Home as HomeIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';

interface NotFoundProps {
  onNavigate: (page: string) => void;
  /** The raw pathname that didn't match any route, if known (e.g. "/old-page"). */
  attemptedPath?: string;
}

const QUICK_LINKS = [
  { page: 'bot', label: 'Bot Hosting', icon: Bot },
  { page: 'vps', label: 'VPS Hosting', icon: Server },
  { page: 'pricing', label: 'Pricing', icon: Tag },
] as const;

export const NotFound: React.FC<NotFoundProps> = ({ onNavigate, attemptedPath }) => {
  const { pageAnimationsEnabled, brandName } = useBranding();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

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
    <motion.div {...motionDivProps} className="relative isolate flex-1 flex flex-col">
      <section className="relative flex-1 flex items-center px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
        {/* Soft ambient glow, matching the Home hero */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
          <div
            className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] sm:w-[900px] h-[480px] rounded-full opacity-30 blur-[160px]"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 45%, rgba(0,0,0,0) 70%)' }}
          />
        </div>

        <div className="mx-auto max-w-[640px] w-full text-center space-y-6">
          <motion.div {...motionChildProps} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-semibold text-zinc-100 backdrop-blur-sm">
            <Compass className="h-3.5 w-3.5 shrink-0" />
            <span>Error 404</span>
          </motion.div>

          <motion.h1 {...motionChildProps} className="font-display font-bold tracking-tight leading-[0.95] text-7xl sm:text-8xl bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
            404
          </motion.h1>

          <motion.h2 {...motionChildProps} className="text-2xl sm:text-3xl font-bold text-white font-display leading-tight">
            Lost in the network.
          </motion.h2>

          <motion.p {...motionChildProps} className="text-sm sm:text-base text-zinc-400 max-w-md mx-auto leading-relaxed">
            This page doesn't exist on {brandName || 'this platform'} &mdash; it may have been moved, renamed, or the link
            might just be off. Let's get you back on track.
          </motion.p>

          {attemptedPath && (
            <motion.p {...motionChildProps} className="text-[11px] text-zinc-600 font-mono break-all">
              Requested: <span className="text-zinc-500">{attemptedPath}</span>
            </motion.p>
          )}

          <motion.div {...motionChildProps} className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
            <button
              onClick={() => onNavigate('home')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl font-semibold text-zinc-950 bg-white hover:bg-zinc-200 shadow-lg shadow-black/30 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm"
            >
              <HomeIcon className="h-4 w-4" />
              Back to Home
            </button>
          </motion.div>

          <motion.div {...motionChildProps} className="pt-6 border-t border-zinc-800/80">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
              Or try one of these
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {QUICK_LINKS.map(({ page, label, icon: Icon }) => (
                <button
                  key={page}
                  onClick={() => onNavigate(page)}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm text-zinc-300 bg-zinc-900/60 border border-zinc-800 hover:border-zinc-600 hover:text-white hover:bg-zinc-900 transition-all flex items-center gap-2"
                >
                  <Icon className="h-4 w-4 text-zinc-500" />
                  {label}
                  <ArrowRight className="h-3.5 w-3.5 text-zinc-600" />
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>
    </motion.div>
  );
};
