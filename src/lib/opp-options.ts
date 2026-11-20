/**
 * The opportunity picker of a Time row: which opps a row can log to, ranked for that row, and the type-to-filter
 * order. Pure over contract records, so the mock, the db DataSource (GET /time/opps) and the picker share it.
 *
 * Rank (top match first): opps on the row's account, then the opp its evidence is on (the meeting's opp, its Claude
 * session's task's opp), then opps on an account its evidence names (the meeting's, its attendees', its Drive
 * file's), then opps you logged to in the last 30 days, then the rest; reasons add up (tierOf). Within a tier: open
 * first, used most recently, on my team, nearest close date, A–Z. Every option says why (`why`, tenet: Legible).
 */
import type { Account, ActivityEntry, AgentRun, Asset, CalendarEvent, OppOption, OppOptions, OppOptionWhy, Opportunity, Person } from '@/contract';

export interface OppOptionsInput {
  entry: ActivityEntry | null;
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
}

/** An opp's Org62 id from its Org62 link. */
const org62IdFromUrl = (o: Pick<Opportunity, 'org62Url'>): string | null => o.org62Url?.match(/\/(006[A-Za-z0-9]{12,15})(?:\/|$|\?)/)?.[1] ?? null;

/** Days of use that count as "recent". */
export const RECENT_DAYS = 30;
/** A closed opp older than this (by close date) is left out unless the row is tied to it. */
const CLOSED_KEEP_DAYS = 365;

const USED = new Set<ActivityEntry['status']>(['approved', 'synced_to_canvas', 'logged', 'verified', 'verify_failed']);

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** The tier of an option (summed): on the row's account 8, its evidence's own opp 4, an account its evidence names 2, used lately 1. */
export function tierOf(why: readonly OppOptionWhy[]): number {
  return (why.includes('account') ? 8 : 0) + (why.includes('evidence') ? 4 : 0) + (why.includes('related') ? 2 : 0) + (why.includes('recent') ? 1 : 0);
}

/** The accounts and opps a row's evidence points to. */
export function evidenceTies(entry: ActivityEntry, i: Pick<OppOptionsInput, 'events' | 'people' | 'assets' | 'runs' | 'workItems'>): { oppIds: Set<string>; accountIds: Set<string> } {
  const oppIds = new Set<string>();
  const accountIds = new Set<string>();
  const add = (acct: string | null | undefined, opp?: string | null) => {
    if (acct) accountIds.add(acct);
    if (opp) oppIds.add(opp);
  };
  const people = new Map(i.people.map((p) => [p.id, p]));
  for (const s of entry.sources) {
    const ext = s.externalId;
    if (s.kind === 'calendar' && ext) {
      for (const ev of i.events) {
        if (ev.id !== ext && ev.source.externalId !== ext) continue;
        add(ev.accountId, ev.oppId);
        for (const a of ev.attendees) add(people.get(a.id)?.accountId);
      }
    } else if (s.kind === 'drive') {
      for (const a of i.assets) if ((ext && (a.id === ext || a.url?.includes(ext))) || (s.url && a.url === s.url)) add(a.accountId);
    } else if (s.kind === 'claude' && ext) {
      const run = i.runs.find((r) => r.id === ext);
      const w = run?.workItemId ? i.workItems.find((x) => x.id === run.workItemId) : undefined;
      if (w) add(w.accountId, w.oppId);
    }
  }
  return { oppIds, accountIds };
}

