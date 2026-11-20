/**
 * A handled highlight shows ONE state: where it went. Promote → "In Triage" (a suggestion waiting there; the verb
 * opens that row in Triage), Make task (or a promotion you accepted) → "Task made" (the verb opens the task). The
 * plain "Promoted" word is left for an item the app can no longer read.
 *
 * `kind` is this session's own action (highlight-undo), which answers before the server's `promotedAs` lands.
 */
import type { BriefHighlight } from '@/contract';

export type PromotedState = { word: string; open: { label: string; href: string } | { label: string; taskId: string } | null };

export function promotedState(h: Pick<BriefHighlight, 'status' | 'promotedWorkItemId' | 'promotedAs'>, kind?: 'promote' | 'task' | 'dismiss' | null): PromotedState | null {
  if (h.status !== 'promoted') return null;
  const as = h.promotedAs ?? (kind === 'task' ? 'task' : kind === 'promote' ? 'triage' : undefined);
  const id = h.promotedWorkItemId;
  if (as === 'triage') return { word: 'In Triage', open: { label: 'Open in Triage', href: id ? `/triage?item=${encodeURIComponent(id)}` : '/triage' } };
  if (as === 'task') return { word: 'Task made', open: id ? { label: 'Open task', taskId: id } : null };
  return { word: 'Promoted', open: id ? { label: 'Open task', taskId: id } : { label: 'Open Triage', href: '/triage' } };
}
