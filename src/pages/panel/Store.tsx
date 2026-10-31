import React, { useCallback, useEffect, useState } from 'react';
import { Coins, Cpu, MemoryStick, HardDrive, RefreshCw, Crown, Server, Plus, Gift, PackageOpen } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePanel } from '../../components/panel/PanelContext';
import { AdBanner } from '../../components/AdBanner';
import { Badge, Btn, Card, Empty, Modal, PageHeader, Select, Spinner, fmtMB, money, useToast, cx } from '../../components/ui/kit';

interface Item { id: string; type: string; name: string; description: string; priceCoins: number; priceMoney: number; stock: number | null; perUserLimit: number; purchased: number; detail: any; disabledReason?: string }
const ICON: Record<string, any> = { spec_upgrade: MemoryStick, renew: RefreshCw, temp_premium: Crown, server_pack: Server, slot: Plus };
const LABEL: Record<string, string> = { spec_upgrade: 'Spec upgrade', renew: 'Renewal', temp_premium: 'Temporary premium', server_pack: 'Boosted server', slot: 'Server slot' };

export const Store: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const { data: panel, refresh } = usePanel();
  const [toast, say] = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [buy, setBuy] = useState<Item | null>(null);
  const [serverId, setServerId] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await apiRequest<Item[]>('/economy/store'); if (r.success && r.data) setItems(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  if (!items || !panel) return <Spinner />;
  const coin = panel.economy.coinName; const sym = panel.currencySymbol;
  const needsServer = (i: Item) => i.type === 'spec_upgrade' || i.type === 'renew';

  const confirm = async (payWith: 'coins' | 'credits') => {
    if (!buy) return; setBusy(payWith);
    const r = await apiRequest(`/economy/store/${buy.id}/buy`, { method: 'POST', body: JSON.stringify({ serverId: serverId || undefined, payWith }) });
    setBusy('');
    if (r.success) { say('success', r.data?.message || 'Purchase complete.'); setBuy(null); await Promise.all([refresh(), load()]); } else say('error', r.error?.message || 'Purchase failed.');
  };

  const detail = (i: Item) => {
    const d = i.detail; if (!d) return null;
    if (i.type === 'spec_upgrade') return <div className="flex flex-wrap gap-1.5 mt-3">{d.ramMB > 0 && <Badge tone="blue"><MemoryStick className="h-3 w-3 mr-1" />+{fmtMB(d.ramMB)}</Badge>}{d.cpuPercent > 0 && <Badge tone="blue"><Cpu className="h-3 w-3 mr-1" />+{d.cpuPercent}%</Badge>}{d.diskMB > 0 && <Badge tone="blue"><HardDrive className="h-3 w-3 mr-1" />+{fmtMB(d.diskMB)}</Badge>}<Badge>{d.durationDays ? `${d.durationDays} days` : 'Permanent'}</Badge></div>;
    if (i.type === 'server_pack') return <div className="flex flex-wrap gap-1.5 mt-3"><Badge tone="blue">{fmtMB(d.ramMB)} RAM</Badge><Badge tone="blue">{d.cpuPercent}% CPU</Badge><Badge tone="blue">{fmtMB(d.diskMB)} disk</Badge><Badge>{d.validityDays} days</Badge></div>;
    if (i.type === 'renew') return <div className="mt-3"><Badge tone="blue">+{d.renewDays} days</Badge></div>;
    if (i.type === 'temp_premium') return <div className="mt-3"><Badge tone="amber">{d.premiumDays} days of Premium</Badge></div>;
    return null;
  };

  return (
    <div className="space-y-4">
      {toast}
      <PageHeader icon={<PackageOpen className="h-6 w-6 text-amber-400" />} title="Store" subtitle={`Spend ${coin} on upgrades, renewals, temporary Premium and boosted servers. Earn more from the Earn tab.`}
        actions={<><span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300"><Coins className="h-4 w-4" />{panel.user.coins.toLocaleString()} {coin}</span><Btn onClick={() => onNavigate('earn')}><Gift className="h-3.5 w-3.5" />Earn more</Btn></>} />
      {items.length === 0 ? <Card><Empty icon={<PackageOpen className="h-12 w-12" />} title="The store is empty" text="Check back soon." /></Card> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(i => { const I = ICON[i.type] || PackageOpen; const soldOut = i.stock !== null && i.stock <= 0; const capped = i.perUserLimit > 0 && i.purchased >= i.perUserLimit; const off = !!i.disabledReason || soldOut || capped;
            return (
              <Card key={i.id} className={cx('flex flex-col', off && 'opacity-60')}>
                <div className="flex items-start gap-3"><span className="h-10 w-10 shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><I className="h-5 w-5 text-amber-400" /></span><div className="min-w-0"><p className="text-sm font-bold text-white">{i.name}</p><p className="text-[10px] font-mono uppercase text-zinc-600">{LABEL[i.type]}</p></div></div>
                <p className="text-xs text-zinc-400 mt-3 flex-1">{i.description}</p>
                {detail(i)}
                {i.disabledReason && <p className="text-[11px] text-amber-400/80 mt-2">{i.disabledReason}</p>}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
                  <div className="text-xs font-bold text-amber-300">{i.priceCoins > 0 && <span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5" />{i.priceCoins.toLocaleString()}</span>}{i.priceMoney > 0 && <span className="text-zinc-400 font-medium">{i.priceCoins > 0 ? ' or ' : ''}{money(i.priceMoney, sym)}</span>}</div>
                  <Btn size="sm" variant="primary" disabled={off} onClick={() => { setBuy(i); setServerId(panel.servers[0]?.id || ''); }}>{soldOut ? 'Sold out' : capped ? 'Limit reached' : 'Buy'}</Btn>
                </div>
              </Card>
            ); })}
        </div>
      )}
      {!panel.plan.noAds && <AdBanner placement="store" />}

      <Modal open={!!buy} onClose={() => setBuy(null)} title={buy ? `Buy ${buy.name}` : ''} footer={buy && <>
        <Btn onClick={() => setBuy(null)}>Cancel</Btn>
        {buy.priceMoney > 0 && <Btn busy={busy === 'credits'} disabled={needsServer(buy) && !serverId} onClick={() => confirm('credits')}>Pay {money(buy.priceMoney, sym)} credits</Btn>}
        {buy.priceCoins > 0 && <Btn variant="primary" busy={busy === 'coins'} disabled={(needsServer(buy) && !serverId) || panel.user.coins < buy.priceCoins} onClick={() => confirm('coins')}><Coins className="h-3.5 w-3.5" />{buy.priceCoins} {coin}</Btn>}
      </>}>
        {buy && <div className="space-y-4 text-xs text-zinc-300">
          <p>{buy.description}</p>
          {needsServer(buy) && (panel.servers.length === 0 ? <p className="text-amber-300">You need a server first.</p> : <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-1.5">Apply to server</p><Select value={serverId} onChange={e => setServerId(e.target.value)}>{panel.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>)}
          {buy.priceCoins > 0 && panel.user.coins < buy.priceCoins && <p className="text-red-300">You need {(buy.priceCoins - panel.user.coins).toLocaleString()} more {coin}. <button className="underline" onClick={() => { setBuy(null); onNavigate('earn'); }}>Earn some</button></p>}
        </div>}
      </Modal>
    </div>
  );
};
