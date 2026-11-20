/**
 * TIMEGRID: Today's day timeline on a dense day: 10-minute meetings and work back to back, overlapping
 * meetings, a declined meeting and an agent run in the side lane, an early call before working hours and a
 * late one after. Placeholder names only (ACME, Globex, Initech).
 *
 * Checks the pure layout: nothing stacks, no label overlaps another (B-083), every label has room for its
 * text at every zoom, and the zoom math keeps now on screen.
 */
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/contract';
import {
  clampZoom,
  dayBounds,
  FULL_PX,
  GAP_LABEL_PX,
  gridHeightAt,
  layoutDay,
  LINE_PX,
  pixelLayout,
  stepZoom,
  wheelZoom,
  ZOOM_LEVELS,
  ZOOM_MAX,
  zoomLabel,
  zoomScroll,
  type DayLayout,
  type LayoutInput,
  type PixelLayout,
} from './timeline';

const TZ = 'America/Denver';
// Thu 5 Nov 2026 13:55 MT = 20:55Z
const NOW = '2026-11-05T20:55:00.000Z';
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 10, 5, h + 7, m)).toISOString();
};

function ev(id: string, title: string, start: string, end: string, attendance: CalendarEvent['attendance'] = 'upcoming'): CalendarEvent {
  return {
    id,
    title,
    start: at(start),
    end: at(end),
    attendance,
    isCustomerFacing: false,
    accountId: null,
    oppId: null,
    attendees: [],
    location: null,
    meetingUrl: null,
    agenda: null,
    organizer: null,
    attachments: [],
    prep: null,
    takeaways: null,
    source: { kind: 'calendar', label: 'Calendar' },
  } as CalendarEvent;
}

const work = (id: string, start: string, end: string, label: string) => ({ id, itemId: `i_${id}`, start: at(start), end: at(end), label });

/** The dense day. */
const DENSE: LayoutInput = {
  nowIso: NOW,
  tz: TZ,
  workStart: 7 * 60 + 30,
  workEnd: 17 * 60 + 30,
  events: [
    ev('early', 'Initech early sync', '06:30', '07:00', 'attended'),
    ev('standup', 'SE stand-up', '08:00', '08:30', 'attended'),
    ev('ov1', 'Initech discovery', '10:30', '11:30', 'attended'),
    ev('ov2', 'Globex architecture huddle', '11:00', '11:45', 'attended'),
    ev('t1', 'ACME quick check', '14:00', '14:10'),
    ev('t2', 'Globex check-in', '14:22', '14:32'),
    ev('t3', 'Initech pricing ping', '14:44', '14:54'),
    ev('t4', 'ACME follow-up', '15:06', '15:16'),
    ev('t5', 'Globex legal ping', '15:28', '15:38'),
    ev('t6', 'Initech handoff', '15:50', '16:00'),
    ev('t7', 'ACME sync', '16:12', '16:22'),
    ev('declined', 'Globex retro', '15:00', '16:00', 'declined'),
    ev('late', 'ACME APAC call', '18:30', '19:00'),
  ],
  work: [
    work('w1', '14:10', '14:20', '14:10 ▶ Reply to ACME'),
    work('w2', '14:32', '14:42', '14:32 ▶ Approve Globex draft'),
    work('w3', '14:54', '15:04', '14:54 ▶ Initech notes'),
    work('w4', '16:30', '16:40', '16:30 ▶ Send ACME recap'),
  ],
  agent: [{ id: 'agent:a1', itemId: 'i_a1', start: at('14:00'), minutes: 20, label: 'Agent run' }],
  hints: [
    { key: 'fit:a', title: 'Approve 3 drafts', minutes: 10 },
    { key: 'fit:b', title: 'Re-auth VDP', minutes: 2 },
  ],
  suggestion: { key: 'pull:x', itemId: 'x', title: 'Globex SOW', minutes: 30 },
};

const sharesX = (a: { left: number; right: number }, b: { left: number; right: number }) => a.left < b.right - 0.01 && b.left < a.right - 0.01;
const overlapsY = (a: { top: number; height: number }, b: { top: number; height: number }) => a.top < b.top + b.height - 0.01 && b.top < a.top + a.height - 0.01;

/** Every way two labels (or a label and a block) could collide. Returns the collisions it found. */
function collisions(pix: PixelLayout): string[] {
  const out: string[] = [];
  const boxes = [...pix.boxes.entries()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [ia, a] = boxes[i]!;
      const [ib, b] = boxes[j]!;
      if (sharesX(a, b) && overlapsY(a, b)) out.push(`block ${ia} × block ${ib}`);
    }
  const labels = [...pix.gaps.entries()].filter(([, g]) => g.label);
  for (let i = 0; i < labels.length; i++) {
    const [ia, a] = labels[i]!;
    for (let j = i + 1; j < labels.length; j++) {
      const [ib, b] = labels[j]!;
      if (overlapsY(a, b)) out.push(`gap label ${ia} × gap label ${ib}`);
    }
    for (const [ib, b] of boxes) if (sharesX(a, b) && overlapsY(a, b)) out.push(`gap label ${ia} × block ${ib}`);
  }
  return out;
}

