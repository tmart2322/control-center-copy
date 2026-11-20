'use client';
/**
 * /work/[id]: the full-page item (UI-SPEC §2, §12). ItemDetail in its page variant fills the main region
 * (the page never scrolls; its columns do). Sibling tasks open in the v2 docked panel once V2-SHELL has
 * registered the work-item renderer (BUILD-V2 "Seams": never build your own detail overlay), and in the
 * item sheet until then.
 */
import { useCallback, useRef } from 'react';
import { useResumeSheet } from '@/client/resume';
import { useRightPanel } from '@/components/shell/panel';
import { ItemDetail } from './ItemDetail';
import { ItemSheet } from './ItemSheet';
import { panelAvailable } from './lib/panel-host';
import { navigate } from '@/components/shell/router';

export function WorkItemPage({ id }: { id: string }) {
  const panel = useRightPanel();
  const [sheet, setSheet] = useResumeSheet();
  const opener = useRef<HTMLElement | null>(null);
  const sheetId = sheet && sheet.kind === 'work_item' && sheet.id !== id ? sheet.id : null;

  const openItem = useCallback(
    (other: string, mode: 'sheet' | 'page') => {
      if (mode === 'page') {
        setSheet(null);
        navigate(`/work/${other}`);
        return;
      }
      if (panelAvailable()) return panel.openDetails({ kind: 'work_item', id: other });
      opener.current = document.activeElement as HTMLElement | null;
      setSheet({ id: other, kind: 'work_item' });
    },
    [setSheet, panel],
  );

  return (
    <div className="h-full min-h-0">
      <ItemDetail itemId={id} variant="page" onOpenItem={openItem} />
      <ItemSheet itemId={sheetId} onClose={() => setSheet(null)} returnFocus={() => opener.current} onOpenItem={openItem} />
    </div>
  );
}
