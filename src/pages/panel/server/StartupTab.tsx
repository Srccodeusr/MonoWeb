import React, { useCallback, useEffect, useState } from 'react';
import { Terminal, Cog, Save, Info } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Btn, Card, Select, Spinner, TextInput, cx } from '../../../components/ui/kit';
import { TabHeader } from '../../../components/ui/panelKit';

interface V { name: string; env: string; description: string; editable: boolean; value: string; kind: 'text' | 'boolean' | 'secret' }
interface Data { command: string; dockerImage: string; dockerImages: string[]; variables: V[] }

const Switch: React.FC<{ on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, disabled, onChange, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="flex items-center gap-3 disabled:opacity-50">
    <span className={cx('relative h-5 w-9 rounded-full transition-colors shrink-0', on ? 'bg-amber-500' : 'bg-zinc-700')}><span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', on ? 'left-[18px]' : 'left-0.5')} /></span>
    <span className="text-xs text-zinc-400">{on ? 'Enabled' : 'Disabled'}</span>
  </button>
);

export const StartupTab: React.FC<{ serverId: string; canEdit: boolean; notify: (t: 'success' | 'error', m: string) => void; onSaved: () => void }> = ({ serverId, canEdit, notify, onSaved }) => {
  const [d, setD] = useState<Data | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);
  const apply = (x: Data) => { setD(x); setVals(Object.fromEntries(x.variables.map(v => [v.env, v.value]))); setImage(x.dockerImage); };
  const load = useCallback(async () => { const r = await apiRequest<Data>(`/hosting/servers/${serverId}/startup`); if (r.success && r.data) apply(r.data); else notify('error', r.error?.message || 'Could not load startup settings.'); }, [serverId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Spinner />;

  const changed = image !== d.dockerImage || d.variables.some(v => v.editable && (vals[v.env] ?? '') !== v.value);
  const save = async () => {
    setSaving(true);
    const variables = Object.fromEntries(d.variables.filter(v => v.editable).map(v => [v.env, vals[v.env] ?? '']));
    const r = await apiRequest<Data>(`/hosting/servers/${serverId}/startup`, { method: 'PUT', body: JSON.stringify({ variables, dockerImage: image || undefined }) });
    setSaving(false);
    if (r.success && r.data) { apply(r.data); notify('success', 'Startup settings saved. Restart the server to apply them.'); onSaved(); } else notify('error', r.error?.message || 'Could not save.');
  };

  return (
    <div className="space-y-5">
      <TabHeader title="Startup" subtitle="Configure server startup parameters and variables" actions={canEdit ? <Btn variant="primary" busy={saving} disabled={!changed} onClick={save}><Save className="h-3.5 w-3.5" />Save changes</Btn> : undefined} />

      <Card className="space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Terminal className="h-4 w-4 text-amber-400" />Startup command</h3>
        <pre className="rounded-xl bg-black border border-zinc-800 p-4 text-[11.5px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto" tabIndex={0}>{d.command || 'No startup command is set for this software.'}</pre>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Cog className="h-4 w-4 text-zinc-400" />Docker image</h3>
        <Select value={image} disabled={!canEdit || d.dockerImages.length === 0} onChange={e => setImage(e.target.value)} aria-label="Docker image">
          {!d.dockerImage && <option value="">Custom image</option>}
          {d.dockerImages.map(i => <option key={i} value={i}>{i}</option>)}
        </Select>
        <p className="text-[11px] text-zinc-500">Select a different Docker image to use when running this server.</p>
      </Card>

      <div>
        <h3 className="text-lg font-bold text-white mb-3">Environment variables</h3>
        {d.variables.length === 0 ? <Card><p className="text-xs text-zinc-500 text-center py-6">This software has no variables to configure.</p></Card> : (
          <div className="grid md:grid-cols-2 gap-3.5">
            {d.variables.map(v => (
              <Card key={v.env} className="space-y-2.5 !p-4">
                <p className="text-sm font-bold text-white">{v.name}</p>
                {v.kind === 'boolean'
                  ? <Switch on={['1', 'true'].includes((vals[v.env] ?? '').toLowerCase())} disabled={!canEdit || !v.editable} label={v.name} onChange={on => setVals(p => ({ ...p, [v.env]: on ? '1' : '0' }))} />
                  : <TextInput type={v.kind === 'secret' ? 'password' : 'text'} value={vals[v.env] ?? ''} disabled={!canEdit || !v.editable} autoComplete="off" spellCheck={false} maxLength={500} aria-label={v.name}
                      onChange={e => setVals(p => ({ ...p, [v.env]: e.target.value }))} className="font-mono text-xs" />}
                <p className="text-[11px] text-zinc-500 flex items-start gap-1.5"><Info className="h-3 w-3 mt-0.5 shrink-0" /><span>{v.description || v.env}</span></p>
              </Card>))}
          </div>)}
      </div>
    </div>
  );
};
