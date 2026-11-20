/**
 * BE-CHAT in db mode: the chat host backend and Apply / Dismiss / hydration for chat proposals.
 *
 * - Chat plans: kv `cc.chat.plan/<id>` (user_settings), written when the tool stages them. Apply runs every
 *   change in ONE change set with actor `chat` (plus one re-rank when needed), returns its id as `auditId`
 *   and a receipt; the plan is marked applied in a second, non-undoable write, so Undo reverts the changes
 *   and the card keeps its receipt (undo / redo through the receipt lines).
 * - Rescans: a RuntimeJob (`scan.<connector>`, mode manual, trigger chat) on the Postgres job queue; the
 *   card follows the job row and the scan run the worker records for it (scan_runs.job_id).
 * - Drafts: an Outbox draft (status ready, never sent). Sessions: a `launching` Claude session record with a
 *   claude:// deep link the UI opens on click.
 * - Spend: one `llm_calls` row per turn (purpose chat) + the day rollups + the Health spend projection.
 * Nothing here calls an external system, except the read-only Gmail / Drive lookups of `chat_search_sources`
 * when live connectors are on (CC_CHAT_LLM=1 and CC_CHAT_CONNECTORS≠0).
 */
import { insertLlmCall, ledgerHash } from '@/db/ledger';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ActivityEntry, AgentRun, ChatChange, ChatModel, ChatPart, ChatScan, Draft, Evidence, PolicyRule, PriorityPolicy, Proposal, Receipt, ReceiptChange, ReceiptFailure, Resolution, ResolutionDetail, SourceRef, WorkItemRecord } from '@/contract';
import { budgetsForDay, WorkItemPatch } from '@/contract';
import type { Db } from '@/db/client';
import { enqueueEnrich } from '@/jobs/handlers/enrich';
import { jobs as jobsTable, scanRuns as scanRunsTable } from '@/db/schema';
import { PgRuntimeJobQueue } from '@/jobs/runtime-queue';
import type { ChatSourceHit, ChatUsageRecord } from '@/llm/chat/types';
import { redactText } from '@/llm/redact';
import { scanJob } from '@/scanner/runtime/jobs';
import type { ConnectorId } from '@/scanner/types';
import { activityError, activityReceiptLines, changeError, editedActivity, needsRerank, RESOLUTION_LABEL, weightsWith } from '@/server/chat/changes';
import { appliedSummary, applyRouteCalls, type AppliedCalls, type RouteCall } from '@/server/chat/app-routes';
import type { ChatHostBackend } from '@/server/chat/host';
import type { DataSource } from '@/server/datasource/types';
import { personaOf } from '@/personas';
import { CHAT_PLAN_PREFIX, chatDraft, chatLimitsFromEnv, chatProposal, chatScan, chatSession, draftRef, findConnector, resolveRepoFolder, type ChatPlanRecord } from '@/server/chat/outputs';
import { refreshScanPart, scanIdOfPart } from '@/server/chat/turn';
import { AppError, invalid } from '@/server/errors';

import { ruleOp } from '../mock/chat-be6';
import { scanStatusFromDb, type DbRunStatus } from './enums';
import type { ReadModel } from './model';
import { insertSession } from './store/agents';
import { writeKv, type WriteCtx } from './store/common';
import { readSpend, writeSpend } from './store/health';
import { insertDraft } from './store/nba';
import { insertPolicyVersion } from './store/settings';
import { buildOrg62OppById, buildOrg62OppsByIds, buildOrg62OppSearch, buildOrg62Query, matchInApp, Org62LookupError, parseOrg62Rows, type Org62LookupInput, type Org62Row } from '@/server/chat/org62';
import { recordTypeKv } from '@/server/chat/record-type';
import { loggingProfile } from '@/engines/activity/persona';
import { runChatResearch, type ChatResearchInput } from '@/server/chat/research';
import { loadChatSkill } from '@/llm/chat/prompt';
import { canvasHolds } from '@/lib/canvas/payload';

import { buildLogBatch } from './store/log-batch';
import { appliedLogCanvases } from '../log-canvases';
import { logDiscrepancies } from './store/log-check';
import { runOneReadLookup } from '@/server/onboarding/identity';

import { updateActivity } from './store/time';
import { insertEvidence, insertWorkItem, logTransition, type WorkLinkTargets } from './store/work';

const planKey = (id: string) => `${CHAT_PLAN_PREFIX}${id}`;

/** Connector source → the scanner connector and the scope a chat rescan runs. */
const SCAN_SCOPE: Record<string, { connector: ConnectorId; scope: string }> = {
  slack: { connector: 'slack', scope: 'inbox' },
  gmail: { connector: 'gmail', scope: 'inbox' },
  calendar: { connector: 'calendar', scope: 'primary' },
  drive: { connector: 'drive', scope: 'tracked' },
  gemini: { connector: 'gemini_notes', scope: 'poll' },
  claude: { connector: 'claude_sessions', scope: 'all' },
  org62: { connector: 'org62', scope: 'opps' },
  vdp: { connector: 'vdp', scope: 'plans' },
};

const RECEIPT_FIELDS = new Set(['state', 'snoozedUntil', 'rank', 'resolution', 'title', 'purpose', 'due', 'startBy', 'effort', 'notes', 'kind', 'accountId', 'initiativeId', 'oppId', 'signals']);

interface MutMetaLite {
  action: string;
  summary: string;
  entity?: { type: string; id: string };
  actor?: 'chat';
  undoable?: boolean;
}

