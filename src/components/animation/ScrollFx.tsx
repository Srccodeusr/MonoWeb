import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';

/** Fades, lifts and un-blurs its children the first time they scroll into view. */
export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: 'div' | 'li';
}> = ({ children, delay = 0, y = 56, className, as = 'div' }) => {
  const { pageAnimationsEnabled } = useBranding();
  const reduce = useReducedMotion();
  const Tag = motion[as];
  if (!pageAnimationsEnabled || reduce) return React.createElement(as, { className }, children);
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y, scale: 0.96, filter: 'blur(12px)' }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Tag>
  );
};

/** Thin spring-smoothed reading-progress bar pinned to the top of the screen. */
export const ScrollProgress: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });
  return createPortal(
    <motion.div
      aria-hidden="true"
      style={{ scaleX, transformOrigin: '0 50%' }}
      className="fixed left-0 top-0 z-[45] h-[3px] w-full bg-gradient-to-r from-zinc-500 via-white to-blue-400"
    />,
    document.body
  );
};

/**
 * Inertial mouse-wheel scrolling: the wheel sets a target and the page eases toward it.
 * Touch, trackpad-free devices, open menus and nested scroll areas keep native scrolling.
 */
export function useSmoothWheel(enabled: boolean) {
  useEffect(() => {
    if (!enabled || window.matchMedia('(pointer: coarse)').matches) return;
    let target = window.scrollY;
    let pos = target;
    let raf = 0;
    const max = () => document.documentElement.scrollHeight - window.innerHeight;

    const tick = () => {
      pos += (target - pos) * 0.085;
      if (Math.abs(target - pos) < 0.5) { pos = target; raf = 0; } else raf = requestAnimationFrame(tick);
      window.scrollTo({ top: pos, behavior: 'instant' as ScrollBehavior });
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || document.documentElement.style.overflow === 'hidden') return;
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return;
        el = el.parentElement;
      }
      e.preventDefault();
      if (!raf) { pos = window.scrollY; target = pos; }
      target = Math.max(0, Math.min(max(), target + e.deltaY * (e.deltaMode === 1 ? 34 : 1)));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onScroll = () => { if (!raf) { pos = window.scrollY; target = pos; } };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
}
