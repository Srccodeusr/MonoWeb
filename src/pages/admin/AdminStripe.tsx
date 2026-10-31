import React, { useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, Circle, Copy, ExternalLink, ShieldCheck, Zap, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Field, PageHeader, Select, Spinner, TextInput, Toggle, cx, fmtDate, useToast } from '../../components/ui/kit';

interface View { enabled: boolean; publishableKey: string; secretKeyMasked: string; hasSecretKey: boolean; webhookSecretMasked: string; hasWebhookSecret: boolean; currency: string; mode: 'test' | 'live'; lastTestedAt?: string; lastTestOk?: boolean; webhookUrl: string; events: string[] }
const CURRENCIES = ['usd', 'eur', 'gbp', 'inr', 'cad', 'aud', 'jpy', 'sgd', 'aed', 'brl', 'mxn', 'chf', 'sek', 'nok', 'dkk', 'pln'];

const Step: React.FC<{ n: number; done: boolean; title: string; children: React.ReactNode }> = ({ n, done, title, children }) => (
  <Card className="space-y-4">
    <h2 className="text-sm font-bold text-white flex items-center gap-2.5">{done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <span className="h-5 w-5 rounded-full border border-zinc-700 text-[10px] flex items-center justify-center text-zinc-400">{n}</span>}{title}</h2>{children}
  </Card>
);

