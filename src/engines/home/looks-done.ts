/**
 * LD-1: the one evidence line a likely-done item shows wherever it appears (Home's "Looks done: confirm" group,
 * Triage's Looks done group, Work). Pure, so the server engine and the client pages share it.
 *
 * The closure engine keeps the reason of the evidence that made the item look done, with the writer's prefix:
 * `done_check:` (the completion pass), `triage:` (the Slack triage pass), `delivered_with_attachment: …;` (DLV-1).
 * The line drops those prefixes, speaks to the user ("Your reply…"), names an attachment, and says how long after
 * the ask the evidence came when the item's sources carry both times.
 */

const PREFIX = /^(?:done_check:|triage:|partial:|coerced_context\([^)]*\):)\s*/i;
const ATTACHMENT = /^delivered_with_attachment:\s*([^;]+);\s*/i;
const MAX = 160;

const YOU: Array<[RegExp, string]> = [
  // "My reply", "My DM reply", "My group DM reply", "My thread reply" (LD-1c)
  [/^my\b/i, 'Your'],
  [/^i replied\b/i, 'You replied'],
  [/^i sent\b/i, 'You sent'],
  [/^i shared\b/i, 'You shared'],
  [/^i posted\b/i, 'You posted'],
  [/^i confirmed\b/i, 'You confirmed'],
  [/^me:\s*/i, 'You: '],
];

/** The reason without its writer's prefixes, in the user's words. */
export function cleanLikelyReason(reason: string | null | undefined, o: { fallback?: string; max?: number; capitalize?: boolean } = {}): string {
  let r = (reason ?? '').trim();
  let attachment = '';
  const a = ATTACHMENT.exec(r);
  if (a) {
    attachment = a[1]!.trim();
    r = r.slice(a[0].length);
  }
  for (let i = 0; i < 3 && PREFIX.test(r); i++) r = r.replace(PREFIX, '');
  const cap = o.capitalize !== false;
  for (const [re, to] of YOU) if (re.test(r)) {
    r = r.replace(re, cap ? to : to.charAt(0).toLowerCase() + to.slice(1));
    break;
  }
  r = r.replace(/\s+/g, ' ').trim();
  if (r && cap) r = r.charAt(0).toUpperCase() + r.slice(1);
  if (attachment) r = r ? `${r} · with ${attachment.replace(/^file\s+/i, '')}` : `Sent ${attachment.replace(/^file\s+/i, '')}`;
  if (!r) r = o.fallback ?? 'Your reply looks like it finished this';
  const max = o.max ?? MAX;
  return r.length > max ? `${r.slice(0, max - 1).trimEnd()}…` : r;
}

/** "16 min", "3 h", "2 d". */
export function gapLabel(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

interface LooksDoneItem {
  likelyDone: { reason: string } | null;
  sources: Array<{ at?: string }>;
  createdAt: string;
}

/** The evidence line: what made it look done, and how long after the ask (when both times are known). */
export function looksDoneEvidence(w: LooksDoneItem): string {
  const line = cleanLikelyReason(w.likelyDone?.reason);
  const times = w.sources
    .map((s) => (s.at ? Date.parse(s.at) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return line;
  const gap = times[times.length - 1]! - times[0]!;
  return gap >= 60_000 && gap <= 30 * 86_400_000 ? `${line} · ${gapLabel(gap)} after the ask` : line;
}
