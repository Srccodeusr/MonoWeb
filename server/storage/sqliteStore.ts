import fs from 'fs';
import path from 'path';

/**
 * SQLite persistence for the platform database (replaces the single data/db.json file).
 *
 * Why SQLite: this is a single-process, self-hosted app. SQLite needs no extra server, gives atomic
 * transactional writes (WAL), survives crashes without a truncated file, supports online backups and is built
 * into Node 22 (no native module to compile). PostgreSQL/MySQL would add a service to run for no benefit here.
 *
 * Design: the app keeps its familiar in-memory working set (`getDb()`), and this store persists it row by row.
 * Each save diffs the working set against what was last written and runs ONE transaction that touches only
 * changed rows (the old JSON file rewrote everything on every change).
 *
 *   docs(coll, id, pos, data)  one row per object in an array collection (order kept in `pos`)
 *   maps(coll, k, data)        one row per key of a record collection (e.g. password hashes)
 *   kv(k, data)                everything else (settings, installation id, small arrays)
 */
export interface StoreLayout { docs: string[]; maps: string[] }

type Row = { coll: string; id: string; data: string; pos: number };

function openSqlite(): any {
  const getBuiltin = (process as any).getBuiltinModule as undefined | ((n: string) => any);
  const mod = getBuiltin?.('node:sqlite');
  if (!mod?.DatabaseSync) {
    throw new Error(`This platform needs Node.js 22.13+ (built-in SQLite). Detected ${process.version}. Upgrade Node or run the Docker image.`);
  }
  return mod.DatabaseSync;
}

export class SqliteStore {
  private db: any;
  private layout: StoreLayout;
  // last written state, used to compute minimal diffs
  private docJson = new Map<string, Map<string, string>>();
  private docOrder = new Map<string, string[]>();
  private docPos = new Map<string, Map<string, number>>();
  private posMin = new Map<string, number>();
  private posMax = new Map<string, number>();
  private mapJson = new Map<string, Map<string, string>>();
  private kvJson = new Map<string, string>();
  private knownKeys = new Set<string>();
  readonly file: string;
  lastSavedAt = 0;
  lastChanged = 0;

