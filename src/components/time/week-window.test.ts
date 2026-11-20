/**
 * TIMEGRID: the Time page's week grid shows the whole day. Every block of the week fits its window (after-hours
 * work, agent runs, a block past midnight, weekend work), the window is never narrower than working hours, and
 * the time outside working hours is what gets shaded. Placeholder names only.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineLane } from '@/contract';
import { axisLabels, dayWindow, hhmmToMin, hourTicks, offHours, placeBlocks, visibleDays, weekDays, windowClock } from './derive';

const TZ = 'America/Denver';
// Week of Mon 2 Nov 2026 (MST, UTC-7).
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 10, day, h + 7, m)).toISOString();
};
const blk = (id: string, day: number, s: string, e: string, endDay = day, hatched = false) => ({ id, start: at(day, s), end: at(endDay, e), label: id, activityId: null, hatched });

const WORK = { start: hhmmToMin('07:30', 0), end: hhmmToMin('17:30', 0) };

const LANES: TimelineLane[] = [
  { id: 'meetings', label: 'Meetings', blocks: [blk('ACME demo', 3, '10:00', '11:00'), blk('Globex APAC call', 4, '19:30', '20:30'), blk('Initech early', 5, '06:10', '06:40')] },
  { id: 'focus', label: 'Focus', blocks: [blk('Globex RFP', 2, '20:00', '22:15')] },
  // agent time counts for the window too (it's hatched and never totalled, but it isn't hidden)
  { id: 'claude', label: 'Claude', blocks: [blk('Claude · Initech research', 5, '22:40', '23:20', 5, true)] },
  // past midnight: Thu 23:30 → Fri 01:00 (a late night, kept on Thursday)
  { id: 'drive', label: 'Drive', blocks: [blk('Initech SOW', 5, '23:30', '01:00', 6), blk('Globex all-nighter', 3, '22:00', '09:00', 4)] },
  // weekend work (Sat 7 Nov)
  { id: 'slack', label: 'Slack', blocks: [blk('#acme-ext', 7, '09:00', '09:20')] },
];

describe('week grid window', () => {
  const days7 = weekDays('2026-11-02', 7);
  const placed = placeBlocks(LANES, days7, TZ);

  it('keeps a late night that ends by 06:00 on the day it started, and splits anything longer at midnight', () => {
    const sow = placed.filter((b) => b.id.startsWith('Initech SOW'));
    expect(sow.map((b) => [b.day, b.startMin, b.endMin])).toEqual([['2026-11-05', 23 * 60 + 30, 25 * 60]]);
    const night = placed.filter((b) => b.id.startsWith('Globex all-nighter'));
    expect(night.map((b) => [b.day, b.startMin, b.endMin])).toEqual([
      ['2026-11-03', 22 * 60, 24 * 60],
      ['2026-11-04', 0, 9 * 60],
    ]);
    expect(new Set(night.map((b) => b.id)).size).toBe(2);
  });

  it('fits every block of the week, agent time included, rounded out to the hour', () => {
    const [lo, hi] = dayWindow(placed, WORK);
    expect(lo).toBe(0); // the Wed 00:00–09:00 part of the all-nighter
    expect(hi).toBe(25); // the SOW edit ran to 01:00 the next morning
    for (const b of placed) {
      expect(b.startMin).toBeGreaterThanOrEqual(lo * 60);
      expect(b.endMin).toBeLessThanOrEqual(hi * 60);
    }
  });

  it('widens only as far as the work goes, and never below working hours', () => {
    const week = placeBlocks(LANES.slice(0, 1), days7, TZ); // meetings only: 06:10 and a 20:30 end
    expect(dayWindow(week, WORK)).toEqual([6, 21]);
    const lateOnly = placeBlocks([LANES[3]!].map((l) => ({ ...l, blocks: l.blocks.slice(0, 1) })), days7, TZ);
    expect(dayWindow(lateOnly, WORK)).toEqual([7, 25]); // working hours, then on to 01:00
    expect(windowClock(25 * 60)).toBe('01:00 next day');
    expect(windowClock(24 * 60)).toBe('24:00');
    expect(windowClock(7 * 60)).toBe('07:00');
    expect(dayWindow([], WORK)).toEqual([7, 18]); // 07:30–17:30 rounded out to the hour
    expect(dayWindow([], WORK, [21 * 60 + 5])).toEqual([7, 22]); // the now-line at 21:05 is on the grid
  });

  it('shades the time outside working hours', () => {
    expect(offHours([6, 21], WORK)).toEqual([
      [6 * 60, 7 * 60 + 30],
      [17 * 60 + 30, 21 * 60],
    ]);
    expect(offHours([7, 18], { start: 7 * 60, end: 18 * 60 })).toEqual([]);
  });

  it('shows a weekend day only when it has work', () => {
    expect(visibleDays('2026-11-02', placed)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']); // Sat has work, Sun doesn't
    expect(visibleDays('2026-11-02', [])).toEqual(weekDays('2026-11-02'));
  });

  it('puts hour ticks on multiples of 3 inside the window', () => {
    expect(hourTicks([6, 21])).toEqual([9, 12, 15, 18]);
    expect(hourTicks([0, 24])).toEqual([3, 6, 9, 12, 15, 18, 21]);
    // labels thin out on a long window and keep clear of the column edges (the next day's first label)
    expect(axisLabels([7, 18])).toEqual([9, 12, 15]);
    expect(axisLabels([5, 25])).toEqual([12, 18]);
    expect(axisLabels([6, 21])).toEqual([9, 12, 15, 18]); // 15 h still fits every 3 h
  });

  it('reads working hours from settings, with a fallback', () => {
    expect(hhmmToMin('07:30', 0)).toBe(450);
    expect(hhmmToMin('bad', 480)).toBe(480);
    expect(hhmmToMin(undefined, 1080)).toBe(1080);
  });
});
