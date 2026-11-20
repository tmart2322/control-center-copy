'use client';
/**
 * What the v2 cards need from the surface they sit in (panel or full page): where "Open in composer"
 * goes, how an item opens, and which draft the page's composer pane holds. The base surface works
 * anywhere: the docked panel's Details tab once V2-SHELL renders it, otherwise the item page.
 */
import { createContext, useContext, useMemo } from 'react';
import type { Draft } from '@/contract';
import { api } from '@/client/api';
import { useRightPanel } from '@/components/shell/panel';
import { rightPanelLive } from './ChatResourceCard';
import { navigate } from '@/components/shell/router';

export interface AssistantSurface {
  /** Open a chat draft in the composer (page ≥ 2,400 px: its own pane; elsewhere: the item's composer). */
  openDraft(draft: Pick<Draft, 'id' | 'workItemId'>): void;
  /** The draft the page's composer pane shows (its in-thread card goes quiet). */
  openDraftId: string | null;
  /** Open a work item: Details in the right panel when it renders, else the item page. */
  openItem(item: { id: string; label: string }): void;
  /**
   * Queue a draft for approval in the Outbox (status drafting → ready). Undefined until the Outbox route
   * exists (blocker raised to BE-OUTBOX); the card then offers the composer instead.
   */
  addToOutbox?: (draft: Draft) => Promise<void> | void;
  /** Bring a message into view (In this thread → Review). */
  scrollToMessage(messageId: string): void;
}

export function scrollToMessage(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>(`[data-chat-root] [data-message-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.querySelector<HTMLElement>('[data-proposal]')?.focus({ preventScroll: true });
}

const NOOP_SURFACE: AssistantSurface = { openDraft: () => undefined, openDraftId: null, openItem: () => undefined, scrollToMessage };

export const AssistantSurfaceContext = createContext<AssistantSurface>(NOOP_SURFACE);

export function useAssistantSurface(): AssistantSurface {
  return useContext(AssistantSurfaceContext);
}

/** The surface outside the page's panes: Details in the right panel, else navigate. */
export function useBaseSurface(): AssistantSurface {
  const panel = useRightPanel();
  return useMemo<AssistantSurface>(
    () => ({
      openDraft: (d) => {
        if (d.workItemId && rightPanelLive()) return panel.openDetails({ kind: 'work_item', id: d.workItemId });
        navigate(d.workItemId ? `/work/${encodeURIComponent(d.workItemId)}` : '/outbox');
      },
      openDraftId: null,
      openItem: (i) => {
        if (rightPanelLive()) return panel.openDetails({ kind: 'work_item', id: i.id, label: i.label });
        navigate(`/work/${encodeURIComponent(i.id)}`);
      },
      addToOutbox: async (d) => void (await api('queueDraft', { params: { id: d.id }, body: { ifVersion: d.version } })),
      scrollToMessage,
    }),
    [panel],
  );
}
