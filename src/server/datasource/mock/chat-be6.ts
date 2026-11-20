/**
 * BE-CHAT in mock mode: the chat host backend (staged proposals, simulated scan jobs, Outbox drafts,
 * prepared sessions, spend) and Apply / Dismiss / hydration for chat proposals.
 *
 * Chat plans live beside the store (not in `proposals`, so they never show up as item-card proposals,
 * the same as db mode). Apply runs every change in ONE audit entry with actor `chat` (one re-rank when a
 * change needs it), so one Undo reverts the lot; the plan itself stays `applied` (redo is the receipt's
 * undo chain). Nothing here calls an external system.
 */
import { nanoid } from 'nanoid';
import type {
  ActivityEntry,
  Actor,
  AgentRun,
  AuditEntry,
  ChatChange,
  ChatMessage,
  ChatModel,
  ChatPart,
  ChatScan,
  EntityRef,
  Evidence,
  EvidenceRole,
  Job,
  PolicyRule,
  PriorityPolicy,
  Proposal,
  Receipt,
  ReceiptChange,
  ReceiptFailure,
  Resolution,
  ResolutionDetail,
  ScanRun,
  SourceRef,
  WorkItemRecord,
} from '@/contract';
import { WorkItemPatch } from '@/contract';
import type { ChatSourceHit } from '@/llm/chat/types';
import { activityError, activityReceiptLines, changeError, editedActivity, needsRerank, RESOLUTION_LABEL, weightsWith } from '@/server/chat/changes';
import { appliedSummary, applyRouteCalls, type AppliedCalls, type RouteCall } from '@/server/chat/app-routes';
import type { ChatHostBackend } from '@/server/chat/host';
import type { DataSource } from '@/server/datasource/types';
import { personaOf } from '@/personas';
import { chatDraft, chatLimitsFromEnv, chatProposal, chatScan, chatSession, draftRef, findConnector, resolveRepoFolder, type ChatPlanRecord } from '@/server/chat/outputs';
import { refreshScanPart, scanIdOfPart } from '@/server/chat/turn';
import { AppError, invalid } from '@/server/errors';

import type { RowOp, Store, Tx } from './store';

const id = (prefix: string) => `${prefix}_${nanoid(10)}`;

interface TxMetaLite {
  actor: Actor;
  action: string;
  summary: string;
  entity: EntityRef;
  undoable?: boolean;
  audit?: boolean;
}
type TxResult<R> = { result: R; entry: AuditEntry | null; ops: RowOp[] };

/** What the mock DataSource lends BE-CHAT (bound private helpers). */
export interface MockChatKit {
  store(): Store;
  now(): Date;
  stepMs: number;
  tx<R>(m: TxMetaLite, fn: (tx: Tx) => R): TxResult<R>;
  rerankAll(actor: Actor, action: string, summary: string, policy: PriorityPolicy | undefined, extra: (tx: Tx) => void): TxResult<unknown>;
  receiptFrom(entry: AuditEntry | null, ops: RowOp[], actor: Actor, summary: string, filter?: (op: RowOp, field: string) => boolean): Receipt | undefined;
  labelled(r: Receipt | null | undefined): Receipt | null;
  bump<T extends { version: number; updatedAt?: string }>(v: T): T;
  resolvedRecord(cur: WorkItemRecord, o: { reason: string; resolution: Resolution; detail: Partial<Omit<ResolutionDetail, 'inferred'>>; doneBy: 'user' | 'chat' }): WorkItemRecord;
  addEvidence(tx: Tx, workItemId: string, role: EvidenceRole, source: SourceRef, summary: string, isNew?: boolean): Evidence;
  blankItem(now: string): WorkItemRecord;
  /** Rank boost that puts the item at #1 under the current policy. */
  topBoost(w: WorkItemRecord): number;
  undoStateOf(auditId: string): { undoneAt: string | null; undoAuditId: string | null };
  later(ms: number, fn: () => void): void;
  enrich(itemId: string): void;
  publish(topics: Array<'chat' | 'jobs' | 'scans' | 'health' | 'outbox' | 'agents'>, ids: string[], reason: string): void;
  history(threadId: string, excludeIds: string[]): ChatMessage[];
}

const RECEIPT_FIELDS = new Set(['state', 'snoozedUntil', 'rank', 'resolution', 'title', 'purpose', 'due', 'startBy', 'effort', 'notes', 'kind', 'accountId', 'initiativeId', 'oppId', 'signals']);

