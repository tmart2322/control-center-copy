/**
 * B-081 History: the pure composer (src/server/history/compose.ts) on hand-made records, placeholder data only.
 * Day boundaries in the profile zone (DST), closes from the record vs the log (undone closes never reach the
 * composer; reopened ones are marked), human hours vs the agent lane, runs across midnight, dry runs.
 */
import { describe, expect, it } from 'vitest';
import { ActivityEntry, AgentRun, Draft, HistoryDay, HistoryMonth, WorkItemRecord } from '@/contract';
import { composeHistoryDay, composeHistoryMonth, dayWindow, monthGrid, type HistorySources } from '@/server/history/compose';
import { dayRows, daySentence, mondayOf, shiftDay } from '@/components/history/derive';

const TZ = 'America/Denver';
const NOW = new Date('2026-11-12T18:00:00Z'); // Thu 12 Nov, 11:00 in Denver

const item = (over: Partial<WorkItemRecord> & { id: string }): WorkItemRecord =>
  WorkItemRecord.parse({
    version: 1,
    kind: 'task',
    state: 'open',
    title: `Item ${over.id}`,
    purpose: null,
    initiativeId: null,
    accountId: null,
    oppId: null,
    confidence: 'sure',
    why: 'placeholder',
    sources: [{ kind: 'slack', label: '#acme-ext' }],
    effort: { youMin: 10, agentMin: 0 },
    startBy: null,
    due: null,
    createdAt: '2026-11-01T16:00:00Z',
    updatedAt: '2026-11-01T16:00:00Z',
    ageDays: 0,
    rank: null,
    rankReasons: [],
    ...over,
  });

const activity = (over: Partial<ActivityEntry> & { id: string; date: string; start: string; end: string; durationH: number }): ActivityEntry =>
  ActivityEntry.parse({ version: 1, taskType: 'Demo', oppId: null, oppName: null, accountName: 'ACME Corp', meetingType: 'CF', description: `Row ${over.id}`, status: 'approved', updatedAt: over.end, ...over });

const run = (over: Partial<AgentRun> & { id: string; startedAt: string }): AgentRun =>
  AgentRun.parse({ kind: 'claude_session', title: `Run ${over.id}`, workItemId: null, state: 'done', updatedAt: over.finishedAt ?? over.startedAt, lastEvent: 'done', ...over });

function draft(id: string, attempts: Draft['attempts'], verification: Draft['verification'] = null): Draft {
  return Draft.parse({
    id,
    version: 1,
    workItemId: null,
    nbaId: null,
    destination: { kind: 'slack', target: 'channel', channelId: 'C0ACME', channelName: '#acme-ext' },
    mode: 'send',
    doc: { type: 'doc', content: [] },
    plainText: 'hello',
    rendered: {},
    userTouched: false,
    status: 'sent',
    createdAt: '2026-11-10T15:00:00Z',
    updatedAt: '2026-11-10T15:00:00Z',
    attempts,
    verification,
  });
}

function sources(over: Partial<HistorySources> = {}): HistorySources {
  return { timezone: TZ, now: NOW, workItems: [], accounts: [{ id: 'acc_acme', name: 'ACME Corp' }], activity: [], timeBlocks: [], events: [], drafts: [], agentRuns: [], pastClosures: [], ...over };
}

