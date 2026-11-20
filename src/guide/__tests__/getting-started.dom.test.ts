// @vitest-environment jsdom
/**
 * The Getting started popover in a DOM: what is left comes first in the path's order, done items fold into
 * "Done · N", every button names where it goes, and a button asks CoachMarks for that item's guidance (an action's tip,
 * or a page's whole tour). All done: "You're set up · Done", and the popover offers to hide the checklist.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidePayload } from '@/contract';
import { $, $$, cleanup, click, render, waitFor } from '@/components/composer/__tests__/dom';
import { guidePayload, PERSONA_REVIEWED_KEY, type GuideInputs } from '@/guide/checklist';
import { exploreFor, tourDoneKey } from '@/guide/pages';
import { GUIDE_EVENT, type GuideRequest } from '@/guide/request';
import { personaOf } from '@/personas';

const se = personaOf({ profile: { role: 'se_ic' } });
const state: { g: GuidePayload | null } = { g: null };
const markSeen = vi.fn();
const dismissChecklist = vi.fn();
const openFeedback = vi.fn();
vi.mock('@/client/hooks', () => ({ useApi: () => ({ data: state.g, refetch: () => Promise.resolve() }) }));
vi.mock('@/guide/useGuide', () => ({ useGuideSettings: () => ({ guide: { version: 1, checklistDismissed: false, seen: {} }, ready: true, markSeen, dismissChecklist, resetGuide: () => {}, pending: false }) }));
vi.mock('@/components/shell/FeedbackButton', () => ({ useOpenFeedback: () => openFeedback }));

const { GettingStarted } = await import('@/guide/GettingStarted');

const at = '2026-11-11T09:00:00Z';
function payload(over: Partial<GuideInputs> = {}): GuidePayload {
  return guidePayload({
    connectors: se.connectors.map((c) => ({ id: c, label: c, state: 'ok' as const, lastSuccessAt: at })),
    drafts: [],
    assistantMessages: 0,
    firstScan: null,
    persona: se,
    personaVersion: 1,
    guide: { seen: {}, checklistDismissed: false },
    ...over,
  });
}

async function open(g: GuidePayload) {
  state.g = g;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(h(QueryClientProvider, { client: qc }, h(GettingStarted, {})));
  await click($('[data-testid="getting-started"]'));
  return waitFor(() => $('[data-testid="getting-started-list"]'));
}

afterEach(async () => {
  await cleanup();
  state.g = null;
  for (const f of [markSeen, dismissChecklist, openFeedback]) f.mockReset();
});

describe('Getting started popover', () => {
  it('lists what is left in order and folds the done items into "Done · N"', async () => {
    const g = payload({ assistantMessages: 2, guide: { seen: { [tourDoneKey('home')]: at }, checklistDismissed: false } });
    await open(g);
    const left = $$('[data-testid="gs-open"] > li').map((li) => li.getAttribute('data-testid')!.slice('gs-item-'.length));
    expect(left).toEqual(g.items.filter((i) => i.state !== 'done').map((i) => i.id));
    expect(left.slice(0, 3)).toEqual(['persona', 'tour.triage', 'tour.outbox']);
    const toggle = $('[data-testid="gs-done-toggle"]')!;
    expect(toggle.textContent).toBe('Done · 4');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect($('[data-testid="gs-done"]')).toBeNull();
    await click(toggle);
    expect($$('[data-testid="gs-done"] > li').map((li) => li.getAttribute('data-testid'))).toEqual(['gs-item-sources', 'gs-item-firstScan', 'gs-item-tour.home', 'gs-item-assistant']);
    // a done tour can be taken again; a done action has no button
    expect($('[data-testid="gs-go-tour.home"]')!.textContent).toBe('Take it again');
    expect($('[data-testid="gs-go-assistant"]')).toBeNull();
  });

  it('every button names where it goes, and asks for that item’s guidance', async () => {
    const asked: GuideRequest[] = [];
    const on = (e: Event) => asked.push((e as CustomEvent<GuideRequest>).detail);
    window.addEventListener(GUIDE_EVENT, on);
    try {
      await open(payload());
      expect($('[data-testid="gs-go-persona"]')!.textContent).toBe('Open Role & rules');
      expect($('[data-testid="gs-go-persona"]')!.getAttribute('href')).toBe('/settings?section=role');
      expect($('[data-testid="gs-go-tour.triage"]')!.textContent).toBe('Take the tour');
      expect($('[data-testid="gs-go-draft"]')!.textContent).toBe('Show me in the Outbox');
      expect($$('[data-testid^="gs-go-"]').map((b) => b.textContent)).not.toContain('Open');
      // Feedback plays where you are: no navigation, the tip spotlights the top-bar button
      await click($('[data-testid="gs-go-feedback"]'));
      expect(asked).toEqual([{ page: null, item: 'feedback' }]);
      await waitFor(() => !$('[data-testid="getting-started-list"]'));
    } finally {
      window.removeEventListener(GUIDE_EVENT, on);
    }
  });

  it('the role row confirms in place, and Feedback can still be reported in one click', async () => {
    await open(payload());
    await click($('[data-testid="gs-confirm-persona"]'));
    expect(markSeen).toHaveBeenCalledWith([PERSONA_REVIEWED_KEY]);
    await click($('[data-testid="gs-feedback"]'));
    expect(openFeedback).toHaveBeenCalledTimes(1);
  });

  it('all done: "You’re set up · Done", and the popover offers to hide the checklist', async () => {
    const seen: Record<string, string> = { [PERSONA_REVIEWED_KEY]: at };
    for (const e of exploreFor(se)) seen[tourDoneKey(e.page)] = at;
    const g = payload({
      drafts: [
        { status: 'sent', destination: { kind: 'slack', target: 'thread', channelId: 'C0PLACE', channelName: 'x', threadTs: null } },
        { status: 'sent', destination: { kind: 'action', action: 'slack_canvas.create' } },
        { status: 'sent', destination: { kind: 'action', action: 'feedback.post' } },
      ] as never,
      assistantMessages: 1,
      guide: { seen, checklistDismissed: false },
    });
    expect(g.done).toBe(g.total);
    state.g = g;
    const qc = new QueryClient();
    await render(h(QueryClientProvider, { client: qc }, h(GettingStarted, {})));
    const card = $('[data-testid="getting-started"]')!;
    expect(card.textContent).toContain('You’re set up');
    expect(card.textContent).toContain('Done');
    await click(card);
    await waitFor(() => $('[data-testid="getting-started-list"]'));
    expect($('[data-testid="gs-open"]')).toBeNull();
    const hide = $('[data-testid="gs-dismiss"]')!;
    expect(hide.textContent).toBe('Hide the checklist');
    await act(async () => hide.click());
    expect(dismissChecklist).toHaveBeenCalledWith(true);
  });
});