/** What the db DataSource lends BE-CHAT (bound private helpers). */
export interface DbChatKit {
  db: Db;
  now(): Date;
  userId(): Promise<string>;
  model(): Promise<ReadModel>;
  mutate<T>(m: MutMetaLite, fn: (w: WriteCtx, model: ReadModel) => Promise<T>): Promise<{ result: T; auditId: string; undoable: boolean }>;
  writeItem(w: WriteCtx, model: ReadModel, cur: WorkItemRecord, next: WorkItemRecord, o: { bump: boolean }): Promise<unknown>;
  rankedIds(): Promise<string[]>;
  rerankIn(w: WriteCtx, model: ReadModel, policy: PriorityPolicy, rankedIds: string[], now: Date, policyRowId?: string): Promise<unknown>;
  resolvedRecord(model: ReadModel, cur: WorkItemRecord, o: { reason: string; resolution: Resolution; detail: Partial<Omit<ResolutionDetail, 'inferred'>>; doneBy: 'user' | 'chat'; at: string }): WorkItemRecord;
  blankItem(now: string, me: { id: string; name: string }): WorkItemRecord;
  links(model: ReadModel): WorkLinkTargets;
  /** The ranker's #1 under `policy` (ids + scores, read from the in-memory model). */
  rankTop(model: ReadModel, policy: PriorityPolicy, now: Date): { id: string; score: number } | undefined;
  scoreOf(model: ReadModel, w: WorkItemRecord, policy: PriorityPolicy, now: Date): number;
  receipt(auditId: string, summary: string, filter: (table: string, field: string) => boolean): Promise<Receipt>;
  publish(tables: string[], ids: string[], reason: string): void;
  /** The one read-only Org62 / Slack call (default runOneReadLookup; tests inject a fake). */
  readLookup?: typeof runOneReadLookup;
  /** Live Org62 lookups outside a chat turn (the Time picker): the Assistant's gate, or a test's fake reader. */
  org62Live?: boolean;
}

export class DbChatBe6 {
  constructor(private readonly k: DbChatKit) {}

  private plan(model: ReadModel, id: string): ChatPlanRecord | undefined {
    return model.ctx.kv.get(planKey(id)) as ChatPlanRecord | undefined;
  }

  // ---------------------------------------------------------------------------
  // Host backend
  // ---------------------------------------------------------------------------

