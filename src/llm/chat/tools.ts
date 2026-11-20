/**
 * The chat tools (BE-CHAT): in-process, zod-validated, read or stage only.
 *
 *   reads      chat_app_read (every page and read route of the app, paged: src/server/chat/read.ts, app-routes.ts) ·
 *              chat_search_sources (the scan ledger, read-only Gmail / Drive search) ·
 *              chat_org62_lookup (live, read-only: src/server/chat/org62.ts) ·
 *              chat_research (live, read-only deep research: src/server/chat/research.ts) ·
 *              chat_gmail_* / chat_drive_* / chat_calendar_events (live, read-only Google) ·
 *              chat_vdp_find_assets (a background read-only research run per VDP → asset candidates) ·
 *              chat_log_batch (the next logging batch; stage: true puts it on Time for Apply)
 *   proposals  chat_app_change, chat_propose_changes → a proposal card; nothing changes until the user clicks Apply
 *   in-app     chat_rescan            → a queued manual scan (trigger chat) + a live scan part
 *              chat_draft             → an Outbox draft (never sent) + a draft part
 *              chat_vdp_update        → a VDP change waiting for Apply on Time
 *              chat_start_session     → a prepared claude:// deep link + session part (never opened here)
 *              chat_reauth            → a connector's sign-in (the user's MFA)
 *
 * No tool can send, post or write to an external system. Results are credential-redacted JSON. No per-message count
 * limits (2026-11-13): this message's cost cap and the assistant's day line bound a turn; scans (on the scanners'
 * budget) stay one per connector.
 */
import { z } from 'zod';
import { adminHrefFor, ChatEditChange, vdpHrefFor, type ChatChange, type ChatScan } from '@/contract';
import type { ResolvedPersona } from '@/personas';
import { AppRouteError, appRouteCatalog } from '@/server/chat/app-routes';
import { toolJson } from '@/server/chat/compact';
import { Org62LookupError, Org62LookupInput } from '@/server/chat/org62';
import { CHAT_READ_PAGES, CHAT_READ_PAGE_NAMES, ChatReadArgsError, chatPageCatalog, pageNote, routesCoveredByPages, type ChatReadPage } from '@/server/chat/read';
import { redactText } from '../redact';
import type { ChatGoogleTool, ChatHost, ChatRunStep, ChatTurnInput } from './types';

export const CHAT_SERVER_NAME = 'chat';
export const chatToolFullName = (name: string) => `mcp__${CHAT_SERVER_NAME}__${name}`;

export interface ChatToolState {
  scans: Map<string, ChatScan>;
  /** Scan id → the tool row that stays open (tool-progress) until the scan finishes. */
  scanRows: Map<string, string>;
  /** Proposal ids staged this message. */
  proposals: string[];
  /** The cards staged this message by their summary (normalized): a list is ONE card, never "(1 of 2)" (A2). */
  cards: Map<string, string>;
  /** Connectors rescanned this message (one scan per connector: scans run on the scanners' budget, not this one). */
  rescanned: Set<string>;
}

export const newToolState = (): ChatToolState => ({ scans: new Map(), scanRows: new Map(), proposals: [], cards: new Map(), rescanned: new Set() });

/**
 * The card key of a summary: words only, without the "(1 of 2)" / "part 2" / "batch 3" / "continued" a split list
 * adds, so a second card for the same list is caught (A2: one card holds any number of calls).
 */
