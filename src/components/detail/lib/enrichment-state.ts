/**
 * Where a capture's enrichment stands, read from the item (never a hard-coded "Enriching…").
 *
 * The mock DataSource enriches a capture a moment after it lands. The db DataSource queues an `enrich` job that no
 * worker handles yet (src/jobs/index.ts registers no `enrich` kind), so the item would say "enriching" forever:
 * past ENRICH_WAIT_MS the app stops waiting and shows the capture as simply added.
 */
import type { Enrichment, WorkItem } from '@/contract';

/** How long "Enriching…" may show before the capture reads as added. */
export const ENRICH_WAIT_MS = 90_000;

export type EnrichmentView = 'none' | 'enriching' | 'done' | 'stale';

export function enrichmentView(e: Enrichment | null | undefined, nowMs: number): EnrichmentView {
  if (!e || e.status === 'idle') return 'none';
  if (e.status === 'done') return 'done';
  const started = e.startedAt ? Date.parse(e.startedAt) : NaN;
  return Number.isFinite(started) && nowMs - started > ENRICH_WAIT_MS ? 'stale' : 'enriching';
}

/** Still looking (and not past the wait): what the item's enrichment section and its NBA wait on. */
export const isEnriching = (e: Enrichment | null | undefined, nowMs: number) => enrichmentView(e, nowMs) === 'enriching';

/** A Capture row's status line: "Enriching…" while it looks, then what it found, else "Added". */
export function captureStatus(item: Pick<WorkItem, 'enrichment'>, nowMs: number): { text: string; looking: boolean } {
  const v = enrichmentView(item.enrichment, nowMs);
  if (v === 'enriching') return { text: 'Enriching…', looking: true };
  const n = v === 'done' ? (item.enrichment?.chips.length ?? 0) : 0;
  return { text: n ? `Added · ${n} related` : 'Added', looking: false };
}
