/**
 * Closing a to-do withdraws its pending reply drafts (OUTBOX-W). Shared by the mock and db DataSources so both
 * withdraw the same drafts with the same reason, and by the UI to label a withdrawn draft.
 *
 * - Pending = `drafting`, `ready` or `failed`: nothing has been approved or sent. Approved, scheduled, sending, sent and
 *   staged drafts are on their way out and are never touched.
 * - Only message drafts (Slack, email) of a work item. Outbox *action* drafts (logging canvases, VDP field changes,
 *   feedback posts) are applied on their own surface and carry no work item; they are never withdrawn.
 * - A withdrawn draft is `discarded` with `rejectedReason` "Withdrawn: the to-do closed — <why it closed>". It leaves
 *   the Outbox and its count; reopening the to-do does not bring it back (the user can draft again).
 *
 * Pure: no database, no store. db: `src/server/datasource/db/store/withdraw.ts`; mock: `MockDataSource.tx`.
 */
import type { Draft, WorkItemRecord } from '@/contract';

export const WITHDRAWN_DRAFT_PREFIX = 'Withdrawn: the to-do closed';

/** Contract draft statuses a closing to-do withdraws. */
export const WITHDRAWABLE_DRAFT_STATUSES: ReadonlySet<Draft['status']> = new Set(['drafting', 'ready', 'failed']);

/** Contract states of a closed to-do (the db's `merged` reads as `dismissed`). */
export const CLOSED_ITEM_STATES: ReadonlySet<WorkItemRecord['state']> = new Set(['done', 'dismissed']);

export const isClosedItemState = (s: WorkItemRecord['state'] | null | undefined): boolean => !!s && CLOSED_ITEM_STATES.has(s);

/** A pending message draft of a work item: what a closing to-do withdraws. */
export function isWithdrawableDraft(d: Pick<Draft, 'status' | 'workItemId' | 'destination'>): boolean {
  return d.workItemId !== null && d.destination.kind !== 'action' && WITHDRAWABLE_DRAFT_STATUSES.has(d.status);
}

/** A draft the app withdrew because its to-do closed (not one the user rejected or discarded). */
export function isWithdrawnDraft(d: Pick<Draft, 'status' | 'rejectedReason'>): boolean {
  return d.status === 'discarded' && !!d.rejectedReason?.startsWith(WITHDRAWN_DRAFT_PREFIX);
}

const MAX_WHY = 160;

function clean(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_WHY ? `${t.slice(0, MAX_WHY - 1).trimEnd()}…` : t;
}

/**
 * "Withdrawn: the to-do closed — <why>": the item's close reason (status_reason), for a dismissed item its dismiss
 * note first; whitespace collapsed, at most 160 characters.
 */
export function withdrawnReason(item: Pick<WorkItemRecord, 'state' | 'closedReason'> & { dismissed?: { reason?: string | null; note?: string | null } | null }): string {
  const dismissed = item.state === 'dismissed';
  const code = dismissed && item.dismissed?.reason && item.dismissed.reason !== 'other' ? `dismissed (${item.dismissed.reason.replace(/_/g, ' ')})` : '';
  const why = (dismissed ? clean(item.dismissed?.note) : '') || clean(item.closedReason) || code || (dismissed ? 'dismissed' : 'done');
  return `${WITHDRAWN_DRAFT_PREFIX} — ${why}`;
}
