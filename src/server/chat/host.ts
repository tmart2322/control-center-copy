/**
 * The chat host (BE-CHAT): what the chat tools may read and stage. Reads go through the public DataSource
 * methods (the same payloads the UI gets), so mock and db share them; writes are per DataSource
 * (`ChatHostBackend`): staging a proposal, enqueueing a scan, an Outbox draft, a prepared session, spend.
 * Nothing here sends, posts or writes to an external system.
 */
import type { ChatMessage, ChatModel } from '@/contract';
import type { GoogleTools } from '@/connectors/google/client';
import type { ChatBudget, ChatGoogleTool, ChatHost, ChatSourceHit, ChatSourceName, ChatUsageRecord, DraftInput, SessionInput, StageInput } from '@/llm/chat/types';
import { createResearchState, createResearchTools, type ResearchToolName } from '@/llm/research/tools';
import { personaOf, type ResolvedPersona } from '@/personas';

import type { DataSource } from '../datasource/types';
import { previewChanges, type ActivityLookup } from './changes';
import { buildContextPack } from './compact';
import { buildOrg62Query } from './org62';
import { chatReadPageAllowed, ChatReadArgsError, readPage } from './read';
import { appRead } from './app-routes';

export interface ChatHostBackend {
  readonly kind: 'mock' | 'db';
  timezone(): Promise<string>;
  history(threadId: string, excludeIds: string[]): Promise<ChatMessage[]>;
  stageChanges: ChatHost['stageChanges'];
  rescan: ChatHost['rescan'];
  scanStatus: ChatHost['scanStatus'];
  createDraft(input: DraftInput): ReturnType<ChatHost['createDraft']>;
  prepareSession(input: SessionInput): ReturnType<ChatHost['prepareSession']>;
  /** Time-page rows and opportunity names for `edit_activities` previews. */
  activityLookup?: ActivityLookup;
  /** The scan ledger / evidence: sources the app already recorded. */
  searchLedger(query: string, limit: number): Promise<ChatSourceHit[]>;
  /** The next logging batch (db only). */
  logBatch?: ChatHost['logBatch'];
  /** Deep research runs (db + live connectors only). */
  research?: ChatHost['research'];
  /** Live, read-only Org62 lookups (db + live connectors only). */
  org62Lookup?: ChatHost['org62Lookup'];
  /** D-58: the read-only Google client for the Assistant's live reads (db + live connectors only); closed after each call. */
  google?: () => Promise<GoogleTools & { close?: () => Promise<void> }>;
  /** D-58: load the scanners' Slack and Org62 MCP servers into the turn (db + live connectors only). */
  liveReads?: boolean;
  /** Read-only connector lookups (db + live connectors only). */
  searchConnectors?(query: string, sources: Exclude<ChatSourceName, 'ledger'>[], limit: number, signal?: AbortSignal): Promise<{ hits: ChatSourceHit[]; notes: string[] }>;
  budget(model: ChatModel): Promise<ChatBudget>;
  recordUsage(u: ChatUsageRecord): Promise<void>;
}

/**
 * Characters per page when the Assistant reads a Drive file or a Gmail thread (A6, 2026-11-13: a 40,000-character sheet
 * is one page; a longer one ends with the offset to read next). Sized under the Agent SDK's tool-output limit.
 */
export const CHAT_DRIVE_PAGE = 60_000;
export const CHAT_GMAIL_PAGE = 60_000;

/** The Assistant's Google reads are the research run's handlers (same allowlist, redaction and caps). */
const GOOGLE_HANDLER: Record<ChatGoogleTool, ResearchToolName> = {
  gmail_search: 'research_gmail_search',
  gmail_thread: 'research_gmail_thread',
  drive_search: 'research_drive_search',
  drive_read: 'research_drive_read',
  calendar_events: 'research_calendar_search',
};

