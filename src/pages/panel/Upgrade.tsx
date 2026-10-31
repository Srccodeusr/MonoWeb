import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Wallet, Landmark, Bitcoin, Gift, Smartphone, Check, Minus, Star, Tag, Info } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePanel } from '../../components/panel/PanelContext';
import { Btn, Card, Field, Modal, Spinner, TextInput, cx, fmtDate, fmtMB, money, useToast } from '../../components/ui/kit';
import type { BillingPeriod, HostingPlan } from '../../hostingTypes';

interface PlanRow extends HostingPlan { prices: Record<string, { total: number; perMonth: number; saved: number; base: number }> }
interface PlansPayload { currencySymbol: string; periods: BillingPeriod[]; plans: PlanRow[] }
interface Me { planId: string; planName: string; isFree: boolean; expiresAt?: string; stripe: boolean; methods: any }

type Method = 'stripe' | 'credits' | 'upi' | 'bank' | 'crypto' | 'giftcard';

const Cell: React.FC<{ v: React.ReactNode; strong?: boolean }> = ({ v, strong }) => <td className={cx('py-3 px-3 text-xs text-center sm:text-left', strong ? 'text-zinc-100 font-semibold' : 'text-zinc-500')}>{v}</td>;
const yn = (b: boolean) => (b ? <Check className="h-4 w-4 text-emerald-400 inline" aria-label="Yes" /> : <Minus className="h-4 w-4 text-zinc-700 inline" aria-label="No" />);

