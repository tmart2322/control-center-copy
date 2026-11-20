/**
 * LD-1: likely-done work is distinct everywhere it appears. Out of Do now, the sections and Today's Top 3; in
 * Home's "Looks done: confirm" group, Triage's Looks done group and Work's Looks done section, with one evidence
 * line and one-click Confirm or Not done. Placeholder seed (src/mock/seed.example.json) and placeholder reasons.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HomePayload, TriagePayload } from '@/contract';
import { cleanLikelyReason, gapLabel, looksDoneEvidence } from '@/engines/home/looks-done';
import { FOCUS_ORDER, focusSection, groupByFocus } from '@/components/lists/grouping';
import { stripItem } from '@/components/home/model';
import { createMockDataSource, type MockDataSource } from '@/server/datasource/mock';
import { topWithoutLikelyDone } from '@/server/datasource/mock/views';

const LIKELY = 'w_hooli_refarch';

describe('LD-1: the evidence line', () => {
  it('drops the writer prefixes and speaks to the user', () => {
    expect(cleanLikelyReason("triage: My reply in the PLACEHOLDER thread: I'm flexible on the 17th")).toBe("Your reply in the PLACEHOLDER thread: I'm flexible on the 17th");
    expect(cleanLikelyReason('done_check: I replied "Yep here you go!" with the doc')).toBe('You replied "Yep here you go!" with the doc');
    expect(cleanLikelyReason('done_check: Resolved by PERSON_A: asker cancelled the prep session')).toBe('Resolved by PERSON_A: asker cancelled the prep session');
    expect(cleanLikelyReason('done_check: My DM reply answering the connector question')).toBe('Your DM reply answering the connector question');
    expect(cleanLikelyReason('My group DM reply with an output file', { capitalize: false })).toBe('your group DM reply with an output file');
    expect(cleanLikelyReason('delivered_with_attachment: file repo.zip; done_check: I sent the folder')).toBe('You sent the folder · with repo.zip');
    expect(cleanLikelyReason('done_check: partial: two of three sections')).toBe('Two of three sections');
    expect(cleanLikelyReason('')).toBe('Your reply looks like it finished this');
    expect(cleanLikelyReason(`triage: ${'x'.repeat(400)}`).length).toBeLessThanOrEqual(160);
  });

  it('says how long after the ask, when the sources carry both times', () => {
    const base = { likelyDone: { reason: 'done_check: I replied "Yep here you go!"' }, createdAt: '2026-11-06T15:00:00.000Z' };
    expect(looksDoneEvidence({ ...base, sources: [{ at: '2026-11-06T15:00:00.000Z' }, { at: '2026-11-06T15:16:00.000Z' }] })).toBe('You replied "Yep here you go!" · 16 min after the ask');
    expect(looksDoneEvidence({ ...base, sources: [{ at: '2026-11-06T15:00:00.000Z' }] })).toBe('You replied "Yep here you go!"');
    expect(looksDoneEvidence({ ...base, sources: [{}, {}] })).toBe('You replied "Yep here you go!"');
    expect(gapLabel(3 * 3_600_000)).toBe('3 h');
    expect(gapLabel(3 * 86_400_000)).toBe('3 d');
  });
});

describe('LD-1: Work groups it first, Today keeps it out of the Top 3', () => {
  it('a likely-done item is in the Looks done section whatever its date', () => {
    const now = '2026-11-06T15:00:00.000Z';
    expect(FOCUS_ORDER[0]).toBe('looks_done');
    expect(focusSection({ state: 'likely_done', startBy: null, due: '2026-11-01T15:00:00.000Z' }, now)).toBe('looks_done');
    const g = groupByFocus(
      [
        { id: 'a', state: 'open', startBy: null, due: '2026-11-06T18:00:00.000Z' },
        { id: 'b', state: 'likely_done', startBy: null, due: '2026-11-06T18:00:00.000Z' },
      ],
      now,
    );
    expect(g.map((x) => [x.key, x.items.map((i) => i.id)])).toEqual([
      ['focus:looks_done', ['b']],
      ['focus:do_now', ['a']],
    ]);
  });

  it('topWithoutLikelyDone refills from the rest in order and keeps the likely-done item in the rest', () => {
    const w = (id: string, state = 'open') => ({ id, state });
    const r = topWithoutLikelyDone([w('a'), w('b', 'likely_done'), w('c')], [w('d', 'likely_done'), w('e'), w('f')]);
    expect(r.top.map((x) => x.id)).toEqual(['a', 'c', 'e']);
    expect(r.rest.map((x) => x.id)).toEqual(['b', 'd', 'f']);
  });
});

describe('LD-1: on the mock DataSource', () => {
  let ds: MockDataSource;
  beforeAll(() => {
    ds = createMockDataSource({ seedPath: 'src/mock/seed.example.json', autoplay: false, clockMode: 'seed' });
  });
  afterAll(() => ds.dispose());

  it('Home: in the Looks done group with its evidence, never in Do now or a section', async () => {
    const h = HomePayload.parse(await ds.getHome({ query: { wide: false } }));
    expect(h.looksDone.count).toBe(1);
    expect(h.looksDone.rows[0]).toMatchObject({ id: LIKELY, href: `/work/${LIKELY}`, item: { id: LIKELY } });
    expect(h.looksDone.rows[0]!.evidence.length).toBeGreaterThan(0);
    expect(h.looksDone.rows[0]!.evidence).not.toMatch(/^(done_check|triage):/);
    expect(h.doNow.cards.map((c) => c.id)).not.toContain(LIKELY);
    for (const s of h.sections) expect(s.rows.map((r) => r.item?.id ?? r.entity.id)).not.toContain(LIKELY);
    // the optimistic strip takes it out of the group too
    expect(stripItem(h, LIKELY).looksDone).toEqual({ count: 0, rows: [] });
  });

  it('Triage: a Looks done group first, counted with the guesses', async () => {
    const t = TriagePayload.parse(await ds.getTriage({} as never));
    expect(t.groups[0]!.group).toBe('looks_done');
    expect(t.groups[0]!.items.map((i) => i.id)).toEqual([LIKELY]);
    expect(t.groups[0]!.items[0]!.why).not.toMatch(/^(done_check|triage):/);
    // SETTLE-1: Closed for you is a record, never counted with the guesses
    expect(t.count).toBe(t.groups.filter((g) => g.group !== 'closed_for_you').reduce((n, g) => n + g.items.length, 0));
  });

  it('Today: never one of the Top 3', async () => {
    const today = await ds.getToday({} as never);
    expect(today.nowStack.cards.map((c) => c.item.id)).not.toContain(LIKELY);
  });

  it('Not done returns it to the open work (out of the group); Confirm on an open item is refused', async () => {
    const cur = (await ds.getItem({ params: { id: LIKELY } })).item;
    const r = await ds.itemAction({ params: { id: LIKELY, verb: 'not-done' }, body: { ifVersion: cur.version } } as never);
    expect(r.entity).toMatchObject({ state: 'in_progress', likelyDone: null });
    const h = await ds.getHome({ query: { wide: false } });
    expect(h.looksDone.count).toBe(0);
    await expect(ds.itemAction({ params: { id: LIKELY, verb: 'confirm-done' }, body: { ifVersion: r.entity.version } } as never)).rejects.toThrow(/likely-done/);
    await expect(ds.itemAction({ params: { id: LIKELY, verb: 'not-done' }, body: { ifVersion: r.entity.version } } as never)).rejects.toThrow(/likely-done/);
  });
});
