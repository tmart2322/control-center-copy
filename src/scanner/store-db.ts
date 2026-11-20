/**
 * DbScannerStore: the Postgres implementation of `ScannerStore` (src/scanner/types.ts, SCANNER.md §3/§5).
 *
 * It mirrors InMemoryScannerStore (src/scanner/store-memory.ts) rule for rule; the numbers below are that
 * file's S1–S18, and tests/be1a/store-conformance.ts runs the same scenarios against both stores.
 *
 *  S1  Only a `running` run accepts writes (RunStateError otherwise).
 *  S2  source_items upsert on (owner, dedupeKey): new → isNew; changed contentHash → edit in place (revision + 1);
 *      same hash → no-op. The item's connector must match the run's (watch runs may record slack/org62).
 *      Bodies are redacted again, kept in `body` (90-day expiry) and never in `meta`; a purged body is never
 *      resurrected (W1).
 *  S3  work_item_evidence is unique on (item, source, role); the digest derives people/accounts/threads/files/
 *      lastEvidenceAt from evidence.
 *  S4  proposeItem is idempotent on (kind, sorted origin sourceItemIds, or all when none is origin). The key is
 *      kept on the proposing change set (`change_sets.editor_session_id = 'propose:<hash>'`, entity = the item).
 *  S5  proposeInitiative is idempotent on (normalized title, sorted member ids), same mechanism.
 *  S6  flagUnlinked keeps one reconcile_findings row per (source item, run); attempts are derived: a reconcile
 *      run adds one, any other run counts as one at most, `deferred:` reasons never count. Evidence ends it.
 *  S7  Coverage is staged in memory; finishRun commits it, failRun writes it with outcome `error`.
 *  S8  finishRun: cursor.at within the window (±1 s); committed + staged coverage spans [window.from, cursor.at)
 *      with no hole > 1 s (CoverageError); then ledger + run + cursor + touched set, in ONE transaction.
 *      S8c: an incomplete run (cursor.at < window.to) has its time ranges clamped to the cursor before commit.
 *  S9  The cursor moves forward over contiguous coverage only and fast-forwards to the newest held run cursor
 *      when backfill closes the hole (held cursors live in scan_runs.cursor_after until passed).
 *  S10 Work items with new evidence or newly proposed join the scope's pending set (scan_cursors.cursor_json
 *      .pending), surviving failed runs; the next successful finishRun returns and clears it.
 *  S11 coverageGaps clips at the scope's low watermark; no committed coverage → [window].
 *  S12 uncoveredObjects: same kind + ref with `to` ≥ the listed `to`, or meta.parentRef containment.
 *  S13 recordSpend(costUsd ≤ 0) is a pure read.
 *  S14 getContext: gaps of the last 7 days (when the scope has coverage), open items + items done within 14
 *      days, skillVersion of the latest succeeded run.
 *  S15 Digests and candidates carry resolution / involvement / handedOffTo / expected.
 *  S16 watch runs may record slack/org62 items. S17 `cc:<workItemId>` joins that item (score 1).
 *  S18 recordBriefHighlights is idempotent per (subscription, period); cited source items must exist.
 *
 * Every write runs inside `withChangeSet({ actor: actors.scanner(<connector>) })`. Linking also does the W2
 * new-info bump (generation, badge, coalesced re-eval) for non-context evidence, never a status change.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql, type SQL } from 'drizzle-orm';

import { redact, redactDeep } from '@/connectors/redact';
import { actors, engineUpdate, withChangeSet } from '@/db/changeset';
import { getDb, type Db, type DbOrTx, type Tx } from '@/db/client';
import { enqueueJob, recordNewInfo } from '@/db/queue';
import { workItems } from '@/db/schema';
import { pastDueOnArrival, pastDueReason, staleOnArrival, stillNeededReason } from '@/engines/still-needed';
import { sourceItemUrl } from '@/projections/links';
import { flushTrace, trace, traceContext } from '@/scanner/trace';
import { passSkill, passSpendOf, splitByPasses, TRIAGE_SKILL_KEY, type PassSpend } from '@/scanner/trace/queries';
import { noteLedgerGaps, recordDecision as recordLedgerDecision, reserveBudget, type Decision, type Reservation } from '@/db/ledger';
import type { ledgerObjectKind, sourceItemKind, sourceSystem } from '@/db/schema/enums';

import type {
  BriefHighlightsInput,
  CandidateExt,
  Involvement,
  OpenItemDigestExt,
  Resolution,
  UnlinkedSourceItemDetail,
} from './runtime/contract-ext';
import type { CompletionEvidence, CompletionItem, CompletionSource } from './completion/types';
import { deliveryMatch } from './delivery';
import type { ResolvedPersona } from '../personas/types';
import { loadPersona } from '../server/datasource/db/store/persona';
import { nameWords, parseDue, sameDeliverable } from './propose-rules';
import { clampToCursor, CoverageError, mergeRanges, NotFoundError as StoreNotFoundError, RunStateError, tokenize, toMs } from './store-memory';
import {
  scanningPrefsOf,
  scopeId,
  type Candidate,
  type Confidence,
  type ConnectorHealthProbe,
  type ConnectorId,
  type CoverageObject,
  type Cursor,
  type EvidenceRole,
  type NormalizedSourceItem,
  type PersonRef,
  type ProposeItemInput,
  type ConversationLine,
  type ScanContext,
  type ScannerStore,
  type SpendBooked,
  type ScanningPrefs,
  type ScanRunStats,
  type ScanTrigger,
  type ScopeKey,
  type TimeWindow,
} from './types';

type SourceSystem = (typeof sourceSystem.enumValues)[number];
type DbSourceItemKind = (typeof sourceItemKind.enumValues)[number];
type LedgerObjectKind = (typeof ledgerObjectKind.enumValues)[number];
export type ConnectorStatus = 'healthy' | 'degraded' | 'stale' | 'auth_required' | 'paused' | 'disabled' | 'error';

const DAY = 86_400_000;
const TOL = 1000;
const REOPEN_WINDOW_MS = 14 * DAY;

// ---------------------------------------------------------------------------------------------
// Static maps
// ---------------------------------------------------------------------------------------------

/** connectors row per ConnectorId: (kind, name = connector id). */
export const CONNECTOR_META: Record<
  ConnectorId,
  { kind: SourceSystem; transport: 'mcp_http' | 'agent_sdk' | 'local_files'; skill?: string; label: string }
> = {
  slack: { kind: 'slack', transport: 'agent_sdk', skill: 'scan-slack', label: 'Slack' },
  org62: { kind: 'org62', transport: 'agent_sdk', skill: 'scan-org62', label: 'Org62' },
  gmail: { kind: 'gmail', transport: 'mcp_http', skill: 'scan-gmail', label: 'Gmail' },
  calendar: { kind: 'calendar', transport: 'mcp_http', skill: 'scan-calendar', label: 'Calendar' },
  drive: { kind: 'drive', transport: 'mcp_http', skill: 'scan-drive', label: 'Drive' },
  gemini_notes: { kind: 'gemini_notes', transport: 'mcp_http', skill: 'scan-gemini-notes', label: 'Gemini notes' },
  claude_sessions: { kind: 'claude', transport: 'local_files', skill: 'scan-claude-sessions', label: 'Claude sessions' },
  trainings: { kind: 'gmail', transport: 'mcp_http', skill: 'scan-trainings', label: 'Trainings' },
  watch: { kind: 'slack', transport: 'agent_sdk', skill: 'scan-watch', label: 'Watch briefs' },
  vdp: { kind: 'vdp', transport: 'mcp_http', label: 'VDP' },
};

/** The scanner connector that owns its kind's app-seeded row: the one named like the kind, or the only one of it. */
export function isPrimaryOfKind(connector: ConnectorId): boolean {
  const kind = CONNECTOR_META[connector]?.kind;
  if (!kind) return false;
  if (connector === kind) return true;
  return !Object.entries(CONNECTOR_META).some(([k, m]) => k !== connector && m.kind === kind);
}

const TRIGGER_MAP: Record<ScanTrigger, 'schedule' | 'startup_catchup' | 'manual' | 'chat' | 'hook' | 'reconcile'> = {
  schedule: 'schedule',
  catch_up: 'startup_catchup',
  reconcile: 'reconcile',
  manual: 'manual',
  chat: 'chat',
  file_watch: 'hook',
};

/** CoverageObject.kind → scan_ledger_entries.object_kind. Refs keep kinds apart where two share a ledger kind. */
export const LEDGER_KIND: Record<CoverageObject['kind'], LedgerObjectKind> = {
  channel_range: 'channel_history',
  thread: 'thread',
  message: 'dm',
  mailbox_range: 'mailbox_page',
  email: 'mailbox_page',
  calendar_range: 'calendar_range',
  file: 'file',
  query_window: 'search_query',
  session: 'transcript_file',
  record: 'soql_query',
};

const CONFIDENCE_NUM: Record<Confidence, number> = { sure: 0.95, likely: 0.75, guess: 0.45 };
const RELEVANCE_NUM = { high: 0.9, medium: 0.6, low: 0.3 } as const;
const RELEVANCE_LEVEL = { high: 'must_read', medium: 'worth_a_look', low: 'fyi' } as const;

/** Keys whose values are message text: they go to `body` (90-day retention), never to `meta`. */
export const TEXT_KEYS = new Set([
  'bodyFull',
  'bodyNew',
  'body',
  'text',
  'transcript',
  'notes',
  'content',
  'markdown',
  'description',
  'summary',
  'snippet',
  'firstPrompt',
  'decisions',
  'nextSteps',
  'myNextSteps',
  'othersNextSteps',
  'excerpt',
  'quote',
  'message',
]);
/** Strings longer than this inside a payload are treated as text, not metadata. */
const META_MAX_STRING = 240;

const DRIVE_ID = /^[A-Za-z0-9_-]{15,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------
// Helpers (exported where the worker reuses them)
// ---------------------------------------------------------------------------------------------

export function modelTierOf(model: string | undefined): 'none' | 'haiku' | 'sonnet' | 'opus' {
  const m = (model ?? '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return 'none';
}

/** Local calendar day (YYYY-MM-DD) in an IANA zone. */
export function localDay(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

const skillVersionCache = new Map<string, string>();
/** `version:` from a skill's frontmatter (`skills/<name>.md`), or 'none'. */
export function readSkillVersion(skill: string | undefined, skillsDir = join(process.cwd(), 'skills')): string {
  if (!skill) return 'none';
  const key = `${skillsDir}|${skill}`;
  const hit = skillVersionCache.get(key);
  if (hit) return hit;
  let v = 'none';
  try {
    const head = readFileSync(join(skillsDir, `${skill}.md`), 'utf8').slice(0, 2000);
    const m = /^---[\s\S]*?^version:\s*["']?([^\s"'#]+)/m.exec(head);
    if (m?.[1]) v = m[1];
  } catch {
    /* skill not written yet */
  }
  skillVersionCache.set(key, v);
  return v;
}

const hashKey = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 24);
const isoMs = (ms: number) => new Date(ms).toISOString();
const iso = (v: unknown): string | undefined =>
  v === null || v === undefined ? undefined : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

interface Range {
  from: number;
  to: number;
}

function firstHole(merged: Range[], from: number, to: number, tol: number): Range | undefined {
  if (to <= from + tol) return undefined;
  let at = from;
  for (const r of merged) {
    if (r.to <= at) continue;
    if (r.from > at + tol) return { from: at, to: Math.min(r.from, to) };
    at = Math.max(at, r.to);
    if (at >= to - tol) return undefined;
  }
  return at >= to - tol ? undefined : { from: at, to };
}

function cmpPos(a: string, b: string): number {
  const ta = toMs(a);
  const tb = toMs(b);
  if (ta != null && tb != null) return ta - tb;
  return a.localeCompare(b);
}

function rangeOf(o: CoverageObject): Range | undefined {
  const from = toMs(o.from);
  const to = toMs(o.to);
  return from != null && to != null && to >= from ? { from, to } : undefined;
}

export function coverageToLedger(objects: CoverageObject[], outcome: 'complete' | 'error') {
  return objects.map((o) => {
    const r = rangeOf(o);
    const meta = o.meta ?? {};
    const num = (k: string) => (typeof meta[k] === 'number' ? Math.max(0, Math.trunc(meta[k] as number)) : undefined);
    return {
      objectKind: LEDGER_KIND[o.kind] ?? 'search_query',
      ref: o.ref,
      // Only a valid range is stored as covered_from/to (ranges_chk); raw positions always go to the tokens.
      coveredFrom: r ? isoMs(r.from) : null,
      coveredTo: r ? isoMs(r.to) : null,
      // Raw source positions (ts, ISO, offsets), compared exactly like the memory store compares `to`.
      startToken: o.from ?? null,
      endToken: o.to ?? null,
      itemCount: num('count') ?? num('listed') ?? num('hits') ?? num('events') ?? 0,
      outcome,
    };
  });
}

function flattenText(v: unknown, out: string[]): void {
  if (v === null || v === undefined) return;
  if (typeof v === 'string') {
    if (v.trim()) out.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) flattenText(x, out);
  } else if (typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) flattenText(x, out);
  }
}

/**
 * Splits a fetcher payload into structural metadata (kept forever, never message text) and text parts
 * (go to `body`, purged after 90 days). Known text keys and any long string are text.
 */
export function splitPayload(payload: Record<string, unknown> | undefined): { meta: Record<string, unknown>; text: string[] } {
  const text: string[] = [];
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      if (v.length > META_MAX_STRING) {
        text.push(v);
        return undefined;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1)).filter((x) => x !== undefined);
    if (v && typeof v === 'object') {
      if (depth > 6) return undefined;
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (TEXT_KEYS.has(k)) {
          flattenText(x, text);
          continue;
        }
        const w = walk(x, depth + 1);
        if (w !== undefined) o[k] = w;
      }
      return o;
    }
    return v;
  };
  const meta = (walk(payload ?? {}, 0) as Record<string, unknown>) ?? {};
  return { meta, text };
}

function dbKindOf(item: NormalizedSourceItem): { source: SourceSystem; kind: DbSourceItemKind } {
  const c = item.connector;
  switch (item.kind) {
    case 'email':
      return { source: 'gmail', kind: 'email_message' };
    case 'calendar_event':
      return { source: 'calendar', kind: 'calendar_event' };
    case 'file_revision':
      return { source: 'drive', kind: 'drive_file_revision' };
    case 'meeting_notes':
      return { source: 'gemini_notes', kind: 'gemini_note' };
    case 'claude_session':
      return { source: 'claude', kind: 'claude_session' };
    case 'training_notice':
      return item.dedupeKey.startsWith('training:cal') ? { source: 'calendar', kind: 'calendar_event' } : { source: 'gmail', kind: 'email_message' };
    case 'message':
    case 'thread':
      return c === 'slack' || c === 'watch' ? { source: 'slack', kind: 'slack_message' } : { source: 'app', kind: 'tool_output' };
    case 'record_snapshot':
      return c === 'vdp' ? { source: 'vdp', kind: 'vdp_record_snapshot' } : { source: 'org62', kind: 'org62_record_snapshot' };
    default:
      // Scanner "notes" (watch plans) are tool output; real manual notes are user-created, never scanned.
      return { source: 'app', kind: 'tool_output' };
  }
}

const textArr = (vals: string[]): SQL =>
  vals.length
    ? sql`array[${sql.join(
        vals.map((v) => sql`${v}::text`),
        sql`, `,
      )}]`
    : sql`'{}'::text[]`;
const uuidArr = (vals: string[]): SQL =>
  vals.length
    ? sql`array[${sql.join(
        vals.map((v) => sql`${v}::uuid`),
        sql`, `,
      )}]`
    : sql`'{}'::uuid[]`;

const normPerson = (s: string) => s.trim().toLowerCase();

/** reconcile_findings.detail for unlinked items: JSON, so reason, hints and "counts as an attempt" survive. */
interface FindingDetail {
  reason: string;
  hints: string[];
  counts: boolean;
}
function parseFinding(detail: string | null): FindingDetail {
  try {
    const d = JSON.parse(detail ?? '') as Partial<FindingDetail>;
    return { reason: String(d.reason ?? ''), hints: Array.isArray(d.hints) ? d.hints.map(String) : [], counts: d.counts !== false };
  } catch {
    const reason = (detail ?? '').split('\n')[0] ?? '';
    return { reason, hints: [], counts: !reason.startsWith('deferred:') };
  }
}

// ---------------------------------------------------------------------------------------------
// Run state (process-wide, so several store instances share in-flight runs)
// ---------------------------------------------------------------------------------------------

interface RunState {
  runId: string;
  scope: ScopeKey;
  connectorId: string;
  trigger: ScanTrigger;
  window: TimeWindow;
  skillVersion?: string;
  model?: string;
  staged: CoverageObject[];
}
const RUNS = new Map<string, RunState>();

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

export interface HealthChange {
  connector: ConnectorId;
  from: ConnectorStatus | null;
  to: ConnectorStatus;
  probe: ConnectorHealthProbe;
}

export interface BudgetStatus {
  todayUsd: number;
  softCapUsd: number;
  hardCapUsd: number;
  state: 'ok' | 'soft_alert' | 'capped';
}

export interface DbScannerStoreOptions {
  userId: string;
  db?: Db;
  clock?: () => Date;
  skillsDir?: string;
  /** Caps when neither the budgets setting (`settings.budgets`) nor llm_budgets has one (SCANNER.md §7: hard $15/day). */
  defaultBudget?: { softUsd: number; hardUsd: number; alertPct?: number };
  onHealthChange?: (e: HealthChange) => void | Promise<void>;
}

type DigestRow = {
  id: string;
  initiative_id: string | null;
  kind: string;
  title: string;
  purpose: string | null;
  status: string;
  resolution: Resolution | null;
  involvement: Involvement;
  handed_off_to: string | null;
  account_id: string | null;
  people: string[] | null;
  accounts: string[] | null;
  thread_refs: string[] | null;
  file_refs: string[] | null;
  last_evidence_at: string | null;
  expected_file: string | null;
  expected_changes: string[] | null;
  has_deliverable: boolean;
};

export class DbScannerStore implements ScannerStore {
  readonly userId: string;
  private readonly db: Db;
  private readonly clock: () => Date;
  private readonly skillsDir: string;
  private readonly connectorIds = new Map<ConnectorId, string>();
  private readonly extractorIds = new Map<string, string>();
  private tz: string | undefined;
  /** PPL-1: author key (`slack:U…`, `email:…`, `me`) → people.id, resolved once per store. */
  private readonly persons = new Map<string, string>();
  /** PPL-1: author keys with no person (an email sender nobody knows) → when looked up; asked again after 10 min. */
  private readonly noPerson = new Map<string, number>();
  private readonly o: DbScannerStoreOptions & { defaultBudget: { softUsd: number; hardUsd: number; alertPct?: number } };

