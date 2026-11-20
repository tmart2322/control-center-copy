import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft, PatchDraftRequest, TipTapDoc } from '@/contract';
import { DraftAutosave, type AutosaveDeps } from '../autosave';

const doc = (text: string): TipTapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const base = (over: Partial<Draft> = {}): Draft => ({
  id: 'dr_1',
  version: 1,
  workItemId: 'w_1',
  nbaId: 'nba_1',
  destination: { kind: 'slack', target: 'thread', channelId: 'C1', channelName: '#acme-ext', threadTs: '1.1' },
  mode: 'draft',
  doc: doc('Hi Dana'),
  plainText: 'Hi Dana',
  rendered: {},
  userTouched: false,
  userLockedFields: [],
  status: 'drafting',
  threadContext: [],
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T09:00:00.000Z',
  savedAt: null,
  scheduledFor: null,
  attempts: [],
  verification: null,
  rejectedReason: null,
  resultUrl: null,
  ...over,
});

const conflictErr = (current: Draft) => Object.assign(new Error('changed elsewhere'), { code: 'conflict', current });

function setup(patchImpl?: (body: PatchDraftRequest, n: number) => Promise<{ entity: Draft; auditId: string }>) {
  let server = base();
  let n = 0;
  const patch = vi.fn(async (body: PatchDraftRequest) => {
    const i = n++;
    if (patchImpl) return patchImpl(body, i);
    if (body.ifVersion !== server.version) throw conflictErr(server);
    server = { ...server, ...body, version: server.version + 1, userTouched: true, savedAt: new Date().toISOString() } as Draft;
    return { entity: server, auditId: `a${i}` };
  });
  const deps: AutosaveDeps = { patch, onOptimistic: vi.fn(), onSaved: vi.fn(), onRollback: vi.fn(), onAdopt: vi.fn(), debounceMs: 1000 };
  const a = new DraftAutosave(base(), deps);
  return { a, deps, patch, setServer: (d: Draft) => (server = d), getServer: () => server };
}

describe('DraftAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces ~1 s, sends ifVersion, marks touched, and lands "saved"', async () => {
    const { a, patch, deps } = setup();
    a.edit({ doc: doc('Hi Dana!') });
    a.edit({ doc: doc('Hi Dana!!') });
    expect(a.getState()).toMatchObject({ dirty: true, touched: true, status: 'dirty' });
    expect(deps.onOptimistic).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0]).toEqual({ ifVersion: 1, doc: doc('Hi Dana!!') });
    expect(a.getState()).toMatchObject({ status: 'saved', dirty: false, baseVersion: 2 });
    expect(a.getState().savedLocalAt).not.toBeNull();
  });

  it('flush (blur / navigation / before send) saves immediately', async () => {
    const { a, patch } = setup();
    a.edit({ doc: doc('Hi') });
    await expect(a.flush()).resolves.toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('failure: rolls the cache back, keeps the text, and Retry saves it', async () => {
    let fail = true;
    const { a, deps } = setup(async (body) => {
      if (fail) throw Object.assign(new Error('Simulated upstream failure'), { code: 'upstream_unavailable' });
      return { entity: base({ version: 2, doc: body.doc!, userTouched: true }), auditId: 'a' };
    });
    a.edit({ doc: doc('Hi Dana, typed') });
    await expect(a.flush()).resolves.toBe(false);
    expect(a.getState()).toMatchObject({ status: 'error', dirty: true });
    expect(deps.onRollback).toHaveBeenCalledWith(expect.objectContaining({ version: 1, doc: doc('Hi Dana') }));
    expect(a.getLocal().doc).toEqual(doc('Hi Dana, typed'));
    fail = false;
    await expect(a.retry()).resolves.toBe(true);
    expect(a.getState().status).toBe('saved');
  });

  it('409 that touches our field → conflict; keep yours re-saves on their version', async () => {
    const { a, patch, setServer, getServer } = setup();
    setServer(base({ version: 2, doc: doc('Their edit'), userTouched: true }));
    a.edit({ doc: doc('My edit') });
    await expect(a.flush()).resolves.toBe(false);
    expect(a.getState().status).toBe('conflict');
    expect(a.getState().conflict?.doc).toEqual(doc('Their edit'));
    await expect(a.keepMine()).resolves.toBe(true);
    expect(patch.mock.calls.at(-1)![0]).toMatchObject({ ifVersion: 2, doc: doc('My edit') });
    expect(getServer().doc).toEqual(doc('My edit'));
  });

  it('409 → take theirs adopts the server draft and drops local edits', async () => {
    const { a, deps, setServer } = setup();
    const theirs = base({ version: 2, doc: doc('Their edit') });
    setServer(theirs);
    a.edit({ doc: doc('My edit') });
    await a.flush();
    a.takeTheirs();
    expect(deps.onAdopt).toHaveBeenCalledWith(theirs, 'theirs');
    expect(a.getState()).toMatchObject({ status: 'saved', dirty: false, baseVersion: 2, conflict: null });
  });

  it('409 that only changed fields we did not touch → silent rebase and retry (UI-SPEC §10)', async () => {
    const { a, patch, setServer } = setup();
    setServer(base({ version: 2, status: 'ready' })); // same doc, other field changed
    a.edit({ doc: doc('My edit') });
    await expect(a.flush()).resolves.toBe(true);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1]![0]).toMatchObject({ ifVersion: 2 });
    expect(a.getState().status).toBe('saved');
  });

  it('a newer server version that arrives mid-save is re-checked once the save fails (no stuck error)', async () => {
    let release!: () => void;
    const theirs = base({ version: 2, doc: doc('Their edit') });
    const { a } = setup(
      () =>
        new Promise((_res, rej) => {
          release = () => rej(Object.assign(new Error('Draft changed elsewhere'), { code: 'internal' })); // dev-mode 409 that lost its code
        }),
    );
    a.edit({ doc: doc('My edit') });
    const saving = a.flush();
    a.remote(theirs); // live refetch lands while the PATCH is in flight
    release();
    await saving;
    expect(a.getState().status).toBe('conflict');
    expect(a.getState().conflict?.version).toBe(2);
  });

  it('remote change while clean → adopt; while dirty on the same field → conflict (never overwrite)', () => {
    const clean = setup();
    clean.a.remote(base({ version: 2, doc: doc('Engine revised') }));
    expect(clean.deps.onAdopt).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }), 'remote');
    expect(clean.a.getState().baseVersion).toBe(2);

    const dirty = setup();
    dirty.a.edit({ doc: doc('Mine') });
    dirty.a.remote(base({ version: 2, doc: doc('Theirs') }));
    expect(dirty.deps.onAdopt).not.toHaveBeenCalled();
    expect(dirty.a.getState().status).toBe('conflict');
    expect(dirty.a.getLocal().doc).toEqual(doc('Mine'));
  });
});
