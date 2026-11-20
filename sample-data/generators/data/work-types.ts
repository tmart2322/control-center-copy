/** Domain 04: the compact spec language for work items (see work-items-*.ts). */
export type Status = 'suggested' | 'open' | 'in_progress' | 'waiting_on_others' | 'waiting_on_me' | 'likely_done' | 'done' | 'snoozed' | 'dismissed' | 'merged';
export type Kind = 'task' | 'commitment' | 'ask' | 'training' | 'background_promise' | 'travel' | 'missed_meeting_followup';
export type Origin = 'manual' | 'said_by_me' | 'asked_of_me' | 'meeting_next_step' | 'system_rule' | 'chat' | 'missed_opp_scan' | 'reconcile' | 'tool';
export type Role = 'origin' | 'progress' | 'completion' | 'context' | 'contradiction';
/** [evidence ref, role, confidence, rationale?]. Refs: si-123, cal:<tag>, o62:NN, d:<asset>:a-b, s:<asset>:vN. */
export type Ev = [string, Role, number, string?];
/** Who made a transition: C completion pass, S settle pass, R reeval, U user, H chat, Y system, K connector. */
export type By = 'C' | 'S' | 'R' | 'U' | 'H' | 'Y' | 'K';
export interface StepOpts { ev?: number; cs?: number; undoneAt?: string; undoneCs?: number; res?: Resolution; reopen?: boolean }
/** [to, when ('MM-DD HH:MM' MT or '+Nm' after the previous step), by, reason, opts?] */
export type Step = [Status, string, By, string, StepOpts?];
export interface Resolution { r: 'done_by_me' | 'handed_off' | 'done_by_other' | 'not_needed' | 'duplicate' | 'declined' | 'superseded'; person?: string; wi?: number; note?: string; inferred?: boolean; ev?: number }
export type ClosureKind = 'manual_only' | 'reply_in_thread' | 'email_sent' | 'claude_session_completed' | 'asset_delivered' | 'deliverable_judged' | 'org62_readback' | 'vdp_readback' | 'tool_run_succeeded' | 'training_completed' | 'llm_match';

export interface ItemSpec {
  n: number;
  k: Kind;
  og: Origin;
  /** Final status as of now (checked against the steps). */
  st: Status;
  title: string;
  purpose?: string;
  description?: string;
  a?: string;
  o?: string;
  /** counterparty person key */
  cp?: string;
  due?: string;
  dk?: 'hard' | 'soft' | 'inferred';
  imp?: 'critical' | 'high' | 'normal' | 'low';
  eff?: number;
  ev?: Ev[];
  /** creation status (default open) */
  init?: 'open' | 'suggested' | 'in_progress';
  /** override creation time (manual / chat / system items) */
  at?: string;
  steps?: Step[];
  cl?: [ClosureKind, string?, Record<string, unknown>?, boolean?];
  parent?: number;
  mergedInto?: number;
  res?: Resolution;
  snooze?: [string, Status];
  wait?: [string, string];
  likely?: [string, number];
  ini?: string;
  conf?: number;
  lock?: string[];
  ver?: number;
  inv?: 'owner' | 'contributor' | 'watcher' | 'not_involved';
  /** customer facing (priority rules) / from manager */
  cust?: boolean;
  mgr?: boolean;
  deadlineEvent?: string;
  extractor?: string;
  ownerPerson?: string;
  /** the user has not opened it yet (new today) */
  fresh?: boolean;
  effSrc?: 'default' | 'llm' | 'history' | 'user';
  bg?: boolean;
}