  constructor(opts: DbScannerStoreOptions) {
    this.userId = opts.userId;
    this.db = opts.db ?? getDb();
    this.clock = opts.clock ?? (() => new Date());
    this.skillsDir = opts.skillsDir ?? join(process.cwd(), 'skills');
    this.o = { defaultBudget: { softUsd: 5, hardUsd: 15, alertPct: 80 }, ...opts };
  }

  private now(): Date {
    return this.clock();
  }

  private cs<T>(connector: ConnectorId | string, reason: string, fn: (tx: Tx) => Promise<T>, undoable = true): Promise<T> {
    return withChangeSet({ db: this.db, userId: this.userId, actor: actors.scanner(connector), reason, undoable }, (tx) => fn(tx)).then(
      (r) => r.result,
    );
  }

  // ------------------------------------------------------------------ lookups

  /** The connectors row for a ConnectorId (created on first use). */
  async connectorId(connector: ConnectorId): Promise<string> {
    const hit = this.connectorIds.get(connector);
    if (hit) return hit;
    const meta = CONNECTOR_META[connector];
    if (!meta) throw new RangeError(`unknown connector ${connector}`);
    const find = async (db: DbOrTx) => {
      const rows = (
        await db.execute<{ id: string; name: string }>(
          sql`select id, name from connectors where owner_user_id = ${this.userId} and kind = ${meta.kind} order by created_at, id`,
        )
      ).rows;
      const exact = rows.find((r) => r.name === connector);
      if (exact) return exact.id;
      // The app seeds connectors with name = their label ("Gmail"): that row IS this connector. The kind's primary
      // scanner connector adopts it (Trainings and Watch share a kind and keep rows of their own). Before, the
      // scanner registered a second row, so Health's connector never showed scanner state and a Health "Rescan"
      // placeholder (on the seeded row) was never adopted by the run (stress finding CONN-1).
      if (!isPrimaryOfKind(connector)) return undefined;
      const seeded = rows.filter((r) => !(r.name in CONNECTOR_META));
      return (seeded.find((r) => r.name.toLowerCase() === meta.label.toLowerCase()) ?? seeded[0])?.id;
    };
    let id = await find(this.db);
    if (!id) {
      id = await this.cs(
        connector,
        `register connector ${connector}`,
        async (tx) => {
          await tx.execute(sql`
            insert into connectors (owner_user_id, kind, name, transport, config)
            values (${this.userId}, ${meta.kind}, ${connector}, ${meta.transport}, ${JSON.stringify({ label: meta.label })}::jsonb)
            on conflict (owner_user_id, kind, name) do nothing`);
          return (await find(tx))!;
        },
        false,
      );
    }
    this.connectorIds.set(connector, id);
    return id;
  }

  /**
   * E3: `connectors.status = auth_required` survives a restart; the runtime reads it at startup. Since the last auth
   * failure (last_error_at), so a sign-in refreshed and then refused again still counts as refused.
   */
  async authPausedSince(connector: ConnectorId): Promise<string | null> {
    const id = await this.connectorId(connector);
    const r = await this.db.execute<{ status: ConnectorStatus; at: Date | string | null }>(sql`
      select status, greatest(last_error_at, status_changed_at) as at from connectors where id = ${id}`);
    const row = r.rows[0];
    return row?.status === 'auth_required' ? (row.at ? new Date(row.at).toISOString() : this.now().toISOString()) : null;
  }

  /** Current connectors.status (null before the first write). */
  async connectorStatus(connector: ConnectorId): Promise<ConnectorStatus | null> {
    const id = await this.connectorId(connector);
    const r = await this.db.execute<{ status: ConnectorStatus }>(sql`select status from connectors where id = ${id}`);
    return r.rows[0]?.status ?? null;
  }

  private async extractorId(connector: ConnectorId, skillVersion: string | undefined, model?: string): Promise<string> {
    const key = `scanner:${connector}`;
    const version = skillVersion || readSkillVersion(CONNECTOR_META[connector]?.skill, this.skillsDir);
    const cacheKey = `${key}@${version}`;
    const hit = this.extractorIds.get(cacheKey);
    if (hit) return hit;
    const tier = modelTierOf(model);
    await this.db.execute(sql`
      insert into extractors (key, version, kind, model_tier, model, skill_key, description)
      values (${key}, ${version}, ${tier === 'none' ? 'parser' : 'llm'}, ${tier}, ${model ?? null},
              ${CONNECTOR_META[connector]?.skill ?? null}, ${`Scanner ${connector} (skill ${version})`})
      on conflict (key, version) do nothing`);
    const res = await this.db.execute<{ id: string }>(sql`select id from extractors where key = ${key} and version = ${version}`);
    const id = res.rows[0]!.id;
    this.extractorIds.set(cacheKey, id);
    return id;
  }

  private async timezone(): Promise<string> {
    if (this.tz) return this.tz;
    const res = await this.db.execute<{ timezone: string; profile_tz: string | null }>(sql`
      select u.timezone, (select s.value->>'timezone' from user_settings s where s.owner_user_id = u.id and s.key in ('settings.profile', 'profile') order by (s.key = 'settings.profile') desc limit 1) as profile_tz
        from users u where u.id = ${this.userId}`);
    const row = res.rows[0];
    if (!row) throw new StoreNotFoundError(`user ${this.userId}`);
    this.tz = row.profile_tz || row.timezone || 'America/Denver';
    return this.tz;
  }

  private async run(runId: string): Promise<RunState> {
    const hit = RUNS.get(runId);
    if (hit) return hit;
    if (!UUID.test(runId)) throw new RunStateError(`unknown run ${runId}`);
    // Another store instance (or a restart) opened it: rebuild what we can. Staged coverage is per process.
    const res = await this.db.execute<{
      connector_id: string;
      name: string;
      scope: string;
      trigger: string;
      window_start: string | null;
      window_end: string | null;
      skill_version: string | null;
    }>(sql`
      select r.connector_id, c.name, r.scope, r.trigger, r.window_start, r.window_end, r.skill_version
        from scan_runs r join connectors c on c.id = r.connector_id
       where r.id = ${runId} and r.owner_user_id = ${this.userId}`);
    const r = res.rows[0];
    if (!r) throw new RunStateError(`unknown run ${runId}`);
    const connector = r.name as ConnectorId;
    const scope = r.scope.startsWith(`${connector}:`) ? r.scope.slice(connector.length + 1) : r.scope;
    const trigger = (Object.entries(TRIGGER_MAP).find(([, v]) => v === r.trigger)?.[0] ?? 'schedule') as ScanTrigger;
    const st: RunState = {
      runId,
      scope: { connector, scope },
      connectorId: r.connector_id,
      trigger,
      window: { from: iso(r.window_start) ?? this.now().toISOString(), to: iso(r.window_end) ?? this.now().toISOString() },
      skillVersion: r.skill_version ?? undefined,
      staged: [],
    };
    RUNS.set(runId, st);
    return st;
  }

  /** S1: lock the run row and require `running`. */
  private async mustRunning(tx: DbOrTx, runId: string, lock = true): Promise<void> {
    const res = await tx.execute<{ status: string }>(
      lock ? sql`select status from scan_runs where id = ${runId} for update` : sql`select status from scan_runs where id = ${runId}`,
    );
    const s = res.rows[0]?.status;
    if (!s) throw new RunStateError(`unknown run ${runId}`);
    if (s !== 'running') throw new RunStateError(`run ${runId} is ${s === 'succeeded' ? 'succeeded' : s === 'cancelled' ? 'failed' : s}`);
  }

