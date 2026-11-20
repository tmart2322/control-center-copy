/**
 * The Combobox's keyboard, as a pure step (tested in node: src/ui/ui.test.ts, tests/time/opp-picker.test.ts).
 *
 * Closed trigger: ↓ / ↑ / Alt+↓ / Enter / Space open it; a printable key opens it with that key as the query.
 * Open input: ↓ / ↑ move the active option (clamped, disabled options skipped), PageDown / PageUp jump 8,
 * Enter picks the active option, Esc closes (the trigger gets focus back), Tab closes. Any other key types.
 */
export type ComboStep =
  | { kind: 'move'; active: number }
  | { kind: 'pick'; index: number }
  | { kind: 'close'; reason: 'escape' | 'tab' }
  | { kind: 'none' };

export interface ComboKeyEvent {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const PAGE = 8;

/** The next enabled index from `from` in direction `dir` (clamped at the ends; `from` itself if none). */
function nextEnabled(disabled: readonly boolean[], from: number, dir: 1 | -1, steps = 1): number {
  const n = disabled.length;
  let at = from;
  let moved = 0;
  for (let i = from + dir; i >= 0 && i < n && moved < steps; i += dir) {
    if (!disabled[i]) {
      at = i;
      moved++;
    }
  }
  return at;
}

/** The first enabled option (or -1 when there is none). */
export function firstEnabled(disabled: readonly boolean[]): number {
  return disabled.findIndex((d) => !d);
}

/** One key in the open combobox's input. `disabled[i]` says whether option i can be picked. */
export function comboKey(e: ComboKeyEvent, active: number, disabled: readonly boolean[]): ComboStep {
  const n = disabled.length;
  const cur = active >= 0 && active < n ? active : -1;
  switch (e.key) {
    case 'ArrowDown':
      if (!n) return { kind: 'none' };
      return { kind: 'move', active: cur < 0 ? Math.max(0, firstEnabled(disabled)) : nextEnabled(disabled, cur, 1) };
    case 'ArrowUp':
      if (!n) return { kind: 'none' };
      return { kind: 'move', active: cur < 0 ? Math.max(0, firstEnabled(disabled)) : nextEnabled(disabled, cur, -1) };
    case 'PageDown':
      return n ? { kind: 'move', active: nextEnabled(disabled, Math.max(cur, -1), 1, PAGE) } : { kind: 'none' };
    case 'PageUp':
      return n ? { kind: 'move', active: nextEnabled(disabled, cur < 0 ? n : cur, -1, PAGE) } : { kind: 'none' };
    case 'Enter':
      return cur >= 0 && !disabled[cur] ? { kind: 'pick', index: cur } : { kind: 'none' };
    case 'Escape':
      return { kind: 'close', reason: 'escape' };
    case 'Tab':
      return { kind: 'close', reason: 'tab' };
    default:
      return { kind: 'none' };
  }
}

/** A key on the closed trigger: open (with the typed character as the first query), or leave it to the browser. */
export function comboTriggerKey(e: ComboKeyEvent): { open: false } | { open: true; query: string } {
  if (e.ctrlKey || e.metaKey) return { open: false };
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return { open: true, query: '' };
  if (e.key.length === 1 && e.key !== ' ' && !e.altKey) return { open: true, query: e.key };
  return { open: false };
}