interface ScanTrack {
  jobId: string;
  runId: string | null;
  connector: { id: string; label: string; source: ChatScan['source'] };
  hours: number;
  window: { from: string; to: string };
}

export class MockChatBe6 {
  readonly plans = new Map<string, ChatPlanRecord>();
  private readonly scans = new Map<string, ScanTrack>();
  private spent = { day: '', usd: 0 };

  constructor(private readonly k: MockChatKit) {}

  reset() {
    this.plans.clear();
    this.scans.clear();
  }

  private nowIso() {
    return this.k.now().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Host backend
  // ---------------------------------------------------------------------------

  backend(): ChatHostBackend {
    return {
      kind: 'mock',
      timezone: async () => this.k.store().settings().profile.timezone,
      history: async (threadId, exclude) => this.k.history(threadId, exclude),
      stageChanges: async (i) => {
        const proposal = chatProposal({ id: id('prop'), entity: i.entity, lines: i.lines, reason: i.reason, at: this.nowIso() });
        this.plans.set(proposal.id, { proposal, changes: i.changes, threadId: i.threadId, messageId: i.messageId });
        this.k.publish(['chat'], [i.threadId], 'chat.propose');
        return proposal;
      },
      rescan: async (connector, hours) => this.rescan(connector, hours),
      scanStatus: async (scanId) => this.scanStatus(scanId),
      createDraft: async (i) => {
        const store = this.k.store();
        const workItemId = i.workItemId && store.get('workItems', i.workItemId) ? i.workItemId : null;
        const d = chatDraft(i, { id: id('draft'), now: this.nowIso(), mode: store.settings().sending.defaultMode, workItemId });
        const ref = draftRef(d, i);
        this.k.tx({ actor: 'chat', action: 'chat.draft', summary: `Draft for ${ref.to} (from chat)`, entity: { type: 'draft', id: d.id, label: `Draft for ${ref.to}` } }, (tx) => tx.put('drafts', d));
        return ref;
      },
      prepareSession: async (i) => {
        const store = this.k.store();
        const item = i.workItemId ? store.get('workItems', i.workItemId) : undefined;
        const folder = resolveRepoFolder(i.repo, [], store.meta().repoFolder ?? process.cwd());
        const runId = id('run');
        const title = i.title ?? (item ? item.title : `Claude session: ${i.prompt.split('\n')[0]!.slice(0, 60)}`);
        const s = chatSession(i, { id: runId, folder, now: this.nowIso(), workItemId: item?.id ?? null, title });
        const run: AgentRun = {
          id: runId,
          kind: 'claude_session',
          title,
          workItemId: item?.id ?? null,
          state: 'queued',
          startedAt: this.nowIso(),
          updatedAt: this.nowIso(),
          finishedAt: null,
          lastEvent: 'Prepared from chat; opens on your click',
          waiting: null,
          deepLink: s.url,
          sessionId: null,
          cwd: folder,
          bgAgents: 0,
          toolRunId: null,
          progress: null,
          resultUrl: null,
          error: null,
          costUsd: null,
          scheduled: false,
        };
        this.k.tx({ actor: 'chat', action: 'chat.session', summary: `Prepared a Claude session: ${title}`, entity: { type: 'agent_run', id: runId, label: title } }, (tx) => {
          tx.put('agentRuns', run);
          if (item && !item.runIds.includes(runId)) tx.put('workItems', this.k.bump({ ...item, runIds: [...item.runIds, runId] }));
        });
        return s;
      },
      searchLedger: async (q, limit) => this.searchLedger(q, limit),
      activityLookup: async (entryIds, oppIds) => {
        const store = this.k.store();
        return { entries: new Map(entryIds.flatMap((i) => { const e = store.get('activity', i); return e ? [[i, e] as const] : []; })), opps: this.oppNames(oppIds), taskTypes: this.taskTypes() };
      },
      budget: async (model: ChatModel) => {
        const store = this.k.store();
        const lim = chatLimitsFromEnv(process.env, model, store.settings().chat);
        return { chatTodayUsd: this.spentToday(), chatDailyUsd: lim.chatDailyUsd, totalTodayUsd: store.spend().today.usd, hardCapUsd: store.settings().budgets.hardUsd, perMessageUsd: lim.perMessageUsd, maxTurns: lim.maxTurns, researchUsd: lim.researchUsd };
      },
      recordUsage: async (u) => {
        if (!(u.costUsd > 0)) return;
        this.spentToday();
        this.spent.usd += u.costUsd;
        const store = this.k.store();
        const sp = store.spend();
        const usd = Math.round((sp.today.usd + u.costUsd) * 1e6) / 1e6;
        const bump = (rows: Array<{ name?: string; model?: string; usd: number }>, key: 'name' | 'model', v: string) => {
          const hit = rows.find((r) => r[key] === v);
          return hit ? rows.map((r) => (r === hit ? { ...r, usd: Math.round((r.usd + u.costUsd) * 1e6) / 1e6 } : r)) : [...rows, { [key]: v, usd: u.costUsd }];
        };
        const pct = sp.today.softBudgetUsd > 0 ? Math.round((usd / sp.today.softBudgetUsd) * 100) : 0;
        this.k.tx({ actor: 'chat', action: 'chat.spend', summary: 'Chat spend', entity: { type: 'settings', id: 'spend', label: 'Spend' }, audit: false }, (tx) =>
          tx.put('spend', {
            ...sp,
            today: { ...sp.today, usd, pct },
            byScanner: bump(sp.byScanner as Array<{ name: string; usd: number }>, 'name', 'chat') as typeof sp.byScanner,
            byModel: bump(sp.byModel as Array<{ model: string; usd: number }>, 'model', u.model) as typeof sp.byModel,
          }),
        );
      },
    };
  }

  private spentToday(): number {
    const day = this.nowIso().slice(0, 10);
    if (this.spent.day !== day) this.spent = { day, usd: 0 };
    return this.spent.usd;
  }

  private searchLedger(q: string, limit: number): ChatSourceHit[] {
    const store = this.k.store();
    const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    if (!tokens.length) return [];
    const score = (s: string) => tokens.filter((t) => s.toLowerCase().includes(t)).length / tokens.length;
    const hits: Array<ChatSourceHit & { s: number }> = [];
    const items = new Map(store.all('workItems').map((w) => [w.id, w]));
    for (const a of store.all('assets')) {
      const s = score(a.title);
      if (s > 0) hits.push({ s, source: 'drive', kind: 'asset', title: a.title, excerpt: '', url: a.url ?? null, externalId: a.id, at: null, workItemId: null, workItemTitle: null });
    }
    for (const e of store.all('evidence')) {
      const s = score(`${e.source.label} ${e.summary} ${e.snippet ?? ''}`);
      if (s > 0) hits.push({ s, source: e.source.kind, kind: e.role, title: e.source.label, excerpt: (e.snippet ?? e.summary).slice(0, 200), url: e.source.url ?? null, externalId: e.source.externalId ?? null, at: e.at, workItemId: e.workItemId, workItemTitle: items.get(e.workItemId)?.title ?? null });
    }
    return hits
      .sort((a, b) => b.s - a.s || (b.at ?? '').localeCompare(a.at ?? ''))
      .slice(0, limit)
      .map(({ s: _s, ...h }) => h);
  }

  // ---------------------------------------------------------------------------
  // Scans: a queued job, then a running scan run, then done (simulated, stepMs apart)
  // ---------------------------------------------------------------------------

  private rescan(connector: string, hours: number): ChatScan {
    const store = this.k.store();
    const c = findConnector(store.all('connectors'), connector);
    if (!c) throw invalid(`Unknown connector "${connector}" (one of ${store.all('connectors').map((x) => x.id).join(', ')})`);
    const now = this.nowIso();
    const window = { from: new Date(this.k.now().getTime() - hours * 3_600_000).toISOString(), to: now };
    const conn = { id: c.id, label: c.label, source: c.source };
    if (c.state === 'auth_needed') return chatScan({ id: id('scan'), connector: conn, windowHours: hours, window, jobId: null, jobStatus: null, run: null, now, authBroken: true });
    const job: Job = { id: id('job'), type: `scan.${c.source}`, status: 'queued', attempts: 0, maxAttempts: 3, runAt: now, startedAt: null, finishedAt: null, dedupeKey: `scan:${c.id}:chat:${hours}h`, generation: null, entity: { type: 'connector', id: c.id, label: c.label }, error: null };
    this.k.tx({ actor: 'chat', action: 'chat.scan', summary: `Scan ${c.label} (last ${hours} h, from chat)`, entity: { type: 'connector', id: c.id, label: c.label }, undoable: false }, (tx) => tx.put('jobs', job));
    const track: ScanTrack = { jobId: job.id, runId: null, connector: conn, hours, window };
    this.scans.set(job.id, track);
    const step = Math.max(1, this.k.stepMs);
    this.k.later(step, () => {
      const s = this.k.store();
      const j = s.get('jobs', job.id);
      if (!j || j.status !== 'queued') return;
      const run: ScanRun = { id: id('scan'), connectorId: c.id, scope: `chat:${hours}h`, kind: 'manual', windowStart: window.from, windowEnd: window.to, status: 'running', startedAt: this.nowIso(), endedAt: null, itemsSeen: 4, itemsNew: 0, itemsChanged: 0, costUsd: 0, model: c.source === 'slack' || c.source === 'org62' ? 'haiku' : null, error: null };
      track.runId = run.id;
      this.k.tx({ actor: 'connector', action: 'scan.running', summary: `Scan ${c.label} running`, entity: { type: 'connector', id: c.id, label: c.label }, audit: false }, (tx) => {
        tx.put('jobs', { ...j, status: 'running', attempts: 1, startedAt: this.nowIso() });
        tx.put('scanRuns', run);
      });
      this.k.later(step, () => {
        const s2 = this.k.store();
        const j2 = s2.get('jobs', job.id);
        const r2 = s2.get('scanRuns', run.id);
        const cn = s2.get('connectors', c.id);
        if (!j2 || !r2 || !cn) return;
        this.k.tx({ actor: 'connector', action: 'scan.ok', summary: `Scan ${c.label} ok`, entity: { type: 'connector', id: c.id, label: c.label }, audit: false }, (tx) => {
          tx.put('scanRuns', { ...r2, status: 'ok', endedAt: this.nowIso(), itemsSeen: 12, itemsNew: 1, itemsChanged: 2, costUsd: r2.model ? 0.004 : 0 });
          tx.put('jobs', { ...j2, status: 'succeeded', finishedAt: this.nowIso() });
          tx.put('connectors', { ...cn, lastSuccessAt: this.nowIso(), itemsToday: cn.itemsToday + 1 });
        });
      });
    });
    return chatScan({ id: job.id, connector: conn, windowHours: hours, window, jobId: job.id, jobStatus: 'queued', run: null, now });
  }

  scanStatus(scanId: string): ChatScan | null {
    const t = this.scans.get(scanId);
    if (!t) return null;
    const store = this.k.store();
    const job = store.get('jobs', t.jobId);
    const run = t.runId ? (store.get('scanRuns', t.runId) ?? null) : null;
    return chatScan({ id: scanId, connector: t.connector, windowHours: t.hours, window: t.window, jobId: t.jobId, jobStatus: job?.status ?? null, run, now: this.nowIso() });
  }

  // ---------------------------------------------------------------------------
  // Apply / Dismiss
  // ---------------------------------------------------------------------------

  /** POST /proposals/:id/apply for a chat plan (null when `pid` is not one). */
  async apply(pid: string, ds: DataSource): Promise<{ entity: Proposal; auditId: string | null; receipt: Receipt } | null> {
    const plan = this.plans.get(pid);
    if (!plan) return null;
    if (plan.proposal.status !== 'pending') throw invalid(`Proposal is ${plan.proposal.status}`);
    const store = this.k.store();
    const now = this.k.now();
    const nowIso = now.toISOString();
    // D-58: app route calls run after the edits, each through the DataSource (its own change set, Undo all reverts them).
    const calls = plan.changes.filter((c): c is RouteCall => c.op === 'route_call');
    const all = plan.changes.filter((c) => c.op !== 'route_call');
    // A3 (2026-11-13): Apply lands what works; an edit that no longer fits is listed with its reason, the rest land.
    const failed: ReceiptFailure[] = [];
    const edits = all.filter((c) => {
      const err = this.editConflict(c, now);
      if (err) failed.push({ label: this.changeLabel(c), reason: `Changed since it was proposed: ${err}` });
      return !err;
    });
    // Policy: one new version covering every policy change in the plan.
    const settings = store.settings();
    let policy: PriorityPolicy | undefined;
    if (edits.some((c) => c.op === 'policy_weights' || c.op === 'policy_rule')) {
      let weights = settings.policy.weights;
      let rules: PolicyRule[] = [...settings.policy.rules];
      for (const c of edits) {
        if (c.op === 'policy_weights') weights = weightsWith(weights, c.deltas);
        else if (c.op === 'policy_rule') rules = ruleOp(rules, c, id('rule'));
      }
      policy = { ...settings.policy, version: settings.policy.version + 1, weights, rules, updatedAt: nowIso, note: plan.proposal.reason };
    }
    const created: WorkItemRecord[] = [];
    const evidence: Array<{ ev: Evidence; item: WorkItemRecord }> = [];
    const actEdits: Array<{ cur: ActivityEntry; next: ActivityEntry }> = [];
    const extra = (tx: Tx) => {
      if (policy) {
        tx.put('settings', { ...store.settings(), policy });
        tx.put('policyVersions', { version: policy.version, at: nowIso, by: 'chat', note: plan.proposal.reason, policy });
      }
      for (const c of edits) if (c.op !== 'pin') this.applyOne(tx, c, nowIso, created, evidence, actEdits);
      // pins last (after the plan's edits and policy), so "#1" holds after the re-rank
      for (const c of edits) if (c.op === 'pin') this.applyOne(tx, c, nowIso, created, evidence);
    };
    const summary = `Applied from chat: ${plan.proposal.reason}`;
    const r = !edits.length ? null : needsRerank(edits) ? this.k.rerankAll('chat', 'chat.apply', summary, policy, extra) : this.k.tx({ actor: 'chat', action: 'chat.apply', summary, entity: plan.proposal.entity }, extra);
    if (r && !r.entry && !calls.length && !failed.length) throw invalid('Nothing to apply: everything is already as proposed');
    const base = r?.entry ? this.k.labelled(this.k.receiptFrom(r.entry, r.ops, 'chat', summary, (op, f) => (op.col === 'workItems' ? RECEIPT_FIELDS.has(f) : op.col === 'settings'))) : null;
    const editAudit = r?.entry?.id ?? null;
    const applied: AppliedCalls = calls.length ? await applyRouteCalls(ds, calls, personaOf(store.settings())) : { lines: [], auditIds: [], failed: [], landed: 0 };
    failed.push(...applied.failed);
    const total = all.length + calls.length;
    // nothing landed at all: the card stays pending (Retry apply), and the error says why
    if (!editAudit && !applied.landed && failed.length) throw new AppError('conflict', `Nothing was applied: ${failed.map((f) => `${f.label}: ${f.reason}`).slice(0, 3).join('; ')}${failed.length > 3 ? ` (and ${failed.length - 3} more)` : ''}`);
    const lines: ReceiptChange[] = [
      ...(base?.changes ?? []),
      ...(editAudit
        ? [
            ...created.map((w): ReceiptChange => ({ auditId: editAudit, entity: { type: 'work_item', id: w.id, label: w.title }, field: 'state', label: 'Created', before: null, after: w.state })),
            ...evidence.map(({ ev, item }): ReceiptChange => ({ auditId: editAudit, entity: { type: 'work_item', id: item.id, label: item.title }, field: 'evidence', label: 'Evidence', before: null, after: ev.source.label })),
            ...actEdits.flatMap(({ cur, next }) => activityReceiptLines(editAudit, cur, next)),
          ]
        : []),
      ...applied.lines,
    ];
    const auditId = editAudit ?? applied.auditIds.at(-1) ?? null;
    const receipt: Receipt = { id: id('rcpt'), at: this.k.now().toISOString(), actor: 'chat', summary: failed.length ? `${appliedSummary(total - failed.length, total, failed)}. ${plan.proposal.reason}` : summary, changes: lines, staged: false, total, ...(failed.length ? { failed } : {}) };
    plan.proposal = { ...plan.proposal, status: 'applied', resolvedAt: nowIso };
    plan.receipt = receipt;
    plan.auditId = auditId ?? undefined;
    for (const w of created) this.k.later(1, () => this.k.enrich(w.id));
    this.k.publish(['chat'], [plan.threadId], 'chat.apply');
    return { entity: plan.proposal, auditId, receipt };
  }

  /** POST /proposals/:id/reject (Dismiss) for a chat plan. */
  reject(pid: string): { entity: Proposal; auditId: null } | null {
    const plan = this.plans.get(pid);
    if (!plan) return null;
    if (plan.proposal.status !== 'pending') throw invalid(`Proposal is ${plan.proposal.status}`);
    plan.proposal = { ...plan.proposal, status: 'rejected', resolvedAt: this.nowIso() };
    this.k.publish(['chat'], [plan.threadId], 'chat.dismiss');
    return { entity: plan.proposal, auditId: null };
  }

  /** Why a staged edit can't land now (closed since, a row logged since): null when it still fits. */
  private editConflict(c: ChatChange, now: Date): string | null {
    const store = this.k.store();
    const err = changeError(c, 'itemId' in c ? (store.get('workItems', c.itemId) ?? null) : null, now);
    if (err) return err;
    if (c.op === 'edit_activities')
      for (const i of c.entryIds) {
        const e = activityError(i, store.get('activity', i), c.patch.oppId ? !!store.get('opps', c.patch.oppId) : null, c.patch, this.taskTypes());
        if (e) return e;
      }
    return null;
  }

  /** A failed edit's line on the receipt: the item or rows it was for. */
  private changeLabel(c: ChatChange): string {
    if ('itemId' in c) return `${c.op} · ${this.k.store().get('workItems', c.itemId)?.title ?? c.itemId}`;
    if (c.op === 'edit_activities') return `Time rows · ${c.entryIds.length} row${c.entryIds.length === 1 ? '' : 's'}`;
    return c.op.replace(/_/g, ' ');
  }

  /** The task types in use (mock mode has no team-pack table). */
  private taskTypes(): string[] {
    return [...new Set(this.k.store().all('activity').flatMap((e) => (e.taskType ? [e.taskType] : [])))].sort();
  }

  /** Opportunity id → its name and account (previews and Time-page rows). */
  private oppNames(ids: string[]) {
    const store = this.k.store();
    return new Map(
      ids.flatMap((i) => {
        const o = store.get('opps', i);
        return o ? [[i, { name: o.name, accountName: store.get('accounts', o.accountId)?.name ?? null }] as const] : [];
      }),
    );
  }

  private applyOne(tx: Tx, c: ChatPlanRecord['changes'][number], now: string, created: WorkItemRecord[], evidence: Array<{ ev: Evidence; item: WorkItemRecord }>, actEdits: Array<{ cur: ActivityEntry; next: ActivityEntry }> = []) {
    const store = this.k.store();
    const cur = 'itemId' in c ? store.get('workItems', c.itemId) : undefined;
    switch (c.op) {
      case 'pin':
        tx.put('workItems', this.k.bump({ ...cur!, signals: { ...cur!.signals, boost: cur!.signals.boost + this.k.topBoost(cur!) } }));
        return;
      case 'rerank':
      case 'policy_weights':
      case 'policy_rule':
        return;
      case 'snooze':
        tx.put('workItems', this.k.bump({ ...cur!, state: 'snoozed', snoozedUntil: c.until, snoozedFrom: cur!.state === 'snoozed' ? cur!.snoozedFrom : cur!.state }));
        return;
      case 'done':
        tx.put('workItems', this.k.bump(this.k.resolvedRecord(cur!, { reason: 'Done (asked in chat)', resolution: 'done_by_me', detail: c.note ? { note: c.note } : {}, doneBy: 'chat' })));
        return;
      case 'resolve': {
        const detail: Partial<Omit<ResolutionDetail, 'inferred'>> = { ...(c.personName ? { personName: c.personName } : {}), ...(c.relatedItemId ? { relatedItemId: c.relatedItemId } : {}), ...(c.note ? { note: c.note } : {}) };
        const label = c.personName ? `${RESOLUTION_LABEL[c.resolution]} (${c.personName})` : RESOLUTION_LABEL[c.resolution]!;
        tx.put('workItems', this.k.bump(this.k.resolvedRecord(cur!, { reason: `${label} (asked in chat)`, resolution: c.resolution, detail, doneBy: 'chat' })));
        return;
      }
      case 'reopen':
        tx.put('workItems', this.k.bump({ ...cur!, state: 'reopened', doneAt: null, doneBy: null, closedReason: null, dismissed: null, resolution: null, resolutionDetail: null, involvement: 'owner', reopened: { reason: c.reason ?? 'Reopened from chat', at: now } }));
        return;
      case 'link_evidence': {
        const src: SourceRef = { kind: c.source.kind, label: c.source.label, ...(c.source.url ? { url: c.source.url } : {}), ...(c.source.externalId ? { externalId: c.source.externalId } : {}), at: now };
        const ev = this.k.addEvidence(tx, cur!.id, c.role ?? 'context', src, c.summary, false);
        const has = cur!.sources.some((s) => s.label === src.label && (s.url ?? '') === (src.url ?? ''));
        const next = has ? cur! : this.k.bump({ ...cur!, sources: [...cur!.sources, src] });
        if (!has) tx.put('workItems', next);
        evidence.push({ ev, item: next });
        return;
      }
      case 'create_item': {
        const me = store.meta().user;
        const rec: WorkItemRecord = {
          ...this.k.blankItem(now),
          id: id('w'),
          kind: c.kind ?? 'task',
          state: c.snoozeUntil ? 'snoozed' : 'open',
          snoozedUntil: c.snoozeUntil ?? null,
          snoozedFrom: c.snoozeUntil ? 'open' : null,
          title: c.title.replace(/\s+/g, ' ').trim(),
          purpose: c.purpose ?? null,
          due: c.due ?? null,
          accountId: c.accountId && store.get('accounts', c.accountId) ? c.accountId : null,
          initiativeId: c.initiativeId && store.get('initiatives', c.initiativeId) ? c.initiativeId : null,
          effort: { youMin: c.effortMin ?? 15, agentMin: 0 },
          confidence: 'sure',
          why: 'Created from chat',
          sources: [{ kind: 'manual', label: 'Chat', at: now }],
          signals: { customerFacing: !!c.accountId, fromManager: false, boost: 0 },
          owner: { id: me.id, name: me.name },
          seenAt: now,
          enrichment: { status: 'enriching', startedAt: now, chips: [] },
        };
        tx.put('workItems', rec);
        this.k.addEvidence(tx, rec.id, 'origin', { kind: 'manual', label: 'Chat' }, rec.why, false);
        created.push(rec);
        return;
      }
      case 'edit_fields': {
        const patch = WorkItemPatch.parse(c.patch);
        tx.put('workItems', this.k.bump({ ...cur!, ...patch } as WorkItemRecord)); // no user locks: the Apply was the approval
        return;
      }
      case 'edit_activities': {
        const opp = c.patch.oppId ? this.oppNames([c.patch.oppId]).get(c.patch.oppId) : undefined;
        for (const i of c.entryIds) {
          const before = store.get('activity', i)!;
          const { next } = editedActivity(before, c.patch, opp);
          tx.put('activity', this.k.bump(next));
          actEdits.push({ cur: before, next });
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read-time hydration of persisted chat parts
  // ---------------------------------------------------------------------------

  /** Chat proposals → current status (+ the receipt right after an applied one); scans → current status. */
  hydrate(parts: ChatPart[]): ChatPart[] {
    if (!parts.some((p) => p.type === 'proposal' || scanIdOfPart(p))) return parts;
    const out: ChatPart[] = [];
    for (const p of parts) {
      if (p.type === 'proposal' && this.plans.has(p.proposal.id)) {
        const plan = this.plans.get(p.proposal.id)!;
        const status = plan.proposal.status === 'pending' ? 'pending' : plan.proposal.status === 'applied' ? 'applied' : 'dismissed';
        out.push({ ...p, proposal: plan.proposal, status });
        if (plan.receipt && !parts.some((x) => x.type === 'receipt' && x.receipt.id === plan.receipt!.id)) {
          out.push({ type: 'receipt', receipt: { ...plan.receipt, changes: plan.receipt.changes.map((c) => ({ ...c, ...this.k.undoStateOf(c.auditId) })) } });
        }
        continue;
      }
      const scanId = scanIdOfPart(p);
      if (scanId && p.type === 'tool') {
        const scan = this.scanStatus(scanId);
        out.push(scan ? refreshScanPart(p, scan) : p);
        continue;
      }
      out.push(p);
    }
    return out;
  }
}

/** One policy-rule op over the rule list (ids are kept; `add` gets a fresh id). */
export function ruleOp(rules: PolicyRule[], c: Extract<ChatPlanRecord['changes'][number], { op: 'policy_rule' }>, newId: string): PolicyRule[] {
  if (c.action === 'add') return [...rules, { id: newId, text: c.rule?.text ?? 'Rule from chat', enabled: true, when: c.rule?.when ?? {}, boost: c.rule?.boost ?? 0 }];
  if (c.action === 'remove') return rules.filter((r) => r.id !== c.ruleId);
  return rules.map((r) => (r.id === c.ruleId ? { ...r, enabled: c.action === 'enable' } : r));
}