  private async mustWork(tx: DbOrTx, id: string): Promise<void> {
    if (!UUID.test(id)) throw new StoreNotFoundError(`work item ${id}`);
    const r = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from work_items where id = ${id} and owner_user_id = ${this.userId}) as ok`);
    if (!r.rows[0]?.ok) throw new StoreNotFoundError(`work item ${id}`);
  }

  private async mustSources(tx: DbOrTx, ids: string[]): Promise<void> {
    const bad = ids.find((id) => !UUID.test(id));
    if (bad) throw new StoreNotFoundError(`source item ${bad}`);
    if (!ids.length) return;
    const r = await tx.execute<{ id: string }>(sql`select id from source_items where owner_user_id = ${this.userId} and id = any(${uuidArr(ids)})`);
    const have = new Set(r.rows.map((x) => x.id));
    const missing = ids.find((id) => !have.has(id));
    if (missing) throw new StoreNotFoundError(`source item ${missing}`);
  }

  /** S10: add work items to the scope's durable pending re-evaluation set. */
  private async markPending(tx: DbOrTx, run: RunState, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const sid = scopeId(run.scope);
    await tx.execute(sql`
      insert into scan_cursors (owner_user_id, connector_id, scope, cursor_kind, cursor_json)
      values (${this.userId}, ${run.connectorId}, ${sid}, 'composite', jsonb_build_object('pending', to_jsonb(${textArr(ids)})))
      on conflict (connector_id, scope) do update set
        cursor_json = jsonb_set(coalesce(scan_cursors.cursor_json, '{}'::jsonb), '{pending}',
          to_jsonb(array(select distinct x from unnest(
            coalesce(array(select jsonb_array_elements_text(scan_cursors.cursor_json->'pending')), '{}'::text[]) || ${textArr(ids)}) as x order by x))),
        updated_at = now()`);
  }

  // ------------------------------------------------------------------ digests

  /** Linkable items (S14): not dismissed/merged; done only within the reopen window. */
  private async digests(opts: { limit?: number; ids?: string[] } = {}): Promise<OpenItemDigestExt[]> {
    const since = new Date(this.now().getTime() - REOPEN_WINDOW_MS).toISOString();
    const idFilter = opts.ids ? sql`and wi.id = any(${uuidArr(opts.ids)})` : sql``;
    const lim = opts.limit !== undefined ? sql`limit ${opts.limit}` : sql``;
    const res = await this.db.execute<DigestRow>(sql`
      select wi.id, wi.initiative_id, wi.kind, wi.title, wi.purpose, wi.status, wi.resolution, wi.involvement,
             case when wi.resolution = 'handed_off' then coalesce(rp.display_name, rp.primary_email) end as handed_off_to,
             wi.account_id,
             (select array_agg(distinct lower(k)) from (
                select cp.display_name as k from people cp where cp.id = wi.counterparty_person_id
                union all select cp.primary_email from people cp where cp.id = wi.counterparty_person_id
                union all select p.display_name from work_item_links l join people p on p.id = l.person_id where l.work_item_id = wi.id
                union all select p.primary_email from work_item_links l join people p on p.id = l.person_id where l.work_item_id = wi.id
                union all
                select v.k from work_item_evidence e
                  join source_items si on si.id = e.source_item_id
                  cross join lateral (
                        select si.meta->'author' as p
                         where jsonb_typeof(si.meta->'author') = 'object' and coalesce(si.meta->'author'->>'isMe', 'false') <> 'true'
                        union all
                        select x from jsonb_array_elements(case when jsonb_typeof(si.meta->'participants') = 'array' then si.meta->'participants' else '[]'::jsonb end) x
                         where jsonb_typeof(x) = 'object' and coalesce(x->>'isMe', 'false') <> 'true') pp
                  cross join lateral (values (pp.p->>'externalId'), (pp.p->>'email'), (pp.p->>'name')) v(k)
                 where e.work_item_id = wi.id
              ) people where k is not null and k <> '') as people,
             (select array_agg(distinct a) from (
                select wi.account_id::text as a where wi.account_id is not null
                union all
                select coalesce((select ac.id::text from accounts ac
                                   left join account_aliases al on al.account_id = ac.id
                                  where ac.owner_user_id = wi.owner_user_id
                                    and (ac.id::text = h or lower(ac.name) = lower(h) or al.normalized_value = lower(h)) limit 1), h)
                  from work_item_evidence e join source_items si on si.id = e.source_item_id,
                       jsonb_array_elements_text(case when jsonb_typeof(si.meta->'accountHints') = 'array' then si.meta->'accountHints' else '[]'::jsonb end) h
                 where e.work_item_id = wi.id
              ) accts) as accounts,
             (select array_agg(distinct si.external_parent_id) from work_item_evidence e join source_items si on si.id = e.source_item_id
               where e.work_item_id = wi.id and si.external_parent_id is not null) as thread_refs,
             (select array_agg(distinct f) from (
                select r.value as f from work_item_evidence e join source_item_refs r on r.source_item_id = e.source_item_id
                 where e.work_item_id = wi.id and r.kind in ('drive_file', 'url')
                union all select x.external_id from work_item_links l join assets x on x.id = l.asset_id where l.work_item_id = wi.id
                union all select x.external_id from work_item_deliverables dd join assets x on x.id = dd.asset_id where dd.work_item_id = wi.id
              ) files) as file_refs,
             (select max(si.occurred_at) from work_item_evidence e join source_items si on si.id = e.source_item_id where e.work_item_id = wi.id) as last_evidence_at,
             d.expected_file, d.expected_changes, d.id is not null as has_deliverable
        from work_items wi
        left join people rp on rp.id = wi.resolution_person_id
        left join lateral (
              select dd.id, x.external_id as expected_file,
                     (select array_agg(r.description order by r.ordinal) from deliverable_requirements r where r.deliverable_id = dd.id) as expected_changes
                from work_item_deliverables dd left join assets x on x.id = dd.asset_id
               where dd.work_item_id = wi.id and dd.status <> 'abandoned'
               order by dd.created_at desc limit 1) d on true
       where wi.owner_user_id = ${this.userId}
         and wi.status not in ('dismissed', 'merged')
         and (wi.status <> 'done' or coalesce(wi.done_at, wi.status_changed_at) >= ${since}::timestamptz)
         ${idFilter}
       order by last_evidence_at desc nulls last, wi.created_at desc
       ${lim}`);
    return res.rows.map((r) => {
      const d: OpenItemDigestExt = {
        workItemId: r.id,
        initiativeId: r.initiative_id ?? undefined,
        kind: r.kind,
        title: r.title,
        purpose: r.purpose ?? undefined,
        state: r.status,
        people: (r.people ?? []).map(normPerson),
        accounts: r.accounts ?? [],
        keywords: [...new Set([...tokenize(r.title), ...tokenize(r.purpose ?? undefined)])].slice(0, 12),
        threadRefs: r.thread_refs ?? [],
        fileRefs: [...new Set([...(r.file_refs ?? []), ...(r.expected_file ? [r.expected_file] : [])])],
        lastEvidenceAt: iso(r.last_evidence_at),
        involvement: r.involvement,
      };
      if (r.resolution) d.resolution = r.resolution;
      if (r.handed_off_to) d.handedOffTo = r.handed_off_to;
      if (r.has_deliverable) d.expected = { ...(r.expected_file ? { fileId: r.expected_file } : {}), changes: r.expected_changes ?? [] };
      return d;
    });
  }

  private async initiativeDigests(): Promise<ScanContext['initiatives']> {
    const r = await this.db.execute<{ id: string; title: string; purpose: string | null; accounts: string[] | null }>(sql`
      select i.id, i.title, i.purpose,
             (select array_agg(distinct a) from (
                select i.account_id::text as a where i.account_id is not null
                union all select w.account_id::text from work_items w where w.initiative_id = i.id and w.account_id is not null) x) as accounts
        from initiatives i
       where i.owner_user_id = ${this.userId} and i.status in ('proposed', 'active', 'paused') and i.archived_at is null
       order by i.updated_at desc limit 200`);
    return r.rows.map((i) => ({
      initiativeId: i.id,
      title: i.title,
      purpose: i.purpose ?? undefined,
      accounts: i.accounts ?? [],
      keywords: [...new Set(tokenize(`${i.title} ${i.purpose ?? ''}`))],
    }));
  }

  private async aliasAccounts(): Promise<ScanContext['aliases']['accounts']> {
    const r = await this.db.execute<{ id: string; name: string; org62: string | null; aliases: string[] | null }>(sql`
      select a.id, a.name, a.org62_account_id as org62, array_remove(array_agg(distinct al.value), null) as aliases
        from accounts a
        left join account_aliases al on al.account_id = a.id and al.kind in ('name', 'short_name', 'domain')
       where a.owner_user_id = ${this.userId} and a.archived_at is null
       group by a.id, a.name, a.org62_account_id
       order by a.is_my_book desc, a.name
       limit 500`);
    // `org62:<001…>` lets the Org62 skill build SOQL IN (…) lists (runtime/connectors.ts org62AccountIds).
    return r.rows.map((a) => ({ accountId: a.id, names: [...new Set([a.name, ...(a.aliases ?? []), ...(a.org62 ? [`org62:${a.org62}`] : [])])] }));
  }

  // ------------------------------------------------------------------ context

  async getContext(scope: ScopeKey, opts: { maxOpenItems?: number } = {}): Promise<ScanContext> {
    const now = this.now();
    const max = Math.max(0, Math.min(opts.maxOpenItems ?? 60, 1000));
    const connectorId = await this.connectorId(scope.connector);
    const sid = scopeId(scope);
    const [cursor, me, watch, accounts, channels, items, inits, last, hasCov, scanning, persona] = await Promise.all([
      this.getCursor(scope),
      this.db.execute<{ id: string; name: string; email: string; slack_id: string | null; org62_user_id: string | null }>(sql`
        select u.id, coalesce(u.display_name, p.display_name, u.email) as name, u.email,
               (select pi.external_id from person_identities pi where pi.person_id = u.person_id and pi.system = 'slack'
                 order by pi.is_primary desc limit 1) as slack_id,
               (select pi.external_id from person_identities pi where pi.person_id = u.person_id and pi.system = 'org62_user'
                 order by pi.is_primary desc limit 1) as org62_user_id
          from users u left join people p on p.id = u.person_id
         where u.id = ${this.userId}`),
      this.db.execute<{ kind: string; ref: string | null; label: string }>(sql`
        select w.scope_kind::text as kind,
               coalesce(c.external_id, o.org62_opportunity_id, a.org62_account_id, a.id::text, p.primary_email, p.id::text,
                        i.id::text, w.search_query) as ref,
               w.label
          from watch_subscriptions w
          left join channels c on c.id = w.channel_id
          left join opportunities o on o.id = w.opportunity_id
          left join accounts a on a.id = w.account_id
          left join people p on p.id = w.person_id
          left join initiatives i on i.id = w.initiative_id
         where w.owner_user_id = ${this.userId} and w.enabled
        union all
        select 'channel', c.external_id, coalesce(c.name, c.external_id)
          from channels c
         where c.owner_user_id = ${this.userId} and c.watch_mode = 'digest' and c.archived_at is null
           and not exists (select 1 from watch_subscriptions w where w.channel_id = c.id and w.enabled)`),
      this.aliasAccounts(),
      this.db.execute<{ external_id: string; account_id: string | null; name: string | null }>(sql`
        select c.external_id, m.account_id, c.name
          from channels c
          left join channel_account_maps m on m.channel_id = c.id and m.user_verdict is distinct from 'rejected'
         where c.owner_user_id = ${this.userId} and c.archived_at is null
           and (m.account_id is not null or c.is_customer_channel or c.watch_mode <> 'items')
         limit 500`),
      max > 0 ? this.digests({ limit: max }) : Promise.resolve([]),
      this.initiativeDigests(),
      this.db.execute<{ skill_version: string | null }>(sql`
        select skill_version from scan_runs where connector_id = ${connectorId} and scope = ${sid} and status = 'succeeded'
         order by finished_at desc nulls last limit 1`),
      this.db.execute<{ ok: boolean }>(sql`
        select exists (select 1 from scan_ledger_entries where connector_id = ${connectorId} and scope = ${sid}
                         and outcome = 'complete' and covered is not null) as ok`),
      this.scanningPrefs(),
      this.persona(),
    ]);
    const u = me.rows[0];
    if (!u) throw new StoreNotFoundError(`user ${this.userId}`);
    const gaps = hasCov.rows[0]?.ok ? await this.coverageGaps(scope, { from: isoMs(now.getTime() - 7 * DAY), to: now.toISOString() }) : [];
    return {
      scope,
      cursor,
      gaps,
      me: { userId: u.id, name: u.name, email: u.email, slackId: u.slack_id ?? undefined, org62UserId: u.org62_user_id ?? undefined },
      watchList: watch.rows.filter((w) => w.ref).map((w) => ({ kind: w.kind, ref: w.ref!, label: w.label })),
      aliases: {
        accounts,
        channels: channels.rows.map((c) => ({ channelId: c.external_id, accountId: c.account_id ?? undefined, label: c.name ?? undefined })),
      },
      openItems: items,
      initiatives: inits,
      skillVersion: last.rows[0]?.skill_version ?? '',
      scanning,
      persona,
    };
  }

  /** D-55: the persona (Settings ▸ Role & rules), read fresh every time: a switch applies to the next plan and run. */
  async persona(): Promise<ResolvedPersona> {
    return loadPersona(this.db, this.userId);
  }

  /** Settings ▸ Scanning (SCAN-SET), read fresh on every context (a change applies to the next run). */
  async scanningPrefs(): Promise<ScanningPrefs> {
    const r = await this.db.execute<{ value: Record<string, unknown> | null }>(sql`
      select value from user_settings where owner_user_id = ${this.userId} and key = 'settings.scanning' limit 1`);
    return scanningPrefsOf(r.rows[0]?.value);
  }

  // ------------------------------------------------------------------ runs

  async startRun(input: {
    scope: ScopeKey;
    trigger: ScanTrigger;
    window: TimeWindow;
    model?: string;
    skillVersion?: string;
    /** BE-1a extension: the job that runs this scan (scan_runs.job_id). */
    jobId?: number | string;
  }): Promise<{ runId: string }> {
    const { scope } = input;
    if (toMs(input.window.from) == null || toMs(input.window.to) == null) throw new RangeError('startRun: invalid window');
    const connectorId = await this.connectorId(scope.connector);
    const cursor = await this.getCursor(scope);
    const mode = input.trigger === 'reconcile' ? 'reconcile' : input.trigger === 'catch_up' ? 'backfill' : 'incremental';
    const runId = await this.cs(
      scope.connector,
      `scan ${scopeId(scope)} started`,
      async (tx) => {
        // Health "Rescan" inserts a queued placeholder run for the job it enqueues, so the UI has a run to show at
        // once. The job's first run adopts that row (queued → running → done): one run, not a placeholder that
        // never finishes next to the real one (BE-CHAT hole; stress finding W-1).
        if (input.jobId !== undefined && input.jobId !== null) {
          const adopted = await tx.execute<{ id: string }>(sql`
            update scan_runs set scope = ${scopeId(scope)}, trigger = ${TRIGGER_MAP[input.trigger]}, mode = ${mode}, status = 'running',
                   window_start = ${isoMs(toMs(input.window.from)!)}::timestamptz, window_end = ${isoMs(toMs(input.window.to)!)}::timestamptz,
                   skill_key = ${CONNECTOR_META[scope.connector]?.skill ?? null}, skill_version = ${input.skillVersion ?? null},
                   model_tier = ${modelTierOf(input.model)}, cursor_before = ${JSON.stringify(cursor ? { at: cursor.at } : null)}::jsonb,
                   started_at = ${this.now().toISOString()}::timestamptz, error_code = null, error_message = null
             where id = (select id from scan_runs where owner_user_id = ${this.userId} and connector_id = ${connectorId}
                            and job_id = ${Number(input.jobId)} and status = 'queued' order by created_at limit 1 for update)
            returning id`);
          if (adopted.rows[0]) return adopted.rows[0].id;
        }
        const res = await tx.execute<{ id: string }>(sql`
          insert into scan_runs (owner_user_id, connector_id, scope, trigger, mode, status, window_start, window_end, job_id,
                                 skill_key, skill_version, model_tier, cursor_before, started_at)
          values (${this.userId}, ${connectorId}, ${scopeId(scope)}, ${TRIGGER_MAP[input.trigger]}, ${mode}, 'running',
                  ${isoMs(toMs(input.window.from)!)}::timestamptz, ${isoMs(toMs(input.window.to)!)}::timestamptz,
                  ${input.jobId === undefined || input.jobId === null ? null : Number(input.jobId)},
                  ${CONNECTOR_META[scope.connector]?.skill ?? null}, ${input.skillVersion ?? null}, ${modelTierOf(input.model)},
                  ${JSON.stringify(cursor ? { at: cursor.at } : null)}::jsonb, ${this.now().toISOString()}::timestamptz)
          returning id`);
        return res.rows[0]!.id;
      },
      false,
    );
    RUNS.set(runId, { runId, scope, connectorId, trigger: input.trigger, window: { ...input.window }, skillVersion: input.skillVersion, model: input.model, staged: [] });
    return { runId };
  }

  async recordSourceItems(
    runId: string,
    items: NormalizedSourceItem[],
  ): Promise<Array<{ sourceItemId: string; dedupeKey: string; isNew: boolean; changed: boolean }>> {
    const run = await this.run(runId);
    for (const it of items) {
      if (!it.dedupeKey || !it.contentHash || !it.externalId) throw new RangeError('recordSourceItems: dedupeKey, contentHash and externalId are required');
      const watchOk = run.scope.connector === 'watch' && (it.connector === 'slack' || it.connector === 'org62');
      if (it.connector !== run.scope.connector && !watchOk) throw new RangeError(`recordSourceItems: item connector ${it.connector} ≠ run connector ${run.scope.connector}`);
      if (toMs(it.occurredAt) == null) throw new RangeError(`recordSourceItems: ${it.dedupeKey} occurredAt is not a timestamp`);
    }
    const connectorIds = new Map<ConnectorId, string>();
    for (const c of new Set(items.map((i) => i.connector))) connectorIds.set(c, c === run.scope.connector ? run.connectorId : await this.connectorId(c));
    const rows = await this.cs(
      run.scope.connector,
      `ingest ${items.length} item(s) from ${scopeId(run.scope)}`,
      async (tx) => {
        await this.mustRunning(tx, runId);
        const rows: Array<{ sourceItemId: string; dedupeKey: string; isNew: boolean; changed: boolean }> = [];
        for (const it of items) rows.push(await this.upsertItem(tx, run, it, connectorIds.get(it.connector)!));
        return rows;
      },
      false,
    );
    // AUDIT: which source items this run saw (new / changed / unchanged), so "was it fetched?" has an answer.
    trace(runId, 'recorded', () => ({ n: rows.length, new: rows.filter((r) => r.isNew).length, changed: rows.filter((r) => r.changed).length, ids: rows.map((r) => r.sourceItemId), newIds: rows.filter((r) => r.isNew).map((r) => r.sourceItemId) }));
    return rows;
  }

  private async upsertItem(
    tx: Tx,
    run: RunState,
    it: NormalizedSourceItem,
    connectorId: string,
  ): Promise<{ sourceItemId: string; dedupeKey: string; isNew: boolean; changed: boolean }> {
    const { source, kind } = dbKindOf(it);
    const { meta: rawMeta, text } = splitPayload(it.payload);
    const metaDeep = redactDeep({
      ...rawMeta,
      itemKind: it.kind,
      connector: it.connector,
      threadRef: it.threadRef,
      fileRefs: it.fileRefs,
      accountHints: it.accountHints,
      oppHints: it.oppHints,
      author: it.author ? { name: it.author.name, email: it.author.email, externalId: it.author.externalId, isMe: it.author.isMe, isExternal: it.author.isExternal } : undefined,
      participants: it.participants?.slice(0, 50),
    });
    const excerpt = (it.excerpt ?? '').slice(0, 1000);
    const bodyRaw = text.length ? [excerpt && !text.some((t) => t.includes(excerpt)) ? excerpt : '', ...text].filter(Boolean).join('\n\n') : excerpt;
    const body = redact(bodyRaw.slice(0, 60_000));
    const title = redact(it.title ?? '');
    const own = body.count + title.count;
    const redactionCount = own + (metaDeep.redacted ? 1 : 0) + (it.redacted && own === 0 && !metaDeep.redacted ? 1 : 0);
    const kinds = [...new Set([...body.kinds, ...title.kinds, ...(redactionCount > own ? ['upstream'] : [])])];
    const fromMe = it.author?.isMe === true;
    const p = it.payload ?? {};
    const toMe = (it.participants ?? []).some((x) => x.isMe) || p.toMe === true || p.ccMe === true || p.mentionsMe === true;
    const occurred = isoMs(toMs(it.occurredAt)!);
    const actorPersonId = await this.actorPerson(tx, it);
    // Provenance: a deep link on every item. Org62 rows and Claude sessions carry no permalink of their own (links.ts).
    const url = it.permalink ?? sourceItemUrl({ source, externalId: it.externalId, meta: { ...rawMeta, oppHints: it.oppHints } });
    const res = await tx.execute<{ id: string; inserted: boolean; written: boolean }>(sql`
      with ins as (
        insert into source_items as s
               (owner_user_id, connector_id, source, kind, external_id, external_parent_id, external_container_id, dedupe_key,
                content_hash, occurred_at, actor_external_id, actor_person_id, from_me, addressed_to_me, title, url, body, body_format,
                body_expires_at, redacted, redaction_count, redaction_kinds, meta, first_scan_run_id, last_scan_run_id)
        values (${this.userId}, ${connectorId}, ${source}, ${kind}, ${it.externalId}, ${it.threadRef ?? null},
                ${run.scope.scope}, ${it.dedupeKey}, ${it.contentHash}, ${occurred}::timestamptz,
                ${it.author?.email ?? it.author?.externalId ?? null}, (select p.id from people p where p.id = ${actorPersonId}::uuid), ${fromMe}, ${toMe && !fromMe},
                ${title.text || null}, ${url}, ${body.text || null}, 'plain',
                ${occurred}::timestamptz + interval '90 days', ${redactionCount > 0}, ${redactionCount}, ${textArr(kinds)},
                ${JSON.stringify(metaDeep.value)}::jsonb, ${run.runId}, ${run.runId})
        on conflict (owner_user_id, dedupe_key) do update set
               content_hash       = excluded.content_hash,
               title              = excluded.title,
               url                = excluded.url,
               body               = case when s.body_purged_at is null then excluded.body end,
               meta               = excluded.meta,
               external_parent_id = excluded.external_parent_id,
               actor_external_id  = excluded.actor_external_id,
               actor_person_id    = coalesce(excluded.actor_person_id, s.actor_person_id),
               from_me            = excluded.from_me,
               addressed_to_me    = excluded.addressed_to_me,
               redacted           = excluded.redacted,
               redaction_count    = excluded.redaction_count,
               redaction_kinds    = excluded.redaction_kinds,
               revision           = s.revision + 1,
               content_changed_at = now(),
               last_seen_at       = now(),
               last_scan_run_id   = excluded.last_scan_run_id
         where s.content_hash is distinct from excluded.content_hash
        returning s.id, (s.xmax = 0) as inserted
      )
      select id, inserted, true as written from ins
      union all
      select id, false, false from source_items
       where owner_user_id = ${this.userId} and dedupe_key = ${it.dedupeKey} and not exists (select 1 from ins)`);
    const row = res.rows[0]!;
    // PPL-1: an unchanged row recorded before the author was known gets the person now.
    if (!row.written && actorPersonId) await tx.execute(sql`update source_items set actor_person_id = (select p.id from people p where p.id = ${actorPersonId}::uuid) where id = ${row.id} and actor_person_id is null`);
    if (row.written && it.fileRefs?.length) {
      // RED-1: a ref that redaction would change (a password-manager share link) is a credential: never stored as a ref.
      for (const ref of it.fileRefs.slice(0, 30).filter((r) => !redact(r).redacted)) {
        await tx.execute(sql`
          insert into source_item_refs (source_item_id, kind, value)
          values (${row.id}, ${DRIVE_ID.test(ref) ? 'drive_file' : 'url'}, ${ref})
          on conflict (source_item_id, kind, value) do nothing`);
      }
    }
    return { sourceItemId: row.id, dedupeKey: it.dedupeKey, isNew: row.inserted, changed: row.written && !row.inserted };
  }

  /**
   * PPL-1: the person behind a source item's author. Me for my own items; otherwise a known identity (Slack user id,
   * then email) or a directory email. A Slack author nobody knows yet gets a person row (hidden from the directory, like
   * any referenced person outside it: `synthetic`) with the Slack identity, so asks, replies and the completion pass can
   * tell people apart. Before, `actor_person_id` was empty on every Slack source item.
   */
  private async actorPerson(tx: Tx, it: NormalizedSourceItem): Promise<string | null> {
    const a = it.author;
    if (!a) return null;
    if (a.isMe) {
      const hit = this.persons.get('me');
      if (hit) return hit;
      const r = await tx.execute<{ id: string | null }>(sql`select person_id as id from users where id = ${this.userId}`);
      const id = r.rows[0]?.id ?? null;
      if (id) this.persons.set('me', id);
      return id;
    }
    const slack = it.connector === 'slack' && a.externalId && /^[UW][A-Z0-9]{6,}$/.test(a.externalId) ? a.externalId : undefined;
    const email = a.email && /@/.test(a.email) ? a.email.trim().toLowerCase() : undefined;
    const keys = [...(slack ? [`slack:${slack}`] : []), ...(email ? [`email:${email}`] : [])];
    if (!keys.length) return null;
    for (const k of keys) {
      const hit = this.persons.get(k);
      if (hit) return hit;
    }
    const missAt = this.noPerson.get(keys.join('|'));
    if (!slack && missAt !== undefined && Date.now() - missAt < 10 * 60_000) return null;
    const found = await tx.execute<{ id: string; sys: string }>(sql`
      select pi.person_id as id, pi.system::text as sys from person_identities pi join people p on p.id = pi.person_id
       where pi.owner_user_id = ${this.userId} and p.merged_into_person_id is null
         and ((pi.system = 'slack' and pi.external_id = ${slack ?? ''}) or (pi.system = 'email' and lower(pi.external_id) = ${email ?? ''}))
      union all
      select p.id, 'directory' from people p
       where p.owner_user_id = ${this.userId} and p.merged_into_person_id is null and ${email ?? ''} <> '' and lower(p.primary_email) = ${email ?? ''}
       order by 2 desc limit 1`);
    let id = found.rows[0]?.id ?? null;
    if (id && slack && found.rows[0]!.sys !== 'slack') {
      await tx.execute(sql`
        insert into person_identities (owner_user_id, person_id, system, external_id, method, confidence)
        values (${this.userId}, ${id}::uuid, 'slack', ${slack}, 'connector', 1) on conflict do nothing`);
    }
    if (!id && slack && a.name?.trim()) {
      const name = redact(a.name.trim()).text.slice(0, 120);
      const created = await tx.execute<{ id: string }>(sql`
        insert into people (owner_user_id, display_name, primary_email, affiliation)
        values (${this.userId}, ${name}, ${email ?? null}, ${a.isExternal ? 'customer' : 'unknown'}) returning id`);
      const pid = created.rows[0]!.id;
      const ident = await tx.execute<{ person_id: string }>(sql`
        insert into person_identities (owner_user_id, person_id, system, external_id, method, confidence)
        values (${this.userId}, ${pid}::uuid, 'slack', ${slack}, 'connector', 1)
        on conflict (owner_user_id, system, external_id) do nothing returning person_id`);
      if (ident.rows[0]) {
        if (email) {
          await tx.execute(sql`
            insert into person_identities (owner_user_id, person_id, system, external_id, method, confidence)
            values (${this.userId}, ${pid}::uuid, 'email', ${email}, 'connector', 1) on conflict do nothing`);
        }
        await tx.execute(sql`
          insert into user_settings (owner_user_id, key, value) values (${this.userId}, ${`cc.ext/people/${pid}`}, ${JSON.stringify({ synthetic: true })}::jsonb)
          on conflict do nothing`);
        id = pid;
      } else {
        // Someone else created it meanwhile: use theirs, drop ours.
        await tx.execute(sql`delete from people where id = ${pid}::uuid`);
        const r = await tx.execute<{ id: string }>(sql`select person_id as id from person_identities where owner_user_id = ${this.userId} and system = 'slack' and external_id = ${slack}`);
        id = r.rows[0]?.id ?? null;
      }
    }
    if (id) for (const k of keys) this.persons.set(k, id);
    else this.noPerson.set(keys.join('|'), Date.now());
    return id;
  }

  // ------------------------------------------------------------------ linking

  async findCandidates(q: {
    text?: string;
    people?: string[];
    accounts?: string[];
    threadRefs?: string[];
    fileRefs?: string[];
    limit?: number;
  }): Promise<Candidate[]> {
    const tokens = new Set(tokenize(q.text));
    const people = new Set((q.people ?? []).map(normPerson).filter(Boolean));
    const threads = new Set(q.threadRefs ?? []);
    const files = new Set(q.fileRefs ?? []);
    const launched = new Set([...threads].filter((t) => t.startsWith('cc:')).map((t) => t.slice(3)));
    const aliases = people.size || q.accounts?.length ? await this.aliasAccounts() : [];
    const resolve = (hints: string[]) =>
      [
        ...new Set(
          hints.map((h) => {
            const lower = h.toLowerCase();
            return aliases.find((a) => a.accountId === h || a.names.some((n) => n.toLowerCase() === lower))?.accountId ?? h;
          }),
        ),
      ];
    const accounts = new Set(resolve(q.accounts ?? []));
    const [pool, inits] = await Promise.all([this.digests(), tokens.size || accounts.size ? this.initiativeDigests() : Promise.resolve([])]);
    const out: CandidateExt[] = [];
    const ext = (w: OpenItemDigestExt) => ({ state: w.state, ...(w.resolution ? { resolution: w.resolution } : {}), ...(w.involvement ? { involvement: w.involvement } : {}) });
    for (const w of pool) {
      if (launched.has(w.workItemId)) {
        out.push({ workItemId: w.workItemId, initiativeId: w.initiativeId, title: w.title, score: 1, why: 'same thread; launched from this item', ...ext(w) });
        continue;
      }
      let score = 0;
      const why: string[] = [];
      if (w.threadRefs.some((t) => threads.has(t))) {
        score += 0.6;
        why.push('same thread');
      }
      if (w.fileRefs.some((f) => files.has(f))) {
        score += 0.5;
        why.push('same file');
      }
      const pHits = [...people].filter((p) => w.people.some((wp) => wp === p || wp.includes(p) || p.includes(wp)));
      if (pHits.length) {
        score += Math.min(0.3, 0.15 * pHits.length);
        why.push(`people: ${pHits.slice(0, 3).join(', ')}`);
      }
      const aHits = [...accounts].filter((a) => w.accounts.includes(a));
      if (aHits.length) {
        score += 0.25;
        why.push(`account: ${aHits[0]}`);
      }
      const itemTokens = new Set([...w.keywords, ...tokenize(w.title), ...tokenize(w.purpose)]);
      const kHits = [...tokens].filter((t) => itemTokens.has(t));
      if (kHits.length) {
        score += Math.min(0.35, (0.35 * kHits.length) / Math.max(2, Math.min(tokens.size, itemTokens.size)));
        why.push(`keywords: ${kHits.slice(0, 4).join(', ')}`);
      }
      if (score >= 0.15) out.push({ workItemId: w.workItemId, initiativeId: w.initiativeId, title: w.title, score: Math.min(1, Math.round(score * 100) / 100), why: why.join('; '), ...ext(w) });
    }
    for (const i of inits) {
      let score = 0;
      const why: string[] = [];
      const aHits = [...accounts].filter((a) => i.accounts.includes(a));
      if (aHits.length) {
        score += 0.3;
        why.push(`account: ${aHits[0]}`);
      }
      const it = new Set([...i.keywords, ...tokenize(i.title), ...tokenize(i.purpose)]);
      const kHits = [...tokens].filter((t) => it.has(t));
      if (kHits.length) {
        score += Math.min(0.4, (0.4 * kHits.length) / Math.max(2, Math.min(tokens.size, it.size)));
        why.push(`keywords: ${kHits.slice(0, 4).join(', ')}`);
      }
      if (score >= 0.2) out.push({ initiativeId: i.initiativeId, title: i.title, score: Math.min(1, Math.round(score * 100) / 100), why: why.join('; ') });
    }
    return out
      .sort((a, b) => b.score - a.score || (a.workItemId ?? a.initiativeId ?? '').localeCompare(b.workItemId ?? b.initiativeId ?? ''))
      .slice(0, q.limit ?? 5);
  }

  async linkEvidence(
    runId: string,
    input: { workItemId: string; sourceItemId: string; role: EvidenceRole; confidence: Confidence; reason: string },
  ): Promise<{ evidenceId: string; touchedWorkItemId: string }> {
    const run = await this.run(runId);
    const extractorId = await this.extractorId(run.scope.connector, run.skillVersion, run.model);
    const evidenceId = await this.cs(run.scope.connector, `link evidence (${input.role})`, async (tx) => {
      await this.mustRunning(tx, runId);
      await this.mustWork(tx, input.workItemId);
      await this.mustSources(tx, [input.sourceItemId]);
      let { confidence, reason } = input;
      if (input.role === 'completion' && confidence !== 'sure') {
        const what = await this.deliveredWith(tx, input.workItemId, input.sourceItemId);
        if (what) {
          confidence = 'sure';
          reason = `delivered_with_attachment: ${what}; ${reason}`;
        }
      }
      const { id } = await this.addEvidence(tx, run, input.workItemId, input.sourceItemId, input.role, confidence, reason, extractorId);
      return id;
    });
    trace(runId, 'link', { evidenceId, role: input.role, confidence: input.confidence, reason: input.reason }, { sourceItemId: input.sourceItemId, workItemId: input.workItemId });
    return { evidenceId, touchedWorkItemId: input.workItemId };
  }

  /**
   * DLV-1: a completion is Sure when it is my Slack reply in the ask's own DM or thread, after the ask, carrying the
   * file or link the item asks for (src/scanner/delivery.ts). "here you go" plus the zip closes the item; the same
   * words alone stay Likely (a confirm click).
   */
  private async deliveredWith(tx: Tx, workItemId: string, sourceItemId: string): Promise<string | null> {
    const r = await tx.execute<{ title: string; purpose: string | null; meta: Record<string, unknown>; body: string | null; occurred: string; same: boolean }>(sql`
      select w.title, w.purpose, s.meta, s.body, s.occurred_at as occurred,
             exists (
               select 1 from work_item_evidence e join source_items o on o.id = e.source_item_id
                where e.work_item_id = w.id and e.role = 'origin' and o.source = 'slack' and o.occurred_at < s.occurred_at
                  and (o.external_parent_id = s.external_parent_id
                       or (o.meta->>'channelId' = s.meta->>'channelId' and coalesce(s.meta->>'channelType', '') in ('im', 'mpim')))) as same
        from work_items w, source_items s
       where w.id = ${workItemId} and s.id = ${sourceItemId} and s.source = 'slack' and s.from_me`);
    const row = r.rows[0];
    if (!row?.same) return null;
    const m = row.meta ?? {};
    const files = Array.isArray(m.files) ? (m.files as { name?: string; mimetype?: string }[]) : [];
    const urls = [...String(row.body ?? '').matchAll(/https?:\/\/[^\s|>)]+/g)].map((x) => x[0]);
    return deliveryMatch({ title: row.title, purpose: row.purpose }, { files, hasFile: m.hasFile === true, urls });
  }

  /** S3 + S10: one evidence row per (item, source, role); new rows join the pending set and get the W2 bump. */
  private async addEvidence(
    tx: Tx,
    run: RunState,
    workItemId: string,
    sourceItemId: string,
    role: EvidenceRole,
    confidence: Confidence,
    reason: string,
    extractorId: string,
  ): Promise<{ id: string; created: boolean }> {
    const ins = await tx.execute<{ id: string }>(sql`
      insert into work_item_evidence (work_item_id, source_item_id, role, confidence, extractor_id, rationale, created_by)
      values (${workItemId}, ${sourceItemId}, ${role}, ${CONFIDENCE_NUM[confidence] ?? 0.5}, ${extractorId},
              ${redact(reason ?? '').text.slice(0, 1000)}, 'connector')
      on conflict on constraint work_item_evidence_target_uq do nothing
      returning id`);
    const id = ins.rows[0]?.id;
    if (!id) {
      const ex = await tx.execute<{ id: string }>(sql`
        select id from work_item_evidence where work_item_id = ${workItemId} and source_item_id = ${sourceItemId} and role = ${role}`);
      return { id: ex.rows[0]!.id, created: false };
    }
    await this.markPending(tx, run, [workItemId]);
    // Save first, then re-evaluate asynchronously (W2). Context-only evidence (hand-offs) does not bump the item.
    if (role !== 'context') await recordNewInfo(tx, workItemId);
    await tx.execute(sql`
      update reconcile_findings set status = 'resolved', resolved_at = now(), resolution_note = 'linked', updated_at = now()
       where owner_user_id = ${this.userId} and source_item_id = ${sourceItemId} and kind = 'unlinked_item' and status = 'open'`);
    return { id, created: true };
  }

  async proposeItem(runId: string, input: ProposeItemInput): Promise<{ workItemId: string; landedAs: 'open' | 'suggested' }> {
    const run = await this.run(runId);
    if (!input.evidence?.length) throw new RangeError('proposeItem: at least one evidence row is required');
    if (!input.title?.trim()) throw new RangeError('proposeItem: title is required');
    const kind = (
      { task: 'task', commitment: 'commitment', ask: 'ask', training: 'training', follow_up: 'task', travel: 'travel', deliverable: 'task' } as const
    )[input.kind];
    if (!kind) throw new RangeError(`proposeItem: unknown kind ${input.kind}`);
    const origins = input.evidence.filter((e) => e.role === 'origin').map((e) => e.sourceItemId);
    const keyIds = [...(origins.length ? origins : input.evidence.map((e) => e.sourceItemId))].sort();
    const key = `propose:${hashKey(`${input.kind}|${keyIds.join(',')}`)}`;
    const extractorId = await this.extractorId(run.scope.connector, run.skillVersion, run.model);
    const title = redact(input.title.trim()).text.slice(0, 300);
    const tz = await this.timezone();
    const proposed = await this.cs(run.scope.connector, `propose ${input.kind}: ${title.slice(0, 80)}`, async (tx) => {
      await this.mustRunning(tx, runId);
      await this.mustSources(tx, [...new Set(input.evidence.map((e) => e.sourceItemId))]);
      // S4: same (kind, origin sources) → the item from the original proposal; only missing evidence is added.
      const existing = await tx.execute<{ id: string; landed: string | null }>(sql`
        select wi.id,
               (select t.to_status from work_item_transitions t where t.work_item_id = wi.id order by t.id limit 1) as landed
          from work_items wi
         where wi.owner_user_id = ${this.userId}
           and wi.id in (select e.work_item_id from work_item_evidence e where e.source_item_id = ${keyIds[0]!})
           and exists (select 1 from change_sets c where c.entity_type = 'work_items' and c.entity_id = wi.id::text
                          and c.editor_session_id = ${key} and c.undone_at is null)
         limit 1`);
      if (existing.rows[0]) {
        const w = existing.rows[0];
        for (const e of input.evidence) await this.addEvidence(tx, run, w.id, e.sourceItemId, e.role, input.confidence, e.reason, extractorId);
        return { workItemId: w.id, landedAs: (w.landed === 'suggested' ? 'suggested' : 'open') as 'open' | 'suggested' };
      }
      // DUP-1: the same conversation, the same person and the same deliverable (title words) is the item already there,
      // open or closed. An open one gets the new evidence; a closed one only context (a repeat never reopens it here:
      // new requirements arrive as `contradiction` links, and the engine decides).
      const dup = await this.conversationDuplicate(tx, origins, title);
      if (dup) {
        for (const e of input.evidence) await this.addEvidence(tx, run, dup.id, e.sourceItemId, dup.closed ? 'context' : e.role, input.confidence, `duplicate_of_existing: ${e.reason}`, extractorId);
        trace(runId, 'proposal', () => ({ kind: input.kind, deduped: dup.id, closed: dup.closed }), { workItemId: dup.id, sourceItemId: origins[0] ?? null });
        return { workItemId: dup.id, landedAs: (dup.status === 'suggested' ? 'suggested' : 'open') as 'open' | 'suggested' };
      }
      const owned = await tx.execute<{ ini: string | null; acc: string | null; opp: string | null }>(sql`
        select (select id from initiatives where owner_user_id = ${this.userId} and id::text = ${input.initiativeId ?? ''}) as ini,
               (select id from accounts where owner_user_id = ${this.userId} and (id::text = ${input.accountId ?? ''} or org62_account_id = ${input.accountId ?? ''}) limit 1) as acc,
               (select id from opportunities where owner_user_id = ${this.userId} and (id::text = ${input.oppId ?? ''} or org62_opportunity_id = ${input.oppId ?? ''}) limit 1) as opp`);
      const o = owned.rows[0]!;
      if (input.initiativeId && !o.ini) throw new StoreNotFoundError(`initiative ${input.initiativeId}`);
      // DUE-1: a bare date is 17:00 in my timezone, a zone-less date-time is read there too (propose-rules).
      const dueMs = parseDue(input.due, tz);
      const due = Number.isFinite(dueMs) ? isoMs(dueMs) : null;
      // TRAIN-1: a training whose due date passed over two weeks before it was first seen, from a notice that old too (a
      // first scan reading old mail; Trainings looks back 120 days), is most likely done. It lands in Triage ("still
      // needed?") instead of leading Do now as overdue. A fresh overdue reminder still lands open.
      // MIN-9: the same for a training with no due date whose newest notice is over 30 days old (an onboarding curriculum
      // from months ago). A recent notice without a date stays open.
      // DEEP-1: any ask whose newest origin message was over 30 days old when first seen (the 90-day inbox reading
      // months-old asks) waits in Triage as "Still needed?" too, unless it is due after today. The status reason
      // carries the mark Triage groups by (src/engines/still-needed.ts).
      let staleOverdue = false;
      let stillNeeded: string | null = null;
      const nowMs = this.now().getTime();
      const originIds = input.evidence.filter((e) => e.role === 'origin').map((e) => e.sourceItemId);
      const r = originIds.length ? await tx.execute<{ newest: string | null }>(sql`select max(occurred_at) as newest from source_items where id = any(${uuidArr(originIds)})`) : { rows: [] };
      const newest = r.rows[0]?.newest ? Date.parse(iso(r.rows[0].newest)!) : NaN;
      if (input.kind === 'training' && (due ? Date.parse(due) < nowMs - 14 * DAY : true)) staleOverdue = Number.isFinite(newest) && newest < nowMs - (due ? 14 : 30) * DAY;
      if (!staleOverdue && staleOnArrival({ originAt: newest, firstSeenAt: nowMs, dueAt: due })) stillNeeded = stillNeededReason(newest, nowMs, `scanner:${run.scope.connector}`);
      // PAST-1: its due date had already passed when it was found (a first scan reading old asks): Still needed? too.
      // Trainings keep TRAIN-1's rule (a fresh overdue reminder stays open).
      else if (!staleOverdue && input.kind !== 'training' && due && pastDueOnArrival({ dueAt: due, firstSeenAt: nowMs })) stillNeeded = pastDueReason(due, `scanner:${run.scope.connector}`, tz);
      const status = input.confidence === 'guess' || staleOverdue || stillNeeded ? 'suggested' : 'open';
      const origin =
        run.trigger === 'reconcile'
          ? 'reconcile'
          : (
              { task: 'asked_of_me', commitment: 'said_by_me', ask: 'asked_of_me', training: 'system_rule', follow_up: 'meeting_next_step', travel: 'system_rule', deliverable: 'asked_of_me' } as const
            )[input.kind];
      const youMin = input.effort?.youMin;
      const agentMin = input.effort?.agentMin;
      const lead = youMin !== undefined || agentMin !== undefined ? (youMin ?? 0) + (agentMin ?? 0) : null;
      const likely = input.confidence === 'likely';
      const ins = await tx.execute<{ id: string }>(sql`
        insert into work_items (owner_user_id, kind, origin, status, status_reason, title, purpose, initiative_id, account_id,
                                opportunity_id, due_at, due_kind, effort_minutes, lead_time_minutes, effort_source, backgroundable,
                                confidence, created_by_extractor_id, last_new_info_at, unseen_evidence_count)
        values (${this.userId}, ${kind}, ${origin}, ${status}, ${staleOverdue ? `${due ? `Overdue since ${due.slice(0, 10)}` : 'An old notice with no due date'} when first seen: still needed? (scanner:${run.scope.connector})` : (stillNeeded ?? `Proposed by scanner:${run.scope.connector} (${input.confidence})`)},
                ${title}, ${input.purpose ? redact(input.purpose).text.slice(0, 500) : null}, ${o.ini}, ${o.acc}, ${o.opp},
                ${due}::timestamptz, ${due ? 'inferred' : null}, ${youMin ?? null}, ${lead}, ${youMin !== undefined ? 'llm' : 'default'},
                ${(agentMin ?? 0) > 0}, ${CONFIDENCE_NUM[input.confidence] ?? 0.5}, ${extractorId},
                ${likely ? this.now().toISOString() : null}::timestamptz, ${likely ? input.evidence.length : 0})
        returning id`);
      const id = ins.rows[0]!.id;
      await tx.execute(sql`
        update change_sets set entity_type = 'work_items', entity_id = ${id}, editor_session_id = ${key}
         where id = nullif(current_setting('cc.change_set_id', true), '')::uuid`);
      await tx.execute(sql`
        insert into work_item_transitions (work_item_id, from_status, to_status, actor_kind, actor_ref, reason, change_set_id)
        values (${id}, null, ${status}, 'connector', ${`scanner:${run.scope.connector}`}, ${`proposed (${input.confidence})`},
                nullif(current_setting('cc.change_set_id', true), '')::uuid)`);
      await this.markPending(tx, run, [id]);
      for (const e of input.evidence) {
        await tx.execute(sql`
          insert into work_item_evidence (work_item_id, source_item_id, role, confidence, extractor_id, rationale, created_by)
          values (${id}, ${e.sourceItemId}, ${e.role}, ${CONFIDENCE_NUM[input.confidence] ?? 0.5}, ${extractorId},
                  ${redact(e.reason ?? '').text.slice(0, 1000)}, 'connector')
          on conflict on constraint work_item_evidence_target_uq do nothing`);
      }
      if (input.kind === 'training') {
        await tx.execute(sql`
          insert into work_item_training_details (work_item_id, provider, course_title, required_by)
          values (${id}, 'email', ${title}, ${due}::timestamptz) on conflict do nothing`);
      }
      if (input.expected || input.kind === 'deliverable') await this.addDeliverable(tx, id, title, input, extractorId, keyIds[0]!);
      if (status === 'open') {
        await enqueueJob(tx, {
          ownerUserId: this.userId,
          kind: 'reevaluate',
          queue: 'engine',
          payload: { work_item_id: id },
          dedupeKey: `reeval:work_item:${id}`,
          generation: 0,
          supersedesRunning: true,
          delaySeconds: 2,
        });
      }
      return { workItemId: id, landedAs: status as 'open' | 'suggested' };
    });
    // AUDIT: what was proposed from which evidence (ids and the model's short reasons; the title lives on the item).
    trace(runId, 'proposal', () => ({ kind: input.kind, confidence: input.confidence, landedAs: proposed.landedAs, due: input.due ?? null, evidence: input.evidence.map((e) => ({ sourceItemId: e.sourceItemId, role: e.role, reason: e.reason })) }), { workItemId: proposed.workItemId, sourceItemId: origins[0] ?? input.evidence[0]?.sourceItemId });
    return proposed;
  }

  /**
   * DUP-1: an item whose origin is in the same conversation (a DM or group DM, else the thread), from the same person
   * (the origin's author: me for my commitments), with the same deliverable in its title. Open items of any age; closed
   * ones (done, dismissed, merged) only when their origin is within 14 days of this one.
   */
  private async conversationDuplicate(tx: Tx, originIds: string[], title: string): Promise<{ id: string; status: string; closed: boolean } | null> {
    if (!originIds.length) return null;
    const conv = sql.raw(`coalesce(case when s.meta->>'channelType' in ('im', 'mpim') and s.meta->>'channelId' is not null then 'dm:' || (s.meta->>'channelId') end, s.external_parent_id)`);
    const convO = sql.raw(`coalesce(case when o.meta->>'channelType' in ('im', 'mpim') and o.meta->>'channelId' is not null then 'dm:' || (o.meta->>'channelId') end, o.external_parent_id)`);
    const r = await tx.execute<{ id: string; status: string; title: string; author: string | null }>(sql`
      with mine as (
        select ${conv} as conv, case when s.from_me then 'me' else lower(coalesce(s.actor_external_id, s.meta->'author'->>'externalId', s.meta->'author'->>'name', '')) end as who,
               s.occurred_at, s.meta->'author'->>'name' as author
          from source_items s where s.id = any(${uuidArr(originIds)}))
      select distinct on (wi.id) wi.id, wi.status::text as status, wi.title, m.author
        from mine m
        join source_items o on o.owner_user_id = ${this.userId} and ${convO} = m.conv and m.conv is not null and m.who <> ''
             and (case when o.from_me then 'me' else lower(coalesce(o.actor_external_id, o.meta->'author'->>'externalId', o.meta->'author'->>'name', '')) end) = m.who
        join work_item_evidence e on e.source_item_id = o.id and e.role = 'origin'
        join work_items wi on wi.id = e.work_item_id and wi.owner_user_id = ${this.userId}
       where o.id <> all(${uuidArr(originIds)})
         and (wi.status::text not in ('done', 'dismissed', 'merged') or abs(extract(epoch from (o.occurred_at - m.occurred_at))) <= 14 * 86400)
       order by wi.id, o.occurred_at desc
       limit 20`);
    const exclude = nameWords(...r.rows.map((x) => x.author));
    const hit = r.rows
      .filter((x) => sameDeliverable(title, x.title, exclude))
      .sort((a, b) => Number(['done', 'dismissed', 'merged'].includes(a.status)) - Number(['done', 'dismissed', 'merged'].includes(b.status)))[0];
    return hit ? { id: hit.id, status: hit.status, closed: ['done', 'dismissed', 'merged'].includes(hit.status) } : null;
  }

  private async addDeliverable(tx: Tx, workItemId: string, title: string, input: ProposeItemInput, extractorId: string, firstSource: string) {
    const fileId = input.expected?.fileId;
    let assetId: string | null = null;
    if (fileId) {
      await tx.execute(sql`
        insert into assets (owner_user_id, system, external_id, kind, tracking_tier)
        values (${this.userId}, 'drive', ${fileId}, 'other', 'watched')
        on conflict (owner_user_id, system, external_id) do nothing`);
      assetId = (await tx.execute<{ id: string }>(sql`
        select id from assets where owner_user_id = ${this.userId} and system = 'drive' and external_id = ${fileId}`)).rows[0]!.id;
    }
    const d = await tx.execute<{ id: string }>(sql`
      insert into work_item_deliverables (work_item_id, asset_id, asset_hint, kind, baseline_at, status)
      values (${workItemId}, ${assetId}, ${assetId ? null : title}, 'other', ${this.now().toISOString()}::timestamptz,
              ${assetId ? 'not_started' : 'file_unresolved'})
      returning id`);
    const changes = (input.expected?.changes ?? []).filter((c) => c.trim()).slice(0, 30);
    for (let i = 0; i < changes.length; i++) {
      await tx.execute(sql`
        insert into deliverable_requirements (deliverable_id, ordinal, description, requested_by_source_item_id, extractor_id)
        values (${d.rows[0]!.id}, ${i}, ${redact(changes[i]!).text.slice(0, 500)}, ${firstSource}, ${extractorId})`);
    }
  }

  async proposeInitiative(
    runId: string,
    input: { title: string; purpose: string; accountId?: string; oppId?: string; workItemIds: string[] },
  ): Promise<{ initiativeId: string }> {
    const run = await this.run(runId);
    if (!input.title?.trim()) throw new RangeError('proposeInitiative: title is required');
    const norm = input.title.trim().toLowerCase();
    const key = `initiative:${hashKey(`${norm}|${[...input.workItemIds].sort().join(',')}`)}`;
    const title = redact(input.title.trim()).text.slice(0, 200);
    const purpose = redact((input.purpose ?? '').trim()).text.slice(0, 1000);
    return this.cs(run.scope.connector, `propose initiative: ${title.slice(0, 80)}`, async (tx) => {
      await this.mustRunning(tx, runId);
      for (const id of input.workItemIds) await this.mustWork(tx, id);
      const ex = await tx.execute<{ id: string }>(sql`
        select i.id from initiatives i
         where i.owner_user_id = ${this.userId} and lower(btrim(i.title)) = ${norm}
           and exists (select 1 from change_sets c where c.entity_type = 'initiatives' and c.entity_id = i.id::text
                          and c.editor_session_id = ${key} and c.undone_at is null)
         limit 1`);
      if (ex.rows[0]) return { initiativeId: ex.rows[0].id };
      const ins = await tx.execute<{ id: string }>(sql`
        insert into initiatives (owner_user_id, title, purpose, status, account_id, opportunity_id, created_by, confidence)
        values (${this.userId}, ${title}, ${purpose}, 'proposed',
                (select id from accounts where owner_user_id = ${this.userId} and (id::text = ${input.accountId ?? ''} or org62_account_id = ${input.accountId ?? ''}) limit 1),
                (select id from opportunities where owner_user_id = ${this.userId} and (id::text = ${input.oppId ?? ''} or org62_opportunity_id = ${input.oppId ?? ''}) limit 1),
                'connector', 0.6)
        returning id`);
      const initiativeId = ins.rows[0]!.id;
      await tx.execute(sql`
        update change_sets set entity_type = 'initiatives', entity_id = ${initiativeId}, editor_session_id = ${key}
         where id = nullif(current_setting('cc.change_set_id', true), '')::uuid`);
      for (const wid of [...new Set(input.workItemIds)]) {
        const cur = await tx.execute<{ initiative_id: string | null }>(sql`select initiative_id from work_items where id = ${wid}`);
        if (cur.rows[0]?.initiative_id) continue; // never move an item between initiatives silently
        await engineUpdate(tx, workItems, wid, { initiativeId }, { reason: `grouped under initiative "${title}"` });
      }
      return { initiativeId };
    });
  }

  async flagUnlinked(runId: string, input: { sourceItemId: string; reason: string; hints?: string[] }): Promise<void> {
    const run = await this.run(runId);
    const reason = redact(input.reason ?? '').text.split('\n')[0]!.slice(0, 300);
    const hints = (input.hints ?? []).map((h) => redact(h).text.slice(0, 120)).slice(0, 20);
    await this.cs(
      run.scope.connector,
      'flag unlinked source item',
      async (tx) => {
        await this.mustRunning(tx, runId);
        await this.mustSources(tx, [input.sourceItemId]);
        // One row per (source item, run). The run's FIRST flag decides whether it counts as an attempt (S6);
        // a repeat in the same run only refreshes the reason and merges hints.
        const prev = await tx.execute<{ id: string; detail: string | null }>(sql`
          select id, detail from reconcile_findings
           where source_item_id = ${input.sourceItemId} and scan_run_id = ${runId} and kind = 'unlinked_item' for update`);
        if (prev.rows[0]) {
          const d = parseFinding(prev.rows[0].detail);
          const next: FindingDetail = { ...d, reason, hints: [...new Set([...d.hints, ...hints])].slice(0, 20) };
          await tx.execute(sql`update reconcile_findings set detail = ${JSON.stringify(next)}, status = 'open', updated_at = now() where id = ${prev.rows[0].id}`);
        } else {
          const detail: FindingDetail = { reason, hints, counts: !reason.startsWith('deferred:') };
          await tx.execute(sql`
            insert into reconcile_findings (owner_user_id, connector_id, scan_run_id, kind, scope, source_item_id, detail)
            values (${this.userId}, ${run.connectorId}, ${runId}, 'unlinked_item', ${scopeId(run.scope)}, ${input.sourceItemId}, ${JSON.stringify(detail)})`);
        }
      },
      false,
    );
    trace(runId, 'unlinked', { reason, hints: hints.length }, { sourceItemId: input.sourceItemId });
  }

  async reportCoverage(runId: string, objects: CoverageObject[]): Promise<void> {
    const run = await this.run(runId);
    await this.mustRunning(this.db, runId, false);
    for (const o of objects) {
      if (!o?.kind || !o.ref) throw new RangeError('reportCoverage: kind and ref are required');
      if (!LEDGER_KIND[o.kind]) throw new RangeError(`reportCoverage: unknown kind ${String(o.kind)}`);
    }
    run.staged.push(...objects.map((o) => ({ ...o })));
    // ORG-7: what a coverage object covered beyond its window (Q2's account count) shows in the trace.
    const notes = objects.filter((o) => o.meta && (o.meta as Record<string, unknown>).accounts != null).map((o) => `${o.ref}:accounts=${String((o.meta as Record<string, unknown>).accounts)}`);
    trace(runId, 'coverage', () => ({ n: objects.length, kinds: [...new Set(objects.map((o) => o.kind))], refs: objects.slice(0, 20).map((o) => `${o.kind}:${o.ref}${o.from ? `@${o.from}` : ''}${o.to ? `→${o.to}` : ''}`), ...(notes.length ? { notes } : {}) }));
  }

  async recordBriefHighlights(runId: string, input: BriefHighlightsInput): Promise<{ briefId: string }> {
    const run = await this.run(runId);
    if (!(toMs(input.period.to)! > toMs(input.period.from)!)) throw new RangeError('recordBriefHighlights: period.to must be after period.from');
    const extractorId = await this.extractorId(run.scope.connector, run.skillVersion, run.model);
    return this.cs(run.scope.connector, `brief for ${input.subscription.kind}:${input.subscription.ref}`, async (tx) => {
      await this.mustRunning(tx, runId);
      const srcIds = [...new Set(input.highlights.flatMap((h) => h.sourceItemIds))];
      await this.mustSources(tx, srcIds);
      const subId = await this.ensureSubscription(tx, input.subscription);
      const b = await tx.execute<{ id: string }>(sql`
        insert into briefs (owner_user_id, subscription_id, period_start, period_end, status, summary, source_item_count,
                            highlight_count, nothing_new, model, model_tier, generated_at)
        values (${this.userId}, ${subId}, ${isoMs(toMs(input.period.from)!)}::timestamptz, ${isoMs(toMs(input.period.to)!)}::timestamptz, 'ready',
                ${redact(input.summary ?? '').text}, ${srcIds.length}, ${Math.min(input.highlights.length, 32000)}, ${input.highlights.length === 0},
                ${run.model ?? null}, ${modelTierOf(run.model) === 'none' ? 'haiku' : modelTierOf(run.model)}, ${this.now().toISOString()}::timestamptz)
        on conflict (subscription_id, period_start, period_end) do update set
               summary = excluded.summary, status = 'ready', source_item_count = excluded.source_item_count,
               highlight_count = excluded.highlight_count, nothing_new = excluded.nothing_new, generated_at = excluded.generated_at
        returning id`);
      const briefId = b.rows[0]!.id;
      await tx.execute(sql`delete from brief_highlights where brief_id = ${briefId}`);
      for (let i = 0; i < input.highlights.length; i++) {
        const h = input.highlights[i]!;
        const hTitle = redact(h.title).text.slice(0, 300);
        const topic = h.sourceItemIds[0] ? `source:${h.sourceItemIds[0]}` : `title:${hTitle.toLowerCase().slice(0, 80)}`;
        const hi = await tx.execute<{ id: string }>(sql`
          insert into brief_highlights (owner_user_id, brief_id, ordinal, title, body, relevance_score, level, topic_key, extractor_id)
          values (${this.userId}, ${briefId}, ${i}, ${hTitle}, ${`Suggested: ${h.suggestedAction}`}, ${RELEVANCE_NUM[h.relevance] ?? 0.3},
                  ${RELEVANCE_LEVEL[h.relevance] ?? 'fyi'}, ${topic}, ${extractorId})
          returning id`);
        const hid = hi.rows[0]!.id;
        for (const [j, r] of [...new Set(h.reasons)].slice(0, 10).entries()) {
          const text = redact(r).text.slice(0, 300);
          await tx.execute(sql`
            insert into brief_highlight_reasons (highlight_id, kind, feature_key, weight, explanation)
            values (${hid}, 'keyword', ${`reason:${j}:${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`}, ${1}, ${text})
            on conflict (highlight_id, feature_key) do nothing`);
        }
        for (const sid of new Set(h.sourceItemIds)) {
          await tx.execute(sql`
            insert into provenance_links (source_item_id, brief_highlight_id, role, extractor_id)
            values (${sid}, ${hid}, 'basis', ${extractorId}) on conflict do nothing`);
        }
      }
      for (const sid of srcIds) {
        await tx.execute(sql`
          insert into provenance_links (source_item_id, brief_id, role, extractor_id)
          values (${sid}, ${briefId}, 'context', ${extractorId}) on conflict do nothing`);
      }
      await tx.execute(sql`insert into brief_scan_runs (brief_id, scan_run_id) values (${briefId}, ${runId}) on conflict do nothing`);
      await tx.execute(sql`
        update watch_subscriptions set last_period_end = greatest(coalesce(last_period_end, '-infinity'), ${isoMs(toMs(input.period.to)!)}::timestamptz),
               last_brief_id = ${briefId}
         where id = ${subId}`);
      return { briefId };
    });
  }

  private async ensureSubscription(tx: Tx, sub: BriefHighlightsInput['subscription']): Promise<string> {
    const ref = sub.ref.trim();
    if (!ref) throw new RangeError('subscription ref is required');
    const one = async (q: SQL) => (await tx.execute<{ id: string }>(q)).rows[0]?.id;
    let scopeKind: 'channel' | 'opportunity' | 'account' | 'person' | 'search_query';
    let col: SQL;
    let target: string;
    switch (sub.kind) {
      case 'channel':
        scopeKind = 'channel';
        col = sql`channel_id`;
        await tx.execute(sql`
          insert into channels (owner_user_id, system, external_id, kind, watch_mode)
          values (${this.userId}, 'slack', ${ref}, 'public', 'digest')
          on conflict (owner_user_id, system, external_id) do nothing`);
        target = (await one(sql`select id from channels where owner_user_id = ${this.userId} and system = 'slack' and external_id = ${ref}`))!;
        break;
      case 'opp':
        scopeKind = 'opportunity';
        col = sql`opportunity_id`;
        target =
          (await one(sql`select id from opportunities where owner_user_id = ${this.userId} and (id::text = ${ref} or org62_opportunity_id = ${ref}) limit 1`)) ??
          (await one(sql`insert into opportunities (owner_user_id, org62_opportunity_id, name) values (${this.userId}, ${ref}, ${ref})
                         on conflict (owner_user_id, org62_opportunity_id) do update set name = opportunities.name returning id`))!;
        break;
      case 'account':
        scopeKind = 'account';
        col = sql`account_id`;
        target =
          (await one(sql`select id from accounts where owner_user_id = ${this.userId}
                           and (id::text = ${ref} or org62_account_id = ${ref} or lower(name) = lower(${ref})) limit 1`)) ??
          (await one(sql`insert into accounts (owner_user_id, name, org62_account_id)
                         values (${this.userId}, ${ref}, ${/^001[A-Za-z0-9]{12,15}$/.test(ref) ? ref : null}) returning id`))!;
        break;
      case 'person':
        scopeKind = 'person';
        col = sql`person_id`;
        target =
          (await one(sql`select id from people where owner_user_id = ${this.userId} and (id::text = ${ref} or lower(primary_email) = lower(${ref})) limit 1`)) ??
          (await one(sql`insert into people (owner_user_id, display_name, primary_email)
                         values (${this.userId}, ${ref}, ${ref.includes('@') ? ref.toLowerCase() : null}) returning id`))!;
        break;
      case 'search':
        scopeKind = 'search_query';
        col = sql`search_query`;
        target = ref;
        break;
      default:
        throw new RangeError(`unknown subscription kind ${String((sub as { kind: string }).kind)}`);
    }
    const existing = await one(sql`
      select id from watch_subscriptions where owner_user_id = ${this.userId} and scope_kind = ${scopeKind} and ${col} = ${target}`);
    if (existing) return existing;
    return (await one(sql`
      insert into watch_subscriptions (owner_user_id, scope_kind, ${col}, label)
      values (${this.userId}, ${scopeKind}, ${target}, ${`${sub.kind}: ${ref}`.slice(0, 120)})
      returning id`))!;
  }

  // ------------------------------------------------------------------ finish / fail

  async finishRun(runId: string, input: { cursor: Cursor; summary?: string; stats: ScanRunStats }): Promise<{ touchedWorkItemIds: string[] }> {
    const run = await this.run(runId);
    const sid = scopeId(run.scope);
    const touched = await this.cs(
      run.scope.connector,
      `scan ${sid} finished`,
      async (tx) => {
        await this.mustRunning(tx, runId);
        const wFrom = toMs(run.window.from)!;
        const wTo = toMs(run.window.to)!;
        const at = toMs(input.cursor.at);
        if (at == null) throw new CoverageError('finishRun: cursor.at is not a timestamp');
        if (at < wFrom - TOL || at > wTo + TOL) throw new CoverageError(`finishRun: cursor.at ${input.cursor.at} is outside the run window`);

        // (c) committed + staged coverage must span [window.from, cursor.at); an incomplete run claims nothing past its cursor (S8c)
        if (at < wTo - TOL) run.staged = clampToCursor(run.staged, at);
        const committed = await this.mergedRanges(tx, run.connectorId, sid, wFrom - TOL);
        const staged = run.staged.map(rangeOf).filter((r): r is Range => !!r);
        const hole = firstHole(mergeRanges([...committed, ...staged], TOL), wFrom, at, TOL);
        if (hole) throw new CoverageError(`finishRun: coverage does not span up to the cursor (hole ${isoMs(hole.from)} → ${isoMs(hole.to)})`);

        // (d) commit coverage, close the run, keep the proposed cursor on it
        await insertLedger(tx, run.connectorId, sid, runId, coverageToLedger(run.staged, 'complete'));
        const st = input.stats ?? ({} as ScanRunStats);
        const fetched = Math.max(0, Math.trunc(st.fetched ?? 0));
        const nw = Math.max(0, Math.trunc(st.new ?? 0));
        const ch = Math.max(0, Math.trunc(st.changed ?? 0));
        await tx.execute(sql`
          update scan_runs set
                 status = 'succeeded', finished_at = ${this.now().toISOString()}::timestamptz,
                 items_seen = ${fetched}, items_new = ${nw}, items_updated = ${ch}, items_unchanged = ${Math.max(0, fetched - nw - ch)},
                 links_created = ${Math.max(0, Math.trunc(st.linked ?? 0))}, candidates_created = ${Math.max(0, Math.trunc(st.proposed ?? 0))},
                 cost_usd = greatest(cost_usd, ${Number(st.costUsd ?? 0)}),
                 input_tokens = ${Math.max(0, Math.trunc(st.inputTokens ?? 0))}, output_tokens = ${Math.max(0, Math.trunc(st.outputTokens ?? 0))},
                 cursor_after = ${JSON.stringify({ value: input.cursor.value, at: isoMs(at), unlinked: st.unlinked ?? 0, turns: st.turns ?? null })}::jsonb
           where id = ${runId}`);

        // (e) S9 cursor advance
        await this.advanceCursor(tx, run, sid);

        // (f) S10 fan-out set
        const p = await tx.execute<{ pending: string[] | null }>(sql`
          select array(select jsonb_array_elements_text(cursor_json->'pending')) as pending
            from scan_cursors where connector_id = ${run.connectorId} and scope = ${sid} for update`);
        await tx.execute(sql`
          update scan_cursors set cursor_json = coalesce(cursor_json, '{}'::jsonb) - 'pending'
           where connector_id = ${run.connectorId} and scope = ${sid}`);
        await tx.execute(sql`
          update connectors set last_success_at = ${this.now().toISOString()}::timestamptz
           where id = ${run.connectorId} and (last_success_at is null or last_success_at < ${this.now().toISOString()}::timestamptz - interval '60 seconds')`);
        // AUDIT: a success closes this scope's open failure events in the Health error feed (the next failure opens a new
        // one). Its own savepoint: it never fails the commit.
        await tx
          .transaction((sp) =>
            sp.execute(sql`
              update app_events set resolved_at = now()
               where owner_user_id = ${this.userId} and resolved_at is null and component = ${`scanner.${run.scope.connector}`}
                 and code in ('scan_run_failed', 'prefix_tripwire', 'cost_cap') and entity_type = 'scope' and entity_id = ${sid}`),
          )
          .catch(() => undefined);
        // The failure count is reset by recordHealth(ok), when the connector recovers (HEALTH-1). Resetting it on any
        // success gave a Degraded connector "0 failures" while another scope kept failing.
        return [...new Set(p.rows[0]?.pending ?? [])].sort();
      },
      false,
    );
    RUNS.delete(runId);
    trace(runId, 'commit', { cursorAt: input.cursor.at, coverage: run.staged.length, touched: touched.length });
    return { touchedWorkItemIds: touched };
  }

  /** Merged committed ranges (ms) of a scope, optionally only those reaching past `fromMs`. */
  private async mergedRanges(db: DbOrTx, connectorId: string, sid: string, fromMs?: number): Promise<Range[]> {
    const past = fromMs !== undefined ? sql`and covered_to >= ${isoMs(fromMs)}::timestamptz` : sql``;
    const res = await db.execute<{ l: string; u: string }>(sql`
      select lower(r) as l, upper(r) as u from (
        select unnest(range_agg(covered)) as r from scan_ledger_entries
         where connector_id = ${connectorId} and scope = ${sid} and outcome = 'complete' and covered is not null ${past}) x
       order by 1`);
    return mergeRanges(
      res.rows.map((r) => ({ from: Date.parse(iso(r.l)!), to: Date.parse(iso(r.u)!) })),
      TOL,
    );
  }

  /** S9: forward only, over contiguous committed coverage, to the newest proposed cursor it reaches. */
  private async advanceCursor(tx: Tx, run: RunState, sid: string): Promise<void> {
    await tx.execute(sql`
      insert into scan_cursors (owner_user_id, connector_id, scope, cursor_kind)
      values (${this.userId}, ${run.connectorId}, ${sid}, 'composite')
      on conflict (connector_id, scope) do nothing`);
    const cur = await tx.execute<{ id: string; high_watermark_at: string | null }>(sql`
      select id, high_watermark_at from scan_cursors where connector_id = ${run.connectorId} and scope = ${sid} for update`);
    const curRow = cur.rows[0]!;
    const curAt = curRow.high_watermark_at ? Date.parse(iso(curRow.high_watermark_at)!) : Number.NEGATIVE_INFINITY;
    const low = await tx.execute<{ low: string | null }>(sql`
      select min(covered_from) as low from scan_ledger_entries
       where connector_id = ${run.connectorId} and scope = ${sid} and outcome = 'complete' and covered is not null and not isempty(covered)`);
    const lowMs = low.rows[0]?.low ? Date.parse(iso(low.rows[0].low)!) : undefined;
    let reach = Number.POSITIVE_INFINITY;
    if (lowMs !== undefined) {
      const base = Number.isFinite(curAt) ? curAt : lowMs;
      const merged = await this.mergedRanges(tx, run.connectorId, sid, base - TOL);
      const seg = merged.find((r) => r.from <= base + TOL && base <= r.to + TOL);
      reach = seg ? seg.to : base;
    }
    const cand = await tx.execute<{ id: string; value: string; at: string }>(sql`
      select id, cursor_after->>'value' as value, cursor_after->>'at' as at from scan_runs
       where connector_id = ${run.connectorId} and scope = ${sid} and status = 'succeeded' and cursor_after ? 'value'
         and (cursor_after->>'at')::timestamptz > ${Number.isFinite(curAt) ? isoMs(curAt) : '-infinity'}::timestamptz
         ${Number.isFinite(reach) ? sql`and (cursor_after->>'at')::timestamptz <= ${isoMs(reach + TOL)}::timestamptz` : sql``}
       order by (cursor_after->>'at')::timestamptz desc, finished_at desc limit 1`);
    const next = cand.rows[0];
    if (!next) return;
    await tx.execute(sql`
      update scan_cursors set cursor_kind = 'composite', cursor_value = ${next.value}, high_watermark_at = ${next.at}::timestamptz,
             low_watermark_at = coalesce(low_watermark_at, ${lowMs !== undefined ? isoMs(lowMs) : null}::timestamptz),
             last_run_id = ${next.id}, last_advanced_at = now(), updated_at = now()
       where id = ${curRow.id}`);
    // Passed cursors can never be chosen again: drop their (possibly large) opaque values.
    await tx.execute(sql`
      update scan_runs set cursor_after = cursor_after - 'value'
       where connector_id = ${run.connectorId} and scope = ${sid} and cursor_after ? 'value'
         and (cursor_after->>'at')::timestamptz <= ${next.at}::timestamptz`);
  }

  async failRun(
    runId: string,
    input: { error: string; errorClass?: ConnectorHealthProbe['errorClass']; stats?: Partial<ScanRunStats> },
  ): Promise<void> {
    const run = await this.run(runId);
    await this.cs(
      run.scope.connector,
      `scan ${scopeId(run.scope)} failed`,
      async (tx) => {
        const r = await tx.execute<{ status: string }>(sql`select status from scan_runs where id = ${runId} for update`);
        if (!r.rows[0]) throw new RunStateError(`failRun: unknown run ${runId}`);
        if (r.rows[0].status !== 'running') return; // idempotent
        // S7: staged coverage is kept, as `error` (never counts for gaps, cursors or objects).
        await insertLedger(tx, run.connectorId, scopeId(run.scope), runId, coverageToLedger(run.staged, 'error'));
        const aborted = /abort|cancel/i.test(input.error ?? '');
        await tx.execute(sql`
          update scan_runs set
                 status = ${aborted ? 'cancelled' : 'failed'}, finished_at = ${this.now().toISOString()}::timestamptz,
                 error_code = ${input.errorClass ?? (aborted ? 'aborted' : 'unknown')},
                 error_message = ${redact(input.error ?? '').text.slice(0, 300)},
                 error_count = error_count + 1,
                 items_seen = greatest(items_seen, ${Math.max(0, Math.trunc(input.stats?.fetched ?? 0))}),
                 items_new = greatest(items_new, ${Math.max(0, Math.trunc(input.stats?.new ?? 0))}),
                 cost_usd = greatest(cost_usd, ${Number(input.stats?.costUsd ?? 0)})
           where id = ${runId}`);
        if (!aborted) {
          await tx.execute(sql`
            update connectors set last_error_at = ${this.now().toISOString()}::timestamptz, last_error_code = ${contractErrorClass(input.errorClass)},
                   consecutive_failures = consecutive_failures + 1
             where id = ${run.connectorId}`);
          // Its own savepoint: the Health error event never fails (or rolls back) the run's failure record.
          await tx.transaction((sp) => this.failureEvent(sp, run, runId, input.error ?? '', input.errorClass)).catch(() => undefined);
        }
      },
      false,
    );
    RUNS.delete(runId);
    trace(runId, 'failed', { errorClass: input.errorClass ?? null, code: failureCode(input.error ?? ''), error: input.error ?? null });
  }

  /**
   * Health's error feed (app_events): one open event per (connector, scope, cause), deduped by fingerprint so repeats
   * bump its count and last-seen time. Tripwire hits and cost-cap stops get their own codes. Ids, codes and a redacted,
   * clipped message only.
   */
  private async failureEvent(tx: DbOrTx, run: RunState, runId: string, error: string, errorClass: ConnectorHealthProbe['errorClass'] | undefined): Promise<void> {
    const sid = scopeId(run.scope);
    const cause = failureCode(error);
    const code = cause === 'prefix_tripwire' || cause === 'cost_cap' ? cause : 'scan_run_failed';
    const label = CONNECTOR_META[run.scope.connector]?.label ?? run.scope.connector;
    const what = code === 'prefix_tripwire' ? 'prompt over the size limit' : code === 'cost_cap' ? 'stopped at its cost cap' : `failed (${cause})`;
    const cls = errorClass === 'config' ? 'validation' : errorClass === 'auth' ? 'auth' : errorClass === 'rate_limited' ? 'rate_limited' : errorClass === 'transient' ? 'transient' : 'unknown';
    const action = code === 'prefix_tripwire' ? 'npm run scan:trace -- <runId> shows the prompt size per pass' : errorClass === 'auth' ? 'Re-auth the connector' : 'npm run scan:trace -- <runId>';
    await tx.execute(sql`
      insert into app_events (owner_user_id, severity, component, code, error_class, message, connector_id, scan_run_id, entity_type, entity_id, detail, fingerprint)
      values (${this.userId}, ${errorClass === 'transient' || errorClass === 'rate_limited' ? 'warn' : 'error'}, ${`scanner.${run.scope.connector}`}, ${code}, ${cls},
              ${`${label} ${sid.slice(run.scope.connector.length + 1)}: ${what}`.slice(0, 200)}, ${run.connectorId}, ${runId}, 'scope', ${sid},
              ${JSON.stringify({ runId, cause, errorClass: errorClass ?? null, error: redact(error).text.slice(0, 160), suggestedAction: action })}::jsonb,
              ${`scanner.${run.scope.connector}|${code}|${sid}|${cause}`})
      on conflict (fingerprint) where resolved_at is null
      do update set occurrence_count = app_events.occurrence_count + 1, last_occurred_at = now(), scan_run_id = excluded.scan_run_id,
                    detail = excluded.detail, message = excluded.message`);
  }

  // ------------------------------------------------------------------ ledger queries

  async getCursor(scope: ScopeKey): Promise<Cursor | null> {
    const connectorId = await this.connectorId(scope.connector);
    const res = await this.db.execute<{ cursor_value: string | null; high_watermark_at: string | null }>(sql`
      select cursor_value, high_watermark_at from scan_cursors where connector_id = ${connectorId} and scope = ${scopeId(scope)}`);
    const r = res.rows[0];
    if (!r?.high_watermark_at) return null;
    return { value: r.cursor_value ?? '', at: iso(r.high_watermark_at)! };
  }

  /** Extension used by reconcile: [first committed coverage start, last committed coverage end] of a scope. */
  async coverageSpan(scope: ScopeKey): Promise<{ from: string; to: string } | null> {
    const connectorId = await this.connectorId(scope.connector);
    const r = await this.db.execute<{ f: string | null; t: string | null }>(sql`
      select min(covered_from) as f, max(covered_to) as t from scan_ledger_entries
       where connector_id = ${connectorId} and scope = ${scopeId(scope)} and outcome = 'complete' and covered is not null and not isempty(covered)`);
    const row = r.rows[0];
    return row?.f && row.t ? { from: iso(row.f)!, to: iso(row.t)! } : null;
  }

  async coverageGaps(scope: ScopeKey, window: TimeWindow): Promise<TimeWindow[]> {
    const connectorId = await this.connectorId(scope.connector);
    const sid = scopeId(scope);
    // Low watermark = earliest committed coverage start, points included (as the memory store's committedRanges).
    const low = await this.db.execute<{ low: string | null }>(sql`
      select min(covered_from) as low from scan_ledger_entries
       where connector_id = ${connectorId} and scope = ${sid} and outcome = 'complete' and covered is not null`);
    if (!low.rows[0]?.low) return [{ ...window }];
    const lowMs = Date.parse(iso(low.rows[0].low)!);
    const from = Math.max(toMs(window.from)!, lowMs);
    const to = toMs(window.to)!;
    if (to <= from) return [];
    const merged = await this.mergedRanges(this.db, connectorId, sid, from - TOL);
    const holes: TimeWindow[] = [];
    let at = from;
    for (const r of merged) {
      if (r.to <= at) continue;
      if (r.from > at + TOL) holes.push({ from: isoMs(at), to: isoMs(Math.min(r.from, to)) });
      at = Math.max(at, r.to);
      if (at >= to) break;
    }
    if (at < to - TOL) holes.push({ from: isoMs(at), to: isoMs(to) });
    return holes.filter((h) => toMs(h.to)! > toMs(h.from)!);
  }

  async uncoveredObjects(scope: ScopeKey, listed: CoverageObject[]): Promise<CoverageObject[]> {
    if (!listed.length) return [];
    const connectorId = await this.connectorId(scope.connector);
    const parentOf = (o: CoverageObject) => (typeof o.meta?.parentRef === 'string' ? (o.meta.parentRef as string) : undefined);
    const refs = [...new Set(listed.flatMap((o) => [o.ref, ...(parentOf(o) ? [parentOf(o)!] : [])]))];
    const res = await this.db.execute<{ k: string; r: string; f: string | null; t: string | null; et: string | null }>(sql`
      select object_kind::text as k, object_external_id as r, covered_from as f, covered_to as t, end_token as et
        from scan_ledger_entries
       where connector_id = ${connectorId} and scope = ${scopeId(scope)} and outcome = 'complete' and object_external_id = any(${textArr(refs)})`);
    const rows = res.rows;
    return listed.filter((L) => {
      const kind = LEDGER_KIND[L.kind];
      const direct = rows.some((c) => c.k === kind && c.r === L.ref && (L.to == null || ((c.et ?? iso(c.t)) != null && cmpPos((c.et ?? iso(c.t))!, L.to) >= 0)));
      if (direct) return false;
      const parent = parentOf(L);
      const at = toMs(L.from);
      if (parent && at != null) {
        const inRange = rows.some((c) => c.r === parent && c.f && c.t && Date.parse(iso(c.f)!) <= at && at < Date.parse(iso(c.t)!));
        if (inRange) return false;
      }
      return true;
    });
  }

  async unlinkedSourceItems(opts: {
    connector?: ConnectorId;
    minAttempts?: number;
    maxAttempts?: number;
    limit?: number;
  }): Promise<UnlinkedSourceItemDetail[]> {
    const res = await this.db.execute<{
      source_item_id: string;
      detail: string | null;
      trig: string | null;
      run_id: string | null;
      at: string;
      created: string;
      connector: string | null;
      title: string | null;
      body: string | null;
      thread: string | null;
      occurred: string;
      from_me: boolean;
      to_me: boolean;
    }>(sql`
      select f.source_item_id, f.detail, r.trigger::text as trig, f.scan_run_id as run_id, f.updated_at as at, f.created_at as created,
             si.meta->>'connector' as connector, si.title, left(si.body, 1000) as body, si.external_parent_id as thread, si.occurred_at as occurred,
             si.from_me, si.addressed_to_me as to_me
        from reconcile_findings f
        join source_items si on si.id = f.source_item_id
        left join scan_runs r on r.id = f.scan_run_id
       where f.owner_user_id = ${this.userId} and f.kind = 'unlinked_item'
         and not exists (select 1 from work_item_evidence e where e.source_item_id = f.source_item_id)
         and not exists (select 1 from reconcile_findings g where g.source_item_id = f.source_item_id and g.kind = 'unlinked_item' and g.status = 'ignored')
         ${opts.connector ? sql`and si.meta->>'connector' = ${opts.connector}` : sql``}
       order by f.created_at, f.id`);
    const by = new Map<string, typeof res.rows>();
    for (const r of res.rows) by.set(r.source_item_id, [...(by.get(r.source_item_id) ?? []), r]);
    const out: Array<UnlinkedSourceItemDetail & { last: number }> = [];
    for (const [sourceItemId, rows] of by) {
      // rows are per run, in order of each run's first flag
      const counted = rows.filter((r) => parseFinding(r.detail).counts);
      const reconcileRuns = new Set(counted.filter((r) => r.trig === 'reconcile').map((r) => r.run_id));
      const attempts = reconcileRuns.size + (counted[0] && counted[0].trig !== 'reconcile' ? 1 : 0);
      const latest = [...rows].sort((a, b) => Date.parse(iso(b.at)!) - Date.parse(iso(a.at)!))[0]!;
      const hints = [...new Set([...rows].reverse().flatMap((r) => parseFinding(r.detail).hints))].slice(0, 20);
      out.push({
        sourceItemId,
        attempts,
        reason: parseFinding(latest.detail).reason,
        hints,
        connector: (latest.connector ?? undefined) as ConnectorId | undefined,
        excerpt: latest.body ?? undefined,
        title: latest.title ?? undefined,
        threadRef: latest.thread ?? undefined,
        occurredAt: iso(latest.occurred),
        fromMe: latest.from_me === true,
        toMe: latest.to_me === true,
        last: Date.parse(iso(latest.at)!),
      });
    }
    const min = opts.minAttempts ?? 0;
    const max = opts.maxAttempts ?? Number.POSITIVE_INFINITY;
    return out
      .filter((u) => u.attempts >= min && u.attempts <= max)
      .sort((a, b) => a.last - b.last || a.sourceItemId.localeCompare(b.sourceItemId))
      .slice(0, opts.limit ?? 50)
      .map(({ last: _last, ...u }) => u);
  }

  /** MAP-1: no mapping question for this item (not an ask or commitment of mine): its findings are ignored for good. */
  async ignoreUnlinked(sourceItemId: string, note: string): Promise<void> {
    await this.db.execute(sql`
      update reconcile_findings set status = 'ignored', resolution_note = ${redact(note).text.slice(0, 200)}, resolved_at = now(), updated_at = now()
       where owner_user_id = ${this.userId} and source_item_id = ${sourceItemId} and kind = 'unlinked_item' and status <> 'ignored'`);
  }

  // ------------------------------------------------------------------ triage context (TRI-CTX, TRI-NOISE)

  /**
   * A conversation's recorded messages from any run or window, oldest first: the last `before.limit` before
   * `before.at` and the first `after.limit` after `after.at`. A DM by its channel id, a thread by its root ref.
   */
  async conversationLines(q: { channelId?: string; threadRef?: string; before: { at: string; limit: number }; after: { at: string; limit: number } }): Promise<ConversationLine[]> {
    if (!q.threadRef && !q.channelId) return [];
    const where = q.threadRef ? sql`si.external_parent_id = ${q.threadRef}` : sql`(si.external_id like ${`${q.channelId!.replace(/[%_\\]/g, '')}:%`} or si.meta->>'channelId' = ${q.channelId!})`;
    const cols = sql.raw(`si.id, si.external_id, si.external_parent_id, si.occurred_at, si.from_me, si.addressed_to_me, si.url, left(si.body, 1000) as body, si.meta`);
    type Row = { id: string; external_id: string; external_parent_id: string | null; occurred_at: string; from_me: boolean; addressed_to_me: boolean; url: string | null; body: string | null; meta: Record<string, unknown> | null };
    const [before, after] = await Promise.all([
      q.before.limit > 0
        ? this.db.execute<Row>(sql`
            select ${cols} from source_items si
             where si.owner_user_id = ${this.userId} and si.source = 'slack' and si.kind = 'slack_message' and ${where}
               and si.occurred_at < ${q.before.at}::timestamptz
             order by si.occurred_at desc limit ${Math.min(q.before.limit, 50)}`)
        : Promise.resolve({ rows: [] as Row[] }),
      q.after.limit > 0
        ? this.db.execute<Row>(sql`
            select ${cols} from source_items si
             where si.owner_user_id = ${this.userId} and si.source = 'slack' and si.kind = 'slack_message' and ${where}
               and si.occurred_at > ${q.after.at}::timestamptz
             order by si.occurred_at asc limit ${Math.min(q.after.limit, 50)}`)
        : Promise.resolve({ rows: [] as Row[] }),
    ]);
    const line = (r: Row): ConversationLine => {
      const m = r.meta ?? {};
      const author = personOf(m.author);
      const participants = Array.isArray(m.participants) ? m.participants.map(personOf).filter((p): p is PersonRef => !!p) : [];
      const { itemKind: _k, connector: _c, threadRef: _t, fileRefs, accountHints, oppHints, author: _a, participants: _p, triage: _v, ...payload } = m as Record<string, unknown>;
      return {
        sourceItemId: r.id,
        item: {
          connector: 'slack',
          kind: 'message',
          externalId: r.external_id,
          dedupeKey: `slack:${r.external_id}`,
          contentHash: '',
          occurredAt: iso(r.occurred_at)!,
          ...(author ? { author } : {}),
          ...(participants.length ? { participants } : {}),
          excerpt: r.body ?? '',
          ...(r.external_parent_id ? { threadRef: r.external_parent_id } : {}),
          fileRefs: strings(fileRefs),
          accountHints: strings(accountHints),
          oppHints: strings(oppHints),
          ...(r.url ? { permalink: r.url } : {}),
          redacted: false,
          payload,
        },
      };
    };
    return [...[...before.rows].reverse(), ...after.rows].map(line);
  }

  /** Triage verdicts go onto their messages (`meta.triage`); an edit replaces the meta, so an edited message is judged again. */
  async recordTriageVerdicts(verdicts: Array<{ sourceItemId: string; v: 'act' | 'noise' | 'unsure'; why?: string }>): Promise<void> {
    const rows = verdicts.filter((x) => UUID.test(x.sourceItemId));
    if (!rows.length) return;
    const at = this.now().toISOString();
    const json = JSON.stringify(rows.map((x) => ({ id: x.sourceItemId, t: { v: x.v, ...(x.why ? { why: redact(x.why).text.slice(0, 160) } : {}), at } })));
    await this.db.execute(sql`
      update source_items si set meta = jsonb_set(coalesce(si.meta, '{}'::jsonb), '{triage}', x.t, true)
        from jsonb_to_recordset(${json}::jsonb) as x(id uuid, t jsonb)
       where si.id = x.id and si.owner_user_id = ${this.userId}`);
  }

  async triageVerdicts(sourceItemIds: string[]): Promise<Map<string, { v: 'act' | 'noise' | 'unsure'; why?: string }>> {
    const ids = sourceItemIds.filter((x) => UUID.test(x));
    if (!ids.length) return new Map();
    // A message with non-context evidence reads as `act` / `linked`: an earlier run linked it, so it is handled.
    const r = await this.db.execute<{ id: string; v: string | null; why: string | null }>(sql`
      select si.id,
             case when exists (select 1 from work_item_evidence e where e.source_item_id = si.id and e.role <> 'context') then 'act' else si.meta->'triage'->>'v' end as v,
             case when exists (select 1 from work_item_evidence e where e.source_item_id = si.id and e.role <> 'context') then 'linked' else si.meta->'triage'->>'why' end as why
        from source_items si
       where si.owner_user_id = ${this.userId} and si.id = any(${uuidArr(ids)})
         and (si.meta ? 'triage' or exists (select 1 from work_item_evidence e where e.source_item_id = si.id and e.role <> 'context'))`);
    const ok = (v: string | null): v is 'act' | 'noise' | 'unsure' => v === 'act' || v === 'noise' || v === 'unsure';
    return new Map(r.rows.flatMap((x) => (ok(x.v) ? [[x.id, { v: x.v, ...(x.why ? { why: x.why } : {}) }] as const] : [])));
  }

  // ------------------------------------------------------------------ health + spend

  async recordHealth(connector: ConnectorId, probe: ConnectorHealthProbe): Promise<void> {
    const connectorId = await this.connectorId(connector);
    const to: ConnectorStatus = (
      { ok: 'healthy', degraded: 'degraded', auth_required: 'auth_required', down: 'error', disabled: 'disabled' } as const
    )[probe.state];
    if (!to) throw new RangeError(`recordHealth: unknown state ${probe.state}`);
    const checkedAt = toMs(probe.checkedAt) != null ? isoMs(toMs(probe.checkedAt)!) : this.now().toISOString();
    const detail = probe.detail ? redact(probe.detail).text.slice(0, 240) : null;
    const label = CONNECTOR_META[connector]?.label ?? connector;
    const errClass = (c: ConnectorHealthProbe['errorClass']) =>
      c === 'config' ? 'validation' : c === 'auth' ? 'auth' : c === 'rate_limited' ? 'rate_limited' : c === 'transient' ? 'transient' : 'unknown';
    // B-084: connectors carry the contract's error classes and the re-auth affordance the probe named.
    const lastCode = contractErrorClass(probe.errorClass);
    const reauth = probe.reauth ? JSON.stringify({ kind: probe.reauth.kind, label: `Re-auth ${label}`, command: probe.reauth.command ?? null, instructions: probe.reauth.instructions ?? null }) : null;
    const from = await this.cs(
      connector,
      `health ${connector}: ${probe.state}`,
      async (tx) => {
        const cur = await tx.execute<{ status: ConnectorStatus }>(sql`select status from connectors where id = ${connectorId} for update`);
        const prev = cur.rows[0]?.status ?? null;
        const ok = probe.state === 'ok';
        await tx.execute(sql`
          update connectors set
                 status = ${to}, status_reason = ${ok ? null : detail},
                 status_changed_at = case when status is distinct from ${to}::connector_status then ${checkedAt}::timestamptz else status_changed_at end,
                 last_success_at = case when ${ok} then ${checkedAt}::timestamptz else last_success_at end,
                 last_error_at = case when ${ok} then last_error_at else ${checkedAt}::timestamptz end,
                 last_error_code = case when ${ok} then last_error_code else ${lastCode} end,
                 consecutive_failures = case when ${ok} then 0 else consecutive_failures + 1 end,
                 config = case when ${reauth}::jsonb is null then config else coalesce(config, '{}'::jsonb) || jsonb_build_object('reauth', ${reauth}::jsonb) end
           where id = ${connectorId}`);
        await tx.execute(sql`
          insert into connector_health_checks (connector_id, checked_at, ok, status, probe, error_code, error_message)
          values (${connectorId}, ${checkedAt}::timestamptz, ${ok}, ${to}, 'probe', ${ok ? null : lastCode}, ${ok ? null : detail})`);
        const dedupe = `connector:${connectorId}:status`;
        if (to === 'auth_required' || to === 'error') {
          await tx.execute(sql`
            insert into notifications (owner_user_id, kind, severity, title, body, entity_type, entity_id, connector_id, action_route,
                                       action_kind, dedupe_key)
            values (${this.userId}, ${to === 'auth_required' ? 'connector_auth_required' : 'connector_degraded'},
                    ${to === 'auth_required' ? 'warn' : 'error'},
                    ${to === 'auth_required' ? `${label} needs re-auth` : `${label} is not responding`},
                    ${probe.reauth?.instructions ?? detail ?? null}, 'connector', ${connector}, ${connectorId}, ${`/health#${connector}`},
                    ${probe.reauth ? 'reauth' : null}, ${dedupe})
            on conflict (owner_user_id, dedupe_key) where status in ('open', 'seen', 'snoozed')
            do update set title = excluded.title, body = excluded.body, kind = excluded.kind, severity = excluded.severity, updated_at = now()`);
          // D-39: schedules of an auth-broken connector pause until it is healthy again.
          if (to === 'auth_required') {
            await tx.execute(sql`update job_schedules set paused_reason = 'auth_required' where connector_id = ${connectorId} and paused_reason is null`);
          }
        } else if (to === 'healthy') {
          await tx.execute(sql`
            update notifications set status = 'resolved', resolved_at = now(), resolved_by = 'system', updated_at = now()
             where owner_user_id = ${this.userId} and dedupe_key = ${dedupe} and status in ('open', 'seen', 'snoozed')`);
          await tx.execute(sql`update job_schedules set paused_reason = null where connector_id = ${connectorId} and paused_reason = 'auth_required'`);
        }
        if (prev !== to) {
          await tx.execute(sql`
            insert into app_events (owner_user_id, severity, component, code, error_class, message, connector_id, detail, fingerprint)
            values (${this.userId}, ${to === 'healthy' ? 'info' : to === 'degraded' ? 'warn' : 'error'}, ${`connector.${connector}`},
                    ${`connector_${to}`}, ${to === 'healthy' ? null : errClass(probe.errorClass)},
                    ${`${label}: ${prev ?? 'new'} -> ${to}`}, ${connectorId}, ${JSON.stringify({ from: prev, to })}::jsonb,
                    ${`connector.${connector}|${to}`})
            on conflict (fingerprint) where resolved_at is null
            do update set occurrence_count = app_events.occurrence_count + 1, last_occurred_at = now(), message = excluded.message`);
        }
        return prev;
      },
      false,
    );
    if (from !== to) await this.o.onHealthChange?.({ connector, from, to, probe });
  }

  /**
   * Today's spend vs caps. The app's Settings section `settings.budgets` (legacy key `budgets`) > the llm_budgets
   * `total` row > defaults. A `hard_stop` llm_budgets row can lower the hard cap below the setting; a non-stop row
   * (bootstrap writes one at the soft budget) is the soft budget only (stress finding SET-1).
   */
  async budgetStatus(): Promise<BudgetStatus> {
    const day = localDay(this.now(), await this.timezone());
    const res = await this.db.execute<{ spent: string | null; soft: string | null; hard: string | null; alert: string | null; lim: string | null; stop: boolean | null; lim_alert: string | null; today: { day?: string; softUsd?: number; hardUsd?: number } | null }>(sql`
      with b as (select value from user_settings where owner_user_id = ${this.userId} and key in ('settings.budgets', 'budgets') order by (key = 'settings.budgets') desc limit 1),
           l as (select daily_limit_usd, hard_stop, alert_at_pct from llm_budgets where owner_user_id = ${this.userId} and scope = 'total' limit 1)
      -- BUD-1: the daily cap counts daily spend only; the one-time first-scan budget (B-080) has its own meter.
      select (select coalesce(sum(cost_usd), 0) from llm_calls where owner_user_id = ${this.userId} and budget_day = ${day}::date and budget = 'daily') as spent,
             (select value->>'softUsd' from b) as soft, (select value->>'hardUsd' from b) as hard, (select value->>'alertPct' from b) as alert,
             (select value->'today' from b) as today,
             (select daily_limit_usd from l) as lim, (select hard_stop from l) as stop, (select alert_at_pct from l) as lim_alert`);
    const r = res.rows[0]!;
    // Settings ▸ Budgets ▸ "Today only" wins for its own day (budgetsForDay in the contract).
    const t = r.today && r.today.day === day && typeof r.today.softUsd === 'number' && typeof r.today.hardUsd === 'number' ? r.today : null;
    const softCapUsd = Number(t?.softUsd ?? r.soft ?? (r.lim != null && !r.stop ? r.lim : null) ?? this.o.defaultBudget.softUsd);
    const hardSetting = Number(t?.hardUsd ?? r.hard ?? this.o.defaultBudget.hardUsd);
    const hardCapUsd = r.lim != null && r.stop ? Math.min(hardSetting, Number(r.lim)) : hardSetting;
    const alertPct = Number(r.alert ?? r.lim_alert ?? this.o.defaultBudget.alertPct ?? 80);
    const todayUsd = Number(r.spent ?? 0);
    const state = todayUsd >= hardCapUsd ? 'capped' : softCapUsd > 0 && (todayUsd / softCapUsd) * 100 >= alertPct ? 'soft_alert' : 'ok';
    return { todayUsd, softCapUsd, hardCapUsd, state };
  }

  async recordSpend(spend: RecordSpendInput): Promise<{ todayUsd: number; softCapUsd: number; hardCapUsd: number }> {
    // S13: costUsd <= 0 is a pure read.
    if (Number.isFinite(spend.costUsd) && spend.costUsd > 0) {
      const input = spend as SpendBooked;
      const day = localDay(this.now(), await this.timezone());
      const purpose = input.connector === 'nba' ? 'nba_generate' : input.connector === 'chat' ? 'chat' : input.connector === 'brief' ? 'summarize' : 'scan_extract';
      const runId = input.runId && UUID.test(input.runId) ? input.runId : null;
      // AUDIT: every call is attributed to a run or job and to its budget. The caller's, else the current job's (context).
      const tc = traceContext();
      const jobId = input.jobId ?? tc?.jobId ?? null;
      const budget = input.budget ?? tc?.budget ?? 'daily';
      const connectorSkill = input.skill ?? (input.connector in CONNECTOR_META ? CONNECTOR_META[input.connector as ConnectorId].skill ?? null : null);
      // SPEND-1: a run's spend is booked on the models that made it. Its passes (traversal, triage, escalation) each ran
      // on their own model, and their `pass` trace rows carry model, cost and tokens: the spend is split over the rows
      // not booked yet, one llm_calls row each. Before, a whole run was booked on the run's model with no tokens, so a
      // Sonnet escalation showed as Haiku. What no pass row covers stays on the caller's model, with the caller's tokens.
      let passes: PassSpend[] = [];
      if (runId) {
        await flushTrace();
        const ev = await this.db.execute<{ seq: number; payload: Record<string, unknown> }>(sql`
          select e.seq, e.payload from scan_run_events e
           where e.run_id = ${runId}::uuid and e.kind = 'pass'
             and not exists (select 1 from llm_calls c where c.request_hash = concat('pass:', e.run_id::text, ':', e.seq))
           order by e.seq`);
        passes = ev.rows.map((r) => passSpendOf(r.seq, r.payload));
      }
      const split = splitByPasses(input.costUsd, passes);
      const trigger = input.trigger ?? null;
      const rows: SpendRow[] = split.parts.map((p) => ({
        model: p.model ?? input.model,
        skill: passSkill(p.pass, connectorSkill),
        usd: p.costUsd,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        cacheReadTokens: p.cacheReadTokens,
        cacheWriteTokens: p.cacheWriteTokens,
        status: p.ok ? 'ok' : 'error',
        errorCode: p.ok ? null : (p.errorClass ?? 'unknown'),
        hash: `pass:${runId}:${p.seq}`,
        contentHash: p.contentHash,
        modelReason: p.pass === 'escalate' ? 'escalation:unsure' : (input.modelReason ?? 'default'),
        outcome: p.pass === 'traversal' ? (input.outcome ?? null) : p.pass,
      }));
      // D0: what no pass row covers is booked with its own tokens: the SDK's per-model usage less what the pass rows
      // booked, so no dollar lands on a row without tokens (and a Sonnet residue is booked as Sonnet).
      if (split.restUsd > 0) rows.push(...restRows(split.restUsd, split.parts, input, connectorSkill, runId));
      await this.cs(
        input.connector,
        `spend ${input.connector} ${input.model}`,
        async (tx) => {
          const isRun = runId
            ? (await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from scan_runs where id = ${runId} and owner_user_id = ${this.userId}) as ok`)).rows[0]?.ok === true
            : false;
          for (const r of rows) {
            await tx.execute(sql`
              insert into llm_calls (owner_user_id, purpose, model, model_tier, skill_key, request_hash, scan_run_id, job_id, status, error_code,
                                     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, budget_day, budget, started_at, finished_at,
                                     trigger, model_reason, content_hash, outcome)
              values (${this.userId}, ${purpose}, ${r.model}, ${modelTierOf(r.model)}, ${r.skill},
                      ${r.hash}, ${isRun ? runId : null},
                      coalesce((select id from jobs where id = ${jobId}::bigint), (select job_id from scan_runs where id = ${isRun ? runId : null}::uuid)),
                      ${r.status}, ${r.errorCode}, ${r.inputTokens}, ${r.outputTokens}, ${r.cacheReadTokens}, ${r.cacheWriteTokens}, ${r.usd}, ${day}::date, ${budget},
                      ${this.now().toISOString()}::timestamptz, ${this.now().toISOString()}::timestamptz,
                      ${trigger}, ${r.modelReason}, ${r.contentHash}, ${r.outcome})`);
          }
          if (isRun) await tx.execute(sql`update scan_runs set cost_usd = cost_usd + ${input.costUsd} where id = ${runId}`);
          // BUD-1: the daily roll-up (Q15's meter, doctor) is the daily budget's; first-scan spend stays on its own ledger rows.
          if (budget === 'daily') await tx.execute(sql`
            insert into llm_budget_days (budget_id, day, spent_usd, call_count)
            select b.id, ${day}::date, ${input.costUsd}, ${rows.length} from llm_budgets b where b.owner_user_id = ${this.userId} and b.scope = 'total'
            on conflict (budget_id, day) do update set spent_usd = llm_budget_days.spent_usd + excluded.spent_usd,
                                                       call_count = llm_budget_days.call_count + excluded.call_count, updated_at = now()`);
        },
        false,
      );
      // D0: a row missing an audit field, or booking dollars with no tokens, is noted (tests fail on it); still written.
      for (const r of rows) noteLedgerGaps(`recordSpend:${r.skill ?? input.connector}`, { costUsd: r.usd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens, trigger, modelReason: r.modelReason, outcome: r.outcome, contentHash: r.contentHash });
      trace(runId, 'spend', { costUsd: input.costUsd, model: input.model, models: [...new Set(rows.map((r) => r.model))], parts: rows.length, purpose, budget, jobId });
    }
    const b = await this.budgetStatus();
    return { todayUsd: b.todayUsd, softCapUsd: b.softCapUsd, hardCapUsd: b.hardCapUsd };
  }

  /** D0: a decision not to call the model (or to escalate, or a refused call), on today's local day. Never throws. */
  async recordDecision(d: Omit<Decision, 'day'> & { day?: string }): Promise<void> {
    const day = d.day ?? localDay(d.at ?? this.now(), await this.timezone().catch(() => 'UTC'));
    await recordLedgerDecision(this.db, this.userId, { ...d, day, at: d.at ?? this.now() });
  }

  /** D3: CLI session ids whose recorded `claude_session` item is evidence on a live work item. */
  async linkedClaudeSessions(): Promise<Set<string>> {
    const r = await this.db.execute<{ id: string }>(sql`
      select distinct s.external_id as id from source_items s
        join work_item_evidence e on e.source_item_id = s.id
        join work_items w on w.id = e.work_item_id
       where s.owner_user_id = ${this.userId} and s.kind = 'claude_session'
         and w.status in ('suggested', 'open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done')`);
    return new Set(r.rows.map((x) => x.id));
  }

  /** D6: today's Slack triage escalation allowance and the stronger model's triage spend so far (daily budget). */
  async escalationAllowance(): Promise<{ capUsd: number; spentUsd: number }> {
    const day = localDay(this.now(), await this.timezone());
    const r = await this.db.execute<{ cap: string | null; spent: string | null }>(sql`
      select (select value->>'triageEscalationUsdPerDay' from user_settings where owner_user_id = ${this.userId} and key = 'settings.budgets') as cap,
             (select coalesce(sum(cost_usd), 0) from llm_calls where owner_user_id = ${this.userId} and budget_day = ${day}::date and budget = 'daily'
                 and skill_key = ${TRIAGE_SKILL_KEY} and model_tier::text <> 'haiku') as spent`);
    const cap = Number(r.rows[0]?.cap ?? NaN);
    // The default is BudgetSettings.triageEscalationUsdPerDay's ($1).
    return { capUsd: Number.isFinite(cap) && cap >= 0 ? cap : 1, spentUsd: Number(r.rows[0]?.spent ?? 0) };
  }

  /**
   * D6: hold `usd` against today's hard cap while a call runs (reserve, then spend, then release). Refused when the
   * booked spend + what calls in flight hold + `usd` would pass the cap. First-scan spend has its own budget (no hold).
   */
  async reserveSpend(usd: number, o: { budget?: 'daily' | 'first_scan' } = {}): Promise<Reservation> {
    const b = await this.budgetStatus();
    if ((o.budget ?? traceContext()?.budget ?? 'daily') === 'first_scan') return { ok: true, heldUsd: 0, spentUsd: b.todayUsd, reservedUsd: 0, hardCapUsd: b.hardCapUsd, release: async () => undefined };
    return reserveBudget(this.db, this.userId, { day: localDay(this.now(), await this.timezone()), usd, hardCapUsd: b.hardCapUsd });
  }

  // ------------------------------------------------------------------ completion pass read helpers (CMP-1)

  /**
   * Open items that are mine (status open / in progress / waiting / likely done, involvement owner or contributor,
   * not owned by someone else), created at or before `asOf`, with their evidence as of then.
   */
  async completionItems(opts: { asOf?: string; limit?: number; statuses?: readonly string[] } = {}): Promise<CompletionItem[]> {
    const asOf = opts.asOf && toMs(opts.asOf) != null ? isoMs(toMs(opts.asOf)!) : this.now().toISOString();
    // CMP-SUG: suggested items (Triage) are checked too, so an ask already answered can be found settled before anyone
    // has to click it (before, the pass skipped them, and 132 of them waited as Still needed? after the first scan).
    const statuses = opts.statuses?.length ? [...opts.statuses] : ['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'suggested'];
    const items = await this.db.execute<{
      id: string;
      kind: string;
      title: string;
      purpose: string | null;
      status: string;
      due_at: string | null;
      created_at: string;
      involvement: Involvement;
      account_id: string | null;
      account_names: string[] | null;
      cp_name: string | null;
      cp_email: string | null;
      cp_slack: string | null;
      file_refs: string[] | null;
    }>(sql`
      select wi.id, wi.kind::text as kind, wi.title, wi.purpose, wi.status::text as status, wi.due_at, wi.created_at,
             wi.involvement, wi.account_id::text as account_id,
             (select array_remove(array_agg(distinct n), null) from (
                select a.name as n from accounts a where a.id = wi.account_id
                union all select al.value from account_aliases al where al.account_id = wi.account_id) an) as account_names,
             cp.display_name as cp_name, cp.primary_email as cp_email,
             (select pi.external_id from person_identities pi where pi.person_id = cp.id and pi.system = 'slack' order by pi.is_primary desc limit 1) as cp_slack,
             (select array_remove(array_agg(distinct f), null) from (
                select x.external_id as f from work_item_links l join assets x on x.id = l.asset_id where l.work_item_id = wi.id
                union all select x.external_id from work_item_deliverables d join assets x on x.id = d.asset_id where d.work_item_id = wi.id) fr) as file_refs
        from work_items wi
        left join people cp on cp.id = wi.counterparty_person_id
       where wi.owner_user_id = ${this.userId}
         and wi.status::text = any(${textArr(statuses)})
         and wi.involvement in ('owner', 'contributor') and wi.owner_person_id is null
         and wi.created_at <= ${asOf}::timestamptz
       order by wi.created_at desc
       limit ${Math.max(1, Math.min(opts.limit ?? 400, 2000))}`);
    if (!items.rows.length) return [];
    const ev = await this.db.execute<CompletionRow & { work_item_id: string; role: EvidenceRole; rationale: string | null }>(sql`
      select e.work_item_id, e.role::text as role, e.rationale, ${COMPLETION_COLUMNS},
             left(concat_ws(E'\n', si.title, si.body, (case when jsonb_typeof(si.meta->'files') = 'array' then '[attached: ' || (select string_agg(f->>'name', ', ') from jsonb_array_elements(si.meta->'files') f) || ']' when si.meta->>'hasFile' = 'true' then '[attached: a file]' end)), 900) as text
        from work_item_evidence e join source_items si on si.id = e.source_item_id
       where e.work_item_id = any(${uuidArr(items.rows.map((r) => r.id))}) and e.created_at <= ${asOf}::timestamptz
       order by si.occurred_at`);
    const byItem = new Map<string, CompletionEvidence[]>();
    for (const r of ev.rows) {
      const list = byItem.get(r.work_item_id) ?? [];
      list.push({ sourceItemId: r.id, role: r.role, ...completionFieldsOf(r), ...(r.rationale ? { reason: r.rationale } : {}) });
      byItem.set(r.work_item_id, list);
    }
    return items.rows.map((r) => ({
      workItemId: r.id,
      kind: r.kind,
      title: r.title,
      ...(r.purpose ? { purpose: r.purpose } : {}),
      status: r.status,
      ...(r.due_at ? { due: iso(r.due_at)! } : {}),
      createdAt: iso(r.created_at)!,
      involvement: r.involvement,
      ...(r.account_id ? { accountId: r.account_id } : {}),
      accountNames: r.account_names ?? [],
      ...(r.cp_name || r.cp_email || r.cp_slack ? { counterparty: { ...(r.cp_name ? { name: r.cp_name } : {}), ...(r.cp_email ? { email: r.cp_email } : {}), ...(r.cp_slack ? { externalId: r.cp_slack } : {}) } } : {}),
      fileRefs: r.file_refs ?? [],
      evidence: byItem.get(r.id) ?? [],
    }));
  }

  /** Source items that arrived (first seen, or last content change) in (seenAfter, seenUntil], newest first. */
  async completionSources(opts: { seenAfter: string; seenUntil: string; limit?: number }): Promise<CompletionSource[]> {
    const after = toMs(opts.seenAfter);
    const until = toMs(opts.seenUntil);
    if (after == null || until == null || until <= after) return [];
    const res = await this.db.execute<CompletionRow & { seen_at: string; title: string | null; url: string | null }>(sql`
      select ${COMPLETION_COLUMNS}, si.title, si.url, left(concat_ws(E'\n', si.body, (case when jsonb_typeof(si.meta->'files') = 'array' then '[attached: ' || (select string_agg(f->>'name', ', ') from jsonb_array_elements(si.meta->'files') f) || ']' when si.meta->>'hasFile' = 'true' then '[attached: a file]' end)), 1200) as text, -- DLV-1: attachments shown to the check
             greatest(si.first_seen_at, coalesce(si.content_changed_at, si.first_seen_at)) as seen_at
        from source_items si
       where si.owner_user_id = ${this.userId} and si.deleted_upstream_at is null
         and si.source in ('slack', 'gmail', 'calendar', 'drive')
         and greatest(si.first_seen_at, coalesce(si.content_changed_at, si.first_seen_at)) > ${isoMs(after)}::timestamptz
         and greatest(si.first_seen_at, coalesce(si.content_changed_at, si.first_seen_at)) <= ${isoMs(until)}::timestamptz
       order by seen_at desc
       limit ${Math.max(1, Math.min(opts.limit ?? 4000, 20_000))}`);
    return res.rows.map((r) => ({
      sourceItemId: r.id,
      ...completionFieldsOf(r),
      seenAt: iso(r.seen_at)!,
      ...(r.title ? { title: r.title } : {}),
      ...(r.url ? { url: r.url } : {}),
    }));
  }

  /** Test/ops helper: forget in-flight run state (e.g. after a simulated crash). */
  static forgetRuns(): void {
    RUNS.clear();
  }
}

