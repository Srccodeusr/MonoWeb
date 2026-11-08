import { DatabaseSchema, saveDbSync } from '../db';
import { User } from '../../src/types';
import { VpsInstance, VpsPlan } from '../../src/vpsTypes';
import { VpsDaemonError, vpsDaemon } from '../vps/daemonClient';
import {
  VpsError, allowedImages, chargeCredits, dpath, extendVps, forgetLive, liveState, logVpsEvent, newVpsOrder, nodeOf, pickImage, provisionVps, publicHost, recordBillingOrder,
  refundCredits, resolveRenewPlan, rootPassword, touchOrder, viewOf, vpsSettings,
} from '../vps/service';
import { encryptSecret, randomPassword } from '../hosting/crypto';
import { allow } from '../hosting/ratelimit';
import { AcCtx, BotError, Choice, Cmd, answer, confirmReply, onComponent, onConfirm, register } from './framework';
import { botLocations, botNodes, pickBotNode } from './nodes';
import { logActivity } from './state';
import { Reply, V2, block, box, btn, code, kv, message, mb, money, notice, payload, row, select, stateWord, when } from './ui';

const sym = (db: DatabaseSchema) => db.settings.currencySymbol || '$';
const specText = (s: { cpu: number; ramMb: number; diskGb: number }) => `${s.cpu} vCPU, ${mb(s.ramMb)} RAM, ${s.diskGb} GB disk`;

/* ================================================================== lookups */
const norm = (s: string) => String(s || '').trim().toLowerCase();

function findPlan(db: DatabaseSchema, ident: string): VpsPlan | undefined {
  const q = norm(ident); const on = db.vpsPlans.filter(p => p.enabled);
  return on.find(p => p.id === ident || norm(p.id) === q) || on.find(p => norm(p.name) === q) || (on.filter(p => norm(p.name).includes(q)).length === 1 ? on.find(p => norm(p.name).includes(q)) : undefined);
}

function findVps(db: DatabaseSchema, user: User, ident?: string): VpsInstance {
  const mine = db.vpsServers.filter(v => v.ownerId === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!mine.length) throw new BotError('You do not own a VPS yet. Deploy one with /vps create.', 'No VPS', 'warn');
  if (!ident) { if (mine.length === 1) return mine[0]; throw new BotError(`You have ${mine.length} VPS. Name the one you mean: ${mine.slice(0, 8).map(v => code(v.name)).join(', ')}.`, 'Which VPS?', 'warn'); }
  const q = norm(ident);
  const hit = mine.find(v => v.id === q) || mine.find(v => v.id.startsWith(q)) || mine.find(v => norm(v.name) === q) || (/^\d{1,3}$/.test(q) ? mine[+q - 1] : undefined) || (mine.filter(v => norm(v.name).includes(q)).length === 1 ? mine.find(v => norm(v.name).includes(q)) : undefined);
  if (!hit) throw new BotError(`No VPS matches "${ident.slice(0, 40)}". Use /vps list to see yours.`, 'VPS not found', 'warn');
  return hit;
}

const acVps = (c: AcCtx, q: string): Choice[] => !c.user ? [] : c.db.vpsServers.filter(v => v.ownerId === c.user!.id && norm(v.name).includes(norm(q))).slice(0, 25).map(v => ({ name: `${v.name} (${v.id.slice(0, 6)})`, value: v.id }));
const acPlan = (c: AcCtx, q: string): Choice[] => c.db.vpsPlans.filter(p => p.enabled && norm(p.name).includes(norm(q))).sort((a, b) => a.sort - b.sort).slice(0, 25).map(p => ({ name: `${p.name} - ${specText(p)} - ${money(p.price, sym(c.db))}`, value: p.id }));
const acOs = (c: AcCtx, q: string): Choice[] => {
  const plan = c.get('plan') ? findPlan(c.db, c.get('plan')!) : undefined;
  const list = plan ? allowedImages(c.db, plan) : c.db.vpsImages.filter(i => i.enabled);
  return list.filter(i => norm(i.label).includes(norm(q)) || norm(i.id).includes(norm(q))).slice(0, 25).map(i => ({ name: i.label, value: i.id }));
};
const acLocation = (c: AcCtx, q: string): Choice[] => botLocations(c.db).filter(l => norm(l).includes(norm(q))).slice(0, 25).map(l => ({ name: l, value: l }));

