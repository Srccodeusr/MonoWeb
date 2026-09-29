import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';

/** 3D tilt-in reveal (spring + blur) the first time an element scrolls into view; `speed` adds scroll-linked depth drift. */
export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  y?: number;
  speed?: number;
  className?: string;
  as?: 'div' | 'li';
}> = ({ children, delay = 0, y = 72, speed = 0, className, as = 'div' }) => {
  const { pageAnimationsEnabled } = useBranding();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const drift = useSpring(useTransform(scrollYProgress, [0, 1], [speed * 70, speed * -70]), { stiffness: 90, damping: 26 });
  const Tag = motion[as] as any;
  if (!pageAnimationsEnabled || reduce) return React.createElement(as, { className }, children);
  return (
    <Tag
      ref={ref}
      className={className}
      style={{ transformPerspective: 1100 }}
      initial={{ opacity: 0, y, rotateX: 14, scale: 0.94, filter: 'blur(14px)' }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '0px 0px -14% 0px' }}
      transition={{ type: 'spring', stiffness: 70, damping: 18, delay, opacity: { duration: 0.7, delay }, filter: { duration: 0.8, delay } }}
    >
      {speed ? <motion.div style={{ y: drift }} className="h-full">{children}</motion.div> : children}
    </Tag>
  );
};

/** Spring-smoothed reading-progress bar with a glowing head. */
export const ScrollProgress: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });
  const left = useTransform(p, v => `${v * 100}%`);
  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[45] h-[3px] w-full">
      <motion.div style={{ scaleX: p, transformOrigin: '0 50%' }} className="h-full w-full bg-gradient-to-r from-transparent via-blue-500 to-white" />
      <motion.span style={{ left }} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_5px_rgba(96,165,250,0.9)]" />
    </div>,
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