export function cardKey(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/\(?\s*(part|batch|page|set|group)?\s*\d+\s*(of|\/)\s*\d+\s*\)?/g, ' ')
    .replace(/\b(part|batch|page|set|group)\s*\d+\b/g, ' ')
    .replace(/\b(continued|cont\.?|the rest|remaining|more)\b/g, ' ')
    .replace(/\d+/g, '#')
    .replace(/[^a-z#]+/g, ' ')
    .trim();
}

/** The payload sanity bound of one card: far above real use (55 claims), well under what one Apply can run. */
export const CARD_MAX_CALLS = 2_000;

/** The staged card's lines, echoed back to the model: the first 100 (the card holds them all; the model sent them). */
const ECHO_LINES = 100;
const echoLines = (lines: unknown[]) => ({ lines: lines.slice(0, ECHO_LINES), ...(lines.length > ECHO_LINES ? { linesOnCard: lines.length, linesNote: `The card shows all ${lines.length} lines; the first ${ECHO_LINES} are echoed here.` } : {}) });

/** Steps of a chat-started scan for `tool-progress`: queued 0/3 · running 1/3 · items seen 2/3 · finished 3/3. */
export const SCAN_STEPS = 3;
export function scanProgress(s: Pick<ChatScan, 'status' | 'done' | 'itemsSeen'>): { done: number; total: number } {
  const done = s.done ? SCAN_STEPS : s.status === 'running' ? (s.itemsSeen > 0 ? 2 : 1) : 0;
  return { done, total: SCAN_STEPS };
}

/** P-CHAT's tool-row names are `<source>.<op>`: the scan row is `<source>.scan`. */
const SOURCES = new Set(['slack', 'gmail', 'calendar', 'drive', 'gemini', 'org62', 'vdp', 'claude']);
const windowTag = (h: number) => (h % 24 === 0 ? `${h / 24}d` : `${h}h`);

export interface ChatToolCtx {
  host: ChatHost;
  input: ChatTurnInput;
  emit: (step: ChatRunStep) => void;
  state: ChatToolState;
  signal: AbortSignal;
  /** Push the turn's deadline out (a long tool that is still making progress; capped by the runner). */
  extend?: (ms: number) => void;
  /** The user's persona (the tool list was filtered by it); null in callers that don't load one. */
  persona?: ResolvedPersona | null;
  /**
   * The turn's cost cap (D-58): what is left of this message's cap after the model and the sub-runs so far, and the
   * actual spend of a sub-run (research, an Org62 lookup, a Find assets reservation), which counts against it.
   */
  budgetLeft?: () => number;
  spend?: (usd: number, what: string) => void;
  /** What is left of the assistant's day line after this turn's spend so far (background runs are bounded by it). */
  dayLeft?: () => number;
  /** Stop the turn and offer "Allow $usd more" (a sub-run that doesn't fit what is left of the message, or of the day). */
  needMore?: (usd: number, what: string, scope?: 'message' | 'day') => void;
}

export interface ChatToolResult {
  /** What the model sees (JSON or a sentence). */
  text: string;
  ok: boolean;
  /** One human line for the tool row. */
  summary: string;
  /** The row stays open: the runner sends its tool-progress and tool-result later (scans). */
  defer?: boolean;
}

interface ChatToolDef<S extends z.ZodRawShape> {
  name: string;
  /** The tool row's name (`<area>.<op>`, the UI's vocabulary); default `name`. */
  row?: (args: z.infer<z.ZodObject<S>>) => string;
  /** A string, or one built from the persona (the route catalogs): deterministic, so the prefix stays stable per persona. */
  description: string | ((p: ResolvedPersona | null) => string);
  shape: S;
  /** The tool row's start line. */
  start: (args: z.infer<z.ZodObject<S>>) => string;
  run: (ctx: ChatToolCtx, args: z.infer<z.ZodObject<S>>, rowId: string) => Promise<ChatToolResult>;
}

const def = <S extends z.ZodRawShape>(d: ChatToolDef<S>) => d;
const q = (s: string, n = 48) => `"${s.length > n ? `${s.slice(0, n - 1)}…` : s}"`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A second card with the summary of one already staged this message: the list belongs on that one card. */
function splitCard(ctx: ChatToolCtx, summary: string): ChatToolResult | null {
  const prior = ctx.state.cards.get(cardKey(summary));
  if (!prior) return null;
  return {
    text: toolJson({ staged: false, error: `You already staged a card like this one this message ("${summary}", proposal ${prior}). One card holds any number of calls: a list is never split. Stage each different change once; if this was the rest of that list, say so, and stage the whole list as one card in the next message after the user discards the first.` }),
    ok: false,
    summary: 'Already on a card this message',
  };
}

/** What is left of the message's cap for a sub-run (Infinity when the caller tracks none, e.g. a unit test). */
const leftOf = (ctx: ChatToolCtx) => ctx.budgetLeft?.() ?? Number.POSITIVE_INFINITY;

export const CHAT_TOOLS = [
  def({
    name: 'chat_search_sources',
    row: (a) => `${(a.sources ?? []).find((s) => s !== 'ledger') ?? 'ledger'}.search`,
    description: 'Find a source the user knows exists ("the deck I made for Globex", "Dana\'s mail about pricing"): searches the scan ledger and evidence (ledger), and, where available, read-only Gmail and Drive search. Read only; never opens, sends or shares anything.',
    shape: {
      query: z.string().min(2).max(200),
      sources: z.array(z.enum(['ledger', 'gmail', 'drive'])).min(1).max(3).optional().describe('Default ["ledger"]'),
      limit: z.number().int().min(1).max(20).optional(),
    },
    start: (a) => `Looking for ${q(a.query)} in ${(a.sources ?? ['ledger']).join(', ')}`,
    run: async (ctx, a) => {
      const r = await ctx.host.searchSources(a.query, { sources: a.sources ?? ['ledger'], limit: a.limit ?? 8, signal: ctx.signal });
      return { text: toolJson({ query: a.query, hits: r.hits, notes: r.notes }), ok: true, summary: r.hits.length ? `${plural(r.hits.length, 'source')}: ${r.hits[0]!.title}` : 'Nothing found' };
    },
  }),
  def({
    name: 'chat_vdp_update',
    row: () => 'vdp.update',
    description:
      'Stage ONE VDP change the user Applies on Activity ▸ VDP (one click each, the Outbox\'s approval gate; nothing reaches VDP before that, and dry run may be on). Preferred: an open item whose who is "app" from chat_app_read vdp / vdp_detail: itemKey = its apply.key, values = {wire field: text} for the fields you fill (the rest take the suggestion; ids are fixed). One item is ONE call: a whole use case, the fiscal period, an added opp, a new VDP. Legacy, one field: op update_use_case {vdpSlug, useCaseId, field, value}, create_use_case {vdpSlug, track d360|agentforce, field "title", value}, update_vdp_header {vdpSlug, field, value}. An item whose who is "you" (VDP can\'t take it over MCP yet) cannot be staged: give its handoff link and text instead.',
    shape: {
      itemKey: z.string().min(1).max(300).optional(),
      values: z.record(z.string().max(4000)).optional(),
      vdpSlug: z.string().min(1).max(200).optional(),
      op: z.enum(['update_use_case', 'create_use_case', 'update_vdp_header']).optional(),
      field: z.string().min(1).max(80).optional(),
      value: z.string().max(4000).optional(),
      useCaseId: z.string().max(200).optional(),
      track: z.enum(['d360', 'agentforce']).optional(),
      gapId: z.string().max(200).optional(),
    },
    start: (a) => `Staging a VDP change: ${a.itemKey ?? a.field ?? 'item'}`,
    run: async (ctx, a) => {
      const r = await ctx.host.draftVdpUpdate(a);
      ctx.emit({ type: 'resource', resource: { kind: 'draft', id: r.draftId, label: `Apply on Activity · ${r.target}`, href: adminHrefFor(r.draftId, 'vdp') } });
      return {
        text: toolJson({ staged: true, draftId: r.draftId, target: r.target, changes: r.changes, note: 'Waiting for the user\'s Apply on Activity ▸ VDP (the link); nothing was sent to VDP. Say so, and that VDP must be connected when they Apply.' }),
        ok: true,
        summary: `Waiting for your Apply: ${r.changes.map((c) => c.label).join(', ')}`,
      };
    },
  }),
  def({
    name: 'chat_vdp_find_assets',
    row: () => 'vdp.search',
    description:
      "Find assets for a VDP: a read-only research run in the background that looks back through the account's Drive (decks, docs, demos, recordings), Slack (links and files in account channels and DMs), Gmail and Calendar attachments, and records each asset it finds as a candidate under Assets to add (with where it was shared, why, and the Assets-tab text). key = a VDP slug or account:<accountId> (the \"Looking at\" vdp id); all = every VDP and engaged account without one, within capUsd in total. estimateOnly = say what it would run and cost, start nothing. Each run is capped at the research budget per run; spend counts on the assistant's day line. Nothing is written to VDP.",
    shape: {
      key: z.string().min(1).max(200).optional(),
      all: z.boolean().optional(),
      capUsd: z.number().min(0).max(50).optional(),
      estimateOnly: z.boolean().optional(),
    },
    start: (a) => (a.all ? 'Finding assets for every VDP' : `Finding assets for ${a.key ?? 'the VDP'}`),
    run: async (ctx, a) => {
      if (!a.key && !a.all) return { text: 'Pass key (a VDP slug or account:<id>) or all: true.', ok: false, summary: 'Which VDP?' };
      // D-58: the runs go on in the background after this turn, so their upper bound is checked against what is left
      // of the assistant's day line (after this turn's spend so far), not this message's cap: estimate, then start.
      if (!a.estimateOnly) {
        const est = await ctx.host.findVdpAssets({ ...a, estimateOnly: true });
        const left = ctx.dayLeft?.() ?? Number.POSITIVE_INFINITY;
        if (est.queued.length && est.estimateUsd > left) {
          ctx.needMore?.(est.estimateUsd - Math.max(0, left), 'Find assets', 'day');
          return { text: toolJson({ started: false, estimateUsd: est.estimateUsd, leftUsd: Math.max(0, Math.round(left * 100) / 100), note: "Not started: the runs could cost more than is left of the assistant's limit for today. Say so; the user can allow more or raise it in Settings > Budgets." }), ok: false, summary: `Needs up to $${est.estimateUsd.toFixed(2)}: more than today's assistant limit has left` };
        }
      }
      const r = await ctx.host.findVdpAssets(a);
      for (const q of r.queued.slice(0, 4)) ctx.emit({ type: 'resource', resource: { kind: 'url', id: `vdp:${q.key}`, label: `Assets to add · ${q.companyName}`, href: vdpHrefFor(q.key) } });
      return {
        text: toolJson({
          ...r,
          note: r.started
            ? 'Started in the background (1 to 3 minutes per VDP). The finds show under Assets to add on each VDP (the links), each with its source and the text to paste in VDP; read vdp_detail again later for them. Say what it searches and the cost cap; nothing is written to VDP.'
            : a.estimateOnly
              ? 'Estimate only: nothing started. Say what it would run and cost, and offer to start it.'
              : `Nothing started: ${r.note ?? 'see skipped'}.`,
        }),
        ok: true,
        summary: r.started ? `${r.queued.length} search${r.queued.length === 1 ? '' : 'es'} started · up to $${r.estimateUsd.toFixed(2)}` : a.estimateOnly ? `Would run ${r.queued.length} · up to $${r.estimateUsd.toFixed(2)}` : 'Nothing started',
      };
    },
  }),
  def({
    name: 'chat_reauth',
    row: (a) => `${SOURCES.has(a.connector.toLowerCase()) ? a.connector.toLowerCase() : 'connector'}.reauth`,
    description:
      "Start a connector's sign-in (the same as Health > Re-auth): for VDP and Org62 a Terminal and browser window open on the user's machine for their Okta MFA; Google and Slack say what to run. Use it when the user asks to reconnect, or says yes after you offered because something they asked for needs a connector that isn't connected (e.g. VDP before VDP work). It changes no data and sends nothing.",
    shape: { connector: z.string().min(2).max(40).describe('slack, gmail, calendar, drive, gemini, org62, vdp, claude') },
    start: (a) => `Starting the ${a.connector} sign-in`,
    run: async (ctx, a) => {
      const r = await ctx.host.reauth(a.connector);
      if (!r.found) return { text: `No connector named "${a.connector}".`, ok: false, summary: 'Unknown connector' };
      return {
        text: toolJson({ connector: r.label, state: r.state, started: r.started, how: r.how, note: r.started ? 'Started: tell the user a Terminal/browser window opens for their MFA, and that the app picks up again on its own once they finish.' : 'Not started automatically: tell the user exactly what the "how" says.' }),
        ok: true,
        summary: r.started ? `${r.label}: sign-in started` : `${r.label}: ${r.how ?? 'see Health'}`,
      };
    },
  }),
  def({
    name: 'chat_log_batch',
    row: () => 'time.log',
    description:
      'The next logging batch: which Time rows would go to Slackbot (approved rows that have ended, plus complete proposed rows when the logging setting includes them), how many hours, how many canvases, which rows still need input and why, the Org62 check (rows handed off but not in Org62, hours or opportunity that differ), and `applied`: the logging canvases already applied (created in Slack) with their link, rows and Org62 state. Read only: nothing is approved, staged or sent. Use it for "log my time", "what\'s ready to log?", "was the canvas created?", "did my last batch land?".',
    shape: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('First local day to include'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Last local day to include'),
      includeProposed: z.boolean().optional().describe('Also take complete proposed rows (default: the logging setting)'),
      stage: z.boolean().optional().describe('Stage the batch as canvas items for the user to Apply on Activity (only when they asked to log it)'),
      dcOnly: z.boolean().optional().describe('With stage: a canvas of only the pending DC requests (Log DCs now), only when the user asks to log their DCs without waiting for rows. DC requests otherwise ride on the next canvas that has rows'),
    },
    start: (a) => `${a.stage ? 'Staging' : 'Building'} the logging batch${a.from || a.to ? ` (${a.from ?? '…'} to ${a.to ?? 'now'})` : ''}`,
    run: async (ctx, { stage, ...a }) => {
      if (stage) {
        if (ctx.state.cards.has('logging batch')) return { text: 'The logging batch is already staged this message: point the user to it on Activity.', ok: false, summary: 'Already staged' };
        const r = await ctx.host.stageLogBatch(a);
        ctx.state.cards.set('logging batch', r.draftIds[0] ?? 'none');
        ctx.state.proposals.push(...r.draftIds.slice(0, 1));
        if (!r.draftIds.length) {
          for (const d of r.waiting.draftIds) ctx.emit({ type: 'resource', resource: { kind: 'draft', id: d, label: 'Apply on Activity · logging canvas waiting', href: adminHrefFor(d, 'log') } });
          return {
            text: toolJson({ staged: false, skipped: r.skipped, waiting: r.waiting, note: r.waiting.rows ? 'Nothing new to log: the ready rows already wait in the canvas item(s) listed under waiting, to Apply on Activity (the link). Point the user there; do not stage again.' : 'Nothing ready to log: say which rows need input and offer to fix them.' }),
            ok: true,
            summary: r.waiting.rows ? `${r.waiting.rows} row${r.waiting.rows === 1 ? '' : 's'} already waiting for Apply on Activity` : 'Nothing ready to log',
          };
        }
        for (const c of r.canvases) ctx.emit({ type: 'resource', resource: { kind: 'draft', id: c.draftId, label: `Apply on Activity · ${c.title}`, href: adminHrefFor(c.draftId, 'log') } });
        return {
          text: toolJson({ staged: true, ...r, note: 'Each canvas waits for the user\'s Apply on Activity (the links; one click each, the same approval as the Outbox). Apply creates a private canvas; then they open it in Slack and tell Slackbot "Execute this canvas". With dry run on, Apply shows the exact payload and creates nothing. Do not say anything was created or logged.' }),
          ok: true,
          summary: `${r.canvases.length} canvas${r.canvases.length === 1 ? '' : 'es'} to Apply on Activity · ${r.events} rows · ${r.hours} h`,
        };
      }
      const b = await ctx.host.logBatch(a);
      if (!b.available) return { text: toolJson({ available: false, note: b.note }), ok: false, summary: 'Logging batches not available here' };
      const summary = b.events || b.updates ? `${b.events} row${b.events === 1 ? '' : 's'} · ${b.hours} h · ${b.canvases.length} canvas${b.canvases.length === 1 ? '' : 'es'}` : 'Nothing ready to log';
      return {
        text: toolJson({ ...b, note: 'Preview only: nothing is staged yet. Say what is ready, what needs input, and what the Org62 check found; to stage it for Apply on Activity, call again with stage: true when the user asks to log it.' }),
        ok: true,
        summary: b.discrepancies.length ? `${summary} · ${b.discrepancies.length} to check in Org62` : summary,
      };
    },
  }),
  def({
    name: 'chat_research',
    row: () => 'research.search',
    description:
      "Deep research for ONE question the app's stored data can't answer: searches live Slack (messages, threads, account channels), Gmail, Calendar (any date range), Drive and Org62 (the user's logged Events, the account's opportunities), and returns an answer with linked findings and what it searched. Use it without asking when the app has nothing on a past or present piece of work (\"have I done anything for X?\", \"is there a deck for this account?\", \"which opp was this meeting for?\", \"what did we send them?\"). Pass names and spelling variants. Read only; takes 30 to 120 s and is recorded on the assistant's spend.",
    shape: {
      question: z.string().min(5).max(400),
      names: z.array(z.string().min(2).max(80)).max(6).optional().describe('An account, a person, spelling variants: ["Globex", "Globx", "Globex Health"]'),
      hint: z.string().max(600).optional().describe('What you already checked in the app and what you suspect'),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('How far back to look (default two years)'),
    },
    start: (a) => `Researching ${q(a.question, 60)}`,
    run: async (ctx, a, rowId) => {
      const b = await ctx.host.budget(ctx.input.model);
      const dayLeft = b.chatDailyUsd - b.chatTodayUsd + Math.max(0, ctx.input.allowExtraUsd ?? 0);
      // A research run spends inside this message's cap (D-58), not beside it. The day's line is checked first.
      const msgLeft = leftOf(ctx);
      const cap = Math.min(b.researchUsd ?? 0.5, dayLeft, msgLeft);
      if (dayLeft < 0.05) return { text: "The assistant's daily limit is nearly used up, so there's no room for a research run. Say so; the user can allow more for this message or raise the limit in Settings > Budgets.", ok: false, summary: 'No budget left for research' };
      if (msgLeft < 0.05) {
        ctx.needMore?.(b.researchUsd ?? 0.5, 'research');
        return { text: "This message's limit is nearly used up, so there's no room for a research run. Say so; the user can allow more for this message.", ok: false, summary: 'No budget left in this message for research' };
      }
      let calls = 0;
      const total = 12;
      ctx.extend?.(200_000);
      ctx.emit({ type: 'tool-progress', id: rowId, done: 0, total });
      const r = await ctx.host.research(a, {
        costCapUsd: cap,
        signal: ctx.signal,
        onTool: () => {
          calls += 1;
          ctx.extend?.(120_000);
          ctx.emit({ type: 'tool-progress', id: rowId, done: Math.min(total - 1, calls), total });
        },
      });
      if (r.model) await ctx.host.recordUsage({ threadId: ctx.input.threadId, messageId: ctx.input.messageId, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: r.costUsd, estimated: false, status: r.output ? 'ok' : r.error?.code === 'timeout' ? 'timeout' : 'error', ...(r.error ? { errorCode: r.error.code } : {}), latencyMs: r.latencyMs, skill: r.skill }).catch(() => undefined);
      if (r.costUsd > 0) ctx.spend?.(r.costUsd, 'research');
      if (!r.output) return { text: toolJson({ answered: false, error: r.error ?? null, unavailable: r.unavailable, note: 'Research did not finish. Say what you could and could not check.' }), ok: false, summary: r.error?.code === 'unavailable' ? 'Live research not available here' : `Research did not finish (${r.error?.code ?? 'no answer'})` };
      const o = r.output;
      return {
        text: toolJson({ answer: o.answer, confidence: o.confidence, findings: o.findings, searched: o.searched, notFound: o.notFound, unavailable: r.unavailable, toolCalls: r.toolCalls.length, costUsd: Math.round(r.costUsd * 10_000) / 10_000 }),
        ok: true,
        summary: `${o.findings.length} finding${o.findings.length === 1 ? '' : 's'} · ${o.searched.length} search${o.searched.length === 1 ? '' : 'es'}`,
      };
    },
  }),
  def({
    name: 'chat_org62_lookup',
    row: () => 'org62.search',
    description:
      'Live, read-only Org62 search for what the app does not have: an account it does not track, "is there an open opp for X?", the right opp for a Time-page row. find opportunities {account and/or name, openOnly (default true)} or accounts {name}. You pass words; the app builds the query (fixed fields, no descriptions). Returns rows (stage, close date, amount, owner) and inApp ids when the app tracks the record: inApp.oppId works in edit_activities. Read only: nothing is ever written to Org62.',
    shape: Org62LookupInput.shape,
    start: (a) => `Searching Org62 for ${a.find}${a.account ? ` at ${q(a.account)}` : ''}${a.name ? ` named ${q(a.name)}` : ''}`,
    run: async (ctx, a) => {
      let r: Awaited<ReturnType<ChatToolCtx['host']['org62Lookup']>>;
      try {
        r = await ctx.host.org62Lookup(a, ctx.signal);
      } catch (err) {
        if (err instanceof Org62LookupError) return { text: `Can't search Org62 like that: ${err.message}.`, ok: false, summary: 'Invalid lookup' };
        throw err;
      }
      if (r.usage) await ctx.host.recordUsage({ threadId: ctx.input.threadId, messageId: ctx.input.messageId, ...r.usage, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: r.costUsd, estimated: false, skill: 'read-lookup@1' }).catch(() => undefined);
      if (r.costUsd > 0) ctx.spend?.(r.costUsd, 'Org62 lookup');
      const what = a.find === 'accounts' ? (r.rows.length === 1 ? 'account' : 'accounts') : r.rows.length === 1 ? 'opportunity' : 'opportunities';
      return { text: toolJson({ soql: r.soql, rows: r.rows, notes: r.notes }), ok: true, summary: r.rows.length ? `${r.rows.length} ${what}: ${r.rows[0]!.name}` : (r.notes[0] ?? 'Nothing found') };
    },
  }),
  def({
    name: 'chat_propose_changes',
    row: (a) => (a.changes.every((c) => c.op.startsWith('policy') || c.op === 'rerank') ? 'policy.preview' : 'work.preview'),
    description:
      'Stage changes as ONE proposal card for the user to Apply or Dismiss: every change in one list (any number; never split a list across cards). Nothing changes until they click Apply; then the ones that still fit land as one undoable change set, and any that no longer fit (closed since) are listed with why. Ops: pin (move to #1), rerank, snooze {until}, done, reopen, resolve {resolution, personName for handed_off}, link_evidence {source, summary, role}, create_item {title, kind?, due?, snoozeUntil?}, edit_fields {patch: title|purpose|due|startBy|effort{youMin,agentMin}|notes|kind|accountId|initiativeId|oppId}, policy_weights {deltas}, policy_rule {add|enable|disable|remove}, edit_activities {entryIds (Time-page rows from chat_read time), patch: oppId|taskType|meetingType (CF|CR)|durationH (0.25 steps)|description|status (proposed|approved|dismissed)}: one change for many rows. Times are ISO instants with offset. Returns the proposal id and the before → after lines, or the errors to fix.',
    shape: {
      changes: z.array(ChatEditChange).min(1).max(CARD_MAX_CALLS),
      summary: z.string().min(3).max(160).describe('The card title, a question: "Snooze the VDP re-auth until 14:00?"'),
    },
    start: (a) => `Staging ${plural(a.changes.length, 'change')}: ${a.changes.map((c) => c.op).join(', ')}`,
    run: async (ctx, a) => {
      const split = splitCard(ctx, a.summary);
      if (split) return split;
      const preview = await ctx.host.previewChanges(a.changes, ctx.input.threadId);
      if (preview.errors.length) return { text: toolJson({ staged: false, errors: preview.errors, hint: 'Fix the ids or states and call chat_propose_changes again with the full list.' }), ok: false, summary: `Can't stage: ${preview.errors[0]}` };
      if (!preview.lines.length) return { text: toolJson({ staged: false, errors: ['Nothing would change.'] }), ok: false, summary: 'Nothing would change' };
      const summary = redactText(a.summary);
      const proposal = await ctx.host.stageChanges({ threadId: ctx.input.threadId, messageId: ctx.input.messageId, changes: preview.changes, lines: preview.lines, entity: preview.entity, reason: summary });
      ctx.state.proposals.push(proposal.id);
      ctx.state.cards.set(cardKey(a.summary), proposal.id);
      ctx.emit({ type: 'proposal', proposal, summary, changes: preview.changes });
      return {
        text: toolJson({ staged: true, proposalId: proposal.id, status: 'pending', ...echoLines(preview.lines), note: 'Shown to the user with Apply / Dismiss. Nothing has changed yet; do not say it is done.' }),
        ok: true,
        summary: `Proposed ${plural(preview.lines.length, 'change')} (waiting for Apply)`,
      };
    },
  }),
  def({
    name: 'chat_rescan',
    row: (a) => `${SOURCES.has(a.connector.toLowerCase()) ? a.connector.toLowerCase() : 'connector'}.scan`,
    description: 'Start a manual scan of one connector over the last windowHours (trigger chat). It is queued for the worker; its row shows progress until it finishes. Connectors: slack, gmail, calendar, drive, gemini, org62, vdp, claude.',
    shape: { connector: z.string().min(2).max(40), windowHours: z.number().min(1).max(720) },
    start: (a) => `Re-reading ${a.connector} over the last ${a.windowHours} h (${windowTag(a.windowHours)})`,
    run: async (ctx, a, rowId) => {
      const which = a.connector.trim().toLowerCase();
      if (ctx.state.rescanned.has(which)) return { text: `${a.connector} is already rescanning from this message; its row shows the progress.`, ok: false, summary: 'Already rescanning' };
      const scan = await ctx.host.rescan(a.connector, a.windowHours);
      ctx.state.rescanned.add(which);
      const text = toolJson({ scanId: scan.id, status: scan.status, done: scan.done, summary: scan.summary, window: { from: scan.windowStart, to: scan.windowEnd } });
      if (scan.done) return { text, ok: scan.status === 'ok' || scan.status === 'partial', summary: scan.summary };
      ctx.state.scans.set(scan.id, scan);
      ctx.state.scanRows.set(scan.id, rowId);
      ctx.emit({ type: 'tool-progress', id: rowId, ...scanProgress(scan) });
      return { text, ok: true, summary: scan.summary, defer: true };
    },
  }),
  def({
    name: 'chat_draft',
    row: (a) => `${a.channel === 'email' ? 'gmail' : 'slack'}.draft`,
    description: 'Create a DRAFT (never sent): it appears as a card the user edits and adds to the Outbox, then sends from there. channel slack: to = "#channel", "@person" or a channel id, threadRef = thread ts to reply in. channel email: to = address(es), subject, threadRef = Gmail thread id to reply to. Write the full message in body, in the user\'s voice; intent is the one-line purpose.',
    shape: {
      channel: z.enum(['slack', 'email']),
      to: z.string().min(1).max(300),
      threadRef: z.string().max(200).optional(),
      subject: z.string().max(200).optional(),
      intent: z.string().min(3).max(300),
      body: z.string().max(6000).optional(),
      workItemId: z.string().max(200).optional(),
    },
    start: (a) => `Drafting a ${a.channel} message to ${a.to}`,
    run: async (ctx, a) => {
      const draft = await ctx.host.createDraft({ ...a, threadId: ctx.input.threadId });
      ctx.emit({ type: 'draft', draft });
      return { text: toolJson({ draftId: draft.draftId, status: draft.status, to: draft.to, note: 'Saved as a draft card. The user adds it to the Outbox and sends it from there. Nothing was sent.' }), ok: true, summary: `Drafted for ${draft.to} (not sent)` };
    },
  }),
  def({
    name: 'chat_start_session',
    row: () => 'claude.session',
    description: 'Prepare a Claude Code session in a repo (path, ~/path, or a known repo name) with a starting prompt. Returns a claude:// link the user opens with a click; it is never opened for them. Link a work item to tie the session to it.',
    shape: { repo: z.string().min(1).max(300), prompt: z.string().min(3).max(8000), title: z.string().max(120).optional(), workItemId: z.string().max(200).optional() },
    start: (a) => `Preparing a Claude session in ${a.repo}`,
    run: async (ctx, a) => {
      const session = await ctx.host.prepareSession({ ...a, threadId: ctx.input.threadId });
      ctx.emit({ type: 'session', session });
      return { text: toolJson({ sessionId: session.id, folder: session.folder, state: session.state, note: 'Prepared. The user opens it with a click; it has not been opened.' }), ok: true, summary: `Session ready in ${session.folder} (opens on click)` };
    },
  }),

  // ---- D-58: general abilities (the app's own API, and the scanners' live reads) -----------------------------
  def({
    name: 'chat_app_read',
    row: (a) => (isPage(a.route) ? `${CHAT_READ_PAGES[a.route].area}.read` : `${a.route.replace(/^(get|list)/, '').replace(/^./, (c) => c.toLowerCase()) || 'app'}.read`),
    description: (p) =>
      `Read anything in the app (read only; the data the UI gets). route = a page or a route key below; params, query and body exactly as listed (body only on the POST reads). Long lists come in pages, never cut: when the result's page.nextOffset is set, call again with offset = nextOffset (and list, when it names one) until it is null, and count or answer only from every page. limit = rows per page (default: as many as fit). One read of a list beats a read per row.\nPages (prefer them to the route they read):\n${chatPageCatalog(p)}\nRoutes:\n${appRouteCatalog('read', p, routesCoveredByPages(p))}`,
    shape: {
      route: z.string().min(2).max(60).describe('A page ("today", "find_items", "item", "time", …) or a read route key ("getAccount", "listDcRequests", …)'),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Path params, e.g. {"accountId": "acc_1"}; a page takes its args here or in query'),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Query params, e.g. {"from": "2026-10-01"}'),
      body: z.record(z.string(), z.unknown()).optional().describe('The JSON body of a POST read (previewPolicy, searchOrg62Opps)'),
      offset: z.number().int().min(0).optional().describe("The first row: the last page's nextOffset"),
      limit: z.number().int().min(1).optional().describe('At most this many rows on the page'),
      list: z.string().max(80).optional().describe('Which list to page when the data has several (the page.list or more key)'),
    },
    start: (a) => {
      const args = Object.entries({ ...a.params, ...a.query }).map(([k, v]) => `${k} ${String(v).slice(0, 40)}`);
      if (a.offset) args.push(`from row ${a.offset + 1}`);
      return `Reading ${isPage(a.route) ? a.route.replace(/_/g, ' ') : a.route}${args.length ? ` (${args.join(', ')})` : ''}`;
    },
    run: async (ctx, a) => {
      const paging = { ...(a.offset !== undefined ? { offset: a.offset } : {}), ...(a.limit !== undefined ? { limit: a.limit } : {}), ...(a.list ? { list: a.list } : {}) };
      try {
        if (isPage(a.route)) {
          if (a.body && Object.keys(a.body).length) return { text: `${a.route} takes no body.`, ok: false, summary: 'Invalid read' };
          const r = await ctx.host.read(a.route, { ...a.params, ...a.query }, paging);
          return { text: toolJson({ page: a.route, ...pageNote(r.paging, r.more), data: r.data }), ok: true, summary: r.summary };
        }
        const r = await ctx.host.appRead(a.route, { ...(a.params ? { params: a.params } : {}), ...(a.query ? { query: a.query } : {}), ...(a.body ? { body: a.body } : {}) }, paging);
        // 2026-11-13 audit C8: a read with a live lookup behind it (searchOrg62Opps) counts against this message's cap
        const cost = (r.data as { costUsd?: unknown } | null)?.costUsd;
        if (typeof cost === 'number' && cost > 0) ctx.spend?.(cost, `${a.route} lookup`);
        return { text: toolJson({ route: r.route, ...pageNote(r.paging, r.more), data: r.data }), ok: true, summary: r.summary };
      } catch (err) {
        if (err instanceof AppRouteError || err instanceof ChatReadArgsError) {
          const args = isPage(a.route) ? (CHAT_READ_PAGES[a.route] as { args?: string }).args : undefined;
          return { text: `Can't read that: ${err.message}.${args ? ` ${a.route} takes: ${args}.` : ''}`, ok: false, summary: 'Invalid read' };
        }
        throw err;
      }
    },
  }),
  def({
    name: 'chat_app_change',
    row: () => 'app.preview',
    description: (p) =>
      `Stage changes to anything in the app as ONE proposal card: calls = every change, in order, any number (a whole list is one card; never split it), each one route below with its params and body, checked against the route's own schemas. Nothing changes until the user clicks Apply; then every call runs through the app's API: the ones that work land, one that fails is listed on the receipt with its reason, and Undo all reverts every one that landed. Read first (chat_app_read) for ids and current values; a PATCH's ifVersion may be left out (the app fills in the version it reads). Prefer chat_propose_changes for work-item edits it covers. Never for sending: those routes don't exist here. Routes:\n${appRouteCatalog('stage', p)}`,
    shape: {
      calls: z
        .array(
          z.object({
            route: z.string().min(2).max(60).describe('A stage route key, e.g. "createDcRequest"'),
            params: z.record(z.string(), z.string().max(300)).optional().describe('Path params'),
            body: z.record(z.string(), z.unknown()).optional().describe("The route's JSON body"),
            label: z.string().max(160).optional().describe('The card line: "Claim DC on Globex · Renewal FY27"'),
          }),
        )
        .min(1)
        .max(CARD_MAX_CALLS),
      summary: z.string().min(3).max(160).describe('The card title, a question: "Claim DCs on these 2 opportunities?"'),
    },
    start: (a) => `Staging ${plural(a.calls.length, 'change')}: ${[...new Set(a.calls.map((c) => c.route))].join(', ')}`,
    run: async (ctx, a) => {
      const split = splitCard(ctx, a.summary);
      if (split) return split;
      const changes: ChatChange[] = a.calls.map((c) => ({ op: 'route_call', route: c.route, ...(c.params ? { params: c.params } : {}), ...(c.body ? { body: c.body } : {}), ...(c.label ? { label: redactText(c.label) } : {}) }));
      const preview = await ctx.host.previewChanges(changes, ctx.input.threadId);
      if (preview.errors.length) return { text: toolJson({ staged: false, errors: preview.errors, hint: 'Fix these (route, params, body; read the entity first) and call chat_app_change again with the full list.' }), ok: false, summary: `Can't stage: ${preview.errors[0]}` };
      const summary = redactText(a.summary);
      const proposal = await ctx.host.stageChanges({ threadId: ctx.input.threadId, messageId: ctx.input.messageId, changes: preview.changes, lines: preview.lines, entity: preview.entity, reason: summary });
      ctx.state.proposals.push(proposal.id);
      ctx.state.cards.set(cardKey(a.summary), proposal.id);
      ctx.emit({ type: 'proposal', proposal, summary, changes: preview.changes });
      return {
        text: toolJson({ staged: true, proposalId: proposal.id, status: 'pending', calls: preview.changes.length, ...echoLines(preview.lines), note: 'Shown to the user with Apply / Dismiss. Nothing has changed yet; do not say it is done.' }),
        ok: true,
        summary: `Proposed ${plural(preview.changes.length, 'change')} (waiting for Apply)`,
      };
    },
  }),
  def({
    name: 'chat_gmail_search',
    row: () => 'gmail.search',
    description: 'Search Gmail live (read only), any age, with Gmail search syntax (from:, to:, subject:, newer_than:2y, "exact phrase"). Returns message and thread ids and links.',
    shape: { query: z.string().min(2).max(300), max: z.number().int().min(1).max(10).optional() },
    start: (a) => `Searching Gmail for ${q(a.query)}`,
    run: async (ctx, a) => google(ctx, 'gmail_search', a, 'Gmail search'),
  }),
  def({
    name: 'chat_gmail_thread',
    row: () => 'gmail.read',
    description: 'Read one Gmail thread (read only, redacted) by its thread id from chat_gmail_search, a page at a time: a long thread ends with "read again with offset=N"; call again with that offset until it stops saying so.',
    shape: { thread_id: z.string().min(4).max(80), offset: z.number().int().min(0).max(5_000_000).optional().describe('Where to start, in characters (the offset the last page said)') },
    start: (a) => (a.offset ? 'Reading the next page of a Gmail thread' : 'Reading a Gmail thread'),
    run: async (ctx, a) => google(ctx, 'gmail_thread', a, 'Gmail thread'),
  }),
  def({
    name: 'chat_drive_search',
    row: () => 'drive.search',
    description: "Search Drive live (read only) with a Drive query: fullText contains 'ACME', name contains 'deck', modifiedTime > '2026-10-01'. Returns file metadata and links.",
    shape: { query: z.string().min(2).max(300), max: z.number().int().min(1).max(10).optional() },
    start: (a) => `Searching Drive for ${q(a.query)}`,
    run: async (ctx, a) => google(ctx, 'drive_search', a, 'Drive search'),
  }),
  def({
    name: 'chat_drive_read',
    row: () => 'drive.read',
    description: 'Read one Drive file (read only, redacted) by its file id from chat_drive_search, a page at a time: a long file (a sheet) ends with "read again with offset=N"; call again with that offset until it stops saying so, then work from every page.',
    shape: { file_id: z.string().min(4).max(120), offset: z.number().int().min(0).max(5_000_000).optional().describe('Where to start, in characters (the offset the last page said)') },
    start: (a) => (a.offset ? 'Reading the next page of a Drive file' : 'Reading a Drive file'),
    run: async (ctx, a) => google(ctx, 'drive_read', a, 'Drive file'),
  }),
  def({
    name: 'chat_calendar_events',
    row: () => 'calendar.events',
    description: "Your Calendar live (read only) over any date range (up to a year per call), optionally only the events mentioning some words (an account, a person). For the meetings the app already has, read the calendar page.",
    shape: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('First day (YYYY-MM-DD)'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Last day (YYYY-MM-DD), at most 366 days after from'),
      words: z.string().max(120).optional(),
    },
    start: (a) => `Reading the calendar ${a.from} to ${a.to}${a.words ? ` for ${q(a.words)}` : ''}`,
    run: async (ctx, a) => google(ctx, 'calendar_events', a, 'Calendar'),
  }),
] as const;