export const AdminStripe: React.FC = () => {
  const [toast, say] = useToast();
  const [v, setV] = useState<View | null>(null);
  const [secret, setSecret] = useState(''); const [whsec, setWhsec] = useState(''); const [pub, setPub] = useState(''); const [cur, setCur] = useState('usd');
  const [show, setShow] = useState(false); const [busy, setBusy] = useState('');
  const [info, setInfo] = useState<any>(null);
  const load = async () => { const r = await apiRequest<View>('/admin/hosting/stripe'); if (r.success && r.data) { setV(r.data); setPub(r.data.publishableKey); setCur(r.data.currency); } };
  useEffect(() => { load(); }, []);
  if (!v) return <Spinner />;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => say('success', 'Copied'));

  const put = async (body: any, ok: string, key: string) => { setBusy(key); const r = await apiRequest('/admin/hosting/stripe', { method: 'PUT', body: JSON.stringify(body) }); setBusy(''); if (r.success) { say('success', ok); setV(r.data); setSecret(''); setWhsec(''); return true; } say('error', r.error?.message || 'Failed'); return false; };
  const test = async () => { setBusy('test'); setInfo(null); const r = await apiRequest('/admin/hosting/stripe/test', { method: 'POST', body: JSON.stringify({ secretKey: secret || undefined }) }); setBusy(''); if (r.success) { setInfo(r.data); say('success', 'Connected to Stripe'); } else say('error', r.error?.message || 'Failed'); load(); };

  const keyDone = v.hasSecretKey && v.lastTestOk === true;
  return (
    <div className="space-y-5 max-w-3xl">
      {toast}
      <PageHeader icon={<CreditCard className="h-6 w-6 text-amber-400" />} title="Stripe card payments" subtitle="Accept cards for plan purchases. Money is only credited after Stripe's signed webhook confirms the payment, never from the browser redirect."
        actions={<Badge tone={v.enabled ? 'green' : 'zinc'}>{v.enabled ? `Enabled · ${v.mode} mode` : 'Disabled'}</Badge>} />

      <Step n={1} done={keyDone} title="Add your API secret key">
        <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1"><li>Open <a className="text-amber-300 underline inline-flex items-center gap-0.5" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer">Stripe → Developers → API keys<ExternalLink className="h-3 w-3" /></a>.</li><li>Copy the <b className="text-zinc-200">Secret key</b> (<code>sk_test_…</code> while testing, <code>sk_live_…</code> when you go live). A restricted key with Checkout Sessions: write works too.</li></ol>
        <Field label="Secret key" hint={v.hasSecretKey ? `Saved: ${v.secretKeyMasked}. Leave empty to keep it.` : 'Stored encrypted. It is never shown again.'}>
          <div className="flex gap-2"><TextInput type={show ? 'text' : 'password'} autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} placeholder={v.hasSecretKey ? v.secretKeyMasked : 'sk_test_…'} className="font-mono text-xs" /><Btn onClick={() => setShow(s => !s)} aria-label="Toggle visibility">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Btn></div></Field>
        <div className="flex flex-wrap gap-2 items-center"><Btn busy={busy === 'save1'} disabled={!secret} variant="primary" onClick={() => put({ secretKey: secret }, 'Secret key saved', 'save1')}>Save key</Btn><Btn busy={busy === 'test'} disabled={!secret && !v.hasSecretKey} onClick={test}><Zap className="h-4 w-4" />Test connection</Btn>
          {v.lastTestedAt && <span className={cx('text-[11px]', v.lastTestOk ? 'text-emerald-400' : 'text-red-400')}>{v.lastTestOk ? 'Last test passed' : 'Last test failed'} · {fmtDate(v.lastTestedAt)}</span>}</div>
        {info && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-200">Account <b className="font-mono">{info.accountId}</b> · {info.livemode ? 'LIVE mode' : 'test mode'} · charges {info.chargesEnabled ? 'enabled' : 'not enabled yet'}</div>}
      </Step>

      <Step n={2} done={v.hasWebhookSecret} title="Create the webhook endpoint">
        <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1"><li>Open <a className="text-amber-300 underline inline-flex items-center gap-0.5" href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer">Stripe → Developers → Webhooks<ExternalLink className="h-3 w-3" /></a> → <b className="text-zinc-200">Add endpoint</b>.</li><li>Endpoint URL: use the address below (must be public HTTPS).</li><li>Select these events, then create it and copy the <b className="text-zinc-200">Signing secret</b> (<code>whsec_…</code>).</li></ol>
        <div className="space-y-2"><div className="flex items-center gap-2 rounded-xl bg-black border border-zinc-800 px-3 py-2.5"><code className="flex-1 text-[11px] text-emerald-300 break-all">{v.webhookUrl}</code><button onClick={() => copy(v.webhookUrl)} className="text-amber-300 shrink-0" aria-label="Copy"><Copy className="h-4 w-4" /></button></div>
          <div className="flex flex-wrap gap-1.5">{v.events.map(e => <button key={e} onClick={() => copy(e)} className="text-[10px] font-mono px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:border-amber-500/40" title="Click to copy">{e}</button>)}</div></div>
        {v.webhookUrl.includes('(set APP_URL)') || /localhost|127\.0\.0\.1/.test(v.webhookUrl) ? <p className="text-[11px] text-amber-300 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Your panel URL looks local. Set <code>APP_URL=https://your-domain</code> in the server environment (needed for redirects too). For local testing use the Stripe CLI: <code>stripe listen --forward-to localhost:3000/api/v1/stripe/webhook</code>.</p> : null}
        <Field label="Webhook signing secret" hint={v.hasWebhookSecret ? `Saved: ${v.webhookSecretMasked}. Leave empty to keep it.` : 'Required. Stored encrypted.'}><TextInput type="password" autoComplete="off" value={whsec} onChange={e => setWhsec(e.target.value)} placeholder={v.hasWebhookSecret ? v.webhookSecretMasked : 'whsec_…'} className="font-mono text-xs" /></Field>
        <Btn busy={busy === 'save2'} disabled={!whsec} variant="primary" onClick={() => put({ webhookSecret: whsec }, 'Webhook secret saved', 'save2')}>Save signing secret</Btn>
      </Step>

      <Step n={3} done={!!cur} title="Currency & display">
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Charge currency" hint="Must match the prices you set for plans."><Select value={cur} onChange={e => setCur(e.target.value)}>{CURRENCIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}</Select></Field><Field label="Publishable key (optional)"><TextInput value={pub} onChange={e => setPub(e.target.value)} placeholder="pk_test_…" className="font-mono text-xs" /></Field></div>
        <Btn busy={busy === 'save3'} variant="primary" onClick={() => put({ currency: cur, publishableKey: pub }, 'Saved', 'save3')}>Save</Btn>
      </Step>

      <Step n={4} done={v.enabled} title="Turn it on">
        <Toggle checked={v.enabled} onChange={on => put({ enabled: on }, on ? 'Card payments enabled' : 'Card payments disabled', 'toggle')} label="Enable “Pay with Card” on the Upgrade page" hint="Requires a saved secret key and webhook secret." />
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-[11px] text-zinc-400 space-y-1.5"><p className="flex items-center gap-1.5 text-zinc-300 font-semibold"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />Test it before going live</p><p>Use card <code className="text-amber-300">4242 4242 4242 4242</code>, any future date and any CVC. After paying, the customer lands directly on their server overview and the plan activates as soon as the webhook arrives.</p></div>
      </Step>
      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5"><Circle className="h-3 w-3" />UPI, bank, crypto and gift-card methods remain under Billing → Payment methods.</p>
    </div>
  );
};
