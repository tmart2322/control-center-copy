/**
 * DryRunStore: a ScannerStore overlay for skill-upgrade re-link dry runs (SCANNER.md §6.4).
 * Reads go to the real store; every write is captured as a "would" action and nothing is committed
 * (no runs, no source items, no cursor or coverage). Spend is real and goes to the real store.
 * Source items get synthetic ids `dry:<dedupeKey>` so the report can be joined to existing rows.
 */
import type {
  ConnectorHealthProbe,
  ConnectorId,
  CoverageObject,
  Cursor,
  EvidenceRole,
  Confidence,
  NormalizedSourceItem,
  ProposeItemInput,
  ScanContext,
  ScannerStore,
  ScanRunStats,
  ScanTrigger,
  ScopeKey,
  TimeWindow,
} from '../types';
import type { BriefHighlightsInput } from '../runtime/contract-ext';

export type DryAction =
  | { kind: 'record'; dedupeKey: string }
  | { kind: 'link'; workItemId: string; dedupeKey: string; role: EvidenceRole; confidence: Confidence; reason: string }
  | { kind: 'propose'; title: string; itemKind: string; confidence: Confidence; evidence: Array<{ dedupeKey: string; role: EvidenceRole }> }
  | { kind: 'initiative'; title: string; workItemIds: string[] }
  | { kind: 'unlinked'; dedupeKey: string; reason: string }
  | { kind: 'brief'; subscription: string; highlights: number };

export class DryRunStore implements ScannerStore {
  readonly actions: DryAction[] = [];
  private seq = 0;
  constructor(private readonly base: ScannerStore) {}

  private key(sourceItemId: string) {
    return sourceItemId.startsWith('dry:') ? sourceItemId.slice(4) : sourceItemId;
  }

  getContext(scope: ScopeKey, opts?: { maxOpenItems?: number }): Promise<ScanContext> {
    return this.base.getContext(scope, opts);
  }
  async startRun(_input: { scope: ScopeKey; trigger: ScanTrigger; window: TimeWindow; model?: string; skillVersion?: string }) {
    this.seq += 1;
    return { runId: `dryrun_${this.seq}` };
  }
  async recordSourceItems(_runId: string, items: NormalizedSourceItem[]) {
    return items.map((it) => {
      this.actions.push({ kind: 'record', dedupeKey: it.dedupeKey });
      return { sourceItemId: `dry:${it.dedupeKey}`, dedupeKey: it.dedupeKey, isNew: false, changed: false };
    });
  }
  findCandidates(q: Parameters<ScannerStore['findCandidates']>[0]) {
    return this.base.findCandidates(q);
  }
  async linkEvidence(_runId: string, input: { workItemId: string; sourceItemId: string; role: EvidenceRole; confidence: Confidence; reason: string }) {
    this.actions.push({ kind: 'link', workItemId: input.workItemId, dedupeKey: this.key(input.sourceItemId), role: input.role, confidence: input.confidence, reason: input.reason });
    return { evidenceId: `dryev_${this.actions.length}`, touchedWorkItemId: input.workItemId };
  }
  async proposeItem(_runId: string, input: ProposeItemInput) {
    this.actions.push({ kind: 'propose', title: input.title, itemKind: input.kind, confidence: input.confidence, evidence: input.evidence.map((e) => ({ dedupeKey: this.key(e.sourceItemId), role: e.role })) });
    return { workItemId: `drywi_${this.actions.length}`, landedAs: input.confidence === 'guess' ? ('suggested' as const) : ('open' as const) };
  }
  async proposeInitiative(_runId: string, input: { title: string; purpose: string; workItemIds: string[] }) {
    this.actions.push({ kind: 'initiative', title: input.title, workItemIds: input.workItemIds });
    return { initiativeId: `dryini_${this.actions.length}` };
  }
  async flagUnlinked(_runId: string, input: { sourceItemId: string; reason: string }) {
    this.actions.push({ kind: 'unlinked', dedupeKey: this.key(input.sourceItemId), reason: input.reason });
  }
  async reportCoverage(_runId: string, _objects: CoverageObject[]) {}
  async recordBriefHighlights(_runId: string, input: BriefHighlightsInput) {
    this.actions.push({ kind: 'brief', subscription: `${input.subscription.kind}:${input.subscription.ref}`, highlights: input.highlights.length });
    return { briefId: `drybrief_${this.actions.length}` };
  }
  async finishRun(_runId: string, _input: { cursor: Cursor; summary?: string; stats: ScanRunStats }) {
    return { touchedWorkItemIds: [] };
  }
  async failRun(_runId: string, _input: { error: string; errorClass?: ConnectorHealthProbe['errorClass']; stats?: Partial<ScanRunStats> }) {}
  getCursor(scope: ScopeKey) {
    return this.base.getCursor(scope);
  }
  coverageGaps(scope: ScopeKey, window: TimeWindow) {
    return this.base.coverageGaps(scope, window);
  }
  uncoveredObjects(scope: ScopeKey, listed: CoverageObject[]) {
    return this.base.uncoveredObjects(scope, listed);
  }
  unlinkedSourceItems(opts: Parameters<ScannerStore['unlinkedSourceItems']>[0]) {
    return this.base.unlinkedSourceItems(opts);
  }
  async recordHealth(_connector: ConnectorId, _probe: ConnectorHealthProbe) {}
  recordSpend(input: Parameters<ScannerStore['recordSpend']>[0]) {
    return this.base.recordSpend(input);
  }

  summary(): Record<DryAction['kind'], number> {
    const out = { record: 0, link: 0, propose: 0, initiative: 0, unlinked: 0, brief: 0 };
    for (const a of this.actions) out[a.kind] += 1;
    return out;
  }
}