async function insertLedger(tx: Tx, connectorId: string, scope: string, runId: string, ledger: ReturnType<typeof coverageToLedger>): Promise<void> {
  for (const e of ledger) {
    await tx.execute(sql`
      insert into scan_ledger_entries (scan_run_id, connector_id, scope, object_kind, object_external_id, covered_from, covered_to,
                                       start_token, end_token, item_count, outcome)
      values (${runId}, ${connectorId}, ${scope}, ${e.objectKind}, ${e.ref}, ${e.coveredFrom}::timestamptz, ${e.coveredTo}::timestamptz,
              ${e.startToken}, ${e.endToken}, ${e.itemCount}, ${e.outcome})`);
  }
}

/** Scanner error class → the contract's connector error class (auth | transient | rate_limited | bug | offline). */
/** The cause of a failed run from its message: prefix_tripwire, cost_cap, timeout, max_turns, no_finish, coverage, auth … */
export function failureCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('prefix tripwire')) return 'prefix_tripwire';
  if (m.includes('cost cap')) return 'cost_cap';
  if (m.includes('watchdog') || m.includes('timed out') || m.includes('timeout')) return 'timeout';
  if (m.includes('max_turns')) return 'max_turns';
  if (m.includes('without cc_finish') || m.includes('without a cursor')) return 'no_finish';
  if (m.includes('coverage does not span') || m.includes('outside the run window')) return 'coverage';
  if (m.includes('disallowed tool')) return 'disallowed_tool';
  if (/auth|401|403|unauthori[sz]ed|login/.test(m)) return 'auth';
  if (/rate.?limit|429/.test(m)) return 'rate_limited';
  if (m.includes('cancel') || m.includes('abort')) return 'cancelled';
  return 'error';
}

