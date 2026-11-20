'use client';
/**
 * Promote → Triage · Make task · Not relevant for a brief highlight (UI-SPEC §12 Briefs).
 * Optimistic with Undo: the card changes state at once, the briefs list's "worth a look" count and the
 * nav badge follow, and promoting makes a suggested item that shows up in Triage live (the server emits
 * the triage topic, which the Triage page and the nav badge are subscribed to).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { Brief, BriefHighlight, BriefsPayload } from '@/contract';
import { api, ApiError } from '@/client/api';
import { useOptimisticMutation, type OptimisticCache } from '@/client/optimistic';
import { toast } from '@/client/toast';
import { isOpenHighlight, withBriefsUnread, withHighlightStatus, withWorthALook, type HighlightStatus } from '@/components/lists/cache-patches';
import { forgetHighlightChange, highlightChangeOf, rememberHighlightChange } from './highlight-undo';

const TOPICS = ['briefs', 'today', 'triage', 'items'];

export function useHighlightActions() {
  const qc = useQueryClient();
  const inflight = useRef(new Map<string, Promise<unknown>>());
  const current = useRef<{ h: BriefHighlight; status: HighlightStatus; kind: 'promote' | 'task' | 'dismiss' } | null>(null);

  const optimistic = (_input: unknown, cache: OptimisticCache) => {
    const c = current.current;
    if (!c) return;
    // The card shows where it went at once ("In Triage" / "Task made"), not "Promoted" until the server answers.
    const as: BriefHighlight['promotedAs'] = c.kind === 'task' ? 'task' : c.kind === 'promote' ? 'triage' : undefined;
    const patch = (b: Brief) => {
      const next = withHighlightStatus(b, c.h.id, c.status);
      return as ? { ...next, highlights: next.highlights.map((x) => (x.id === c.h.id ? { ...x, promotedAs: as } : x)) } : next;
    };
    for (const [key, data] of cache.client.getQueriesData<Brief>({ queryKey: ['briefs'] })) {
      if (data && 'highlights' in data && data.id === c.h.briefId) cache.setQuery<Brief>(key, (old) => (old ? patch(old) : old));
    }
    if (isOpenHighlight(c.h.status)) {
      for (const [key, data] of cache.client.getQueriesData<BriefsPayload>({ queryKey: ['briefs'] })) {
        if (data && 'watched' in data) cache.setQuery<BriefsPayload>(key, (old) => (old ? withWorthALook(old, c.h.briefId, -1) : old));
      }
    }
  };
  const onSuccess = (res: { auditId: string | null }) => {
    const c = current.current;
    if (c && res.auditId) rememberHighlightChange(c.h.id, { auditId: res.auditId, kind: c.kind });
  };
  const onError = (err: ApiError) =>
    toast({ key: 'highlight-err', title: "Couldn't update that highlight", body: `${err.message}. It is back as it was.`, tone: 'error', durationMs: null });

  const promote = useOptimisticMutation({
    route: 'promoteHighlight',
    topics: TOPICS,
    optimistic,
    onSuccess,
    onError,
    toast: (res) => ({ title: `Promoted to Triage: ${res.entity.title}`, body: 'It is waiting in Triage for you to accept.', key: `hl:${res.entity.id}` }),
  });
  const task = useOptimisticMutation({
    route: 'taskFromHighlight',
    topics: TOPICS,
    optimistic,
    onSuccess,
    onError,
    toast: (res) => ({ title: `Task created: ${res.entity.title}`, key: `hl:${res.entity.id}` }),
  });
  const dismiss = useOptimisticMutation({
    route: 'dismissHighlight',
    topics: TOPICS,
    optimistic,
    onSuccess,
    onError,
    toast: (res) => ({ title: `Not relevant: ${res.entity.title}`, body: 'Relevance is tuned for next time.', key: `hl:${res.entity.id}` }),
  });

  const run = (kind: 'promote' | 'task' | 'dismiss', h: BriefHighlight) => {
    const status: HighlightStatus = kind === 'dismiss' ? 'dismissed' : 'promoted';
    current.current = { h, status, kind };
    const input = { params: { id: h.id }, body: { ifVersion: h.version } };
    const m = kind === 'promote' ? promote : kind === 'task' ? task : dismiss;
    const p = m.mutateAsync(input).catch(() => undefined);
    inflight.current.set(h.id, p);
    void p.then(() => inflight.current.delete(h.id));
  };

  /** The card's own Undo (after the toast is gone). */
  const undo = async (h: BriefHighlight) => {
    await inflight.current.get(h.id); // an Undo clicked before the server answered waits for its audit id
    const change = highlightChangeOf(h.id);
    if (!change) {
      toast({ key: `hl:${h.id}`, title: 'That change is from an earlier session', body: 'Open the item and use its history to roll it back.', tone: 'warning' });
      return;
    }
    try {
      await api('undoAudit', { params: { id: change.auditId }, body: {} });
      forgetHighlightChange(h.id);
      await Promise.all(TOPICS.map((t) => qc.invalidateQueries({ queryKey: [t] })));
      void qc.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      toast({ key: `hl:${h.id}`, title: "Couldn't undo", body: e instanceof ApiError ? e.message : String(e), tone: 'error', durationMs: null });
    }
  };

  return {
    promote: (h: BriefHighlight) => run('promote', h),
    makeTask: (h: BriefHighlight) => run('task', h),
    dismiss: (h: BriefHighlight) => run('dismiss', h),
    undo,
    kindOf: (id: string) => highlightChangeOf(id)?.kind ?? null,
  };
}

/** Reading a brief marks it read; keep the nav badge honest before the server round-trip lands. */
export function patchUnreadBadge(qc: ReturnType<typeof useQueryClient>, delta: number) {
  qc.setQueriesData<import('@/contract').TodayPayload>({ queryKey: ['today'] }, (old) => (old && old.navCounts ? withBriefsUnread(old, delta) : old));
}
