/** A handled brief highlight shows one state: In Triage (Promote) or Task made (Make task), never Promoted beside a task. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPromotedAs, type Brief, type BriefHighlight } from '@/contract';
import { createMockDataSource, type MockDataSource } from '@/server/datasource/mock';
import { promotedState } from './promoted';

const hl = (over: Partial<BriefHighlight>): Pick<BriefHighlight, 'status' | 'promotedWorkItemId' | 'promotedAs'> => ({ status: 'promoted', promotedWorkItemId: 'w_1', ...over });

describe('promotedState: one word, one way to open it', () => {
  it('Promote → In Triage, opening that row in Triage', () => {
    expect(promotedState(hl({ promotedAs: 'triage' }))).toEqual({ word: 'In Triage', open: { label: 'Open in Triage', href: '/triage?item=w_1' } });
  });
  it('Make task → Task made, opening the task', () => {
    expect(promotedState(hl({ promotedAs: 'task' }))).toEqual({ word: 'Task made', open: { label: 'Open task', taskId: 'w_1' } });
  });
  it("this session's action answers before the server's promotedAs lands", () => {
    expect(promotedState(hl({}), 'task')?.word).toBe('Task made');
    expect(promotedState(hl({}), 'promote')?.word).toBe('In Triage');
    // the server's word wins (a promotion you accepted since is a task)
    expect(promotedState(hl({ promotedAs: 'task' }), 'promote')?.word).toBe('Task made');
  });
  it('an item the app can no longer read keeps the plain word; open highlights have no state', () => {
    expect(promotedState(hl({ promotedWorkItemId: null }))).toEqual({ word: 'Promoted', open: { label: 'Open Triage', href: '/triage' } });
    expect(promotedState({ status: 'new', promotedWorkItemId: null })).toBeNull();
    expect(promotedState({ status: 'dismissed', promotedWorkItemId: null })).toBeNull();
  });
  it('withPromotedAs reads the item: suggested → triage, live or done → task, dismissed or gone → nothing', () => {
    const b = { highlights: [{ id: 'h1', status: 'promoted', promotedWorkItemId: 'a' }, { id: 'h2', status: 'promoted', promotedWorkItemId: 'b' }, { id: 'h3', status: 'promoted', promotedWorkItemId: 'c' }, { id: 'h4', status: 'new', promotedWorkItemId: null }] } as unknown as Pick<Brief, 'highlights'>;
    const states: Record<string, string> = { a: 'suggested', b: 'open', c: 'dismissed' };
    const out = withPromotedAs(b, (id) => states[id]).highlights.map((h) => h.promotedAs ?? null);
    expect(out).toEqual(['triage', 'task', null, null]);
  });
});

describe('the DataSource fills promotedAs at read time (mock; the db twin uses the same helper)', () => {
  let ds: MockDataSource;
  beforeAll(() => {
    ds = createMockDataSource({ seedPath: 'src/mock/seed.example.json', autoplay: false, clockMode: 'seed' });
  });
  afterAll(() => ds.dispose());

  it('Promote reads back as triage, Make task as task, and an accepted promotion as task', async () => {
    const list = await ds.getBriefs({});
    const briefs = await Promise.all([...list.watched, ...list.opportunities].map((s) => ds.getBrief({ params: { id: s.id } })));
    const open = briefs.flatMap((b) => b.highlights.filter((h) => h.status === 'new' || h.status === 'seen'));
    expect(open.length).toBeGreaterThanOrEqual(2);
    const [a, t] = open as [BriefHighlight, BriefHighlight];
    const promoted = await ds.promoteHighlight({ params: { id: a.id }, body: { ifVersion: a.version } } as never);
    expect(promoted.entity.promotedAs).toBe('triage');
    const tasked = await ds.taskFromHighlight({ params: { id: t.id }, body: { ifVersion: t.version } } as never);
    expect(tasked.entity.promotedAs).toBe('task');
    const read = async (h: BriefHighlight) => (await ds.getBrief({ params: { id: h.briefId } })).highlights.find((x) => x.id === h.id)!;
    expect((await read(a)).promotedAs).toBe('triage');
    expect((await read(t)).promotedAs).toBe('task');
    const wid = promoted.entity.promotedWorkItemId!;
    const item = (await ds.getItem({ params: { id: wid } })).item;
    await ds.itemAction({ params: { id: wid, verb: 'accept' }, body: { ifVersion: item.version } } as never);
    expect((await read(a)).promotedAs).toBe('task');
  });
});