export function contractErrorClass(c: ConnectorHealthProbe['errorClass'] | undefined): 'auth' | 'transient' | 'rate_limited' | 'bug' | 'offline' {
  if (c === 'auth' || c === 'transient' || c === 'rate_limited') return c;
  if (c === 'config') return 'bug';
  return 'transient';
}

// ---------------------------------------------------------------------------------------------
// Completion pass rows (CMP-1)
// ---------------------------------------------------------------------------------------------

/** Source-item columns both completion reads select (alias `si`). */
const COMPLETION_COLUMNS = sql.raw(`si.id, si.source::text as source, si.kind::text as kind, si.external_id, si.external_parent_id, si.occurred_at,
  si.from_me, si.meta->'author' as author, si.meta->'participants' as participants, si.meta->'accountHints' as account_hints,
  si.meta->>'connector' as connector, si.meta->'fileRefs' as meta_file_refs,
  coalesce((select array_agg(r.value) from source_item_refs r where r.source_item_id = si.id), '{}') as refs`);

type CompletionRow = {
  id: string;
  source: string;
  kind: string;
  external_id: string;
  external_parent_id: string | null;
  occurred_at: string;
  from_me: boolean;
  author: unknown;
  participants: unknown;
  account_hints: unknown;
  connector: string | null;
  meta_file_refs: unknown;
  refs: string[] | null;
  text: string | null;
};

