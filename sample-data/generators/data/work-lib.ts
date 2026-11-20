/** Domain 04 helpers: time parsing, lookups into the earlier domains' JSON, change-set / llm-call pickers. */
import { OWNER, at, readTable, rng, uid, type Row } from '../../lib/kit';

export const MS = 60_000;
/** 'MM-DD HH:MM[:SS]' (Mountain Time, 2026) to an ISO instant. */
export function mt(s: string): string {
  const full = s.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d(?::\d\d)?)$/);
  const m = full ?? s.match(/^()(\d\d)-(\d\d) (\d\d:\d\d(?::\d\d)?)$/);
  if (!m) throw new Error(`bad mt() time: ${s}`);
  const off = Math.round((Date.UTC(m[1] ? +m[1] : 2026, +m[2]! - 1, +m[3]!) - Date.UTC(2026, 10, 18)) / 86_400_000);
  return at(off, m[4]!);
}
export const plus = (iso: string, minutes: number, sec = 0) => new Date(Date.parse(iso) + minutes * MS + sec * 1000).toISOString();
export const ms = (iso: string) => Date.parse(iso);
export const mtLabel = (iso: string) => new Date(Date.parse(iso) - 7 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');
export const pad = (n: number, w = 3) => String(n).padStart(w, '0');
export const wiKey = (n: number) => `wi-${pad(n)}`;
export const wiId = (n: number) => uid('work_items', wiKey(n));
export const siKey = (n: number) => `si-${pad(n)}`;
export const NOW_ISO = at(0, '09:00');

// ── lookups ───────────────────────────────────────────────────────────────────────────────────────
const SI = readTable('source_items');
const SI_BY_ID = new Map<string, Row>(SI.map((r) => [r.id as string, r]));
export const siRow = (key: string): Row => {
  const r = SI_BY_ID.get(uid('source_items', key));
  if (!r) throw new Error(`unknown source item ${key}`);
  return r;
};
export const siId = (key: string) => uid('source_items', key);

const CAL = readTable('calendar_events');
const CAL_BY_ID = new Map<string, Row>(CAL.map((r) => [r.id as string, r]));
export const calRow = (tag: string): Row => {
  const r = CAL_BY_ID.get(uid('calendar_events', tag));
  if (!r) throw new Error(`unknown calendar event ${tag}`);
  return r;
};
export const calId = (tag: string) => uid('calendar_events', tag);

const O62 = readTable('org62_events');
export const o62Row = (nn: number): Row => {
  const r = O62.find((x) => x.id === uid('org62_events', `o62-${pad(nn, 2)}`));
  if (!r) throw new Error(`unknown org62 event ${nn}`);
  return r;
};

const SNAPS = new Map<string, Row>(readTable('asset_snapshots').map((r) => [r.id as string, r]));
const DIFFS = new Map<string, Row>(readTable('asset_snapshot_diffs').map((r) => [r.id as string, r]));
export const snapRow = (tag: string, v: number): Row => {
  const r = SNAPS.get(uid('asset_snapshots', `${tag}:v${v}`));
  if (!r) throw new Error(`unknown snapshot ${tag}:v${v}`);
  return r;
};
export const diffRow = (tag: string, a: number, b: number): Row => {
  const r = DIFFS.get(uid('asset_snapshot_diffs', `${tag}:${a}-${b}`));
  if (!r) throw new Error(`unknown diff ${tag}:${a}-${b}`);
  return r;
};
export const assetId = (tag: string) => uid('assets', tag);

/** When the app learned about an evidence reference. Refs: 'si-123', 'cal:<tag>', 'o62:NN', 'd:<tag>:a-b', 's:<tag>:vN'. */
export type EvRef = string;
export interface EvTarget { source_item_id?: string; asset_snapshot_id?: string; asset_diff_id?: string }
export function evTarget(ref: EvRef): EvTarget {
  if (ref.startsWith('si-')) return { source_item_id: siId(ref) };
  if (ref.startsWith('cal:')) return { source_item_id: calRow(ref.slice(4)).source_item_id as string };
  if (ref.startsWith('calseen:')) return { source_item_id: calRow(ref.slice(8)).source_item_id as string };
  if (ref.startsWith('o62:')) return { source_item_id: o62Row(+ref.slice(4)).source_item_id as string };
  if (ref.startsWith('d:')) { const [, tag, ab] = ref.split(':'); const [a, b] = ab!.split('-').map(Number); return { asset_diff_id: diffRow(tag!, a!, b!).id as string }; }
  if (ref.startsWith('s:')) { const [, tag, v] = ref.split(':'); return { asset_snapshot_id: snapRow(tag!, +v!.slice(1)).id as string }; }
  throw new Error(`bad evidence ref ${ref}`);
}
export function evSeenAt(ref: EvRef): string {
  if (ref.startsWith('si-')) return siRow(ref).first_seen_at as string;
  if (ref.startsWith('calseen:')) return SI_BY_ID.get(calRow(ref.slice(8)).source_item_id as string)!.first_seen_at as string;
  if (ref.startsWith('cal:')) {
    const c = calRow(ref.slice(4));
    const ended = Date.parse(c.ends_at as string);
    const srcSeen = Date.parse(SI_BY_ID.get(c.source_item_id as string)!.first_seen_at as string);
    return new Date(ended > Date.parse(NOW_ISO) ? srcSeen : Math.max(ended + 12 * MS, srcSeen)).toISOString();
  }
  if (ref.startsWith('o62:')) return SI_BY_ID.get(o62Row(+ref.slice(4)).source_item_id as string)!.first_seen_at as string;
  if (ref.startsWith('d:')) return diffRow(ref.split(':')[1]!, ...(ref.split(':')[2]!.split('-').map(Number) as [number, number])).computed_at as string;
  if (ref.startsWith('s:')) return snapRow(ref.split(':')[1]!, +ref.split(':')[2]!.slice(1)).sampled_at as string;
  throw new Error(`bad evidence ref ${ref}`);
}
/** When the thing itself happened (not when we saw it). */
export function evOccurredAt(ref: EvRef): string {
  if (ref.startsWith('si-')) return siRow(ref).occurred_at as string;
  if (ref.startsWith('cal:')) return calRow(ref.slice(4)).starts_at as string;
  if (ref.startsWith('calseen:')) return calRow(ref.slice(8)).starts_at as string;
  return evSeenAt(ref);
}

// ── change sets and llm calls ─────────────────────────────────────────────────────────────────────
interface CsRow { n: number; id: string; actor_ref: string; kind: string; t: number; closed: number }
const CS: CsRow[] = [];
{
  const rows = readTable('change_sets');
  const idToN = new Map<string, number>();
  for (let n = 1; n <= 500; n++) idToN.set(uid('change_sets', n), n);
  for (const r of rows) CS.push({ n: idToN.get(r.id as string) ?? -1, id: r.id as string, actor_ref: String(r.actor_ref), kind: String(r.kind), t: Date.parse(r.created_at as string), closed: Date.parse((r.closed_at ?? r.created_at) as string) });
}
export const csId = (n: number) => uid('change_sets', n);
/** The change set (by actor_ref prefix) closest in time to `iso`, within `maxMin`; null when none is close. */
export function csNear(prefix: string, iso: string, maxMin = 180): string | null {
  const t = Date.parse(iso);
  let best: CsRow | null = null; let bd = Infinity;
  for (const c of CS) {
    if (!c.actor_ref.startsWith(prefix)) continue;
    const d = Math.abs(c.t - t);
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd <= maxMin * MS ? best.id : null;
}
export const csSourceRef = (source: string) => ({ slack: 'scan:slack:', gmail: 'scan:gmail:', gemini_notes: 'scan:gemini_notes', drive: 'scan:drive', calendar: 'scan:calendar', claude: 'scan:claude_sessions', org62: 'scan:org62', vdp: 'scan:vdp' } as Record<string, string>)[source] ?? 'scan:slack:';

interface LlmRow { id: number; purpose: string; skill: string; t: number }
const LLM: LlmRow[] = readTable('llm_calls').map((r) => ({ id: r.id as number, purpose: String(r.purpose), skill: String(r.skill_key), t: Date.parse((r.finished_at ?? r.started_at) as string) }));
export function llmNear(purpose: string, skill: string | null, iso: string, maxMin = 120): number | null {
  const t = Date.parse(iso);
  let best: LlmRow | null = null; let bd = Infinity;
  for (const c of LLM) {
    if (c.purpose !== purpose || (skill && c.skill !== skill)) continue;
    const d = Math.abs(c.t - t);
    if (d < bd) { bd = d; best = c; }
  }
  return best && bd <= maxMin * MS ? best.id : null;
}
export const llmById = (id: number) => LLM.find((x) => x.id === id);

// ── extractors (keys are `<key>:<version>`) ───────────────────────────────────────────────────────
export const exId = (key: string) => uid('extractors', key);
export const SKILL_EX: Record<string, string> = {
  slack: 'scan-slack:1.7.0', gmail: 'scan-gmail:3', gemini_notes: 'scan-gemini-notes:3', drive: 'scan-drive:1', calendar: 'scan-calendar:2', claude: 'scan-claude-sessions:2', org62: 'scan-org62:1.7.0', vdp: 'scan-org62:1.7.0',
};

export const R = (seed: string) => rng(`work:${seed}`);
export { OWNER, uid };
export type { Row };
