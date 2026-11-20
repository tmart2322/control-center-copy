'use client';
/**
 * The guide's settings on the client: mark coach marks seen, dismiss or bring back the Getting started checklist.
 * Writes PATCH /settings/guide (instant section). A 409 re-sends on the server's version, merging `seen`.
 */
import { useCallback } from 'react';
import type { GuideSettings, PatchSettingsRequest, Settings } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { GUIDE_RESET, mergeSeen } from './seen';

type GuideValue = Partial<Pick<GuideSettings, 'checklistDismissed' | 'seen'>>;

export function useGuideSettings() {
  const settings = useApi('getSettings');
  const guide = settings.data?.guide;
  const patch = useOptimisticMutation({
    route: 'patchSettings',
    topics: ['settings'],
    writeBack: false,
    rebase: ({ input, current }) => {
      const cur = (current as unknown as Partial<Settings>).guide;
      if (!cur || typeof cur.version !== 'number') return null;
      const body = input.body as PatchSettingsRequest;
      const value = body.value as GuideValue;
      const next: GuideValue = value.seen && Object.keys(value.seen).length ? { ...value, seen: { ...cur.seen, ...value.seen, ...pickOlder(cur.seen, value.seen) } } : value;
      return { ...input, body: { ...body, ifVersion: cur.version, value: next } };
    },
  });

  const write = useCallback(
    (value: GuideValue) => {
      if (!guide) return;
      patch.mutate({ params: { section: 'guide' }, body: { ifVersion: guide.version, value } });
    },
    [guide, patch],
  );

  const markSeen = useCallback(
    (ids: readonly string[]) => {
      if (!guide || ids.every((id) => guide.seen[id])) return;
      write({ seen: mergeSeen(guide.seen, ids, new Date().toISOString()) });
    },
    [guide, write],
  );
  const dismissChecklist = useCallback((dismissed = true) => write({ checklistDismissed: dismissed }), [write]);
  const resetGuide = useCallback(() => write({ ...GUIDE_RESET }), [write]);

  return { guide, ready: Boolean(guide), markSeen, dismissChecklist, resetGuide, pending: patch.isPending };
}

/** Keep the earlier time for ids both copies have. */
function pickOlder(a: GuideSettings['seen'], b: GuideSettings['seen']): GuideSettings['seen'] {
  const out: GuideSettings['seen'] = {};
  for (const k of Object.keys(b)) if (a[k] && a[k]! < b[k]!) out[k] = a[k]!;
  return out;
}
