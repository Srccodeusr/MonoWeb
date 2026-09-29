import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { useBranding } from '../../lib/BrandingContext';

/* ============================================================================
   Shared scroll clock
   One passive scroll listener + one rAF for every scroll-linked effect on the page. Listeners get the
   scroll position and only ever WRITE transforms/opacity (no layout reads that depend on earlier writes),
   so scrolling stays on the compositor and never thrashes layout.
   ========================================================================== */
type ScrollListener = (y: number) => void;

const listeners = new Set<ScrollListener>();
let framePending = 0;
let lastY = -1;
let bound = false;

const run = () => {
  framePending = 0;
  const y = window.scrollY;
  if (y === lastY) return;
  lastY = y;
  listeners.forEach(fn => fn(y));
};
const schedule = () => { if (!framePending) framePending = requestAnimationFrame(run); };
const onResize = () => { lastY = -1; schedule(); };

/** Run all scroll listeners right now (the smooth-wheel loop calls this so effects move in lockstep with the page). */
export function flushScrollFx() {
  if (framePending) { cancelAnimationFrame(framePending); framePending = 0; }
  run();
}

function subscribeScroll(fn: ScrollListener) {
  listeners.add(fn);
  if (!bound) {
    bound = true;
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
  }
  lastY = -1;
  schedule();
  return () => {
    listeners.delete(fn);
    if (!listeners.size && bound) {
      bound = false;
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onResize);
      if (framePending) { cancelAnimationFrame(framePending); framePending = 0; }
    }
  };
}

/* ============================================================================
   Reveal
   Transitions are pure CSS (opacity + transform only, see `.fx-reveal` in index.css) so they run on the
   compositor. One shared IntersectionObserver flips a class the first time an element scrolls into view.
   ========================================================================== */
const revealCallbacks = new WeakMap<Element, () => void>();
let revealObserver: IntersectionObserver | null = null;

function onceInView(el: Element, cb: () => void) {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        // also reveal anything already scrolled past (deep-link / restored scroll position)
        if (!entry.isIntersecting && entry.boundingClientRect.top >= 0) continue;
        revealObserver!.unobserve(entry.target);
        const fn = revealCallbacks.get(entry.target);
        revealCallbacks.delete(entry.target);
        fn?.();
      }
    }, { rootMargin: '0px 0px -12% 0px' });
  }
  revealCallbacks.set(el, cb);
  revealObserver.observe(el);
  return () => { revealCallbacks.delete(el); revealObserver?.unobserve(el); };
}

/* Scroll-linked depth drift: a single batched read pass, then a single write pass, only for elements near the viewport. */
interface Drift { outer: HTMLElement; inner: HTMLElement; speed: number; visible: boolean }

const drifters = new Map<Element, Drift>();
let driftObserver: IntersectionObserver | null = null;
let driftUnsubscribe: (() => void) | null = null;

const applyDrift = () => {
  const vh = window.innerHeight;
  const active: Drift[] = [];
  const offsets: number[] = [];
  drifters.forEach(d => {
    if (!d.visible) return;
    const r = d.outer.getBoundingClientRect();
    active.push(d);
    offsets.push(d.speed * 70 * (1 - 2 * ((vh - r.top) / (vh + r.height))));
  });
  for (let i = 0; i < active.length; i++) {
    active[i].inner.style.transform = `translate3d(0,${offsets[i].toFixed(2)}px,0)`;
  }
};

function registerDrift(outer: HTMLElement, inner: HTMLElement, speed: number) {
  if (!driftObserver) {
    driftObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const d = drifters.get(entry.target);
        if (d) d.visible = entry.isIntersecting;
      }
      applyDrift();
    }, { rootMargin: '25% 0px' });
  }
  drifters.set(outer, { outer, inner, speed, visible: false });
  driftObserver.observe(outer);
  if (!driftUnsubscribe) driftUnsubscribe = subscribeScroll(applyDrift);
  return () => {
    drifters.delete(outer);
    driftObserver?.unobserve(outer);
    inner.style.transform = '';
    if (!drifters.size && driftUnsubscribe) { driftUnsubscribe(); driftUnsubscribe = null; }
  };
}

/** 3D tilt-in reveal the first time an element scrolls into view; `speed` adds scroll-linked depth drift. */
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
  const outerRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const off = !pageAnimationsEnabled || !!reduce;

  useEffect(() => {
    const outer = outerRef.current;
    if (off || !outer) return;
    const stopReveal = onceInView(outer, () => outer.classList.add('is-in'));
    const stopDrift = speed && innerRef.current ? registerDrift(outer, innerRef.current, speed) : undefined;
    return () => { stopReveal(); stopDrift?.(); };
  }, [off, speed]);

  if (off) return React.createElement(as, { className }, children);

  const Tag: any = as;
  return (
    <Tag
      ref={outerRef}
      className={className ? `fx-reveal ${className}` : 'fx-reveal'}
      style={{ '--fx-delay': `${delay}s`, '--fx-y': `${y}px` } as React.CSSProperties}
      onTransitionEnd={(e: React.TransitionEvent<HTMLElement>) => {
        // release the compositor hint once the entrance has finished
        if (e.target === e.currentTarget && e.propertyName === 'transform') e.currentTarget.classList.add('is-done');
      }}
    >
      {speed ? <div ref={innerRef} className="fx-drift h-full">{children}</div> : children}
    </Tag>
  );
};

/* ============================================================================
   Reading-progress bar — transform only, driven straight from the scroll clock (no springs, no re-renders).
   ========================================================================== */