  constructor(file: string, layout: StoreLayout) {
    this.file = file;
    this.layout = layout;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const DatabaseSync = openSqlite();
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, pos INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS docs_order ON docs (coll, pos);
      CREATE TABLE IF NOT EXISTS maps (coll TEXT NOT NULL, k TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, k)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
      INSERT OR IGNORE INTO meta (k, v) VALUES ('schema_version', '1');
    `);
    try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
  }

  /** Returns the stored database, or null if nothing was ever saved (fresh install / pre-migration). */
  load(): Record<string, any> | null {
    const initialised = this.db.prepare("SELECT v FROM meta WHERE k = 'known_keys'").get();
    if (!initialised) return null;
    this.knownKeys = new Set(JSON.parse(initialised.v));
    const out: Record<string, any> = {};

    for (const coll of this.layout.docs) if (this.knownKeys.has(coll)) { out[coll] = []; }
    for (const coll of this.layout.maps) if (this.knownKeys.has(coll)) { out[coll] = {}; }

    for (const r of this.db.prepare('SELECT coll, id, pos, data FROM docs ORDER BY coll, pos').all() as Row[]) {
      const obj = JSON.parse(r.data);
      (out[r.coll] ||= []).push(obj);
      this.rememberDoc(r.coll, r.id, JSON.stringify(obj), r.pos);
    }
    for (const r of this.db.prepare('SELECT coll, k, data FROM maps').all() as { coll: string; k: string; data: string }[]) {
      const v = JSON.parse(r.data);
      (out[r.coll] ||= {})[r.k] = v;
      this.mapMemo(r.coll).set(r.k, JSON.stringify(v));
    }
    for (const r of this.db.prepare('SELECT k, data FROM kv').all() as { k: string; data: string }[]) {
      const v = JSON.parse(r.data);
      out[r.k] = v;
      this.kvJson.set(r.k, JSON.stringify(v));
    }
    for (const coll of this.layout.docs) {
      const ids = (out[coll] || []).map((o: any) => String(o.id));
      this.docOrder.set(coll, ids);
    }
    return out;
  }

  private mapMemo(coll: string) { let m = this.mapJson.get(coll); if (!m) { m = new Map(); this.mapJson.set(coll, m); } return m; }
  private rememberDoc(coll: string, id: string, json: string, pos: number) {
    let j = this.docJson.get(coll); if (!j) { j = new Map(); this.docJson.set(coll, j); } j.set(id, json);
    let p = this.docPos.get(coll); if (!p) { p = new Map(); this.docPos.set(coll, p); } p.set(id, pos);
    this.posMin.set(coll, Math.min(this.posMin.get(coll) ?? pos, pos));
    this.posMax.set(coll, Math.max(this.posMax.get(coll) ?? pos, pos));
  }

  /** Persist the working set. One transaction; only changed rows are written. Returns number of rows touched. */
  save(data: Record<string, any>): number {
    let touched = 0;
    const upDoc = this.db.prepare('INSERT INTO docs (coll, id, pos, data) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, pos = excluded.pos');
    const setPos = this.db.prepare('UPDATE docs SET pos = ? WHERE coll = ? AND id = ?');
    const delDoc = this.db.prepare('DELETE FROM docs WHERE coll = ? AND id = ?');
    const upMap = this.db.prepare('INSERT INTO maps (coll, k, data) VALUES (?, ?, ?) ON CONFLICT(coll, k) DO UPDATE SET data = excluded.data');
    const delMap = this.db.prepare('DELETE FROM maps WHERE coll = ? AND k = ?');
    const upKv = this.db.prepare('INSERT INTO kv (k, data) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data');
    const delKv = this.db.prepare('DELETE FROM kv WHERE k = ?');

    // Build the next in-memory snapshots first so a failed transaction leaves the previous snapshot intact.
    const nextDocJson = new Map(this.docJson), nextDocOrder = new Map(this.docOrder), nextDocPos = new Map(this.docPos);
    const nextMin = new Map(this.posMin), nextMax = new Map(this.posMax), nextMap = new Map(this.mapJson), nextKv = new Map(this.kvJson);
    const nextKnown = new Set<string>();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const coll of this.layout.docs) {
        const arr = data[coll];
        if (!Array.isArray(arr)) continue;
        nextKnown.add(coll);
        const prevJson = this.docJson.get(coll) || new Map<string, string>();
        const prevIds = this.docOrder.get(coll) || [];
        const prevPos = new Map(this.docPos.get(coll) || []);

        const curJson = new Map<string, string>();
        const curIds: string[] = [];
        for (const item of arr) {
          const id = item && typeof item === 'object' ? (item as any).id : undefined;
          if (typeof id !== 'string' || !id) throw new Error(`Collection "${coll}" contains an item without a string id`);
          if (curJson.has(id)) { // duplicate ids would silently overwrite each other: keep the last one and say so
            console.warn(`[Database/WARN] Duplicate id "${id}" in "${coll}"; keeping the last occurrence`);
            curIds.splice(curIds.indexOf(id), 1);
          }
          curJson.set(id, JSON.stringify(item)); curIds.push(id);
        }

        // deletions
        for (const id of prevJson.keys()) if (!curJson.has(id)) { delDoc.run(coll, id); prevPos.delete(id); touched++; }

        // order bookkeeping: incremental when items were only added at the front/back or removed, else renumber
        const prevSet = new Set(prevIds), curSet = new Set(curIds);
        const keep = prevIds.filter(id => curSet.has(id));
        let front = 0; while (front < curIds.length && !prevSet.has(curIds[front]) && prevIds.length > 0) front++;
        let back = 0; while (back < curIds.length - front && !prevSet.has(curIds[curIds.length - 1 - back])) back++;
        const mid = curIds.slice(front, curIds.length - back);
        const incremental = mid.length === keep.length && mid.every((id, i) => id === keep[i]);
        let min = nextMin.get(coll) ?? 0, max = nextMax.get(coll) ?? -1;
        const newPos = new Map<string, number>();
        if (incremental) {
          for (const id of keep) newPos.set(id, prevPos.get(id)!);
          for (let i = front - 1; i >= 0; i--) newPos.set(curIds[i], --min);
          for (let i = curIds.length - back; i < curIds.length; i++) newPos.set(curIds[i], ++max);
        } else {
          curIds.forEach((id, i) => newPos.set(id, i));
          min = 0; max = curIds.length - 1;
        }

        for (const id of curIds) {
          const json = curJson.get(id)!, pos = newPos.get(id)!;
          if (prevJson.get(id) !== json || !prevPos.has(id)) { upDoc.run(coll, id, pos, json); touched++; }
          else if (prevPos.get(id) !== pos) { setPos.run(pos, coll, id); touched++; }
        }
        nextDocJson.set(coll, curJson); nextDocOrder.set(coll, curIds); nextDocPos.set(coll, newPos); nextMin.set(coll, min); nextMax.set(coll, max);
      }

      for (const coll of this.layout.maps) {
        const obj = data[coll];
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
        nextKnown.add(coll);
        const prev = this.mapJson.get(coll) || new Map<string, string>();
        const cur = new Map<string, string>();
        for (const [k, v] of Object.entries(obj)) cur.set(k, JSON.stringify(v));
        for (const k of prev.keys()) if (!cur.has(k)) { delMap.run(coll, k); touched++; }
        for (const [k, json] of cur) if (prev.get(k) !== json) { upMap.run(coll, k, json); touched++; }
        nextMap.set(coll, cur);
      }

      const handled = new Set([...this.layout.docs, ...this.layout.maps]);
      for (const [k, v] of Object.entries(data)) {
        if (handled.has(k) || v === undefined) continue;
        nextKnown.add(k);
        const json = JSON.stringify(v);
        if (this.kvJson.get(k) !== json) { upKv.run(k, json); touched++; }
        nextKv.set(k, json);
      }
      for (const k of this.kvJson.keys()) if (!(k in data) || data[k] === undefined) { delKv.run(k); nextKv.delete(k); touched++; }

      const known = JSON.stringify([...nextKnown].sort());
      if (known !== JSON.stringify([...this.knownKeys].sort())) this.db.prepare("INSERT INTO meta (k, v) VALUES ('known_keys', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(known);
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
    this.docJson = nextDocJson; this.docOrder = nextDocOrder; this.docPos = nextDocPos; this.posMin = nextMin; this.posMax = nextMax;
    this.mapJson = nextMap; this.kvJson = nextKv; this.knownKeys = nextKnown;
    this.lastSavedAt = Date.now(); this.lastChanged = touched;
    return touched;
  }

  /** Consistent online backup (safe while the app is running). */
  backup(dest: string): void {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) throw new Error('Backup target already exists');
    this.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    try { fs.chmodSync(dest, 0o600); } catch { /* windows */ }
  }

  stats(): { file: string; sizeBytes: number; rows: Record<string, number>; engine: string; lastSavedAt: number } {
    const rows: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT coll, COUNT(*) AS n FROM docs GROUP BY coll').all() as { coll: string; n: number }[]) rows[r.coll] = r.n;
    let size = 0; try { size = fs.statSync(this.file).size; } catch { /* ignore */ }
    const v = this.db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    return { file: path.basename(this.file), sizeBytes: size, rows, engine: `SQLite ${v.v} (WAL)`, lastSavedAt: this.lastSavedAt };
  }

  checkpoint(): void { try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* busy */ } }
  close(): void { try { this.checkpoint(); this.db.close(); } catch { /* ignore */ } }
}
