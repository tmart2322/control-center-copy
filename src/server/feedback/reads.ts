/**
 * What the diagnose run may read about the app (D-56), through the DataSource's own read methods only (the same
 * answers the pages get; never a write). Every result is compacted, capped and scrubbed before anyone sees it: the
 * agent's tools, the fallback report and tests all go through here.
 */
import { routes, type FeedbackContextInput, type RouteKey, type Settings } from '@/contract';
import { connectorRowsFor, personaOf } from '@/personas';
import type { DataSource } from '@/server/datasource/types';

import type { Scrubber } from './scrub';

/** Cap on one tool result (characters of JSON). */
export const READ_CAP = 6000;

export interface FeedbackReads {
  /** Recent warnings and errors from the event log, newest first. */
  eventLog(): Promise<unknown>;
  /** Failed, dead and retrying jobs. */
  jobs(): Promise<unknown>;
  /** Connector health, the worker, spend state, dry run. */
  health(): Promise<unknown>;
  /** The latest scan runs. */
  scans(): Promise<unknown>;
  /** The "why is this here" trace of the work item the user was looking at (null when none). */
  trace(): Promise<unknown>;
  /** The page's own payload (what the page rendered from). */
  page(): Promise<unknown>;
  /** The entity the user was looking at. */
  entity(): Promise<unknown>;
}

type Call = (key: RouteKey, input?: { params?: Record<string, unknown>; query?: Record<string, unknown> }) => Promise<unknown>;

/** Call one read route with its schemas' defaults applied (the route handler's parsing, without HTTP). */
export function readCaller(ds: DataSource): Call {
  return async (key, input = {}) => {
    const def = routes[key] as { method: string; params?: { parse(v: unknown): unknown }; query?: { parse(v: unknown): unknown } };
    if (def.method !== 'GET') throw new Error(`feedback reads only: ${key} is a ${def.method}`);
    const parsed: Record<string, unknown> = {};
    if (def.params) parsed.params = def.params.parse(input.params ?? {});
    if (def.query) parsed.query = def.query.parse(input.query ?? {});
    const fn = (ds as unknown as Record<string, (i: unknown) => Promise<unknown>>)[key];
    if (typeof fn !== 'function') throw new Error(`no read ${key}`);
    return fn.call(ds, parsed);
  };
}

/** The read behind a page route ("/time?tab=log" → getTime). Null for pages with no single payload. */
export function pageReadFor(route: string): { key: RouteKey; params?: Record<string, unknown>; query?: Record<string, unknown> } | null {
  const [path] = route.split('?', 1) as [string];
  const seg = path.split('/').filter(Boolean);
  const [a, b] = seg;
  switch (a) {
    case undefined:
    case 'home':
      return { key: 'getHome' };
    case 'today':
      return { key: 'getToday' };
    case 'work':
      return b ? { key: 'getItem', params: { id: b } } : { key: 'listItems' };
    case 'initiatives':
      return b ? { key: 'getInitiative', params: { id: b } } : null;
    case 'time':
      return { key: 'getTime' };
    case 'history':
      return { key: 'getHistoryMonth' };
    case 'deals':
      return b === 'missed' ? { key: 'getMissed' } : b === 'vdp' ? { key: 'getVdpCoverage' } : b ? { key: 'getAccount', params: { accountId: b } } : { key: 'getDeals' };
    case 'outbox':
      return { key: 'getOutbox' };
    case 'health':
      return { key: 'getHealth' };
    case 'agents':
      return { key: 'getAgents' };
    case 'calendar':
      return { key: 'getCalendar' };
    case 'briefs':
      return b ? { key: 'getBrief', params: { id: b } } : { key: 'getBriefs' };
    case 'triage':
      return { key: 'getTriage' };
    case 'settings':
      return { key: 'getSettings' };
    case 'onboarding':
      return { key: 'getOnboarding' };
    default:
      return null;
  }
}

/** The read for a "Looking at" entity. */
function entityReadFor(e: FeedbackContextInput['lookingAt']): { key: RouteKey; params: Record<string, unknown> } | null {
  if (!e) return null;
  switch (e.kind) {
    case 'work_item':
      return { key: 'getItem', params: { id: e.id } };
    case 'draft':
      return { key: 'getDraft', params: { id: e.id } };
    case 'calendar_event':
      return { key: 'getCalendarEvent', params: { id: e.id } };
    case 'account':
      return { key: 'getAccount', params: { accountId: e.id } };
    case 'initiative':
      return { key: 'getInitiative', params: { id: e.id } };
    case 'brief':
      return { key: 'getBrief', params: { id: e.id } };
    case 'tool_run':
      return { key: 'getToolRun', params: { id: e.id } };
    default:
      return null;
  }
}

