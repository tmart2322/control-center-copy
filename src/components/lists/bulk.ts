/**
 * Bulk edit planning (UI-SPEC §8: "Bulk edits (multi-select): explicit Apply + Undo"). Pure: turns the
 * chosen operation + selected items into the exact per-item requests the Apply button will send.
 */
import type { ItemActionRequest, Resolution, WorkItem } from '@/contract';

export type BulkOp =
  | { kind: 'done' }
  | { kind: 'snooze'; until: string }
  | { kind: 'resolve'; resolution: Resolution; note?: string }
  | { kind: 'move'; initiative: { id: string; label: string } | null };

export type BulkRequest =
  | { route: 'itemAction'; id: string; input: { params: { id: string; verb: 'done' | 'snooze' | 'resolve' }; body: ItemActionRequest } }
  | { route: 'patchItem'; id: string; input: { params: { id: string }; body: { ifVersion: number; patch: { initiativeId: string | null } } } };

export function planBulk(op: BulkOp, items: Pick<WorkItem, 'id' | 'version'>[]): BulkRequest[] {
  return items.map((it): BulkRequest => {
    switch (op.kind) {
      case 'done':
        return { route: 'itemAction', id: it.id, input: { params: { id: it.id, verb: 'done' }, body: { ifVersion: it.version } } };
      case 'snooze':
        return { route: 'itemAction', id: it.id, input: { params: { id: it.id, verb: 'snooze' }, body: { ifVersion: it.version, until: op.until } } };
      case 'resolve':
        return {
          route: 'itemAction',
          id: it.id,
          input: { params: { id: it.id, verb: 'resolve' }, body: { ifVersion: it.version, resolution: op.resolution, ...(op.note ? { detail: { note: op.note } } : {}) } },
        };
      case 'move':
        return { route: 'patchItem', id: it.id, input: { params: { id: it.id }, body: { ifVersion: it.version, patch: { initiativeId: op.initiative?.id ?? null } } } };
    }
  });
}

/** Toast copy for a finished bulk apply ("Marked 3 done"). */
export function bulkTitle(op: BulkOp, n: number): string {
  const things = `${n} ${n === 1 ? 'item' : 'items'}`;
  switch (op.kind) {
    case 'done':
      return `Marked ${things} done`;
    case 'snooze':
      return `Snoozed ${things}`;
    case 'resolve':
      return `Resolved ${things}`;
    case 'move':
      return op.initiative ? `Moved ${things} to ${op.initiative.label}` : `Removed ${things} from their initiative`;
  }
}

/** Does this op take the items out of the current (open) tab? */
export function leavesList(op: BulkOp): boolean {
  return op.kind !== 'move';
}

export const BULK_RESOLUTIONS: Array<{ value: Resolution; label: string }> = [
  { value: 'done_by_me', label: 'Done by me' },
  { value: 'not_needed', label: 'No longer needed' },
  { value: 'declined', label: 'Declined' },
];
