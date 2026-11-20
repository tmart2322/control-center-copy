/** Deep links into Deals, Briefs, Outbox and Settings land where they say (hrefFor, ⌘K's hrefForRef, the Deals pages). */
import { describe, expect, it } from 'vitest';
import { accountOppDeepLink, dealsDeepLink, missedDeepLink, oppAccountHref } from './links';
import { hrefForRef } from '@/components/shell/CommandPalette';
import { pageForEntity } from '@/components/shell/RightPanel';
import { hrefFor } from '@/server/datasource/mock/views';

const q = (s: string) => new URLSearchParams(s);

describe('Deals honors the links other views build', () => {
  it('/deals?opp= asks for the opp; /deals?tab=missed&id= goes to Missed with the row', () => {
    expect(dealsDeepLink(q('opp=o_1'))).toEqual({ kind: 'opp', id: 'o_1' });
    expect(dealsDeepLink(q('tab=missed&id=m_7'))).toEqual({ kind: 'missed', href: '/deals/missed?id=m_7' });
    expect(dealsDeepLink(q('tab=missed'))).toEqual({ kind: 'missed', href: '/deals/missed' });
    expect(dealsDeepLink(q(''))).toBeNull();
    expect(dealsDeepLink(q('opp=%20'))).toBeNull();
    expect(dealsDeepLink(null)).toBeNull();
  });

  it('an opp lands on its account page with the opp open; unknown opps have no account href', () => {
    const opps = [
      { id: 'o_1', accountId: 'a_1' },
      { id: 'o_2', accountId: null },
    ];
    expect(oppAccountHref(opps, 'o_1')).toBe('/deals/a_1?opp=o_1');
    expect(oppAccountHref(opps, 'o_2')).toBeNull();
    expect(oppAccountHref(opps, 'o_x')).toBeNull();
    expect(oppAccountHref(undefined, 'o_1')).toBeNull();
    expect(accountOppDeepLink(q('opp=o_1'))).toBe('o_1');
    expect(missedDeepLink(q('id=m_7'))).toBe('m_7');
    expect(missedDeepLink(q('account=acme'))).toBeNull();
  });

  it("hrefFor builds the links the pages read (Briefs' ?brief=, Missed's ?id=)", () => {
    expect(hrefFor({ type: 'brief', id: 'b_1' })).toBe('/briefs?brief=b_1');
    expect(hrefFor({ type: 'missed_opp', id: 'm_1' })).toBe('/deals/missed?id=m_1');
    expect(hrefFor({ type: 'opportunity', id: 'o_1' })).toBe('/deals?opp=o_1');
    expect(dealsDeepLink(q(hrefFor({ type: 'opportunity', id: 'o_1' }).split('?')[1]!))).toEqual({ kind: 'opp', id: 'o_1' });
  });
});

describe('⌘K: every hit kind has a real destination', () => {
  it('drafts, connectors, opps and missed opps no longer fall back to Home', () => {
    expect(hrefForRef({ type: 'draft', id: 'dr_1' })).toBe('/outbox?draft=dr_1');
    expect(hrefForRef({ type: 'connector', id: 'slack' })).toBe('/settings?section=connectors');
    expect(hrefForRef({ type: 'opportunity', id: 'o_1' })).toBe('/deals?opp=o_1');
    expect(hrefForRef({ type: 'missed_opp', id: 'm_1' })).toBe('/deals/missed?id=m_1');
    expect(hrefForRef({ type: 'brief', id: 'b_1' })).toBe('/briefs?brief=b_1');
    // The server's href still wins when the hit carries one.
    expect(hrefForRef({ type: 'draft', id: 'dr_1', href: '/outbox?draft=dr_1&x=1' })).toBe('/outbox?draft=dr_1&x=1');
  });

  it("a panel entity with no renderer links to the thing, not the page's top", () => {
    expect(pageForEntity({ kind: 'draft', id: 'dr_1' })).toBe('/outbox?draft=dr_1');
    expect(pageForEntity({ kind: 'connector', id: 'slack' })).toBe('/settings?section=connectors');
    expect(pageForEntity({ kind: 'chat_thread', id: 'c_1' })).toBeNull();
  });
});
