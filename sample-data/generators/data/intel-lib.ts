/** Shared lookups for domain 06 (briefs, watches, chat, provenance, reconcile). Reads earlier domains' JSON only. */
import { OWNER, readTable, uid, at, type Row } from '../../lib/kit';

const cache = new Map<string, Row[]>();
export const T = (table: string): Row[] => {
  if (!cache.has(table)) cache.set(table, readTable(table));
  return cache.get(table)!;
};
const idx = new Map<string, Set<string>>();
/** `uid(table, key)` that must exist in that table's JSON (a typo in a key fails the build, not the load). */
export function must(table: string, key: string | number): string {
  const id = uid(table, key);
  if (!idx.has(table)) idx.set(table, new Set(T(table).map((r) => String(r.id))));
  if (!idx.get(table)!.has(id)) throw new Error(`no ${table} row for key ${key}`);
  return id;
}
export { OWNER };

// ── source items (domain 02): `si-NNN` keys ─────────────────────────────────────────────────────
export const siId = (n: string | number) => must('source_items', typeof n === 'number' ? `si-${String(n).padStart(3, '0')}` : n);
const siById = new Map<string, Row>();
export function si(k: string): Row {
  if (!siById.size) for (const r of T('source_items')) siById.set(String(r.id), r);
  return siById.get(siId(k))!;
}
const metaOf = (r: Row) => (r.meta ?? {}) as Record<string, any>;
/** A stable topic key for a source item (thread ref, file id, opportunity field). */
export function topicOf(k: string): string {
  const r = si(k);
  const m = metaOf(r);
  if (r.source === 'slack') return String(m.threadRef ?? `slack:${m.channelId}:${m.ts}`);
  if (r.source === 'gmail') return String(m.threadRef ?? `gmail:${r.external_id}`);
  if (r.source === 'drive') return `drive:${m.fileId ?? r.external_id}`;
  if (r.source === 'calendar') return `calendar:${m.eventId ?? r.external_id}`;
  return `${r.source}:${r.external_id}`;
}
/** scan run uuid → n (1..160) and back. */
const runN = new Map<string, number>();
export function runNumber(id: string): number {
  if (!runN.size) for (let i = 1; i <= 160; i++) runN.set(uid('scan_runs', i), i);
  return runN.get(id) ?? 0;
}
export const runId = (n: number) => uid('scan_runs', n);
export const runRow = (n: number): Row => T('scan_runs').find((r) => r.id === runId(n))!;

// ── work items (domain 04): `wi-NNN` keys ───────────────────────────────────────────────────────
const wiN = (n: number) => `wi-${String(n).padStart(3, '0')}`;
export const wiId = (n: number) => must('work_items', wiN(n));
let wiMap: Map<string, Row> | null = null;
export function wi(n: number): Row {
  if (!wiMap) wiMap = new Map(T('work_items').map((r) => [String(r.id), r]));
  return wiMap.get(wiId(n))!;
}
export const wiTitle = (n: number) => String(wi(n).title);
/** Due instant as MT text: "Fri Nov 20, 17:00". */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function mt(iso: string | unknown): { date: string; time: string; dow: string; md: string; mdy: string; local: Date } {
  const d = new Date(new Date(String(iso)).getTime() - 7 * 3_600_000); // MST (UTC-7)
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    dow: DAYS[d.getUTCDay()]!,
    md: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
    mdy: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    local: d,
  };
}
/** "Fri Nov 20, 17:00" (a bare midnight-UTC due date shows as the date without a time). */
export function dueText(n: number): string {
  const iso = String(wi(n).due_at);
  const m = mt(iso);
  return `${m.dow} ${m.md}, ${m.time}`;
}
export const nbaId = (key: string) => must('next_best_actions', key);
const nbaMap = new Map<string, Row>();
export function nba(key: string): Row {
  if (!nbaMap.size) for (const r of T('next_best_actions')) nbaMap.set(String(r.id), r);
  return nbaMap.get(nbaId(key))!;
}
/** Source items attached as evidence to work item n (origin first). */
export function evidenceOf(n: number): string[] {
  const rows = T('work_item_evidence').filter((e) => e.work_item_id === wiId(n) && e.source_item_id);
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return rows.map((e) => String(e.source_item_id));
}
export const keyOfSi = (() => {
  let m: Map<string, string> | null = null;
  return (id: string) => {
    if (!m) {
      m = new Map();
      for (let i = 1; i <= T('source_items').length + 20; i++) m.set(uid('source_items', `si-${String(i).padStart(3, '0')}`), `si-${String(i).padStart(3, '0')}`);
    }
    return m.get(id) ?? '?';
  };
})();

// ── entities ────────────────────────────────────────────────────────────────────────────────────
export const acct = (k: string) => must('accounts', k);
export const opp = (k: string) => must('opportunities', k);
export const person = (k: string) => must('people', k);
export const channel = (k: string) => must('channels', k);
export const initiative = (k: string) => must('initiatives', k);
export const connector = (kind: string) => String(T('connectors').find((c) => c.kind === kind)!.id);
export const connectorByName = (name: string) => String(T('connectors').find((c) => c.name === name)!.id);
export const changeSet = (n: number) => must('change_sets', n);
export const llm = (id: number): Row => T('llm_calls').find((r) => r.id === id)!;
export const job = (id: number): Row => T('jobs').find((r) => r.id === id)!;
/** priority policy rule row id by policy version and rule key. */
export function ruleId(version: number, ruleKey: string): string {
  const pol = T('priority_policies').find((p) => p.version === version)!;
  const r = T('priority_policy_rules').find((x) => x.policy_id === pol.id && x.rule_key === ruleKey);
  if (!r) throw new Error(`no rule ${ruleKey} in policy v${version}`);
  return String(r.id);
}
export const snapshotId = (id: string) => id;
/** Org62 snapshot ids of an opportunity, oldest first. */
export function snapshotsOf(oppKey: string): Row[] {
  return T('opportunity_snapshots')
    .filter((s) => s.opportunity_id === opp(oppKey))
    .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
}
export const iso = (offset: number, hhmm: string) => at(offset, hhmm);
export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
