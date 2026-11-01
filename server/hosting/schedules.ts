import { getDb, saveDbSync, DatabaseSchema } from '../db';
import { HostSchedule, HostServer, ScheduleTask } from '../../src/hostingTypes';
import { daemon } from './daemonClient';
import { effectivePlan } from './plans';
import { nextRun, validateCron } from './cron';
import { newId } from './crypto';
import { HostingError, nodeFor, pushSpec, userCaps } from './serverService';

/**
 * Scheduled tasks (paid plans): cron-driven console commands, power actions and backups.
 * The plan check runs when a schedule is created AND every time it fires, so a lapsed plan simply pauses automation.
 */
const fail = (status: number, code: string, message: string): never => { throw new HostingError(status, code, message); };
const MAX_TASKS = 6;
const POWER = ['start', 'stop', 'restart', 'kill'];

export function sanitizeSchedule(input: any, server: HostServer): Pick<HostSchedule, 'name' | 'cron' | 'enabled' | 'tasks'> {
  const name = String(input?.name || '').trim().slice(0, 60);
  if (!name || /[\u0000-\u001f<>]/.test(name)) fail(400, 'INVALID_NAME', 'Give the schedule a name.');
  const cron = String(input?.cron || '').trim().replace(/\s+/g, ' ');
  const err = validateCron(cron); if (err) fail(400, 'INVALID_CRON', err);
  const raw = Array.isArray(input?.tasks) ? input.tasks : [];
  if (raw.length < 1 || raw.length > MAX_TASKS) fail(400, 'INVALID_TASKS', `A schedule needs 1 to ${MAX_TASKS} tasks.`);
  const tasks: ScheduleTask[] = raw.map((t: any) => {
    const action = t?.action; const payload = String(t?.payload ?? '').slice(0, 500); const delaySec = Math.min(120, Math.max(0, Math.round(Number(t?.delaySec) || 0)));
    if (action === 'command') { if (!payload.trim() || /[\u0000\r\n]/.test(payload)) fail(400, 'INVALID_TASK', 'Console command tasks need a single-line command.'); }
    else if (action === 'power') { if (!POWER.includes(payload)) fail(400, 'INVALID_TASK', 'Power tasks must be start, stop, restart or kill.'); }
    else if (action === 'backup') { if (server.limits.backups <= 0) fail(403, 'NO_BACKUPS', 'This server has no backup slots.'); }
    else fail(400, 'INVALID_TASK', 'Unknown task type.');
    return { action, payload: action === 'backup' ? '' : payload, delaySec };
  });
  return { name, cron, enabled: input?.enabled !== false, tasks };
}

export function createSchedule(db: DatabaseSchema, server: HostServer, userId: string, input: any): HostSchedule {
  const owner = db.users.find(u => u.id === server.ownerId)!;
  const caps = userCaps(db, owner);
  if (!caps.plan.features.scheduledTasks) fail(403, 'NOT_IN_PLAN', 'Scheduled tasks are available on paid plans.');
  const limit = caps.perServer.schedules;
  if (db.schedules.filter(s => s.serverId === server.id).length >= limit) fail(403, 'SCHEDULE_LIMIT', `Your plan allows ${limit} scheduled task${limit === 1 ? '' : 's'} per server.`);
  const clean = sanitizeSchedule(input, server);
  const sch: HostSchedule = { id: newId('sch'), serverId: server.id, ...clean, createdBy: userId, createdAt: new Date().toISOString(), nextRunAt: nextRun(clean.cron, new Date())?.toISOString() };
  db.schedules.push(sch); saveDbSync();
  return sch;
}

export function updateSchedule(db: DatabaseSchema, sch: HostSchedule, server: HostServer, input: any): HostSchedule {
  const clean = sanitizeSchedule({ ...sch, ...input }, server);
  Object.assign(sch, clean, { nextRunAt: clean.enabled ? nextRun(clean.cron, new Date())?.toISOString() : undefined });
  saveDbSync(); return sch;
}

