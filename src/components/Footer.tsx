import React from 'react';
import { Github, Twitter, Mail, ArrowUpRight } from 'lucide-react';
import { MonoLogo } from './MonoLogo';
import { DiscordGlyph } from './DiscordGlyph';
import { useBranding } from '../lib/BrandingContext';

interface FooterProps {
  onNavigate: (page: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { socialLinks, discordUrl, footerDescription, brandName, supportEmail } = useBranding();
  const joinUrl = socialLinks.discord || discordUrl;
  const name = brandName || 'MonoNode';

  const linkCls = 'text-sm sm:text-[15px] font-medium text-zinc-200 hover:text-white transition-colors text-left';
  const headCls = 'font-display text-base sm:text-lg font-semibold text-zinc-400 mb-5 sm:mb-6';
  const socialCls = 'h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:bg-zinc-300 hover:scale-105 transition-all';

  return (
    <footer className="bg-black text-zinc-400">
      {/* ===== Discord community band ===== */}
      <div className="border-y border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center text-emerald-400">
              <DiscordGlyph className="h-7 w-7 sm:h-8 sm:w-8" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-xl sm:text-2xl lg:text-3xl font-semibold text-white leading-tight">
                Join the {name} Community
              </h3>
              <p className="text-sm sm:text-base text-zinc-400 mt-1">
                Get 24/7 support, exclusive updates, billing help, and instant bot setup guides.
              </p>
            </div>
          </div>
          {joinUrl && (
            <a
              id="footer_join_discord"
              href={joinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm sm:text-base transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              <DiscordGlyph className="h-5 w-5" />
              Join Discord
            </a>
          )}
        </div>
      </div>

      {/* ===== Main footer ===== */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 pb-14 sm:pb-20">
        <div className="grid grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.2fr] gap-x-6 gap-y-12 lg:gap-x-12">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-1 space-y-6 max-w-sm">
            <MonoLogo onClick={() => onNavigate('home')} height={44} />
            <p className="text-base sm:text-lg text-zinc-300 leading-relaxed">{footerDescription}</p>
            <div className="flex items-center gap-3">
              {socialLinks.discord && (
                <a id="footer_social_discord" href={socialLinks.discord} target="_blank" rel="noreferrer noopener" className={socialCls} aria-label="Discord">
                  <DiscordGlyph className="h-5 w-5" />
                </a>
              )}
              {socialLinks.twitter && (
                <a id="footer_social_twitter" href={socialLinks.twitter} target="_blank" rel="noreferrer noopener" className={socialCls} aria-label="X / Twitter">
                  <Twitter className="h-5 w-5" />
                </a>
              )}
              {socialLinks.github && (
                <a id="footer_social_github" href={socialLinks.github} target="_blank" rel="noreferrer noopener" className={socialCls} aria-label="GitHub">
                  <Github className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>

          {/* Hosting */}
          <div>
            <h4 className={headCls}>Hosting</h4>
            <ul className="space-y-4">
              <li><button onClick={() => onNavigate('bot')} className={linkCls}>Discord Bot Hosting</button></li>
              <li><button onClick={() => onNavigate('vps')} className={linkCls}>VPS Hosting</button></li>
              <li><button onClick={() => onNavigate('pricing')} className={linkCls}>Plans &amp; Pricing</button></li>
            </ul>
          </div>

          {/* Quick links */}
          <div>
            <h4 className={headCls}>Quick Links</h4>
            <ul className="space-y-4">
              <li><button onClick={() => onNavigate('dashboard')} className={linkCls}>Client Area</button></li>
              <li><button onClick={() => onNavigate('billing')} className={linkCls}>Billing</button></li>
              <li><button onClick={() => onNavigate('docs')} className={linkCls}>Documentation</button></li>
              <li>
                <button onClick={() => onNavigate('status')} className={`${linkCls} flex items-center gap-2`}>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  Network Status
                </button>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="col-span-2 lg:col-span-1">
            <h4 className={headCls}>Contact</h4>
            <ul className="space-y-4">
              {supportEmail && (
                <li>
                  <a href={`mailto:${supportEmail}`} className={`${linkCls} inline-flex items-center gap-2 break-all`}>
                    <Mail className="h-4 w-4 shrink-0 text-zinc-400" />
                    {supportEmail}
                  </a>
                </li>
              )}
              <li><button onClick={() => onNavigate('support')} className={linkCls}>Support Tickets</button></li>
              {joinUrl && (
                <li>
                  <a href={joinUrl} target="_blank" rel="noreferrer noopener" className={`${linkCls} inline-flex items-center gap-1.5`}>
                    Discord Support <ArrowUpRight className="h-4 w-4" />
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* ===== Bottom bar ===== */}
      <div className="border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm">
          <span className="text-zinc-400">Copyright © 2025–2026 {name}. All rights reserved.</span>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 font-medium text-zinc-200">
            <button onClick={() => onNavigate('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
            <button onClick={() => onNavigate('terms')} className="hover:text-white transition-colors">Terms of Service</button>
            <button onClick={() => onNavigate('acceptable-use')} className="hover:text-white transition-colors">Acceptable Use</button>
          </div>
        </div>
      </div>
    </footer>
  );
};
