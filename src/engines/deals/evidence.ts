/**
 * Evidence narrowing to Claim / Check, with reasons (the D360 sweep method).
 *
 * "Being on the account isn't enough": a signal only counts when it is tied to THAT initiative,
 * through an explicit opp link or through a name token that distinguishes the opp from its siblings.
 *
 * Noise rules the sweep found:
 *  - generic-word stopwords (data, cloud, flex, credits, expansion, ...) never identify an opp;
 *    tokens shared by most opps on the account are generic too;
 *  - multi-account Claude sessions only count with a distinguishing token;
 *  - false calendar matches: unaccepted, recurring internal, or account-only hits are ignored.
 */
import type { EvidenceReason, EvidenceSignal, IgnoredEvidence, MissedOppVerdict, NarrowResult, OppRecord } from './types';

export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'data cloud 360 d360 data360 dc flex credit credits expansion expand phase upside upsell renewal early new business ' +
    'agentforce agentic ai platform salesforce sf services service support health healthcare group inc llc corp corporation company ' +
    'the and for with of to in on a an add ons addons pilot poc commit precommit pre motion transformation fy27 fy26 fy28 ' +
    'q1 q2 q3 q4 sales marketing customer account opp opportunity project program initiative growth nb run rate update ' +
    'meeting call sync team weekly prep review discussion internal int hold'
  ).split(' '),
);

/** Tokens that match but are ambiguous across customers: they can only ever make a "some" signal. */
export const AMBIGUOUS_TOKENS: ReadonlySet<string> = new Set(['ace']);

export const tokenize = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9&]+/g) ?? []).filter((t) => t.length > 2 && !/^\d+$/.test(t));

export interface NarrowOptions {
  extraStopwords?: readonly string[];
  /** Account-mates (all opps on the same account) to detect tokens that do not distinguish this opp. */
  siblings?: readonly Pick<OppRecord, 'id' | 'name'>[];
}

/** Distinguishing tokens of an opp name: not a stopword, not the account's own name, not shared widely. */
export function distinctiveTokens(opp: Pick<OppRecord, 'name' | 'accountName'>, o: NarrowOptions = {}): string[] {
  const extra = new Set((o.extraStopwords ?? []).map((s) => s.toLowerCase()));
  const acct = new Set(tokenize(opp.accountName));
  const sibs = (o.siblings ?? []).map((s) => new Set(tokenize(s.name)));
  const n = sibs.length;
  return [...new Set(tokenize(opp.name))].filter((t) => {
    if (STOPWORDS.has(t) || extra.has(t) || acct.has(t)) return false;
    if (n >= 3) {
      const df = sibs.filter((s) => s.has(t)).length;
      if (df > Math.max(1, Math.floor(n / 2))) return false; // shared by most account-mates: generic here
    }
    return true;
  });
}

const DELIVERABLE = /deck|demo|estimat|model|sizing|calculator|pov|architecture|diagram|workshop|scoping|bvs|roi|poc/i;
const INTERNAL_CADENCE = /weekly|team meeting|1:1|stand-?up|office hours|all hands|forecast|catch up|bi-weekly/i;