export function buildOppOptions(i: OppOptionsInput): OppOptions {
  const acctName = new Map(i.accounts.map((a) => [a.id, a.name]));
  const e = i.entry;
  // the row's account: by name (the row shows a name), and the current opp's account
  const rowAccounts = new Set<string>();
  if (e) {
    const n = norm(e.accountName);
    if (n) for (const a of i.accounts) if (norm(a.name) === n) rowAccounts.add(a.id);
    const cur = e.oppId ? i.opps.find((o) => o.id === e.oppId) : undefined;
    if (cur?.accountId) rowAccounts.add(cur.accountId);
  }
  const ties = e ? evidenceTies(e, i) : { oppIds: new Set<string>(), accountIds: new Set<string>() };
  // what you logged to lately: rows approved or later, or rows whose opp you set (never this row)
  const since = addDays(i.today, -RECENT_DAYS);
  const lastUsed = new Map<string, string>();
  for (const a of i.activity) {
    if (!a.oppId || a.id === e?.id || a.date < since || a.date > i.today) continue;
    if (!USED.has(a.status) && !a.userLockedFields.includes('oppId')) continue;
    if ((lastUsed.get(a.oppId) ?? '') < a.date) lastUsed.set(a.oppId, a.date);
  }
  const oldClosed = addDays(i.today, -CLOSED_KEEP_DAYS);
  const out: Array<OppOption & { score: number }> = [];
  for (const o of i.opps) {
    const why: OppOptionWhy[] = [];
    if (o.accountId && rowAccounts.has(o.accountId)) why.push('account');
    if (ties.oppIds.has(o.id)) why.push('evidence');
    else if (o.accountId && ties.accountIds.has(o.accountId)) why.push('related');
    if (lastUsed.has(o.id)) why.push('recent');
    const current = o.id === e?.oppId;
    // an opp that closed over a year ago only shows when this row points at it (its evidence, your use, its value)
    if (!o.isOpen && !current && !ties.oppIds.has(o.id) && !lastUsed.has(o.id) && (!o.closeDate || o.closeDate < oldClosed)) continue;
    out.push({
      id: o.id,
      name: o.name,
      accountId: o.accountId || null,
      accountName: (o.accountId && acctName.get(o.accountId)) || null,
      stage: o.stage,
      closeDate: o.closeDate,
      isOpen: o.isOpen,
      // my opp for the picker: on its team, or holding a DC on it (Opportunity.isMine is the team only)
      isMine: o.isMine || o.dcAssigned,
      why,
      lastUsed: lastUsed.get(o.id) ?? null,
      org62Id: org62IdFromUrl(o),
      score: tierOf(why),
    });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.isOpen) - Number(a.isOpen) ||
      (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') ||
      Number(b.isMine) - Number(a.isMine) ||
      (a.closeDate ?? '9999').localeCompare(b.closeDate ?? '9999') ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  return { entryId: e?.id ?? null, opps: out.map(({ score: _s, ...o }) => o) };
}

/** How well an option matches the typed words: 0 = not all words found; word starts count more than inner hits. */
export function matchScore(o: Pick<OppOption, 'name' | 'accountName' | 'stage'>, tokens: string[]): number {
  if (!tokens.length) return 1;
  const name = norm(o.name);
  const acct = norm(o.accountName);
  let s = 0;
  for (const t of tokens) {
    const at = (h: string) => (h.startsWith(t) || h.includes(` ${t}`) || h.includes(`·${t}`) ? 3 : h.includes(t) ? 1 : 0);
    const best = Math.max(at(name), at(acct) * 0.9, norm(o.stage).includes(t) ? 0.5 : 0);
    if (!best) return 0;
    s += best;
  }
  return s;
}

export const queryTokens = (q: string) => norm(q).split(/[\s·,/]+/).filter(Boolean);

/**
 * The picker's list for what you typed, top match first: nothing typed = the row's ranking, without closed opps the
 * row has no tie to; typed = every opp whose name or account has all the words, still tier first (the row's account
 * before others), then open, then the better text match, then the row's ranking.
 */
export function filterOppOptions(opps: OppOption[], q: string, currentId: string | null = null): OppOption[] {
  const tokens = queryTokens(q);
  if (!tokens.length) return opps.filter((o) => o.isOpen || o.why.length > 0 || o.id === currentId);
  return opps
    .map((o, idx) => ({ o, idx, m: matchScore(o, tokens) }))
    .filter((x) => x.m > 0)
    .sort((a, b) => tierOf(b.o.why) - tierOf(a.o.why) || Number(b.o.isOpen) - Number(a.o.isOpen) || b.m - a.m || a.idx - b.idx)
    .map((x) => x.o);
}
