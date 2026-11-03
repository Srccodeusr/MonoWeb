import React, { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, Search, ShoppingCart, X } from 'lucide-react';
import { Badge, Btn, Card, Empty, PageHeader, Select, Spinner, TextInput, money, useToast } from '../../../components/ui/kit';
import { PromptModal, ago } from '../../../components/ui/panelKit';
import { VpsOrder } from '../../../vpsTypes';
import { adminVps } from '../../vps/vpsApi';

const tone = (s: string) => (s === 'fulfilled' ? 'green' : s === 'pending' ? 'amber' : s === 'paid' ? 'blue' : s === 'declined' || s === 'failed' ? 'red' : 'zinc') as 'green' | 'amber' | 'blue' | 'red' | 'zinc';

export const AdminVpsOrders: React.FC = () => {
  const [toast, say] = useToast(); const [rows, setRows] = useState<VpsOrder[] | null>(null); const [status, setStatus] = useState(''); const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(''); const [decline, setDecline] = useState<VpsOrder | null>(null);
  const load = useCallback(async () => { try { const q = new URLSearchParams(); if (status) q.set('status', status); if (search) q.set('search', search); setRows(await adminVps<VpsOrder[]>(`/orders?${q}`)); } catch (e: any) { say('error', e.message); } }, [status, search, say]);
  useEffect(() => { const t = window.setTimeout(load, 250); return () => window.clearTimeout(t); }, [load]);
  const approve = async (o: VpsOrder) => { setBusy(o.id); try { await adminVps(`/orders/${o.id}/approve`, { method: 'POST' }); say('success', 'Approved. The VPS is deploying.'); } catch (e: any) { say('error', e.message); } finally { setBusy(''); load(); } };
  const doDecline = async (reason: string) => { if (!decline) return; try { await adminVps(`/orders/${decline.id}/decline`, { method: 'POST', body: { reason } }); say('success', 'Declined' + (decline.creditsHeld ? ' and credits refunded.' : '.')); } catch (e: any) { say('error', e.message); } setDecline(null); load(); };
  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<ShoppingCart className="h-6 w-6 text-amber-400" />} title="VPS Orders" subtitle="Deployments and renewals. In manual payment mode, approve or decline each pending deployment here." actions={<Btn size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Btn>} />
      <div className="flex flex-wrap gap-2"><div className="relative flex-1 min-w-[220px]"><Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" /><TextInput className="!pl-9" placeholder="Search email, plan, id…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select className="!w-44" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['pending', 'paid', 'fulfilled', 'failed', 'declined'].map(s => <option key={s} value={s}>{s}</option>)}</Select></div>
      {!rows ? <Spinner /> : !rows.length ? <Card><Empty icon={<ShoppingCart className="h-10 w-10" />} title="No orders" /></Card> : (
        <Card className="!p-0 divide-y divide-zinc-800/60">{rows.map(o => (
          <div key={o.id} className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="min-w-0"><p className="font-semibold text-zinc-100 flex items-center gap-2 flex-wrap">{o.planName}<Badge tone={tone(o.status)}>{o.status}</Badge><Badge tone="zinc">{o.kind}</Badge>{o.source === 'checkout' && <Badge tone="blue">website</Badge>}</p>
              <p className="text-zinc-500 mt-0.5">{o.userEmail} · {money(o.amount)} · {o.paymentMethod || '—'} · {ago(o.createdAt)}{o.name ? ` · "${o.name}"` : ''}</p>
              {o.error && <p className="text-red-300 mt-1">{o.error}</p>}{o.adminNote && <p className="text-zinc-500 mt-1">Note: {o.adminNote}</p>}</div>
            <div className="flex gap-1.5">
              {o.kind === 'deploy' && (o.status === 'pending' || o.status === 'paid' || (o.status === 'failed' && o.source === 'checkout')) && <Btn size="sm" variant="success" busy={busy === o.id} onClick={() => approve(o)}><Check className="h-3.5 w-3.5" />{o.status === 'failed' ? 'Retry deploy' : 'Approve'}</Btn>}
              {o.status === 'pending' && <Btn size="sm" variant="danger" onClick={() => setDecline(o)}><X className="h-3.5 w-3.5" />Decline</Btn>}
            </div>
          </div>))}</Card>)}
      <PromptModal open={!!decline} title="Decline order" label="Reason (sent to the customer)" initial="Payment could not be verified" confirmLabel={decline?.creditsHeld ? 'Decline & refund credits' : 'Decline'} onClose={() => setDecline(null)} onSubmit={doDecline} />
    </div>
  );
};
