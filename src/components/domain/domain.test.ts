import { describe, expect, it } from 'vitest';
import seed from '@/mock/seed.example.json';
import { Draft, WorkItemRecord } from '@/contract';
import { sanitize } from './lib/SafeHtml';
import { clock, dur, dueLabel, shortDue, stripClock, zonedIso } from './lib/time';
import { hm, itemIndicator, sentence } from './lib/v2';
import { agePhrase, barTone, destinationLabel, draftPreviewHtml, leadTiming } from './derive';
import { resolutionLabel, statePill } from './vocab';
import { buildAheadDays } from './AheadStrip';
import { approxMin } from './CapacityMeter';

const drafts = (seed as { drafts: unknown[] }).drafts.map((d) => Draft.parse(d));
const items = (seed as { workItems: unknown[] }).workItems.map((w) => WorkItemRecord.parse(w));
const TZ = 'America/Denver';

describe('SafeHtml.sanitize (DOMPurify)', () => {
  it('strips scripts, handlers, inline styles and unsafe URLs', () => {
    const out = sanitize('<p style="position:fixed" onclick="x()">Hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">a</a><a href="https://ok.example">b</a></p>');
    expect(out).not.toMatch(/script|onerror|onclick|style=|javascript:|<img/i);
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain('rel="noreferrer noopener"');
  });
});

