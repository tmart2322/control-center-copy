/**
 * Missed-opp logic (R-UI-14), pure. The contract carries `evidence: string[]` and `otherDcs: string[]`
 * only, so the split, lock and stranded-DC notes are derived here from those plus the close date and stage.
 * (TODO(contract): structured `lockDeadline`, `strandedDc`, `splitPct` would replace the heuristics.)
 */
import type { MissedOpp, SourceKind } from '@/contract';
import { daysUntil, fmtAmount, fmtDate } from './format';

export type VerdictFilter = 'all' | 'claim' | 'check';
export type StageFilter = 'all' | 'open' | 'closed';
export type ScopeFilter = 'review' | 'handled' | 'all';

export interface MissedFilters {
  verdict: VerdictFilter;
  stage: StageFilter;
  /** Minimum amount in dollars (0 = any). */
  minAmount: number;
  scope: ScopeFilter;
}

export const DEFAULT_FILTERS: MissedFilters = { verdict: 'all', stage: 'all', minAmount: 0, scope: 'review' };

export const AMOUNT_STEPS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Any amount' },
  { value: 100_000, label: '$100k +' },
  { value: 250_000, label: '$250k +' },
  { value: 500_000, label: '$500k +' },
  { value: 1_000_000, label: '$1M +' },
];

export const DISMISS_REASONS = ['Not my deal', 'Already covered', 'Wrong opportunity', 'Duplicate or dead opp', 'Too small to claim'] as const;

export function isClosedStage(stage: string): boolean {
  return /closed|won|lost/i.test(stage) && !/open/i.test(stage);
}

/** Rows still to review, plus rows the user acted on this session (so nothing moves under the cursor). */
export function filterMissed(list: MissedOpp[], f: MissedFilters, touched: ReadonlySet<string> = new Set()): MissedOpp[] {
  return list.filter((m) => {
    if (f.verdict !== 'all' && m.verdict !== f.verdict) return false;
    const closed = isClosedStage(m.stage);
    if (f.stage === 'open' && closed) return false;
    if (f.stage === 'closed' && !closed) return false;
    if (f.minAmount > 0 && (m.amount ?? 0) < f.minAmount) return false;
    const handled = m.status !== 'new';
    if (f.scope === 'review' && handled && !touched.has(m.id)) return false;
    if (f.scope === 'handled' && !handled) return false;
    return true;
  });
}

/**
 * The DC update deadline for an opp closing on `closeDate`: the 3rd of the month after the fiscal quarter
 * (Aug–Oct, Nov–Jan, Feb–Apr, May–Jul) that contains the close. Observed from Deadline_to_Update__c:
 * Aug–Oct closes lock 2026-11-03, Nov–Jan closes lock 2027-02-03.
 */
export function dcLockDeadline(closeDate: string): string {
  const y = Number(closeDate.slice(0, 4));
  const mo = Number(closeDate.slice(5, 7));
  let year = y;
  let month: number;
  if (mo >= 8 && mo <= 10) month = 11;
  else if (mo === 11 || mo === 12) {
    month = 2;
    year = y + 1;
  } else if (mo === 1) month = 2;
  else if (mo >= 2 && mo <= 4) month = 5;
  else month = 8;
  return `${year}-${String(month).padStart(2, '0')}-03`;
}

export interface MissedNotes {
  /** Other DCs share the split: "not a second 100%". */
  split: string | null;
  /** Past the update deadline: a manager exception is needed. */
  lock: string | null;
  /** Soft heads-up when the deadline is close. */
  lockSoon: string | null;
  /** Hygiene flag: my DC sits on a dead or duplicate opp. */
  stranded: string | null;
}

export function missedNotes(m: Pick<MissedOpp, 'otherDcs' | 'closeDate' | 'stage' | 'evidence'>, today: string): MissedNotes {
  let lock: string | null = null;
  let lockSoon: string | null = null;
  if (m.closeDate) {
    const deadline = dcLockDeadline(m.closeDate);
    const n = daysUntil(deadline, today);
    if (n < 0) lock = `Locked since ${fmtDate(deadline)}: adding a DC needs a manager exception.`;
    else if (n <= 14) lockSoon = `DCs on this close lock ${fmtDate(deadline)} (${n === 0 ? 'today' : `in ${n}d`}).`;
  }
  const split = m.otherDcs.length
    ? `${m.otherDcs.join(', ')} already ${m.otherDcs.length === 1 ? 'holds a DC' : 'hold DCs'} here. Your split is shared, not a second 100%.`
    : null;
  const strandedText = [m.stage, ...m.evidence].join(' ');
  const stranded = /stranded|dead\b|duplicate/i.test(strandedText)
    ? 'Stranded DC: my DC sits on a dead or duplicate opp. Ask the AE where it merged and move the DC there.'
    : null;
  return { split, lock, lockSoon, stranded };
}

/** Map an evidence string to a source chip ("Slack some…" → Slack, "calendar 3 mtgs" → Calendar). */
export function evidenceChip(e: string): { source: SourceKind; label: string } {
  const s = e.toLowerCase();
  let source: SourceKind = 'manual';
  if (/slack|group dm|\bdm\b|#[a-z0-9-]+/.test(s)) source = 'slack';
  else if (/calendar|mtgs?|meeting/.test(s)) source = 'calendar';
  else if (/gemini/.test(s)) source = 'gemini';
  else if (/deck|doc\b|sheet|slides|drive|estimator/.test(s)) source = 'drive';
  else if (/gmail|email/.test(s)) source = 'gmail';
  else if (/org62|dc\b|account|sku|product|opp|events/.test(s)) source = 'org62';
  return { source, label: e };
}

/** The Slackbot "DC Comment Upload" prompt (draft only: the user pastes it themselves). */
export function dcPromptDraft(m: Pick<MissedOpp, 'oppName' | 'oppId' | 'accountName' | 'amount' | 'stage' | 'closeDate' | 'evidence' | 'otherDcs'>): string {
  const shared = m.otherDcs.length > 0;
  const lines = [
    'Run the DC Comment Upload skill for me.',
    '',
    `Opportunity: ${m.oppName}${m.oppId ? ` (${m.oppId})` : ''}`,
    `Account: ${m.accountName}`,
    `Stage / amount / close: ${m.stage} / ${fmtAmount(m.amount)} / ${fmtDate(m.closeDate)}`,
    'Role: AI + Data Architect',
    'Contributor: me',
    shared ? `Split: 50% (shared with ${m.otherDcs.join(', ')}; not a second 100%, please confirm)` : 'Split: 100%',
    '',
    'Comments:',
    ...m.evidence.slice(0, 4).map((e) => `- ${e}`),
    '- VDP link: [paste the VDP link here]',
  ];
  return lines.join('\n');
}
