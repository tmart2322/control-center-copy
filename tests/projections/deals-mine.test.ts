/**
 * DEALS-1 (placeholders only): Deals counts my opps, not every opp on my accounts. REC-2 records every changed opp on
 * an account (1,098 in one week on big accounts), and Deals read "85 open opps without your DC" for opps I'm not on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockDataSource, type MockDataSource } from '@/server/datasource/mock';
import { isMyOpp, sweptOppIds } from '@/server/datasource/mock/views';

describe('DEALS-1: my opps', () => {
  it('team, DC, this quarter\'s hours or a sweep finding make an opp mine; nothing else does', () => {
    const base = { id: 'o1', isMine: false, dcAssigned: false, hoursQtd: 0 };
    expect(isMyOpp(base)).toBe(false);
    expect(isMyOpp({ ...base, isMine: true })).toBe(true);
    expect(isMyOpp({ ...base, dcAssigned: true })).toBe(true);
    expect(isMyOpp({ ...base, hoursQtd: 0.5 })).toBe(true);
    const swept = sweptOppIds([
      { oppId: 'o1', status: 'new' },
      { oppId: 'o2', status: 'dismissed' },
      { oppId: null, status: 'new' },
    ]);
    expect(isMyOpp(base, swept)).toBe(true);
    expect(isMyOpp({ ...base, id: 'o2' }, swept)).toBe(false);
  });

  describe('getDeals on the mock', () => {
    let ds: MockDataSource;
    beforeAll(() => {
      ds = createMockDataSource({ seedPath: 'src/mock/seed.example.json', autoplay: false, clockMode: 'seed' });
    });
    afterAll(() => ds.dispose());

    it('an account counts only its open opps that are mine, however many others it has', async () => {
      const d = await ds.getDeals({} as never);
      for (const a of d.accounts) {
        const detail = await ds.getAccount({ params: { accountId: a.id } } as never);
        const missed = (await ds.getMissed({} as never)).missed;
        const mine = detail.opps.filter((o) => o.isOpen && isMyOpp(o, sweptOppIds(missed)));
        expect(a.openOpps).toBe(mine.length);
        expect(a.pipelineAmount).toBe(mine.reduce((s, o) => s + (o.amount ?? 0), 0));
      }
    });
  });
});
