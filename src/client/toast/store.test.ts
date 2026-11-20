import { describe, expect, it } from 'vitest';
import { ToastStore } from './store';

describe('ToastStore', () => {
  it('keeps at most 3, dropping the oldest', () => {
    const s = new ToastStore();
    for (let i = 1; i <= 5; i++) s.push({ title: `t${i}` });
    expect(s.getSnapshot().map((t) => t.title)).toEqual(['t3', 't4', 't5']);
  });

  it('replaces a toast with the same key instead of stacking (one channel per event)', () => {
    const s = new ToastStore();
    const a = s.push({ key: 'rerank', title: 'Re-ranked' });
    const b = s.push({ key: 'rerank', title: 'Re-ranked again' });
    expect(a).toBe(b);
    expect(s.getSnapshot()).toHaveLength(1);
    expect(s.getSnapshot()[0]).toMatchObject({ title: 'Re-ranked again', rev: 1 });
  });

  it('finds the newest undoable toast for z / ⌘Z', () => {
    const s = new ToastStore();
    s.push({ title: 'a', undo: { auditId: 'au1' } });
    const b = s.push({ title: 'b', undo: { auditId: 'au2' } });
    s.push({ title: 'c' });
    expect(s.latestUndoable()?.id).toBe(b);
    s.update(b, { phase: 'undoing' });
    expect(s.latestUndoable()?.title).toBe('a');
  });

  it('notifies subscribers and dismisses', () => {
    const s = new ToastStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    const id = s.push({ title: 'x' });
    s.dismiss(id);
    off();
    s.push({ title: 'y' });
    expect(n).toBe(2);
    expect(s.getSnapshot()).toHaveLength(1);
  });
});
