/**
 * Missed opportunities (R-UI-14, Deals ▸ Missed): the deals engine (src/engines/deals) run over what the scanner
 * stored, read only. Pure: the caller loads the Org62 book (projectOrg62) and my evidence rows and writes the
 * findings (`missed_opp_findings`). Claiming and dismissing stay the user's, in the app (drafts only: invariant 1).
 *
 * Trust (north star: Trustworthy): a finding needs a certain "no DC from me". Only two kinds of opp give one:
 *  - opps the daily sweep recorded (`MissedOpp:<id>`: it checked every DC on the opp, scan-org62 §6 step 4);
 *  - open opps in the complete book read without one of my DCs (the read lists every DC of mine on open opps).
 * Every other opp on my accounts is context for the engine (siblings, tokens), never a finding: its DCs were
 * never read whole. Line items come from the sweep's classification; without one, the opp name decides.
 */
import {
  ARCHITECT_ROLE,
  buildFindings,
  isDeadStage,
  type AccountScope,
  type DcRecord,
  type EvidenceSignal,
  type LineItemRecord,
  type LockRule,
  type MissedOppFinding,
  type OppRecord,
} from '@/engines/deals';

import type { Org62Book, ProjectedOpp } from './types';
import { id15 } from './util';

export interface MissedEvidence {
  /** Calendar events (last 180 days) with their mapped opp / account (Org62 ids). */
  calendar: { id: string; title: string; at: string; oppOrg62Id: string | null; accountOrg62Id: string | null; owned: boolean; recurring: boolean; internalOnly: boolean }[];
  /** Drive files I own or edited. */
  drive: { id: string; title: string; at: string | null; owned: boolean; accountOrg62Id: string | null }[];
  /** Claude sessions with their mapped account. */
  sessions: { id: string; title: string; at: string; accountOrg62Id: string | null; hours: number }[];
  /**
   * DC-33: Slack channels I wrote in (my own messages only, the channel's name, never a body), one per channel with
   * how many messages. Absent before D-68.
   */
  slack?: SlackChannelEvidence[];
}

/** One channel's worth of my Slack messages (the last 180 days). */
export interface SlackChannelEvidence {
  /** The channel id. */
  id: string;
  channelName: string;
  /** My newest message there. */
  at: string;
  /** How many messages of mine. */
  messages: number;
  /** The account the channel maps to (Org62 id), when the matcher names one. */
  accountOrg62Id: string | null;
}

/**
 * DC-33, the strong-evidence rule for Slack: a channel counts once I wrote there at least this often, and then only as
 * a weaker signal (`some`): Slack alone makes a Check; with an independent kind (a meeting, a doc, a session) it is a
 * Claim, like any two weaker kinds. A one-off message is never evidence.
 */
export const SLACK_MIN_MESSAGES = 3;

export interface MissedInput {
  book: Org62Book;
  me: { org62UserId: string; name: string };
  evidence: MissedEvidence;
  /** Local YYYY-MM-DD. */
  today: string;
  /** This fiscal quarter (closed-won in it still counts). */
  quarter: { start: string; end: string };
}

export interface MissedResult {
  findings: MissedOppFinding[];
  /** Org62 opp id (15) → the evidence lines the page shows. */
  lines: Map<string, string[]>;
  /** Other architects' DC labels per opp ("Name 100%"). */
  otherDcs: Map<string, string[]>;
  /** Opps the engine weighed, opps that could carry a finding, and accounts in scope. */
  considered: { opps: number; candidates: number; accounts: number };
  /** Org62 opp ids (15) whose DC question is settled by data: a finding there that is new or claimed is resolved. */
  covered: Set<string>;
}

const MS_H = 3_600_000;