/** A chat_app_read route that is one of the app's pages (src/server/chat/read.ts). */
const isPage = (r: string): r is ChatReadPage => (CHAT_READ_PAGE_NAMES as string[]).includes(r);

export type ChatToolName = (typeof CHAT_TOOLS)[number]['name'];
export const CHAT_TOOL_NAMES = CHAT_TOOLS.map((t) => t.name) as ChatToolName[];
/** Every chat tool (any persona). A turn exposes `chatAllowedToolsFor(persona)`. */
export const CHAT_ALLOWED_TOOLS = CHAT_TOOL_NAMES.map(chatToolFullName);

export type AnyChatToolDef = ChatToolDef<z.ZodRawShape>;

// The persona filter is chatToolsFor in ./server.ts (TOOL_GATES, READ_PAGE_GATES): one stable tool prefix per persona.

/** A tool's description for a persona (the route catalogs depend on its gates). */
export const describeTool = (t: AnyChatToolDef, p: ResolvedPersona | null | undefined) => (typeof t.description === 'function' ? t.description(p ?? null) : t.description);

/** One live Google read through the host (the research run's handlers), as a tool result. */
async function google(ctx: ChatToolCtx, tool: ChatGoogleTool, args: Record<string, unknown>, what: string): Promise<ChatToolResult> {
  const r = await ctx.host.googleRead(tool, args, ctx.signal);
  if (!r.available) return { text: r.text, ok: false, summary: `${what}: not available here` };
  const n = /^(\d+) event/.exec(r.text)?.[1];
  return { text: r.text, ok: r.ok, summary: r.ok ? (n ? `${n} event${n === '1' ? '' : 's'}` : `${what}: ${r.text.length > 40 ? 'read' : r.text.slice(0, 40)}`) : `${what} failed` };
}

