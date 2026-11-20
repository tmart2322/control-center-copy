/**
 * The one live-list pattern (docs/UX.md "Live updates"), as pure steps: stable order, arrivals at their natural place
 * (marked), many at once or while you are busy behind the pill, rows that left elsewhere linger while yours go at
 * once, the selection keeps its row, and a field you are editing keeps your text and reports a conflict.
 */
import { describe, expect, it } from 'vitest';

import { departuresOf, mergeField, mergeLive, survivorOf } from '@/components/lists/live-merge';

describe('stable merge', () => {
  it('takes the server order on a new list', () => {
    expect(mergeLive({ shown: ['a', 'b'], incoming: ['c', 'b', 'a'], initial: true }).order).toEqual(['c', 'b', 'a']);
  });

  it('never moves rows already on screen when the server re-sorts them', () => {
    const m = mergeLive({ shown: ['a', 'b', 'c'], incoming: ['c', 'a', 'b'] });
    expect(m.order).toEqual(['a', 'b', 'c']);
    expect(m.inserted).toEqual([]);
  });

  it('places a new draft above the one you selected (newest first): the selected row keeps its place among the others', () => {
    // the Outbox sorts newest first; d2 is selected
    const m = mergeLive({ shown: ['d1', 'd2', 'd3'], incoming: ['d9', 'd1', 'd2', 'd3'] });
    expect(m.order).toEqual(['d9', 'd1', 'd2', 'd3']);
    expect(m.inserted).toEqual(['d9']);
    expect(m.order.indexOf('d2')).toBeGreaterThan(m.order.indexOf('d1'));
  });

  it('places an arrival before the next row the server puts after it (its natural place), else at the end', () => {
    expect(mergeLive({ shown: ['a', 'c'], incoming: ['a', 'b', 'c'] }).order).toEqual(['a', 'b', 'c']);
    expect(mergeLive({ shown: ['a', 'c'], incoming: ['a', 'c', 'z'] }).order).toEqual(['a', 'c', 'z']);
    // consecutive arrivals keep the server's order between them
    expect(mergeLive({ shown: ['a'], incoming: ['x', 'y', 'a'] }).order).toEqual(['x', 'y', 'a']);
  });

  it("anchors to the shown order, not the server's, when the server re-sorted too", () => {
    // c moved to the top on the server; x arrives between c and a there: it lands before a, and c keeps its place
    expect(mergeLive({ shown: ['a', 'b', 'c'], incoming: ['c', 'x', 'a', 'b'] }).order).toEqual(['x', 'a', 'b', 'c']);
  });

  it('a new item first in the server order goes on top even when the server re-sorted the rest (a draft revised meanwhile)', () => {
    // d3 was revised (newest-first: it moved to the top on the server, stays put on screen); d9 is new
    expect(mergeLive({ shown: ['d1', 'd2', 'd3'], incoming: ['d9', 'd3', 'd1', 'd2'] }).order).toEqual(['d9', 'd1', 'd2', 'd3']);
    // several new ones stay together, in the server's order
    expect(mergeLive({ shown: ['d1', 'd2', 'd3'], incoming: ['n1', 'n2', 'd3', 'd1', 'd2'] }).order).toEqual(['n1', 'n2', 'd1', 'd2', 'd3']);
  });

  it("can append instead ('end')", () => {
    expect(mergeLive({ shown: ['a', 'b'], incoming: ['n', 'a', 'b'], place: 'end' }).order).toEqual(['a', 'b', 'n']);
  });

  it('a list that was empty still marks what arrives (it is not a new list)', () => {
    expect(mergeLive({ shown: [], incoming: ['a'] })).toMatchObject({ order: ['a'], inserted: ['a'] });
  });
});

