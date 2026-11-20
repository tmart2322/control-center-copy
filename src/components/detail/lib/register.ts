/**
 * Registers the v2 docked panel's Details renderer for drafts: Today, Home and the read-in's "Open draft" call
 * `openDetails({ kind: 'draft', id })` and land in the composer, in the panel (same autosave, preview, confirm
 * and undo as everywhere else). Imported for its side effect by the detail barrel and by ItemDetail.
 *
 * Browser only: server components import the detail barrel too (app/work/[id], app/initiatives/[id]), and
 * there the shell's client module is only a reference that can't be called. The registry matters only in
 * the browser anyway. Uses the leaf `@/components/shell/panel` (the shell barrel would be an import cycle:
 * the shell imports the detail barrel for its work-item renderer).
 */
import { createElement } from 'react';
import { registerDetailRenderer } from '@/components/shell/panel';
import { DraftPanel } from '../DraftPanel';

if (typeof window !== 'undefined') {
  registerDetailRenderer('draft', (e) => createElement(DraftPanel, { key: e.id, draftId: e.id }));
}
