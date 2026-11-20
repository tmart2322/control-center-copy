/**
 * The mock DataSource's loaded state as a Seed: the seed file after the mock's date shift and its load-time
 * ranking. Loading this into Postgres gives the db DataSource exactly the data the mock serves, so the two
 * can be compared side by side (scripts/db/seed-from-mock.ts, tests/be1b).
 */
import type { Seed } from '@/contract';

import type { MockDataSource } from '../mock';

export function seedFromMock(mock: MockDataSource): { seed: Seed; rankedAt: string } {
  const s = mock.store;
  const { rankedAt, policyRankVersion: _p, ...meta } = s.meta();
  const seed: Seed = {
    meta,
    people: s.all('people'),
    accounts: s.all('accounts'),
    opps: s.all('opps'),
    missedOpps: s.all('missedOpps'),
    initiatives: s.all('initiatives'),
    workItems: s.all('workItems'),
    evidence: s.all('evidence'),
    nbas: s.all('nbas'),
    drafts: s.all('drafts'),
    proposals: s.all('proposals'),
    assets: s.all('assets'),
    calendar: { events: s.all('events'), slots: s.all('slots') },
    agentRuns: s.all('agentRuns'),
    toolAdapters: s.all('toolAdapters'),
    toolRuns: s.all('toolRuns'),
    activity: s.all('activity'),
    timeBlocks: s.all('timeBlocks'),
    briefs: s.all('briefs'),
    watches: s.all('watches'),
    connectors: s.all('connectors'),
    scanRuns: s.all('scanRuns'),
    jobs: s.all('jobs'),
    eventLog: s.all('eventLog'),
    spend: s.spend(),
    settings: s.settings(),
    policyVersions: s.all('policyVersions'),
    chatThreads: s.all('chatThreads'),
    mappings: s.all('mappings'),
    audit: mock.loaded.seed.audit,
  };
  return { seed: structuredClone(seed), rankedAt };
}