export const Upgrade: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const { refresh } = usePanel();
  const [toast, say] = useToast();
  const [data, setData] = useState<PlansPayload | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [planId, setPlanId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState<Method | ''>('');
  const [manual, setManual] = useState<Method | null>(null);
  const [ref, setRef] = useState('');

  useEffect(() => {
    (async () => {
      const [p, m] = await Promise.all([apiRequest<PlansPayload>('/hosting-public/plans'), apiRequest<Me>('/hosting/billing/me')]);
      if (p.success && p.data) {
        setData(p.data);
        const paid = p.data.plans.filter(x => !x.isFree);
        setPlanId((paid.find(x => x.isPopular) || paid[0])?.id || '');
        const pop = p.data.periods.find(x => x.id === 'yearly') || p.data.periods[0];
        setPeriodId(pop?.id || '');
      }
      if (m.success && m.data) setMe(m.data);
    })();
  }, []);

  const sym = data?.currencySymbol || '$';
  const paidPlans = useMemo(() => (data?.plans || []).filter(p => !p.isFree), [data]);
  const plan = data?.plans.find(p => p.id === planId);
  const period = data?.periods.find(p => p.id === periodId);

  if (!data || !me) return <Spinner />;
  const cheapest = paidPlans.length ? Math.min(...paidPlans.map(p => p.monthlyPrice)) : 0;
  const maxSave = Math.max(0, ...data.periods.map(p => p.discountPercent));
  const price = plan && period ? plan.prices[period.id] : null;

  const pay = async (method: Method, transactionRef?: string) => {
    if (!plan || !period) return;
    setBusy(method);
    const r = await apiRequest('/hosting/billing/checkout', { method: 'POST', body: JSON.stringify({ planId: plan.id, periodId: period.id, method, coupon: coupon.trim() || undefined, transactionRef }) });
    setBusy('');
    if (!r.success) return say('error', r.error?.message || 'Checkout failed.');
    if (r.data.redirectUrl) { window.location.href = r.data.redirectUrl; return; }           // Stripe hosted checkout
    if (r.data.status === 'paid') { await refresh(); onNavigate('servers'); return; }        // straight to the server overview
    setManual(null); setRef('');
    say('success', 'Order submitted. Staff will verify your payment and activate the plan shortly.');
  };

  const m = me.methods || {};
  const methodBtns = ([
    { id: 'stripe', label: 'Pay with Card', icon: CreditCard, show: !!m.stripe, primary: true },
    { id: 'credits', label: 'Account credits', icon: Wallet, show: true },
    { id: 'upi', label: 'UPI', icon: Smartphone, show: !!m.upi },
    { id: 'bank', label: 'Bank transfer', icon: Landmark, show: !!m.bank },
    { id: 'crypto', label: 'Pay with Crypto', icon: Bitcoin, show: !!m.crypto },
    { id: 'giftcard', label: 'Gift card', icon: Gift, show: !!m.giftCard },
  ] as { id: Method; label: string; icon: any; show: boolean; primary?: boolean }[]).filter(x => x.show);

  const rows: { label: string; render: (p: PlanRow) => React.ReactNode }[] = [
    { label: 'Panel ads', render: p => (p.features.noAds ? 'No' : 'Yes') },
    { label: 'Server renewals', render: p => (p.features.directRenewal ? 'Direct, ad-free' : p.renewal.methods.includes('ads') || p.renewal.methods.includes('blog') ? 'Via ad / article' : p.renewal.methods.includes('coins') ? 'With coins' : '—') },
    { label: 'Server limit', render: p => p.serverLimit },
    { label: 'RAM per server', render: p => fmtMB(p.perServer.ramMB) },
    { label: 'CPU per server', render: p => `${p.perServer.cpuPercent}%` },
    { label: 'Storage per server', render: p => fmtMB(p.perServer.diskMB) },
    { label: 'Backups per server', render: p => (p.perServer.backups > 0 ? p.perServer.backups : yn(false)) },
    { label: 'Subusers (team members)', render: p => yn(p.features.subusers) },
    { label: 'Scheduled tasks', render: p => yn(p.features.scheduledTasks) },
    { label: 'Choose your node before deployment', render: p => yn(p.features.chooseNode) },
    { label: 'Switch nodes anytime', render: p => yn(p.features.switchNode) },
    { label: 'Discord role', render: p => (p.features.discordRole ? p.name : yn(false)) },
    { label: 'Exclusive giveaways', render: p => yn(p.features.giveaways) },
  ];
  const cols = data.plans;

  return (
    <div className="space-y-4">
      {toast}
      <Card className="!p-5 sm:!p-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Upgrade your account</h1>
        <p className="text-xs sm:text-sm text-zinc-400 mt-2 max-w-2xl">Remove ads, unlock more server slots, and get exclusive perks. Plans are prepaid from {money(cheapest, sym)}/month{maxSave > 0 && <> — pay for longer periods and save up to {maxSave}%</>}.</p>
        <p className="text-[11px] text-zinc-500 mt-3">Current plan: <b className="text-amber-300">{me.planName}</b>{me.expiresAt && !me.isFree && <> · renews by {fmtDate(me.expiresAt)}</>}</p>
      </Card>

      {/* plan picker */}
      <div className="grid sm:grid-cols-2 gap-3">
        {paidPlans.map(p => {
          const on = p.id === planId;
          return (
            <button key={p.id} onClick={() => setPlanId(p.id)} className={cx('text-left rounded-2xl border p-5 transition-colors', on ? 'border-amber-500/50 bg-amber-500/[0.06]' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700')}>
              <div className="flex items-center justify-between"><span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{p.name}</span>{on && <span className="h-2 w-2 rounded-full bg-amber-400" />}</div>
              <p className="text-3xl font-extrabold text-white mt-2">{money(p.monthlyPrice, sym)}<span className="text-sm font-medium text-zinc-500">/mo</span></p>
              <p className="text-xs text-zinc-400 mt-1">{p.tagline}</p>
            </button>
          );
        })}
      </div>

      {/* billing period */}
      {plan && (
        <Card>
          <h2 className="text-sm font-bold text-white">Billing period</h2>
          <p className="text-[11px] text-zinc-500 mb-3">Prepay a longer period and save.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {data.periods.map(per => {
              const pr = plan.prices[per.id]; const on = per.id === periodId; const popular = per.id === 'yearly';
              return (
                <button key={per.id} onClick={() => setPeriodId(per.id)} className={cx('relative text-left rounded-xl border p-3.5 transition-colors', on ? 'border-amber-500/60 bg-amber-500/[0.07]' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700')}>
                  {popular && <span className="absolute -top-2 right-3 text-[8px] font-black tracking-wider bg-amber-500 text-zinc-950 px-1.5 py-0.5 rounded">MOST POPULAR</span>}
                  <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{per.label}</p>
                  <p className="text-lg font-extrabold text-white mt-1">{money(pr.total, sym)}</p>
                  <p className="text-[10px] text-zinc-600">{money(pr.perMonth, sym)}/mo</p>
                  <p className={cx('text-[10px] mt-0.5', pr.saved > 0 ? 'text-emerald-400' : 'text-zinc-600')}>{pr.saved > 0 ? `Save ${per.discountPercent || Math.round((pr.saved / pr.base) * 100)}%` : 'No discount'}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl bg-zinc-950 border border-zinc-800 p-3.5 text-[11px] text-zinc-400 flex gap-2"><Info className="h-3.5 w-3.5 shrink-0 mt-px text-zinc-500" /><span><b className="text-zinc-300">Payments:</b> Prepaid at the listed price. Plans do not auto-renew. Renew manually before it expires; renewing early adds the new period on top of your remaining time.</span></div>
        </Card>
      )}

      {/* comparison */}
      <Card className="!p-0 overflow-hidden">
        <h2 className="text-sm font-bold text-white px-5 py-4 border-b border-zinc-800">What you get</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead><tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-600"><th className="py-2.5 px-5 text-left font-normal" />{cols.map(p => <th key={p.id} className="py-2.5 px-3 text-left font-normal">{p.name}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map(r => (
                <tr key={r.label}><td className="py-3 px-5 text-xs text-zinc-300 font-medium whitespace-nowrap">{r.label}</td>{cols.map(p => <Cell key={p.id} v={r.render(p)} strong={!p.isFree} />)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* pay */}
      {plan && period && price && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Order summary</p><p className="text-sm font-bold text-white mt-1">{plan.name} · {period.label}</p></div>
            <p className="text-2xl font-extrabold text-amber-300">{money(price.total, sym)}</p>
          </div>
          <Field label="Promo code (optional)"><div className="relative"><Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" /><TextInput value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())} className="pl-9 font-mono" placeholder="SUMMER20" /></div></Field>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {methodBtns.map(b => { const I = b.icon; return (
              <Btn key={b.id} variant={b.primary ? 'primary' : 'dark'} busy={busy === b.id} className="!py-3" onClick={() => ['upi', 'bank', 'crypto', 'giftcard'].includes(b.id) ? setManual(b.id) : pay(b.id)}><I className="h-4 w-4" />{b.label}</Btn>
            ); })}
          </div>
          {!m.stripe && <p className="text-[11px] text-zinc-500">Card payments are not enabled yet. Use account credits or one of the other methods above.</p>}
        </Card>
      )}

      {/* manual payment modal */}
      <Modal open={!!manual} onClose={() => setManual(null)} title={manual === 'giftcard' ? 'Redeem a gift card' : 'Submit your payment'}
        footer={<><Btn onClick={() => setManual(null)}>Cancel</Btn><Btn variant="primary" busy={!!busy} disabled={!ref.trim()} onClick={() => manual && pay(manual, ref)}>Submit for verification</Btn></>}>
        <div className="space-y-4 text-xs text-zinc-300">
          {manual === 'upi' && m.instructions?.upi && <div className="space-y-1"><p>Pay <b className="text-white">{price && money(price.total, sym)}</b> to UPI ID <code className="text-amber-300">{m.instructions.upi.upiId}</code> ({m.instructions.upi.merchantName}).</p>{m.instructions.upi.qrCodeUrl && /^https?:\/\//.test(m.instructions.upi.qrCodeUrl) && <img src={m.instructions.upi.qrCodeUrl} alt="UPI QR" className="h-40 w-40 rounded-lg bg-white p-1" />}<p className="text-zinc-500">{m.instructions.upi.text}</p></div>}
          {manual === 'bank' && m.instructions?.bank && <div className="space-y-1"><p>Transfer <b className="text-white">{price && money(price.total, sym)}</b> to {m.instructions.bank.accountHolder} · {m.instructions.bank.bankName}</p><p className="font-mono text-amber-300">{m.instructions.bank.accountNumber} {m.instructions.bank.ifsc}</p><p className="text-zinc-500">{m.instructions.bank.text}</p></div>}
          {manual === 'crypto' && m.instructions?.crypto && <div className="space-y-1"><p>Send <b className="text-white">{price && money(price.total, sym)}</b> equivalent on {m.instructions.crypto.network} to:</p><p className="font-mono text-amber-300 break-all">{m.instructions.crypto.walletAddress}</p><p className="text-zinc-500">{m.instructions.crypto.text}</p></div>}
          <Field label={manual === 'giftcard' ? 'Gift card code' : 'Transaction ID / reference'}><TextInput value={ref} onChange={e => setRef(e.target.value)} placeholder={manual === 'giftcard' ? 'XXXX-XXXX-XXXX' : 'e.g. UTR / TXID'} /></Field>
        </div>
      </Modal>
      <p className="text-center text-[11px] text-zinc-600 flex items-center justify-center gap-1.5"><Star className="h-3 w-3" />Questions? Open a ticket from More → Support.</p>
    </div>
  );
};