export const ScrollProgress: React.FC = React.memo(function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    const head = headRef.current;
    if (!bar || !head) return;
    const root = document.documentElement;
    return subscribeScroll(y => {
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, y / max));
      bar.style.transform = `scaleX(${p.toFixed(4)})`;
      head.style.transform = `translate3d(${(p * window.innerWidth - 5).toFixed(1)}px,-50%,0)`;
    });
  }, []);

  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[45] h-[3px] w-full">
      <div
        ref={barRef}
        style={{ transform: 'scaleX(0)', transformOrigin: '0 50%', willChange: 'transform' }}
        className="h-full w-full bg-gradient-to-r from-transparent via-blue-500 to-white"
      />
      <span
        ref={headRef}
        style={{ transform: 'translate3d(-5px,-50%,0)', willChange: 'transform' }}
        className="absolute left-0 top-1/2 h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_14px_5px_rgba(96,165,250,0.9)]"
      />
    </div>,
    document.body
  );
});

/* ============================================================================
   Hero: parallax + pause-when-offscreen
   The hero is one big composited layer. While it is on screen its transform/opacity are written straight
   from the scroll clock; once it leaves the viewport all of its CSS animations are paused (`.is-offscreen`)
   so nothing keeps repainting behind the page you are actually looking at.
   ========================================================================== */
export function useHeroScroll(
  wrapRef: React.RefObject<HTMLElement | null>,
  layerRef: React.RefObject<HTMLElement | null>,
  parallax: boolean
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const layer = parallax ? layerRef.current : null;
    let visible = true;

    const apply = () => {
      if (!layer) return;
      const r = wrap.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)));
      layer.style.transform = `translate3d(0,${(p * 0.24 * r.height).toFixed(1)}px,0) scale(${(1 + 0.1 * p).toFixed(4)})`;
      layer.style.opacity = (1 - 0.9 * Math.min(1, p / 0.85)).toFixed(3);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      wrap.classList.toggle('is-offscreen', !visible);
      apply();
    });
    io.observe(wrap);
    const stop = layer ? subscribeScroll(() => { if (visible) apply(); }) : undefined;

    return () => {
      io.disconnect();
      stop?.();
      wrap.classList.remove('is-offscreen');
      if (layer) { layer.style.transform = ''; layer.style.opacity = ''; }
    };
  }, [parallax, wrapRef, layerRef]);
}

/** Adds `html.is-scrolling` while the page is moving so expensive paint-only loops (heading shimmer) can pause. */
export function useScrollingFlag(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let on = false;
    let timer = 0;
    const onScroll = () => {
      if (!on) { on = true; root.classList.add('is-scrolling'); }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { on = false; root.classList.remove('is-scrolling'); }, 140);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      root.classList.remove('is-scrolling');
    };
  }, [enabled]);
}

/* ============================================================================
   Inertial mouse-wheel scrolling
   The wheel moves a target and the page eases toward it. Time-based easing (identical feel at 60/120/144 Hz),
   no layout reads inside the frame loop, and it hands control straight back if anything else scrolls the page
   (route change, keyboard, scrollbar drag, anchor jump) instead of fighting it.
   Touch devices, open menus/modals and nested scroll areas keep native scrolling.
   ========================================================================== */
const EASE_TAU_MS = 95; // how quickly the page catches up with the wheel (lower = snappier)

export function useSmoothWheel(enabled: boolean) {
  useEffect(() => {
    if (!enabled || window.matchMedia('(pointer: coarse)').matches) return;

    const root = document.documentElement;
    let target = window.scrollY;
    let pos = target;
    let written = target;
    let maxY = 0;
    let raf = 0;
    let prev = 0;

    // nested-scroller probe, cached briefly so a wheel burst over the same element costs one style lookup
    let probeEl: EventTarget | null = null;
    let probeHit = false;
    let probeAt = 0;

    const measure = () => { maxY = Math.max(0, root.scrollHeight - window.innerHeight); };
    const snap = (v: number) => { const dpr = window.devicePixelRatio || 1; return Math.round(v * dpr) / dpr; };

    const inNestedScroller = (start: EventTarget | null) => {
      const now = performance.now();
      if (start === probeEl && now - probeAt < 250) { probeAt = now; return probeHit; }
      let hit = false;
      let el = start as HTMLElement | null;
      while (el && el !== document.body && el !== root) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') { hit = true; break; }
        }
        el = el.parentElement;
      }
      probeEl = start; probeHit = hit; probeAt = now;
      return hit;
    };

    const tick = (now: number) => {
      // something else moved the page (route change, keyboard, scrollbar drag…): let go and resync
      if (Math.abs(window.scrollY - written) > 2) { raf = 0; return; }

      const dt = prev ? Math.min(Math.max(now - prev, 0), 64) : 16.7;
      prev = now;
      pos += (target - pos) * (1 - Math.exp(-dt / EASE_TAU_MS));
      const settled = Math.abs(target - pos) < 0.4;
      if (settled) pos = target;

      written = snap(pos);
      window.scrollTo({ top: written, behavior: 'instant' as ScrollBehavior });
      flushScrollFx();
      raf = settled ? 0 : requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || e.deltaY === 0) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (root.style.overflow === 'hidden' || document.body.style.overflow === 'hidden') return;
      if (inNestedScroller(e.target)) return;

      e.preventDefault();
      if (!raf) {
        measure();
        pos = target = written = window.scrollY;
        prev = 0;
        raf = requestAnimationFrame(tick);
      }
      const unit = e.deltaMode === 1 ? 34 : e.deltaMode === 2 ? window.innerHeight : 1;
      target = Math.max(0, Math.min(maxY, target + e.deltaY * unit));
    };

    const onScroll = () => { if (!raf) pos = target = written = window.scrollY; };

    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(document.body);
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
}
