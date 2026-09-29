import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useAnimationControls, useMotionValue, useScroll, useSpring, useTransform, useVelocity } from 'motion/react';

/**
 * MonoBot — the little assistant. It drops into the hero, stands up, says hi, then follows the page:
 * every element with data-mascot="<key>" makes it hop to that section's side and do that section's action.
 * Edit STOPS to change the side, action or speech line of a section.
 */
type Act = 'wave' | 'shop' | 'steps' | 'chart' | 'wrench' | 'code' | 'think' | 'rocket';
type Pose = Act | 'idle' | 'fall' | 'lie';
interface Stop { side: 'left' | 'right'; act: Act; say: string }

export const STOPS: Record<string, Stop> = {
  hero: { side: 'right', act: 'wave', say: 'Hi! Welcome to MonoNode 👋' },
  products: { side: 'left', act: 'shop', say: 'Shopping for the perfect plan…' },
  steps: { side: 'right', act: 'steps', say: 'Just three easy steps!' },
  stats: { side: 'left', act: 'chart', say: '99.99% uptime. Numbers go up!' },
  infra: { side: 'right', act: 'wrench', say: 'Keeping everything running.' },
  runtimes: { side: 'left', act: 'code', say: 'Bring your code, I’ll run it.' },
  faq: { side: 'right', act: 'think', say: 'Got questions? Ask away!' },
  cta: { side: 'left', act: 'rocket', say: 'Ready to launch? 🚀' }
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const CARDS = [['#3b82f6', '#1d4ed8'], ['#8b5cf6', '#6d28d9'], ['#10b981', '#047857']];

const Robot: React.FC<{ pose: Pose; walking: boolean; face: 1 | -1 }> = ({ pose, walking, face }) => (
  <svg viewBox="0 0 150 160" className="bot" data-act={pose} data-walk={walking} style={{ transform: `scaleX(${face})` }}>
    <defs>
      <linearGradient id="mb-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fafafa" /><stop offset="1" stopColor="#a1a1aa" /></linearGradient>
      <clipPath id="mb-tab"><rect x="70" y="77" width="42" height="52" rx="4" /></clipPath>
    </defs>
    <ellipse cx="48" cy="152" rx="28" ry="5" fill="rgba(0,0,0,.4)" />
    <g className="fig">
      <g className="leg-l"><rect x="34" y="112" width="11" height="30" rx="5.5" fill="#d4d4d8" /><rect x="30" y="138" width="18" height="9" rx="4.5" fill="#71717a" /></g>
      <g className="leg-r"><rect x="51" y="112" width="11" height="30" rx="5.5" fill="#e4e4e7" /><rect x="48" y="138" width="18" height="9" rx="4.5" fill="#71717a" /></g>
      <g className="arm-l"><rect x="15" y="76" width="10" height="30" rx="5" fill="#d4d4d8" /><circle cx="20" cy="107" r="6" fill="#71717a" /></g>
      <rect x="24" y="70" width="48" height="46" rx="17" fill="url(#mb-g)" />
      <rect x="35" y="83" width="26" height="18" rx="7" fill="#0b0b10" />
      <circle cx="48" cy="92" r="4.5" fill="#60a5fa" className="ant" />
      <g className="head">
        <rect x="41" y="62" width="14" height="10" fill="#71717a" />
        <rect x="8" y="30" width="9" height="16" rx="4" fill="#a1a1aa" /><rect x="79" y="30" width="9" height="16" rx="4" fill="#a1a1aa" />
        <line x1="48" y1="13" x2="48" y2="3" stroke="#a1a1aa" strokeWidth="3" strokeLinecap="round" /><circle cx="48" cy="3" r="4" fill="#60a5fa" className="ant" />
        <rect x="14" y="12" width="68" height="54" rx="22" fill="url(#mb-g)" />
        <rect x="21" y="21" width="54" height="36" rx="15" fill="#0b0b10" />
        <ellipse className="eye" cx="37" cy="38" rx="5" ry="7" fill="#7dd3fc" /><ellipse className="eye" cx="59" cy="38" rx="5" ry="7" fill="#7dd3fc" />
        <circle cx="28" cy="47" r="3" fill="#f472b6" opacity=".55" /><circle cx="68" cy="47" r="3" fill="#f472b6" opacity=".55" />
        <path d="M42 47q6 6 12 0" stroke="#7dd3fc" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </g>
      <g className="arm-r"><rect x="71" y="76" width="10" height="30" rx="5" fill="#e4e4e7" /><circle cx="76" cy="107" r="6" fill="#71717a" /></g>
    </g>

    {pose === 'shop' && (
      <g>
        <rect x="66" y="72" width="50" height="62" rx="7" fill="#18181b" stroke="#a1a1aa" strokeWidth="2" />
        <g clipPath="url(#mb-tab)">
          <rect x="70" y="77" width="42" height="52" fill="#0f172a" />
          <g className="tab-scroll">
            {[...CARDS, ...CARDS].map(([a, b], i) => (
              <g key={i} transform={`translate(0 ${79 + i * 46})`}>
                <rect x="73" y="0" width="36" height="42" rx="4" fill="#1e293b" />
                <rect x="76" y="3" width="30" height="21" rx="3" fill={a} /><rect x="76" y="14" width="30" height="10" rx="3" fill={b} opacity=".55" />
                <rect x="85" y="10" width="12" height="9" rx="2" fill="#fff" /><path d="M88 10v-2a3 3 0 0 1 6 0v2" stroke="#fff" strokeWidth="1.6" fill="none" />
                <rect x="76" y="28" width="18" height="3.5" rx="1.7" fill="#e4e4e7" /><rect x="76" y="34" width="14" height="5" rx="2.5" fill="#3b82f6" />
              </g>
            ))}
          </g>
        </g>
        <circle className="cart-pop" cx="114" cy="74" r="8" fill="#22c55e" /><path d="M110.5 72h2l1.2 4h3.6l1-3h-6" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      </g>
    )}
    {pose === 'steps' && (
      <g>
        <rect x="78" y="68" width="44" height="60" rx="5" fill="#f4f4f5" /><rect x="91" y="64" width="18" height="8" rx="3" fill="#71717a" />
        {[82, 96, 110].map((y, i) => (
          <g key={y}>
            <rect x="84" y={y} width="9" height="9" rx="2" fill="#fff" stroke="#71717a" />
            <path className="tick" style={{ animationDelay: `${i * 0.9}s` }} d={`M85.5 ${y + 4.5}l2.5 2.5l4.5-5`} stroke="#16a34a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <rect x="97" y={y + 2.5} width="20" height="3.5" rx="1.7" fill="#a1a1aa" />
          </g>
        ))}
      </g>
    )}
    {pose === 'chart' && (
      <g>
        <rect x="74" y="68" width="58" height="52" rx="6" fill="#18181b" stroke="#52525b" />
        {[14, 22, 30, 40].map((h, i) => <rect key={i} className="bar" style={{ animationDelay: `${i * 0.18}s` }} x={82 + i * 12} y={112 - h} width="8" height={h} rx="2" fill="#4ade80" />)}
        <path d="M80 98L96 90L104 94L124 76" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    )}
    {pose === 'wrench' && (
      <g>
        <g className="wrench"><rect x="99" y="62" width="6" height="34" rx="3" fill="#d4d4d8" /><circle cx="102" cy="58" r="8" fill="#d4d4d8" /><rect x="99.5" y="48" width="5" height="8" rx="1.5" fill="#3f3f46" /></g>
        <circle className="gear" cx="124" cy="114" r="9" fill="none" stroke="#a1a1aa" strokeWidth="5" strokeDasharray="4.2 3" /><circle cx="124" cy="114" r="6" fill="#71717a" />
        {[0, 1, 2].map(i => <circle key={i} className="spark" style={{ animationDelay: `${i * 0.23}s` }} cx={110 + i * 4} cy="52" r="1.8" fill="#fbbf24" />)}
      </g>
    )}
    {pose === 'code' && (
      <g>
        <rect x="64" y="118" width="66" height="6" rx="3" fill="#a1a1aa" />
        <rect x="70" y="84" width="54" height="36" rx="4" fill="#0b0b10" stroke="#71717a" strokeWidth="2" />
        {[['#60a5fa', 30], ['#4ade80', 22], ['#c084fc', 36], ['#fbbf24', 16]].map(([c, w], i) => (
          <rect key={i} className="ln" style={{ animationDelay: `${i * 0.5}s` }} x={76 + (i % 2) * 6} y={90 + i * 7} width={w as number} height="3.5" rx="1.7" fill={c as string} />
        ))}
      </g>
    )}
    {pose === 'rocket' && (
      <g className="rocket">
        <path className="flame" d="M117 124q5 16 10 0z" fill="#f97316" />
        <path d="M112 118l-7 11l7-3zM132 118l7 11l-7-3z" fill="#ef4444" />
        <path d="M122 92q10 12 10 32h-20q0-20 10-32z" fill="#f4f4f5" /><circle cx="122" cy="108" r="3.6" fill="#3b82f6" />
      </g>
    )}
  </svg>
);

export const Mascot: React.FC = () => {
  const [size, setSize] = useState(() => (window.innerWidth < 640 ? 122 : 150));
  const [pose, setPose] = useState<Pose>('fall');
  const [face, setFace] = useState<1 | -1>(-1);
  const [walking, setWalking] = useState(false);
  const [say, setSay] = useState('');
  const [side, setSide] = useState<'left' | 'right'>('right');

  const x = useMotionValue(-999);
  const top = useMotionValue(0);
  const topSpring = useSpring(top, { stiffness: 55, damping: 16, mass: 0.9 });
  const { scrollY } = useScroll();
  const vel = useSpring(useVelocity(scrollY), { stiffness: 160, damping: 38 });
  const lean = useTransform(vel, [-2600, 0, 2600], [-7, 0, 7]);
  const stretch = useTransform(vel, [-2600, 0, 2600], [1.07, 1, 1.07]);
  const hop = useAnimationControls();
  const st = useRef({ key: '', want: '', busy: false, ready: false, side: 'right' as 'left' | 'right', size });
  st.current.size = size;

  useEffect(() => {
    if (!say) return;
    const t = setTimeout(() => setSay(''), say.startsWith('Hi!') ? 7000 : 4200);
    return () => clearTimeout(t);
  }, [say]);

  useEffect(() => {
    const s = st.current;
    let dead = false;
    const edge = (sd: 'left' | 'right') => {
      const pad = window.innerWidth < 640 ? 2 : 26;
      return sd === 'left' ? pad : window.innerWidth - s.size - pad;
    };
    // which section is under the reading line, and how far through it we are
    const locate = () => {
      const vh = window.innerHeight, h = s.size * 1.07, line = vh * 0.55;
      let key = 'hero', p = 0;
      document.querySelectorAll<HTMLElement>('[data-mascot]').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top <= line) { key = el.dataset.mascot || key; p = (line - r.top) / Math.max(r.height, 1); }
      });
      p = Math.min(1, Math.max(0, p));
      return { key, top: Math.min(vh - h - 16, Math.max(76, vh * 0.36 + p * (vh - h - 24 - vh * 0.36))) };
    };

    const go = async (key: string): Promise<void> => {
      const stop = STOPS[key];
      if (!stop || dead) return;
      if (s.busy) { s.want = key; return; }
      s.busy = true; s.key = key; setSay('');
      const tx = edge(stop.side), dx = tx - x.get();
      if (Math.abs(dx) > 4) {
        const dir: 1 | -1 = dx > 0 ? 1 : -1;
        setFace(dir); setPose('idle'); setWalking(true);
        await Promise.all([
          animate(x, tx, { duration: 1.3, ease: [0.65, 0, 0.35, 1] }),
          hop.start({
            y: [0, -96, 0], rotate: [0, dir * 12, 0],
            transition: { y: { duration: 1.3, times: [0, 0.5, 1], ease: ['easeOut', 'easeIn'] }, rotate: { duration: 1.3, times: [0, 0.5, 1] } }
          })
        ]);
        setWalking(false);
      } else {
        await hop.start({ y: [0, -24, 0], transition: { duration: 0.5 } });
      }
      if (dead) return;
      s.side = stop.side; setSide(stop.side);
      setFace(stop.side === 'right' ? -1 : 1); setPose(stop.act); setSay(stop.say);
      s.busy = false;
      if (s.want && s.want !== key) { const w = s.want; s.want = ''; go(w); }
    };

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const l = locate();
        top.set(l.top);
        if (s.ready && l.key !== s.key) go(l.key);
      });
    };
    const onResize = () => {
      setSize(window.innerWidth < 640 ? 122 : 150);
      requestAnimationFrame(() => x.set(edge(s.side)));
      onScroll();
    };

    (async () => {
      const l = locate();
      topSpring.jump(l.top); top.set(l.top);
      x.set(edge('right'));
      if (window.scrollY > 300) {                     // page restored mid-scroll: skip the intro
        s.key = l.key; s.ready = true; setFace(-1); setPose('idle'); go(l.key);
        return;
      }
      hop.set({ y: -(l.top + s.size * 1.07 + 80), rotate: -320 });
      setPose('fall');
      await sleep(900);
      if (dead) return;
      await hop.start({ y: 0, rotate: -90, transition: { duration: 0.85, ease: [0.55, 0, 1, 0.65] } });          // drop + tumble
      await hop.start({ y: [0, -38, 0], transition: { duration: 0.55, ease: 'easeOut' } });                        // bounce
      setPose('lie'); await sleep(750);
      if (dead) return;
      await hop.start({ rotate: [-90, 12, -5, 0], y: [0, -26, 0, 0], transition: { duration: 1, times: [0, 0.45, 0.75, 1], ease: 'easeInOut' } }); // stand up
      if (dead) return;
      setFace(-1); setPose('wave'); setSay(STOPS.hero.say);
      s.key = 'hero'; s.ready = true;
      onScroll();
    })();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      dead = true; cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const head = side === 'right' ? { right: '58%' } : { left: '58%' };
  return createPortal(
    <motion.div className="mascot" aria-hidden="true" style={{ x, y: topSpring, width: size }}>
      <AnimatePresence>
        {say && (
          <motion.div
            key={say}
            className="mascot__bubble"
            data-side={side}
            style={{ ...head, transformOrigin: side === 'right' ? '100% 60%' : '0% 60%' }}
            initial={{ opacity: 0, scale: 0.3, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: 6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 20 }}
          >
            {say}
          </motion.div>
        )}
      </AnimatePresence>
      {pose === 'think' && <span className="mascot__q" style={{ left: face === -1 ? '62%' : '26%' }}>?</span>}
      <motion.div animate={hop} style={{ transformOrigin: '50% 92%' }}>
        <motion.div style={{ rotate: lean, scaleY: stretch, transformOrigin: '50% 100%' }}>
          <Robot pose={pose} walking={walking} face={face} />
        </motion.div>
      </motion.div>
    </motion.div>,
    document.body
  );
};
