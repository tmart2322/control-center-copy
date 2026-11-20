/**
 * Scan run trace (AUDIT). See ./emit.ts for the rules: ids, counts, codes and short reasons only; behavior-neutral.
 *
 *   trace(runId, kind, payload, { sourceItemId, workItemId })   record one decision
 *   withTraceContext / annotateTraceContext / logFields          job ↔ run ↔ connector ↔ scope correlation
 *   installDbTraceSink(db)                                       the worker's sink (scan_run_events)
 *   ./queries                                                    run trace, "why is / isn't this here", report
 */
export { cleanPayload, flushTrace, MemoryTraceSink, setTraceSink, trace, traceSink } from './emit';
export { annotateTraceContext, logFields, traceContext, withTraceContext, type TraceContext } from './context';
export { DbTraceSink, installDbTraceSink, type DbTraceSinkOptions } from './sink';
export type { TraceEvent, TraceKind, TraceSink } from './types';
