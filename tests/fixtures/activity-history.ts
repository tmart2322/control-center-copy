/**
 * Activity history on top of the placeholder seed (Time ▸ Log tests): rows of the PREVIOUS fiscal quarter read
 * back from Org62 (logged, fromOrg62), one verified row, one row the engine excluded (overlap), and one Org62 row
 * on the first day of the current quarter. Dates are relative to the seed's asOf, so the previous quarter is
 * always a past quarter whatever day the suite runs. Placeholder names only.
 */
import { ActivityEntry, type Seed } from '../../src/contract';
import { fiscalQuarterOfDay } from '../../src/server/datasource/activity-log';
import { fiscalQuarterAt, fiscalQuarterBounds } from '../../src/server/datasource/db/quarter';
import { org62RecordUrl } from '../../src/projections/links';

export interface QuarterRange {
  label: string;
  start: string;
  end: string;
}

export interface ActivityHistory {
  seed: Seed;
  cur: QuarterRange;
  prev: QuarterRange;
  /** The added rows by role. */
  ids: { org62A: string; org62B: string; verified: string; excluded: string; curOrg62: string };
  /** Hours of the added logged + verified rows in the previous quarter. */
  prevLoggedH: number;
  /** Account and opp the added rows use (seed placeholders). */
  account: string;
  oppId: string;
}

const plusDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export function withActivityHistory(base: Seed): ActivityHistory {
  const seed = structuredClone(base);
  const tz = seed.settings.profile.timezone;
  const cq = fiscalQuarterAt(new Date(seed.meta.asOf), tz);
  const cur = { label: cq.label, start: cq.start, end: cq.end };
  const prevLabel = fiscalQuarterOfDay(plusDays(cur.start, -1));
  const prev = { label: prevLabel, ...fiscalQuarterBounds(prevLabel)! };
  const opp = seed.opps[0]!;
  const account = seed.accounts.find((a) => a.id === opp.accountId)!.name;

  const row = (id: string, day: string, hours: number, o: Partial<ActivityEntry>, hm = '17:00'): ActivityEntry => {
    const start = `${day}T${hm}:00.000Z`;
    const end = new Date(Date.parse(start) + hours * 3_600_000).toISOString();
    return ActivityEntry.parse({
      id,
      version: 1,
      date: day,
      start,
      end,
      durationH: hours,
      taskType: 'Demo',
      oppId: opp.id,
      oppName: opp.name,
      accountName: account,
      meetingType: 'CF',
      description: 'HISTORY_ROW',
      status: 'logged',
      confidence: 'sure',
      sources: [],
      userLockedFields: [],
      issues: [],
      updatedAt: end,
      ...o,
    });
  };
  // as the read-back writes them (projections/activity.ts fromOrg62): the Event's id and record link
  const org62 = (n: number) => {
    const externalId = `00U00000000000${n}AAA`;
    return [{ kind: 'org62' as const, label: 'Org62 · Solutions Event', externalId, url: org62RecordUrl('Event', externalId)! }];
  };

  const ids = { org62A: 'act_hist_org62_a', org62B: 'act_hist_org62_b', verified: 'act_hist_verified', excluded: 'act_hist_excluded', curOrg62: 'act_hist_cur_org62' };
  const dA = plusDays(prev.start, 14);
  const dB = plusDays(prev.start, 40);
  const dV = plusDays(prev.end, -6);
  const added = [
    row(ids.org62A, dA, 2, { description: 'HISTORY_DEMO_ONE', fromOrg62: true, sources: org62(1), loggedAt: `${dA}T21:00:00.000Z` }),
    row(ids.org62B, dB, 1.5, { description: 'HISTORY_PREP_TWO', taskType: 'Discovery', meetingType: 'CR', oppId: null, oppName: null, accountName: 'ACCOUNT_HISTORY', fromOrg62: true, sources: org62(2), loggedAt: `${dB}T21:00:00.000Z` }),
    row(ids.verified, dV, 1, { description: 'HISTORY_VERIFIED_THREE', taskType: 'Solution Design', status: 'verified', loggedAt: `${dV}T19:00:00.000Z`, verifiedAt: `${dV}T22:00:00.000Z`, updatedAt: `${dV}T22:00:00.000Z` }),
    // overlaps HISTORY_PREP_TWO (17:00–18:30): the engine excluded it
    row(ids.excluded, dB, 1, { description: 'HISTORY_OVERLAP_FOUR', status: 'dismissed', excludedReason: 'overlap', issues: ['double-booked: hours are human hours, counted once'] }, '18:00'),
    row(ids.curOrg62, cur.start, 0.75, { description: 'HISTORY_CURRENT_FIVE', fromOrg62: true, sources: org62(5), loggedAt: `${cur.start}T21:00:00.000Z` }),
  ];
  seed.activity = [...seed.activity, ...added];
  return { seed, cur, prev, ids, prevLoggedH: 2 + 1.5 + 1, account, oppId: opp.id };
}
