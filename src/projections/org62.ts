/**
 * Org62 record snapshots → my book (accounts, opportunities), my Org62 Events and my Deal Contributions.
 *
 * The scan-org62 skill records one `record_snapshot` per row: `externalId = <Sobject>:<Id>@<SystemModstamp>`, the
 * row's scalar fields in `payload` (→ meta) and a compact `k=v; …` excerpt (→ body). Agent payloads are not uniform
 * (a field may be in one, the other or neither), so every field is read from the payload first, then the excerpt,
 * and merged across snapshots newest first.
 *
 * My book (src/engines/deals "core" scope): opportunities I am on the team of (OpportunityTeamMember rows: a team
 * role) or hold a Deal Contribution on, and their accounts; plus accounts my logged Org62 Events point at. Other
 * opportunities on those accounts (the skill's "my accounts" query) are listed under them, not as mine.
 *
 * The daily book read (scan-org62 §6 `book`, unwindowed) is the source of truth for "open opps I am on the team
 * of": `Book:<Opp Id>` rows stamped `book_at=<run stamp>`, `BookDc:<DC Id>` rows (my DCs on open opps, same stamp),
 * and one `BookRun:<run id>` manifest (`book_at`, `rows`, `complete`). When the newest complete manifest's rows are
 * all recorded, an opp I was on the team of that it no longer lists (and no team row newer than the read names)
 * has left my book: it keeps its row, marked `leftBookAt` (never deleted). An incomplete read only adds.
 */
import type { AccountMove, BookRead, Org62Book, ProjectedAccount, ProjectedDc, ProjectedOpp, ProjectedOrg62Event, SourceRow, SweepFacts } from './types';
import { arr, bool, excerptFields, id15, isSfId, num, org62Ref, pick, sfDate, str, ymd } from './util';

interface Snap {
  si: SourceRow;
  id: string;
  at: number;
  f: Map<string, string>;
}

/** Stage names that mean closed, numbered or not (`Closed Won`, `08 - Closed`, `Dead - Duplicate`). */
const CLOSED_STAGE = /\bclosed\b|\bdead\b|^(lost|duplicate)\b/i;
const WON_STAGE = /closed\s*-?\s*won|^won\b/i;

function accountHints(si: SourceRow): { id: string | null; name: string | null } {
  const hints = arr(si.meta.accountHints).map(str).filter((x): x is string => !!x);
  const id = hints.find((h) => isSfId(h, '001')) ?? null;
  const name = hints.find((h) => !isSfId(h)) ?? null;
  return { id, name };
}

const oppHint = (si: SourceRow): string | null => arr(si.meta.oppHints).map(str).find((h): h is string => isSfId(h, '006')) ?? null;

