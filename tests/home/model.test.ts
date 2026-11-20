/** Home view helpers (src/components/home/model.ts): selection targets, optimistic strip, formatting. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardKey, fmtDur, holdsOpen, homeTargets, leavesHome, notNowToast, openKeyFor, ribbonLayout, ribbonMaxLanes, rowKey, stateGlyph, stripItem } from '@/components/home/model';
import { packColumns } from '@/components/domain/lib/lanes';
import type { HomeCard, HomePayload, HomeRibbonBlock } from '@/contract';
import { createMockDataSource, type MockDataSource } from '@/server/datasource/mock';

let ds: MockDataSource;
let h: HomePayload;
beforeAll(async () => {
  ds = createMockDataSource({ seedPath: 'src/mock/seed.example.json', autoplay: false, clockMode: 'seed' });
  h = await ds.getHome({ query: { wide: true } });
});
afterAll(() => ds.dispose());

describe('home view model', () => {
  it('targets walk Do now cards first, then rows section by section', () => {
    const t = homeTargets(h);
    expect(t.slice(0, h.doNow.cards.length).map((x) => x.key)).toEqual(h.doNow.cards.map(cardKey));
    const firstRow = h.sections.find((s) => s.rows.length)!;
    expect(t[h.doNow.cards.length]!.key).toBe(rowKey(firstRow.id, firstRow.rows[0]!));
    expect(new Set(t.map((x) => x.key)).size).toBe(t.length);
  });

  it('stripItem removes an item everywhere and drops the counts with it (optimistic done)', () => {
    const reply = h.sections.find((s) => s.id === 'reply')!;
    const row = reply.rows.find((r) => r.item)!;
    const next = stripItem(h, row.item!.id);
    const after = next.sections.find((s) => s.id === 'reply')!;
    expect(after.rows.some((r) => r.item?.id === row.item!.id)).toBe(false);
    expect(after.count).toBe(reply.count - 1);
    // The #1 card leaves Do now and the ranks close up.
    const first = h.doNow.cards[0]!;
    const noFirst = stripItem(h, first.id);
    expect(noFirst.doNow.cards.map((c) => c.rank)).toEqual(noFirst.doNow.cards.map((_, i) => i + 1));
    expect(noFirst.doNow.cards.some((c) => c.id === first.id)).toBe(false);
  });

  it('formats durations and pairs every state color with a glyph', () => {
    expect(fmtDur(92)).toBe('1h 32m');
    expect(fmtDur(45)).toBe('45m');
    expect(stateGlyph('overdue', 'Expired 10/26')).toBe('✕');
    expect(stateGlyph('blocked', 'Blocked')).toBe('⊘');
    expect(stateGlyph('risk', 'Not started')).toBe('○');
    expect(stateGlyph('risk', 'Start by 08:35')).toBe('◷');
    expect(stateGlyph('risk', '114 d')).toBe('◷');
    expect(stateGlyph('risk', 'At risk')).toBe('▲');
    expect(stateGlyph(null, null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Day ribbon lanes (ribbonLayout)
// ---------------------------------------------------------------------------

const day = (hhmm: string) => `2026-11-05T${hhmm}:00.000Z`;
const blk = (kind: HomeRibbonBlock['kind'], start: string, end: string) => ({ kind, start: day(start), end: day(end) });

describe('ribbonLayout: overlapping meetings share the track in lanes', () => {
  it('09:00–10:00 and 09:30–10:00 stack in two lanes, neither spills', () => {
    const [a, b] = ribbonLayout([blk('meeting', '09:00', '10:00'), blk('meeting', '09:30', '10:00')]);
    expect(a).toMatchObject({ lane: 0, lanes: 2, spill: false, band: false });
    expect(b).toMatchObject({ lane: 1, lanes: 2, spill: false, short: true, band: false });
  });

  it('a three-way overlap takes three lanes, and the track grows past two', () => {
    const places = ribbonLayout([blk('meeting', '09:00', '10:00'), blk('meeting', '09:15', '09:45'), blk('meeting', '09:30', '10:30')]);
    expect(places.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(ribbonMaxLanes(places)).toBe(3);
  });

  it('reuses a lane once its block has ended (09:00–09:30 and 09:30–10:00 both beside 09:00–10:00)', () => {
    const places = ribbonLayout([blk('meeting', '09:00', '10:00'), blk('meeting', '09:00', '09:30'), blk('meeting', '09:30', '10:00')]);
    expect(places.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [1, 2],
    ]);
  });

  it('back-to-back meetings do not overlap: each keeps the full height', () => {
    const places = ribbonLayout([blk('meeting', '09:00', '10:00'), blk('meeting', '10:00', '11:00')]);
    expect(places.map((p) => p.lanes)).toEqual([1, 1]);
    expect(ribbonMaxLanes(places)).toBe(1);
  });

  it('spill: a short meeting spills only with nothing overlapping it and an hour of free track after it', () => {
    // Free after it: spills to the next start.
    const [free] = ribbonLayout([blk('meeting', '09:00', '09:30'), blk('meeting', '11:00', '12:00')]);
    expect(free).toMatchObject({ spill: true, spillTo: Date.parse(day('11:00')) });
    // Something starts within the hour: no spill.
    expect(ribbonLayout([blk('meeting', '09:00', '09:30'), blk('meeting', '10:00', '11:00')])[0]!.spill).toBe(false);
    // Overlapped (even by a long block that started earlier and ends much later): never spills.
    const [, inner] = ribbonLayout([blk('meeting', '08:30', '12:00'), blk('meeting', '09:00', '09:30')]);
    expect(inner!.spill).toBe(false);
    // The last block of the day spills up to the window's end.
    expect(ribbonLayout([blk('meeting', '16:00', '16:30')], Date.parse(day('17:30')))[0]).toMatchObject({ spill: true, spillTo: Date.parse(day('17:30')) });
    // Only meetings of 30 minutes or less spill.
    expect(ribbonLayout([blk('meeting', '09:00', '10:00')])[0]!.spill).toBe(false);
  });

  it('a declined ghost beside a real meeting is a thin band under it, never a lane over it', () => {
    const [ghost, meeting] = ribbonLayout([blk('declined', '09:30', '10:30'), blk('meeting', '10:00', '11:00')]);
    expect(ghost).toMatchObject({ band: true, lanes: 1 });
    expect(meeting).toMatchObject({ band: false, lanes: 1, overBand: true });
    // Alone, a declined meeting keeps its full-height ghost.
    expect(ribbonLayout([blk('declined', '09:30', '10:30')])[0]).toMatchObject({ band: false, lanes: 1, overBand: false });
    // Two declined meetings that only overlap each other stack like meetings.
    expect(ribbonLayout([blk('declined', '09:00', '10:00'), blk('declined', '09:30', '10:30')]).map((p) => [p.band, p.lane, p.lanes])).toEqual([
      [false, 0, 2],
      [false, 1, 2],
    ]);
    // Bands never count as lanes.
    expect(ribbonMaxLanes(ribbonLayout([blk('declined', '09:00', '10:00'), blk('meeting', '09:00', '10:00')]))).toBe(1);
  });

  it('packColumns (shared with Today and DaySpine) packs calendar-style clusters', () => {
    const items = [
      { s: 0, e: 60, col: 0, cols: 1 },
      { s: 30, e: 60, col: 0, cols: 1 },
      { s: 60, e: 90, col: 0, cols: 1 },
    ];
    packColumns(items);
    expect(items.map((i) => [i.col, i.cols])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The Outbox card owns its whole draft queue (openKey)
// ---------------------------------------------------------------------------

describe('the Outbox card: every draft of its queue counts as the card being open', () => {
  it('openKeyFor resolves any id in draftIds to the card, the selection first', () => {
    const outbox = h.doNow.cards.find((c) => c.kind === 'outbox')!;
    const queued: HomeCard = { ...outbox, draftIds: [outbox.entity.id, 'dr_q2', 'dr_q3', 'dr_q4'] };
    const payload: HomePayload = { ...h, doNow: { ...h.doNow, cards: h.doNow.cards.map((c) => (c.id === outbox.id ? queued : c)) } };
    const targets = homeTargets(payload);
    const key = cardKey(queued);
    expect(openKeyFor(targets, outbox.entity.id, null)).toBe(key);
    expect(openKeyFor(targets, 'dr_q4', null)).toBe(key);
    expect(openKeyFor(targets, 'dr_q4', cardKey(h.doNow.cards[0]!))).toBe(key);
    expect(openKeyFor(targets, 'dr_elsewhere', null)).toBeNull();
    expect(openKeyFor(targets, null, key)).toBeNull();
    // An item card open in Details still resolves to itself.
    const item = h.doNow.cards.find((c) => c.kind === 'item')!;
    expect(openKeyFor(targets, item.entity.id, null)).toBe(cardKey(item));
  });

  it('holdsOpen: on a later draft of its queue the card stays put (j/k, Enter and a click do not snap back to #1)', () => {
    const outbox = h.doNow.cards.find((c) => c.kind === 'outbox')!;
    const t = homeTargets({ ...h, doNow: { ...h.doNow, cards: [{ ...outbox, draftIds: [outbox.entity.id, 'dr_q2', 'dr_q3'] }] } })[0]!;
    expect(holdsOpen(t, 'dr_q3')).toBe(true);
    expect(holdsOpen(t, outbox.entity.id)).toBe(false); // its own entity: open it as before
    expect(holdsOpen(t, 'w_other')).toBe(false);
    expect(holdsOpen(t, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A Do now card's "Not now" reason is the action (no second pick in Details)
// ---------------------------------------------------------------------------

describe('Do now card: Not now keeps its reason', () => {
  it('only Wrong account keeps the item on Home; the other reasons (and done / snooze / not-done) strip it', () => {
    expect(leavesHome('not-now', 'wrong_account')).toBe(false);
    for (const r of ['done_elsewhere', 'not_mine', 'later', 'other'] as const) expect(leavesHome('not-now', r)).toBe(true);
    for (const v of ['done', 'snooze', 'not-done', 'confirm-done']) expect(leavesHome(v)).toBe(true);
  });

  it('the toast says what the reason did', () => {
    expect(notNowToast('done_elsewhere', 'Send the deck')).toBe('Done elsewhere: Send the deck');
    expect(notNowToast('not_mine', 'Send the deck')).toBe('Not mine, dismissed: Send the deck');
    expect(notNowToast('later', 'Send the deck', 'Fri')).toBe('Moved to Fri: Send the deck');
    expect(notNowToast('later', 'Send the deck')).toBe('Snoozed until tomorrow: Send the deck');
    expect(notNowToast('wrong_account', 'Send the deck')).toBe('Account unlinked: Send the deck');
  });

  it('each reason, run as the card runs it, lands the item where the reason says (mock)', async () => {
    const m = createMockDataSource({ seedPath: 'src/mock/seed.example.json', autoplay: false, clockMode: 'seed' });
    try {
      const home = await m.getHome({ query: { wide: true } });
      const ids = home.doNow.cards.filter((c) => c.kind === 'item').map((c) => c.id);
      const extra = home.sections.flatMap((s) => s.rows).filter((r) => r.entity.kind === 'work_item' && !ids.includes(r.entity.id)).map((r) => r.entity.id);
      const pool = [...new Set([...ids, ...extra])];
      expect(pool.length).toBeGreaterThanOrEqual(4);
      const run = async (id: string, reason: 'done_elsewhere' | 'not_mine' | 'later' | 'wrong_account', until?: string) => {
        const cur = (await m.getItem({ params: { id } })).item;
        return (await m.itemAction({ params: { id, verb: 'not-now' }, body: { ifVersion: cur.version, reason, ...(until ? { until } : {}) } } as never)).entity;
      };
      const until = home.moveTo?.startsAt ?? new Date(Date.parse(home.now) + 86_400_000).toISOString();
      expect((await run(pool[0]!, 'done_elsewhere')).state).toBe('done');
      expect((await run(pool[1]!, 'not_mine')).state).toBe('dismissed');
      const later = await run(pool[2]!, 'later', until);
      expect(later.state).toBe('snoozed');
      expect(later.snoozedUntil).toBe(until);
      const kept = await run(pool[3]!, 'wrong_account');
      expect(kept.state).not.toMatch(/done|dismissed|snoozed/);
      expect(kept.refs.account ?? null).toBeNull();
    } finally {
      m.dispose();
    }
  });
});