/* ================================================================== guards + operations */
function assertWritable(v: VpsInstance): void {
  if (v.suspended) throw new BotError(v.suspendReason === 'expired' ? 'This VPS has expired. Renew it first.' : `This VPS is suspended${v.suspendReason ? ` (${v.suspendReason})` : ''}. Contact support.`, 'VPS unavailable', 'warn');
  if (v.status === 'installing') throw new BotError('This VPS is still installing. Try again in a minute.', 'Still installing', 'warn');
}
const needNode = (db: DatabaseSchema, v: VpsInstance) => nodeOf(db, v) || (() => { throw new BotError('The node for this VPS was removed. Contact support.', 'Node missing'); })();

/** Turns the errors of the VPS module into messages the user can read. */
function asBotError(e: any): never {
  if (e instanceof BotError) throw e;
  if (e instanceof VpsError || e instanceof VpsDaemonError) throw new BotError(e.message, 'VPS request failed');
  throw e;
}

async function doPower(db: DatabaseSchema, user: User, v: VpsInstance, action: string): Promise<void> {
  assertWritable(v);
  if (!allow(`bot:power:${v.id}`, 10, 60_000)) throw new BotError('Too many power actions. Wait a minute.', 'Slow down', 'warn');
  try { await vpsDaemon(needNode(db, v), 'POST', dpath(v, '/power'), { action }, 45_000); } catch (e) { asBotError(e); }
  forgetLive(v.id); logVpsEvent(db, v, user.email, `POWER_${action.toUpperCase()}`, 'via Discord'); saveDbSync();
}

async function doResetPassword(db: DatabaseSchema, user: User, v: VpsInstance): Promise<string> {
  assertWritable(v); const pw = randomPassword(20);
  try { await vpsDaemon(needNode(db, v), 'POST', dpath(v, '/password'), { password: pw }); } catch (e) { asBotError(e); }
  v.rootPasswordEnc = encryptSecret(pw); logVpsEvent(db, v, user.email, 'PASSWORD_RESET', 'via Discord'); saveDbSync(); return pw;
}

async function doRenew(db: DatabaseSchema, user: User, v: VpsInstance): Promise<{ plan: { name: string; price: number; periodDays: number } }> {
  if (!vpsSettings(db).allowRenewal) throw new BotError('Renewing is turned off by the administrator.', 'Renewal off');
  const plan = resolveRenewPlan(db, v); if (!plan) throw new BotError('This plan can no longer be renewed online. Contact support.', 'Cannot renew');
  try { chargeCredits(user, plan.price); } catch (e) { asBotError(e); }
  const bo = recordBillingOrder(db, user, plan, plan.price, 'paid', { serverName: v.name });
  newVpsOrder(db, { userId: user.id, userEmail: user.email, planId: plan.id, planName: plan.name, kind: 'renew', vpsId: v.id, image: v.image, name: v.name, location: '', amount: plan.price, paymentMethod: bo.paymentMethod, creditsHeld: false, billingOrderId: bo.id, source: 'bot', status: 'fulfilled' });
  await extendVps(db, v, plan.periodDays);
  logVpsEvent(db, v, user.email, 'RENEWED', `+${plan.periodDays} days for ${money(plan.price)} via Discord`); saveDbSync();
  return { plan };
}

