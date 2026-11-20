// @vitest-environment jsdom
/**
 * Activity ▸ Log it ▸ Ready to log, live (2026-11-16): approving 70 rows at once left 1 row on screen and the rest held
 * behind a pill the list never drew, and the button said "Log 1 row" while it would stage all 71 (no ids = every row
 * ready). Rows you approve are never held back as a burst, and the button counts every row it takes.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h, createRef, type MutableRefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActivityEntry } from '@/contract';
import { resetIntent } from '@/client/intent';
import { cleanup, render } from '@/components/composer/__tests__/dom';
import { ReadyToLog, type ReadySelection, type ReadyToLogProps } from '@/components/time/ReadyToLog';

const { act } = await import('react');

const row = (n: number): ActivityEntry =>
  ({
    id: `r${n}`,
    version: 1,
    date: '2026-11-10',
    start: `2026-11-10T${String(8 + (n % 10)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00.000Z`,
    end: `2026-11-10T${String(9 + (n % 10)).padStart(2, '0')}:00:00.000Z`,
    durationH: 0.5,
    taskType: 'Admin',
    oppId: null,
    oppName: null,
    accountName: null,
    meetingType: null,
    description: `Row ${n}`,
    status: 'approved',
    confidence: 'likely',
    sources: [],
    userLockedFields: [],
    issues: [],
  }) as unknown as ActivityEntry;

const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

const props = (r: ActivityEntry[]): ReadyToLogProps => ({
  rows: r,
  pick: { taskTypeRequired: true, taskTypes: ['Admin'], internalActivity: true } as ReadyToLogProps['pick'],
  onLog: () => {},
  logging: false,
  primary: true,
  onOpen: () => {},
  onShow: () => {},
});

const qc = new QueryClient();
const ready = (r: ActivityEntry[], more: Partial<ReadyToLogProps> = {}) => h(QueryClientProvider, { client: qc }, h(ReadyToLog, { ...props(r), ...more }));

const button = (c: HTMLElement) => c.querySelector('[data-testid="q4-submit"]')?.textContent ?? '';
const listed = (c: HTMLElement) => c.querySelectorAll('[aria-label="Rows ready to log"] > li').length;

beforeEach(() => resetIntent());
afterEach(async () => cleanup());

describe('Ready to log, live', () => {
  it('shows rows approved in a burst at once (never held behind a pill it does not draw), and the button counts them all', async () => {
    const r = await render(ready(rows(1)));
    expect(listed(r.container)).toBe(1);
    expect(button(r.container)).toContain('Log this row to Slackbot');
    // 70 more rows approved at once (Needs you ▸ Approve, or a refetch after a stale cache)
    await act(async () => r.root.render(ready(rows(71))));
    expect(listed(r.container)).toBe(50); // the first page of 50; Show more has the rest
    expect(r.container.querySelector('[data-live-pill]')).toBeNull();
    expect(button(r.container)).toContain('Log these 71 rows to Slackbot · 35.5 h');
  });

  it('the button names every row it takes, even while arrivals wait (it stages every ready row when none is ticked)', async () => {
    const r = await render(ready(rows(2)));
    // the pointer is over the list: arrivals wait behind the pill, and the button still says what it will log
    const ul = r.container.querySelector('[aria-label="Rows ready to log"]')!;
    await act(async () => {
      ul.dispatchEvent(new Event('pointerover', { bubbles: true }));
      ul.dispatchEvent(new Event('pointermove', { bubbles: true }));
    });
    await act(async () => r.root.render(ready(rows(5))));
    expect(button(r.container)).toContain('Log these 5 rows to Slackbot · 2.5 h');
  });
});

describe('Ready to log: the button says what it logs (2026-11-16)', () => {
  it('waits while the use cases and updates are counted: no label naming fewer than it would log', async () => {
    let logged = 0;
    const r = await render(ready(rows(3), { counting: true, onLog: () => void logged++ }));
    const b = r.container.querySelector<HTMLButtonElement>('[data-testid="q4-submit"]')!;
    expect(b.textContent).toContain('Counting what is ready');
    expect(b.disabled).toBe(true);
    await act(async () => b.click());
    expect(logged).toBe(0);
    await act(async () => r.root.render(ready(rows(3))));
    expect(button(r.container)).toContain('Log these 3 rows to Slackbot');
  });

  it('shares its selection with the page (⌘↵ logs the ticked ones, like the button), null when none is ticked', async () => {
    const sel = createRef<ReadySelection>() as MutableRefObject<ReadySelection>;
    const r = await render(ready(rows(3), { selectionRef: sel }));
    expect(sel.current).toBeNull();
    const boxes = r.container.querySelectorAll<HTMLInputElement>('[aria-label="Rows ready to log"] input[type="checkbox"]');
    await act(async () => boxes[1]!.click());
    expect(sel.current).toEqual({ ids: ['r2'], useCases: [], updates: [] });
    expect(button(r.container)).toContain('Log the 1 ticked row');
  });
});