  backend(opts: { liveConnectors?: boolean } = {}): ChatHostBackend {
    const k = this.k;
    let tz: string | undefined; // one turn = one host: the profile timezone is read once
    return {
      kind: 'db',
      timezone: async () => (tz ??= (await k.model()).settings().profile.timezone),
      history: async (threadId, exclude) => {
        const m = await k.model();
        const t = m.get('chatThreads', threadId);
        return (t?.messages ?? []).filter((x) => !exclude.includes(x.id)).map((x) => ({ ...x, parts: this.hydrateSync(m, x.parts) }));
      },
      stageChanges: async (i) => {
        const id = randomUUID();
        const proposal = chatProposal({ id, entity: i.entity, lines: i.lines, reason: i.reason, at: k.now().toISOString() });
        const rec: ChatPlanRecord = { proposal, changes: i.changes, threadId: i.threadId, messageId: i.messageId };
        await k.mutate({ action: 'chat.propose', summary: `Proposed from chat: ${i.reason}`, entity: { type: 'chat_thread', id: i.threadId }, actor: 'chat', undoable: false }, async (w) => writeKv(w, planKey(id), rec));
        k.publish(['chat_threads'], [i.threadId], 'chat.propose');
        return proposal;
      },
      rescan: (connector, hours) => this.rescan(connector, hours),
      scanStatus: (scanId) => this.scanStatus(scanId),
      createDraft: async (i) => {
        const m = await k.model();
        const workItemId = i.workItemId && m.get('workItems', i.workItemId) ? i.workItemId : null;
        const d: Draft = chatDraft(i, { id: randomUUID(), now: k.now().toISOString(), mode: m.settings().sending.defaultMode, workItemId });
        const ref = draftRef(d, i);
        await k.mutate({ action: 'chat.draft', summary: `Draft for ${ref.to} (from chat)`, entity: { type: 'draft', id: d.id }, actor: 'chat' }, async (w) => {
          await insertDraft(w, d);
        });
        k.publish(['drafts'], [d.id], 'chat.draft');
        return ref;
      },
      prepareSession: async (i) => {
        const m = await k.model();
        const item = i.workItemId ? m.get('workItems', i.workItemId) : undefined;
        const repos = await k.db.execute<{ name: string; path: string }>(sql`select name, path from repos where owner_user_id = ${m.ctx.userId} and not ignored`).then((r) => r.rows).catch(() => []);
        const folder = resolveRepoFolder(i.repo, repos, m.meta().repoFolder ?? process.cwd());
        const runId = randomUUID();
        const now = k.now().toISOString();
        const title = i.title ?? (item ? item.title : `Claude session: ${i.prompt.split('\n')[0]!.slice(0, 60)}`);
        const s = chatSession(i, { id: runId, folder, now, workItemId: item?.id ?? null, title });
        const run: AgentRun = {
          id: runId,
          kind: 'claude_session',
          title,
          workItemId: item?.id ?? null,
          state: 'queued',
          startedAt: now,
          updatedAt: now,
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
        await k.mutate({ action: 'chat.session', summary: `Prepared a Claude session: ${title}`, entity: { type: 'agent_run', id: runId }, actor: 'chat' }, async (w, model) => {
          await insertSession(w, run, { launchedByApp: true, launchPrompt: s.prompt });
          model.put('agentRuns', run);
          if (item && !item.runIds.includes(runId)) await k.writeItem(w, model, item, { ...item, runIds: [...item.runIds, runId] }, { bump: true });
        });
        k.publish(['claude_sessions'], [runId], 'chat.session');
        return s;
      },
      searchLedger: (q, limit) => this.searchLedger(q, limit),
      logBatch: (i) => this.logBatch(i, opts.liveConnectors === true),
      activityLookup: async (entryIds, oppIds) => {
        const m = await this.k.model();
        return { entries: new Map(entryIds.flatMap((id) => { const e = m.get('activity', id); return e ? [[id, e] as const] : []; })), opps: this.oppNames(m, oppIds), taskTypes: [...m.extra.vocab.taskTypeByName.keys()] };
      },
      ...(opts.liveConnectors
        ? {
            searchConnectors: (q, sources, limit, signal) => searchGoogle(q, sources, limit, signal),
            org62Lookup: (i) => this.org62Lookup(i),
            research: (i, o) => this.research(i, o),
            // D-58: the Assistant's own live reads: the scanners' Slack / Org62 servers and the read-only Google client
            liveReads: true,
            google: async () => new (await import('@/connectors/google/client')).GoogleWorkspaceClient({ timeoutMs: 30_000, maxRetries: 0 }),
          }
        : {}),
      budget: (model) => this.budget(model),
      recordUsage: (u) => this.recordSpend(u),
    };
  }

  /**
   * One model call's spend (chat: a turn, or a sub-call such as the Org62 lookup): its `llm_calls` row, the day
   * rollups, and the Health spend projection. `requestKey` names a call outside a chat turn (the Time picker).
   */
  private async recordSpend(u: ChatUsageRecord, requestKey?: string) {
    const k = this.k;
    const userId = await k.userId();
    const m = await k.model();
    const day = localDay(k.now(), m.settings().profile.timezone);
    const status = u.status === 'budget_blocked' ? 'budget_blocked' : u.status === 'timeout' ? 'timeout' : u.status === 'error' ? 'error' : 'ok';
    const skill = u.skill ?? chatSkillTag();
    const requestHash = requestKey ?? `chat:${u.messageId}:${randomUUID()}`;
    // D0: one writer for the ledger. A chat call is always the user's own message (or a lookup it made); each turn
    // is its own content, so its hash names the turn. The day roll-up stays below (it also counts the chat line).
    await insertLlmCall(k.db, {
      ownerUserId: userId,
      purpose: 'chat',
      model: u.model,
      skillKey: skill.split('@')[0]!,
      promptVersion: skill,
      requestHash,
      chatMessageId: /^[0-9a-f-]{36}$/i.test(u.messageId) ? u.messageId : null,
      status,
      errorCode: u.errorCode ?? null,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costUsd: u.costUsd,
      costEstimated: u.estimated,
      latencyMs: u.latencyMs,
      budgetDay: day,
      startedAt: new Date(k.now().getTime() - u.latencyMs),
      finishedAt: k.now(),
      rollup: false,
      trigger: 'user_action',
      modelReason: 'default',
      contentHash: ledgerHash(u.model, skill, u.threadId, u.messageId, requestHash),
      outcome: u.errorCode ? `${status}:${u.errorCode}` : status,
    });
    if (!(u.costUsd > 0)) return;
    await k.db.execute(sql`
      insert into llm_budget_days (budget_id, day, spent_usd, call_count)
      select b.id, ${day}::date, ${u.costUsd}, 1 from llm_budgets b
       where b.owner_user_id = ${userId} and (b.scope = 'total' or (b.scope = 'purpose' and b.scope_value = 'chat'))
      on conflict (budget_id, day) do update set spent_usd = llm_budget_days.spent_usd + excluded.spent_usd,
                                                 call_count = llm_budget_days.call_count + 1, updated_at = now()`);
    // the Health spend projection (cc.spend): today, the chat line, the model line
    await k.mutate({ action: 'chat.spend', summary: 'Chat spend', entity: { type: 'settings', id: 'spend' }, actor: 'chat', undoable: false }, async (w, model) => {
      const sp = readSpend(model.ctx);
      const usd = Math.round((sp.today.usd + u.costUsd) * 1e6) / 1e6;
      const add = <T extends { usd: number }>(rows: T[], match: (r: T) => boolean, make: () => T) => (rows.some(match) ? rows.map((r) => (match(r) ? { ...r, usd: Math.round((r.usd + u.costUsd) * 1e6) / 1e6 } : r)) : [...rows, make()]);
      const soft = sp.today.softBudgetUsd || model.settings().budgets.softUsd;
      await writeSpend(w, {
        ...sp,
        today: { ...sp.today, usd, softBudgetUsd: soft, hardCapUsd: sp.today.hardCapUsd || model.settings().budgets.hardUsd, pct: soft > 0 ? Math.round((usd / soft) * 100) : 0 },
        byScanner: add(sp.byScanner, (r) => r.name === 'chat', () => ({ name: 'chat', usd: u.costUsd })),
        byModel: add(sp.byModel, (r) => r.model === u.model, () => ({ model: u.model, usd: u.costUsd })),
      });
    });
  }

  private async budget(model: ChatModel) {
    const userId = await this.k.userId();
    const m = await this.k.model();
    const day = localDay(this.k.now(), m.settings().profile.timezone);
    const lim = chatLimitsFromEnv(process.env, model, m.settings().chat);
    const r = await this.k.db.execute<{ chat: string | null; total: string | null }>(sql`
      select (select coalesce(sum(cost_usd), 0) from llm_calls where owner_user_id = ${userId} and budget_day = ${day}::date and purpose = 'chat') as chat,
             (select coalesce(sum(cost_usd), 0) from llm_calls where owner_user_id = ${userId} and budget_day = ${day}::date and budget = 'daily') as total -- BUD-1`);
    const row = r.rows[0] ?? { chat: '0', total: '0' };
    const eff = budgetsForDay(m.settings().budgets, day);
    const spend = readSpend(m.ctx);
    return {
      chatTodayUsd: Number(row.chat ?? 0),
      // "Today only" raises the assistant's day line too, unless env pins it (tests, ops).
      chatDailyUsd: eff.chatUsd != null && process.env.CC_CHAT_DAILY_USD === undefined ? eff.chatUsd : lim.chatDailyUsd,
      totalTodayUsd: Math.max(Number(row.total ?? 0), spend.today.usd),
      hardCapUsd: eff.hardUsd,
      perMessageUsd: lim.perMessageUsd,
      maxTurns: lim.maxTurns,
      researchUsd: lim.researchUsd,
    };
  }

  private async searchLedger(q: string, limit: number): Promise<ChatSourceHit[]> {
    const userId = await this.k.userId();
    const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3).slice(0, 6);
    if (!tokens.length) return [];
    const like = sql.join(
      tokens.map((t) => sql`(coalesce(s.title, '') || ' ' || coalesce(s.excerpt, '')) ilike ${`%${t}%`}`),
      sql` or `,
    );
    const rows = await this.k.db
      .execute<{ source: string; kind: string; title: string | null; excerpt: string | null; url: string | null; external_id: string; at: Date | null; work_item_id: string | null; work_item_title: string | null }>(
        sql`select s.source::text as source, s.kind::text as kind, s.title, s.excerpt, s.url, s.external_id, s.occurred_at as at,
                   e.work_item_id, w.title as work_item_title
              from source_items s
              left join lateral (select work_item_id from work_item_evidence ev where ev.source_item_id = s.id order by ev.created_at desc limit 1) e on true
              left join work_items w on w.id = e.work_item_id
             where s.owner_user_id = ${userId} and (${like})
             order by s.occurred_at desc nulls last
             limit ${Math.max(1, Math.min(50, limit * 3))}`,
      )
      .then((r) => r.rows)
      .catch(() => []);
    const score = (s: string) => tokens.filter((t) => s.toLowerCase().includes(t)).length;
    return rows
      .map((r) => ({ r, s: score(`${r.title ?? ''} ${r.excerpt ?? ''}`) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ r }) => ({
        source: (r.source === 'google_drive' ? 'drive' : r.source === 'google_calendar' ? 'calendar' : r.source) as ChatSourceHit['source'],
        kind: r.kind,
        title: redactText(r.title ?? r.external_id).slice(0, 160),
        excerpt: redactText(r.excerpt ?? '').slice(0, 240),
        url: r.url,
        externalId: r.external_id,
        at: r.at ? new Date(r.at).toISOString() : null,
        workItemId: r.work_item_id,
        workItemTitle: r.work_item_title,
      }));
  }

