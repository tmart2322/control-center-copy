/**
 * Remembers the audit id of the last change made to each brief highlight (promote, task, not relevant),
 * so the card's own "Undo" can reverse it. Kept for the browser session; after a reload the toast Undo
 * is long gone and the card says so instead of guessing.
 */
export type HighlightChange = { auditId: string; kind: 'promote' | 'task' | 'dismiss' };

const KEY = 'cc:briefs:highlight-audit';
const mem = new Map<string, HighlightChange>();

function read(): Record<string, HighlightChange> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, HighlightChange>;
  } catch {
    return {};
  }
}

export function rememberHighlightChange(id: string, change: HighlightChange): void {
  mem.set(id, change);
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: change }));
  } catch {
    /* private mode: memory only */
  }
}

export function forgetHighlightChange(id: string): void {
  mem.delete(id);
  try {
    const all = read();
    delete all[id];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function highlightChangeOf(id: string): HighlightChange | null {
  return mem.get(id) ?? read()[id] ?? null;
}