const SOURCE_CONNECTOR: Record<string, ConnectorId> = { slack: 'slack', gmail: 'gmail', calendar: 'calendar', drive: 'drive', gemini_notes: 'gemini_notes', org62: 'org62', vdp: 'vdp', claude: 'claude_sessions' };
const KIND_BACK: Record<string, string> = { slack_message: 'message', email_message: 'email', drive_file_revision: 'file_revision', gemini_note: 'meeting_notes', org62_record_snapshot: 'record_snapshot', vdp_record_snapshot: 'record_snapshot' };

function personOf(v: unknown): PersonRef | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string) : undefined);
  const p: PersonRef = {
    ...(str('name') ? { name: str('name') } : {}),
    ...(str('email') ? { email: str('email') } : {}),
    ...(str('externalId') ? { externalId: str('externalId') } : {}),
    ...(o.isMe === true ? { isMe: true } : {}),
    ...(o.isExternal === true ? { isExternal: true } : {}),
  };
  return Object.keys(p).length ? p : undefined;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);

function completionFieldsOf(r: CompletionRow): Omit<CompletionEvidence, 'sourceItemId' | 'role'> {
  const author = personOf(r.author);
  const participants = Array.isArray(r.participants) ? r.participants.map(personOf).filter((p): p is PersonRef => !!p) : [];
  const connector = (r.connector && r.connector in CONNECTOR_META ? r.connector : (SOURCE_CONNECTOR[r.source] ?? r.source)) as ConnectorId;
  return {
    connector,
    kind: KIND_BACK[r.kind] ?? r.kind,
    externalId: r.external_id,
    ...(r.external_parent_id ? { threadRef: r.external_parent_id } : {}),
    occurredAt: iso(r.occurred_at)!,
    fromMe: r.from_me === true,
    ...(author ? { author } : {}),
    ...(participants.length ? { participants } : {}),
    fileRefs: [...new Set([...(r.refs ?? []), ...strings(r.meta_file_refs)])],
    accountHints: strings(r.account_hints),
    ...(r.text ? { text: r.text } : {}),
  };
}