const running = new Set<string>();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runTask(db: DatabaseSchema, server: HostServer, task: ScheduleTask): Promise<void> {
  const node = nodeFor(db, server);
  if (task.action === 'command') await daemon(node, 'POST', `/v1/servers/${server.id}/command`, { command: task.payload });
  else if (task.action === 'power') { await pushSpec(db, server); await daemon(node, 'POST', `/v1/servers/${server.id}/power`, { action: task.payload }, { timeoutMs: 90_000 }); }
  else if (task.action === 'backup') {
    const list = db.backups.filter(b => b.serverId === server.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (list.length >= server.limits.backups) { // rotate: drop the oldest SCHEDULED backup, never a manual one
      const old = list.find(b => b.name.startsWith('Scheduled'));
      if (!old) throw new Error('Backup limit reached and no scheduled backup can be rotated out.');
      await daemon(node, 'DELETE', `/v1/servers/${server.id}/backups/${old.id}`).catch(() => undefined);
      db.backups = db.backups.filter(b => b.id !== old.id);
    }
    const r = await daemon<{ id: string; size: number; checksum: string }>(node, 'POST', `/v1/servers/${server.id}/backups`, {}, { timeoutMs: 10 * 60_000 });
    db.backups.push({ id: r.id, serverId: server.id, name: `Scheduled ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, size: r.size, checksum: r.checksum, createdAt: new Date().toISOString() });
    saveDbSync();
  }
}

async function execute(db: DatabaseSchema, sch: HostSchedule): Promise<void> {
  const server = db.servers.find(s => s.id === sch.serverId);
  const finish = (status: HostSchedule['lastStatus'], error?: string) => { sch.lastRunAt = new Date().toISOString(); sch.lastStatus = status; sch.lastError = error; saveDbSync(); };
  if (!server) return finish('skipped', 'Server no longer exists');
  const owner = db.users.find(u => u.id === server.ownerId);
  const plan = owner && effectivePlan(owner, db.hostingPlans, db.settings.hosting!);
  if (!plan?.features.scheduledTasks) return finish('skipped', 'The owner\'s plan no longer includes scheduled tasks');
  if (['suspended', 'expired', 'installing', 'install_failed', 'transferring'].includes(server.status)) return finish('skipped', `Server is ${server.status.replace('_', ' ')}`);
  try {
    for (const t of sch.tasks) { if (t.delaySec) await wait(t.delaySec * 1000); await runTask(db, server, t); }
    finish('ok');
  } catch (e: any) { finish('failed', String(e?.message || e).slice(0, 200)); }
}

/** Called every 30 s. The next run time is advanced BEFORE executing so a slow task can never fire twice. */
export async function runDueSchedules(now = new Date()): Promise<number> {
  const db = await getDb();
  let started = 0;
  for (const sch of db.schedules) {
    if (!sch.enabled) continue;
    if (!sch.nextRunAt) { sch.nextRunAt = nextRun(sch.cron, now)?.toISOString(); saveDbSync(); continue; }
    if (new Date(sch.nextRunAt).getTime() > now.getTime() || running.has(sch.id)) continue;
    sch.nextRunAt = nextRun(sch.cron, now)?.toISOString();
    saveDbSync();
    running.add(sch.id); started++;
    void execute(db, sch).finally(() => running.delete(sch.id));
  }
  return started;
}

export async function runScheduleNow(db: DatabaseSchema, sch: HostSchedule): Promise<void> {
  if (running.has(sch.id)) fail(409, 'RUNNING', 'This schedule is already running.');
  running.add(sch.id);
  void execute(db, sch).finally(() => running.delete(sch.id));
}

let timer: NodeJS.Timeout | null = null;
export function startScheduleRunner(): void {
  if (timer) return;
  timer = setInterval(() => { void runDueSchedules().catch(e => console.error('[Schedules]', e?.message || e)); }, 30_000);
  timer.unref?.();
}
