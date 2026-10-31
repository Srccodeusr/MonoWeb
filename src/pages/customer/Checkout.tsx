import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ShieldCheck, Loader2, CheckCircle2, AlertTriangle, Tag,
  Server, Copy, ExternalLink, DollarSign, Clock, Bot as BotIcon, Rocket, Gift, Mail as MailIcon
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useTheme } from '../../lib/ThemeContext';
import { Plan, Product, PaymentGatewaySettings } from '../../types';

interface CheckoutProps {
  onNavigate: (page: string, params?: any) => void;
  params?: { planId?: string; billingCycle?: 'monthly' | 'yearly' };
}

// Shape actually returned by GET /public/products — panel internals
// (nestId/eggId/dockerImage/locationId/etc) are stripped server-side; the
// customer only ever sees an id + label (+ tier for locations) to pick from.
interface PublicDeployOption {
  id: string;
  label: string;
  tier?: 'free' | 'paid';
}
interface PublicProduct extends Omit<Product, 'panelEggOptions' | 'panelLocationOptions'> {
  eggOptions?: PublicDeployOption[];
  locationOptions?: PublicDeployOption[];
}

type ProvisionStatus = 'pending' | 'creating_account' | 'creating_server' | 'completed' | 'awaiting_manual_setup' | 'failed';

interface ProvisionState {
  id: string;
  status: ProvisionStatus;
  message: string;
  planName?: string;
  productName?: string;
  panelUrl?: string;
  panelUsername?: string;
  panelPassword?: string;
  panelServerName?: string;
  errorMessage?: string;
}

const STEP_LABEL: Record<ProvisionStatus, string> = {
  pending: 'Verifying your order...',
  creating_account: 'Creating your hosting panel account...',
  creating_server: 'Provisioning your server...',
  completed: 'All done!',
  awaiting_manual_setup: 'Finishing up...',
  failed: 'Something went wrong'
};

