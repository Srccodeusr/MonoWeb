import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Compass, Server, Tag } from 'lucide-react';
import { motion } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';
import { routeToUrl } from '../../lib/routing';

interface NotFoundProps {
  onNavigate: (page: string) => void;
}

const QUICK_LINKS = [
  { page: 'bot', label: 'Bot Hosting', description: '24/7 hosting for your Discord bots.', Icon: Bot },
  { page: 'vps', label: 'VPS Hosting', description: 'Full root access, any OS image.', Icon: Server },
  { page: 'pricing', label: 'Pricing', description: 'Every plan and what it costs.', Icon: Tag }
] as const;

export const NotFound: React.FC<NotFoundProps> = ({ onNavigate }) => {
  const { pageAnimationsEnabled, brandName } = useBranding();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Tab title reflects the error and is restored when the visitor leaves this page
  useEffect(() => {
    const previousTitle = document.title;
    document.title = brandName ? `Page not found — ${brandName}` : 'Page not found';
    return () => {
      document.title = previousTitle;
    };
  }, [brandName]);

  // Move focus to the heading so screen readers announce the new "page"
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // Real <a href> links (middle-click / copy link work); plain clicks navigate inside the SPA
  const handleLinkClick = (page: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(page);
  };

  const animate = pageAnimationsEnabled && !prefersReducedMotion;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 120, damping: 18, mass: 0.8 } }
  };

  const motionDivProps = animate ? { variants: containerVariants, initial: 'hidden', animate: 'visible' } : {};
  const motionChildProps = animate ? { variants: itemVariants } : {};

  return (
    <motion.div
      {...motionDivProps}
      className="relative isolate flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-10 sm:py-16"
    >
      {/* Soft ambient glow (same as the home hero) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] sm:w-[900px] h-[480px] rounded-full opacity-30 blur-[160px]"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 45%, rgba(0,0,0,0) 70%)' }}
        />
      </div>

      <div className="mx-auto w-full max-w-3xl text-center">
        <motion.div {...motionChildProps} className="space-y-3 sm:space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-semibold text-zinc-100 backdrop-blur-sm">
            <Compass className="h-3.5 w-3.5 shrink-0" />
            <span>Error 404</span>
          </div>

          <div
            aria-hidden="true"
            className="select-none font-display font-bold leading-none tracking-tighter text-[7.5rem] sm:text-[11rem] bg-gradient-to-b from-white via-zinc-400 to-zinc-900 bg-clip-text text-transparent"
          >
            404
          </div>
        </motion.div>

        <motion.div {...motionChildProps} className="space-y-4 -mt-3 sm:-mt-5">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white font-display leading-[1.1] outline-none"
          >
            We couldn&rsquo;t find that page.
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
            The link may be broken, or the page may have moved. Head back home, or pick up from one of these.
          </p>
        </motion.div>

        <motion.div {...motionChildProps} className="flex items-center justify-center pt-6 sm:pt-7">
          <a
            href={routeToUrl('home')}
            onClick={handleLinkClick('home')}
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl font-semibold text-zinc-950 bg-white hover:bg-zinc-200 shadow-lg shadow-black/30 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </a>
        </motion.div>

        <motion.nav
          {...motionChildProps}
          aria-label="Popular pages"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-10 sm:pt-12 text-left"
        >
          {QUICK_LINKS.map(({ page, label, description, Icon }) => (
            <a
              key={page}
              href={routeToUrl(page)}
              onClick={handleLinkClick(page)}
              className="group flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 backdrop-blur-sm transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900/70 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 border border-white/15 text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-zinc-600 transition-all group-hover:text-white group-hover:translate-x-0.5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white font-display">{label}</h2>
                <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
              </div>
            </a>
          ))}
        </motion.nav>
      </div>
    </motion.div>
  );
};
