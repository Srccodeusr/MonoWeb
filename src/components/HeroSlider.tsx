import React, { useCallback, useRef, useState } from 'react';
import { ArrowRight, Bot, Cpu, Database, Pause, Play, RotateCw, Server, Sparkles, Terminal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DiscordGlyph } from './DiscordGlyph';

/**
 * Home hero slider — the big top section.
 *
 * Two slides only (Discord Bot Hosting, VPS Hosting). Each slide swaps the artwork on the right and the
 * text on the left, auto-advances, and can be changed with the tabs at the bottom, a swipe, or the arrow keys.
 *
 * Want real photos instead of the built-in artwork? Drop images into /public/hero/ and set `imageUrl`
 * on a slide below, e.g. imageUrl: '/hero/bot.jpg'. All styling lives under `.hero` in src/index.css.
 */

const SLIDE_MS = 6500;

interface HeroSliderProps {
  botPrice: number;
  vpsPrice: number;
  /** Auto-advance the slides. Turned off for reduced-motion users and when page animations are disabled. */
  autoplay: boolean;
  onNavigate: (page: string) => void;
}

interface Slide {
  id: string;
  tabLabel: string;
  TabIcon: LucideIcon;
  tag: string;
  titleTop: string;
  titleBottom: string;
  description: string;
  price: number;
  note: string;
  page: string;
  imageUrl?: string;
  art: React.ReactNode;
}

const DOTS = [
  { l: '12%', t: '20%', d: '0s' }, { l: '30%', t: '8%', d: '-1.2s' }, { l: '48%', t: '14%', d: '-2.4s' },
  { l: '70%', t: '10%', d: '-0.6s' }, { l: '88%', t: '26%', d: '-1.8s' }, { l: '6%', t: '52%', d: '-3s' },
  { l: '92%', t: '58%', d: '-0.9s' }, { l: '18%', t: '84%', d: '-2.1s' }, { l: '46%', t: '92%', d: '-1.5s' },
  { l: '74%', t: '88%', d: '-2.7s' }, { l: '60%', t: '70%', d: '-0.3s' }, { l: '34%', t: '64%', d: '-3.3s' }
];

const BotArt: React.FC = () => (
  <div className="art art--bot">
    <div className="art__glow" />
    <div className="art__ring art__ring--1" />
    <div className="art__ring art__ring--2" />
    {DOTS.map((d, i) => (
      <i key={i} className="art__dot" style={{ left: d.l, top: d.t, animationDelay: d.d }} />
    ))}
    <div className="art__stage">
      <div className="tile tile--a"><Terminal /></div>
      <div className="tile tile--b"><Cpu /></div>
      <div className="tile tile--c"><RotateCw /></div>
      <div className="tile tile--d"><Database /></div>
      <div className="tile tile--main"><DiscordGlyph /></div>
    </div>
  </div>
);

const VpsArt: React.FC = () => (
  <div className="art art--vps">
    <div className="art__glow" />
    <div className="art__ring art__ring--1" />
    {DOTS.map((d, i) => (
      <i key={i} className="art__dot" style={{ left: d.l, top: d.t, animationDelay: d.d }} />
    ))}
    <div className="art__stage art__stage--rack">
      <div className="rack">
        {[0, 1, 2, 3].map(n => (
          <div key={n} className="unit">
            <span className="unit__leds">
              <i style={{ animationDelay: `${-n * 0.7}s` }} />
              <i />
              <i />
            </span>
            <span className="unit__bays">
              {Array.from({ length: 7 }).map((_, b) => <i key={b} />)}
            </span>
            <span className="unit__pwr" />
          </div>
        ))}
      </div>
      <div className="chip chip--term"><Terminal /><span>root@vps:~$</span><b /></div>
      <div className="chip chip--spec"><Cpu /><span>vCPU + NVMe</span></div>
    </div>
  </div>
);

