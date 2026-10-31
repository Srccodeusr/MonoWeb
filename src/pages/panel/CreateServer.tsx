import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Cpu, MemoryStick, HardDrive, Layers, Rocket, FileText, Settings2, Loader2, Gift, Lock } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { usePanel } from '../../components/panel/PanelContext';
import { AdBanner } from '../../components/AdBanner';
import { Btn, Card, Field, Select, Spinner, TextArea, TextInput, cx, fmtMB, useToast } from '../../components/ui/kit';

interface Catalog {
  plan: { name: string; isFree: boolean; serverLimit: number; used: number; perServer: { ramMB: number; cpuPercent: number; diskMB: number }; chooseNode: boolean };
  locations: { name: string; flag: string; nodes: number }[];
  nodes: { id: string; name: string; location: string; runtime?: string }[];
  images: { id: string; name: string; software: string; category: string; description: string; minRamMB: number; runtime: string; versions: string[]; defaultVersion: string; variables: { name: string; env: string; default: string; description: string }[] }[];
  packs: { id: string; name: string; pack: { ramMB: number; cpuPercent: number; diskMB: number; validityDays: number } }[];
  maxNameLength: number;
}

export const CreateServer: React.FC<{ onNavigate: (p: string, params?: any) => void }> = ({ onNavigate }) => {
  const { refresh } = usePanel();
  const [toast, say] = useToast();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [imageId, setImageId] = useState('');
  const [version, setVersion] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [packId, setPackId] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});

  useEffect(() => {
    apiRequest<Catalog>('/hosting/catalog').then(r => {
      if (r.success && r.data) { setCat(r.data); setLocation(r.data.locations.length === 1 ? r.data.locations[0].name : ''); }
      else say('error', r.error?.message || 'Could not load options.');
    });
  }, []);

  const categories = useMemo(() => [...new Set((cat?.images || []).map(i => i.category))], [cat]);
  const softwareList = useMemo(() => (cat?.images || []).filter(i => i.category === category), [cat, category]);
  const image = cat?.images.find(i => i.id === imageId);
  const pack = cat?.packs.find(p => p.id === packId);

  if (!cat) return <Spinner />;
  const specs = pack ? { cpu: pack.pack.cpuPercent, ram: pack.pack.ramMB, disk: pack.pack.diskMB } : { cpu: cat.plan.perServer.cpuPercent, ram: cat.plan.perServer.ramMB, disk: cat.plan.perServer.diskMB };
  const atLimit = !pack && cat.plan.used >= cat.plan.serverLimit;
  const nameOk = name.trim().length >= 1 && name.length <= cat.maxNameLength;
  const lowRam = image && specs.ram < image.minRamMB;
  const deployOk = !!image && (!!location || !!nodeId) && !lowRam && !atLimit;

  const pickImage = (id: string) => {
    setImageId(id); const img = cat.images.find(i => i.id === id);
    setVersion(img?.defaultVersion || ''); setVars(Object.fromEntries((img?.variables || []).map(v => [v.env, v.default])));
  };

  const deploy = async () => {
    setBusy(true);
    const r = await apiRequest('/hosting/servers', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim(), imageId, version, location: nodeId ? undefined : location, nodeId: nodeId || undefined, variables: vars, entitlementId: packId || undefined }) });
    setBusy(false);
    if (r.success && r.data) { await refresh(); onNavigate('server', { id: r.data.id }); }
    else say('error', r.error?.message || 'Could not create the server.');
  };

  const SpecRow = ({ icon: I, label, value }: { icon: any; label: string; value: string }) => (
    <div className="flex items-center justify-between rounded-xl bg-zinc-950 px-3.5 py-3 text-xs"><span className="flex items-center gap-2 text-zinc-400"><I className="h-3.5 w-3.5 text-zinc-600" />{label}</span><span className="font-mono text-zinc-100">{value}</span></div>
  );

  return (
    <div className="space-y-4">
      {toast}
      <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
        {/* Left: steps + plan specs (same structure as the reference wizard) */}
        <Card className="space-y-5">
          <div>
            <h2 className="text-sm font-bold text-white">Server Creation</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Configure your new instance</p>
            <div className="mt-3 space-y-1.5">
              {[{ i: FileText, t: 'Basic Details' }, { i: Settings2, t: 'Deployment' }].map((s, idx) => {
                const I = s.i; const on = step === idx;
                return <button key={s.t} onClick={() => idx === 0 || nameOk ? setStep(idx) : say('error', 'Enter a server name first.')} className={cx('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors', on ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200')}><I className="h-3.5 w-3.5" />{s.t}</button>;
              })}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">{pack ? 'Server Pack Specs' : 'Plan Specs'}</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">{pack ? pack.name : `${cat.plan.name} plan resource allocation`}</p>
            <div className="mt-3 space-y-1.5">
              <SpecRow icon={Cpu} label="CPU Limit" value={`${specs.cpu}%`} />
              <SpecRow icon={MemoryStick} label="Memory" value={fmtMB(specs.ram)} />
              <SpecRow icon={HardDrive} label="Storage" value={fmtMB(specs.disk)} />
              <SpecRow icon={Layers} label="Slots" value={pack ? 'Pack' : `${cat.plan.used} / ${cat.plan.serverLimit}`} />
            </div>
          </div>
        </Card>

        {/* Right: the step */}
        <div className="space-y-3">
          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-amber-500 transition-all duration-500" style={{ width: step === 0 ? '50%' : '100%' }} /></div>

          {atLimit && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
              <span>You have used all {cat.plan.serverLimit} server slot{cat.plan.serverLimit === 1 ? '' : 's'} on the {cat.plan.name} plan.</span>
              <span className="flex gap-2"><Btn size="sm" variant="primary" onClick={() => onNavigate('upgrade')}>Upgrade</Btn><Btn size="sm" onClick={() => onNavigate('store')}>Buy a slot</Btn></span>
            </div>
          )}

          {step === 0 && (
            <Card className="space-y-5">
              <h2 className="text-base font-bold text-white">Server Details</h2>
              <Field label="Server name" hint="A friendly identifier." right={<span>{name.length}/{cat.maxNameLength}</span>}>
                <TextInput value={name} maxLength={cat.maxNameLength} onChange={e => setName(e.target.value)} placeholder="My awesome server" autoFocus />
              </Field>
              <Field label="Description (optional)" hint="Displayed on your server list." right={<span>{description.length}/191</span>}>
                <TextInput value={description} maxLength={191} onChange={e => setDescription(e.target.value)} placeholder="Free 24/7 hosting" />
              </Field>
              {cat.packs.length > 0 && (
                <Field label="Server pack" hint="Use a boosted server you bought in the store instead of a normal plan slot.">
                  <Select value={packId} onChange={e => setPackId(e.target.value)}><option value="">Use my plan slot</option>{cat.packs.map(p => <option key={p.id} value={p.id}>{p.name} · {fmtMB(p.pack.ramMB)} RAM · {p.pack.validityDays} days</option>)}</Select>
                </Field>
              )}
              <div className="flex justify-end pt-3 border-t border-zinc-800"><Btn variant="dark" disabled={!nameOk} onClick={() => setStep(1)}>Next Step<ArrowRight className="h-3.5 w-3.5" /></Btn></div>
            </Card>
          )}

          {step === 1 && (
            <Card className="space-y-5">
              <h2 className="text-base font-bold text-white flex items-center gap-2"><Settings2 className="h-4 w-4 text-amber-400" />Software Configuration</h2>
              {cat.locations.length === 0 && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">No locations are available right now. Please check back soon.</p>}
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Location">
                  <Select value={location} onChange={e => { setLocation(e.target.value); setNodeId(''); }}><option value="">Select a Location…</option>{cat.locations.map(l => <option key={l.name} value={l.name}>{l.flag} {l.name}</option>)}</Select>
                </Field>
                <Field label="Category">
                  <Select value={category} onChange={e => { setCategory(e.target.value); setImageId(''); }}><option value="">Select Category…</option>{categories.map(c => <option key={c}>{c}</option>)}</Select>
                </Field>
                <Field label="Software (Egg)">
                  <Select value={imageId} onChange={e => pickImage(e.target.value)} disabled={!category}><option value="">Select Software…</option>{softwareList.map(i => <option key={i.id} value={i.id}>{i.software}</option>)}</Select>
                </Field>
              </div>

              {image && (
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs text-zinc-400">{image.description}</p>
                  {image.versions.length > 1 && <Field label="Version"><Select value={version} onChange={e => setVersion(e.target.value)}>{image.versions.map(v => <option key={v}>{v}</option>)}</Select></Field>}
                  {image.variables.map(v => (
                    <Field key={v.env} label={v.name} hint={v.description}><TextInput value={vars[v.env] ?? ''} onChange={e => setVars(p => ({ ...p, [v.env]: e.target.value }))} className="font-mono text-xs" /></Field>
                  ))}
                  {lowRam && <p className="text-xs text-red-300">{image.name} needs at least {fmtMB(image.minRamMB)} RAM. Your {pack ? 'pack' : 'plan'} provides {fmtMB(specs.ram)}.</p>}
                </div>
              )}

              {cat.plan.chooseNode && cat.nodes.length > 0 && (
                <Field label="Choose a specific node (Premium)">
                  <Select value={nodeId} onChange={e => setNodeId(e.target.value)}><option value="">Automatic (best available)</option>{cat.nodes.filter(n => !location || n.location === location).map(n => <option key={n.id} value={n.id}>{n.name} · {n.location}</option>)}</Select>
                </Field>
              )}
              {!cat.plan.chooseNode && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Lock className="h-3 w-3" />Choosing a specific node is a Premium perk.</p>}

              <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
                <Btn variant="dark" onClick={() => setStep(0)}><ArrowLeft className="h-3.5 w-3.5" />Back</Btn>
                <Btn variant="primary" disabled={!deployOk} busy={busy} onClick={deploy}>{busy ? 'Deploying…' : <><Rocket className="h-3.5 w-3.5" />Deploy Server</>}</Btn>
              </div>
            </Card>
          )}
          {cat.plan.isFree && <AdBanner placement="create" />}
          {cat.plan.isFree && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Gift className="h-3 w-3" />Free servers must be renewed periodically by watching an ad or reading an article.</p>}
        </div>
      </div>
    </div>
  );
};
