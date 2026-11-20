/**
 * Watch subscriptions (R-UI-21): the deterministic side is scoping metadata only. Slack and Org62 fetching belongs to BE-2a's
 * traversal runner. This module
 *   1. expands the user's subscriptions into scan scopes (`slack:channel:<id>`, `opp:<id>`, `account:<id>`),
 *   2. computes the window for each (since the last brief, or the last 24 h),
 *   3. emits ONE scope-plan item per scope as the skill agent's prefetched context, so `scan-watch` knows exactly which
 *      channel to read, from where, and what the user cares about (relevance profile).
 */
import type { ConnectorHealthProbe, CoverageObject, Cursor, DeterministicFetcher, FetchResult, NormalizedSourceItem, TimeWindow } from '@/scanner/types';
import { decodeCursor, encodeCursor, h16, systemClock, type Clock } from './util';

export type WatchKind = 'slack_channel' | 'opp' | 'account' | 'gmail_label' | 'drive_folder';

export interface WatchSubscription {
  id: string;
  kind: WatchKind;
  /** Slack channel id, Org62 opp id, account id, label, folder id. */
  ref: string;
  label: string;
  /** `since_last_brief` (default) or a fixed `daily` period. */
  period?: 'since_last_brief' | 'daily';
  /** ISO of the last brief produced for this subscription. */
  lastBriefAt?: string;
  /** Free text the user gave about why they follow it (relevance hint). */
  why?: string;
  enabled?: boolean;
}

export interface WatchRelevanceProfile {
  accounts: string[];
  opps: string[];
  initiatives: string[];
  skills: string[];
  policyNotes: string[];
}

export interface WatchPlan {
  scope: string;
  subscriptionId: string;
  kind: WatchKind;
  ref: string;
  label: string;
  window: TimeWindow;
  /** Exact Slack arguments for the skill (BE-2a's runner supplies the tool): `oldest` is a Slack ts (seconds.micros). */
  slack?: { channelId: string; oldest: string; latest: string };
  org62?: { oppId?: string; accountId?: string };
  why?: string;
  relevance?: WatchRelevanceProfile;
}

export const watchScope = (s: WatchSubscription): string => (s.kind === 'slack_channel' ? `slack:channel:${s.ref}` : `${s.kind === 'opp' ? 'opp' : s.kind === 'account' ? 'account' : s.kind}:${s.ref}`);

export function expandWatchScopes(subs: WatchSubscription[]): string[] {
  return [...new Set(subs.filter((s) => s.enabled !== false).map(watchScope))];
}

export function planWatch(sub: WatchSubscription, cursor: Cursor | null, now: Date, relevance?: WatchRelevanceProfile): WatchPlan {
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const from = sub.period === 'daily' ? dayAgo : (cursor?.at ?? sub.lastBriefAt ?? dayAgo);
  const window = { from, to: now.toISOString() };
  const plan: WatchPlan = { scope: watchScope(sub), subscriptionId: sub.id, kind: sub.kind, ref: sub.ref, label: sub.label, window, why: sub.why, relevance };
  if (sub.kind === 'slack_channel') plan.slack = { channelId: sub.ref, oldest: (Date.parse(from) / 1000).toFixed(6), latest: (now.getTime() / 1000).toFixed(6) };
  if (sub.kind === 'opp') plan.org62 = { oppId: sub.ref };
  if (sub.kind === 'account') plan.org62 = { accountId: sub.ref };
  return plan;
}

export interface WatchFetcherOptions {
  subscriptions: (ctx: { userId: string }) => Promise<WatchSubscription[]>;
  relevance?: (ctx: { userId: string }) => Promise<WatchRelevanceProfile | undefined>;
  clock?: Clock;
}

export class WatchScopeFetcher implements DeterministicFetcher {
  readonly connector = 'watch' as const;
  private readonly clock: Clock;
  private subsCache: WatchSubscription[] = [];

  constructor(private readonly o: WatchFetcherOptions) {
    this.clock = o.clock ?? systemClock;
  }

  async scopes(ctx: { userId: string }): Promise<string[]> {
    this.subsCache = await this.o.subscriptions(ctx);
    return expandWatchScopes(this.subsCache);
  }

  async health(): Promise<ConnectorHealthProbe> {
    return { state: 'ok', checkedAt: this.clock().toISOString(), detail: 'scoping only; Slack/Org62 health is reported by their own connectors' };
  }

  async listForReconcile(scope: string, window: TimeWindow): Promise<CoverageObject[]> {
    // Nothing to list deterministically: Slack objects are listed by the traversal runner.
    return [{ kind: 'query_window', ref: `watch:${scope}`, from: window.from, to: window.to }];
  }

  async fetch(scope: string, cursor: Cursor | null, _window: TimeWindow, _opts: { signal: AbortSignal; limit?: number }): Promise<FetchResult> {
    const now = this.clock();
    const sub = this.subsCache.find((s) => watchScope(s) === scope);
    if (!sub) return { items: [], coverage: [], nextCursor: cursor ?? { value: '{}', at: now.toISOString() }, complete: true };
    const prev = decodeCursor<{ lastTo?: string }>(cursor, {});
    const plan = planWatch(sub, prev.lastTo ? { value: cursor!.value, at: prev.lastTo } : cursor, now, await this.o.relevance?.({ userId: '' }));
    const item: NormalizedSourceItem = {
      connector: 'watch',
      kind: 'manual_note',
      externalId: `plan:${scope}:${plan.window.from}`,
      dedupeKey: `watch-plan:${scope}:${plan.window.from}`,
      contentHash: h16(JSON.stringify(plan.window), sub.label, sub.why),
      occurredAt: now.toISOString(),
      title: `Watch scope: ${sub.label}`,
      threadRef: sub.kind === 'slack_channel' ? `slack:${sub.ref}` : undefined,
      payload: { plan },
    };
    return {
      items: [item],
      coverage: [{ kind: 'query_window', ref: `watch:${scope}`, from: plan.window.from, to: plan.window.to }],
      nextCursor: encodeCursor({ lastTo: plan.window.to }, plan.window.to),
      complete: true,
    };
  }
}