describe('the "N new · Show" pill', () => {
  it('holds arrivals while you are scrolled down or interacting', () => {
    const m = mergeLive({ shown: ['a', 'b'], incoming: ['n', 'a', 'b'], hold: true });
    expect(m.order).toEqual(['a', 'b']);
    expect(m.held).toEqual(['n']);
    expect(m.inserted).toEqual([]);
  });

  it('holds a burst (more than 3 at once)', () => {
    const m = mergeLive({ shown: ['a'], incoming: ['n1', 'n2', 'n3', 'n4', 'a'] });
    expect(m.order).toEqual(['a']);
    expect(m.held).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('places everything held when you press Show, at the natural place, marked', () => {
    const m = mergeLive({ shown: ['a'], incoming: ['n1', 'n2', 'n3', 'n4', 'a'], held: ['n1', 'n2', 'n3', 'n4'], flush: true });
    expect(m.order).toEqual(['n1', 'n2', 'n3', 'n4', 'a']);
    expect(m.inserted).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(m.held).toEqual([]);
  });

  it('lets a few held arrivals slide in on their own when the hold ends', () => {
    const m = mergeLive({ shown: ['a'], incoming: ['n1', 'a'], held: ['n1'] });
    expect(m.order).toEqual(['n1', 'a']);
    expect(m.held).toEqual([]);
  });

  it('an empty list shows what arrives at once, however many (nothing on screen to disturb)', () => {
    expect(mergeLive({ shown: [], incoming: ['n1', 'n2', 'n3', 'n4', 'n5'], hold: true })).toMatchObject({ order: ['n1', 'n2', 'n3', 'n4', 'n5'], held: [] });
  });

  it('drops a held arrival that left before it was shown', () => {
    expect(mergeLive({ shown: ['a'], incoming: ['a'], held: ['n1'], hold: true }).held).toEqual([]);
  });
});

describe('rows that leave', () => {
  it('a row that left elsewhere stays in place (fading out)', () => {
    const m = mergeLive({ shown: ['a', 'b', 'c'], incoming: ['a', 'c'], linger: () => true });
    expect(m.order).toEqual(['a', 'b', 'c']);
    expect(m.lingering).toEqual(['b']);
    expect(m.dropped).toEqual([]);
  });

  it('a row you removed yourself leaves at once', () => {
    const m = mergeLive({ shown: ['a', 'b', 'c'], incoming: ['a', 'c'], linger: () => false });
    expect(m.order).toEqual(['a', 'c']);
    expect(m.dropped).toEqual(['b']);
  });

  it('an arrival never anchors to a row that is fading out', () => {
    const m = mergeLive({ shown: ['a', 'b'], incoming: ['n', 'a'], linger: (id) => id === 'b' });
    expect(m.order).toEqual(['n', 'a', 'b']);
  });

  it('a row that comes back from elsewhere returns to its old place, marked', () => {
    const left = departuresOf(['a', 'b', 'c'], ['a', 'c']);
    const m = mergeLive({ shown: ['a', 'c'], incoming: ['a', 'b', 'c'], returning: left, markReturning: () => true });
    expect(m.order).toEqual(['a', 'b', 'c']);
    expect(m.inserted).toEqual(['b']);
  });

  it('a row that comes back (Undo) returns to its old place, unmarked, even while arrivals are held', () => {
    const left = departuresOf(['a', 'b', 'c'], ['a', 'c']);
    expect(left.get('b')).toBe('c');
    const m = mergeLive({ shown: ['a', 'c'], incoming: ['a', 'b', 'c', 'n'], returning: left, hold: true });
    expect(m.order).toEqual(['a', 'b', 'c']);
    expect(m.inserted).toEqual([]);
    expect(m.held).toEqual(['n']);
  });
});

describe('selection survives', () => {
  it('stays on its row when the row is still there (arrivals above do not move it)', () => {
    expect(survivorOf(['a', 'b'], ['n', 'a', 'b'], 'b')).toBeNull();
  });

  it('moves to the next row when the selected one leaves, else the previous one', () => {
    expect(survivorOf(['a', 'b', 'c'], ['a', 'c'], 'b')).toBe('c');
    expect(survivorOf(['a', 'b', 'c'], ['a', 'b'], 'c')).toBe('b');
    expect(survivorOf(['a'], [], 'a')).toBeNull();
  });
});

describe('a field you are editing (conflict on edit)', () => {
  it('updates in place when nothing is unsaved', () => {
    expect(mergeField({ base: 'Old', local: 'Old', server: 'New', editing: false })).toEqual({ kind: 'adopt', value: 'New' });
  });

  it('waits while the field has focus and nothing was typed (it takes the value when you leave)', () => {
    expect(mergeField({ base: 'Old', local: 'Old', server: 'New', editing: true })).toEqual({ kind: 'wait' });
  });

  it('keeps your text and reports "changed elsewhere" when you typed and the server moved', () => {
    expect(mergeField({ base: 'Old', local: 'Mine', server: 'Theirs', editing: true })).toEqual({ kind: 'conflict', mine: 'Mine', theirs: 'Theirs' });
    // unsaved text after the field lost focus is still yours
    expect(mergeField({ base: 2, local: 3, server: 4, editing: false })).toEqual({ kind: 'conflict', mine: 3, theirs: 4 });
  });

  it('no conflict when the server now agrees with you, or did not change', () => {
    expect(mergeField({ base: 'Old', local: 'Same', server: 'Same', editing: true })).toEqual({ kind: 'agree', value: 'Same' });
    expect(mergeField({ base: 'Old', local: 'Mine', server: 'Old', editing: true })).toEqual({ kind: 'same' });
  });

  it('uses the given equality (trimmed text)', () => {
    expect(mergeField({ base: 'a', local: 'b ', server: ' b', editing: true, equal: (x, y) => x.trim() === y.trim() })).toEqual({ kind: 'agree', value: ' b' });
  });
});
