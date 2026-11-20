/** Small display formatters shared by primitives (pure). */

/** 45 → "45m", 100 → "1h40m", 120 → "2h", 0 → "0m". */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, '0')}m` : `${h}h`;
}

/** "10:15" in the given IANA zone (24 h, the cockpit's convention). */
export function fmtClock(at: Date | string, timeZone?: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d);
}

/** "Thu 5 Nov" in the given zone. */
export function fmtDay(at: Date | string, timeZone?: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(d);
}

/** "just now", "2s ago", "5m ago", "3h ago", "2d ago". */
export function fmtAgo(at: Date | string | number, now: Date | number = Date.now()): string {
  const t = typeof at === 'number' ? at : new Date(at).getTime();
  const n = typeof now === 'number' ? now : now.getTime();
  const s = Math.max(0, Math.round((n - t) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Signed minutes between two instants (b - a), rounded. */
export function minutesBetween(a: Date | string, b: Date | string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** "$0.42" */
export function fmtUsd(n: number): string {
  return `$${n < 100 ? n.toFixed(2) : n.toFixed(0)}`;
}

/** Initials for a letter avatar: "Dana Reyes" → "DR", "ACME" → "AC", "acme corp" → "AC". */
export function initials(label: string, max = 2): string {
  const words = label.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0]!.slice(0, max).toUpperCase();
  return words
    .slice(0, max)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