/** What `recordSpend` books (ScannerStore.recordSpend's input, D0 audit fields included). */
export type RecordSpendInput = Parameters<ScannerStore['recordSpend']>[0];

interface SpendRow {
  model: string;
  skill: string | null;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  status: string;
  errorCode: string | null;
  hash: string;
  contentHash: string | null;
  modelReason: string;
  outcome: string | null;
}

const tok = (n: number | undefined) => Math.max(0, Math.round(Number.isFinite(n as number) ? (n as number) : 0));

/**
 * D0: the rest of a spend no pass row covered, with its tokens. The caller's per-model usage (the SDK's modelUsage)
 * less what the pass rows booked is what the rest was spent on; the rest is spread over those models by their
 * remaining cost. Without usage, the rest is one row on the caller's model with the caller's tokens.
 */
export function restRows(restUsd: number, parts: PassSpend[], input: SpendBooked, skill: string | null, runId: string | null): SpendRow[] {
  const base = { skill, status: 'ok', errorCode: null, contentHash: input.contentHash ?? null, modelReason: input.modelReason ?? 'default', outcome: input.outcome ?? null };
  const left = new Map<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number }>();
  for (const u of input.usage ?? []) left.set(u.model, { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, costUsd: u.costUsd });
  for (const p of parts) {
    const l = p.model ? left.get(p.model) : undefined;
    if (!l) continue;
    l.inputTokens -= p.inputTokens;
    l.outputTokens -= p.outputTokens;
    l.cacheReadTokens -= p.cacheReadTokens;
    l.cacheWriteTokens -= p.cacheWriteTokens;
    l.costUsd -= p.costUsd;
  }
  const res = [...left].filter(([, l]) => l.costUsd > 1e-7);
  const hash = () => `spend:${runId ?? 'none'}:${randomUUID()}`;
  if (!res.length) {
    return [{ ...base, model: input.model, usd: restUsd, inputTokens: tok(input.inputTokens), outputTokens: tok(input.outputTokens), cacheReadTokens: tok(input.cacheReadTokens), cacheWriteTokens: tok(input.cacheWriteTokens), hash: hash() }];
  }
  const total = res.reduce((a, [, l]) => a + l.costUsd, 0);
  let booked = 0;
  return res.map(([model, l], i) => {
    const usd = i === res.length - 1 ? restUsd - booked : (restUsd * l.costUsd) / total;
    booked += usd;
    return { ...base, model, usd, inputTokens: tok(l.inputTokens), outputTokens: tok(l.outputTokens), cacheReadTokens: tok(l.cacheReadTokens), cacheWriteTokens: tok(l.cacheWriteTokens), hash: hash() };
  });
}
