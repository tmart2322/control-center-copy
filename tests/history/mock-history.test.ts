/**
 * B-081 History on the mock DataSource, placeholder seed only (src/mock/seed.example.json). The seed's days are
 * shifted so its asOf is today, so every day here is relative to the mock's frozen clock.
 * Covers: contract validity, what each past seed day holds, a close and its Undo, a close and a reopen, a dry-run
 * dispatch (counted as a dry run, never as sent), and that agent time never adds to your hours.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryDay, HistoryMonth, Seed } from '@/contract';
import { dayKey } from '@/engines/home/time';
import { MockDataSource } from '@/server/datasource/mock';
import { shiftDay } from '@/components/history/derive';

const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
const fast = { enrichMs: 1e8, stepMs: 1e8, chatTokenMs: 0, verifyMs: 1e8, reevalMs: 1e8 };

let ds: MockDataSource;
let today: string;
const ago = (n: number) => shiftDay(today, -n);
const day = async (d: string) => HistoryDay.parse(await ds.getHistoryDay({ params: { day: d } }));

beforeEach(() => {
  ds = new MockDataSource({ seed: structuredClone(seed), delays: fast, autoplay: false, clockMode: 'seed' });
  ds.clock.freeze(new Date(ds.loaded.seed.meta.asOf));
  ds.resetStore();
  today = dayKey(ds.now().getTime(), seed.settings.profile.timezone);
});
afterEach(() => ds.dispose());

describe('History on the mock (placeholder seed)', () => {
  it('the month is contract-valid and its totals are the sum of the month’s days', async () => {
    const m = HistoryMonth.parse(await ds.getHistoryMonth({ query: {} }));
    expect(m.today).toBe(today);
    expect(m.days.length % 7).toBe(0);
    expect(m.days.find((d) => d.day === today)?.isToday).toBe(true);
    const own = m.days.filter((d) => d.inMonth);
    expect(m.totals.finished).toBe(own.reduce((s, d) => s + d.finished, 0));
    expect(m.totals.yourH).toBe(own.reduce((s, d) => s + d.yourH, 0));
    expect(m.days.filter((d) => d.future).every((d) => !d.active)).toBe(true);
    expect(m.nextMonth).toBeNull();
  });

  it('the day before asOf: closes with who closed them, human hours by account and CF/CR, a failed send, background runs', async () => {
    const d = await day(ago(1));
    expect(d.finished.map((f) => [f.itemId, f.by, f.label])).toEqual([
      ['w_initech_security', 'you', 'Handed off → Kim Tran'],
      ['w_acme_recap', 'you', 'Done by you'],
    ]);
    // 0.5 h of it is the seed's internal Drive docs block (D-64): human hours, neither CF nor CR; 1 h the roadmap call
    // that still needs its opportunity (CF: someone from the customer was there)
    expect(d.time).toMatchObject({ yourH: 8, cfH: 6.5, crH: 1 });
    expect(d.time.byAccount.map((g) => [g.label, g.hours])).toEqual([
      ['Hooli', 5],
      ['Umbrella Health', 1.5],
      ['No account', 1],
      ['Internal', 0.5],
    ]);
    expect(d.time.entries.some((e) => e.status === 'dismissed')).toBe(true); // listed, not counted
    expect(d.sent.map((s) => [s.draftId, s.outcome])).toEqual([['dr_failed_globex', 'failed']]);
    expect(d.summary).toMatchObject({ finished: 2, yourH: 8, meetings: 2, sent: 0, dryRuns: 0, agentRuns: 2 });
    expect(d.time.agentMin).toBeGreaterThan(0);
    expect(d.runs.map((r) => r.kind).sort()).toEqual(['claude_session', 'tool_run']);
  });

  it('asOf day: engine closes ("Closed for you"), verified and unverified sends, rows logged to Org62 by when they were logged', async () => {
    const d = await day(today);
    expect(d.finished.every((f) => f.by === 'engine' && f.label.startsWith('Closed for you'))).toBe(true);
    expect(d.finished).toHaveLength(3);
    expect(d.sent.map((s) => s.label)).toEqual(['Sent · verified in Gmail', 'Sent']);
    expect(d.org62.length).toBeGreaterThan(0);
    expect(d.org62.every((o) => o.workDay < today)).toBe(true); // logged today, worked earlier
    expect(d.nextDay).toBeNull();
  });

  it('a close shows that day; Undo takes it away again', async () => {
    const before = (await day(today)).summary.finished;
    const r = await ds.itemAction({ params: { id: 'w_dana_reply', verb: 'done' }, body: { ifVersion: 1 } });
    const after = await day(today);
    expect(after.summary.finished).toBe(before + 1);
    expect(after.finished.find((f) => f.itemId === 'w_dana_reply')).toMatchObject({ by: 'you', label: 'Done by you', reopenedSince: false });
    await ds.undoAudit({ params: { id: r.auditId! }, body: {} });
    const undone = await day(today);
    expect(undone.summary.finished).toBe(before);
    expect(undone.finished.some((f) => f.itemId === 'w_dana_reply')).toBe(false);
  });

  it('a close the item was reopened from stays in the record, marked reopened since', async () => {
    const r = await ds.itemAction({ params: { id: 'w_dana_reply', verb: 'done' }, body: { ifVersion: 1 } });
    await ds.itemAction({ params: { id: 'w_dana_reply', verb: 'reopen' }, body: { ifVersion: r.entity.version } });
    const d = await day(today);
    expect(d.finished.find((f) => f.itemId === 'w_dana_reply')).toMatchObject({ by: 'you', reopenedSince: true });
  });

  it('a dry-run dispatch is a dry run, never a send', async () => {
    const draft = seed.drafts.find((x) => x.status === 'ready')!;
    const before = (await day(today)).summary;
    const p = await ds.previewDraft({ params: { id: draft.id }, body: { mode: 'send' } });
    await ds.dispatchDraft({ params: { id: draft.id }, body: { ifVersion: draft.version, mode: 'send', confirmToken: p.confirmToken } });
    const d = await day(today);
    expect(d.summary.dryRuns).toBe(before.dryRuns + 1);
    expect(d.summary.sent).toBe(before.sent);
    expect(d.sent.find((s) => s.draftId === draft.id)).toMatchObject({ outcome: 'dry_run', dryRun: true, label: 'Dry run · nothing was sent' });
  });

  it('a future day is empty; a day before the seed is quiet', async () => {
    const f = await day(shiftDay(today, 3));
    expect(f).toMatchObject({ future: true, nextDay: null });
    expect(f.summary.active).toBe(false);
    const q = await day(ago(40));
    expect(q.summary.active).toBe(false);
    expect(q.finished).toEqual([]);
  });
});