/** Fiscal-quarter lock rules (Deadline_to_Update__c): a quarter's DCs lock on the 10th day of the next quarter. */
export function fiscalLockRules(today: string, span = 4): LockRule[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  // first month (1-based) of the fiscal quarter containing today: Feb, May, Aug, Nov
  const fm = ((m + 10) % 12) - (((m + 10) % 12) % 3); // 0 = Feb
  const base = Date.UTC(m === 1 ? y - 1 : y, 1 + fm, 1);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const out: LockRule[] = [];
  for (let k = -span; k <= span; k++) {
    const s = new Date(base);
    const start = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3 * k, 1);
    const next = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3 * (k + 1), 1);
    out.push({ closeFrom: day(start), closeTo: day(next - 86_400_000), deadline: day(next + 9 * 86_400_000) });
  }
  return out;
}

const oppRecord = (o: ProjectedOpp): OppRecord | null =>
  o.org62AccountId
    ? {
        id: id15(o.org62OpportunityId),
        name: o.name,
        accountId: id15(o.org62AccountId),
        accountName: o.accountName ?? '',
        amount: o.amount,
        stageName: o.stage ?? '',
        isClosed: o.isClosed,
        isWon: o.isWon,
        closeDate: o.closeDate ?? '9999-12-31',
        type: o.type,
      }
    : null;

/** The candidate rule above: the opps whose "no DC from me" is known. */
export function isMissedCandidate(o: ProjectedOpp): boolean {
  if (o.myDc) return isDeadStage(o.stage ?? ''); // a stranded DC (dead or duplicate opp)
  return !!o.sweep || o.inBook;
}

const SIGNAL_LINE: Record<string, string> = {
  d360_line: 'D360 product line',
  name_token: 'D360 in the opportunity name',
  flex_only: 'Flex Credits only (Agentforce or D360)',
};

