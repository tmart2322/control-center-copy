/**
 * Closure engine outputs. A decision is a pure description of what the data layer should write
 * inside one `engine_pass` change set: a `work_item_transitions` row, field updates, `change_proposals`
 * rows (user-locked fields), a sibling item + `reopen_decisions` row, and the run state.
 */
import type {
  ClosureItem,
  Confidence,
  EvidenceRole,
  Involvement,
  Resolution,
  ResolutionDetail,
  RunState,
  WorkItemKind,
  WorkItemStatus,
} from '@/engines/types';

/**
 * transition: the status moves (plus side fields).
 * update:     side fields only (waiting reason, involvement), no status move.
 * proposal:   an engine change hit a user-locked field: nothing is written, the user sees a ProposalDiff.
 * sibling:    the done item is untouched; a new item opens under the same initiative/parent.
 * none:       evidence is attached (or recorded as context) and nothing else changes.
 */
export type DecisionKind = 'transition' | 'update' | 'proposal' | 'sibling' | 'none';

export interface Transition {
  from: WorkItemStatus;
  to: WorkItemStatus;
  actor: 'engine';
  reason: string;
  /** The evidence the transition cites (DATA-MODEL guard: auto-done must point at completion evidence). */
  evidenceId: string | null;
  /** Set on auto-closures: the L4 internal autonomy level that allowed it. */
  autonomy: 'L4_auto' | null;
}

export type ClosureField = Exclude<keyof ClosureItem, 'id' | 'version' | 'status' | 'kind' | 'title'>;

export interface FieldChange {
  field: ClosureField;
  before: unknown;
  after: unknown;
}

/** `change_proposals` row: one per field, grouped into one card by `groupId`. */
export interface ProposalSpec {
  entityType: 'work_items';
  entityId: string;
  groupId: string;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  reason: string;
  evidenceId: string | null;
  baseVersion: number;
  confidence: Confidence | null;
}

export interface SiblingSpec {
  kind: WorkItemKind;
  title: string;
  status: 'open';
  initiativeId: string | null;
  parentId: string | null;
  /** `work_item_relations`: the new item follows up the done one. */
  relation: { kind: 'follow_up_of'; toWorkItemId: string };
  involvement: Involvement;
  originEvidenceId: string | null;
  /** Inline label on the new item ("New task: new requirement from Sam"). */
  label: Label;
}

/** `reopen_decisions` row. */
export interface ReopenDecision {
  outcome: 'reopened' | 'new_sibling' | 'attached_as_context' | 'ignored';
  /** 'same_deliverable_recent', 'different_deliverable', 'outside_window', 'loop_back_recent', 'loop_back_outside_window', 'older_than_close' (ignored: the message predates the close) */
  ruleKey: string;
  /** "Reopened: new requirement from Sam (same deliverable, closed 2d ago)" */
  explanation: string;
  daysSinceClosed: number | null;
  windowDays: number;
}

export type LabelKind =
  | 'auto_closed'
  | 'likely_done'
  | 'reopened'
  | 'looped_back_in'
  | 'new_sibling'
  | 'context_only'
  | 'woke'
  | 'waiting_on_me'
  | 'resumed'
  | 'run_done_review'
  | 'run_failed'
  | 'new_requirement'
  | 'not_done'
  | 'progress'
  | 'reply_arrived'
  | 'nudge_due'
  | 'direct_ask'
  | 'new_info'
  | 'sent_with_attachment'
  | 'proposal'
  | 'routes_to_survivor'
  | 'already_done'
  | 'stays_dismissed'
  | 'stays_snoozed'
  | 'triage'
  | 'guess';

/** Inline status text for the card/row (UI-SPEC §9: inline, never a toast storm). */
export interface Label {
  kind: LabelKind;
  text: string;
}

export interface ClosureDecision {
  kind: DecisionKind;
  /** One line, in the user's terms. */
  reason: string;
  transition: Transition | null;
  fieldChanges: FieldChange[];
  proposals: ProposalSpec[];
  sibling: SiblingSpec | null;
  reopenDecision: ReopenDecision | null;
  /** R-UI-22: set whenever the item closes (auto-closures always carry an inferred reason). */
  resolution: { resolution: Resolution; detail: ResolutionDetail } | null;
  labels: Label[];
  /** How the data layer should store the evidence (handed-off items: `context`). Null = as linked. */
  recordAs: EvidenceRole | null;
  /** Session signals: the run's new state (UI-SPEC §12 Agents). */
  runState: RunState | null;
  /** merged / duplicate / superseded: the surviving item new evidence belongs to. */
  redirectTo: string | null;
  /** Every decision can be undone (R-UI-18): see undoDecision(). */
  undoable: true;
  actor: 'engine';
}
