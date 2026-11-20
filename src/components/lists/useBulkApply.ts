'use client';
/**
 * Explicit "Apply" for multi-select edits (UI-SPEC §8: bulk edits = explicit Apply + Undo).
 * Optimistic like everything else: rows leave (or move) immediately, every item gets its own request,
 * and ONE toast offers Undo for the whole batch. Partial failures put the failed rows back and say so.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { ItemsPayload, WorkItem } from '@/contract';
import { api, ApiError } from '@/client/api';
import { toast } from '@/client/toast';
import { bulkTitle, planBulk, type BulkOp } from './bulk';
import { withInitiative, withoutItems } from './cache-patches';

export function useBulkApply() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const apply = useCallback(
    async (op: BulkOp, items: WorkItem[]): Promise<{ ok: number; failed: number }> => {
      if (!items.length) return { ok: 0, failed: 0 };
      const requests = planBulk(op, items);
      const ids = new Set(items.map((i) => i.id));
      await qc.cancelQueries({ queryKey: ['items'] });
      const snapshots = qc.getQueriesData<ItemsPayload>({ queryKey: ['items'] });
      for (const [key, data] of snapshots) {
        if (!data || !Array.isArray(data.items)) continue;
        qc.setQueryData(key, op.kind === 'move' ? withInitiative(data, ids, op.initiative) : withoutItems(data, ids));
      }
      setBusy(true);
      const results = await Promise.allSettled(
        requests.map((r) => (r.route === 'itemAction' ? api('itemAction', r.input) : api('patchItem', r.input))),
      );
      setBusy(false);

      const audits: string[] = [];
      let failed = 0;
      let firstError: string | null = null;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.auditId) audits.push(r.value.auditId);
        } else {
          failed++;
          firstError ??= r.reason instanceof ApiError ? r.reason.message : String(r.reason);
        }
      }
      const ok = results.length - failed;

      const refresh = () => Promise.all(['items', 'today', 'item'].map((t) => qc.invalidateQueries({ queryKey: [t] })));
      if (failed === results.length) for (const [key, data] of snapshots) qc.setQueryData(key, data);
      void refresh();

      if (ok > 0) {
        toast({
          key: 'bulk-apply',
          title: bulkTitle(op, ok),
          body: failed ? `${failed} couldn't be updated and are back in the list.` : undefined,
          undo: {
            run: async () => {
              // Newest first: undoing in reverse keeps field-by-field restores consistent.
              for (const id of [...audits].reverse()) await api('undoAudit', { params: { id }, body: {} });
            },
          },
        });
      }
      if (failed > 0 && ok === 0) {
        toast({ key: 'bulk-apply-err', title: `Couldn't apply to ${failed} ${failed === 1 ? 'item' : 'items'}`, body: `${firstError ?? 'Something went wrong'}. Nothing changed.`, tone: 'error', durationMs: null });
      }
      return { ok, failed };
    },
    [qc],
  );

  return { apply, busy };
}
