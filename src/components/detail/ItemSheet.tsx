'use client';
/**
 * ItemSheet: the non-modal side sheet around ItemDetail (UI-SPEC §2 drill model). "n of N" with j/k,
 * Esc returns focus to the exact row, ⇧Enter opens the full page, and it docks as a column ≥ 2400 px.
 * The breadcrumb sits in the sheet title; the editable title leads the body.
 *
 * Hosts that already render their own <SideSheet> use `renderItemSheet(id)` for the body instead.
 */
import type { WorkItemDetail } from '@/contract';
import { useApi } from '@/client/hooks';
import { SideSheet } from '@/ui';
import { Breadcrumb } from './header/ItemHeader';
import { ItemDetail } from './ItemDetail';
import { navigate } from '@/components/shell/router';

export interface ItemSheetProps {
  itemId: string | null;
  onClose: () => void;
  /** 0-based position and list length for "n of N"; j/k call onPrev/onNext. */
  index?: number;
  total?: number;
  onPrev?: () => void;
  onNext?: () => void;
  returnFocus?: () => HTMLElement | null;
  onOpenItem?: (id: string, mode: 'sheet' | 'page') => void;
}

export function ItemBreadcrumb({ itemId }: { itemId: string }) {
  const q = useApi('getItem', { params: { id: itemId } });
  const item = (q.data as WorkItemDetail | undefined)?.item;
  return item ? <Breadcrumb item={item} className="text-body" /> : <span className="text-muted">Task</span>;
}

export function ItemSheet({ itemId, onClose, index, total, onPrev, onNext, returnFocus, onOpenItem }: ItemSheetProps) {
  return (
    <SideSheet
      open={!!itemId}
      onClose={onClose}
      eyebrow="Task"
      title={itemId ? <ItemBreadcrumb itemId={itemId} /> : 'Task'}
      label="Task detail"
      index={index}
      total={total}
      onPrev={onPrev}
      onNext={onNext}
      returnFocus={returnFocus}
      onOpenPage={itemId ? () => navigate(`/work/${itemId}`) : undefined}
      storageKey="cc:item-sheet-width"
    >
      {itemId ? <ItemDetail itemId={itemId} variant="sheet" breadcrumb={false} onOpenItem={onOpenItem} /> : null}
    </SideSheet>
  );
}
