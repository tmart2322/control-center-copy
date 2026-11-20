/**
 * B-069: optimistic patches on versionless entities. Real mock payloads go into a real QueryClient, then
 * the hook's own steps run (snapshotTopics → optimistic(input, optimisticCache) → restoreSnapshots on
 * error, patchAll write-back on success), with the updaters the components use.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Seed, type AgentRun, type AgentsPayload, type EventLogPayload, type HomePayload, type ItemsPayload, type JobsPayload, type TodayPayload } from '@/contract';
import { queryKey } from '@/client/api';
import { MockDataSource } from '@/server/datasource/mock';
import { deepFindById } from './cache';
import { findVersioned, optimisticCache, patchAll, restoreSnapshots, snapshotTopics } from './query-cache';

const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../mock/seed.example.json'), 'utf8')));

let ds: MockDataSource;
const payloads: Record<string, unknown> = {};
beforeAll(async () => {
  ds = new MockDataSource({ seed: structuredClone(seed), delays: { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 }, autoplay: false, clockMode: 'seed' });
  payloads.getAgents = await ds.getAgents({} as never);
  payloads.getToday = await ds.getToday({} as never);
  payloads.getHome = await ds.getHome({ query: {} } as never);
  payloads.getJobs = await ds.getJobs({} as never);
  payloads.getEventLog = await ds.getEventLog({} as never);
  payloads.listItems = await ds.listItems({ query: { tab: 'all_open' } } as never);
});
afterAll(() => ds.dispose());

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(queryKey('getAgents'), structuredClone(payloads.getAgents));
  qc.setQueryData(queryKey('getToday'), structuredClone(payloads.getToday));
  qc.setQueryData(queryKey('getHome', { query: {} } as never), structuredClone(payloads.getHome));
  qc.setQueryData(queryKey('getJobs'), structuredClone(payloads.getJobs));
  qc.setQueryData(queryKey('getEventLog'), structuredClone(payloads.getEventLog));
  qc.setQueryData(queryKey('listItems', { query: { tab: 'all_open' } } as never), structuredClone(payloads.listItems));
});

const agents = () => qc.getQueryData<AgentsPayload>(queryKey('getAgents'))!;
const today = () => qc.getQueryData<TodayPayload>(queryKey('getToday'))!;
const jobs = () => qc.getQueryData<JobsPayload>(queryKey('getJobs'))!;
const events = () => qc.getQueryData<EventLogPayload>(queryKey('getEventLog'))!;
const home = () => qc.getQueryData<HomePayload>(queryKey('getHome', { query: {} } as never))!;
const items = () => qc.getQueryData<ItemsPayload>(queryKey('listItems', { query: { tab: 'all_open' } } as never))!;

/** The hook's onMutate: cancel + snapshot the topics, then run the component's optimistic updater. */
async function begin(topics: string[], id: string, updater: (e: Record<string, unknown>) => Record<string, unknown>) {
  const snapshots = await snapshotTopics(qc, topics);
  optimisticCache(qc, topics).patchEntity(id, updater);
  return snapshots;
}