/** JSON, capped, with a marker when cut. */
export function capJson(v: unknown, cap = READ_CAP): string {
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) return 'null';
  return s.length > cap ? `${s.slice(0, cap)}…(cut; ${s.length} characters in all)` : s;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

export function feedbackReads(ds: DataSource, ctx: FeedbackContextInput, scrubber: Scrubber): FeedbackReads {
  const call = readCaller(ds);
  const safe = async (fn: () => Promise<unknown>): Promise<unknown> => {
    try {
      return scrubber.scrubValue(await fn());
    } catch (err) {
      return { unavailable: scrubber.scrub(errText(err)) };
    }
  };
  return {
    eventLog: () =>
      safe(async () => {
        const r = (await call('getEventLog')) as { entries: Array<{ at: string; level: string; source: string; code: string; message: string; count: number; suggestedAction: string | null; acknowledged: boolean }> };
        // D-55: a source the persona has not activated (VDP for an AE) is no cause of anything they report
        const settings = (await call('getSettings').catch(() => null)) as Settings | null;
        const persona = settings ? personaOf(settings) : null;
        return r.entries
          .filter((e) => e.level !== 'info')
          .filter((e) => connectorRowsFor([{ id: e.source }], persona).length > 0)
          .sort((x, y) => (x.at < y.at ? 1 : -1))
          .slice(0, 15)
          .map((e) => ({ at: e.at, level: e.level, source: e.source, code: e.code, message: e.message.slice(0, 300), count: e.count, acknowledged: e.acknowledged, suggested: e.suggestedAction }));
      }),
    jobs: () =>
      safe(async () => {
        const r = (await call('getJobs')) as { jobs: Array<{ type: string; status: string; attempts: number; maxAttempts: number; runAt: string; finishedAt: string | null; error: string | null }>; counts: Record<string, number> };
        return {
          counts: r.counts,
          failing: r.jobs
            .filter((j) => j.status === 'dead' || j.status === 'retrying' || !!j.error)
            .slice(0, 12)
            .map((j) => ({ type: j.type, status: j.status, attempts: `${j.attempts}/${j.maxAttempts}`, at: j.finishedAt ?? j.runAt, error: j.error?.slice(0, 300) ?? null })),
        };
      }),
    health: () =>
      safe(async () => {
        const h = (await call('getHealth')) as {
          connectors: Array<{ id: string; state: string; lastSuccessAt: string | null; lastError: { class: string; message: string; at: string; count: number } | null; impact: string | null }>;
          worker: unknown;
          spend: { state: string; today: unknown };
          dryRun: boolean;
        };
        return {
          connectors: h.connectors.map((c) => ({ id: c.id, state: c.state, lastSuccessAt: c.lastSuccessAt, lastError: c.lastError ? { ...c.lastError, message: c.lastError.message.slice(0, 200) } : null, impact: c.impact })),
          worker: h.worker,
          spend: { state: h.spend.state, today: h.spend.today },
          dryRun: h.dryRun,
        };
      }),
    scans: () =>
      safe(async () => {
        const r = (await call('getScans')) as { runs: Array<{ connectorId: string; scope: string; kind: string; status: string; startedAt: string; endedAt: string | null; itemsSeen: number; itemsNew: number; costUsd: number; error: string | null }> };
        return r.runs
          .slice()
          .sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1))
          .slice(0, 10)
          .map((s) => ({ connector: s.connectorId, scope: s.scope, kind: s.kind, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, seen: s.itemsSeen, new: s.itemsNew, costUsd: s.costUsd, error: s.error?.slice(0, 200) ?? null }));
      }),
    trace: () =>
      safe(async () => {
        const id = ctx.lookingAt?.kind === 'work_item' ? ctx.lookingAt.id : (/^\/work\/([^/?]+)/.exec(ctx.route)?.[1] ?? null);
        return id ? call('getItemTrace', { params: { id } }) : null;
      }),
    page: () =>
      safe(async () => {
        const r = pageReadFor(ctx.route);
        return r ? { read: r.key, payload: await call(r.key, r) } : { read: null, note: 'This page has no single payload' };
      }),
    entity: () =>
      safe(async () => {
        const r = entityReadFor(ctx.lookingAt);
        return r ? { kind: ctx.lookingAt!.kind, read: r.key, payload: await call(r.key, r) } : null;
      }),
  };
}
