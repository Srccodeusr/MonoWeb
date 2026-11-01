import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, Pencil, Play, Power as PowerIcon } from 'lucide-react';
import { apiRequest } from '../../../lib/api';
import { Badge, Btn, Card, Empty, Field, Modal, NumInput, Select, Spinner, TextInput, Toggle, cx, fmtDate } from '../../../components/ui/kit';
import { Locked } from '../../../components/panel/Locked';

interface Task { action: 'command' | 'power' | 'backup'; payload: string; delaySec: number }
interface Sch { id: string; name: string; cron: string; description: string; enabled: boolean; tasks: Task[]; lastRunAt?: string; lastStatus?: string; lastError?: string; nextRunAt?: string }
interface Data { allowed: boolean; limit: number; backupsAvailable: boolean; items: Sch[] }
type Freq = 'every15' | 'every30' | 'hourly' | 'every6h' | 'daily' | 'weekly' | 'custom';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toCron(f: Freq, time: string, day: number, custom: string): string {
  const [h, m] = time.split(':').map(x => parseInt(x, 10) || 0);
  return ({ every15: '*/15 * * * *', every30: '*/30 * * * *', hourly: '0 * * * *', every6h: '0 */6 * * *', daily: `${m} ${h} * * *`, weekly: `${m} ${h} * * ${day}`, custom } as Record<Freq, string>)[f];
}

