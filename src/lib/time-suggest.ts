/**
 * What the app suggests for a Time row that needs an opportunity (Time ▸ Needs you, the row's details, the picker):
 * internal work, or which opportunity, with a short reason and how sure it is. Pure over contract records, so the
 * mock and the db DataSource attach the same suggestion to the same row (GET /time, GET /time/log, PATCH answers).
 *
 * Two passes, the cheap one first:
 *   rules   deterministic, from what the app already knows (src/lib/opp-options.ts ranks the row's opps): the meeting's
 *           own opp; the row's account (its only open opp, else the one you logged to last); an account its evidence
 *           names (attendees, its Drive file); an attendee's email domain or a Slack channel's name that names an
 *           account. Confidence is fixed per rule (RULE_CONFIDENCE), so the same row always reads the same.
 *   ai      the cheap model's answer (`activity.suggest`, src/jobs/handlers/activity-suggest.ts), stored in kv
 *           SUGGESTIONS_KV per row with the hash of the inputs it saw (suggestKey): only for rows the rules don't
 *           settle (below RULES_SETTLE), and only while those inputs are unchanged. It may say Internal.
 *
 * Nothing is applied for you: the UI shows the suggestion with Accept (one click, or Accept for many rows); the
 * owner asked to verify these (2026-11-14). Color: the AI color, the app's guess (rules or model).
 */
import type { Account, ActivityEntry, ActivitySuggestion, AgentRun, Asset, CalendarEvent, OppOption, Opportunity, Person } from '@/contract';
import { buildOppOptions } from './opp-options';

/** kv key (db) of the model's stored answers: `{ rows: { [rowId]: StoredSuggestion } }`. */
export const SUGGESTIONS_KV = 'cc.time.suggestions';
/** Bump when the prompt or the inputs change meaning: stored answers made for another version are asked again. */
export const SUGGEST_PROMPT_VERSION = 'activity-suggest@1';
/** A rules suggestion this sure settles the row: no model call. */
export const RULES_SETTLE = 0.75;
/** The model pass asks only about rows of the last this many days (older held rows keep the rules' suggestion). */
export const SUGGEST_LOOKBACK_DAYS = 60;

/** The fixed confidence of each rule (Legible: the same row always reads the same). */
export const RULE_CONFIDENCE = {
  meetingOpp: 0.92,
  accountOnly: 0.88,
  relatedOnly: 0.78,
  domainOnly: 0.76,
  channelOnly: 0.76,
  accountRecent: 0.72,
  meetingOppOfMany: 0.7,
  related: 0.55,
  account: 0.5,
  named: 0.5,
} as const;

/** One stored model answer for a row (kv SUGGESTIONS_KV). */
export interface StoredSuggestion {
  /** suggestKey of the row when it was asked (a changed row is asked again). */
  key: string;
  kind: 'opp' | 'internal';
  oppId: string | null;
  /** Internal: the internal type it would take. */
  taskType: string | null;
  confidence: number;
  reason: string;
  model: string;
  at: string;
}

export interface SuggestContext {
  opps: Opportunity[];
  accounts: Account[];
  events: CalendarEvent[];
  people: Person[];
  assets: Asset[];
  runs: AgentRun[];
  workItems: Array<{ id: string; accountId: string | null; oppId: string | null }>;
  activity: ActivityEntry[];
  /** Today, local (YYYY-MM-DD). */
  today: string;
  /** The model's stored answers by row id. */
  stored: Record<string, StoredSuggestion>;
  /** D-64: the persona logs internal-only work (the model may say Internal). */
  internalActivity: boolean;
}

const LIVE = new Set<ActivityEntry['status']>(['needs_input', 'proposed', 'approved']);

/** The row asks for an opportunity: live, no opp, not internal, not read from Org62, not held on a canvas. */
export function wantsSuggestion(e: ActivityEntry): boolean {
  return LIVE.has(e.status) && !e.oppId && !e.internal && !e.fromOrg62 && !e.canvasDraftId;
}

