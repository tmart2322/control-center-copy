/**
 * Item detail + initiative (P2, v2 restyle by V2-DETAIL). Page lanes import from here:
 *
 *   // The v2 docked right panel (V2-SHELL registers it for 'work_item'):
 *   registerDetailRenderer('work_item', (e) => renderItemPanel(e.id));
 *   // 'draft' is registered by this module itself (lib/register.ts): Today, Home and the read-in's "Open draft" call
 *   // openDetails({ kind: 'draft', id }) and land in the composer, in the panel.
 *   // Inside your own <SideSheet title=… onClose=…> (Today, Work, Triage):
 *   {renderItemSheet(activeId)}
 *   // Or the whole sheet (breadcrumb title, n of N, ⇧Enter → page):
 *   <ItemSheet itemId={activeId} onClose={…} index={i} total={n} onPrev={…} onNext={…} returnFocus={…} />
 */
import { createElement, type ReactElement } from 'react';
// Registers the 'draft' renderer in the browser (see lib/register.ts).
import './lib/register';
import { DraftPanel } from './DraftPanel';
import { ItemDetail } from './ItemDetail';

export { ItemDetail, type ItemDetailProps, type ItemDetailVariant, type DetailTab } from './ItemDetail';
export { ItemSheet, ItemBreadcrumb, type ItemSheetProps } from './ItemSheet';
export { WorkItemPage } from './WorkItemPage';
export { WorkItemPanelPreview } from './WorkItemPanelPreview';
export { DraftPanel, type DraftPanelProps } from './DraftPanel';
export { ReplyingTo, ReplyingToView, replyingToLine, type ReplyingToProps } from './ReplyingTo';
export { InitiativePage } from './initiative/InitiativePage';
export { Breadcrumb } from './header/ItemHeader';

/** The seam P1 (Today) and P3 (lists) render inside their SideSheet: `<ItemDetail itemId={id} variant="sheet"/>`. */
export const renderItemSheet = (id: string): ReactElement => createElement(ItemDetail, { itemId: id, variant: 'sheet' });

/** The v2 docked panel's Details renderer for work items: `<ItemDetail itemId={id} variant="panel"/>` (520 / 600 px). */
export const renderItemPanel = (id: string): ReactElement => createElement(ItemDetail, { key: id, itemId: id, variant: 'panel' });

/** The v2 docked panel's Details renderer for drafts: the composer with the footer primary (Send / Push as draft). */
export const renderDraftPanel = (id: string): ReactElement => createElement(DraftPanel, { key: id, draftId: id });