export const SchedulesTab: React.FC<{ serverId: string; onUpgrade: () => void; notify: (t: 'success' | 'error', m: string) => void }> = ({ serverId, onUpgrade, notify }) => {
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await apiRequest<Data>(`/hosting/servers/${serverId}/schedules`); if (r.success && r.data) setD(r.data); }, [serverId]);
  useEffect(() => { load(); const t = window.setInterval(load, 15000); return () => window.clearInterval(t); }, [load]);
  if (!d) return <Spinner />;
  if (!d.allowed) return <Locked title="Automate your server" text="Run console commands, restarts and backups on a schedule: nightly backups, hourly announcements, daily restarts. Scheduled tasks are available on paid plans." onUpgrade={onUpgrade} />;

  const blank = () => ({ name: '', freq: 'daily' as Freq, time: '04:00', day: 1, custom: '0 4 * * *', enabled: true, tasks: [{ action: 'command', payload: '', delaySec: 0 }] as Task[] });
  const open = (s?: Sch) => setEdit(s ? { id: s.id, name: s.name, freq: 'custom' as Freq, time: '04:00', day: 1, custom: s.cron, enabled: s.enabled, tasks: s.tasks } : blank());
  const save = async () => {
    setBusy('save');
    const body = { name: edit.name, cron: toCron(edit.freq, edit.time, edit.day, edit.custom), enabled: edit.enabled, tasks: edit.tasks };
    const r = await apiRequest(edit.id ? `/hosting/servers/${serverId}/schedules/${edit.id}` : `/hosting/servers/${serverId}/schedules`, { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    setBusy(''); if (r.success) { notify('success', 'Schedule saved'); setEdit(null); load(); } else notify('error', r.error?.message || 'Failed');
  };
  const act = async (key: string, fn: () => Promise<any>, ok: string) => { setBusy(key); const r = await fn(); setBusy(''); if (r.success) { notify('success', ok); load(); } else notify('error', r.error?.message || 'Failed'); };
  const setTask = (i: number, patch: Partial<Task>) => setEdit({ ...edit, tasks: edit.tasks.map((t: Task, j: number) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <p className="text-xs text-zinc-400"><b className="text-zinc-200">{d.items.length}</b> of {d.limit} schedules · times are UTC</p>
        <Btn size="sm" variant="primary" disabled={d.items.length >= d.limit} onClick={() => open()}><Plus className="h-3.5 w-3.5" />New schedule</Btn>
      </div>
      {d.items.length === 0 ? <Empty icon={<CalendarClock className="h-10 w-10" />} title="No schedules yet" text="Create one to automate backups, restarts or console commands." /> : (
        <ul className="divide-y divide-zinc-800/70">{d.items.map(s => (
          <li key={s.id} className="px-4 py-3 space-y-2">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white flex items-center gap-2">{s.name}{!s.enabled && <Badge>Paused</Badge>}{s.lastStatus && <Badge tone={s.lastStatus === 'ok' ? 'green' : s.lastStatus === 'failed' ? 'red' : 'amber'}>{s.lastStatus}</Badge>}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{s.description} <span className="font-mono text-zinc-600">({s.cron})</span></p></div>
              <Toggle checked={s.enabled} onChange={v => act('t' + s.id, () => apiRequest(`/hosting/servers/${serverId}/schedules/${s.id}`, { method: 'PUT', body: JSON.stringify({ enabled: v }) }), v ? 'Resumed' : 'Paused')} />
            </div>
            <div className="flex flex-wrap gap-1">{s.tasks.map((t, i) => <Badge key={i} tone="blue">{t.action === 'command' ? `$ ${t.payload}` : t.action === 'power' ? `power: ${t.payload}` : 'backup'}{t.delaySec ? ` (+${t.delaySec}s)` : ''}</Badge>)}</div>
            <div className="flex items-center justify-between text-[11px] text-zinc-600"><span>{s.enabled && s.nextRunAt ? `Next run ${fmtDate(s.nextRunAt)}` : 'Not scheduled'}{s.lastRunAt && ` · last ${fmtDate(s.lastRunAt)}`}{s.lastError && <span className="text-red-400"> · {s.lastError}</span>}</span>
              <span className="flex gap-1.5"><Btn size="sm" busy={busy === 'r' + s.id} onClick={() => act('r' + s.id, () => apiRequest(`/hosting/servers/${serverId}/schedules/${s.id}/run`, { method: 'POST' }), 'Started')}><Play className="h-3 w-3" />Run now</Btn><Btn size="sm" onClick={() => open(s)} aria-label="Edit"><Pencil className="h-3 w-3" /></Btn><Btn size="sm" variant="danger" onClick={() => window.confirm('Delete this schedule?') && act('d' + s.id, () => apiRequest(`/hosting/servers/${serverId}/schedules/${s.id}`, { method: 'DELETE' }), 'Deleted')} aria-label="Delete"><Trash2 className="h-3 w-3" /></Btn></span></div>
          </li>))}</ul>)}

      <Modal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? 'Edit schedule' : 'New schedule'} footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn variant="primary" busy={busy === 'save'} disabled={!edit?.name?.trim()} onClick={save}>Save schedule</Btn></>}>
        {edit && <div className="space-y-5">
          <Field label="Name"><TextInput value={edit.name} maxLength={60} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Nightly backup" /></Field>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Repeat"><Select value={edit.freq} onChange={e => setEdit({ ...edit, freq: e.target.value })}><option value="every15">Every 15 minutes</option><option value="every30">Every 30 minutes</option><option value="hourly">Every hour</option><option value="every6h">Every 6 hours</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="custom">Custom (cron)</option></Select></Field>
            {(edit.freq === 'daily' || edit.freq === 'weekly') && <Field label="At (UTC)"><TextInput type="time" value={edit.time} onChange={e => setEdit({ ...edit, time: e.target.value })} /></Field>}
            {edit.freq === 'weekly' && <Field label="On"><Select value={edit.day} onChange={e => setEdit({ ...edit, day: Number(e.target.value) })}>{DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}</Select></Field>}
            {edit.freq === 'custom' && <Field label="Cron expression" hint="minute hour day month weekday · min every 5 minutes" className="sm:col-span-2"><TextInput className="font-mono" value={edit.custom} onChange={e => setEdit({ ...edit, custom: e.target.value })} /></Field>}
          </div>
          <div className="space-y-2"><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Tasks (run in order)</p>
            {edit.tasks.map((t: Task, i: number) => (
              <div key={i} className="grid grid-cols-[110px_1fr_70px_auto] gap-2 items-center rounded-xl border border-zinc-800 bg-zinc-950 p-2.5">
                <Select value={t.action} onChange={e => setTask(i, { action: e.target.value as any, payload: e.target.value === 'power' ? 'restart' : '' })}><option value="command">Command</option><option value="power">Power</option><option value="backup" disabled={!d.backupsAvailable}>Backup</option></Select>
                {t.action === 'command' ? <TextInput className="font-mono text-xs" placeholder="say Restarting soon" value={t.payload} onChange={e => setTask(i, { payload: e.target.value })} />
                  : t.action === 'power' ? <Select value={t.payload} onChange={e => setTask(i, { payload: e.target.value })}><option value="restart">Restart</option><option value="start">Start</option><option value="stop">Stop</option><option value="kill">Kill</option></Select>
                  : <span className="text-xs text-zinc-500 px-2">Takes a backup (oldest scheduled one is rotated out)</span>}
                <NumInput value={t.delaySec} min={0} max={120} suffix="s" onChange={v => setTask(i, { delaySec: v })} />
                <Btn size="sm" variant="danger" disabled={edit.tasks.length <= 1} onClick={() => setEdit({ ...edit, tasks: edit.tasks.filter((_: any, j: number) => j !== i) })}><Trash2 className="h-3 w-3" /></Btn>
              </div>))}
            <Btn size="sm" disabled={edit.tasks.length >= 6} onClick={() => setEdit({ ...edit, tasks: [...edit.tasks, { action: 'command', payload: '', delaySec: 0 }] })}><PowerIcon className="h-3 w-3" />Add task</Btn>
          </div>
          <Toggle checked={edit.enabled} onChange={v => setEdit({ ...edit, enabled: v })} label="Enabled" />
        </div>}
      </Modal>
    </Card>
  );
};
