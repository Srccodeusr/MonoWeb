import { HostImage, HostNode, StoreItem } from '../../src/hostingTypes';

const s = (v: any, max: number, def = '') => (typeof v === 'string' ? v.trim().slice(0, max) : def);
const n = (v: any, min: number, max: number, def: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
const b = (v: any, def: boolean) => (typeof v === 'boolean' ? v : def);
const safeUrl = (v: any) => { const t = s(v, 500); return /^(https?:\/\/|\/api\/v1\/media\/)/.test(t) ? t : ''; };

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^[0-9a-fA-F:]+$/;

export function sanitizeNode(i: any, e?: HostNode): Omit<HostNode, 'id' | 'secretEnc' | 'status' | 'createdAt'> {
  const name = s(i?.name, 60, e?.name); if (!name) throw new Error('Node name is required.');
  const fqdn = s(i?.fqdn, 253, e?.fqdn); if (!HOST_RE.test(fqdn)) throw new Error('Enter a valid domain or IP address for the public address.');
  const daemonHost = s(i?.daemonHost, 253, e?.daemonHost) || fqdn; if (!HOST_RE.test(daemonHost)) throw new Error('Invalid daemon address.');
  const portMin = Math.round(n(i?.portMin, 1024, 65535, e?.portMin ?? 20000)), portMax = Math.round(n(i?.portMax, 1024, 65535, e?.portMax ?? 40000));
  if (portMin >= portMax) throw new Error('Port range start must be below its end.');
  return {
    name, locationName: s(i?.locationName, 60, e?.locationName) || 'Unknown', locationFlag: s(i?.locationFlag, 8, e?.locationFlag),
    fqdn, daemonHost, daemonPort: Math.round(n(i?.daemonPort, 1, 65535, e?.daemonPort ?? 3002)), scheme: i?.scheme === 'https' ? 'https' : i?.scheme === 'http' ? 'http' : e?.scheme || 'http',
    ramMB: Math.round(n(i?.ramMB, 0, 1e9, e?.ramMB ?? 4096)), cpuPercent: Math.round(n(i?.cpuPercent, 0, 1e6, e?.cpuPercent ?? 400)), diskMB: Math.round(n(i?.diskMB, 0, 1e9, e?.diskMB ?? 51200)),
    overallocatePercent: Math.round(n(i?.overallocatePercent, 0, 500, e?.overallocatePercent ?? 0)), maxServers: Math.round(n(i?.maxServers, 0, 100000, e?.maxServers ?? 0)),
    portMin, portMax, isPublic: b(i?.isPublic, e?.isPublic ?? true), isMaintenance: b(i?.isMaintenance, e?.isMaintenance ?? false), premiumOnly: b(i?.premiumOnly, e?.premiumOnly ?? false), notes: s(i?.notes, 500, e?.notes),
  };
}

export function sanitizeImage(i: any, e?: HostImage): Omit<HostImage, 'id' | 'createdAt'> {
  const name = s(i?.name, 80, e?.name); if (!name) throw new Error('Image name is required.');
  const di: Record<string, string> = {};
  for (const [k, v] of Object.entries(i?.dockerImages || e?.dockerImages || {})) {
    const label = s(k, 40), img = s(v, 255);
    if (label && /^[a-zA-Z0-9][a-zA-Z0-9._\/:@-]{1,254}$/.test(img)) di[label] = img;
  }
  const labels = Object.keys(di); if (!labels.length) throw new Error('Add at least one valid Docker image (used by container nodes).');
  const defaultImage = labels.includes(i?.defaultImage) ? i.defaultImage : labels[0];
  const vars = (Array.isArray(i?.variables) ? i.variables : e?.variables || []).slice(0, 40).map((v: any) => ({
    name: s(v?.name, 60, 'Variable'), env: s(v?.env, 64).toUpperCase().replace(/[^A-Z0-9_]/g, ''), default: s(v?.default, 500), description: s(v?.description, 200), userEditable: b(v?.userEditable, true), rules: s(v?.rules, 200, ''),
  })).filter((v: any) => /^[A-Z_][A-Z0-9_]*$/.test(v.env) && !['STARTUP', 'START', 'SERVER_PORT', 'SERVER_MEMORY', 'SERVER_IP', 'PATH', 'HOME'].includes(v.env));
  const ports = (Array.isArray(i?.ports) ? i.ports : e?.ports || [{ label: 'App', container: 3000, proto: 'tcp' }]).slice(0, 8)
    .map((p: any) => ({ label: s(p?.label, 40, 'Port'), container: Math.round(n(p?.container, 1, 65535, 3000)), proto: p?.proto === 'udp' ? 'udp' : 'tcp' }));
  const ins = i?.install || e?.install || {};
  return {
    name, software: s(i?.software, 80, e?.software) || name, category: s(i?.category, 40, e?.category) || 'Other', description: s(i?.description, 300, e?.description), iconUrl: safeUrl(i?.iconUrl ?? e?.iconUrl),
    dockerImages: di, defaultImage, startup: s(i?.startup, 4000, e?.startup), stopCommand: s(i?.stopCommand, 100, e?.stopCommand ?? 'stop') || 'stop',
    ports: ports.length ? ports : [{ label: 'App', container: 3000, proto: 'tcp' }], variables: vars,
    install: {
      image: /^[a-zA-Z0-9][a-zA-Z0-9._\/:@-]{1,254}$/.test(s(ins.image, 255)) ? s(ins.image, 255) : di[defaultImage], entrypoint: ['bash', 'sh', 'ash'].includes(ins.entrypoint) ? ins.entrypoint : 'bash',
      script: s(ins.script, 100000), files: (Array.isArray(ins.files) ? ins.files : []).slice(0, 10).map((f: any) => ({ url: safeUrl(f?.url), path: s(f?.path, 200) })).filter((f: any) => f.url && f.path && !f.path.includes('..')),
    },
    runtime: ['any', 'container', 'process'].includes(i?.runtime) ? i.runtime : e?.runtime || 'any', minRamMB: Math.round(n(i?.minRamMB, 16, 1e6, e?.minRamMB ?? 128)), isActive: b(i?.isActive, e?.isActive ?? true),
  };
}

export function sanitizeStoreItem(i: any, e?: StoreItem): Omit<StoreItem, 'id' | 'createdAt' | 'sold'> {
  const name = s(i?.name, 80, e?.name); if (!name) throw new Error('Item name is required.');
  const type = ['spec_upgrade', 'renew', 'temp_premium', 'server_pack', 'slot'].includes(i?.type) ? i.type : e?.type;
  if (!type) throw new Error('Choose an item type.');
  const out: any = {
    type, name, description: s(i?.description, 300, e?.description), iconUrl: safeUrl(i?.iconUrl ?? e?.iconUrl), priceCoins: Math.round(n(i?.priceCoins, 0, 1e9, e?.priceCoins ?? 0)), priceMoney: n(i?.priceMoney, 0, 1e6, e?.priceMoney ?? 0),
    isActive: b(i?.isActive, e?.isActive ?? true), sortOrder: Math.round(n(i?.sortOrder, 0, 999, e?.sortOrder ?? 10)), stock: Math.round(n(i?.stock, 0, 1e9, e?.stock ?? 0)), perUserLimit: Math.round(n(i?.perUserLimit, 0, 1e6, e?.perUserLimit ?? 0)),
  };
  if (out.priceCoins <= 0 && out.priceMoney <= 0) throw new Error('Set a coin price, a money price, or both.');
  const u = i?.upgrade || e?.upgrade;
  if (type === 'spec_upgrade') {
    out.upgrade = { ramMB: Math.round(n(u?.ramMB, 0, 1e6, 0)), cpuPercent: Math.round(n(u?.cpuPercent, 0, 6400, 0)), diskMB: Math.round(n(u?.diskMB, 0, 1e8, 0)), durationDays: Math.round(n(u?.durationDays, 0, 3650, 7)), maxPerServer: Math.round(n(u?.maxPerServer, 1, 100, 1)) };
    if (!out.upgrade.ramMB && !out.upgrade.cpuPercent && !out.upgrade.diskMB) throw new Error('A spec upgrade must add RAM, CPU or disk.');
  }
  if (type === 'renew') out.renewDays = Math.round(n(i?.renewDays ?? e?.renewDays, 1, 3650, 7));
  if (type === 'temp_premium') { out.premiumPlanId = s(i?.premiumPlanId ?? e?.premiumPlanId, 64); out.premiumDays = Math.round(n(i?.premiumDays ?? e?.premiumDays, 1, 3650, 3)); if (!out.premiumPlanId) throw new Error('Choose which plan the temporary premium grants.'); }
  if (type === 'slot') out.slots = Math.round(n(i?.slots ?? e?.slots, 1, 100, 1));
  if (type === 'server_pack') { const p = i?.pack || e?.pack; out.pack = { ramMB: Math.round(n(p?.ramMB, 64, 1e6, 2048)), cpuPercent: Math.round(n(p?.cpuPercent, 5, 6400, 150)), diskMB: Math.round(n(p?.diskMB, 64, 1e8, 4096)), swapMB: Math.round(n(p?.swapMB, 0, 1e6, 0)), backups: Math.round(n(p?.backups, 0, 100, 0)), databases: Math.round(n(p?.databases, 0, 100, 0)), validityDays: Math.round(n(p?.validityDays, 1, 3650, 30)) }; }
  return out;
}
