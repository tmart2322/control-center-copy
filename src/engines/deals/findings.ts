/**
 * Missed-opp findings: candidate set -> classifier -> evidence narrowing -> split / lock / stranded
 * awareness -> suggested actions. Pure; the caller supplies the Org62 mirror and the user's signals.
 */
import { DEFAULT_MIN_AMOUNT, classifyLineItems, isDeadStage, isDuplicateStage, isRenewal, passesThreshold } from './classify';
import { narrowEvidence, tokenize } from './evidence';
import {
  ARCHITECT_ROLE,
  DISMISS_REASONS,
  type AccountScope,
  type AccountVia,
  type ClaimTask,
  type DcRecord,
  type EvidenceSignal,
  type LineItemRecord,
  type LockInfo,
  type MissedOppFinding,
  type MissedOppTier,
  type OppRecord,
  type SuggestedAction,
} from './types';

export interface Me {
  userId: string;
  name: string;
  role?: string; // default AI + Data Architect
}

export interface LockRule {
  /** Opps closing in [closeFrom, closeTo] lock after `deadline`. Used when an opp has no Deadline_to_Update__c. */
  closeFrom: string;
  closeTo: string;
  deadline: string;
}

export interface FindingsInput {
  me: Me;
  /** Manager to address the exception note to (placeholder-friendly). */
  managerName?: string;
  today: string; // YYYY-MM-DD
  window: { start: string; end: string }; // this quarter, for "closed this quarter"
  minAmount?: number;
  opps: readonly OppRecord[];
  lineItems: readonly LineItemRecord[];
  dcs: readonly DcRecord[];
  scopes: readonly AccountScope[];
  /** All evidence signals, any account. Narrowing picks the ones tied to each opp. */
  signals: readonly EvidenceSignal[];
  lockRules?: readonly LockRule[];
  extraStopwords?: readonly string[];
  /** Emit already_covered rows too (default false). */
  includeCovered?: boolean;
}

/** Derive "accounts I've been part of" from the opp team, my DCs, Org62 events and calendar hits. */
export function deriveAccountScopes(a: {
  opps: readonly OppRecord[];
  oppTeamOppIds: readonly string[];
  myDcs: readonly DcRecord[];
  org62EventOppIds: readonly string[];
  org62EventAccountIds?: readonly string[];
  calendarAccountIds?: readonly string[];
  siblingAccountIds?: readonly string[];
}): AccountScope[] {
  const acct = new Map(a.opps.map((o) => [o.id, o.accountId]));
  const m = new Map<string, Set<AccountVia>>();
  const mark = (accountId: string | undefined, via: AccountVia) => {
    if (!accountId) return;
    let s = m.get(accountId);
    if (!s) m.set(accountId, (s = new Set()));
    s.add(via);
  };
  for (const id of a.oppTeamOppIds) mark(acct.get(id), 'opp_team');
  for (const d of a.myDcs) mark(acct.get(d.oppId), 'dc');
  for (const id of a.org62EventOppIds) mark(acct.get(id), 'org62_event');
  for (const id of a.org62EventAccountIds ?? []) mark(id, 'org62_event');
  for (const id of a.calendarAccountIds ?? []) mark(id, 'calendar');
  for (const id of a.siblingAccountIds ?? []) mark(id, 'sibling');
  return [...m].map(([accountId, via]) => ({
    accountId,
    via: [...via].sort(),
    kind: via.has('opp_team') || via.has('dc') || via.has('org62_event') ? ('core' as const) : ('light' as const),
  }));
}

export function lockFor(opp: OppRecord, today: string, rules: readonly LockRule[] = [], managerName = 'your manager', me?: Me): LockInfo {
  const deadline = opp.deadlineToUpdate ?? rules.find((r) => opp.closeDate >= r.closeFrom && opp.closeDate <= r.closeTo)?.deadline ?? null;
  const locked = !!deadline && today > deadline;
  return {
    deadline,
    locked,
    managerExceptionNeeded: locked,
    noteDraft: locked
      ? `Hi ${managerName}, the Deal Contribution lock for "${opp.name}" (${opp.accountName}) passed on ${deadline}. ` +
        `I did the solution work on it${me ? ` as ${me.role ?? ARCHITECT_ROLE}` : ''} and would like a manager exception (Manager Exception Reason) to add my DC. ` +
        'Evidence is attached in the finding. Could you add it or approve the exception?'
      : null,
  };
}

