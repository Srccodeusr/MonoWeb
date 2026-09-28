import React, { useState, useEffect } from 'react';
import { useBranding } from '../lib/BrandingContext';
import { useTheme } from '../lib/ThemeContext';

interface MonoLogoProps {
  variant?: 'full' | 'compact';
  height?: number | string;
  className?: string;
  onClick?: () => void;
}

export const MonoLogo: React.FC<MonoLogoProps> = ({
  variant = 'full',
  height = 36,
  className = '',
  onClick
}) => {
  const { brandName } = useBranding();
  const { themeAssets } = useTheme();
  const [imgFailed, setImgFailed] = useState(false);

  const customLogoUrl = themeAssets?.logoUrl?.trim();

  // Reset image load error state whenever customLogoUrl changes
  useEffect(() => {
    setImgFailed(false);
  }, [customLogoUrl]);

  const showCustomLogo = Boolean(customLogoUrl && !imgFailed);

  // Parse brand name prefix & suffix for styling (e.g., "MonoNode" -> "Mono" + "Node")
  let prefix = brandName;
  let suffix = '';

  if (brandName.toLowerCase().endsWith('node') && brandName.length > 4) {
    prefix = brandName.substring(0, brandName.length - 4);
    suffix = brandName.substring(brandName.length - 4);
  } else if (brandName.toLowerCase().endsWith('panel') && brandName.length > 5) {
    prefix = brandName.substring(0, brandName.length - 5);
    suffix = brandName.substring(brandName.length - 5);
  } else if (brandName.toLowerCase().endsWith('cloud') && brandName.length > 5) {
    prefix = brandName.substring(0, brandName.length - 5);
    suffix = brandName.substring(brandName.length - 5);
  } else if (brandName.includes(' ')) {
    const parts = brandName.split(' ');
    prefix = parts.slice(0, -1).join(' ');
    suffix = ' ' + parts[parts.length - 1];
  }

  // Square logo icon container — network-node glyph on dark card
  const iconContainer = (
    <div className="relative flex items-center justify-center p-1 rounded-xl bg-zinc-900 border border-white/20 group-hover:border-white/40 shadow-[0_0_15px_rgba(255,255,255,0.15)] transition-all shrink-0 w-9 h-9 overflow-hidden">
      {showCustomLogo ? (
        <img
          src={customLogoUrl}
          alt={brandName}
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain rounded-lg transition-transform group-hover:scale-105"
        />
      ) : (
        <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 60 60" fill="none">
          <defs>
            <linearGradient id="monoLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="45%" stopColor="#d4d4d8" />
              <stop offset="100%" stopColor="#71717a" />
            </linearGradient>
          </defs>
          <g stroke="url(#monoLogoGrad)" strokeWidth="3" strokeLinecap="round">
            <line x1="30" y1="30" x2="30" y2="13" />
            <line x1="30" y1="30" x2="17" y2="39" />
            <line x1="30" y1="30" x2="43" y2="39" />
          </g>
          <circle cx="30" cy="13" r="5.5" fill="url(#monoLogoGrad)" />
          <circle cx="17" cy="39" r="5.5" fill="url(#monoLogoGrad)" />
          <circle cx="43" cy="39" r="5.5" fill="url(#monoLogoGrad)" />
          <circle cx="30" cy="30" r="7" fill="#09090b" stroke="url(#monoLogoGrad)" strokeWidth="3" />
        </svg>
      )}
    </div>
  );

  if (variant === 'compact') {
    return (
      <div
        onClick={onClick}
        className={`inline-flex items-center cursor-pointer select-none group shrink-0 ${className}`}
      >
        {iconContainer}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 cursor-pointer select-none group shrink-0 ${className}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      {iconContainer}
      <div className="flex flex-col leading-none truncate">
        <span className="text-base sm:text-lg font-bold tracking-tight text-white font-display flex items-center gap-0.5">
          {prefix}
          {suffix && (
            <span className="bg-gradient-to-r from-white via-zinc-300 to-zinc-500 bg-clip-text text-transparent">
              {suffix}
            </span>
          )}
        </span>
        <span className="text-[8px] sm:text-[9px] font-bold tracking-widest text-zinc-400 uppercase mt-0.5 font-mono hidden min-[380px]:block">
          Bot &amp; VPS Hosting
        </span>
      </div>
    </div>
  );
};