export const HeroSlider: React.FC<HeroSliderProps> = ({ botPrice, vpsPrice, autoplay, onNavigate }) => {
  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const slides: Slide[] = [
    {
      id: 'bot',
      tabLabel: 'Discord Bot',
      TabIcon: Bot,
      tag: 'Node.js, Python, Bun & Go — always on.',
      titleTop: 'Discord Bot',
      titleBottom: 'Hosting',
      description: 'High-performance nodes with a 24/7 process watchdog, a secrets manager and setup support included.',
      price: botPrice,
      note: 'Auto-restart • Low latency',
      page: 'bot',
      art: <BotArt />
    },
    {
      id: 'vps',
      tabLabel: 'VPS',
      TabIcon: Server,
      tag: 'Full root access, any OS image.',
      titleTop: 'VPS',
      titleBottom: 'Hosting',
      description: 'Dedicated vCPU cores, a free database and subdomain, plus routine backups and uptime monitoring.',
      price: vpsPrice,
      note: 'Root access • NVMe storage',
      page: 'vps',
      art: <VpsArt />
    }
  ];

  const count = slides.length;
  const go = useCallback((i: number) => setActive(((i % count) + count) % count), [count]);

  const paused = userPaused || hoverPaused || focusPaused;

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) go(active + (dx < 0 ? 1 : -1));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  };

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Discord Bot Hosting and VPS Hosting"
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHoverPaused(true); }}
      onPointerLeave={() => setHoverPaused(false)}
      onFocusCapture={e => { if ((e.target as HTMLElement).matches(':focus-visible')) setFocusPaused(true); }}
      onBlurCapture={() => setFocusPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={onKeyDown}
    >
      {/* Artwork (crossfades) */}
      <div className="hero__bg" aria-hidden="true">
        {slides.map((s, i) => (
          <div key={s.id} className={`hero__art${i === active ? ' is-active' : ''}`}>
            {s.imageUrl ? (
              <img className="hero__photo" src={s.imageUrl} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
            ) : (
              <div className="hero__art-inner">{s.art}</div>
            )}
          </div>
        ))}
        <div className="hero__grid" />
        <div className="hero__shade" />
      </div>

      {/* Text (swaps with the artwork) */}
      <div className="hero__content">
        <div className="hero__stage" aria-live={paused ? 'polite' : 'off'}>
          {slides.map((s, i) => (
            <div
              key={s.id}
              className={`hero__slide${i === active ? ' is-active' : ''}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== active}
            >
              <p className="hero__tag"><Sparkles aria-hidden="true" />{s.tag}</p>
              <h1 className="hero__title">
                <span className="hero__title-line">{s.titleTop}</span>
                <span className={`hero__title-accent${autoplay ? ' mono-heading-shimmer' : ' hero__title-accent--plain'}`}>{s.titleBottom}</span>
              </h1>
              <p className="hero__desc">{s.description}</p>
              <div className="hero__price">
                <div>
                  <small>Starts at</small>
                  <strong>${s.price.toFixed(2)}<span>/mo</span></strong>
                </div>
                <em>{s.note}</em>
              </div>
              <div className="hero__cta">
                <button type="button" className="hero__btn hero__btn--primary" onClick={() => onNavigate(s.page)}>
                  Deploy
                </button>
                <button type="button" className="hero__btn hero__btn--ghost" onClick={() => onNavigate('pricing')}>
                  View Plans <ArrowRight aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs + progress */}
      <nav className="hero__nav" aria-label="Choose a hosting product">
        <div className="hero__nav-inner">
          {slides.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={s.id}
                type="button"
                className="hero__tab"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => go(i)}
              >
                <s.TabIcon aria-hidden="true" />
                <span>{s.tabLabel}</span>
                <span className="hero__bar" aria-hidden="true">
                  {isActive && (
                    <span
                      className={`hero__bar-fill${autoplay ? '' : ' is-static'}`}
                      style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                      onAnimationEnd={() => go(active + 1)}
                    />
                  )}
                </span>
              </button>
            );
          })}
          {autoplay && (
            <button
              type="button"
              className="hero__pause"
              onClick={() => setUserPaused(p => !p)}
              aria-label={userPaused ? 'Play slideshow' : 'Pause slideshow'}
            >
              {userPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
          )}
        </div>
      </nav>
    </section>
  );
};