export function claimPrompt(opp: OppRecord, me: Me, split: number, note: string | null, existingDcId?: string | null): string {
  const role = me.role ?? ARCHITECT_ROLE;
  return [
    `Run the DC Comment Upload skill with the attached CSV from my ${opp.accountName} VDP.`,
    `Opportunity: ${opp.id} (${opp.name}, closes ${opp.closeDate}).`,
    `Contributor: me, ${me.name} (${me.userId}). Role: ${role}. Split: ${split}%${note ? ` (${note})` : ''}.`,
    existingDcId ? `I already have Deal Contribution ${existingDcId} on this opportunity; update it instead of creating a duplicate.` : "Do not change anyone else's record. Create only my DC.",
    'Show me the record and the exact fields you will write, and wait for my "yes" before saving.',
  ].join('\n');
}

function splitAdvice(others: readonly DcRecord[]): { note: string | null; suggested: number } {
  if (!others.length) return { note: null, suggested: 100 };
  const total = others.reduce((s, d) => s + d.splitPercent, 0);
  const who = others.map((d) => `${d.userName ?? 'another SE'} ${d.splitPercent}%`).join(', ');
  if (total >= 100) return { note: `Split, not a second 100%: ${who} already hold ${ARCHITECT_ROLE}. Agree a split (50/50) with them first.`, suggested: 50 };
  return { note: `Split, not a second 100%: ${who} already hold ${ARCHITECT_ROLE}. Only ${100 - total}% is left.`, suggested: 100 - total };
}

const TIER_ORDER: MissedOppTier[] = ['won_no_dc', 'strong_evidence_no_dc', 'stranded_dc', 'core_account_no_dc', 'core_account_flex_only', 'renewal', 'light_touch', 'light_touch_flex_only', 'already_covered'];

