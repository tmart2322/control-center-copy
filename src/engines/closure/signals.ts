/**
 * Adapters from stored rows to closure-machine inputs (BE-REEVAL). Pure: the data layer reads the rows,
 * these turn them into `Signal`s, `ChangeKind`s and `ClosureSettings`.
 *
 * Scanner evidence (`work_item_evidence`: role + confidence + reason) is the main input. The scanner emits
 * signals and never sets state (SCANNER.md §3); its skills encode the finer meaning in a reason prefix:
 *
 *   origin        `loop_back: <who> asked you directly`       → loop_back (normalizeSignal, SCANNER.md §4.5)
 *   contradiction `requirements_change: <delta>`              → requirements_change (reopen vs sibling, R-UI-20)
 *   completion    from Drive / `drive_judge: verdict=done …`  → drive_digest "updates made" (Drive alone never closes)
 *   progress      from Drive / `drive_judge: verdict=partial` → drive_digest partial (other verdicts: an edit)
 *   anything else                                              → evidence with its role and confidence
 *
 * Context reasons (`requirements_update:`, `handoff:`, `cancelled:` …) stay context: they never move status.
 */
import type {
  ChangeKind,
  ClosureSettings,
  Confidence,
  EvidenceRole,
  PersonLite,
  Signal,
  SignalSource,
} from '@/engines/types';
import { CLOSURE_SETTING_KEYS, DEFAULT_CLOSURE_SETTINGS } from '@/engines/types';

import { normalizeSignal } from './machine';

/** One `work_item_evidence` row joined with its source item, as the adapter needs it. */
export interface EvidenceLink {
  id: string;
  role: EvidenceRole;
  confidence: Confidence;
  /** `work_item_evidence.rationale`: the scanner's reason, with its prefix. */
  reason: string | null;
  /** When it happened: the source item's `occurred_at`, else when it was linked. */
  at: string;
  /** `work_item_evidence.created_at`. */
  linkedAt: string;
  source?: SignalSource;
  /** Who said or did it. `id` only when it is a real `people` row. */
  actor?: PersonLite;
  /** Drive file / asset the evidence is about (drive digests). */
  fileRef?: string | null;
}

export const REASON_PREFIXES = {
  loopBack: 'loop_back',
  requirementsChange: 'requirements_change',
  driveJudge: 'drive_judge',
  /** The completion pass (src/scanner/completion): its prefix is bookkeeping, never shown to the user. */
  doneCheck: 'done_check',
} as const;

/** `"requirements_change: add a pricing slide"` → `{prefix: 'requirements_change', text: 'add a pricing slide'}`. */
export function parseReason(reason: string | null | undefined): { prefix: string | null; text: string } {
  const r = (reason ?? '').trim();
  const m = /^([a-z][a-z0-9_]*):\s*([\s\S]*)$/i.exec(r);
  return m ? { prefix: m[1]!.toLowerCase(), text: m[2]!.trim() } : { prefix: null, text: r };
}

/** `drive_judge: verdict=partial; confidence=0.8; …` → `partial`. */
function driveVerdict(text: string): string | null {
  return /(?:^|;)\s*verdict\s*=\s*([a-z_]+)/i.exec(text)?.[1]?.toLowerCase() ?? null;
}

function base(e: EvidenceLink) {
  return {
    evidenceId: e.id,
    at: e.at,
    ...(e.source ? { source: e.source } : {}),
    ...(e.actor ? { actor: e.actor } : {}),
  };
}

/** One evidence row → the machine's signal. */
export function signalFromEvidence(e: EvidenceLink): Signal {
  const { prefix, text } = parseReason(e.reason);
  if (e.role === 'contradiction' && prefix === REASON_PREFIXES.requirementsChange) {
    return { type: 'requirements_change', ...base(e), confidence: e.confidence, summary: text || 'New requirement', reason: text || 'new requirement' };
  }
  const fromDrive = e.source === 'drive' || prefix === REASON_PREFIXES.driveJudge;
  if (fromDrive && (e.role === 'completion' || e.role === 'progress')) {
    const verdict = prefix === REASON_PREFIXES.driveJudge ? driveVerdict(text) : null;
    const updatesMade = e.role === 'completion' ? 'yes' : verdict === 'partial' ? 'partial' : 'unknown';
    return {
      type: 'drive_digest',
      ...base(e),
      fileId: e.fileRef ?? e.id,
      updatesMade,
      editedByMe: e.actor?.isMe === true,
      ...(e.actor && !e.actor.isMe ? { editorName: e.actor.name } : {}),
    };
  }
  // done_check: is stripped (the label would read "Done by you: done_check: …"); loop_back: stays for normalizeSignal
  const raw = prefix === REASON_PREFIXES.doneCheck ? text : e.reason?.trim();
  const reason = raw ? raw : undefined;
  // normalizeSignal turns `loop_back:` origins into loop_back signals (the machine does it again, idempotently)
  return normalizeSignal({ type: 'evidence', ...base(e), role: e.role, confidence: e.confidence, ...(reason ? { reason } : {}) });
}

/** What changed, for the re-eval planner (planReeval). */
export function changeKindOf(s: Signal): ChangeKind {
  switch (s.type) {
    case 'evidence':
      return `evidence_${s.role}`;
    case 'requirements_change':
      return 'requirements_change';
    case 'loop_back':
      return 'loop_back';
    case 'session':
      return 'session_status';
    case 'drive_digest':
      return 'drive_digest';
    case 'reply':
      return 'reply';
    case 'email_sent':
      return 'email_sent';
    case 'timer':
      return 'timer';
  }
}

/**
 * `user_settings` values (keyed by CLOSURE_SETTING_KEYS) → ClosureSettings. Missing or malformed values
 * fall back to the ENGINES §3 defaults (reopen window 14 days, Sure auto-closes).
 */
export function closureSettingsFrom(values: Record<string, unknown>): ClosureSettings {
  const d = DEFAULT_CLOSURE_SETTINGS;
  const unwrap = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? (v as { value: unknown }).value : v);
  const num = (v: unknown, dflt: number) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 365 ? n : dflt;
  };
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : dflt);
  const inv = unwrap(values[CLOSURE_SETTING_KEYS.handoffInvolvement]);
  return {
    reopenWindowDays: num(unwrap(values[CLOSURE_SETTING_KEYS.reopenWindowDays]), d.reopenWindowDays),
    autoCloseSure: bool(unwrap(values[CLOSURE_SETTING_KEYS.autoCloseSure]), d.autoCloseSure),
    snoozeWakeOnNewInfo: bool(unwrap(values[CLOSURE_SETTING_KEYS.snoozeWakeOnNewInfo]), d.snoozeWakeOnNewInfo),
    handoffInvolvement: inv === 'watcher' || inv === 'not_involved' ? inv : d.handoffInvolvement,
  };
}