describe('draftPreviewHtml (payload-derived)', () => {
  it('renders every seed draft in its channel format', () => {
    for (const d of drafts) {
      const html = sanitize(draftPreviewHtml(d));
      expect(html).toContain(d.destination.kind === 'slack' ? 'cc-preview-slack' : 'cc-preview-email');
      const firstWords = d.plainText.split(/\s+/).slice(0, 2).join(' ').replace(/[’']/g, '');
      expect(html.replace(/<[^>]+>/g, ' ').replace(/[’']/g, '')).toContain(firstWords.split(' ')[0]);
    }
  });
  it('labels destinations like the composer chip', () => {
    const slack = drafts.find((d) => d.destination.kind === 'slack' && d.destination.target === 'thread')!;
    expect(destinationLabel(slack.destination)).toMatchObject({ channel: 'Slack', detail: expect.stringContaining('thread') });
    const email = drafts.find((d) => d.destination.kind === 'email')!;
    expect(destinationLabel(email.destination).channel).toBe('Gmail');
  });
});

describe('derive + vocab', () => {
  const now = '2026-11-05T16:02:00.000Z';
  it('bar tone: late → risk, within an hour → warn, high → brand', () => {
    const base = { priority: 'medium' as const, state: 'open' as const, isBackground: false, due: null };
    expect(barTone({ ...base, startBy: '2026-11-05T15:50:00.000Z' }, now)).toBe('risk');
    expect(barTone({ ...base, startBy: '2026-11-05T16:30:00.000Z' }, now)).toBe('warn');
    expect(barTone({ ...base, startBy: null, priority: 'high' }, now)).toBe('brand');
    expect(barTone({ ...base, startBy: null, isBackground: true, priority: 'high' }, now)).toBe('neutral');
  });
  it('lead timing prefers start-by over due', () => {
    expect(leadTiming({ startBy: 'a', due: 'b' })).toEqual({ at: 'a', kind: 'start' });
    expect(leadTiming({ startBy: null, due: 'b' })).toEqual({ at: 'b', kind: 'due' });
  });
  it('age phrases follow the item kind', () => {
    const ask = items.find((i) => i.kind === 'ask')!;
    expect(agePhrase({ ...ask, createdAt: '2026-11-05T14:02:00.000Z' }, now)).toBe('asked 2h ago');
  });
  it('state pills match UI-SPEC §11 (open has none; suggested is dashed)', () => {
    expect(statePill({ state: 'open', waiting: null, resolution: null, resolutionDetail: null, snoozedUntil: null, loopedBackIn: null })).toBeNull();
    expect(statePill({ state: 'suggested', waiting: null, resolution: null, resolutionDetail: null, snoozedUntil: null, loopedBackIn: null })).toMatchObject({ tone: 'ai', dashed: true });
    expect(resolutionLabel('handed_off', 'Dana Reyes')).toBe('Handed off → Dana');
  });
});

describe('time helpers', () => {
  it('formats in the profile timezone, 24 h', () => {
    expect(clock('2026-11-05T16:02:00.000Z', TZ)).toBe('09:02');
    expect(dueLabel('2026-11-05T18:00:00.000Z', '2026-11-05T16:02:00.000Z', TZ)).toBe('11:00');
    expect(dur(100)).toBe('1h40m');
    expect(dur(5)).toBe('5m');
    expect(stripClock('10:05 ▶ Kick off build')).toBe('▶ Kick off build');
  });
  it('round-trips wall-clock edits through zonedIso', () => {
    const iso = zonedIso('2026-11-05', '09:30', TZ);
    expect(iso).toBe('2026-11-05T16:30:00.000Z');
    expect(clock(iso, TZ)).toBe('09:30');
  });
});

describe('design v2 helpers', () => {
  const now = '2026-11-05T15:20:00.000Z'; // 08:20 MT
  const base = { state: 'open' as const, isBackground: false, reopened: null, loopedBackIn: null, training: null, due: null, startBy: null };
  it('hm() writes v2 durations with a space', () => {
    expect(hm(20)).toBe('20m');
    expect(hm(90)).toBe('1h 30m');
    expect(hm(120)).toBe('2h');
  });
  it('sentence() turns contract caps into sentence case only when all caps', () => {
    expect(sentence('WAITING ON YOU')).toBe('Waiting on you');
    expect(sentence('Do now')).toBe('Do now');
  });
  it('itemIndicator: one state color; danger beats selection, selection beats the rest', () => {
    expect(itemIndicator(base, now)).toBe('none');
    expect(itemIndicator({ ...base, startBy: '2026-11-05T15:00:00.000Z' }, now)).toBe('danger');
    expect(itemIndicator({ ...base, startBy: '2026-11-05T15:00:00.000Z' }, now, { selected: true })).toBe('danger');
    expect(itemIndicator({ ...base, startBy: '2026-11-05T15:50:00.000Z' }, now)).toBe('warning');
    expect(itemIndicator({ ...base, startBy: '2026-11-05T15:50:00.000Z' }, now, { selected: true })).toBe('now');
    expect(itemIndicator({ ...base, state: 'suggested' }, now)).toBe('ai');
    expect(itemIndicator(base, now, { drafted: true })).toBe('ai');
    expect(itemIndicator({ ...base, state: 'likely_done' }, now)).toBe('success');
    expect(itemIndicator(base, now, { blocked: true })).toBe('danger');
  });
  it('approxMin rounds estimates: 5-minute steps under an hour, 15 above', () => {
    expect(approxMin(23)).toBe(25);
    expect(approxMin(83)).toBe(90);
    expect(approxMin(-5)).toBe(0);
  });
  it('buildAheadDays buckets the next 14 local days from tomorrow, counting at-risk items', () => {
    const days = buildAheadDays(
      [
        { at: '2026-11-06T19:00:00.000Z', atRisk: true, label: 'Q4 log' },
        { at: '2026-11-06T20:30:00.000Z', label: 'Team meeting' },
        { at: '2026-11-12T17:00:00.000Z', big: true },
        { at: '2026-11-05T20:00:00.000Z' }, // today: outside the window
        { at: '2026-12-01T20:00:00.000Z' }, // beyond 14 days
      ],
      { now, tz: TZ },
    );
    expect(days).toHaveLength(14);
    expect(days[0]).toMatchObject({ date: '2026-11-06', count: 2, atRisk: 1, summary: 'Q4 log (at risk) · Team meeting' });
    expect(days.find((d) => d.date === '2026-11-12')).toMatchObject({ count: 1, big: true });
    expect(days.reduce((a, d) => a + d.count, 0)).toBe(3);
  });
  it('shortDue fits narrow columns', () => {
    expect(shortDue('2026-11-05T18:00:00.000Z', now, TZ)).toBe('11:00');
    expect(shortDue('2026-11-06T18:00:00.000Z', now, TZ)).toBe('Fri');
    expect(shortDue('2026-12-04T18:00:00.000Z', now, TZ)).toBe('4 Dec');
  });
});
