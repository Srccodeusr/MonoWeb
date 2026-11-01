import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';

export interface PanelServer {
  id: string; name: string; description: string; status: string; startedAt?: string; installLog?: string[];
  image: { id: string; name: string; software: string; category: string; iconUrl?: string } | null;
  location: string; address: string; ports: { host: number; container: number; label?: string }[];
  limits: { ramMB: number; cpuPercent: number; diskMB: number; swapMB: number; backups: number; databases: number };
  baseLimits: PanelServer['limits']; upgrades: any[]; createdAt: string; expiresAt?: string; expiredAt?: string; renewCount: number;
  variables: { name: string; env: string; description: string; value: string }[]; planId: string;
  role: 'owner' | 'subuser'; permissions: string[];
  transfer?: { state: 'running' | 'failed'; fromNodeId: string; toNodeId: string; startedAt: string; step?: string; error?: string };
  sftp: { host: string; port: number } | null;
}

export interface PanelOverview {
  user: { username: string; displayName: string; coins: number; credits: number };
  platform: { servers: number; users: number };
  topBar: { message: string; links: { label: string; url: string }[] } | null;
  promos: { upgradeCard: boolean; hostingCard: boolean; hostingCardTitle: string; hostingCardText: string; hostingCardCta: string; hostingCardUrl: string };
  plan: { id: string; name: string; isFree: boolean; noAds: boolean; expiresAt?: string; tempUntil?: string; serverLimit: number; used: number; perServer: any; renewMethods: string[] };
  economy: { enabled: boolean; coinName: string };
  renew: { ads: boolean; blog: boolean; coins: boolean; coinPrice: number; coinDays: number };
  currencySymbol: string;
  servers: PanelServer[];
}

interface Ctx { data: PanelOverview | null; loading: boolean; error: string; refresh: () => Promise<void> }
const PanelCtx = createContext<Ctx>({ data: null, loading: true, error: '', refresh: async () => undefined });
export const usePanel = () => useContext(PanelCtx);

/** Loads /hosting/overview once for every customer page and keeps it fresh while the tab is visible. */
export const PanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<PanelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await apiRequest<PanelOverview>('/hosting/overview');
      if (res.success && res.data) { setData(res.data); setError(''); } else setError(res.error?.message || 'Could not load your servers.');
    } finally { busy.current = false; setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return <PanelCtx.Provider value={{ data, loading, error, refresh }}>{children}</PanelCtx.Provider>;
};
