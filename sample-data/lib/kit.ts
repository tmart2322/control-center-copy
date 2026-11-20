/**
 * Shared helpers for the sample-data generators. Everything is deterministic: same code → same JSON.
 *
 * Conventions (every generator follows them, so rows from different generators join up without coordination):
 *  - Row ids are `uid('<table_name>', '<stable key>')`: a UUID derived from the table name and a human-readable key.
 *    A key is a short slug you can write from anywhere (`uid('accounts', 'northwind')`), so a generator never has to
 *    read another generator's output just to reference a row. bigint ids (jobs, llm_calls, …) are plain integers.
 *  - "Now" is Wed 2026-11-18 09:00 MST (America/Denver, UTC-7). `at(-3, '14:30')` is three days earlier at 14:30 MT.
 *  - Every external-system id (Org62/Salesforce, Slack) carries the marker SMPL so a synthetic id can never be
 *    mistaken for a real one: sfId('006', 12), slackUser(3), slackChannel(2).
 *  - Domains are example.com / *.example only. No real people, companies, URLs or ids.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE_DIR = path.resolve(here, '..');
export const TABLES_DIR = path.join(SAMPLE_DIR, 'tables');

// ── ids ─────────────────────────────────────────────────────────────────────────────────────────
/** Deterministic UUID (v5-shaped) from a table name and a key. `uid('users','owner')` is the one app user. */
export function uid(table: string, key: string | number): string {
  const h = createHash('sha1').update(`cc-sample|${table}|${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
export const OWNER = uid('users', 'owner');

/** 18-char Salesforce-style id with the SMPL marker: sfId('006', 12) → 006SMPL00000012AAA. */
export const sfId = (prefix: string, n: number) => `${prefix}SMPL${String(n).padStart(8, '0')}AAA`;
export const slackUser = (n: number) => `U0SMPL${String(n).padStart(3, '0')}`;
export const slackChannel = (n: number) => `C0SMPL${String(n).padStart(3, '0')}`;
export const slackDm = (n: number) => `D0SMPL${String(n).padStart(3, '0')}`;
/** Slack message ts ("1763481600.000100") for an ISO instant plus a sequence number. */
export const slackTs = (iso: string, seq = 0) => `${Math.floor(new Date(iso).getTime() / 1000)}.${String(100 + seq).padStart(6, '0')}`;
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ── time ────────────────────────────────────────────────────────────────────────────────────────
export const TZ = 'America/Denver';
export const TODAY = '2026-11-18'; // a Wednesday
const MT_OFFSET_H = 7; // MST in November
/** ISO instant (UTC, Z) for day `offset` relative to TODAY at local MT `HH:MM[:SS]`. */
export function at(offset: number, hhmm: string): string {
  const [h, m, s] = hhmm.split(':').map(Number);
  const base = Date.UTC(2026, 10, 18 + offset, (h ?? 0) + MT_OFFSET_H, m ?? 0, s ?? 0);
  return new Date(base).toISOString();
}
export const NOW = at(0, '09:00');
/** 'YYYY-MM-DD' for day offset from TODAY. */
export const day = (offset: number) => new Date(Date.UTC(2026, 10, 18 + offset)).toISOString().slice(0, 10);
export const addMinutes = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();
/** Day-of-week (0=Sun) of TODAY+offset. */
export const dow = (offset: number) => new Date(Date.UTC(2026, 10, 18 + offset)).getUTCDay();
export const isWeekday = (offset: number) => dow(offset) >= 1 && dow(offset) <= 5;

// ── seeded randomness ───────────────────────────────────────────────────────────────────────────
export function rng(seed: string) {
  let a = createHash('sha1').update(seed).digest().readUInt32LE(0);
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    weighted: <T,>(xs: ReadonlyArray<readonly [T, number]>): T => {
      const total = xs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of xs) { r -= w; if (r <= 0) return v; }
      return xs[xs.length - 1]![0];
    },
    shuffle: <T,>(xs: readonly T[]): T[] => { const o = [...xs]; for (let i = o.length - 1; i > 0; i--) { const j = int(0, i); [o[i], o[j]] = [o[j]!, o[i]!]; } return o; },
  };
}

// ── table io ────────────────────────────────────────────────────────────────────────────────────
export type Row = Record<string, unknown>;
/** Write sample-data/tables/<table>.json, one row per line (diff-friendly). Omit columns you want defaulted. */
export function writeTable(table: string, rows: Row[]): void {
  mkdirSync(TABLES_DIR, { recursive: true });
  const body = rows.length ? `[\n${rows.map((r) => '  ' + JSON.stringify(r)).join(',\n')}\n]\n` : '[]\n';
  writeFileSync(path.join(TABLES_DIR, `${table}.json`), body);
  console.log(`wrote ${table}: ${rows.length} rows`);
}
export function readTable(table: string): Row[] {
  const f = path.join(TABLES_DIR, `${table}.json`);
  if (!existsSync(f)) throw new Error(`table ${table} not generated yet (${f})`);
  return JSON.parse(readFileSync(f, 'utf8')) as Row[];
}
export const hasTable = (table: string) => existsSync(path.join(TABLES_DIR, `${table}.json`));

// ── cross-domain references ─────────────────────────────────────────────────────────────────────
/**
 * When your rows point at a row of a table that a LATER domain owns, build the id with `ref()` (not `uid()`), and call
 * `flushRefs('<your-agent>')` at the end of your generator. The later domain MUST create every reserved row with
 * exactly that id (`reservedFor('drafts')` lists `{ key, note, by }`). Earlier domains' tables you simply `readTable()`.
 */
const pendingRefs: Array<{ table: string; key: string | number; note: string }> = [];
export function ref(table: string, key: string | number, note = ''): string {
  if (!pendingRefs.some((r) => r.table === table && String(r.key) === String(key))) pendingRefs.push({ table, key, note });
  return uid(table, key);
}
const REFS_DIR = path.join(SAMPLE_DIR, 'reservations');
export function flushRefs(agent: string): void {
  mkdirSync(REFS_DIR, { recursive: true });
  writeFileSync(path.join(REFS_DIR, `${agent}.json`), JSON.stringify(pendingRefs, null, 1) + '\n');
  console.log(`reserved ${pendingRefs.length} cross-domain ref(s) for later domains (${agent})`);
}
export function reservedFor(table: string): Array<{ key: string | number; note: string; by: string }> {
  if (!existsSync(REFS_DIR)) return [];
  const out: Array<{ key: string | number; note: string; by: string }> = [];
  for (const f of readdirSync(REFS_DIR).filter((x) => x.endsWith('.json'))) {
    for (const r of JSON.parse(readFileSync(path.join(REFS_DIR, f), 'utf8')) as Array<{ table: string; key: string | number; note: string }>) {
      if (r.table === table) out.push({ key: r.key, note: r.note, by: f.replace(/\.json$/, '') });
    }
  }
  return out;
}