export function missedOpps(input: MissedInput): MissedResult {
  const { book } = input;
  const opps = book.opps.map((o) => ({ o, r: oppRecord(o) })).filter((x): x is { o: ProjectedOpp; r: OppRecord } => !!x.r);
  const byId = new Map(opps.map((x) => [x.r.id, x]));
  const candidates = new Set(opps.filter((x) => isMissedCandidate(x.o)).map((x) => x.r.id));
  const meId = id15(input.me.org62UserId);

  const lineItems: LineItemRecord[] = [];
  const dcs: DcRecord[] = [];
  const otherDcs = new Map<string, string[]>();
  for (const { o, r } of opps) {
    const sw = o.sweep;
    if (sw?.signal === 'd360') {
      const names = sw.products.filter((p) => !/flex/i.test(p));
      const amount = sw.d360Amount ?? o.amount ?? 0;
      const list = names.length ? names : ['Data 360'];
      for (const p of list) lineItems.push({ oppId: r.id, productName: p, totalPrice: amount / list.length });
    } else if (sw?.signal === 'flex_only') {
      lineItems.push({ oppId: r.id, productName: 'Flex Credits', totalPrice: sw.flexAmount ?? o.amount ?? 0 });
    }
    if (o.myDc) dcs.push({ id: `dc:${r.id}`, oppId: r.id, userId: meId, userName: input.me.name, role: o.myDcRole ?? ARCHITECT_ROLE, splitPercent: o.myDcSplit ?? 100 });
    for (const [i, d] of (sw?.otherArchitectDcs ?? []).entries()) {
      dcs.push({ id: `other:${r.id}:${i}`, oppId: r.id, userId: `other:${i}`, userName: d.name, role: ARCHITECT_ROLE, splitPercent: d.split });
      otherDcs.set(r.id, [...(otherDcs.get(r.id) ?? []), `${d.name} ${d.split}%`]);
    }
  }

  // every account in my book is "core" (opp team, my DC, my logged time, or my configured accounts the sweep read)
  const scopes: AccountScope[] = book.accounts.map((a) => ({
    accountId: id15(a.org62AccountId),
    kind: 'core',
    via: a.via.flatMap((v) => (v === 'opp_team' || v === 'dc' || v === 'org62_event' ? [v] : [])),
  }));

  const signals: EvidenceSignal[] = [];
  const eventHours = new Map<string, number>();
  for (const e of book.events) {
    const what = e.whatOrg62Id ? id15(e.whatOrg62Id) : null;
    const hours = e.durationField ?? (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / MS_H;
    signals.push({ id: `org62:${e.org62EventId}`, kind: 'org62_event', text: e.subject ?? '', at: e.startsAt, oppId: what?.startsWith('006') ? what : undefined, accountId: what?.startsWith('001') ? what : undefined, hours });
    if (what?.startsWith('006')) eventHours.set(what, (eventHours.get(what) ?? 0) + hours);
  }
  // the sweep's 180-day aggregate of my logged hours covers Events older than the windowed scans read
  for (const { o, r } of opps) {
    const h = o.sweep?.hours ?? 0;
    const extra = Math.round((h - (eventHours.get(r.id) ?? 0)) * 100) / 100;
    if (extra > 0) signals.push({ id: `sweep:${r.id}`, kind: 'org62_event', text: r.name, at: o.sweep!.at, oppId: r.id, hours: extra });
  }
  for (const c of input.evidence.calendar) {
    signals.push({ id: `cal:${c.id}`, kind: 'calendar', text: c.title, at: c.at, oppId: c.oppOrg62Id ? id15(c.oppOrg62Id) : undefined, accountId: c.accountOrg62Id ? id15(c.accountOrg62Id) : undefined, owned: c.owned, recurring: c.recurring, internalOnly: c.internalOnly });
  }
  for (const d of input.evidence.drive) signals.push({ id: `drive:${d.id}`, kind: 'drive', text: d.title, at: d.at ?? undefined, accountId: d.accountOrg62Id ? id15(d.accountOrg62Id) : undefined, owned: d.owned });
  for (const s of input.evidence.sessions) signals.push({ id: `claude:${s.id}`, kind: 'claude_session', text: s.title, at: s.at, accountId: s.accountOrg62Id ? id15(s.accountOrg62Id) : undefined, accountCount: 1, hours: s.hours });
  // DC-33: a channel I really work in, by its name (the opp's distinctive words), only ever a weaker signal
  for (const c of input.evidence.slack ?? []) {
    if (c.messages < SLACK_MIN_MESSAGES || !c.channelName.trim()) continue;
    signals.push({ id: `slack:${c.id}`, kind: 'slack', text: c.channelName.replace(/[-_.]+/g, ' '), at: c.at, accountId: c.accountOrg62Id ? id15(c.accountOrg62Id) : undefined, verdict: 'some' });
  }

  const all = buildFindings({
    me: { userId: meId, name: input.me.name },
    today: input.today,
    window: input.quarter,
    opps: opps.map((x) => x.r),
    lineItems,
    dcs,
    scopes,
    signals,
    lockRules: fiscalLockRules(input.today),
  });
  const findings = all.filter((f) => candidates.has(f.opportunityId) && f.verdict !== 'skip' && f.tier !== 'already_covered');

  const lines = new Map<string, string[]>();
  for (const f of findings) {
    const o = byId.get(f.opportunityId)!.o;
    const out: string[] = [];
    if (f.tier === 'stranded_dc') out.push(f.evidenceSummary);
    else {
      out.push(SIGNAL_LINE[f.signal] ?? 'D360 signal');
      out.push(o.onMyTeam ? `On your opp team${o.myTeamRole ? ` (${o.myTeamRole})` : ''}, no DC from you` : 'Your account, no DC from you');
      if (o.isClosed && o.isWon) out.push(`Closed won ${o.closeDate ?? ''}`.trim());
      for (const r of f.reasons.slice(0, 3)) out.push(r.text);
      if (f.splitNote) out.push(f.splitNote);
      if (f.lock.locked) out.push(`DC lock passed on ${f.lock.deadline}: needs a manager exception`);
      else if (f.lock.deadline) out.push(`DC lock on ${f.lock.deadline}`);
    }
    lines.set(f.opportunityId, out.slice(0, 7));
  }
  const covered = new Set(opps.filter((x) => x.o.myDc && !isDeadStage(x.o.stage ?? '')).map((x) => x.r.id));
  return { findings, lines, otherDcs, considered: { opps: opps.length, candidates: candidates.size, accounts: scopes.length }, covered };
}
