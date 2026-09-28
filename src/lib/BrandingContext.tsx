import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest } from './api';
import { SocialLinks, QuickLink } from '../types';

interface BrandingContextType {
  brandName: string;
  brandTagline: string;
  supportEmail: string;
  discordUrl: string;
  socialLinks: SocialLinks;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  pageAnimationsEnabled: boolean;
  heroDescription: string;
  footerDescription: string;
  quickLinks: QuickLink[];
  refreshBranding: () => Promise<void>;
  updateBrandNameLocally: (newName: string) => void;
  setPageAnimationsEnabledLocally: (enabled: boolean) => void;
  setSocialLinksLocally: (links: SocialLinks) => void;
  setHomepageDescriptionsLocally: (hero: string, footer: string) => void;
}

const DEFAULT_HERO_DESCRIPTION = '24/7 Discord bot hosting and high-performance VPS instances, backed by real support. Powered by high-clock compute hardware and enterprise NVMe storage.';
const DEFAULT_FOOTER_DESCRIPTION = 'Reliable Bot Hosting and VPS Hosting plans built on the same high-performance network, from budget-friendly value hardware.';

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [brandName, setBrandName] = useState<string>(() => {
    return localStorage.getItem('aether_brand_name') || 'MonoNode';
  });
  const [brandTagline, setBrandTagline] = useState<string>('Bot Hosting & VPS Hosting');
  const [supportEmail, setSupportEmail] = useState<string>('support@mononode.com');
  const [discordUrl, setDiscordUrl] = useState<string>('https://discord.gg/mononode');
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(() => {
    const saved = localStorage.getItem('aether_social_links');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      discord: 'https://discord.gg/mononode',
      twitter: 'https://twitter.com/mononode',
      github: 'https://github.com/mononode'
    };
  });
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>('MonoNode is currently performing scheduled system upgrades.');
  const [pageAnimationsEnabled, setPageAnimationsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('aether_page_animations_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [heroDescription, setHeroDescription] = useState<string>(DEFAULT_HERO_DESCRIPTION);
  const [footerDescription, setFooterDescription] = useState<string>(DEFAULT_FOOTER_DESCRIPTION);
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);

  const fetchBranding = useCallback(async () => {
    try {
      const res = await apiRequest('/public/settings');
      if (res.success && res.data) {
        if (res.data.brandName) {
          setBrandName(res.data.brandName);
          localStorage.setItem('aether_brand_name', res.data.brandName);
        }
        if (res.data.brandTagline) setBrandTagline(res.data.brandTagline);
        if (res.data.supportEmail) setSupportEmail(res.data.supportEmail);
        if (res.data.discordUrl) setDiscordUrl(res.data.discordUrl);
        if (res.data.socialLinks) {
          setSocialLinks(res.data.socialLinks);
          localStorage.setItem('aether_social_links', JSON.stringify(res.data.socialLinks));
          if (res.data.socialLinks.discord) {
            setDiscordUrl(res.data.socialLinks.discord);
          }
        }
        if (res.data.maintenanceMode !== undefined) setMaintenanceMode(res.data.maintenanceMode);
        if (res.data.maintenanceMessage) setMaintenanceMessage(res.data.maintenanceMessage);
        if (res.data.pageAnimationsEnabled !== undefined) {
          setPageAnimationsEnabled(res.data.pageAnimationsEnabled);
          localStorage.setItem('aether_page_animations_enabled', String(res.data.pageAnimationsEnabled));
        }
        if (typeof res.data.heroDescription === 'string' && res.data.heroDescription.trim().length > 0) {
          setHeroDescription(res.data.heroDescription);
        } else {
          setHeroDescription(DEFAULT_HERO_DESCRIPTION);
        }
        if (typeof res.data.footerDescription === 'string' && res.data.footerDescription.trim().length > 0) {
          setFooterDescription(res.data.footerDescription);
        } else {
          setFooterDescription(DEFAULT_FOOTER_DESCRIPTION);
        }
        if (Array.isArray(res.data.quickLinks)) {
          setQuickLinks(res.data.quickLinks);
        }
      }
    } catch (err) {
      console.error('[BrandingContext] Failed to load branding settings:', err);
    }
  }, []);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Update document.title dynamically when brandName updates
  useEffect(() => {
    if (brandName) {
      document.title = `${brandName} — Bot Hosting & VPS Hosting`;
    }
  }, [brandName]);

  const updateBrandNameLocally = (newName: string) => {
    const trimmed = newName.trim();
    if (trimmed) {
      setBrandName(trimmed);
      localStorage.setItem('aether_brand_name', trimmed);
      document.title = `${trimmed} — Bot Hosting & VPS Hosting`;
    }
  };

  const setPageAnimationsEnabledLocally = (enabled: boolean) => {
    setPageAnimationsEnabled(enabled);
    localStorage.setItem('aether_page_animations_enabled', String(enabled));
  };

  const setSocialLinksLocally = (links: SocialLinks) => {
    setSocialLinks(links);
    localStorage.setItem('aether_social_links', JSON.stringify(links));
    if (links.discord) {
      setDiscordUrl(links.discord);
    }
  };

  const setHomepageDescriptionsLocally = (hero: string, footer: string) => {
    if (hero) setHeroDescription(hero);
    if (footer) setFooterDescription(footer);
  };

  return (
    <BrandingContext.Provider
      value={{
        brandName,
        brandTagline,
        supportEmail,
        discordUrl,
        socialLinks,
        maintenanceMode,
        maintenanceMessage,
        pageAnimationsEnabled,
        heroDescription,
        footerDescription,
        quickLinks,
        refreshBranding: fetchBranding,
        updateBrandNameLocally,
        setPageAnimationsEnabledLocally,
        setSocialLinksLocally,
        setHomepageDescriptionsLocally
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
};
