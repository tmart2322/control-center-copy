'use client';
/**
 * Recent client errors for a feedback report (D-56): window errors, unhandled rejections and console errors, the last
 * ten, each capped. Installed once by the topbar's Feedback button (it is on every page). Messages only,
 * never stacks or arguments' objects; the server scrubs them again before anything else sees them.
 */
const MAX = 10;
const CAP = 400;
const buf: string[] = [];
let installed = false;

const text = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v).slice(0, CAP);
  } catch {
    return Object.prototype.toString.call(v);
  }
};

/** "…/src/components/time/TimePage.tsx" → "TimePage.tsx" (no local paths in reports). */
const shortFile = (f: string) => f.split(/[/\\]/).pop()?.split('?')[0] ?? '';

export function pushClientError(message: string): void {
  const m = message.replace(/\s+/g, ' ').trim().slice(0, CAP);
  if (!m || buf[buf.length - 1] === m) return;
  buf.push(m);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

/** Oldest first, at most ten. */
export function recentClientErrors(): string[] {
  return [...buf];
}

/** Tests. */
export function clearClientErrors(): void {
  buf.length = 0;
}

export function installClientErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => pushClientError(`${e.message || text(e.error)}${e.filename ? ` (${shortFile(e.filename)}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => pushClientError(`Unhandled rejection: ${text(e.reason)}`));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      pushClientError(args.map(text).join(' '));
    } catch {
      /* never break logging */
    }
    original(...args);
  };
}