/** FNV-1a 32-bit, hex: a stable, dependency-free hash (client and server). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The inputs a model answer was made from: the prompt version, what the row says, its account and its sources. */
export function suggestKey(e: Pick<ActivityEntry, 'description' | 'accountName' | 'sources' | 'durationH'>): string {
  const src = e.sources.map((s) => `${s.kind}|${s.label}|${s.externalId ?? ''}`).join('\n');
  return `${SUGGEST_PROMPT_VERSION}:${fnv(`${e.description}\u0000${e.accountName ?? ''}\u0000${src}`)}`;
}

export function storedSuggestionsOf(v: unknown): Record<string, StoredSuggestion> {
  const rows = (v as { rows?: unknown } | null | undefined)?.rows;
  if (!rows || typeof rows !== 'object') return {};
  const out: Record<string, StoredSuggestion> = {};
  for (const [id, x] of Object.entries(rows as Record<string, Partial<StoredSuggestion>>)) {
    if (!x || (x.kind !== 'opp' && x.kind !== 'internal') || typeof x.key !== 'string' || typeof x.confidence !== 'number') continue;
    out[id] = { key: x.key, kind: x.kind, oppId: x.oppId ?? null, taskType: x.taskType ?? null, confidence: Math.max(0, Math.min(1, x.confidence)), reason: String(x.reason ?? '').slice(0, 240), model: String(x.model ?? ''), at: String(x.at ?? '') };
  }
  return out;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Words too generic to name an account in a channel or a domain. */
const GENERIC = new Set(['the', 'inc', 'corp', 'corporation', 'company', 'group', 'health', 'bank', 'global', 'services', 'systems', 'solutions', 'international', 'holdings', 'technologies', 'tech', 'data', 'cloud', 'team', 'ext', 'external', 'shared', 'internal', 'project', 'deal', 'sales', 'support', 'general', 'example', 'com', 'net', 'org', 'io']);

/** The words an account is known by in a channel or a domain: the first one or two words of its name. */
function handlesOf(name: string): string[] {
  const words = norm(name)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
  return words.slice(0, 1);
}

/**
 * Accounts a set of tokens names (a channel's words, a domain's labels), by their handles. When several share the
 * handle ("Globex", "Globex - Marketing Cloud"), the one whose whole name is the token wins: the parent, not a part.
 */
function accountsNamed(tokens: readonly string[], accounts: readonly Account[]): Account[] {
  const t = new Set(tokens.map(norm).filter((x) => x.length >= 3 && !GENERIC.has(x)));
  if (!t.size) return [];
  const hits = accounts.filter((a) => handlesOf(a.name).some((h) => t.has(h)));
  const whole = hits.filter((a) => t.has(norm(a.name).replace(/[^\p{L}\p{N}]+/gu, '')));
  return whole.length ? whole : hits;
}

/** "#acme-ext · thread", "Slack · #acme-ext, #hooli-ext" → their channel names' words. */
function channelTokens(e: Pick<ActivityEntry, 'sources'>): { channel: string; tokens: string[] }[] {
  const out: { channel: string; tokens: string[] }[] = [];
  for (const s of e.sources) {
    if (s.kind !== 'slack') continue;
    for (const m of s.label.matchAll(/#([\p{L}\p{N}_-]{2,80})/gu)) out.push({ channel: `#${m[1]}`, tokens: m[1]!.split(/[-_]+/) });
  }
  return out;
}

/** External attendee domains the engine noted ("CF forced: external attendee (a.example, b.example); …"). */
export function attendeeDomains(e: Pick<ActivityEntry, 'issues'>): string[] {
  for (const f of e.issues) {
    const m = /external attendees? \(([^)]+)\)/i.exec(f);
    if (m) return m[1]!.split(/\s*,\s*/).filter(Boolean);
  }
  return [];
}

type Pick1 = { opp: OppOption; confidence: number; reason: string };

const asSuggestion = (p: Pick1): ActivitySuggestion => ({ kind: 'opp', oppId: p.opp.id, oppName: p.opp.name, accountName: p.opp.accountName, taskType: null, confidence: p.confidence, reason: p.reason, basis: 'rules', at: null });

/** The best open opp of a list (the ranking's order: open, used most recently, on my team, closing first, A–Z). */
function bestOf(list: readonly OppOption[]): { top: OppOption; recent: boolean } {
  const top = list[0]!;
  const second = list[1];
  return { top, recent: !!top.lastUsed && (!second?.lastUsed || top.lastUsed > second.lastUsed) };
}

/** The rules pass: the most specific thing the app knows, or null when nothing points anywhere. */
export function ruleSuggestion(e: ActivityEntry, ctx: Omit<SuggestContext, 'stored' | 'internalActivity'>, opts?: OppOption[]): ActivitySuggestion | null {
  const ranked = opts ?? buildOppOptions({ entry: e, opps: ctx.opps, accounts: ctx.accounts, events: ctx.events, people: ctx.people, assets: ctx.assets, runs: ctx.runs, workItems: ctx.workItems, activity: ctx.activity, today: ctx.today }).opps;
  const open = ranked.filter((o) => o.isOpen);
  const meeting = e.sources.some((s) => s.kind === 'calendar');

  // 1. the evidence's own opp: the meeting is on it (or its Claude session's task)
  const evidence = open.filter((o) => o.why.includes('evidence'));
  if (evidence.length === 1) return asSuggestion({ opp: evidence[0]!, confidence: RULE_CONFIDENCE.meetingOpp, reason: meeting ? 'The meeting is on this opportunity' : 'Its session’s task is on this opportunity' });

  // 2. the row's account
  const onAccount = open.filter((o) => o.why.includes('account'));
  const acct = e.accountName ?? onAccount[0]?.accountName ?? null;
  if (onAccount.length === 1) return asSuggestion({ opp: onAccount[0]!, confidence: RULE_CONFIDENCE.accountOnly, reason: `The only open opportunity on ${acct}` });
  if (evidence.length > 1) return asSuggestion({ opp: evidence[0]!, confidence: RULE_CONFIDENCE.meetingOppOfMany, reason: `The meeting points at ${evidence.length} opportunities: this one ranks first` });
  if (onAccount.length > 1) {
    const { top, recent } = bestOf(onAccount);
    return recent
      ? asSuggestion({ opp: top, confidence: RULE_CONFIDENCE.accountRecent, reason: `${acct}’s opportunity you logged to last (${fmtDay(top.lastUsed!)})` })
      : asSuggestion({ opp: top, confidence: RULE_CONFIDENCE.account, reason: `${acct} has ${onAccount.length} open opportunities: ${top.closeDate ? `this one closes first (${fmtDay(top.closeDate)})` : 'check it is this one'}` });
  }

  // 3. an account its evidence names (the meeting's attendees, its Drive file)
  const related = open.filter((o) => o.why.includes('related'));
  if (related.length) {
    const accounts = new Set(related.map((o) => o.accountId));
    const { top } = bestOf(related);
    if (related.length === 1) return asSuggestion({ opp: top, confidence: RULE_CONFIDENCE.relatedOnly, reason: `${top.accountName ?? 'Its account'} is in its evidence (${meeting ? 'the attendees' : 'its file'}): its only open opportunity` });
    return asSuggestion({ opp: top, confidence: RULE_CONFIDENCE.related, reason: `${accounts.size === 1 ? (top.accountName ?? 'An account') : `${accounts.size} accounts`} in its evidence: this opportunity ranks first` });
  }

  // 4. an attendee's email domain, or a Slack channel's name, that names one account
  const byAccount = (a: Account) => open.filter((o) => o.accountId === a.id);
  const named = (accounts: Account[], why: (a: Account) => string, only: number): ActivitySuggestion | null => {
    const withOpps = accounts.filter((a) => byAccount(a).length);
    if (withOpps.length !== 1) return null;
    const a = withOpps[0]!;
    const list = byAccount(a);
    const { top, recent } = bestOf(list);
    if (list.length === 1) return asSuggestion({ opp: top, confidence: only, reason: `${why(a)}: its only open opportunity` });
    return asSuggestion({ opp: top, confidence: RULE_CONFIDENCE.named, reason: `${why(a)}: ${recent ? `the one you logged to last (${fmtDay(top.lastUsed!)})` : `${list.length} open opportunities, this one ranks first`}` });
  };
  const domains = attendeeDomains(e);
  if (domains.length) {
    // the people the app knows at that domain say which account; else the domain's own name
    const viaPeople = new Set(ctx.people.filter((p) => p.accountId && p.email && domains.includes(norm(p.email.split('@')[1]))).map((p) => p.accountId!));
    const accounts = viaPeople.size ? ctx.accounts.filter((a) => viaPeople.has(a.id)) : accountsNamed(domains.flatMap((d) => d.split('.')), ctx.accounts);
    const s = named(accounts, (a) => `Someone from ${domains[0]} was there (${a.name})`, RULE_CONFIDENCE.domainOnly);
    if (s) return s;
  }
  for (const c of channelTokens(e)) {
    const s = named(accountsNamed(c.tokens, ctx.accounts), (a) => `${c.channel} reads as ${a.name}’s channel`, RULE_CONFIDENCE.channelOnly);
    if (s) return s;
  }
  return null;
}

/** The model's stored answer for the row, when it was made for the row as it is now and its opp still exists. */
export function storedSuggestion(e: ActivityEntry, ctx: Pick<SuggestContext, 'stored' | 'opps' | 'accounts' | 'internalActivity'>): ActivitySuggestion | null {
  const s = ctx.stored[e.id];
  if (!s || s.key !== suggestKey(e)) return null;
  if (s.kind === 'internal') {
    if (!ctx.internalActivity) return null;
    return { kind: 'internal', oppId: null, oppName: null, accountName: null, taskType: s.taskType, confidence: s.confidence, reason: s.reason, basis: 'ai', at: s.at || null };
  }
  const opp = ctx.opps.find((o) => o.id === s.oppId);
  if (!opp) return null;
  return { kind: 'opp', oppId: opp.id, oppName: opp.name, accountName: ctx.accounts.find((a) => a.id === opp.accountId)?.name ?? null, taskType: null, confidence: s.confidence, reason: s.reason, basis: 'ai', at: s.at || null };
}

/** The one suggestion a row shows: a rules answer that settles it, else the model's (when surer), else the rules'. */
export function suggestionFor(e: ActivityEntry, ctx: SuggestContext): ActivitySuggestion | null {
  if (!wantsSuggestion(e)) return null;
  const rule = ruleSuggestion(e, ctx);
  if (rule && rule.confidence >= RULES_SETTLE) return rule;
  const ai = storedSuggestion(e, ctx);
  if (ai && (!rule || ai.confidence >= rule.confidence)) return ai;
  return rule ?? ai;
}

/** Every row with its suggestion (null on rows that don't need one). */
export function withSuggestions(entries: readonly ActivityEntry[], ctx: SuggestContext): ActivityEntry[] {
  return entries.map((e) => {
    const s = suggestionFor(e, ctx);
    return s || e.suggestion ? { ...e, suggestion: s } : e;
  });
}

/** Rows the model pass would ask about: no rules answer that settles them, no stored answer for their inputs. */
export function rowsForModel(entries: readonly ActivityEntry[], ctx: SuggestContext): ActivityEntry[] {
  return entries.filter((e) => {
    if (!wantsSuggestion(e)) return false;
    const rule = ruleSuggestion(e, ctx);
    if (rule && rule.confidence >= RULES_SETTLE) return false;
    return ctx.stored[e.id]?.key !== suggestKey(e);
  });
}
