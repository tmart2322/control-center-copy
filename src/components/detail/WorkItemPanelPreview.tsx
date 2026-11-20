'use client';
/**
 * /work/[id]?variant=panel: a preview of the v2 docked right panel's Details tab, for review and
 * screenshots until V2-SHELL renders the real panel (BUILD-V2 "Seams"). It only frames
 * <ItemDetail variant="panel"/> at the panel's widths (520 px, 600 px at ≥ 2,400 px) beside a stand-in for
 * the condensed page. The real panel chrome (tabs, ⌘J, Esc, URL sync) belongs to V2-SHELL.
 */
import { useEffect } from 'react';
import { IconButton } from '@/ui';
import { DraftPanel } from './DraftPanel';
import { ItemDetail } from './ItemDetail';
import { navigate } from '@/components/shell/router';

/** `draftId`: preview the draft renderer (the read-in's suggested reply, ?variant=panel&draft=<id>). */
export function WorkItemPanelPreview({ id, draftId }: { id: string; draftId?: string | null }) {
  const close = () => navigate(`/work/${encodeURIComponent(id)}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"],[role="menu"]')) navigate(`/work/${encodeURIComponent(id)}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  return (
    <div className="flex h-full min-h-0" data-panel-preview>
      <div className="grid min-w-0 flex-1 place-items-center p-6">
        <p className="max-w-[40ch] text-center text-body text-muted">The page condenses here while the panel is open. This is a preview frame for the Details tab.</p>
      </div>
      <aside aria-label="Details" className="flex h-full min-h-0 w-[520px] shrink-0 flex-col border-l border-line bg-surface min-[2400px]:w-[600px]" data-panel-frame>
        <div role="tablist" aria-label="Panel" className="flex h-14 shrink-0 items-center gap-1 border-b border-line pr-3 pl-4">
          <span role="tab" aria-selected="true" className="inline-flex h-9 items-center rounded-md bg-selected px-3 text-body font-bold text-fg-heading">
            Details
          </span>
          <span role="tab" aria-selected="false" aria-disabled="true" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-body font-bold text-muted">
            Assistant <kbd className="rounded-sm border border-line bg-surface-sunken px-1.5 text-micro text-muted">⌘J</kbd>
          </span>
          <span className="ml-auto">
            <IconButton icon="close" label="Close panel (Esc)" size="md" onClick={close} />
          </span>
        </div>
        <div className="min-h-0 flex-1">
          {draftId ? (
            <DraftPanel key={draftId} draftId={draftId} onOpenItem={(item) => navigate(`/work/${encodeURIComponent(item)}?variant=panel`)} />
          ) : (
            <ItemDetail
              key={id}
              itemId={id}
              variant="panel"
              onOpenItem={(other, mode) => navigate(mode === 'page' ? `/work/${encodeURIComponent(other)}` : `/work/${encodeURIComponent(other)}?variant=panel`)}
              onOpenDraft={(d) => navigate(`/work/${encodeURIComponent(id)}?variant=panel&draft=${encodeURIComponent(d)}`)}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
