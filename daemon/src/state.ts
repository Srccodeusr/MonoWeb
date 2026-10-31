import fs from 'fs';
import path from 'path';
import { config } from './config';
import { ServerSpec } from './runtime/types';

/** Crash-safe JSON persistence: write to a temp file then rename (atomic on POSIX). */
function writeAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o640 });
  fs.renameSync(tmp, file);
}

const specFile = (id: string) => path.join(config.dataDir, 'servers', `${id}.json`);
const installFile = path.join(config.dataDir, 'install-state.json');

export function saveSpec(spec: ServerSpec): void { writeAtomic(specFile(spec.id), spec); }
export function loadSpec(id: string): ServerSpec | null {
  try { return JSON.parse(fs.readFileSync(specFile(id), 'utf8')); } catch { return null; }
}
export function deleteSpec(id: string): void { try { fs.rmSync(specFile(id), { force: true }); } catch { /* ok */ } }
export function listSpecs(): ServerSpec[] {
  try {
    return fs.readdirSync(path.join(config.dataDir, 'servers')).filter(f => f.endsWith('.json'))
      .map(f => loadSpec(f.slice(0, -5))).filter((s): s is ServerSpec => !!s);
  } catch { return []; }
}

export type InstallState = 'installing' | 'installed' | 'failed';
let installStates: Record<string, { state: InstallState; log: string[] }> = {};
try { installStates = JSON.parse(fs.readFileSync(installFile, 'utf8')); } catch { /* first run */ }

export function setInstall(id: string, state: InstallState, line?: string): void {
  const cur = installStates[id] || { state, log: [] };
  cur.state = state;
  if (line) { cur.log.push(line.slice(0, 400)); if (cur.log.length > 60) cur.log.shift(); }
  installStates[id] = cur;
  try { writeAtomic(installFile, installStates); } catch { /* disk full etc. */ }
}
export function getInstall(id: string): { state: InstallState; log: string[] } | null { return installStates[id] || null; }
export function clearInstall(id: string): void { delete installStates[id]; try { writeAtomic(installFile, installStates); } catch { /* ok */ } }