describe('days in the profile zone', () => {
  it('a DST change day is 25 h (fall back) or 23 h (spring forward), starting at local midnight', () => {
    const fall = dayWindow('2026-11-01', TZ);
    expect((fall.to - fall.from) / 3_600_000).toBe(25);
    expect(new Date(fall.from).toISOString()).toBe('2026-11-01T06:00:00.000Z'); // MDT midnight
    const spring = dayWindow('2026-03-08', TZ);
    expect((spring.to - spring.from) / 3_600_000).toBe(23);
    expect(dayWindow('2026-11-12', TZ).from).toBe(Date.parse('2026-11-12T07:00:00Z')); // MST midnight
  });

  it('the month grid runs Monday to Sunday around the month', () => {
    expect(monthGrid('2026-11')).toEqual({ first: '2026-11-01', last: '2026-11-30', gridStart: '2026-10-26', gridEnd: '2026-12-06' });
    expect(monthGrid('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28', gridStart: '2026-01-26', gridEnd: '2026-03-01' });
    expect(mondayOf('2026-11-12')).toBe('2026-11-09');
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('an evening item in Denver belongs to that local day, not the next UTC day', () => {
    const w = item({ id: 'w_late', state: 'done', doneAt: '2026-11-11T05:30:00Z', doneBy: 'user', resolution: 'done_by_me' }); // 22:30 on the 10th
    const d10 = composeHistoryDay(sources({ workItems: [w] }), '2026-11-10');
    const d11 = composeHistoryDay(sources({ workItems: [w] }), '2026-11-11');
    expect(d10.finished.map((f) => f.itemId)).toEqual(['w_late']);
    expect(d11.finished).toEqual([]);
  });
});

describe('finished', () => {
  it('lists the record close with who closed it; generated reasons are not repeated as the why line', () => {
    const items = [
      item({ id: 'w_you', state: 'done', doneAt: '2026-11-10T17:00:00Z', doneBy: 'user', resolution: 'done_by_me', closedReason: 'Marked done by you', accountId: 'acc_acme' }),
      item({ id: 'w_eng', state: 'done', doneAt: '2026-11-10T18:00:00Z', doneBy: 'engine', resolution: 'done_by_other', resolutionDetail: { inferred: true, personName: 'Dana Reyes' }, closedReason: 'Dana posted the doc in #acme-ext' }),
      item({ id: 'w_hand', state: 'done', doneAt: '2026-11-10T19:00:00Z', doneBy: 'user', resolution: 'handed_off', resolutionDetail: { inferred: false, personName: 'Kim Tran' }, closedReason: 'Handed off → Kim Tran' }),
    ];
    const d = HistoryDay.parse(composeHistoryDay(sources({ workItems: items }), '2026-11-10'));
    expect(d.finished.map((f) => [f.itemId, f.by, f.label, f.why, f.accountName])).toEqual([
      ['w_you', 'you', 'Done by you', null, 'ACME Corp'],
      ['w_eng', 'engine', 'Closed for you · Done by Dana Reyes', 'Dana posted the doc in #acme-ext', null],
      ['w_hand', 'you', 'Handed off → Kim Tran', null, null],
    ]);
    expect(d.summary.finished).toBe(3);
  });

  it('a log close the item was reopened from shows as reopened since; a same-day repeat collapses to one row', () => {
    const reopened = item({ id: 'w_re', state: 'reopened' });
    const doneAgain = item({ id: 'w_again', state: 'done', doneAt: '2026-11-10T20:00:00Z', doneBy: 'user', resolution: 'done_by_me' });
    const src = sources({
      workItems: [reopened, doneAgain],
      pastClosures: [
        { itemId: 'w_re', at: '2026-11-09T16:00:00Z', by: 'engine' },
        { itemId: 'w_again', at: '2026-11-10T16:00:00Z', by: 'you' }, // closed, reopened and closed again the same day
        { itemId: 'w_again', at: '2026-11-09T16:00:00Z', by: 'you' }, // an earlier day's close
        { itemId: 'w_gone', at: '2026-11-09T16:00:00Z', by: 'you' }, // no such item any more
      ],
    });
    const d9 = composeHistoryDay(src, '2026-11-09');
    // same instant: ordered by title ("Item w_again" < "Item w_re")
    expect(d9.finished.map((f) => [f.itemId, f.label, f.reopenedSince])).toEqual([
      ['w_again', 'Done by you', true],
      ['w_re', 'Closed for you', true],
    ]);
    const d10 = composeHistoryDay(src, '2026-11-10');
    expect(d10.finished.map((f) => [f.itemId, f.at, f.reopenedSince])).toEqual([['w_again', '2026-11-10T20:00:00Z', false]]);
  });

  it('an item closed and undone (no record close, no log close) never shows', () => {
    const undone = item({ id: 'w_undone', state: 'open', doneAt: null });
    expect(composeHistoryDay(sources({ workItems: [undone] }), '2026-11-10').finished).toEqual([]);
  });
});

describe('time', () => {
  it('counts human hours only: dismissed and upcoming rows are listed but not counted, agent time is apart', () => {
    const rows = [
      activity({ id: 'a1', date: '2026-11-10', start: '2026-11-10T16:00:00Z', end: '2026-11-10T18:00:00Z', durationH: 2, meetingType: 'CF', status: 'logged' }),
      activity({ id: 'a2', date: '2026-11-10', start: '2026-11-10T19:00:00Z', end: '2026-11-10T20:00:00Z', durationH: 1, meetingType: 'CR', accountName: 'Globex', status: 'proposed' }),
      activity({ id: 'a3', date: '2026-11-10', start: '2026-11-10T21:00:00Z', end: '2026-11-10T21:30:00Z', durationH: 0.5, meetingType: null, accountName: null, status: 'dismissed' }),
      activity({ id: 'a4', date: '2026-11-10', start: '2026-11-10T22:00:00Z', end: '2026-11-10T22:30:00Z', durationH: 0.5, meetingType: null, accountName: null, status: 'approved' }),
    ];
    const runs = [run({ id: 'r1', startedAt: '2026-11-10T16:00:00Z', finishedAt: '2026-11-10T19:00:00Z' })];
    const blocks = [
      { id: 'tb1', lane: 'focus' as const, start: '2026-11-10T15:00:00Z', end: '2026-11-10T16:00:00Z', label: 'Focus', activityId: null, hatched: false },
      { id: 'tb2', lane: 'focus' as const, start: '2026-11-10T16:00:00Z', end: '2026-11-10T18:00:00Z', label: 'Focus', activityId: 'a1', hatched: false },
      { id: 'tb3', lane: 'claude' as const, start: '2026-11-10T16:00:00Z', end: '2026-11-10T19:00:00Z', label: 'Claude', activityId: null, hatched: true },
    ];
    const d = composeHistoryDay(sources({ activity: rows, agentRuns: runs, timeBlocks: blocks }), '2026-11-10');
    expect(d.time).toMatchObject({ yourH: 3.5, cfH: 2, crH: 1, unmarkedH: 0.5, loggedH: 2, approvedH: 0.5, toReviewH: 1, agentMin: 180 });
    expect(d.time.byAccount).toEqual([
      { label: 'ACME Corp', hours: 2, cfH: 2, crH: 0 },
      { label: 'Globex', hours: 1, cfH: 0, crH: 1 },
      { label: 'No account', hours: 0.5, cfH: 0, crH: 0 },
    ]);
    expect(d.time.entries.map((e) => e.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
    // the logged focus block is in the log already; only the unlogged hour is a signal
    expect(d.time.signals).toEqual({ focusMin: 60, driveMin: 0, slackMin: 0 });
    expect(d.summary.yourH).toBe(3.5);
  });

  it('a run across midnight counts on both days, with its minutes split', () => {
    const r = run({ id: 'r_night', startedAt: '2026-11-11T06:00:00Z', finishedAt: '2026-11-11T08:00:00Z' }); // 23:00 → 01:00 Denver
    const src = sources({ agentRuns: [r] });
    expect(composeHistoryDay(src, '2026-11-10').runs.map((x) => x.agentMin)).toEqual([60]);
    expect(composeHistoryDay(src, '2026-11-11').runs.map((x) => x.agentMin)).toEqual([60]);
    const m = composeHistoryMonth(src, '2026-11');
    expect(m.days.filter((x) => x.agentRuns).map((x) => x.day)).toEqual(['2026-11-10', '2026-11-11']);
  });

  it('a queued run that never started is not a run that day', () => {
    const r = run({ id: 'r_q', startedAt: null as unknown as string, state: 'queued', updatedAt: '2026-11-10T16:00:00Z' });
    expect(composeHistoryDay(sources({ agentRuns: [r] }), '2026-11-10').runs).toEqual([]);
  });
});

describe('sent', () => {
  it('says dry run for dry runs and counts only what really left as sent', () => {
    const drafts = [
      draft('d_dry', [{ id: 'at1', at: '2026-11-10T16:00:00Z', mode: 'send', dryRun: true, outcome: 'rendered' }]),
      draft('d_sent', [{ id: 'at2', at: '2026-11-10T17:00:00Z', mode: 'send', dryRun: false, outcome: 'sent' }], { state: 'verified', at: '2026-11-10T17:01:00Z', detail: 'Verified in Slack ✓' }),
      draft('d_failed', [{ id: 'at3', at: '2026-11-10T18:00:00Z', mode: 'send', dryRun: false, outcome: 'failed' }]),
      draft('d_staged', [{ id: 'at4', at: '2026-11-10T19:00:00Z', mode: 'draft', dryRun: false, outcome: 'staged' }]),
    ];
    const d = composeHistoryDay(sources({ drafts }), '2026-11-10');
    expect(d.sent.map((s) => [s.draftId, s.outcome, s.label])).toEqual([
      ['d_dry', 'dry_run', 'Dry run · nothing was sent'],
      ['d_sent', 'sent', 'Sent · verified in Slack'],
      ['d_failed', 'failed', 'Failed · nothing was sent'],
      ['d_staged', 'staged', 'Saved as a Slack draft'],
    ]);
    expect(d.summary).toMatchObject({ sent: 2, dryRuns: 1 });
  });
});

describe('month', () => {
  it('covers the grid, totals only the month, and stops at today', () => {
    const w = item({ id: 'w_oct', state: 'done', doneAt: '2026-10-30T17:00:00Z', doneBy: 'user', resolution: 'done_by_me', createdAt: '2026-10-30T16:00:00Z' });
    const m = HistoryMonth.parse(composeHistoryMonth(sources({ workItems: [w] }), '2026-11'));
    expect(m.days).toHaveLength(42);
    expect(m.days[0]!.day).toBe('2026-10-26');
    expect(m.days.find((x) => x.day === '2026-10-30')).toMatchObject({ inMonth: false, finished: 1, arrived: 1, active: true });
    expect(m.totals).toMatchObject({ finished: 0, activeDays: 0 }); // grid padding is not the month
    expect(m.days.find((x) => x.day === '2026-11-12')).toMatchObject({ isToday: true, future: false });
    expect(m.days.find((x) => x.day === '2026-11-13')).toMatchObject({ future: true, active: false });
    expect(m).toMatchObject({ month: '2026-11', label: 'November 2026', today: '2026-11-12', prevMonth: '2026-10', nextMonth: null });
    expect(composeHistoryMonth(sources(), '2026-10').nextMonth).toBe('2026-11');
    expect(composeHistoryMonth(sources()).month).toBe('2026-11');
  });

  it('a future day is empty and has no next day', () => {
    const d = composeHistoryDay(sources(), '2026-11-20');
    expect(d).toMatchObject({ future: true, nextDay: null, finished: [], sent: [], runs: [] });
    expect(composeHistoryDay(sources(), '2026-11-12').nextDay).toBeNull();
  });
});

describe('page helpers', () => {
  it('rows open the existing Details kinds (tool runs as tool_run) and the sentence keeps agent time apart', () => {
    const r = run({ id: 'r_tool', kind: 'tool_run', toolRunId: 'tr_1', startedAt: '2026-11-10T16:00:00Z', finishedAt: '2026-11-10T16:05:00Z' });
    const w = item({ id: 'w_x', state: 'done', doneAt: '2026-11-10T17:00:00Z', doneBy: 'user', resolution: 'done_by_me' });
    const d = composeHistoryDay(sources({ agentRuns: [r], workItems: [w], drafts: [draft('d1', [{ id: 'at1', at: '2026-11-10T16:00:00Z', mode: 'send', dryRun: true, outcome: 'rendered' }])] }), '2026-11-10');
    expect(dayRows(d).map((x) => x.entity.kind)).toEqual(['work_item', 'draft', 'tool_run']);
    expect(daySentence(d)).toBe('Tuesday 10 November · 1 finished · 1 dry run · 1 agent run in the background · agent time never counts as yours');
    expect(daySentence(composeHistoryDay(sources(), '2026-11-09'))).toBe('Monday 9 November · nothing recorded');
  });
});