export const Checkout: React.FC<CheckoutProps> = ({ onNavigate, params }) => {
  const { user, refreshUser } = useAuth();
  const { accentClasses } = useTheme();

  const planId = params?.planId;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [product, setProduct] = useState<PublicProduct | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(params?.billingCycle === 'yearly' ? 'yearly' : 'monthly');
  const [loadingPlan, setLoadingPlan] = useState(true);

  const [couponCode, setCouponCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'deployment'>('details');

  // Deployment choices (see PublicProduct.eggOptions / locationOptions)
  const [serverName, setServerName] = useState('');
  const [serverDescription, setServerDescription] = useState('');
  const [selectedEggOptionId, setSelectedEggOptionId] = useState('');
  const [selectedLocationOptionId, setSelectedLocationOptionId] = useState('');

  const [provision, setProvision] = useState<ProvisionState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [copied, setCopied] = useState(false);

  // Payment method — Account Credits (price is deducted right away) or Gift
  // Card (Amazon/Google Play — paid entirely by the code, no credits involved).
  // Either way a paid order stays pending until a staff member verifies it and
  // approves it — only then is the service set up / credentials sent.
  const [paymentMethod, setPaymentMethod] = useState<'credits' | 'giftcard'>('credits');
  const [giftCardType, setGiftCardType] = useState<'amazon' | 'playstore'>('amazon');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [gateways, setGateways] = useState<PaymentGatewaySettings | null>(null);
  // Set once a paid order has been submitted — distinct from `provision` since
  // there's no provisioning record yet (that only starts once staff approve it).
  const [submittedForApproval, setSubmittedForApproval] = useState<{ planName: string; amount: number; method: 'credits' | 'giftcard' } | null>(null);

  useEffect(() => {
    const loadGateways = async () => {
      const res = await apiRequest('/billing/payment-methods');
      if (res.success && res.data) setGateways(res.data);
    };
    loadGateways();
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!planId) { setLoadingPlan(false); return; }
      const [plansRes, productsRes] = await Promise.all([
        apiRequest('/public/plans'),
        apiRequest('/public/products')
      ]);
      const foundPlan = (plansRes.data || []).find((p: Plan) => p.id === planId) || null;
      setPlan(foundPlan);
      if (foundPlan) {
        const foundProduct: PublicProduct | null = (productsRes.data || []).find((pr: PublicProduct) => pr.id === foundPlan.productId) || null;
        setProduct(foundProduct);
        // Auto-select when there's exactly one choice — nothing for the customer to pick.
        if (foundProduct?.eggOptions?.length === 1) setSelectedEggOptionId(foundProduct.eggOptions[0].id);
        if (foundProduct?.locationOptions?.length === 1) setSelectedLocationOptionId(foundProduct.locationOptions[0].id);
      }
      setLoadingPlan(false);
    };
    load();
  }, [planId]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const price = plan ? (billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly) : 0;
  const credits = user?.credits || 0;
  const canAfford = price <= credits;

  const startPolling = (provisionId: string) => {
    pollRef.current = setInterval(async () => {
      const res = await apiRequest(`/billing/provision/${provisionId}`);
      if (res.success && res.data) {
        setProvision(res.data);
        if (['completed', 'awaiting_manual_setup', 'failed'].includes(res.data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }
    }, 1500);
  };

  const handleCheckout = async () => {
    if (!plan) return;

    // Client-side guardrail matching the server's validation — jump the
    // customer to the Deployment tab if they haven't made a required choice.
    if (product?.eggOptions && product.eggOptions.length > 1 && !selectedEggOptionId) {
      setActiveTab('deployment');
      setCheckoutError('Choose which application to deploy.');
      return;
    }
    if (product?.locationOptions && product.locationOptions.length > 1 && !selectedLocationOptionId) {
      setActiveTab('deployment');
      setCheckoutError('Choose a deploy location.');
      return;
    }
    if (price > 0 && paymentMethod === 'giftcard' && !giftCardCode.trim()) {
      setCheckoutError('Enter your gift card code before submitting.');
      return;
    }

    setSubmitting(true);
    setCheckoutError(null);

    const useGiftCard = price > 0 && paymentMethod === 'giftcard';

    const res = await apiRequest('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        planId: plan.id,
        billingCycle,
        couponCode: couponCode.trim() || undefined,
        serverName: serverName.trim() || undefined,
        serverDescription: serverDescription.trim() || undefined,
        selectedEggOptionId: selectedEggOptionId || undefined,
        selectedLocationOptionId: selectedLocationOptionId || undefined,
        paymentMethod: useGiftCard ? 'giftcard' : undefined,
        giftCardType: useGiftCard ? giftCardType : undefined,
        transactionRef: useGiftCard ? giftCardCode.trim() : undefined
      })
    });

    if (!res.success) {
      setCheckoutError(res.error?.message || 'Checkout failed. Please try again.');
      setSubmitting(false);
      return;
    }

    await refreshUser();

    if (res.data?.pendingApproval) {
      setSubmittedForApproval({
        planName: plan.name,
        amount: typeof res.data.order?.amount === 'number' ? res.data.order.amount : price,
        method: useGiftCard ? 'giftcard' : 'credits'
      });
      setSubmitting(false);
      return;
    }

    const provisionId = res.data.provisionId;
    setProvision({ id: provisionId, status: 'pending', message: 'Verifying your order...' });
    startPolling(provisionId);
    setSubmitting(false);
  };

  const handleCopyPassword = () => {
    if (provision?.panelPassword) {
      navigator.clipboard.writeText(provision.panelPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // --- No plan selected / invalid plan ---
  if (!planId || (!loadingPlan && !plan)) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto text-center space-y-4 pt-16">
        <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto" />
        <h1 className="text-xl font-bold text-white">No plan selected</h1>
        <p className="text-xs text-zinc-400">Head back to pricing and pick a plan to check out.</p>
        <button
          onClick={() => onNavigate('pricing')}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r ${accentClasses.gradient}`}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Pricing
        </button>
      </div>
    );
  }

  if (loadingPlan || !plan) {
    return (
      <div className="p-8 text-center text-xs text-zinc-400 space-y-2 pt-16">
        <Loader2 className="h-5 w-5 animate-spin text-violet-400 mx-auto" />
        <p>Loading plan details...</p>
      </div>
    );
  }

  // --- Payment submitted, awaiting staff verification (no provisioning record
  // exists yet — that only starts once a staff member approves the order) ---
  if (submittedForApproval) {
    return (
      <div className="p-4 sm:p-6 max-w-xl mx-auto pt-10">
        <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-8 space-y-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-white">Payment done successfully</h2>
            <p className="text-xs text-zinc-400">
              Please wait for a staff member to verify your {submittedForApproval.method === 'giftcard' ? 'gift card' : 'payment'} for{' '}
              <strong className="text-white">{submittedForApproval.planName}</strong> and send you your credentials.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            <Clock className="h-3.5 w-3.5" /> Awaiting staff verification
          </div>

          <p className="text-[11px] text-zinc-500">
            You don't need to stay on this page — we'll message you in your Mail inbox as soon as your order is approved.
            {submittedForApproval.method === 'credits' && submittedForApproval.amount > 0 && (
              <> If it can't be approved, your ${submittedForApproval.amount.toFixed(2)} is refunded to your account credits.</>
            )}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onNavigate('mail')}
              className="py-2.5 rounded-xl font-semibold text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 hover:text-white hover:border-zinc-700 inline-flex items-center justify-center gap-1.5"
            >
              <MailIcon className="h-3.5 w-3.5" /> Open Mail
            </button>
            <button
              onClick={() => onNavigate('servers')}
              className="py-2.5 rounded-xl font-semibold text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 hover:text-white hover:border-zinc-700"
            >
              View my servers
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Provisioning / loading screen (shown once checkout has been submitted) ---
  if (provision) {
    const isTerminal = ['completed', 'awaiting_manual_setup', 'failed'].includes(provision.status);
    const isFailed = provision.status === 'failed';
    const isManual = provision.status === 'awaiting_manual_setup';
    const hasCredentials = provision.status === 'completed' && provision.panelUsername;

    return (
      <div className="p-4 sm:p-6 max-w-xl mx-auto pt-10">
        <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-8 space-y-6 text-center">
          {!isTerminal && (
            <>
              <Loader2 className="h-10 w-10 text-violet-400 animate-spin mx-auto" />
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">{STEP_LABEL[provision.status] || 'Setting things up...'}</h2>
                <p className="text-xs text-zinc-400">This usually only takes a few seconds. Don't close this page.</p>
              </div>
              <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-500 font-mono">
                {(['pending', 'creating_account', 'creating_server'] as ProvisionStatus[]).map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 && <div className="w-6 h-px bg-zinc-700" />}
                    <div className={`h-2 w-2 rounded-full ${
                      provision.status === s ? 'bg-violet-400 animate-pulse' :
                      (['pending', 'creating_account', 'creating_server'].indexOf(provision.status) > i) ? 'bg-emerald-400' : 'bg-zinc-700'
                    }`} />
                  </React.Fragment>
                ))}
              </div>
            </>
          )}

          {provision.status === 'completed' && (
            <>
              <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">{hasCredentials ? "You're all set!" : 'Payment confirmed'}</h2>
                <p className="text-xs text-zinc-400">{provision.message}</p>
              </div>

              {hasCredentials && (
                <div className="text-left space-y-3 bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Server className="h-4 w-4 text-violet-400" /> Panel Login Details
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <div className="flex justify-between items-center bg-zinc-900 rounded-xl px-3 py-2">
                      <span className="text-zinc-400">Username</span>
                      <span className="font-mono text-white">{provision.panelUsername}</span>
                    </div>
                    {provision.panelPassword && (
                      <div className="flex justify-between items-center bg-zinc-900 rounded-xl px-3 py-2">
                        <span className="text-zinc-400">Password</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-emerald-400">{provision.panelPassword}</span>
                          <button onClick={handleCopyPassword} className="text-zinc-400 hover:text-white">
                            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {provision.panelServerName && (
                      <div className="flex justify-between items-center bg-zinc-900 rounded-xl px-3 py-2">
                        <span className="text-zinc-400">Server</span>
                        <span className="font-mono text-white">{provision.panelServerName}</span>
                      </div>
                    )}
                  </div>
                  {provision.panelPassword && (
                    <p className="text-[10px] text-amber-400">Save this password now — for your security it won't be shown again after you leave this page.</p>
                  )}
                  {provision.panelUrl && (
                    <a
                      href={provision.panelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r ${accentClasses.gradient}`}
                    >
                      Go to Panel <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          {isManual && (
            <>
              <Clock className="h-12 w-12 text-amber-400 mx-auto" />
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">Payment done successfully</h2>
                {/* The panel isn't linked/auto-provisioned for this order — a human has
                    to finish it, so always show this fixed message rather than the
                    internal provisioning-step message. */}
                <p className="text-xs text-zinc-400">Please wait for a staff member to verify your order and mail you your server or VPS credentials.</p>
              </div>
              {provision.panelUsername && (
                <div className="text-left space-y-2 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs">
                  <div className="flex justify-between items-center bg-zinc-900 rounded-xl px-3 py-2">
                    <span className="text-zinc-400">Panel Username</span>
                    <span className="font-mono text-white">{provision.panelUsername}</span>
                  </div>
                  {provision.panelPassword && (
                    <div className="flex justify-between items-center bg-zinc-900 rounded-xl px-3 py-2">
                      <span className="text-zinc-400">Panel Password</span>
                      <span className="font-mono text-emerald-400">{provision.panelPassword}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {isFailed && (
            <>
              <AlertTriangle className="h-12 w-12 text-rose-400 mx-auto" />
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">We hit a snag</h2>
                <p className="text-xs text-zinc-400">{provision.message}</p>
                <p className="text-[11px] text-zinc-500">Your payment was recorded — please contact support and we'll get this sorted out.</p>
              </div>
            </>
          )}

          <button
            onClick={() => onNavigate('servers')}
            className="w-full py-2.5 rounded-xl font-semibold text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 hover:text-white hover:border-zinc-700"
          >
            View my servers
          </button>
        </div>
      </div>
    );
  }

  // --- Review & confirm ---
  const cyclePrice = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <button onClick={() => onNavigate('pricing')} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Pricing
      </button>

      <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              {product?.category === 'bot' ? <BotIcon className="h-5 w-5 text-amber-400" /> : <Server className="h-5 w-5 text-amber-400" />}
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">{plan.name}</h1>
              <p className="text-[11px] text-zinc-400">{product?.name || 'Hosting Plan'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-zinc-950 rounded-xl p-1 border border-zinc-800 text-[11px]">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-3 py-1.5 rounded-lg font-semibold ${billingCycle === 'monthly' ? 'bg-violet-600 text-white' : 'text-zinc-400'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-3 py-1.5 rounded-lg font-semibold ${billingCycle === 'yearly' ? 'bg-violet-600 text-white' : 'text-zinc-400'}`}
            >
              Yearly
            </button>
          </div>
        </div>

        {/* Order Details / Deployment tabs */}
        <div className="flex items-center gap-2 bg-zinc-950 rounded-xl p-1 border border-zinc-800 text-[11px] w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`px-3 py-1.5 rounded-lg font-semibold ${activeTab === 'details' ? 'bg-violet-600 text-white' : 'text-zinc-400'}`}
          >
            Order Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('deployment')}
            className={`px-3 py-1.5 rounded-lg font-semibold ${activeTab === 'deployment' ? 'bg-violet-600 text-white' : 'text-zinc-400'}`}
          >
            Deployment
          </button>
        </div>

        {activeTab === 'details' && (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs text-zinc-300">
              <div className="bg-zinc-950 rounded-xl p-3 border border-zinc-800">{plan.ramMB >= 1024 ? `${plan.ramMB / 1024}GB RAM` : `${plan.ramMB}MB RAM`}</div>
              <div className="bg-zinc-950 rounded-xl p-3 border border-zinc-800">{plan.cpuCores} vCPU Core{plan.cpuCores > 1 ? 's' : ''}</div>
              <div className="bg-zinc-950 rounded-xl p-3 border border-zinc-800">{plan.diskGB}GB NVMe Storage</div>
              <div className="bg-zinc-950 rounded-xl p-3 border border-zinc-800">{plan.backupLimit} Backup Slot{plan.backupLimit > 1 ? 's' : ''}</div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
                <Tag className="h-3.5 w-3.5 text-violet-400" /> Promo Code (optional)
              </label>
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="Enter a promo code..."
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white uppercase font-mono placeholder-zinc-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          </>
        )}

        {activeTab === 'deployment' && (
          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
                <Server className="h-3.5 w-3.5 text-violet-400" /> Server Name (optional)
              </label>
              <input
                type="text"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Leave blank to auto-generate"
                maxLength={60}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-2">Server Description (optional)</label>
              <textarea
                value={serverDescription}
                onChange={(e) => setServerDescription(e.target.value)}
                placeholder="What's this server for?"
                maxLength={250}
                rows={2}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            {product?.eggOptions && product.eggOptions.length > 1 && (
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
                  <Rocket className="h-3.5 w-3.5 text-violet-400" /> Application
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {product.eggOptions.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedEggOptionId(opt.id)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold border text-left ${
                        selectedEggOptionId === opt.id
                          ? 'bg-violet-600/20 border-violet-500 text-white'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {product?.locationOptions && product.locationOptions.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-2">Location</label>
                <div className="grid grid-cols-2 gap-2">
                  {product.locationOptions.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedLocationOptionId(opt.id)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold border text-left flex items-center justify-between gap-2 ${
                        selectedLocationOptionId === opt.id
                          ? 'bg-violet-600/20 border-violet-500 text-white'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {opt.tier && (
                        <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-mono ${opt.tier === 'paid' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {opt.tier === 'paid' ? 'Paid' : 'Free'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(!product?.eggOptions || product.eggOptions.length <= 1) && (!product?.locationOptions || product.locationOptions.length <= 1) && (
              <p className="text-xs text-zinc-500 italic">No deployment choices needed for this plan — we'll set everything up automatically.</p>
            )}
          </div>
        )}

        {cyclePrice > 0 && (
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-2">Payment Method</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('credits')}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all ${
                  paymentMethod === 'credits' ? 'border-violet-500 bg-violet-500/10 text-white font-bold' : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                }`}
              >
                <DollarSign className="h-5 w-5 text-violet-400" />
                <span className="text-xs">Account Credits</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('giftcard')}
                className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition-all ${
                  paymentMethod === 'giftcard' ? 'border-amber-500 bg-amber-500/10 text-white font-bold' : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                }`}
              >
                <Gift className="h-5 w-5 text-amber-400" />
                <span className="text-xs">Gift Card</span>
              </button>
            </div>
          </div>
        )}

        {(cyclePrice === 0 || paymentMethod === 'credits') && (
          <div className="bg-zinc-950 rounded-2xl border border-zinc-800 p-4 space-y-2">
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Plan price ({billingCycle})</span>
              <span className="font-mono text-white">${cyclePrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Your credit balance</span>
              <span className={`font-mono ${canAfford ? 'text-emerald-400' : 'text-rose-400'}`}>${credits.toFixed(2)}</span>
            </div>
            {cyclePrice > 0 && (
              <p className="text-[10px] text-zinc-500 pt-1">
                A staff member verifies every order before it's set up. Your credits are refunded if it can't be approved.
              </p>
            )}
            {!canAfford && cyclePrice > 0 && (
              <p className="text-[11px] text-rose-400 pt-1">
                You need ${(cyclePrice - credits).toFixed(2)} more in credits.{' '}
                <button onClick={() => onNavigate('billing')} className="underline hover:text-rose-300">Add credits</button>
              </p>
            )}
          </div>
        )}

        {cyclePrice > 0 && paymentMethod === 'giftcard' && (
          <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3 text-xs">
            <div className="flex justify-between text-xs text-zinc-300">
              <span>Plan price ({billingCycle})</span>
              <span className="font-mono text-white font-bold">${cyclePrice.toFixed(2)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setGiftCardType('amazon')}
                disabled={gateways?.giftCard && !gateways.giftCard.amazonEnabled}
                className={`p-2.5 rounded-xl border font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  giftCardType === 'amazon' ? 'border-amber-500 bg-amber-500/10 text-white' : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                }`}
              >
                Amazon Gift Card
              </button>
              <button
                type="button"
                onClick={() => setGiftCardType('playstore')}
                disabled={gateways?.giftCard && !gateways.giftCard.playStoreEnabled}
                className={`p-2.5 rounded-xl border font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  giftCardType === 'playstore' ? 'border-amber-500 bg-amber-500/10 text-white' : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                }`}
              >
                Google Play Gift Card
              </button>
            </div>

            <p className="text-[11px] text-zinc-400 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              Buy {giftCardType === 'amazon' ? 'an Amazon' : 'a Google Play'} gift card worth ${cyclePrice.toFixed(2)} and enter the code below.{' '}
              {giftCardType === 'amazon' ? gateways?.giftCard?.amazonInstructions : gateways?.giftCard?.playStoreInstructions}
            </p>

            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1">Enter Gift Card Code *</label>
              <input
                type="text"
                value={giftCardCode}
                onChange={(e) => setGiftCardCode(e.target.value)}
                placeholder="e.g. XXXX-XXXXXX-XXXX"
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-zinc-500 mt-1">No credits are used — a staff member verifies this code and your server is set up once approved.</p>
            </div>
          </div>
        )}

        {checkoutError && (
          <p className="text-xs p-3 rounded-xl border font-semibold bg-rose-500/10 text-rose-400 border-rose-500/20">
            {checkoutError}
          </p>
        )}

        <button
          onClick={handleCheckout}
          disabled={
            submitting ||
            (cyclePrice > 0 && paymentMethod === 'credits' && !canAfford) ||
            (cyclePrice > 0 && paymentMethod === 'giftcard' && !giftCardCode.trim())
          }
          className={`w-full py-3.5 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50 bg-gradient-to-r ${accentClasses.gradient}`}
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
          ) : cyclePrice === 0 ? (
            <><ShieldCheck className="h-4 w-4" /> Activate Free Plan</>
          ) : paymentMethod === 'giftcard' ? (
            <><Gift className="h-4 w-4" /> Submit Gift Card for Verification</>
          ) : (
            <><ShieldCheck className="h-4 w-4" /> Confirm & Pay ${cyclePrice.toFixed(2)}</>
          )}
        </button>
      </div>
    </div>
  );
};
