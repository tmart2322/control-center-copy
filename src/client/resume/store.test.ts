import { describe, expect, it } from 'vitest';
import { AWAY_MS, createResumeStore, MAX_ROUTES, RESUME_KEY, routeKey, type StorageLike } from './store';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('resume store', () => {
  it('normalises route keys', () => {
    expect(routeKey('/work/')).toBe('/work');
    expect(routeKey('/work?tab=done')).toBe('/work');
    expect(routeKey('/')).toBe('/');
  });

  it('persists selection, sheet, scroll and chat thread per route and survives a restart', () => {
    const storage = memoryStorage();
    const a = createResumeStore(storage, () => 1);
    a.setSelection('/work', 'list', 'w1');
    a.setSheet('/work', { id: 'w1', kind: 'item' });
    a.setScroll('/work', 'main', 420.6);
    a.setChatThread('/', 'th_today');
    a.setExtra('/work', 'groups', { done: true });

    const b = createResumeStore(storage); // "Monday morning"
    expect(b.get('/work')).toMatchObject({ selection: { list: 'w1' }, sheet: { id: 'w1', kind: 'item' }, scroll: { main: 421 }, extra: { groups: { done: true } } });
    expect(b.get('/').chatThreadId).toBe('th_today');
    expect(b.get('/never').selection).toEqual({});
  });

  it('merges partial patches instead of replacing maps', () => {
    const s = createResumeStore(memoryStorage());
    s.setScroll('/', 'now', 10);
    s.setScroll('/', 'rail', 20);
    expect(s.get('/').scroll).toEqual({ now: 10, rail: 20 });
  });

  it('caps the number of routes (LRU)', () => {
    let t = 0;
    const s = createResumeStore(memoryStorage(), () => ++t);
    for (let i = 0; i < MAX_ROUTES + 5; i++) s.setSelection(`/work/w${i}`, 'list', 'x');
    expect(s.get('/work/w0').selection).toEqual({});
    expect(s.get(`/work/w${MAX_ROUTES + 4}`).selection).toEqual({ list: 'x' });
  });

  it('tolerates corrupt storage and tracks activity', () => {
    const storage = memoryStorage();
    storage.setItem(RESUME_KEY, '{not json');
    const s = createResumeStore(storage);
    expect(s.get('/').sheet).toBeNull();
    s.touchActive(1234);
    s.setLastRoute('/time/');
    const again = createResumeStore(storage);
    expect(again.lastActiveAt()).toBe(1234);
    expect(again.lastRoute()).toBe('/time');
  });

  it('MIN-27: a gap of 30 minutes or more is an absence: awaySince moves to the last input before it', () => {
    const s = createResumeStore(memoryStorage());
    const t0 = Date.parse('2026-11-06T17:31:00Z');
    expect(s.touchActive(t0)).toBe(false); // a fresh browser knows no absence: nothing to send
    expect(s.awaySince()).toBeNull();
    expect(s.touchActive(t0 + 10 * 60_000)).toBe(false); // still here
    expect(s.awaySince()).toBeNull();
    const back = Date.parse('2026-11-07T08:05:00Z');
    expect(s.touchActive(back)).toBe(true); // overnight: away since the last input
    expect(s.awaySince()).toBe(t0 + 10 * 60_000);
    expect(s.lastActiveAt()).toBe(back);
    expect(s.touchActive(back + AWAY_MS - 1)).toBe(false);
    expect(s.awaySince()).toBe(t0 + 10 * 60_000);
  });

  it('MIN-27: data from before awaySince starts it at the last input', () => {
    const storage = memoryStorage();
    storage.setItem(RESUME_KEY, JSON.stringify({ v: 1, routes: {}, lastRoute: null, lastActiveAt: 1_000_000 }));
    const s = createResumeStore(storage);
    expect(s.touchActive(1_060_000)).toBe(false);
    expect(s.awaySince()).toBe(1_000_000);
  });
});