/** Newest first, so `first(…)` picks the latest value any snapshot carries. */
function newest(snaps: Snap[]): Snap[] {
  return [...snaps].sort((a, b) => b.at - a.at || b.si.changedAt.localeCompare(a.si.changedAt));
}
function first<T>(snaps: Snap[], get: (s: Snap) => T | null): T | null {
  for (const s of snaps) {
    const v = get(s);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Rows without a modstamp in their key that still date the record they carry (its SystemModstamp → occurredAt). */
const OCCURRED_AT_KINDS = new Set(['Book', 'BookDc']);
const OPP_KINDS = ['Opportunity', 'OpportunityTeamMember', 'Book', 'MissedOpp'];

/** A team role, or null for the agent's "no role" spellings (`none (account match)`, `n/a`, `not on team`). */
const teamRole = (v: unknown): string | null => {
  const r = str(v);
  return r && !/^(none|no|n\/a|null|not\b|-)/i.test(r) ? r : null;
};

/** A book-read row's run stamp (`book_at`), epoch ms. */
const stampOf = (s: Snap): number | null => {
  const v = sfDate(s.si.meta.bookAt) ?? sfDate(s.f.get('book_at'));
  return v ? Date.parse(v) : null;
};

/** When the scans last read a record: the newest book-read stamp on its rows, else its newest snapshot's change. */
function seenAtOf(snaps: Snap[]): string | null {
  let best = 0;
  for (const s of snaps) best = Math.max(best, stampOf(s) ?? (Date.parse(s.si.changedAt) || s.at));
  return best ? new Date(best).toISOString() : null;
}

/** The newest complete book read (BookRun manifests), with how many of its rows were recorded. */
function latestBookRead(by: Map<string, Map<string, Snap[]>>): BookRead | null {
  const manifests = [...(by.get('BookRun')?.values() ?? [])]
    .flat()
    .map((s) => ({ at: stampOf(s), complete: pick(bool, s.si.meta.complete, s.f.get('complete')), rows: pick(num, s.si.meta.rows, s.f.get('rows')) }))
    .filter((m): m is { at: number; complete: boolean; rows: number | null } => m.at !== null && m.complete === true)
    .sort((a, b) => b.at - a.at);
  const m = manifests[0];
  if (!m) return null;
  const seen = [...(by.get('Book')?.values() ?? [])].filter((snaps) => snaps.some((s) => stampOf(s) === m.at)).length;
  const expected = m.rows ?? seen;
  return { at: new Date(m.at).toISOString(), expected, seen, authoritative: seen >= expected };
}

/** What the missed-opp sweep recorded on the opp's `MissedOpp:<id>` row. */
function sweepFacts(snaps: Snap[]): SweepFacts | null {
  const s = snaps.find((x) => x.si.externalId.startsWith('MissedOpp:'));
  if (!s) return null;
  const sig = pick(str, s.si.meta.signal, s.f.get('signal'));
  const others = (pick(str, s.si.meta.otherArchitectDc, s.f.get('other_architect_dc')) ?? '')
    .split(/[,|]/)
    .map((x) => x.trim())
    .filter((x) => x && !/^none$/i.test(x))
    .map((x) => {
      const mm = /^(.*?)\s*(\d+(?:\.\d+)?)\s*%?$/.exec(x);
      return mm?.[1] ? { name: mm[1].trim(), split: Number(mm[2]) } : { name: x, split: 100 };
    });
  return {
    signal: sig && /flex/i.test(sig) ? 'flex_only' : sig && /d360|name|line/i.test(sig) ? 'd360' : null,
    hours: pick(num, s.si.meta.hours, s.f.get('hours')),
    d360Amount: pick(num, s.si.meta.d360Amount, s.f.get('d360_amount')),
    flexAmount: pick(num, s.si.meta.flexAmount, s.f.get('flex_amount')),
    products: arr(s.si.meta.products).map(str).filter((x): x is string => !!x),
    otherArchitectDcs: others,
    at: s.si.changedAt,
  };
}

/**
 * DC-20: an opp's open/closed state from the newest observation of it, whichever read made it: an Opportunity, team
 * or sweep row's IsClosed (an Opportunity row dated by its SystemModstamp, a sweep row by when it last changed), a
 * book row (`Book:`, `BookDc:`: open as of its run stamp: the book read lists open opps), or a DC row's
 * Opportunity__r.IsClosed (as of when the read last changed it). Before, the opp rows' flag won even when a newer DC
 * read said closed, and a book read that saw the opp reopened lost to an older closed row. Null: no read says.
 */
function closedState(oppSnaps: readonly Snap[], dcSnaps: readonly Snap[]): boolean | null {
  let best: { t: number; closed: boolean } | null = null;
  const see = (t: number, closed: boolean | null) => {
    if (closed === null || !Number.isFinite(t)) return;
    if (!best || t > best.t) best = { t, closed };
  };
  const changed = (s: Snap) => Date.parse(s.si.changedAt) || 0;
  for (const s of oppSnaps) {
    if (s.si.externalId.startsWith('Book:')) see(stampOf(s) ?? s.at, false);
    else if (s.si.externalId.startsWith('MissedOpp:')) see(changed(s), pick(bool, s.si.meta.IsClosed, s.f.get('closed')));
    else see(s.at, pick(bool, s.si.meta.IsClosed, s.f.get('closed')));
  }
  for (const s of dcSnaps) {
    if (s.si.externalId.startsWith('BookDc:')) see(stampOf(s) ?? s.at, false);
    else see(Math.max(s.at, changed(s)), bool(s.si.meta.IsClosed));
  }
  return (best as { t: number; closed: boolean } | null)?.closed ?? null;
}

/** DC-13: the Org62 user a DC row names (SE_Name__c), or null when the read did not carry it. */
const dcOwnerOf = (s: Snap): string | null => pick((v) => (isSfId(v, '005') ? v : null), s.si.meta.SE_Name__c, s.f.get('se'));

export interface ProjectOrg62Options {
  /** My Org62 user id: a DC whose newest read names another SE (`SE_Name__c`) is not mine (DC-13). */
  me?: string | null;
}

export function projectOrg62(items: SourceRow[], options: ProjectOrg62Options = {}): Org62Book {
  const by = new Map<string, Map<string, Snap[]>>();
  for (const si of items) {
    if (si.source !== 'org62' || si.deletedUpstreamAt) continue;
    const ref = org62Ref(si.externalId);
    if (!ref) continue;
    // A sweep row (MissedOpp:<id>) or a manifest has no modstamp: it ranks below every record snapshot and dates
    // nothing. Book rows are dated by the record's SystemModstamp, which the skill puts in occurredAt.
    const at = ref.sobject === 'MissedOpp' || ref.sobject === 'BookRun' ? 0 : OCCURRED_AT_KINDS.has(ref.sobject) ? Date.parse(si.occurredAt) || 0 : Date.parse(sfDate(ref.modstamp) ?? si.occurredAt) || 0;
    const kind = ref.sobject;
    const m = by.get(kind) ?? new Map<string, Snap[]>();
    const id = OPP_KINDS.includes(kind) ? (isSfId(ref.id, '006') ? ref.id : (oppHint(si) ?? ref.id)) : ref.id;
    const list = m.get(id) ?? [];
    list.push({ si, id, at, f: excerptFields(si.body) });
    m.set(id, list);
    by.set(kind, m);
  }

  const read = latestBookRead(by);
  const readAt = read ? Date.parse(read.at) : null;
  const bookIds = new Set<string>();
  if (read?.authoritative) for (const [id, snaps] of by.get('Book') ?? []) if (snaps.some((s) => stampOf(s) === readAt)) bookIds.add(id15(id));

  // ---- Deal Contributions (mine: the dcs query and the book read filter SE_Name__c = me)
  const dcs: ProjectedDc[] = [];
  const dcSnaps = new Map<string, Snap[]>();
  for (const kind of ['Deal_Contribution__c', 'BookDc']) for (const [id, s] of by.get(kind) ?? []) dcSnaps.set(id15(id), [...(dcSnaps.get(id15(id)) ?? []), ...s]);
  /** opp id (15) → my DCs on it, newest first, as the latest data says (DC-14: two of mine are summed). */
  const myDcByOpp = new Map<string, ProjectedDc[]>();
  /** opp id (15) → every DC snapshot on it (mine or not any more): open/closed observations (DC-20). */
  const dcSnapsByOpp = new Map<string, Snap[]>();
  const me15 = options.me && isSfId(options.me, '005') ? id15(options.me) : null;
  for (const [, raw] of dcSnaps) {
    const snaps = newest(raw);
    const oppId = first(snaps, (s) => pick((v) => (isSfId(v, '006') ? v : null), s.si.meta.Opportunity__c, oppHint(s.si)));
    if (oppId) dcSnapsByOpp.set(id15(oppId), [...(dcSnapsByOpp.get(id15(oppId)) ?? []), ...snaps]);
    // DC-13: the newest read of it names another SE (reassigned; the read-back reads it by Id whoever holds it). A
    // read with no SE_Name__c came from a query filtered on me (the windowed dcs query, the book read).
    const owner = dcOwnerOf(snaps[0]!);
    if (me15 && owner && id15(owner) !== me15) continue;
    // On an opp the authoritative book lists, my DC must be in that read (or changed after it): a DC the read no
    // longer returns was removed in Org62.
    if (oppId && bookIds.has(id15(oppId)) && !snaps.some((s) => stampOf(s) === readAt || (!s.si.externalId.startsWith('BookDc:') && s.at > readAt!))) continue;
    const dc: ProjectedDc = {
      org62DcId: org62Ref(snaps[0]!.si.externalId)?.id ?? snaps[0]!.si.externalId,
      org62OpportunityId: oppId,
      role: first(snaps, (s) => pick(str, s.si.meta.Opportunity_Role__c, s.f.get('role'))),
      splitPercent: first(snaps, (s) => pick(num, s.si.meta.Split_Percentage__c, s.f.get('split'))),
      org62ModifiedAt: new Date(snaps[0]!.at || Date.parse(snaps[0]!.si.occurredAt)).toISOString(),
      seenAt: seenAtOf(snaps),
      sourceItemId: snaps[0]!.si.id,
    };
    dcs.push(dc);
    if (oppId) myDcByOpp.set(id15(oppId), [...(myDcByOpp.get(id15(oppId)) ?? []), dc].sort((a, b) => (b.seenAt ?? '').localeCompare(a.seenAt ?? '') || (b.org62ModifiedAt ?? '').localeCompare(a.org62ModifiedAt ?? '')));
  }
  const myDcOpps = new Set(myDcByOpp.keys());
  /** DC-14: my split on an opp is the sum of my DCs there (null when none carries one); the role the newest one's. */
  const myDcOf = (opp15: string): { role: string | null; split: number | null } | null => {
    const list = myDcByOpp.get(opp15);
    if (!list?.length) return null;
    const splits = list.map((d) => d.splitPercent).filter((x): x is number => x !== null);
    return { role: list[0]!.role, split: splits.length ? Math.round(splits.reduce((a, b) => a + b, 0) * 100) / 100 : null };
  };

  // ---- Opportunities (team rows and account rows share the opp's key). The daily missed-opp sweep lists opps on
  // my accounts (opp-team or logged-event accounts) without a modstamp window, so it fills in what the windowed
  // scans have not reached yet.
  const swept = new Set([...(by.get('MissedOpp')?.keys() ?? [])].map(id15));
  const oppSnaps = new Map<string, { id: string; snaps: Snap[] }>();
  for (const kind of OPP_KINDS) {
    for (const [id, s] of by.get(kind) ?? []) {
      const cur = oppSnaps.get(id15(id));
      // keep the 18-character form when any row carries it
      oppSnaps.set(id15(id), { id: cur && cur.id.length >= id.length ? cur.id : id, snaps: [...(cur?.snaps ?? []), ...s] });
    }
  }
  const opps: ProjectedOpp[] = [];
  const accountMoves: AccountMove[] = [];
  for (const [, { id, snaps: raw }] of oppSnaps) {
    if (!isSfId(id, '006')) continue;
    const snaps = newest(raw);
    const role = first(snaps, (s) => pick(teamRole, s.si.meta.TeamMemberRole, s.f.get('team_role')));
    const stage = first(snaps, (s) => pick(str, s.si.meta.StageName, s.f.get('stage')));
    // the flags may sit in the payload or the excerpt (`closed=` / `won=`; team rows nest them under Opportunity);
    // the newest observation of open/closed wins, whichever read made it (DC-20)
    const closedFlag = closedState(snaps, dcSnapsByOpp.get(id15(id)) ?? []);
    const wonFlag = first(snaps, (s) => pick(bool, s.si.meta.IsWon, s.f.get('won')));
    const isClosed = closedFlag ?? (stage ? CLOSED_STAGE.test(stage) : false);
    // The book read decides "on my team" for open opps; a team row newer than the read still counts (added since).
    const inBook = bookIds.has(id15(id));
    const teamSince = readAt !== null && snaps.some((s) => s.at > readAt && /^(Opportunity|OpportunityTeamMember):/.test(s.si.externalId) && !!pick(teamRole, s.si.meta.TeamMemberRole, s.f.get('team_role')));
    const onMyTeam = read?.authoritative ? inBook || teamSince || (!!role && isClosed) : !!role;
    const myDc = myDcOf(id15(id));
    // the complete book read says this open opp is not mine (not on its team, and no DC of mine on it)
    const notInBookAt = read?.authoritative && !onMyTeam && !isClosed && !myDc ? read.at : null;
    const acctOf = (s: Snap) => {
      const h = accountHints(s.si);
      const aid = pick((v) => (isSfId(v, '001') ? v : null), s.si.meta.AccountId, h.id);
      return aid ? { id: aid, name: pick(str, s.si.meta.AccountName, h.name) } : null;
    };
    const acct = first(snaps, acctOf);
    // DC-21 / DC-24: an older read put it on another account (it moved, or that account was merged into this one)
    if (acct) for (const old of new Set(snaps.map((s) => acctOf(s)?.id).filter((x): x is string => !!x && id15(x) !== id15(acct.id)).map(id15))) accountMoves.push({ org62OpportunityId: id, from: old, to: acct.id });
    const name = first(snaps, (s) => str(s.si.title)) ?? id;
    opps.push({
      org62OpportunityId: id,
      org62AccountId: acct?.id ?? null,
      accountName: acct?.name ?? first(snaps, (s) => accountHints(s.si).name),
      name,
      stage,
      amount: first(snaps, (s) => pick(num, s.si.meta.Amount, s.f.get('amount'))),
      closeDate: first(snaps, (s) => pick(ymd, s.si.meta.CloseDate, s.f.get('close'))),
      forecastCategory: first(snaps, (s) => pick(str, s.si.meta.ForecastCategoryName, s.f.get('forecast'))),
      type: first(snaps, (s) => pick(str, s.si.meta.Type, s.f.get('type'))),
      isClosed,
      isWon: wonFlag ?? (isClosed && !!stage && WON_STAGE.test(stage)),
      onMyTeam,
      teamKnown: !!read?.authoritative && !isClosed,
      myTeamRole: role,
      nextStep: first(snaps, (s) => pick(str, s.si.meta.NextStep, s.f.get('next'))),
      // the book read (Book:) and the sweep select no NextStep; the windowed opp and team reads do
      nextStepRead: snaps.some((s) => /^(Opportunity|OpportunityTeamMember):/.test(s.si.externalId)),
      myDc: !!myDc,
      myDcRole: myDc?.role ?? null,
      myDcSplit: myDc?.split ?? null,
      inBook,
      leftBookAt: notInBookAt && role ? notInBookAt : null,
      notInBookAt,
      sweep: sweepFacts(snaps),
      org62ModifiedAt: snaps[0]!.at ? new Date(snaps[0]!.at).toISOString() : null,
      sourceItemId: snaps[0]!.si.id,
    });
  }

  // An opp I hold a DC on but no opp row was read for yet: the DC row names it (title "DC on <opp>", account hints,
  // opp stage and close date in the excerpt).
  const seen = new Set(opps.map((o) => id15(o.org62OpportunityId)));
  for (const [, raw] of dcSnaps) {
    const snaps = newest(raw);
    const oppId = first(snaps, (s) => pick((v) => (isSfId(v, '006') ? v : null), s.si.meta.Opportunity__c, oppHint(s.si)));
    if (!oppId || seen.has(id15(oppId)) || !myDcOpps.has(id15(oppId))) continue;
    seen.add(id15(oppId));
    const stage = first(snaps, (s) => pick(str, s.si.meta.StageName, s.f.get('opp_stage')));
    const isClosed = closedState([], dcSnapsByOpp.get(id15(oppId)) ?? snaps) ?? (stage ? CLOSED_STAGE.test(stage) : false);
    const acct = first(snaps, (s) => {
      const h = accountHints(s.si);
      return h.id ? h : null;
    });
    opps.push({
      org62OpportunityId: oppId,
      org62AccountId: acct?.id ?? null,
      accountName: acct?.name ?? null,
      name: first(snaps, (s) => str(s.si.title)?.replace(/^DC on\s+/i, '') ?? null) ?? oppId,
      stage,
      amount: null,
      closeDate: first(snaps, (s) => pick(ymd, s.si.meta.CloseDate, s.f.get('close'))),
      forecastCategory: null,
      type: null,
      isClosed,
      isWon: first(snaps, (s) => bool(s.si.meta.IsWon)) ?? (isClosed && !!stage && WON_STAGE.test(stage)),
      onMyTeam: false,
      teamKnown: !!read?.authoritative && !isClosed,
      myTeamRole: null,
      nextStep: null,
      nextStepRead: false,
      myDc: true,
      myDcRole: myDcOf(id15(oppId))?.role ?? null,
      myDcSplit: myDcOf(id15(oppId))?.split ?? null,
      inBook: false,
      leftBookAt: null,
      notInBookAt: null,
      sweep: null,
      org62ModifiedAt: null,
      sourceItemId: snaps[0]!.si.id,
    });
  }

  // ---- My Events (the events query filters OwnerId = me)
  const events: ProjectedOrg62Event[] = [];
  let eventsWithoutStart = 0;
  for (const [id, raw] of by.get('Event') ?? []) {
    const snaps = newest(raw);
    const start = first(snaps, (s) => pick(sfDate, s.si.meta.StartDateTime, s.f.get('start')));
    const durationField = first(snaps, (s) => pick(num, s.si.meta.Duration__c, s.f.get('hrs')));
    const minutes = first(snaps, (s) => num(s.si.meta.DurationInMinutes));
    const endRaw = first(snaps, (s) => pick(sfDate, s.si.meta.EndDateTime, s.f.get('end')));
    if (!start) {
      eventsWithoutStart++;
      continue;
    }
    const end = endRaw ?? (durationField ? new Date(Date.parse(start) + durationField * 3_600_000).toISOString() : minutes ? new Date(Date.parse(start) + minutes * 60_000).toISOString() : null);
    if (!end || Date.parse(end) <= Date.parse(start)) {
      eventsWithoutStart++;
      continue;
    }
    const what = first(snaps, (s) => pick((v) => (isSfId(v) ? v : null), s.si.meta.WhatId, oppHint(s.si)));
    events.push({
      org62EventId: id,
      recordTypeName: first(snaps, (s) => pick(str, s.si.meta.RecordTypeName, s.f.get('rt'))) ?? 'Solutions Event',
      subject: first(snaps, (s) => str(s.si.title)),
      startsAt: start,
      endsAt: end,
      durationField,
      seTaskTypeName: first(snaps, (s) => pick(str, s.si.meta.SE_Task_Type__c, s.f.get('type'))),
      meetingTypeName: first(snaps, (s) => pick(str, s.si.meta.Meeting_Type__c, s.f.get('meeting_type'))),
      whatOrg62Id: what,
      whatName: first(snaps, (s) => pick(str, s.si.meta.WhatName, s.f.get('what'))),
      org62CreatedAt: first(snaps, (s) => pick(sfDate, s.si.meta.CreatedDate, s.f.get('created'))),
      org62ModifiedAt: snaps[0]!.at ? new Date(snaps[0]!.at).toISOString() : null,
      sourceItemId: snaps[0]!.si.id,
    });
  }

  // ---- My book: accounts of opps I am on (team or DC), plus accounts my events point at
  const accounts = new Map<string, ProjectedAccount>();
  const add = (id: string | null, name: string | null, via: ProjectedAccount['via'][number]) => {
    if (!id || !isSfId(id, '001')) return;
    const cur = accounts.get(id15(id)) ?? { org62AccountId: id, name: name ?? id, via: [], isMyBook: true };
    if (name && cur.name === cur.org62AccountId) cur.name = name;
    if (!cur.via.includes(via)) cur.via.push(via);
    accounts.set(id15(id), cur);
  };
  for (const o of opps) {
    if (o.onMyTeam) add(o.org62AccountId, o.accountName, 'opp_team');
    if (o.myDc) add(o.org62AccountId, o.accountName, 'dc');
    if (swept.has(id15(o.org62OpportunityId))) add(o.org62AccountId, o.accountName, 'sweep');
  }
  const oppAccount = new Map(opps.map((o) => [id15(o.org62OpportunityId), o]));
  for (const e of events) {
    const w = e.whatOrg62Id;
    if (!w) continue;
    if (w.startsWith('001')) add(w, e.whatName, 'org62_event');
    const o = oppAccount.get(id15(w));
    if (o) add(o.org62AccountId, o.accountName, 'org62_event');
  }
  // Names: the newest name any opp snapshot carries for the account.
  for (const o of opps) {
    const a = o.org62AccountId ? accounts.get(id15(o.org62AccountId)) : undefined;
    if (a && o.accountName && a.name === a.org62AccountId) a.name = o.accountName;
  }

  return {
    accounts: [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    opps: opps.sort((a, b) => a.org62OpportunityId.localeCompare(b.org62OpportunityId)),
    events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.org62EventId.localeCompare(b.org62EventId)),
    eventsWithoutStart,
    dcs: dcs.sort((a, b) => a.org62DcId.localeCompare(b.org62DcId)),
    bookRead: read,
    accountMoves: accountMoves.sort((a, b) => a.org62OpportunityId.localeCompare(b.org62OpportunityId) || a.from.localeCompare(b.from)),
  };
}

/** Opportunities that belong on the Deals page: on an account in my book. */
export function oppsInBook(book: Org62Book): ProjectedOpp[] {
  const ids = new Set(book.accounts.map((a) => id15(a.org62AccountId)));
  return book.opps.filter((o) => o.org62AccountId && ids.has(id15(o.org62AccountId)));
}
