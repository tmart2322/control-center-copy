/** Scan run trace types (see ./emit.ts). */
export type TraceKind =
  | 'plan'
  | 'prefetch'
  | 'tool_call'
  | 'rec'
  | 'prompt'
  | 'tripwire'
  | 'cost_cap'
  | 'pass'
  | 'triage_select'
  | 'triage_context'
  | 'verdict'
  | 'recorded'
  | 'proposal'
  | 'link'
  | 'unlinked'
  | 'coverage'
  | 'spend'
  | 'retry'
  | 'commit'
  | 'failed'
  | 'outcome'
  | 'error'
  /** FS-LATE: this run backfills a channel that joined the first scan after it had finished (why it got the lookback). */
  | 'first_scan_reopened'
  /** D3: items recorded without the model (status-only changes), and why. */
  | 'quiet'
  /** D5: the pre-check before a scheduled poll (empty or not, its calls and cost). */
  | 'precheck';

export interface TraceEvent {
  runId: string;
  seq: number;
  ts: string;
  kind: TraceKind;
  payload: Record<string, unknown>;
  sourceItemId?: string;
  workItemId?: string;
}

export interface TraceSink {
  write(e: TraceEvent): void;
  flush(): Promise<void>;
}