describe('dense day: window', () => {
  it('pulls the start back for an early call and runs to the late one', () => {
    const b = dayBounds(DENSE);
    expect(b.start).toBe(6 * 60); // 06:30 call → from 06:00, before 07:30 working hours
    expect(b.end).toBe(19 * 60); // 18:30–19:00 call
    const l = layoutDay(DENSE);
    expect(l.workStart).toBe(450);
    expect(l.workEnd).toBe(1050);
    expect(l.blocks.find((x) => x.id === 'early')?.s).toBe(6 * 60 + 30);
  });

  it('keeps the old start when nothing is early (from the first hour, never before working hours)', () => {
    const b = dayBounds({ ...DENSE, events: DENSE.events.filter((e) => e.id !== 'early') });
    expect(b.start).toBe(8 * 60);
  });
});

describe('dense day: labels never collide (B-083)', () => {
  const l = layoutDay(DENSE);
  const span = l.end - l.start;

  for (const paneH of [420, 640, 900, 1200]) {
    for (const zoom of ZOOM_LEVELS) {
      it(`pane ${paneH} px at ${zoomLabel(zoom)}`, () => {
        const px = (paneH * zoom) / span;
        const pix = pixelLayout(l, px);
        expect(collisions(pix)).toEqual([]);
        for (const [id, b] of pix.boxes) {
          if (b.tier === 'full') expect(b.height, id).toBeGreaterThanOrEqual(FULL_PX);
          if (b.tier === 'line') expect(b.height, id).toBeGreaterThanOrEqual(LINE_PX);
          if (b.tier === 'none') expect(b.height, id).toBeLessThan(LINE_PX);
          // true to time: a block starts where it starts and is never shorter than it lasts
          const blk = l.blocks.find((x) => x.id === id)!;
          expect(b.top).toBeCloseTo((blk.s - l.start) * px, 5);
          expect(b.height + 1e-6).toBeGreaterThanOrEqual((blk.e - blk.s) * px);
        }
        for (const [id, g] of pix.gaps) if (g.label) expect(g.height, id).toBeGreaterThanOrEqual(GAP_LABEL_PX);
        // grid labels never crowd each other or the now badge
        const labelled = pix.marks.filter((m) => m.label);
        for (let i = 1; i < labelled.length; i++) expect((labelled[i]!.min - labelled[i - 1]!.min) * px).toBeGreaterThanOrEqual(LINE_PX);
        for (const m of labelled) expect(Math.abs(m.min - l.now) * px).toBeGreaterThanOrEqual(LINE_PX);
      });
    }
  }

  it('at fit, the run of short gaps collapses to tooltips instead of overlapping', () => {
    const px = 640 / span; // ~0.5 px/min: a 12-minute gap is ~6 px
    const pix = pixelLayout(l, px);
    const short = l.blocks.filter((b) => b.type === 'gap' && b.e - b.s <= 15);
    expect(short.length).toBeGreaterThanOrEqual(3);
    for (const g of short) expect(pix.gaps.get(g.id)?.label).toBe(false);
    // the long open stretch of the late afternoon still says what's open
    const long = l.blocks.filter((b) => b.type === 'gap' && b.e - b.s >= 60);
    expect(long.length).toBeGreaterThan(0);
    for (const g of long) expect(pix.gaps.get(g.id)?.label).toBe(true);
  });

  it('zooming in spreads the 10-minute blocks out until each has its full two-line label', () => {
    const tens = l.blocks.filter((b) => b.type !== 'gap' && b.e - b.s === 10).map((b) => b.id);
    expect(tens.length).toBeGreaterThanOrEqual(10);
    const tierAt = (zoom: number) => {
      const pix = pixelLayout(l, (640 * zoom) / span);
      return tens.map((id) => pix.boxes.get(id)!.tier);
    };
    expect(tierAt(1)).toContain('none');
    expect(tierAt(ZOOM_MAX).every((t) => t === 'full')).toBe(true);
    // more zoom never takes a label away
    const rank = { none: 0, line: 1, full: 2 } as const;
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      const a = tierAt(ZOOM_LEVELS[i - 1]!);
      const b = tierAt(ZOOM_LEVELS[i]!);
      a.forEach((t, k) => expect(rank[b[k]!]).toBeGreaterThanOrEqual(rank[t]));
    }
  });

  it('a lone short block grows into the free space under it, but never into the next block', () => {
    const pix = pixelLayout(l, 640 / span);
    const late = pix.boxes.get('late')!; // 30 minutes with nothing after it
    expect(late.height).toBeGreaterThanOrEqual(LINE_PX);
    const t1 = pix.boxes.get('t1')!;
    const w1 = pix.boxes.get('w1')!; // starts right where t1 ends
    expect(t1.top + t1.height).toBeLessThanOrEqual(w1.top + 1e-6);
  });

  it('quarter-hour lines and labels appear as the zoom grows', () => {
    const fit = pixelLayout(l, 640 / span).marks;
    const deep = pixelLayout(l, (640 * ZOOM_MAX) / span).marks;
    expect(fit.some((m) => m.kind === 'quarter')).toBe(false);
    expect(deep.some((m) => m.kind === 'quarter' && m.label)).toBe(true);
  });
});

