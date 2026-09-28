import React, { useEffect, useState } from 'react';
import {
  Link2, Save, RefreshCw, CheckCircle2, XCircle, Loader2, Server,
  AlertTriangle, Clock, RotateCw, ShieldCheck, Plus, Trash2, ExternalLink
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { PanelIntegrationSettings, ProvisionRecord, QuickLink } from '../../types';

const EMPTY_SETTINGS: PanelIntegrationSettings = {
  enabled: false,
  panelUrl: '',
  apiKey: '',
  defaultLocationIds: [],
  autoCreateAccount: true,
  autoCreateServer: true,
  startServerOnCompletion: true
};

let tempIdCounter = 0;
const makeTempId = () => `new_${Date.now()}_${tempIdCounter++}`;

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  awaiting_manual_setup: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  pending: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  creating_account: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  creating_server: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
};

export const PanelLinkSettings: React.FC = () => {
  const [settings, setSettings] = useState<PanelIntegrationSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [locationIdsInput, setLocationIdsInput] = useState('');

  const [provisions, setProvisions] = useState<ProvisionRecord[]>([]);
  const [provisionsLoading, setProvisionsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Admin-editable Quick Links — replaces a single hardcoded panel redirect.
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksSaving, setLinksSaving] = useState(false);
  const [linksMsg, setLinksMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSettings = async () => {
    const res = await apiRequest('/admin/panel-settings');
    if (res.success && res.data) {
      setSettings(res.data);
      setLocationIdsInput((res.data.defaultLocationIds || []).join(', '));
    }
    setLoading(false);
  };

  const fetchProvisions = async () => {
    const res = await apiRequest('/admin/provisions');
    if (res.success && Array.isArray(res.data)) setProvisions(res.data);
    setProvisionsLoading(false);
  };

  const fetchQuickLinks = async () => {
    const res = await apiRequest('/admin/settings/quick-links');
    if (res.success && Array.isArray(res.data)) setQuickLinks(res.data);
    setLinksLoading(false);
  };

  useEffect(() => {
    fetchSettings();
    fetchProvisions();
    fetchQuickLinks();
  }, []);

  const handleAddLink = () => {
    setQuickLinks(links => [...links, { id: makeTempId(), label: '', url: '' }]);
  };

  const handleUpdateLink = (id: string, field: 'label' | 'url', value: string) => {
    setQuickLinks(links => links.map(l => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const handleRemoveLink = (id: string) => {
    setQuickLinks(links => links.filter(l => l.id !== id));
  };

  const handleSaveLinks = async () => {
    setLinksSaving(true);
    setLinksMsg(null);

    const payload = quickLinks.map(l => ({
      // Don't send our client-side temp ids upstream — let the server mint real ones.
      id: l.id.startsWith('new_') ? undefined : l.id,
      label: l.label.trim(),
      url: l.url.trim()
    }));

    const res = await apiRequest('/admin/settings/quick-links', {
      method: 'PUT',
      body: JSON.stringify({ links: payload })
    });

    if (res.success && Array.isArray(res.data)) {
      setQuickLinks(res.data);
      setLinksMsg({ type: 'success', text: 'Quick links saved.' });
    } else {
      setLinksMsg({ type: 'error', text: res.error?.message || 'Failed to save quick links.' });
    }
    setLinksSaving(false);
    setTimeout(() => setLinksMsg(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    setTestResult(null);

    const defaultLocationIds = locationIdsInput
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));

    const res = await apiRequest('/admin/panel-settings', {
      method: 'PUT',
      body: JSON.stringify({ ...settings, defaultLocationIds })
    });

    if (res.success && res.data) {
      setSettings(res.data);
      setSaveMsg({ type: 'success', text: 'Panel connection settings saved.' });
    } else {
      setSaveMsg({ type: 'error', text: res.error?.message || 'Failed to save settings.' });
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 4000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await apiRequest('/admin/panel-settings/test', { method: 'POST' });
    if (res.success) {
      setTestResult({ type: 'success', text: res.message || 'Connected successfully.' });
    } else {
      setTestResult({ type: 'error', text: res.error?.message || 'Connection failed.' });
    }
    setTesting(false);
  };

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    const res = await apiRequest(`/admin/provisions/${id}/retry`, { method: 'POST' });
    if (res.success) {
      setTimeout(fetchProvisions, 1200);
    }
    setRetryingId(null);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-xs text-zinc-400 space-y-2">
        <Loader2 className="h-5 w-5 animate-spin text-amber-400 mx-auto" />
        <p>Loading panel connection settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Links — admin-editable, no auto-provisioning required */}
      <div className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Quick Links</h3>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Add, edit, or remove the external links customers see in their dashboard sidebar — a Discord bot panel, a VPS panel, a status page, anything. No fixed redirect: you choose exactly what shows up here.
          </p>
        </div>

        {linksLoading ? (
          <div className="p-6 text-center text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
        ) : (
          <div className="space-y-2.5">
            {quickLinks.length === 0 && (
              <p className="text-xs text-zinc-500 italic">No quick links yet — add one below.</p>
            )}
            {quickLinks.map((link) => (
              <div key={link.id} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                  type="text"
                  value={link.label}
                  onChange={(e) => handleUpdateLink(link.id, 'label', e.target.value)}
                  placeholder="Label (e.g. Discord Bot Panel)"
                  className="w-full sm:w-56 shrink-0 rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={link.url}
                  onChange={(e) => handleUpdateLink(link.id, 'url', e.target.value)}
                  placeholder="https://panel.example.com"
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => handleRemoveLink(link.id)}
                  title="Remove link"
                  className="shrink-0 h-9 w-9 sm:w-auto sm:px-3 flex items-center justify-center rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              onClick={handleAddLink}
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition-colors pt-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add Link
            </button>
          </div>
        )}

        {linksMsg && (
          <p className={`text-xs p-3 rounded-xl border font-semibold ${linksMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
            {linksMsg.text}
          </p>
        )}

        <button
          onClick={handleSaveLinks}
          disabled={linksSaving || linksLoading}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {linksSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {linksSaving ? 'Saving...' : 'Save Quick Links'}
        </button>
      </div>

      {/* Advanced: Pterodactyl/Pelican auto-provisioning (optional) */}
      <div className="p-5 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Advanced: Auto-Provisioning (optional)</h3>
          </div>
          <button
            onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
            className={`w-11 h-6 rounded-full p-1 flex items-center transition-all ${settings.enabled ? 'bg-amber-500' : 'bg-zinc-800'}`}
          >
            <div className={`h-4 w-4 rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 -mt-3">
          Connects checkout to your Pterodactyl/Pelican-compatible hosting panel via its Application API, so accounts and servers are created automatically when someone buys a plan.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Panel URL</label>
            <input
              type="text"
              value={settings.panelUrl}
              onChange={(e) => setSettings(s => ({ ...s, panelUrl: e.target.value }))}
              placeholder="https://panel.example.com"
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Application API Key</label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings(s => ({ ...s, apiKey: e.target.value }))}
              placeholder="ptla_..."
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-amber-500"
            />
            <p className="text-[10px] text-zinc-600 mt-1">Create this under Panel Admin → Application API in your panel. Needs full user + server create permissions.</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Default Deploy Location IDs</label>
          <input
            type="text"
            value={locationIdsInput}
            onChange={(e) => setLocationIdsInput(e.target.value)}
            placeholder="1, 2"
            className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-amber-500"
          />
          <p className="text-[10px] text-zinc-600 mt-1">Comma-separated location IDs from your panel, used when a product doesn't set its own. Products with an egg mapping are configured under Products.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            ['autoCreateAccount', 'Auto-create panel accounts'],
            ['autoCreateServer', 'Auto-create servers'],
            ['startServerOnCompletion', 'Start server on install']
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => setSettings(s => ({ ...s, [key]: e.target.checked }))}
                className="accent-amber-500"
              />
              {label}
            </label>
          ))}
        </div>

        {(saveMsg || testResult) && (
          <div className="space-y-2">
            {saveMsg && (
              <p className={`text-xs p-3 rounded-xl border font-semibold ${saveMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                {saveMsg.text}
              </p>
            )}
            {testResult && (
              <p className={`text-xs p-3 rounded-xl border font-semibold flex items-center gap-2 ${testResult.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                {testResult.type === 'success' ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {testResult.text}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !settings.panelUrl}
            className="flex-1 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>

      {/* Provisioning Activity */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Server className="h-4 w-4 text-amber-400" /> Recent Provisioning Activity
          </h3>
          <button onClick={fetchProvisions} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {provisionsLoading ? (
          <div className="p-6 text-center text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
        ) : provisions.length === 0 ? (
          <div className="p-6 text-center bg-zinc-900/60 border border-zinc-800 rounded-2xl text-xs text-zinc-500">
            No provisioning activity yet — this fills in as customers check out.
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Message</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {provisions.slice(0, 25).map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-900 transition-colors">
                    <td className="p-3 text-zinc-300">{p.userEmail}</td>
                    <td className="p-3 font-semibold text-white">{p.planName}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border capitalize ${STATUS_STYLE[p.status] || 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-zinc-400 max-w-xs truncate" title={p.errorMessage || p.message}>{p.message}</td>
                    <td className="p-3 text-right">
                      {(p.status === 'failed' || p.status === 'awaiting_manual_setup') && (
                        <button
                          onClick={() => handleRetry(p.id)}
                          disabled={retryingId === p.id}
                          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-semibold flex items-center gap-1.5 ml-auto disabled:opacity-50"
                        >
                          {retryingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
