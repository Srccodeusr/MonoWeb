import React, { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useTheme } from '../lib/ThemeContext';
import { AdPlacement } from '../types';

interface PublicAd {
  id: string; title: string; description?: string; imageUrl?: string; destinationUrl: string;
  type: string; ctaLabel?: string; badge?: string; frequencyCapPerSession?: number;
}

interface AdBannerProps { placement: AdPlacement; className?: string; max?: number }

/**
 * Renders the admin-configured ads for a placement (banners, images, cards).
 * The API already hides ads for premium users and when ads are globally off, so an empty list renders nothing.
 * Destinations are plain <a> links (validated http(s) or same-site paths on the server): no JS navigation, no XSS vector.
 */
export const AdBanner: React.FC<AdBannerProps> = ({ placement, className = '', max = 1 }) => {
  const { adsEnabled } = useTheme();
  const [ads, setAds] = useState<PublicAd[]>([]);
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    if (!adsEnabled) return;
    let alive = true;
    (async () => {
      try {
        const res: any = await apiRequest(`/ads?placement=${encodeURIComponent(placement)}`);
        if (!alive || !res.success || !Array.isArray(res.ads)) return;
        const picked: PublicAd[] = [];
        for (const a of res.ads as PublicAd[]) {
          const key = `ad_seen_${a.id}`;
          const seen = Number(sessionStorage.getItem(key) || 0);
          if (a.frequencyCapPerSession && seen >= a.frequencyCapPerSession) continue;
          picked.push(a);
          if (picked.length >= max) break;
        }
        picked.forEach(a => {
          const key = `ad_seen_${a.id}`;
          sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || 0) + 1));
          apiRequest(`/ads/${a.id}/impression`, { method: 'POST' }).catch(() => undefined);
        });
        setAds(picked);
      } catch { /* ads are non-critical */ }
    })();
    return () => { alive = false; };
  }, [placement, adsEnabled, max]);

  const visible = ads.filter(a => !closed.includes(a.id));
  if (!adsEnabled || visible.length === 0) return null;

  const external = (u: string) => /^https?:\/\//.test(u);
  const track = (id: string) => { apiRequest(`/ads/${id}/click`, { method: 'POST' }).catch(() => undefined); };

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {visible.map(ad => {
        const linkProps = { href: ad.destinationUrl, onClick: () => track(ad.id), ...(external(ad.destinationUrl) ? { target: '_blank', rel: 'noopener noreferrer sponsored' } : {}) };
        if (ad.imageUrl && (ad.type === 'image' || ad.type === 'banner' || !ad.description)) {
          return (
            <div key={ad.id} className="relative max-w-full group">
              <a {...linkProps} className="block" aria-label={ad.title}>
                <img src={ad.imageUrl} alt={ad.title} loading="lazy" className="max-h-24 sm:max-h-28 w-auto max-w-full rounded-xl border border-zinc-800 object-contain bg-zinc-900" />
              </a>
              <span className="absolute top-1 left-1 px-1.5 py-px rounded bg-black/60 text-[9px] font-mono text-zinc-300">{ad.badge || 'AD'}</span>
              <button onClick={() => setClosed(c => [...c, ad.id])} className="absolute top-1 right-1 h-5 w-5 rounded bg-black/60 text-zinc-300 text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Hide ad">×</button>
            </div>
          );
        }
        return (
          <a key={ad.id} {...linkProps} className="w-full flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:border-amber-500/40 px-4 py-3 transition-colors">
            {ad.imageUrl && <img src={ad.imageUrl} alt="" loading="lazy" className="h-10 w-10 rounded-lg object-cover shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100 truncate flex items-center gap-2">{ad.title}<span className="text-[9px] font-mono px-1.5 py-px rounded bg-zinc-800 text-zinc-400">{ad.badge || 'AD'}</span></p>
              {ad.description && <p className="text-xs text-zinc-400 line-clamp-2">{ad.description}</p>}
            </div>
            <span className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200">{ad.ctaLabel || 'Learn more'}</span>
          </a>
        );
      })}
    </div>
  );
};