async function doReinstall(db: DatabaseSchema, user: User, v: VpsInstance, imageId: string): Promise<string> {
  assertWritable(v); if (!vpsSettings(db).allowReinstall) throw new BotError('Reinstalling is turned off by the administrator.', 'Reinstall off');
  const plan = db.vpsPlans.find(p => p.id === v.planId); const image = pickImage(db, plan || { images: [] }, imageId || v.image); const node = needNode(db, v); const pw = randomPassword(20);
  v.status = 'installing'; saveDbSync(); forgetLive(v.id);
  try {
    const r = await vpsDaemon<{ diskEnforced?: boolean }>(node, 'POST', '/v1/vps', { id: v.id, image: image.id, base: image.base, ...v.spec, hostname: `vps-${v.id.slice(0, 6)}`, sshPort: v.sshPort, rootPassword: pw, reinstall: true }, 15 * 60_000);
    v.image = image.id; v.rootPasswordEnc = encryptSecret(pw); v.status = 'running'; v.lastError = undefined; v.diskEnforced = r.diskEnforced !== false;
  } catch (e: any) {
    v.status = 'error'; v.lastError = `Reinstall failed: ${e?.message || 'unknown error'}. Try again or contact support.`; logVpsEvent(db, v, user.email, 'REINSTALL_FAILED', e?.message || ''); saveDbSync(); asBotError(e);
  }
  logVpsEvent(db, v, user.email, 'REINSTALLED', `${image.label} via Discord`); saveDbSync(); return pw;
}

interface DeployInput { planId: string; image: string; name: string; location: string }
type DeployResult = { vps: VpsInstance; password: string } | { pending: true; orderId: string };

/** Buying a VPS from Discord: same rules as the website (account credits, limits, manual approval mode), but only on bot nodes. */
async function doDeploy(db: DatabaseSchema, user: User, input: DeployInput): Promise<DeployResult> {
  const s = vpsSettings(db); if (!s.enabled) throw new BotError('VPS hosting is not available right now.', 'VPS off');
  const plan = db.vpsPlans.find(p => p.id === input.planId && p.enabled); if (!plan) throw new BotError('That plan is not available.', 'Plan not found');
  if (s.maxVpsPerUser > 0 && db.vpsServers.filter(v => v.ownerId === user.id).length >= s.maxVpsPerUser) throw new BotError(`You can own at most ${s.maxVpsPerUser} VPS.`, 'Limit reached');
  const image = pickImage(db, plan, input.image); const node = pickBotNode(db, plan, input.location || undefined);
  if (!node) throw new BotError(botNodes(db).length ? 'No bot node has free capacity right now. Try another location or check back soon.' : 'No VPS node is connected to the bot yet. An administrator can add one in Admin > Discord Manager Bot > Nodes.', 'No capacity', 'warn');
  const manual = s.paymentMode === 'manual' && plan.price > 0;
  if (manual && db.vpsOrders.some(o => o.userId === user.id && o.planId === plan.id && o.status === 'pending')) throw new BotError(`You already have a pending order for ${plan.name}.`, 'Duplicate order', 'warn');

  try { chargeCredits(user, plan.price); } catch (e) { asBotError(e); }
  const bo = recordBillingOrder(db, user, plan, plan.price, manual ? 'pending' : 'paid', { creditsHeld: manual, serverName: input.name });
  const vo = newVpsOrder(db, { userId: user.id, userEmail: user.email, planId: plan.id, planName: plan.name, kind: 'deploy', image: image.id, name: input.name, location: input.location, amount: plan.price, paymentMethod: bo.paymentMethod, creditsHeld: bo.creditsHeld === true, billingOrderId: bo.id, source: 'bot', status: manual ? 'pending' : 'paid' });
  saveDbSync();
  if (manual) { logActivity(db, 'VPS_ORDER', `${user.email} ordered ${plan.name} (awaiting approval)`, false); return { pending: true, orderId: vo.id }; }
  try {
    const { vps, password } = await provisionVps(db, { owner: user, plan, image, name: input.name, nodeId: node.id, orderId: vo.id, periodDays: plan.periodDays });
    touchOrder(vo, { status: 'fulfilled', vpsId: vps.id, error: undefined, creditsHeld: false }); bo.status = 'paid'; bo.creditsHeld = false; saveDbSync();
    logActivity(db, 'VPS_CREATED', `${user.email} deployed ${plan.name} on ${node.name}`, false);
    return { vps, password };
  } catch (e: any) {
    refundCredits(user, plan.price); bo.status = 'failed'; bo.creditsHeld = false; bo.adminNote = `Deployment failed, credits refunded: ${e?.message}`;
    touchOrder(vo, { status: 'failed', error: e?.message || 'Deployment failed', creditsHeld: false }); saveDbSync(); asBotError(e);
  }
}