export function buildFindings(input: FindingsInput): MissedOppFinding[] {
  const role = input.me.role ?? ARCHITECT_ROLE;
  const min = input.minAmount ?? DEFAULT_MIN_AMOUNT;
  const scopeBy = new Map(input.scopes.map((s) => [s.accountId, s]));
  const oppById = new Map(input.opps.map((o) => [o.id, o]));
  const linesBy = new Map<string, LineItemRecord[]>();
  for (const l of input.lineItems) linesBy.set(l.oppId, [...(linesBy.get(l.oppId) ?? []), l]);
  const dcsBy = new Map<string, DcRecord[]>();
  for (const d of input.dcs) dcsBy.set(d.oppId, [...(dcsBy.get(d.oppId) ?? []), d]);
  const byAccount = new Map<string, OppRecord[]>();
  for (const o of input.opps) byAccount.set(o.accountId, [...(byAccount.get(o.accountId) ?? []), o]);

  const dismiss: SuggestedAction = { kind: 'dismiss', label: 'Dismiss with reason', requiresReason: true, reasons: [...DISMISS_REASONS] };
  const out: MissedOppFinding[] = [];

  for (const opp of input.opps) {
    const scope = scopeBy.get(opp.accountId);
    if (!scope) continue; // not an account he has been part of
    const dcs = dcsBy.get(opp.id) ?? [];
    const mine = dcs.find((d) => d.userId === input.me.userId);
    const others = dcs.filter((d) => d.userId !== input.me.userId && d.role === role);
    const cls = classifyLineItems(opp, linesBy.get(opp.id) ?? []);
    const lock = lockFor(opp, input.today, input.lockRules, input.managerName, input.me);

    // DC hygiene: my DC on a dead or duplicate opp is stranded.
    if (mine && isDeadStage(opp.stageName)) {
      const dup = isDuplicateStage(opp.stageName);
      const dtoks = new Set(tokenize(opp.name));
      const targets = (byAccount.get(opp.accountId) ?? [])
        .filter((o) => o.id !== opp.id && !isDeadStage(o.stageName) && (!o.isClosed || o.isWon) && !(dcsBy.get(o.id) ?? []).some((d) => d.userId === input.me.userId))
        .map((o) => ({ o, sim: tokenize(o.name).filter((t) => dtoks.has(t)).length }))
        .sort((a, b) => b.sim - a.sim || (b.o.amount ?? 0) - (a.o.amount ?? 0))
        .slice(0, 5);
      out.push({
        opportunityId: opp.id,
        accountId: opp.accountId,
        tier: 'stranded_dc',
        verdict: dup ? 'check' : 'skip',
        evidenceStrength: 'none',
        signal: cls.signal,
        hasD360Line: cls.hasD360Line,
        d360LineAmount: cls.d360LineAmount,
        flexLineAmount: cls.flexLineAmount,
        myOrg62Hours: 0,
        myDcExists: true,
        otherArchitectDcCount: others.length,
        strandedDcId: mine.id,
        evidenceSummary: dup ? 'my DC sits on a duplicate opp: move it to the surviving opp' : 'my DC sits on a lost opp: nothing to recover',
        reasons: [],
        evidenceIds: [],
        splitNote: null,
        suggestedSplit: mine.splitPercent,
        lock,
        actions: dup
          ? [
              {
                kind: 'move_dc',
                label: 'Ask the AE which opp it merged into',
                candidateOppIds: targets.map((t) => t.o.id),
                noteDraft: `Hi, my Deal Contribution is on "${opp.name}", which is now ${opp.stageName}. Which opportunity did it merge into? I'd like to move my DC there.`,
              },
              dismiss,
            ]
          : [dismiss],
      });
      continue;
    }

    if (mine) {
      if (input.includeCovered)
        out.push(rowFor(opp, cls, 'already_covered', 'skip', { strength: 'none', reasons: [], evidenceIds: [], myOrg62Hours: 0, summary: 'I already have a DC' }, true, others.length, null, null, lock, 100, [dismiss]));
      continue;
    }
    if (!passesThreshold(opp, { minAmount: min, windowStart: input.window.start, windowEnd: input.window.end })) continue;
    if (cls.signal === 'none') continue;

    const siblings = (byAccount.get(opp.accountId) ?? []).map((o) => ({ id: o.id, name: o.name }));
    const narrowed = narrowEvidence(opp, input.signals, { siblings, extraStopwords: input.extraStopwords });
    const core = scope.kind === 'core';
    const flexOnly = cls.signal === 'flex_only';

    let tier: MissedOppTier;
    if (opp.isClosed && opp.isWon) tier = 'won_no_dc';
    else if (narrowed.strength === 'strong') tier = 'strong_evidence_no_dc';
    else if (isRenewal(opp)) tier = 'renewal';
    else if (core) tier = flexOnly ? 'core_account_flex_only' : 'core_account_no_dc';
    else tier = flexOnly ? 'light_touch_flex_only' : 'light_touch';

    let verdict = narrowed.verdict;
    let summary = narrowed.summary;
    if (tier === 'won_no_dc' && verdict === 'skip' && core) {
      verdict = 'check';
      summary = 'closed-won on a core account: confirm you did no work on it';
    }
    const split = splitAdvice(others);
    const actions: SuggestedAction[] = [];
    if (verdict !== 'skip') {
      const task: ClaimTask = {
        title: `Add my DC: ${opp.name}`,
        opportunityId: opp.id,
        role,
        splitPercent: split.suggested,
        slackbotPromptDraft: claimPrompt(opp, input.me, split.suggested, split.note ? 'share with the existing holder' : null),
      };
      actions.push({ kind: 'claim', label: lock.locked ? 'Claim (needs manager exception)' : 'Claim: add a DC request', task });
      if (lock.noteDraft) actions.push({ kind: 'request_exception', label: 'Draft manager-exception note', noteDraft: lock.noteDraft });
    }
    actions.push(dismiss);
    out.push(rowFor(opp, cls, tier, verdict, { ...narrowed, summary }, false, others.length, split.note, null, lock, split.suggested, actions));
  }

  return out.sort(
    (a, b) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      (oppById.get(b.opportunityId)?.amount ?? 0) - (oppById.get(a.opportunityId)?.amount ?? 0) ||
      a.opportunityId.localeCompare(b.opportunityId),
  );
}

function rowFor(
  opp: OppRecord,
  cls: ReturnType<typeof classifyLineItems>,
  tier: MissedOppTier,
  verdict: MissedOppFinding['verdict'],
  n: Pick<ReturnType<typeof narrowEvidence>, 'strength' | 'reasons' | 'evidenceIds' | 'myOrg62Hours' | 'summary'>,
  myDc: boolean,
  otherCount: number,
  splitNote: string | null,
  stranded: string | null,
  lock: LockInfo,
  suggestedSplit: number,
  actions: SuggestedAction[],
): MissedOppFinding {
  return {
    opportunityId: opp.id,
    accountId: opp.accountId,
    tier,
    verdict,
    evidenceStrength: n.strength,
    signal: cls.signal,
    hasD360Line: cls.hasD360Line,
    d360LineAmount: cls.d360LineAmount,
    flexLineAmount: cls.flexLineAmount,
    myOrg62Hours: n.myOrg62Hours,
    myDcExists: myDc,
    otherArchitectDcCount: otherCount,
    strandedDcId: stranded,
    evidenceSummary: n.summary,
    reasons: n.reasons,
    evidenceIds: n.evidenceIds,
    splitNote,
    suggestedSplit,
    lock,
    actions,
  };
}
