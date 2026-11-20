/**
 * What the Briefs reading pane shows (B-073a). While the brief LIST is still pending there is no brief to
 * pick yet, so the pane stays a neutral loading state; "Pick a brief" is only for a loaded list with nothing
 * selected. A selected brief whose payload hasn't arrived is loading too, never "Pick a brief".
 */
export type ReadingPaneState = 'loading' | 'error' | 'empty' | 'ready';

export function readingPaneState(f: { listPending: boolean; openId: string | null; briefPending: boolean; briefError: boolean }): ReadingPaneState {
  if (f.listPending) return 'loading';
  if (!f.openId) return 'empty';
  if (f.briefError) return 'error';
  if (f.briefPending) return 'loading';
  return 'ready';
}

/** Feeds `usePanelState` (which keeps the dev toolbar's forced states). */
export function readingPaneFlags(s: ReadingPaneState) {
  return { loading: s === 'loading', error: s === 'error', empty: s === 'empty' };
}