describe('versionless kinds update instantly and roll back (B-069)', () => {
  it('AgentRun: answer (src/components/agents/actions.tsx) patches the Agents list and Today’s copies', async () => {
    const id = 'run_umbrella_data';
    const before = agents();
    expect(before.runs.find((r) => r.id === id)?.state).toBe('waiting_on_you');
    const snaps = await begin(['agents', 'today', 'home'], id, (e) => ({ ...e, state: 'running', waiting: null, lastEvent: 'You answered: prod' }));

    const run = agents().runs.find((r) => r.id === id)!;
    expect(run.state).toBe('running');
    expect(run.waiting).toBeNull();
    expect(run.lastEvent).toBe('You answered: prod');
    // Other runs keep identity (structural sharing).
    const other = before.runs.find((r) => r.id !== id)!;
    expect(agents().runs.find((r) => r.id === other.id)).toBe(other);
    // The EntityRef chips that point at the run are links, not the run: left alone.
    const refs = today()
      .rail.flatMap((l) => l.entries)
      .map((e) => e.ref)
      .filter((r) => r?.id === id);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(Object.keys(r!).sort()).toEqual(['href', 'id', 'label', 'type']);

    restoreSnapshots(qc, snaps); // onError
    expect(agents()).toEqual(before);
    expect(agents().runs.find((r) => r.id === id)?.state).toBe('waiting_on_you');
  });

  it('AgentRun: cancel patches state + error; success write-back merges the server run into its topics', async () => {
    const id = 'run_acme_build';
    const topics = ['agents', 'today', 'tools', 'home'];
    await begin(topics, id, (e) => ({ ...e, state: 'failed', error: 'Cancelled by you', lastEvent: 'Cancelled' }));
    expect(agents().runs.find((r) => r.id === id)).toMatchObject({ state: 'failed', error: 'Cancelled by you' });
    const card = today().nowStack.cards.find((c) => c.run?.id === id);
    expect(card?.run).toMatchObject({ state: 'failed', error: 'Cancelled by you' }); // Today's NOW-card copy too

    const server: AgentRun = { ...(agents().runs.find((r) => r.id === id) as AgentRun), state: 'failed', lastEvent: 'Cancelled by server', updatedAt: '2026-11-06T12:00:00Z' };
    patchAll(qc, id, (old) => ({ ...old, ...server }), topics); // onSuccess write-back (versionless: the mutation's topics)
    expect(agents().runs.find((r) => r.id === id)?.lastEvent).toBe('Cancelled by server');
    expect(today().nowStack.cards.find((c) => c.run?.id === id)?.run?.lastEvent).toBe('Cancelled by server');
  });

  it('a versionless write-back stays inside its topics (a TriageItem shares its MissedOpp’s id)', async () => {
    const missed = await ds.getMissed({} as never);
    const triage = await ds.getTriage({} as never);
    qc.setQueryData(queryKey('getMissed'), missed);
    qc.setQueryData(queryKey('getTriage'), triage);
    const item = triage.groups.flatMap((g) => g.items).find((t) => t.kind === 'missed_opp')!;
    expect(missed.missed.some((m) => m.id === item.id)).toBe(true);
    patchAll(qc, item.id, (old) => ({ ...old, ...item, title: 'Accepted' }), ['triage', 'today', 'items', 'item']);
    expect(qc.getQueryData(queryKey('getMissed'))).toBe(missed);
  });

  it('Job: Retry (src/components/health/JobsErrorsTabs.tsx) requeues the row, then rolls back', async () => {
    const before = jobs();
    const snaps = await begin(['jobs'], 'job_4', (j) => ({ ...j, status: 'queued', attempts: 0, error: null }));
    expect(jobs().jobs.find((j) => j.id === 'job_4')).toMatchObject({ status: 'queued', attempts: 0, error: null });
    restoreSnapshots(qc, snaps);
    expect(jobs()).toEqual(before);
    expect(jobs().jobs.find((j) => j.id === 'job_4')?.status).toBe('dead');
  });

  it('EventLogEntry: Acknowledge marks the entry, then rolls back', async () => {
    const before = events();
    const target = before.entries.find((e) => !e.acknowledged)!;
    const snaps = await begin(['event_log'], target.id, (x) => ({ ...x, acknowledged: true, acknowledgedAt: '2026-11-06T12:00:00Z' }));
    expect(events().entries.find((e) => e.id === target.id)?.acknowledged).toBe(true);
    restoreSnapshots(qc, snaps);
    expect(events()).toEqual(before);
  });

  it('findEntity returns a versionless entity (it used to return undefined)', () => {
    const run = optimisticCache(qc, ['agents']).findEntity('run_umbrella_data');
    expect(run?.title).toBe(agents().runs.find((r) => r.id === 'run_umbrella_data')!.title);
    expect(run?.version).toBeUndefined();
  });
});

describe('versioned entities keep the old rule (refs and unversioned rows untouched)', () => {
  it('a work-item patch reaches its versioned copies but not a Home row that only reuses its id', async () => {
    const row = home()
      .sections.flatMap((s) => s.rows)
      .find((r) => r.item && r.id === r.item.id)!;
    expect(row).toBeTruthy();
    const id = row.id;
    const listCopy = items().items.find((w) => w.id === id);
    await begin(['items', 'today', 'home'], id, (e) => ({ ...e, title: 'Edited' }));

    const after = home()
      .sections.flatMap((s) => s.rows)
      .find((r) => r.id === id)!;
    expect(after.title).toBe(row.title); // the row is not the entity
    expect(after.entity).toEqual(row.entity); // HomeEntity link untouched
    expect((after.item as unknown as { title?: string }).title).toBe('Edited'); // HomeItemRef {id, version} is versioned: patched as before
    if (listCopy) expect(items().items.find((w) => w.id === id)?.title).toBe('Edited');
  });

  it('409 base and ifVersion still read the versioned copy', () => {
    const w = items().items[0]!;
    expect(findVersioned(qc, w.id)?.version).toBe(w.version);
    expect(deepFindById(qc.getQueryData(queryKey('getAgents')), 'run_umbrella_data', 'versioned')).toBeUndefined();
  });
});