describe('zoom math', () => {
  it('steps through the levels and clamps', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1.5, 1)).toBe(2);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(2.6, -1)).toBe(2); // from a pinch, to the level below
    expect(stepZoom(2.6, 1)).toBe(3);
    expect(clampZoom(40)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom('3')).toBe(1); // junk from storage
  });

  it('wheel / pinch: up zooms in, down zooms out, near fit snaps to fit', () => {
    expect(wheelZoom(2, -100)).toBeGreaterThan(2);
    expect(wheelZoom(2, 100)).toBeLessThan(2);
    expect(wheelZoom(1.02, 2)).toBe(1);
    expect(wheelZoom(1, 100)).toBe(1);
    expect(wheelZoom(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
    expect(wheelZoom(2, -3, 1)).toBeCloseTo(wheelZoom(2, -48, 0), 5); // line mode ≈ pixels
    // a pinch is many small events: they add up to a real zoom
    let z = 1;
    for (let i = 0; i < 30; i++) z = wheelZoom(z, -4);
    expect(z).toBeGreaterThan(2);
  });

  it('labels the level', () => {
    expect(zoomLabel(1)).toBe('Fit');
    expect(zoomLabel(1.5)).toBe('1.5×');
    expect(zoomLabel(3)).toBe('3×');
    expect(zoomLabel(2.04)).toBe('2×');
  });

  const view = { start: 6 * 60, end: 19 * 60, now: 13 * 60 + 55, viewportH: 700, padTop: 12, padBottom: 22, scrollTop: 0 };
  const yOf = (min: number, zoom: number, scrollTop: number) => view.padTop + ((min - view.start) * gridHeightAt(view, zoom)) / (view.end - view.start) - scrollTop;

  it('keeps now at the same height on screen when zooming in and out', () => {
    const before = yOf(view.now, 1, 0);
    const s3 = zoomScroll(view, 1, 3);
    expect(yOf(view.now, 3, s3)).toBeCloseTo(before, 0);
    const s8 = zoomScroll({ ...view, scrollTop: s3 }, 3, 8);
    expect(yOf(view.now, 8, s8)).toBeCloseTo(before, 0);
    const back = zoomScroll({ ...view, scrollTop: s8 }, 8, 1.5);
    expect(yOf(view.now, 1.5, back)).toBeCloseTo(before, 0);
    expect(zoomScroll({ ...view, scrollTop: back }, 1.5, 1)).toBe(0); // fit has nothing to scroll
  });

  it('brings now back into view if it had scrolled away, and stays inside the scroll range', () => {
    const s = zoomScroll({ ...view, scrollTop: 0 }, 6, 8); // at 6× from the top, now is far below the fold
    const y = yOf(view.now, 8, s);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(view.viewportH);
    const total = view.padTop + gridHeightAt(view, 8) + view.padBottom;
    const endAnchor = zoomScroll({ ...view, now: view.end }, 1, 8);
    expect(endAnchor).toBeLessThanOrEqual(total - view.viewportH);
    expect(zoomScroll({ ...view, now: view.start }, 1, 8)).toBeGreaterThanOrEqual(0);
  });

  it('without now on the grid it anchors on the pointer', () => {
    const v = { ...view, now: null, scrollTop: 400 };
    const pointer = 300;
    const minAtPointer = view.start + ((v.scrollTop + pointer - view.padTop) * (view.end - view.start)) / gridHeightAt(view, 2);
    const s = zoomScroll(v, 2, 4, pointer);
    expect(yOf(minAtPointer, 4, s)).toBeCloseTo(pointer, 0);
  });

  it('the day still lays out with a zero-length window (no NaN)', () => {
    const l: DayLayout = layoutDay({ ...DENSE, events: [], work: [], agent: [], hints: [], suggestion: null });
    const pix = pixelLayout(l, 0);
    expect(Number.isFinite(pix.height)).toBe(true);
  });
});