/* ================================================================== views */
function accessReply(db: DatabaseSchema, v: VpsInstance, password: string, title: string, note?: string): Reply {
  const host = publicHost(nodeOf(db, v)) || '(node removed)';
  return payload(box({ title, text: [kv([['Host', code(host)], ['Port', code(v.sshPort)], ['User', code('root')], ['Password', code(password)]]), block(`ssh root@${host} -p ${v.sshPort}`, 'bash'), note || 'Keep this private. You can reset the password any time with the Reset password button.'] }), true);
}

async function panelFor(db: DatabaseSchema, v: VpsInstance, note?: string): Promise<Reply> {
  const live = v.suspended || v.status === 'installing' ? undefined : await liveState(db, v, 2000);
  const view = viewOf(db, v, live); const host = publicHost(nodeOf(db, v));
  const usable = !v.suspended && v.status !== 'installing';
  const text = [
    kv([['Status', stateWord(view.status)], ['Plan', view.planName], ['Resources', specText(v.spec)], ['System', view.imageLabel], ['Location', view.node ? `${view.node.location} (${view.node.name})` : 'node removed']]),
    host ? `**SSH:** ${code(`ssh root@${host} -p ${v.sshPort}`)}` : '',
    `**Expires:** ${when(v.expiresAt)}`,
    live && live.status === 'running' ? `**Usage:** CPU ${live.stats.cpuPct.toFixed(1)}%, RAM ${mb(live.stats.ramUsedMb)}, disk ${mb(live.stats.diskUsedMb)}` : '',
    view.nodeError ? `**Node:** ${view.nodeError}` : '', view.lastError ? `**Problem:** ${view.lastError}` : '', note || '',
  ];
  return payload(box({
    title: v.name, text, footer: `ID ${v.id.slice(0, 8)}`,
    rows: [
      row(btn(`mb|v|start|${v.id}`, 'Start', 'success', !usable), btn(`mb|v|stop|${v.id}`, 'Stop', 'secondary', !usable), btn(`mb|v|restart|${v.id}`, 'Restart', 'secondary', !usable), btn(`mb|v|kill|${v.id}`, 'Kill', 'danger', !usable), btn(`mb|v|refresh|${v.id}`, 'Refresh')),
      row(btn(`mb|v|access|${v.id}`, 'Access', 'primary', !usable), btn(`mb|v|pass|${v.id}`, 'Reset password', 'secondary', !usable), btn(`mb|v|renew|${v.id}`, 'Renew'), btn(`mb|v|reinstall|${v.id}`, 'Reinstall', 'danger', !usable)),
    ],
  }), true);
}

function listReply(db: DatabaseSchema, user: User): Reply {
  const mine = db.vpsServers.filter(v => v.ownerId === user.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!mine.length) return payload(notice('info', 'Your VPS', 'You do not own a VPS yet. See /vps plans, then /vps create.'), true);
  const lines = mine.map((v, i) => { const st = v.suspended ? (v.suspendReason === 'expired' ? 'Expired' : 'Suspended') : stateWord(v.status); return `${i + 1}. **${v.name}**, ${st}, ${specText(v.spec)}, expires ${when(v.expiresAt)}`; });
  return payload(box({ title: `Your VPS (${mine.length})`, text: lines, rows: [select('mb|vsel', 'Open a control panel', mine.slice(0, 25).map(v => ({ label: v.name, value: v.id, description: `${v.planName}, ${specText(v.spec)}` })))] }), true);
}

