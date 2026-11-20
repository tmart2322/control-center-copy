/**
 * The feedback post (D-56), in Slack mrkdwn: a title line, kind, version / sha / persona / page, summary, steps,
 * expected / actual, the diagnosis, and the reporter's first name only. Pure; the text it gets is already scrubbed.
 */
import type { FeedbackReport } from '@/contract';

const line = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Slack mrkdwn escapes: the three entities Slack itself needs. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Ada Placeholder" → "Ada"; empty stays empty. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function formatFeedbackMessage(r: FeedbackReport, reporter: string): string {
  const kind = r.kind === 'idea' ? 'Idea' : 'Bug';
  const ctx = [`v${r.context.version || '?'}`, r.context.sha ? `\`${r.context.sha.slice(0, 7)}\`` : null, r.context.persona ? `persona ${r.context.persona}` : null, r.context.page ? `page ${esc(line(r.context.page))}` : null, r.context.entityKind ? `looking at: ${r.context.entityKind.replace(/_/g, ' ')}` : null]
    .filter(Boolean)
    .join(' · ');
  const out: string[] = [`${r.kind === 'idea' ? ':bulb:' : ':beetle:'} *${kind}: ${esc(line(r.title))}*`, ctx];
  if (r.summary.trim()) out.push('', '*Summary*', esc(r.summary.trim()));
  if (r.steps.length) out.push('', '*Steps*', ...r.steps.map((s, i) => `${i + 1}. ${esc(line(s))}`));
  if (r.expected.trim() || r.actual.trim()) {
    out.push('');
    if (r.expected.trim()) out.push(`*Expected:* ${esc(line(r.expected))}`);
    if (r.actual.trim()) out.push(`*Actual:* ${esc(line(r.actual))}`);
  }
  const d = r.diagnosis;
  if (d.cause.trim() || d.files.length) {
    out.push('', `*Diagnosis* (${d.confidence} confidence)`);
    if (d.cause.trim()) out.push(esc(d.cause.trim()));
    if (d.files.length) out.push(`Files: ${d.files.map((f) => `\`${f.replace(/`/g, '')}\``).join(', ')}`);
  }
  const who = firstName(reporter);
  if (who) out.push('', `_Reported by ${esc(who)}_`);
  return out.join('\n');
}