/** Validate and run one tool by name (the MCP server and the fake model both call this). */
export async function callChatTool(ctx: ChatToolCtx, name: string, rawArgs: unknown): Promise<ChatToolResult> {
  const t = CHAT_TOOLS.find((x) => x.name === name) as ChatToolDef<z.ZodRawShape> | undefined;
  if (!t) return { text: `Unknown tool ${name}`, ok: false, summary: 'Unknown tool' };
  const parsed = z.object(t.shape).safeParse(rawArgs ?? {});
  const id = `tool_${Math.random().toString(36).slice(2, 10)}`;
  const startLine = parsed.success ? redactText(t.start(parsed.data)) : `Calling ${name}`;
  const rowName = parsed.success && t.row ? t.row(parsed.data) : name;
  ctx.emit({ type: 'tool-start', id, name: rowName, summary: startLine, args: rawArgs ?? {} });
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    ctx.emit({ type: 'tool-result', id, summary: 'Invalid arguments', ok: false, result: msg });
    return { text: `Invalid arguments: ${msg}`, ok: false, summary: 'Invalid arguments' };
  }
  try {
    const r = await t.run(ctx, parsed.data, id);
    // a turn working a list is making progress: each finished call pushes its deadline out (bounded by the runner)
    ctx.extend?.(60_000);
    const text = redactText(r.text);
    if (!r.defer) ctx.emit({ type: 'tool-result', id, summary: redactText(r.summary), ok: r.ok, result: text.length > 1500 ? `${text.slice(0, 1499)}…` : text });
    return { ...r, text };
  } catch (err) {
    const msg = redactText((err as Error).message ?? String(err)).slice(0, 300);
    ctx.emit({ type: 'tool-result', id, summary: `Failed: ${msg}`, ok: false, result: msg });
    return { text: `Tool failed: ${msg}`, ok: false, summary: 'Failed' };
  }
}