export function narrowEvidence(
  opp: Pick<OppRecord, 'id' | 'name' | 'accountId' | 'accountName'>,
  signals: readonly EvidenceSignal[],
  o: NarrowOptions = {},
): NarrowResult {
  const dtoks = distinctiveTokens(opp, o);
  const dset = new Set(dtoks);
  const singleOpp = !!o.siblings && o.siblings.filter((s) => s.id !== opp.id).length === 0;
  const reasons: EvidenceReason[] = [];
  const ignored: IgnoredEvidence[] = [];
  let myHours = 0;

  const add = (s: EvidenceSignal, weight: 'strong' | 'some', text: string) => reasons.push({ evidenceId: s.id, kind: s.kind, weight, text });

  for (const s of signals) {
    // Attributed to a different opp explicitly: not this one.
    if (s.oppId && s.oppId !== opp.id) {
      ignored.push({ evidenceId: s.id, why: 'linked to a different opp' });
      continue;
    }
    const linked = s.oppId === opp.id;
    const matched = tokenize(s.text).filter((t) => dset.has(t));
    const strongTok = matched.filter((t) => !AMBIGUOUS_TOKENS.has(t));
    const accountOnly = !linked && matched.length === 0 && (s.accountId === opp.accountId || tokenize(s.text).some((t) => tokenize(opp.accountName).includes(t)));
    // A single-opp account makes an account-level hit unambiguous.
    const textLinked = linked || matched.length > 0 || (singleOpp && accountOnly);
    if (!textLinked) {
      ignored.push({ evidenceId: s.id, why: accountOnly ? 'account-level only, not this opp' : 'no distinguishing token' });
      continue;
    }
    const tokNote = linked ? 'linked to this opp' : matched.length ? `matches '${matched[0]}'` : 'only opp on the account';
    const ambiguousOnly = !linked && matched.length > 0 && strongTok.length === 0;

    switch (s.kind) {
      case 'org62_event': {
        const h = s.hours ?? 0;
        if (linked) myHours += h;
        add(s, h >= 1 ? 'strong' : 'some', `Org62 event ${h.toFixed(1)}h (${tokNote})`);
        break;
      }
      case 'calendar': {
        if (s.owned === false) ignored.push({ evidenceId: s.id, why: 'invite not accepted / not attended' });
        else if ((s.recurring || s.internalOnly) && INTERNAL_CADENCE.test(s.text) && !linked) ignored.push({ evidenceId: s.id, why: 'recurring internal cadence, false calendar match' });
        else add(s, 'some', `calendar meeting (${tokNote})`);
        break;
      }
      case 'drive': {
        if (!s.owned) ignored.push({ evidenceId: s.id, why: 'file not owned/edited by you' });
        else add(s, DELIVERABLE.test(s.text) && !ambiguousOnly ? 'strong' : 'some', `your doc '${s.text.slice(0, 60)}' (${tokNote})`);
        break;
      }
      case 'gemini_notes':
        add(s, 'some', `meeting notes '${s.text.slice(0, 60)}' (${tokNote})`);
        break;
      case 'slack':
        if (!s.verdict) ignored.push({ evidenceId: s.id, why: 'Slack thread has no verdict' });
        // DC-33: a channel of another account never counts for this one (strong evidence only)
        else if (s.accountId && s.accountId !== opp.accountId && !linked) ignored.push({ evidenceId: s.id, why: 'Slack channel of another account' });
        else add(s, ambiguousOnly ? 'some' : s.verdict, `Slack ${s.verdict === 'some' ? 'channel you work in' : s.verdict} (${tokNote})`);
        break;
      case 'claude_session': {
        const multi = (s.accountCount ?? 1) > 1;
        if (multi && !linked && matched.length === 0) ignored.push({ evidenceId: s.id, why: 'multi-account session without a distinguishing token' });
        else {
          const h = s.hours ?? 0;
          add(s, !multi && !ambiguousOnly && h >= 1 ? 'strong' : 'some', `Claude session ${h.toFixed(1)}h${multi ? ' (multi-account)' : ''} (${tokNote})`);
        }
        break;
      }
    }
  }

  const strongN = reasons.filter((r) => r.weight === 'strong').length;
  const someKinds = new Set(reasons.filter((r) => r.weight === 'some').map((r) => r.kind));
  // One strong signal, or two independent kinds of weaker signal, is "strong"; one weaker signal is "some".
  const strength = strongN > 0 || someKinds.size >= 2 ? 'strong' : reasons.length > 0 ? 'some' : 'none';
  const verdict: MissedOppVerdict = strength === 'strong' ? 'claim' : strength === 'some' ? 'check' : 'skip';
  return {
    strength,
    verdict,
    reasons,
    ignored,
    evidenceIds: [...new Set(reasons.map((r) => r.evidenceId))],
    myOrg62Hours: Math.round(myHours * 100) / 100,
    summary: reasons.length ? reasons.map((r) => r.text).join('; ') : 'no evidence tied to this opp',
  };
}
