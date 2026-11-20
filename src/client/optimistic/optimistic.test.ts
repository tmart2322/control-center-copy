import { describe, expect, it } from 'vitest';
import { deepFindById, deepPatchById, isLink, resolveMatch } from './cache';
import { patchFieldsOf, rebaseFieldPatch } from './rebase';

const item = { id: 'w1', version: 3, title: 'Reply to Dana', notes: '', refs: { account: { type: 'account', id: 'a1', label: 'ACME' } } };

describe('cache helpers', () => {
  const today = {
    nowStack: { cards: [{ item, nba: null }, { item: { id: 'w2', version: 1, title: 'Other' }, nba: null }] },
    moreToday: { items: [{ ...item }] },
    link: { id: 'w1', label: 'a ref without version is left alone' },
  };

  it('patches every copy of an entity and keeps untouched branches identical', () => {
    const next = deepPatchById(today, 'w1', (e) => ({ ...e, title: 'Reply to Dana (edited)' }));
    expect(next.nowStack.cards[0]!.item.title).toBe('Reply to Dana (edited)');
    expect(next.moreToday.items[0]!.title).toBe('Reply to Dana (edited)');
    expect(next.nowStack.cards[1]).toBe(today.nowStack.cards[1]);
    expect(next.link).toBe(today.link);
    expect(today.nowStack.cards[0]!.item.title).toBe('Reply to Dana');
  });

  it('returns the same object when nothing matches', () => {
    expect(deepPatchById(today, 'nope', (e) => e)).toBe(today);
  });

  it('finds an entity by id', () => {
    expect(deepFindById(today, 'w2')?.title).toBe('Other');
    expect(deepFindById(today, 'missing')).toBeUndefined();
  });
});

describe('versionless entities (B-069)', () => {
  const run = { id: 'run1', kind: 'app_run', title: 'Umbrella data pull', state: 'waiting_on_you', waiting: { reason: 'input needed' } };
  const agents = {
    runs: [run, { id: 'run2', kind: 'claude_session', title: 'Other', state: 'running' }],
    card: { item: { id: 'w9', version: 2, title: 'x', refs: { run: { type: 'agent_run', id: 'run1', label: 'Umbrella data pull', href: '/agents?run=run1' } } }, run: { ...run } },
  };

  it('matches on id when the entity carries no version (it used to be a silent no-op)', () => {
    const next = deepPatchById(agents, 'run1', (e) => ({ ...e, state: 'running', waiting: null }));
    expect(next.runs[0]).toMatchObject({ state: 'running', waiting: null });
    expect(next.card.run).toMatchObject({ state: 'running', waiting: null });
    expect(next.runs[1]).toBe(agents.runs[1]);
    expect(agents.runs[0]!.state).toBe('waiting_on_you');
  });

  it('leaves link shapes (EntityRef, Job.entity) alone', () => {
    const next = deepPatchById(agents, 'run1', (e) => ({ ...e, state: 'running' }));
    expect(next.card.item.refs.run).toBe(agents.card.item.refs.run);
    expect(isLink({ type: 'work_item', id: 'w1', label: 'Reply' })).toBe(true);
    expect(isLink({ kind: 'connector', id: 'slack', label: 'Slack' })).toBe(true);
    expect(isLink({ id: 'job_1', type: 'scan.slack', status: 'dead', attempts: 3 })).toBe(false);
    expect(isLink({ id: 'w1', version: 1 })).toBe(false);
  });

  it('auto mode stays versioned-only when any copy has a version', () => {
    const mixed = { a: { id: 'w1', version: 2, title: 't' }, row: { id: 'w1', title: 't', why: 'row' } };
    expect(resolveMatch('w1', [mixed])).toBe('versioned');
    const next = deepPatchById(mixed, 'w1', (e) => ({ ...e, title: 'T' }));
    expect(next.a.title).toBe('T');
    expect(next.row).toBe(mixed.row);
    expect(resolveMatch('run1', [agents])).toBe('id');
    // An explicit mode wins: a payload judged on its own can't override the cache-wide decision.
    expect(deepPatchById(mixed.row, 'w1', (e) => ({ ...e, title: 'T' }), 'versioned')).toBe(mixed.row);
  });

  it('finds a versionless entity, preferring a versioned copy', () => {
    expect(deepFindById(agents, 'run1')?.title).toBe('Umbrella data pull');
    expect(deepFindById(agents, 'run1', 'versioned')).toBeUndefined();
    expect(deepFindById({ row: { id: 'w1', title: 'row' }, e: { id: 'w1', version: 3, title: 'entity' } }, 'w1')?.title).toBe('entity');
  });
});

describe('409 rebase', () => {
  it('re-applies when the server changed other fields', () => {
    const current = { ...item, version: 4, notes: 'engine added notes' };
    expect(rebaseFieldPatch(item, current, { title: 'Mine' })).toEqual({ ok: true, ifVersion: 4 });
  });

  it('conflicts when the server changed the same field', () => {
    const current = { ...item, version: 4, title: 'Theirs' };
    const r = rebaseFieldPatch(item, current, { title: 'Mine' });
    expect(r).toEqual({ ok: false, conflicts: [{ field: 'title', base: 'Reply to Dana', mine: 'Mine', theirs: 'Theirs' }] });
  });

  it('is not a conflict when they wrote what we want', () => {
    const current = { ...item, version: 4, title: 'Same' };
    expect(rebaseFieldPatch(item, current, { title: 'Same' })).toEqual({ ok: true, ifVersion: 4 });
  });

  it('compares structured values', () => {
    const base = { ...item, effort: { youMin: 5, agentMin: 0 } };
    const current = { ...base, version: 4, effort: { youMin: 5, agentMin: 0 } };
    expect(rebaseFieldPatch(base, current, { effort: { youMin: 10, agentMin: 0 } })).toEqual({ ok: true, ifVersion: 4 });
  });

  it('reads patch fields from each body shape', () => {
    expect(patchFieldsOf({ ifVersion: 1, patch: { title: 'x' } })).toEqual({ title: 'x' });
    expect(patchFieldsOf({ ifVersion: 1, value: { dryRun: false }, confirm: true })).toEqual({ dryRun: false });
    expect(patchFieldsOf({ ifVersion: 1, doc: { type: 'doc' } })).toEqual({ doc: { type: 'doc' } });
  });
});
