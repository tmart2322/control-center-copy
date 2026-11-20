import { afterEach, describe, expect, it, vi } from 'vitest';
import { comboMatches, formatShortcut, isEditableTarget, parseCombo, parseSequence, sequenceKeys } from './keymap';
import { KeyManager } from './manager';

const ev = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: unknown = null) => ({ key, target, ...mods });

describe('keymap', () => {
  it('parses combos and chords', () => {
    expect(parseCombo('mod+k')).toMatchObject({ key: 'k', mod: true });
    expect(parseCombo('shift+Enter')).toMatchObject({ key: 'enter', shift: true });
    expect(parseSequence('g h').map((c) => c.key)).toEqual(['g', 'h']);
    expect(parseCombo('mod+,').key).toBe(',');
  });

  it('matches mod as ⌘ on mac and Ctrl elsewhere', () => {
    expect(comboMatches(parseCombo('mod+k'), ev('k', { metaKey: true }), true)).toBe(true);
    expect(comboMatches(parseCombo('mod+k'), ev('k', { ctrlKey: true }), true)).toBe(false);
    expect(comboMatches(parseCombo('mod+k'), ev('k', { ctrlKey: true }), false)).toBe(true);
  });

  it('requires exact shift for letters but ignores it for symbols', () => {
    expect(comboMatches(parseCombo('d'), ev('D', { shiftKey: true }), true)).toBe(false);
    expect(comboMatches(parseCombo('shift+d'), ev('D', { shiftKey: true }), true)).toBe(true);
    expect(comboMatches(parseCombo('?'), ev('?', { shiftKey: true }), true)).toBe(true);
    expect(comboMatches(parseCombo('space'), ev(' '), true)).toBe(true);
    expect(comboMatches(parseCombo('down'), ev('ArrowDown'), true)).toBe(true);
  });

  it('treats text fields as editable, but not checkboxes', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', getAttribute: () => 'textbox' })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
  });

  it('formats shortcuts for display', () => {
    expect(formatShortcut('mod+k')).toBe('⌘K');
    expect(formatShortcut('g h')).toBe('G then H');
    expect(sequenceKeys('shift+enter')).toEqual([['⇧', '↵']]);
    expect(formatShortcut('mod+k', false)).toBe('Ctrl+K');
  });
});

describe('KeyManager', () => {
  afterEach(() => vi.useRealTimers());

  it('fires global bindings and never single keys inside inputs', () => {
    const m = new KeyManager({ isMac: true });
    const c = vi.fn();
    const k = vi.fn();
    m.register('c', c);
    m.register('mod+k', k, { allowInInput: true });
    const input = { tagName: 'INPUT', type: 'text' };
    expect(m.handle(ev('c', {}, input)).handled).toBe(false);
    expect(c).not.toHaveBeenCalled();
    expect(m.handle(ev('k', { metaKey: true }, input)).handled).toBe(true);
    expect(k).toHaveBeenCalledOnce();
    m.handle(ev('c'));
    expect(c).toHaveBeenCalledOnce();
  });

  it('resolves g-chords within the timeout', () => {
    vi.useFakeTimers();
    const m = new KeyManager();
    const home = vi.fn();
    const work = vi.fn();
    m.register('g h', home);
    m.register('g w', work);
    expect(m.handle(ev('g'))).toMatchObject({ handled: true, pending: true });
    expect(m.pendingLabel).toBe('g');
    m.handle(ev('w'));
    expect(work).toHaveBeenCalledOnce();
    expect(home).not.toHaveBeenCalled();
    // Expired chord: the second key is a fresh press.
    m.handle(ev('g'));
    vi.advanceTimersByTime(1500);
    m.handle(ev('h'));
    expect(home).not.toHaveBeenCalled();
  });

  it('gives the top scope priority and lets modal scopes block global', () => {
    const m = new KeyManager();
    const globalJ = vi.fn();
    const listJ = vi.fn();
    const sheetJ = vi.fn();
    m.register('j', globalJ);
    m.register('j', listJ, { scope: 'list' });
    m.register('j', sheetJ, { scope: 'sheet' });
    m.handle(ev('j'));
    expect(globalJ).toHaveBeenCalledOnce();
    const popList = m.pushScope('list');
    m.handle(ev('j'));
    expect(listJ).toHaveBeenCalledOnce();
    const popSheet = m.pushScope('sheet');
    m.handle(ev('j'));
    expect(sheetJ).toHaveBeenCalledOnce();
    popSheet();
    popList();
    const c = vi.fn();
    m.register('c', c);
    const popModal = m.pushScope('dialog', { modal: true });
    expect(m.handle(ev('c')).handled).toBe(false);
    expect(c).not.toHaveBeenCalled();
    popModal();
    m.handle(ev('c'));
    expect(c).toHaveBeenCalledOnce();
  });

  it('passes the key on when a handler returns false', () => {
    const m = new KeyManager();
    const a = vi.fn(() => false);
    const b = vi.fn();
    m.register('z', b);
    m.register('z', a);
    m.handle(ev('z'));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('unregisters', () => {
    const m = new KeyManager();
    const f = vi.fn();
    const off = m.register('x', f);
    off();
    expect(m.handle(ev('x')).handled).toBe(false);
  });
});
