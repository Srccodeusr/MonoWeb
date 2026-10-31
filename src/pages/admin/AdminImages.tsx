import React, { useCallback, useEffect, useState } from 'react';
import { Boxes, Plus, Pencil, Trash2, Copy, Upload } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, PageHeader, Select, Spinner, TextArea, TextInput, Toggle, cx, useToast } from '../../components/ui/kit';
import type { HostImage } from '../../hostingTypes';

const blank = (): any => ({ name: '', software: '', category: 'Coding Languages', description: '', runtime: 'any', minRamMB: 128, isActive: true, dockerImages: { 'Latest': '' }, defaultImage: 'Latest', startup: '', stopCommand: 'stop', ports: [{ label: 'App', container: 3000, proto: 'tcp' }], variables: [], install: { image: '', entrypoint: 'bash', script: '#!/bin/bash\ncd /mnt/server\n', files: [] } });

export const AdminImages: React.FC = () => {
  const [toast, say] = useToast();
  const [items, setItems] = useState<HostImage[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [tab, setTab] = useState<'basic' | 'runtime' | 'vars' | 'install'>('basic');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiRequest<HostImage[]>('/admin/hosting/images'); if (r.success && r.data) setItems(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  if (!items) return <Spinner />;

  const e = (k: string, v: any) => setEdit((c: any) => ({ ...c, [k]: v }));
  const imgs = edit ? Object.entries(edit.dockerImages as Record<string, string>) : [];
  const setImgs = (list: [string, string][]) => { const o = Object.fromEntries(list); setEdit((c: any) => ({ ...c, dockerImages: o, defaultImage: o[c.defaultImage] !== undefined ? c.defaultImage : list[0]?.[0] || '' })); };
  const categories = [...new Set(items.map(i => i.category))];

  const save = async () => {
    setBusy(true);
    const r = await apiRequest(edit.id ? `/admin/hosting/images/${edit.id}` : '/admin/hosting/images', { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(edit) }); setBusy(false);
    if (r.success) { say('success', 'Image saved'); setEdit(null); load(); } else say('error', r.error?.message || 'Failed');
  };
  const del = async (i: HostImage) => { if (!window.confirm(`Delete "${i.name}"?`)) return; const r = await apiRequest(`/admin/hosting/images/${i.id}`, { method: 'DELETE' }); say(r.success ? 'success' : 'error', r.success ? 'Deleted' : r.error?.message || 'Failed'); load(); };
  const exportJson = (i: HostImage) => { const { id, createdAt, ...rest } = i as any; navigator.clipboard?.writeText(JSON.stringify(rest, null, 2)).then(() => say('success', 'Image JSON copied')); };
  const importJson = () => { const t = window.prompt('Paste image JSON (exported from another MonoNode panel)'); if (!t) return; try { setEdit({ ...blank(), ...JSON.parse(t) }); setTab('basic'); } catch { say('error', 'That is not valid JSON.'); } };

  return (
    <div className="space-y-5">
      {toast}
      <PageHeader icon={<Boxes className="h-6 w-6 text-amber-400" />} title="Software Images" subtitle="What users can deploy: Docker image(s), startup command, variables and install script. Choose Container / Process / Any to match your node runtimes."
        actions={<><Btn onClick={importJson}><Upload className="h-4 w-4" />Import</Btn><Btn variant="primary" onClick={() => { setEdit(blank()); setTab('basic'); }}><Plus className="h-4 w-4" />New image</Btn></>} />
      {items.length === 0 ? <Card><Empty icon={<Boxes className="h-12 w-12" />} title="No images" /></Card> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{items.map(i => (
          <Card key={i.id} className={cx('space-y-3', !i.isActive && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold text-white">{i.name}</p><p className="text-[11px] text-zinc-500">{i.category} · {i.software}</p></div><div className="flex flex-col items-end gap-1"><Badge tone={i.isActive ? 'green' : 'zinc'}>{i.isActive ? 'Enabled' : 'Disabled'}</Badge><Badge tone={i.runtime === 'any' ? 'zinc' : 'amber'}>{i.runtime}</Badge></div></div>
            <p className="text-xs text-zinc-400 line-clamp-2">{i.description}</p>
            <p className="text-[10px] font-mono text-zinc-600 truncate">{Object.values(i.dockerImages)[0]}</p>
            <div className="flex gap-1.5 pt-2 border-t border-zinc-800"><Btn size="sm" onClick={() => { setEdit(JSON.parse(JSON.stringify(i))); setTab('basic'); }}><Pencil className="h-3.5 w-3.5" />Edit</Btn><Btn size="sm" onClick={() => exportJson(i)}><Copy className="h-3.5 w-3.5" /></Btn><Btn size="sm" variant="danger" className="ml-auto" onClick={() => del(i)}><Trash2 className="h-3.5 w-3.5" /></Btn></div>
          </Card>))}
        </div>)}

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? `Edit ${edit.name}` : 'New image'} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!edit?.name} onClick={save}>Save image</Btn></>}>
        {edit && <div className="space-y-5">
          <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto no-scrollbar">{([['basic', 'Basics'], ['runtime', 'Docker & startup'], ['vars', 'Ports & variables'], ['install', 'Install script']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('px-3.5 py-2 text-xs font-semibold border-b-2 whitespace-nowrap', tab === k ? 'border-amber-400 text-amber-300' : 'border-transparent text-zinc-500')}>{l}</button>)}</div>
          {tab === 'basic' && <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Name"><TextInput value={edit.name} onChange={ev => e('name', ev.target.value)} /></Field><Field label="Software label (dropdown)"><TextInput value={edit.software} onChange={ev => e('software', ev.target.value)} placeholder="Node.js" /></Field>
              <Field label="Category" hint="Users pick a category first."><TextInput list="cats" value={edit.category} onChange={ev => e('category', ev.target.value)} /><datalist id="cats">{categories.map(c => <option key={c} value={c} />)}</datalist></Field>
              <Field label="Runs on" hint="'Container' images need Docker/Podman nodes; 'Process' images run on native-sandbox nodes."><Select value={edit.runtime} onChange={ev => e('runtime', ev.target.value)}><option value="any">Any node (recommended)</option><option value="container">Container nodes only</option><option value="process">Native-sandbox nodes only</option></Select></Field></div>
            <Field label="Description"><TextInput value={edit.description} onChange={ev => e('description', ev.target.value)} /></Field>
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Minimum RAM"><NumInput value={edit.minRamMB} onChange={v => e('minRamMB', v)} suffix="MB" /></Field><div className="pt-5"><Toggle checked={edit.isActive} onChange={v => e('isActive', v)} label="Enabled" hint="Visible in the create wizard" /></div></div>
          </div>}
          {tab === 'runtime' && <div className="space-y-4">
            <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Docker images (version label → image)</p>
              {imgs.map(([l, im], idx) => <div key={idx} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 mb-2"><TextInput value={l} onChange={ev => setImgs(imgs.map((p, j) => (j === idx ? [ev.target.value, p[1]] : p)) as any)} /><TextInput className="font-mono text-xs" value={im} onChange={ev => setImgs(imgs.map((p, j) => (j === idx ? [p[0], ev.target.value] : p)) as any)} placeholder="ghcr.io/org/image:tag" /><Btn size="sm" variant={edit.defaultImage === l ? 'primary' : 'ghost'} onClick={() => e('defaultImage', l)}>Default</Btn><Btn size="sm" variant="danger" disabled={imgs.length <= 1} onClick={() => setImgs(imgs.filter((_, j) => j !== idx) as any)}><Trash2 className="h-3.5 w-3.5" /></Btn></div>)}
              <Btn size="sm" onClick={() => setImgs([...imgs, [`v${imgs.length + 1}`, '']] as any)}><Plus className="h-3.5 w-3.5" />Add version</Btn></div>
            <Field label="Startup command" hint="Placeholders: {{VARIABLE}}, {{SERVER_PORT}}, {{SERVER_MEMORY}}"><TextArea value={edit.startup} onChange={ev => e('startup', ev.target.value)} /></Field>
            <Field label="Stop command" hint="Console command sent to stop gracefully, or ^C to send Ctrl+C."><TextInput value={edit.stopCommand} onChange={ev => e('stopCommand', ev.target.value)} className="font-mono text-xs" /></Field>
          </div>}
          {tab === 'vars' && <div className="space-y-5">
            <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Ports to publish (a free host port is allocated for each)</p>
              {edit.ports.map((p: any, i: number) => <div key={i} className="grid grid-cols-[1fr_110px_90px_auto] gap-2 mb-2"><TextInput value={p.label} onChange={ev => e('ports', edit.ports.map((x: any, j: number) => (j === i ? { ...x, label: ev.target.value } : x)))} /><NumInput value={p.container} onChange={v => e('ports', edit.ports.map((x: any, j: number) => (j === i ? { ...x, container: v } : x)))} /><Select value={p.proto} onChange={ev => e('ports', edit.ports.map((x: any, j: number) => (j === i ? { ...x, proto: ev.target.value } : x)))}><option>tcp</option><option>udp</option></Select><Btn size="sm" variant="danger" disabled={edit.ports.length <= 1} onClick={() => e('ports', edit.ports.filter((_: any, j: number) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Btn></div>)}
              <Btn size="sm" onClick={() => e('ports', [...edit.ports, { label: 'Port', container: 8080, proto: 'tcp' }])}><Plus className="h-3.5 w-3.5" />Add port</Btn></div>
            <div><p className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Variables</p>
              {edit.variables.map((v: any, i: number) => <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 mb-2 space-y-2"><div className="grid sm:grid-cols-3 gap-2"><TextInput placeholder="Display name" value={v.name} onChange={ev => e('variables', edit.variables.map((x: any, j: number) => (j === i ? { ...x, name: ev.target.value } : x)))} /><TextInput placeholder="ENV_NAME" className="font-mono text-xs" value={v.env} onChange={ev => e('variables', edit.variables.map((x: any, j: number) => (j === i ? { ...x, env: ev.target.value.toUpperCase() } : x)))} /><TextInput placeholder="Default" value={v.default} onChange={ev => e('variables', edit.variables.map((x: any, j: number) => (j === i ? { ...x, default: ev.target.value } : x)))} /></div>
                <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"><TextInput placeholder="Description" value={v.description} onChange={ev => e('variables', edit.variables.map((x: any, j: number) => (j === i ? { ...x, description: ev.target.value } : x)))} /><TextInput placeholder="Rule: required | number | /regex/" className="font-mono text-xs" value={v.rules} onChange={ev => e('variables', edit.variables.map((x: any, j: number) => (j === i ? { ...x, rules: ev.target.value } : x)))} /><Toggle checked={v.userEditable} onChange={val => e('variables', edit.variables.map((x: any, j: number) => (j === i ? { ...x, userEditable: val } : x)))} label="User editable" /><Btn size="sm" variant="danger" onClick={() => e('variables', edit.variables.filter((_: any, j: number) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Btn></div></div>)}
              <Btn size="sm" onClick={() => e('variables', [...edit.variables, { name: '', env: '', default: '', description: '', userEditable: true, rules: '' }])}><Plus className="h-3.5 w-3.5" />Add variable</Btn></div>
          </div>}
          {tab === 'install' && <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Installer image" hint="Container nodes run the script inside this image."><TextInput className="font-mono text-xs" value={edit.install.image} onChange={ev => e('install', { ...edit.install, image: ev.target.value })} /></Field><Field label="Shell"><Select value={edit.install.entrypoint} onChange={ev => e('install', { ...edit.install, entrypoint: ev.target.value })}><option>bash</option><option>sh</option><option>ash</option></Select></Field></div>
            <Field label="Install script" hint="Write files to /mnt/server (native-sandbox nodes rewrite this path automatically). Variables are available as environment variables."><TextArea className="!min-h-[240px]" value={edit.install.script} onChange={ev => e('install', { ...edit.install, script: ev.target.value })} spellCheck={false} /></Field>
          </div>}
        </div>}
      </Modal>
    </div>
  );
};
