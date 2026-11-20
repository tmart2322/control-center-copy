/**
 * localStorage helpers for chat resume (UI-SPEC §1.10, §10): active thread, per-thread drafts, dock width,
 * collapsed state, model, and settled undo/apply results. Every call is SSR-safe and swallows quota or
 * privacy-mode errors: resume is best effort, never a crash.
 */
export const CHAT_KEYS = {
  thread: 'cc.chat.thread',
  draft: (threadId: string) => `cc.chat.draft:${threadId}`,
  width: 'cc.chat.width',
  collapsed: 'cc.chat.collapsed',
  model: 'cc.chat.model',
  actions: 'cc.chat.actions',
  localThreads: 'cc.chat.localThreads',
  /** What only the live turn knew (errors, tool args), per assistant message id; capped. */
  extras: 'cc.chat.extras',
} as const;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null): void {
  try {
    const s = store();
    if (!s) return;
    if (value === null || value === '') s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* quota / privacy mode */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, value === null || value === undefined ? null : JSON.stringify(value));
}