export function createChatHost(ds: DataSource, b: ChatHostBackend, now: () => Date): ChatHost {
  let resolved: Promise<ResolvedPersona> | undefined; // one turn = one host: the persona is read once
  const persona = () => (resolved ??= ds.getSettings({} as never).then((s) => personaOf(s)));
  return {
    kind: b.kind,
    now,
    timezone: () => b.timezone(),
    async contextPack() {
      const [today, settings, outbox, health, tz] = await Promise.all([ds.getToday({} as never), ds.getSettings({} as never), ds.getOutbox({} as never), ds.getHealth({} as never), b.timezone()]);
      return buildContextPack({ now: now(), timezone: tz, today, settings, outbox, health });
    },
    async searchSources(query, o) {
      const notes: string[] = [];
      const hits: ChatSourceHit[] = [];
      if (o.sources.includes('ledger')) hits.push(...(await b.searchLedger(query, o.limit)));
      const live = o.sources.filter((s): s is Exclude<ChatSourceName, 'ledger'> => s !== 'ledger');
      if (live.length) {
        if (b.searchConnectors) {
          try {
            const r = await b.searchConnectors(query, live, o.limit, o.signal);
            hits.push(...r.hits);
            notes.push(...r.notes);
          } catch (err) {
            notes.push(`connector lookup failed: ${(err as Error).message.slice(0, 120)}`);
          }
        } else notes.push(`${live.join(', ')}: live connector lookups are not available here (${b.kind} mode); searched the ledger only`);
      }
      return { hits: hits.slice(0, o.limit * 2), notes };
    },
    // D-55: a page whose feature the persona has not activated is not read (the tool list doesn't offer it either)
    read: async (page, args, paging) => {
      if (!chatReadPageAllowed(page, await persona())) throw new ChatReadArgsError(`${page} is not in your role's preconfiguration (activate it in Settings ▸ Role & rules)`);
      return readPage(ds, page, args, { now: now(), ...(paging ? { paging } : {}) });
    },
    async appRead(route, raw, paging) {
      return appRead(ds, route, await persona(), raw, paging);
    },
    persona,
    liveReads: !!b.liveReads,
    async googleRead(tool, args, signal) {
      if (!b.google) return { text: `Live ${tool.split('_')[0]} reads aren't available here (${b.kind} mode): answer from the app's data and say so.`, ok: false, available: false };
      const g = await b.google();
      try {
        const handlers = createResearchTools({ google: g, ledger: null, signal, now, filePage: CHAT_DRIVE_PAGE, threadPage: CHAT_GMAIL_PAGE }, createResearchState());
        const r = await handlers[GOOGLE_HANDLER[tool]](args);
        return { text: r.text, ok: !r.isError, available: true };
      } catch (err) {
        return { text: `error: ${(err as Error).message ?? String(err)}`.slice(0, 300), ok: false, available: true };
      } finally {
        await g.close?.().catch(() => undefined);
      }
    },
    async findVdpAssets(input) {
      // the Assistant never raises its own budget: "Allow $N more today" is the user's click only
      const { allowUsd: _never, ...body } = input as typeof input & { allowUsd?: number };
      return (await ds.findVdpAssets({ body } as never)).entity;
    },
    async draftVdpUpdate(input) {
      const r = (await ds.draftVdpUpdate({ body: input } as never)).entity;
      return { draftId: r.draft.id, target: r.destination.target.label, changes: r.destination.changes };
    },
    async stageLogBatch(input) {
      return (await ds.stageLogBatch({ body: input } as never)).entity;
    },
    async reauth(source) {
      const want = source.trim().toLowerCase();
      const c = (await ds.getHealth({} as never)).connectors.find((x) => x.source === want || x.label.toLowerCase() === want || x.id === source);
      if (!c) return { found: false };
      const r = await ds.reauthConnector({ params: { id: c.id }, body: {} } as never);
      const how = r.action.kind === 'instructions' ? r.action.instructions : r.action.command ? `${r.action.label}: ${r.action.command}` : r.action.label;
      return { found: true, label: c.label, state: c.state, started: r.started, ...(how ? { how } : {}) };
    },
    async logBatch(input) {
      if (!b.logBatch) return { available: false, note: `Logging batches need the live database (${b.kind} mode)`, events: 0, hours: 0, updates: 0, approveCount: 0, canvases: [], skipped: [], discrepancies: [], recordTypeKnown: false, ownerKnown: false };
      return b.logBatch(input);
    },
    async research(input, o) {
      if (!b.research) return { output: null, error: { code: 'unavailable', message: `Live research is not available here (${b.kind} mode); answer from the app's data and say so` }, costUsd: 0, inputTokens: 0, outputTokens: 0, model: '', toolCalls: [], unavailable: ['Slack', 'Gmail', 'Calendar', 'Drive', 'Org62'], latencyMs: 0, skill: '' };
      return b.research(input, o);
    },
    async org62Lookup(input, signal) {
      const soql = buildOrg62Query(input);
      if (!b.org62Lookup) return { soql, rows: [], notes: [`Org62 live lookups are not available here (${b.kind} mode); read deals / account for the opportunities the app already has`], costUsd: 0 };
      return b.org62Lookup(input, signal);
    },
    history: (threadId, excludeIds) => b.history(threadId, excludeIds),
    previewChanges: (changes, threadId) => previewChanges(ds, changes, { now: now(), threadId, ...(b.activityLookup ? { activities: b.activityLookup } : {}) }),
    stageChanges: (i: StageInput) => b.stageChanges(i),
    rescan: (c, h) => b.rescan(c, h),
    scanStatus: (id) => b.scanStatus(id),
    createDraft: (i) => b.createDraft(i),
    prepareSession: (i) => b.prepareSession(i),
    budget: (m) => b.budget(m),
    recordUsage: (u) => b.recordUsage(u),
  };
}