  // ---------------------------------------------------------------------------
  // Rescans (a RuntimeJob on the Postgres queue; the worker runs it)
  // ---------------------------------------------------------------------------

  private async rescan(connector: string, hours: number): Promise<ChatScan> {
    const m = await this.k.model();
    const c = findConnector(m.all('connectors'), connector);
    if (!c) throw invalid(`Unknown connector "${connector}" (one of ${m.all('connectors').map((x) => x.source).join(', ')})`);
    const now = this.k.now();
    const window = { from: new Date(now.getTime() - hours * 3_600_000).toISOString(), to: now.toISOString() };
    const conn = { id: c.id, label: c.label, source: c.source };
    if (c.state === 'auth_needed') return chatScan({ id: randomUUID(), connector: conn, windowHours: hours, window, jobId: null, jobStatus: null, run: null, now: now.toISOString(), authBroken: true });
    const target = SCAN_SCOPE[c.source];
    if (!target) throw invalid(`${c.label} has no scan from chat`);
    const job = scanJob({ connector: target.connector, scope: target.scope, window, mode: 'manual', trigger: 'chat', runAt: now.toISOString() });
    const userId = await this.k.userId();
    await new PgRuntimeJobQueue(this.k.db, userId).enqueue([job]);
    const [row] = await this.k.db.select({ id: jobsTable.id, status: jobsTable.status }).from(jobsTable).where(and(eq(jobsTable.ownerUserId, userId), eq(jobsTable.dedupeKey, job.dedupeKey))).orderBy(desc(jobsTable.id)).limit(1);
    if (!row) throw new AppError('internal', 'scan job was not enqueued');
    this.k.publish(['jobs'], [String(row.id)], 'chat.scan');
    return chatScan({ id: String(row.id), connector: conn, windowHours: hours, window, jobId: String(row.id), jobStatus: row.status === 'queued' ? 'queued' : (row.status as 'running'), run: null, now: now.toISOString() });
  }

