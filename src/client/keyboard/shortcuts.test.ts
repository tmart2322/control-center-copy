/**
 * B-074: the documented keymap carries no v1 rows. The frame's groups (Anywhere, Go to) come from the
 * shell only; this table holds page-level keys, and nothing in it or the cheat sheet advertises a chord
 * that no longer works.
 */
import { describe, expect, it } from 'vitest';
import * as keyboard from '@/client/keyboard';
import { cheatSheetGroups } from '@/components/shell/CheatSheet';
import { NAV_DESTINATIONS } from '@/components/shell/nav';
import { SHORTCUT_GROUPS } from './shortcuts';

describe('documented shortcuts (B-074)', () => {
  it('holds no frame-owned or v1 groups and no `g` chords', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.id)).toEqual(['lists', 'day', 'composer', 'chat']);
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.keys));
    expect(keys.some((k) => /^g /.test(k))).toBe(false);
    expect(keys).not.toContain('alt+1'); // status-rail lane jumps are gone
    expect('NAV_CHORDS' in keyboard).toBe(false);
  });

  it('the day-timeline zoom keys collide with no list, frame or browser-zoom key', () => {
    const day = SHORTCUT_GROUPS.find((g) => g.id === 'day')!.items.flatMap((i) => i.keys.split('|'));
    const others = cheatSheetGroups()
      .filter((g) => g.id !== 'day')
      .flatMap((g) => g.items.flatMap((i) => i.keys.split('|')));
    for (const k of ['=', '+', '-', '0']) {
      expect(day).toContain(k);
      expect(others).not.toContain(k);
    }
    expect(day).not.toContain('mod+='); // ⌘= / ⌘- stay the browser's page zoom
  });

  it('says Details, not side sheet', () => {
    const labels = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.label)).join(' · ');
    expect(labels).not.toMatch(/side sheet|right rail|day column/i);
    expect(labels).toContain('Open in Details');
  });

  it('the cheat sheet’s Go to group is the shell’s nav, one row per chord', () => {
    const groups = cheatSheetGroups();
    expect(groups.map((g) => g.id)).toEqual(['global', 'goto', 'lists', 'day', 'composer', 'chat']);
    const goto = groups.find((g) => g.id === 'goto')!;
    expect(goto.items).toEqual(NAV_DESTINATIONS.map((n) => ({ keys: n.chord, label: n.label })));
    const by = new Map(goto.items.map((i) => [i.label, i.keys]));
    expect(by.get('Home')).toBe('g h');
    expect(by.get('Today')).toBe('g y');
    expect(by.get('Assistant')).toBe('g c');
    const allChords = groups.flatMap((g) => g.items.map((i) => i.keys)).filter((k) => /^g /.test(k));
    expect(new Set(allChords).size).toBe(allChords.length);
  });
});
