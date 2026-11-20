/**
 * D-56 · the Feedback panel's context capture: the page (from the route map, never a page's own title override),
 * the route without the panel's own parameters, "Looking at", the build, the persona, the recent client errors.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { FeedbackContextInput } from '../../src/contract';
import { clearClientErrors, pushClientError, recentClientErrors } from '../../src/components/feedback/client-errors';
import { captureFeedbackContext, feedbackContextFor, openFeedbackReport, routeOf } from '../../src/components/feedback/context';

describe('captureFeedbackContext', () => {
  it('captures page, route, Looking at, build, persona, errors and viewport, within the contract', () => {
    const ctx = captureFeedbackContext({
      pathname: '/time',
      search: '?view=log&panel=details&item=w_123&kind=work_item',
      lookingAt: { kind: 'work_item', id: 'w_123', label: 'Prep the workshop' },
      persona: 'SE',
      version: '0.1.0',
      sha: 'abc1234def5678',
      errors: ['TypeError: x is undefined (TimePage.tsx:42)'],
      viewport: { width: 1440, height: 900 },
    });
    expect(ctx).toEqual({
      page: 'Activity',
      route: '/time?view=log',
      lookingAt: { kind: 'work_item', id: 'w_123', label: 'Prep the workshop' },
      version: '0.1.0',
      sha: 'abc1234def5678',
      persona: 'SE',
      clientErrors: ['TypeError: x is undefined (TimePage.tsx:42)'],
      viewport: '1440×900',
    });
    expect(FeedbackContextInput.safeParse(ctx).success).toBe(true);
  });

  it('uses the route map title (an account page is "Account", never the account name) and ignores a feedback entity', () => {
    const ctx = captureFeedbackContext({ pathname: '/deals/acc_1', lookingAt: { kind: 'feedback', id: 'report-1', label: 'Report a bug / idea' } });
    expect(ctx.page).toBe('Account');
    expect(ctx.lookingAt).toBeNull();
    // a page-level context left behind by Settings is not what the user looks at on Time
    expect(captureFeedbackContext({ pathname: '/time', lookingAt: { kind: 'settings', id: 'settings', label: 'Settings' } }).lookingAt).toBeNull();
    expect(ctx.version).toBe('');
    expect(ctx.persona).toBeNull();
  });

  it('keeps the last ten errors and caps each', () => {
    const errors = Array.from({ length: 14 }, (_, i) => `e${i} ${'x'.repeat(500)}`);
    const ctx = captureFeedbackContext({ pathname: '/', errors });
    expect(ctx.clientErrors).toHaveLength(10);
    expect(ctx.clientErrors[0]!.startsWith('e4 ')).toBe(true);
    expect(ctx.clientErrors.every((e) => e.length <= 400)).toBe(true);
    expect(FeedbackContextInput.safeParse(ctx).success).toBe(true);
  });

  it('routeOf drops only the panel parameters', () => {
    expect(routeOf('/work', '?tab=mine&panel=assistant')).toBe('/work?tab=mine');
    expect(routeOf('', '')).toBe('/');
  });

  it('hands the captured context from the click to the panel', () => {
    const ctx = captureFeedbackContext({ pathname: '/outbox' });
    const id = openFeedbackReport(ctx);
    expect(id).toMatch(/^report-/);
    expect(feedbackContextFor(id)).toEqual(ctx);
    expect(feedbackContextFor('report-unknown')).toBeNull();
  });
});

describe('recent client errors', () => {
  beforeEach(() => clearClientErrors());

  it('keeps ten, oldest first, collapses whitespace and repeats', () => {
    for (let i = 0; i < 12; i++) pushClientError(`boom ${i}\n  at x`);
    pushClientError('boom 11 at x');
    const e = recentClientErrors();
    expect(e).toHaveLength(10);
    expect(e[0]).toBe('boom 2 at x');
    expect(e[9]).toBe('boom 11 at x');
  });
});