  async scanStatus(scanId: string): Promise<ChatScan | null> {
    if (!/^\d+$/.test(scanId)) return null;
    const userId = await this.k.userId();
    const [j] = await this.k.db.select().from(jobsTable).where(and(eq(jobsTable.id, Number(scanId)), eq(jobsTable.ownerUserId, userId)));
    if (!j) return null;
    const p = j.payload as { kind?: string; connector?: string; window?: { from: string; to: string } };
    if (p.kind !== 'scan' || !p.window) return null;
    const [r] = await this.k.db.select().from(scanRunsTable).where(eq(scanRunsTable.jobId, j.id)).orderBy(desc(scanRunsTable.startedAt)).limit(1);
    const m = await this.k.model();
    const source = Object.entries(SCAN_SCOPE).find(([, v]) => v.connector === p.connector)?.[0] ?? p.connector ?? '';
    const c = m.all('connectors').find((x) => x.source === source);
    const hours = Math.max(1, Math.round((Date.parse(p.window.to) - Date.parse(p.window.from)) / 3_600_000));
    return chatScan({
      id: scanId,
      connector: { id: c?.id ?? source, label: c?.label ?? source, source: (c?.source ?? null) as ChatScan['source'] },
      windowHours: hours,
      window: p.window,
      jobId: scanId,
      jobStatus: j.status,
      run: r ? { id: r.id, status: scanStatusFromDb(r.status as DbRunStatus, r.errorCode), itemsSeen: r.itemsSeen, itemsNew: r.itemsNew, itemsChanged: r.itemsUpdated, error: r.errorMessage } : null,
      now: this.k.now().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Apply / Dismiss
  // ---------------------------------------------------------------------------

  async apply(pid: string, ds: DataSource): Promise<{ entity: Proposal; auditId: string | null; receipt: Receipt } | null> {
    const m0 = await this.k.model();
    const plan = this.plan(m0, pid);
    if (!plan) return null;
    if (plan.proposal.status !== 'pending') throw invalid(`Proposal is ${plan.proposal.status}`);
    const now = this.k.now();
    const at = now.toISOString();
    // D-58: app route calls run after the edits, each through the DataSource (its own change set, Undo all reverts them).
    const calls = plan.changes.filter((c): c is RouteCall => c.op === 'route_call');
    const all = plan.changes.filter((c) => c.op !== 'route_call');
    // A3 (2026-11-13): Apply lands what works. An edit that no longer fits (closed since, a row logged since) is listed
    // with its reason and the rest land; nothing is rolled back for one bad line.
    const failed: ReceiptFailure[] = [];
    const edits = all.filter((c) => {
      const err = editConflict(c, m0, now);
      if (err) failed.push({ label: changeLabel(c, m0), reason: `Changed since it was proposed: ${err}` });
      return !err;
    });
    const rankedIds = needsRerank(edits) ? await this.k.rankedIds() : [];
    const created: WorkItemRecord[] = [];
    const linked: Array<{ ev: Evidence; item: WorkItemRecord }> = [];
    const actEdits: Array<{ cur: ActivityEntry; next: ActivityEntry }> = [];
    const summary = `Applied from chat: ${plan.proposal.reason}`;
    const r = !edits.length ? null : await this.k.mutate({ action: 'chat.apply', summary, entity: { type: plan.proposal.entity.type, id: plan.proposal.entity.id }, actor: 'chat' }, async (w, model) => {
      for (const c of edits) {
        const err = editConflict(c, model, now);
        if (err) throw new AppError('conflict', `Changed since it was proposed: ${err}`, { current: 'itemId' in c ? (model.get('workItems', c.itemId) ?? null) : null });
      }
      let policy: PriorityPolicy | undefined;
      let rowId: string | undefined;
      if (edits.some((c) => c.op === 'policy_weights' || c.op === 'policy_rule')) {
        const s = model.settings();
        let weights = s.policy.weights;
        let rules: PolicyRule[] = [...s.policy.rules];
        for (const c of edits) {
          if (c.op === 'policy_weights') weights = weightsWith(weights, c.deltas);
          else if (c.op === 'policy_rule') rules = ruleOp(rules, c, `rule_${randomUUID().slice(0, 8)}`);
        }
        policy = { ...s.policy, version: s.policy.version + 1, weights, rules, updatedAt: at, note: plan.proposal.reason };
        rowId = await insertPolicyVersion(w, policy, { at, by: 'chat', note: plan.proposal.reason, activate: true, changeSetId: w.cs.id });
      }
      for (const c of edits) if (c.op !== 'pin') await this.applyOne(w, model, c, at, created, linked, actEdits);
      // pins last, against the plan's own policy and edits, so "#1" holds after the re-rank
      for (const c of edits) if (c.op === 'pin') await this.pin(w, model, c.itemId, policy ?? model.settings().policy, now);
      if (needsRerank(edits)) await this.k.rerankIn(w, model, policy ?? model.settings().policy, rankedIds, now, rowId);
    });
    const editAudit = r && (r.undoable || created.length || linked.length || actEdits.length) ? r.auditId : null;
    if (!editAudit && edits.length && !calls.length && !failed.length) throw invalid('Nothing to apply: everything is already as proposed');
    const routed: AppliedCalls = calls.length ? await applyRouteCalls(ds, calls, personaOf(m0.settings())) : { lines: [], auditIds: [], failed: [], landed: 0 };
    failed.push(...routed.failed);
    const total = all.length + calls.length;
    // nothing landed at all: the card stays pending (Retry apply), and the error says why
    if (!editAudit && !routed.landed && failed.length) throw new AppError('conflict', `Nothing was applied: ${failed.map((f) => `${f.label}: ${f.reason}`).slice(0, 3).join('; ')}${failed.length > 3 ? ` (and ${failed.length - 3} more)` : ''}`);
    const base = editAudit ? await this.k.receipt(editAudit, summary, (table, f) => (table === 'work_items' ? RECEIPT_FIELDS.has(f) : table === 'priority_policies')) : null;
    const lines: ReceiptChange[] = [
      ...(base?.changes ?? []),
      ...(editAudit
        ? [
            ...created.map((w): ReceiptChange => ({ auditId: editAudit, entity: { type: 'work_item', id: w.id, label: w.title, href: `/work/${w.id}` }, field: 'state', label: 'Created', before: null, after: w.state })),
            ...linked.map(({ ev, item }): ReceiptChange => ({ auditId: editAudit, entity: { type: 'work_item', id: item.id, label: item.title, href: `/work/${item.id}` }, field: 'evidence', label: 'Evidence', before: null, after: ev.source.label })),
            ...actEdits.flatMap(({ cur, next }) => activityReceiptLines(editAudit, cur, next)),
          ]
        : []),
      ...routed.lines,
    ];
    const auditId = editAudit ?? routed.auditIds.at(-1) ?? null;
    const outcome = { ...(failed.length ? { failed, summary: `${appliedSummary(total - failed.length, total, failed)}. ${plan.proposal.reason}` } : { summary }), total };
    const receipt: Receipt = base ? { ...base, actor: 'chat', changes: lines, ...outcome } : { id: randomUUID(), at, actor: 'chat', changes: lines, staged: false, ...outcome };
    const applied: Proposal = { ...plan.proposal, status: 'applied', resolvedAt: at };
    await this.k.mutate({ action: 'chat.plan', summary: `Chat proposal applied: ${plan.proposal.reason}`, entity: { type: 'chat_thread', id: plan.threadId }, actor: 'chat', undoable: false }, async (w) =>
      writeKv(w, planKey(pid), { ...plan, proposal: applied, receipt, ...(auditId ? { auditId } : {}) } satisfies ChatPlanRecord),
    );
    this.k.publish(['chat_threads', 'work_items'], [plan.threadId], 'chat.apply');
    return { entity: applied, auditId, receipt };
  }

  async reject(pid: string): Promise<{ entity: Proposal; auditId: null } | null> {
    const m = await this.k.model();
    const plan = this.plan(m, pid);
    if (!plan) return null;
    if (plan.proposal.status !== 'pending') throw invalid(`Proposal is ${plan.proposal.status}`);
    const rejected: Proposal = { ...plan.proposal, status: 'rejected', resolvedAt: this.k.now().toISOString() };
    await this.k.mutate({ action: 'chat.dismiss', summary: `Chat proposal dismissed: ${plan.proposal.reason}`, entity: { type: 'chat_thread', id: plan.threadId }, actor: 'chat', undoable: false }, async (w) =>
      writeKv(w, planKey(pid), { ...plan, proposal: rejected } satisfies ChatPlanRecord),
    );
    this.k.publish(['chat_threads'], [plan.threadId], 'chat.dismiss');
    return { entity: rejected, auditId: null };
  }

  /** Boost an item until the ranker puts it first (score gap + 1, doubled until it holds; 8 tries). */
  private async pin(w: WriteCtx, model: ReadModel, itemId: string, policy: PriorityPolicy, now: Date) {
    const cur = model.get('workItems', itemId)!;
    const top = this.k.rankTop(model, policy, now);
    let boost = top && top.id !== cur.id ? Math.max(1, Math.ceil(top.score - this.k.scoreOf(model, cur, policy, now) + 1)) : 0;
    let next = cur;
    for (let i = 0; i < 8 && boost > 0; i++) {
      next = { ...cur, signals: { ...cur.signals, boost: cur.signals.boost + boost } };
      model.put('workItems', next);
      if (this.k.rankTop(model, policy, now)?.id === cur.id) break;
      boost *= 2;
    }
    model.put('workItems', cur);
    if (next !== cur) await this.k.writeItem(w, model, cur, next, { bump: true });
  }

  /**
   * The next logging batch: work orders, skips, the Org62 check. A preview, so it reads only: no Org62 lookup and no kv
   * write (D-58 fix). An unknown record type stays a placeholder here; staging the batch looks it up and keeps it.
   */
  private async logBatch(i: { from?: string; to?: string; includeProposed?: boolean }, _live: boolean) {
    const userId = await this.k.userId();
    const m = await this.k.model();
    const tz = m.settings().profile.timezone;
    const logging = m.settings().time.logging;
    // D-55: the persona's record type, cached per record type. A preview reads only (D-58): no lookup, no kv write;
    // staging the batch looks it up and keeps it.
    const profile = loggingProfile(personaOf(m.settings()));
    const recordTypeId = logging.org62RecordTypeId ?? ((m.ctx.kv.get(recordTypeKv(profile.recordType)) as string | undefined) ?? null);
    const now = this.k.now();
    const b = await buildLogBatch(this.k.db, userId, { now, timezone: tz, approveComplete: i.includeProposed ?? logging.approveComplete, recordTypeId: recordTypeId ?? `(${profile.recordTypeName} record type: not found yet)`, held: canvasHolds(m.all('drafts')), logging: profile, ...(i.from ? { from: i.from } : {}), ...(i.to ? { to: i.to } : {}) });
    const disc = await logDiscrepancies(this.k.db, userId, { now, timezone: tz });
    return {
      available: true,
      mode: logging.mode,
      canvasStyle: logging.canvas,
      events: b.events,
      hours: b.hours,
      updates: b.updates,
      approveCount: b.approveIds.length,
      canvases: b.canvases.map((c) => ({ part: c.part, parts: c.parts, title: c.title, rows: c.eventIds.length, hours: c.hours, updates: c.updates, chars: c.markdown.length, preview: c.markdown.split('\n').slice(0, 14).join('\n') })),
      skipped: b.skipped,
      waiting: b.waiting,
      discrepancies: disc.map(({ id, date, description, kind, detail }) => ({ id, date, description, kind, detail })),
      recordTypeKnown: !!recordTypeId,
      ownerKnown: !!b.owner,
      // the canvases already applied (created in Slack), with their link and where their rows are (Time's receipts)
      applied: appliedLogCanvases(m.all('drafts'), m.all('activity'), now),
    };
  }

  /** One question-scoped research run over live Slack, Gmail, Calendar, Drive and Org62 (src/server/chat/research.ts). */
  private async research(i: ChatResearchInput, o: { costCapUsd: number; signal: AbortSignal; onTool?: (fullName: string) => void }) {
    const userId = await this.k.userId();
    const m = await this.k.model();
    const { GoogleWorkspaceClient } = await import('@/connectors/google/client');
    const { dbLedgerSearch } = await import('./readin');
    return runChatResearch(i, {
      db: this.k.db,
      userId,
      now: this.k.now(),
      timezone: m.settings().profile.timezone,
      google: new GoogleWorkspaceClient({ timeoutMs: 30_000, maxRetries: 0 }),
      ledger: dbLedgerSearch(this.k.db, userId),
      costCapUsd: o.costCapUsd,
      signal: o.signal,
      ...(o.onTool ? { onTool: o.onTool } : {}),
    });
  }

  /** One live soqlQuery built from fixed fields (src/server/chat/org62.ts), matched to the app's opps and accounts. */
  private async org62Lookup(i: Org62LookupInput) {
    return this.org62Soql(buildOrg62Query(i), i.find);
  }

  /** Run one SELECT through the read-only lookup (the scan allowlist's soqlQuery), parsed and matched to the app. */
  private async org62Soql(soql: string, find: Org62LookupInput['find']) {
    const started = Date.now();
    const r = await (this.k.readLookup ?? runOneReadLookup)({ connector: 'org62', tool: 'soqlQuery', args: { q: soql } }, { skillPath: 'skills/read-lookup.md', timeoutMs: 60_000 });
    const usage = { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, status: r.code === 'timeout' ? ('timeout' as const) : r.text === null ? ('error' as const) : ('ok' as const), ...(r.text === null ? { errorCode: r.code } : {}), latencyMs: Date.now() - started };
    if (r.text === null) return { soql, rows: [] as Org62Row[], notes: [`The Org62 lookup did not finish: ${r.message}`], costUsd: r.costUsd, usage };
    const m = await this.k.model();
    const rows = matchInApp(
      parseOrg62Rows(r.text, find),
      m.all('opps').map((o) => ({ id: o.id, accountId: o.accountId, org62Url: o.org62Url, isMine: o.isMine, myDc: o.myDc, dcAssigned: o.dcAssigned })),
      m.all('accounts').map((a) => ({ id: a.id, org62Url: a.org62Url })),
    );
    return { soql, rows, notes: rows.length ? [] : ['Nothing in Org62 matches.'], costUsd: r.costUsd, usage };
  }

  /**
   * The Time picker's Org62 reads (outside a chat turn): live only behind the Assistant's own gate (CC_CHAT_LLM=1,
   * connectors on) and while the Assistant's day budget lasts; the spend is recorded like the Assistant's lookup
   * (purpose chat, skill read-lookup@1). `search` is the picker's word search; `byId` re-reads one picked record;
   * `byIds` reads several in one SELECT (adding untracked opps, e.g. to claim DCs on them).
   */
  async pickerOrg62(op: { search: string } | { byId: string } | { byIds: readonly string[] }): Promise<{ rows: Org62Row[]; notes: string[]; live: boolean; costUsd?: number }> {
    if (!this.k.org62Live) return { rows: [], notes: ['Org62 live lookups are not available here: the Assistant is off (CC_CHAT_LLM) or its connectors are (CC_CHAT_CONNECTORS=0).'], live: false };
    let soql: string;
    try {
      soql = 'search' in op ? buildOrg62OppSearch(op.search) : 'byIds' in op ? buildOrg62OppsByIds(op.byIds) : buildOrg62OppById(op.byId);
    } catch (e) {
      if (e instanceof Org62LookupError) throw invalid(`Can't search Org62 like that: ${e.message}`);
      throw e;
    }
    const m = await this.k.model();
    const b = await this.budget(m.settings().chat.defaultModel);
    if (b.chatTodayUsd >= b.chatDailyUsd) return { rows: [], notes: [`Today's Assistant budget ($${b.chatDailyUsd.toFixed(2)}) is used up: raise it in Settings ▸ Budgets ▸ Assistant limits, or try again tomorrow.`], live: true };
    const r = await this.org62Soql(soql, 'opportunities');
    await this.recordSpend({ threadId: '', messageId: randomUUID(), ...r.usage, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: r.costUsd, estimated: false, skill: 'read-lookup@1' }, `${'byIds' in op ? 'deals:add-org62-opps' : 'time:opp-picker'}:${randomUUID()}`).catch(() => undefined);
    return { rows: r.rows, notes: r.notes, live: true, costUsd: r.costUsd ?? 0 };
  }

  /** Opportunity id → its name and account (for previews and Time-page rows). */
  private oppNames(m: ReadModel, ids: string[]) {
    return new Map(
      ids.flatMap((id) => {
        const o = m.get('opps', id);
        return o ? [[id, { name: o.name, accountName: m.get('accounts', o.accountId)?.name ?? null }] as const] : [];
      }),
    );
  }

  private async applyOne(w: WriteCtx, model: ReadModel, c: ChatPlanRecord['changes'][number], at: string, created: WorkItemRecord[], linked: Array<{ ev: Evidence; item: WorkItemRecord }>, actEdits: Array<{ cur: ActivityEntry; next: ActivityEntry }> = []) {
    const cur = 'itemId' in c ? model.get('workItems', c.itemId)! : undefined;
    const write = async (next: WorkItemRecord, reason?: string) => {
      await this.k.writeItem(w, model, cur!, next, { bump: true });
      if (reason) await logTransition(w, cur!.id, cur!.state, next.state, reason);
    };
    switch (c.op) {
      case 'pin': // handled by pin(), after the other changes
      case 'rerank':
      case 'policy_weights':
      case 'policy_rule':
        return;
      case 'snooze':
        return write({ ...cur!, state: 'snoozed', snoozedUntil: c.until, snoozedFrom: cur!.state === 'snoozed' ? cur!.snoozedFrom : cur!.state }, 'Snoozed (asked in chat)');
      case 'done':
        return write(this.k.resolvedRecord(model, cur!, { reason: 'Done (asked in chat)', resolution: 'done_by_me', detail: c.note ? { note: c.note } : {}, doneBy: 'chat', at }), 'Done (asked in chat)');
      case 'resolve': {
        const detail: Partial<Omit<ResolutionDetail, 'inferred'>> = { ...(c.personName ? { personName: c.personName } : {}), ...(c.relatedItemId ? { relatedItemId: c.relatedItemId } : {}), ...(c.note ? { note: c.note } : {}) };
        const label = `${c.personName ? `${RESOLUTION_LABEL[c.resolution]} (${c.personName})` : RESOLUTION_LABEL[c.resolution]} (asked in chat)`;
        return write(this.k.resolvedRecord(model, cur!, { reason: label, resolution: c.resolution, detail, doneBy: 'chat', at }), label);
      }
      case 'reopen':
        return write({ ...cur!, state: 'reopened', doneAt: null, doneBy: null, closedReason: null, dismissed: null, resolution: null, resolutionDetail: null, involvement: 'owner', reopened: { reason: c.reason ?? 'Reopened from chat', at } }, c.reason ?? 'Reopened from chat');
      case 'link_evidence': {
        const src: SourceRef = { kind: c.source.kind, label: c.source.label, ...(c.source.url ? { url: c.source.url } : {}), ...(c.source.externalId ? { externalId: c.source.externalId } : {}), at };
        const ev: Evidence = { id: randomUUID(), workItemId: cur!.id, role: c.role ?? 'context', source: src, at, summary: c.summary, snippet: null, author: null, isNew: false, confidence: null };
        await insertEvidence(w, ev, cur!.seenAt, 'chat');
        linked.push({ ev, item: cur! });
        return;
      }
      case 'create_item': {
        const rec: WorkItemRecord = {
          ...this.k.blankItem(at, model.ctx.me),
          id: randomUUID(),
          kind: c.kind ?? 'task',
          state: c.snoozeUntil ? 'snoozed' : 'open',
          snoozedUntil: c.snoozeUntil ?? null,
          snoozedFrom: c.snoozeUntil ? 'open' : null,
          title: c.title.replace(/\s+/g, ' ').trim(),
          purpose: c.purpose ?? null,
          due: c.due ?? null,
          accountId: c.accountId && model.get('accounts', c.accountId) ? c.accountId : null,
          initiativeId: c.initiativeId && model.get('initiatives', c.initiativeId) ? c.initiativeId : null,
          effort: { youMin: c.effortMin ?? 15, agentMin: 0 },
          confidence: 'sure',
          why: 'Created from chat',
          sources: [{ kind: 'manual', label: 'Chat', at }],
          signals: { customerFacing: !!c.accountId, fromManager: false, boost: 0 },
          userLockedFields: [],
          reevaluating: false,
          seenAt: at,
          enrichment: { status: 'enriching', startedAt: at, chips: [] },
        };
        await insertWorkItem(w, rec, this.k.links(model), { locks: [] });
        await insertEvidence(w, { id: randomUUID(), workItemId: rec.id, role: 'origin', source: { kind: 'manual', label: 'Chat', at }, at, summary: rec.why, snippet: null, author: null, isNew: false, confidence: null }, at, 'chat');
        await enqueueEnrich(w.tx, w.userId, rec.id);
        model.put('workItems', rec);
        created.push(rec);
        return;
      }
      case 'edit_fields': {
        const patch = WorkItemPatch.parse(c.patch);
        return write({ ...cur!, ...patch } as WorkItemRecord); // no user locks: the Apply was the approval
      }
      case 'edit_activities': {
        const opp = c.patch.oppId ? this.oppNames(model, [c.patch.oppId]).get(c.patch.oppId) : undefined;
        for (const id of c.entryIds) {
          const before = model.get('activity', id)!;
          const { next, locked } = editedActivity(before, c.patch, opp);
          const oppAccount = next.oppId ? (model.get('accounts', model.get('opps', next.oppId)?.accountId ?? '')?.name ?? null) : null;
          await updateActivity(w, model.extra.vocab, before, next, { bump: true, lock: locked }, oppAccount);
          actEdits.push({ cur: before, next });
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read-time hydration
  // ---------------------------------------------------------------------------

  /** Chat proposals → current status (+ the applied receipt right after the card). */
  hydrateSync(m: ReadModel, parts: ChatPart[]): ChatPart[] {
    if (!parts.some((p) => p.type === 'proposal')) return parts;
    const out: ChatPart[] = [];
    for (const p of parts) {
      const plan = p.type === 'proposal' ? this.plan(m, p.proposal.id) : undefined;
      if (p.type !== 'proposal' || !plan) {
        out.push(p);
        continue;
      }
      out.push({ ...p, proposal: plan.proposal, status: plan.proposal.status === 'pending' ? 'pending' : plan.proposal.status === 'applied' ? 'applied' : 'dismissed' });
      if (plan.receipt && !parts.some((x) => x.type === 'receipt' && x.receipt.id === plan.receipt!.id)) out.push({ type: 'receipt', receipt: plan.receipt });
    }
    return out;
  }

  /** hydrateSync plus scan rows refreshed from the job / scan-run tables. */
  async hydrate(m: ReadModel, parts: ChatPart[]): Promise<ChatPart[]> {
    const out = this.hydrateSync(m, parts);
    if (!out.some((p) => scanIdOfPart(p))) return out;
    return Promise.all(
      out.map(async (p) => {
        const scanId = scanIdOfPart(p);
        if (!scanId || p.type !== 'tool') return p;
        const scan = await this.scanStatus(scanId).catch(() => null);
        return scan ? refreshScanPart(p, scan) : p;
      }),
    );
  }
}

/** Why a staged edit can't land now (closed since, a row logged since): null when it still fits. */
function editConflict(c: ChatChange, model: ReadModel, now: Date): string | null {
  const cur = 'itemId' in c ? (model.get('workItems', c.itemId) ?? null) : null;
  const err = changeError(c, cur, now);
  if (err) return err;
  if (c.op === 'edit_activities')
    for (const id of c.entryIds) {
      const e = activityError(id, model.get('activity', id), c.patch.oppId ? !!model.get('opps', c.patch.oppId) : null, c.patch, [...model.extra.vocab.taskTypeByName.keys()]);
      if (e) return e;
    }
  return null;
}

/** A failed edit's line on the receipt: the item or rows it was for. */
function changeLabel(c: ChatChange, model: ReadModel): string {
  if ('itemId' in c) return `${c.op} · ${model.get('workItems', c.itemId)?.title ?? c.itemId}`;
  if (c.op === 'edit_activities') return `Time rows · ${c.entryIds.length} row${c.entryIds.length === 1 ? '' : 's'}`;
  return c.op.replace(/_/g, ' ');
}

/** YYYY-MM-DD of `d` in `tz` (the budget day). */
function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Read-only Gmail / Drive search through the devbar Google read-only MCP (allowlist enforced by the client). */
async function searchGoogle(q: string, sources: Array<'gmail' | 'drive'>, limit: number, signal?: AbortSignal): Promise<{ hits: ChatSourceHit[]; notes: string[] }> {
  const { GoogleWorkspaceClient } = await import('@/connectors/google/client');
  const { parseDriveSearch, parseGmailBatch, parseGmailSearch } = await import('@/connectors/google/parse');
  const g = new GoogleWorkspaceClient({ timeoutMs: 15_000, maxRetries: 0 });
  const hits: ChatSourceHit[] = [];
  const notes: string[] = [];
  const n = Math.max(1, Math.min(10, limit));
  try {
    if (sources.includes('gmail')) {
      try {
        const page = parseGmailSearch(await g.call('search_gmail_messages', { query: q, page_size: n }, { signal }));
        const ids = page.hits.slice(0, n).map((h) => h.id);
        const msgs = ids.length ? parseGmailBatch(await g.call('get_gmail_messages_content_batch', { message_ids: ids, format: 'full' }, { signal })) : [];
        for (const msg of msgs) hits.push({ source: 'gmail', kind: 'email', title: redactText(msg.subject || '(no subject)').slice(0, 160), excerpt: redactText(`${msg.from}`).slice(0, 160), url: msg.webLink ?? page.hits.find((h) => h.id === msg.id)?.webLink ?? null, externalId: msg.id, at: msg.dateIso ?? null, workItemId: null, workItemTitle: null });
      } catch (err) {
        notes.push(`gmail lookup failed (${(err as Error).name})`);
      }
    }
    if (sources.includes('drive')) {
      try {
        const safe = q.replace(/['\\]/g, ' ').slice(0, 120);
        const page = parseDriveSearch(await g.call('search_drive_files', { query: `fullText contains '${safe}' and trashed = false`, detailed: true, page_size: n }, { signal }));
        for (const f of page.files.slice(0, n)) hits.push({ source: 'drive', kind: f.mimeType.split('.').pop() ?? 'file', title: redactText(f.name).slice(0, 160), excerpt: f.lastEditedByName ? `Last edited by ${f.lastEditedByName}` : '', url: f.link ?? null, externalId: f.id, at: f.modified ?? null, workItemId: null, workItemTitle: null });
      } catch (err) {
        notes.push(`drive lookup failed (${(err as Error).name})`);
      }
    }
  } finally {
    await (g as unknown as { close?: () => Promise<void> }).close?.().catch(() => undefined);
  }
  return { hits, notes };
}

/** The chat skill's `<skill>@<version>` (llm_calls.prompt_version for a turn recorded without one). */
function chatSkillTag(): string {
  try {
    return loadChatSkill().versionTag;
  } catch {
    return 'chat-assistant';
  }
}