/* ================================================================== commands */
const cmds: Cmd[] = [
  {
    name: 'vps plans', category: 'vps', description: 'See the VPS plans you can buy',
    async run(ctx) {
      const { db } = await ctx.need(); const s = vpsSettings(db);
      const plans = db.vpsPlans.filter(p => p.enabled).sort((a, b) => a.sort - b.sort);
      if (!plans.length) throw new BotError('No VPS plans are on sale right now.', 'No plans', 'warn');
      const oses = db.vpsImages.filter(i => i.enabled).sort((a, b) => a.sort - b.sort).map(i => i.label).join(', ');
      await ctx.reply(payload(box({
        title: 'VPS plans',
        text: [...plans.map(p => `**${p.name}**: ${specText(p)}, ${money(p.price, sym(db))} per ${p.periodDays} days${p.isPopular ? ' (popular)' : ''}${p.description ? `\n${p.description}` : ''}`), '', `**Systems:** ${oses || 'none enabled'}`, `**Locations:** ${botLocations(db).join(', ') || 'no node connected yet'}`, s.paymentMode === 'manual' ? 'Orders are approved by staff before the VPS is created.' : 'Paid with your account credits and deployed right away.'],
        footer: 'Deploy with /vps create',
      }), true));
    },
  },
  {
    name: 'vps create', category: 'vps', cooldown: 5, description: 'Deploy a new VPS with your account credits',
    options: [
      { name: 'plan', description: 'Plan to buy', required: true, autocomplete: acPlan },
      { name: 'os', description: 'Operating system', autocomplete: acOs },
      { name: 'name', description: 'Name for the VPS (max 40 characters)' },
      { name: 'location', description: 'Where to place it', autocomplete: acLocation },
    ],
    async run(ctx) {
      const { db, user } = await ctx.need(); const s = vpsSettings(db);
      if (!s.enabled) throw new BotError('VPS hosting is not available right now.', 'VPS off');
      if (!allow(`bot:create:${user.id}`, 5, 10 * 60_000)) throw new BotError('You are creating VPSes too quickly. Wait a few minutes.', 'Slow down', 'warn');
      const plan = findPlan(db, String(ctx.args.plan)); if (!plan) throw new BotError(`No plan matches "${String(ctx.args.plan).slice(0, 40)}". See /vps plans.`, 'Plan not found', 'warn');
      let image: ReturnType<typeof pickImage>;
      if (ctx.args.os) { const q = norm(ctx.args.os); const hit = allowedImages(db, plan).find(i => i.id === ctx.args.os || norm(i.id) === q || norm(i.label) === q || norm(i.label).includes(q)); if (!hit) throw new BotError(`That system is not available for ${plan.name}. Options: ${allowedImages(db, plan).map(i => i.label).join(', ')}.`, 'System not available', 'warn'); image = hit; }
      else image = pickImage(db, plan);
      let location = '';
      if (ctx.args.location) { const hit = botLocations(db).find(l => norm(l) === norm(ctx.args.location)); if (!hit) throw new BotError(`No bot node in "${String(ctx.args.location).slice(0, 40)}". Locations: ${botLocations(db).join(', ') || 'none yet'}.`, 'Location not found', 'warn'); location = hit; }
      if (!pickBotNode(db, plan, location || undefined)) throw new BotError(botNodes(db).length ? 'No bot node has free capacity right now. Try another location or check back soon.' : 'No VPS node is connected to the bot yet. An administrator can add one in Admin > Discord Manager Bot > Nodes.', 'No capacity', 'warn');
      const name = String(ctx.args.name || '').trim().slice(0, 40) || `${plan.name} VPS`;
      const input: DeployInput = { planId: plan.id, image: image.id, name, location };
      if (plan.price > 0) {
        await ctx.reply(confirmReply(ctx.user.id, 'vps.create', input, {
          title: 'Confirm purchase', label: `Pay ${money(plan.price, sym(db))}`,
          text: [kv([['Plan', plan.name], ['Resources', specText(plan)], ['System', image.label], ['Name', name], ['Location', location || 'automatic'], ['Price', `${money(plan.price, sym(db))} per ${plan.periodDays} days`], ['Your credits', money(user.credits, sym(db))]]), s.paymentMode === 'manual' ? 'Staff approve the order before the VPS is created.' : ''],
        }));
        return;
      }
      await ctx.defer(true); await ctx.reply(await deployResult(db, await doDeploy(db, user, input)));
    },
  },
  { name: 'vps list', category: 'vps', description: 'List your VPS', async run(ctx) { const { db, user } = await ctx.need(); await ctx.reply(listReply(db, user)); } },
  {
    name: 'vps manage', category: 'vps', aliases: ['vps panel'], description: 'Open the control panel of a VPS', options: [{ name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need();
      if (!ctx.args.vps && db.vpsServers.filter(v => v.ownerId === user.id).length > 1) return void (await ctx.reply(listReply(db, user)));
      const panel = await panelFor(db, findVps(db, user, ctx.args.vps));
      if (!(await ctx.secret(panel))) throw new BotError('I could not send you a direct message. Open your DMs or use the slash command /vps manage.', 'Direct message failed', 'warn');
    },
  },
  {
    name: 'vps info', category: 'vps', description: 'Details and live usage of a VPS', options: [{ name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); await ctx.defer(true);
      const live = v.suspended || v.status === 'installing' ? undefined : await liveState(db, v, 2000); const view = viewOf(db, v, live);
      await ctx.reply(payload(box({
        title: v.name,
        text: [kv([['Status', stateWord(view.status)], ['Plan', view.planName], ['Resources', specText(v.spec)], ['System', view.imageLabel], ['Location', view.node?.location || 'node removed'], ['Created', when(v.createdAt)], ['Expires', when(v.expiresAt)], ['Renewals', v.renewCount]]),
          live && live.status === 'running' ? `**Usage:** CPU ${live.stats.cpuPct.toFixed(1)}%, RAM ${mb(live.stats.ramUsedMb)} of ${mb(v.spec.ramMb)}, disk ${mb(live.stats.diskUsedMb)} of ${v.spec.diskGb} GB, network in ${live.stats.netRxMb} MB / out ${live.stats.netTxMb} MB` : '', view.lastError ? `**Problem:** ${view.lastError}` : ''],
        footer: `ID ${v.id}`,
      }), true));
    },
  },
  {
    name: 'vps power', category: 'vps', description: 'Start, stop, restart or kill a VPS',
    options: [{ name: 'action', description: 'What to do', required: true, choices: [{ name: 'Start', value: 'start' }, { name: 'Stop', value: 'stop' }, { name: 'Restart', value: 'restart' }, { name: 'Kill', value: 'kill' }] }, { name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); await ctx.defer(true); await doPower(db, user, v, String(ctx.args.action));
      await ctx.reply(payload(notice('success', `${v.name}: ${ctx.args.action}`, `The ${ctx.args.action} command was sent. Use /vps info in a few seconds to see the new state.`), true));
    },
  },
  {
    name: 'vps ssh', category: 'vps', description: 'Get the SSH login of a VPS (private)', options: [{ name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); assertWritable(v); needNode(db, v);
      logVpsEvent(db, v, user.email, 'CREDENTIALS_VIEWED', 'via Discord'); saveDbSync();
      if (!(await ctx.secret(accessReply(db, v, rootPassword(v), `${v.name}: SSH access`)))) throw new BotError('I could not send you a direct message. Open your DMs or use the slash command /vps ssh.', 'Direct message failed', 'warn');
      if (!ctx.isSlash) await ctx.reply(payload(notice('success', 'Sent', 'I sent the login to your direct messages.')));
    },
  },
  {
    name: 'vps resetpass', category: 'vps', cooldown: 10, description: 'Set a new random root password (private)', options: [{ name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); await ctx.defer(true); const pw = await doResetPassword(db, user, v);
      if (!(await ctx.secret(accessReply(db, v, pw, `${v.name}: new password`)))) throw new BotError('The password was changed but I could not send it to you. Open your DMs and run the command again.', 'Direct message failed', 'warn');
    },
  },
  {
    name: 'vps rename', category: 'vps', description: 'Rename a VPS',
    options: [{ name: 'name', description: 'New name (max 40 characters)', required: true, rest: true }, { name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); const name = String(ctx.args.name).trim().slice(0, 40); if (!name) throw new BotError('Give the VPS a name.', 'Invalid name', 'warn');
      const old = v.name; v.name = name; logVpsEvent(db, v, user.email, 'RENAMED', `${old} -> ${name} via Discord`); saveDbSync();
      await ctx.reply(payload(notice('success', 'Renamed', `${code(old)} is now ${code(name)}.`), true));
    },
  },
  {
    name: 'vps renew', category: 'vps', description: 'Extend a VPS with your account credits', options: [{ name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) { const { db, user } = await ctx.need(); await ctx.reply(renewPrompt(db, user, findVps(db, user, ctx.args.vps), ctx.user.id)); },
  },
  {
    name: 'vps reinstall', category: 'vps', description: 'Wipe a VPS and install a fresh system',
    options: [{ name: 'os', description: 'Operating system (blank = keep the current one)', autocomplete: acOs }, { name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) { const { db, user } = await ctx.need(); await ctx.reply(reinstallPrompt(db, findVps(db, user, ctx.args.vps), ctx.user.id, ctx.args.os)); },
  },
  {
    name: 'vps exec', category: 'vps', cooldown: 4, description: 'Run one shell command inside a VPS (30 second limit)',
    options: [{ name: 'command', description: 'Command to run', required: true, rest: true }, { name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); assertWritable(v);
      if (!vpsSettings(db).allowTerminal) throw new BotError('The terminal is turned off by the administrator.', 'Terminal off');
      const cmd = String(ctx.args.command).slice(0, 2000); await ctx.defer(true);
      let r: { output: string; code: number; cwd: string };
      try { r = await vpsDaemon(needNode(db, v), 'POST', dpath(v, '/exec'), { cmd, cwd: '/root' }, 35_000); } catch (e) { return asBotError(e); }
      logVpsEvent(db, v, user.email, 'EXEC', 'via Discord'); saveDbSync();
      await ctx.reply(payload(box({ title: `${v.name}: exit code ${r.code}`, tone: r.code === 0 ? 'success' : 'warn', text: [block(r.output.trim() || '(no output)', '', 3000)] }), true));
    },
  },
  {
    name: 'vps logs', category: 'vps', description: 'Show the latest console output of a VPS',
    options: [{ name: 'lines', description: 'How many lines (default 30)', type: 'integer', min: 5, max: 80 }, { name: 'vps', description: 'Which VPS (name or ID)', autocomplete: acVps }],
    async run(ctx) {
      const { db, user } = await ctx.need(); const v = findVps(db, user, ctx.args.vps); const n = Math.min(80, Math.max(5, Number(ctx.args.lines) || 30)); await ctx.defer(true);
      let r: { log: string };
      try { r = await vpsDaemon(needNode(db, v), 'GET', dpath(v, '/logs', `?tail=${n}`), undefined, 15_000); } catch (e) { return asBotError(e); }
      await ctx.reply(payload(box({ title: `${v.name}: console`, text: [block(String(r.log || '').trim().slice(-3000) || '(empty)', '', 3200)] }), true));
    },
  },
];

function renewPrompt(db: DatabaseSchema, user: User, v: VpsInstance, discordId: string): Reply {
  if (!vpsSettings(db).allowRenewal) throw new BotError('Renewing is turned off by the administrator.', 'Renewal off');
  const plan = resolveRenewPlan(db, v); if (!plan) throw new BotError('This plan can no longer be renewed online. Contact support.', 'Cannot renew');
  return confirmReply(discordId, 'vps.renew', { id: v.id }, {
    title: 'Confirm renewal', label: plan.price > 0 ? `Pay ${money(plan.price, sym(db))}` : 'Renew',
    text: [kv([['VPS', v.name], ['Adds', `${plan.periodDays} days`], ['Price', money(plan.price, sym(db))], ['Your credits', money(user.credits, sym(db))], ['Currently expires', when(v.expiresAt)]])],
  });
}

function reinstallPrompt(db: DatabaseSchema, v: VpsInstance, discordId: string, os?: string): Reply {
  assertWritable(v); if (!vpsSettings(db).allowReinstall) throw new BotError('Reinstalling is turned off by the administrator.', 'Reinstall off');
  const plan = db.vpsPlans.find(p => p.id === v.planId); let image = pickImage(db, plan || { images: [] }, v.image);
  if (os) { const q = norm(os); const hit = allowedImages(db, plan || { images: [] }).find(i => i.id === os || norm(i.id) === q || norm(i.label).includes(q)); if (!hit) throw new BotError('That system is not available for this VPS.', 'System not available', 'warn'); image = hit; }
  return confirmReply(discordId, 'vps.reinstall', { id: v.id, image: image.id }, {
    title: 'Confirm reinstall', danger: true, label: 'Wipe and reinstall',
    text: [`This permanently erases everything on ${code(v.name)} and installs ${image.label}. A new root password is generated.`],
  });
}

async function deployResult(db: DatabaseSchema, r: DeployResult): Promise<Reply> {
  if ('pending' in r) return payload(notice('success', 'Order received', 'Your payment was taken. A staff member will verify the order and your VPS will appear in /vps list.'), true);
  return accessReply(db, r.vps, r.password, `${r.vps.name} is ready`, 'Save this password now. You can open the control panel with /vps manage.');
}

/* ================================================================== confirmations + panel buttons */
onConfirm('vps.create', async (_i, data: DeployInput, user, db) => deployResult(db, await doDeploy(db, user, data)));
onConfirm('vps.renew', async (_i, data: { id: string }, user, db) => {
  const v = db.vpsServers.find(x => x.id === data.id && x.ownerId === user.id); if (!v) throw new BotError('That VPS no longer exists.', 'VPS not found');
  const { plan } = await doRenew(db, user, v);
  return payload(notice('success', 'Renewed', [`${code(v.name)} now runs until ${when(v.expiresAt, 'f')} (${when(v.expiresAt)}).`, `Charged ${money(plan.price, sym(db))}. Credits left: ${money(user.credits, sym(db))}.`]), true);
});
onConfirm('vps.reinstall', async (_i, data: { id: string; image: string }, user, db) => {
  const v = db.vpsServers.find(x => x.id === data.id && x.ownerId === user.id); if (!v) throw new BotError('That VPS no longer exists.', 'VPS not found');
  const pw = await doReinstall(db, user, v, data.image); return accessReply(db, v, pw, `${v.name} was reinstalled`, 'Your new root password is above. Save it now.');
});

onComponent('vsel', async (i, _p, db, user) => {
  if (!user) throw new BotError('Your Discord account is not linked to a website account.', 'Account not linked', 'warn');
  const v = db.vpsServers.find(x => x.id === i.values?.[0] && x.ownerId === user.id); if (!v) throw new BotError('That VPS no longer exists.', 'VPS not found', 'warn');
  await i.deferUpdate(); await answer(i, await panelFor(db, v));
});

onComponent('v', async (i, [action, id], db, user) => {
  if (!user) throw new BotError('Your Discord account is not linked to a website account.', 'Account not linked', 'warn');
  const v = db.vpsServers.find(x => x.id === id && x.ownerId === user.id); if (!v) throw new BotError('You do not have a VPS with that ID anymore.', 'VPS not found', 'warn');
  if (action === 'refresh') { await i.deferUpdate(); forgetLive(v.id); return answer(i, await panelFor(db, v)); }
  if (['start', 'stop', 'restart', 'kill'].includes(action)) {
    await i.deferUpdate(); await doPower(db, user, v, action);
    await new Promise(r => setTimeout(r, 1500)); forgetLive(v.id);
    return answer(i, await panelFor(db, v, `Sent ${action}.`));
  }
  if (action === 'access') { assertWritable(v); needNode(db, v); logVpsEvent(db, v, user.email, 'CREDENTIALS_VIEWED', 'via Discord'); saveDbSync(); return void (await i.reply(message(accessReply(db, v, rootPassword(v), `${v.name}: SSH access`)))); }
  if (action === 'pass') { await i.deferReply({ flags: 64 }); const pw = await doResetPassword(db, user, v); return void (await i.editReply({ components: accessReply(db, v, pw, `${v.name}: new password`).components, flags: V2 })); }
  if (action === 'renew') return void (await i.reply(message(renewPrompt(db, user, v, i.user.id))));
  if (action === 'reinstall') return void (await i.reply(message(reinstallPrompt(db, v, i.user.id))));
});

/* ================================================================== registration */
export function registerVpsCommands(): void { for (const c of cmds) register(c); }
