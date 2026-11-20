/**
 * The documented page-level keymap (UI-SPEC §14, brief 08 §3.2): lists and cards, the composer and the
 * assistant. The `?` cheat sheet renders these after the frame's own groups, so every shortcut is
 * discoverable even on pages that haven't mounted its binding yet.
 *
 * The frame's groups ("Anywhere": ⌘K, ⌘J, Esc / `]` panel, `[` sidebar…, and "Go to": the `g` chords)
 * are NOT here: the shell owns them (src/components/shell/nav.ts · GlobalKeys.tsx · CheatSheet.tsx) and
 * is their one source of truth. B-074 retired the v1 rows that used to live here: `g h` → Today (Home is
 * `g h` now, Today `g y`, Assistant `g c`), the day column `[` and right rail `]`, and the status-rail
 * lane jumps (⌥1–6), none of which work in design v2.
 */

export interface ShortcutDoc {
  keys: string; // key spec(s), "|" separates alternatives: "j|down"
  label: string;
}

export interface ShortcutGroup {
  id: string;
  title: string;
  items: ShortcutDoc[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'lists',
    title: 'Lists and cards',
    items: [
      { keys: 'j|k', label: 'Move down / up' },
      { keys: '1|2|3', label: 'Jump to a Now card' },
      { keys: 'space', label: 'Expand in place' },
      { keys: 'enter', label: 'Open in Details' },
      { keys: 'shift+enter', label: 'Open full page' },
      { keys: 'escape', label: 'Close Details, back to the row' },
      { keys: 'mod+enter', label: 'Primary action' },
      { keys: 'e', label: 'Edit draft' },
      { keys: 'a', label: 'Accept' },
      { keys: 's', label: 'Snooze' },
      { keys: 'd', label: 'Done' },
      { keys: 'shift+d', label: 'Resolve with a reason' },
      { keys: 'n', label: 'Not now (asks why)' },
      { keys: 'x', label: 'Select' },
      { keys: 'o', label: 'Open source' },
      { keys: 'r', label: 'Apply re-rank' },
      { keys: 'w', label: 'Jump to what’s waiting on you (Today)' },
    ],
  },
  {
    id: 'day',
    title: 'Day timeline (Today)',
    items: [
      { keys: '=|+', label: 'Zoom in' },
      { keys: '-', label: 'Zoom out' },
      { keys: '0', label: 'Fit the whole day' },
      { keys: 'mod+scroll', label: 'Zoom with the wheel or a pinch' },
      { keys: 'alt+up|alt+down', label: 'Move a planned block 15 min' },
    ],
  },
  {
    id: 'composer',
    title: 'Composer',
    items: [
      { keys: 'mod+enter', label: 'Queue to Outbox (10 s undo)' },
      { keys: 'alt+p', label: 'Preview as recipient' },
      { keys: 'mod+shift+c', label: 'Switch channel' },
      { keys: 'mod+/', label: 'AI rewrite chips' },
    ],
  },
  {
    id: 'chat',
    title: 'Assistant',
    items: [
      { keys: '@', label: 'Add context' },
      { keys: '/', label: 'Slash commands' },
      { keys: 'mod+enter', label: 'Send' },
      { keys: 'escape', label: 'Back to the list' },
    ],
  },
];
