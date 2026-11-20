/**
 * Structured Outbox actions (`Destination.kind === 'action'`), shared by the UI, both DataSources and the Outbox.
 * Pure. An action's family is its prefix (`vdp.update_use_case` → `vdp`); every per-family map below is a
 * `Record<ActionFamily, …>`, so adding an action family to `OutboxAction` makes TypeScript list what it needs.
 */
import type { ActionChange, ActionDestination, OutboxAction, SourceKind, TipTapDoc } from '@/contract';
import { adminSurfaceOf } from '@/contract';
import { canvasActionPayload, canvasInputOf } from '@/lib/canvas/payload';
import { feedbackActionPayload, feedbackInputOf } from '@/lib/feedback/payload';
import { vdpActionPayload } from '@/lib/vdp/payload';

export type ActionFamily = OutboxAction extends `${infer F}.${string}` ? F : never;

export const actionFamily = (a: OutboxAction): ActionFamily => a.slice(0, a.indexOf('.')) as ActionFamily;

/** The app the action lands in, for labels ("Apply this change to VDP?"). */
const APP: Record<ActionFamily, string> = { vdp: 'VDP', slack_canvas: 'Slack', feedback: 'Slack' };
/** The source kind the Home draft line shows. */
const SOURCE: Record<ActionFamily, SourceKind> = { vdp: 'vdp', slack_canvas: 'slack', feedback: 'slack' };
/** SLDS utility icon. */
const ICON: Record<ActionFamily, string> = { vdp: 'record_update', slack_canvas: 'note', feedback: 'bug' };

export const actionApp = (a: OutboxAction): string => APP[actionFamily(a)];
export const actionSource = (a: OutboxAction): SourceKind => SOURCE[actionFamily(a)];
export const actionIcon = (a: OutboxAction): string => ICON[actionFamily(a)];

/** What an action item is, in words ("Logging canvas", "Forecast canvas", "VDP change", "Feedback"). */
export function actionKindLabel(dest: Pick<ActionDestination, 'action' | 'input'>): string {
  switch (actionFamily(dest.action)) {
    case 'vdp':
      return 'VDP change';
    case 'slack_canvas':
      return adminSurfaceOf({ destination: { kind: 'action', target: { label: '', url: null }, changes: [], text: null, action: dest.action, input: dest.input } }) === 'forecast' ? 'Forecast canvas' : 'Logging canvas';
    case 'feedback':
      return 'Feedback';
  }
}

/**
 * The draft panel's head for an action item: what it is and where it lands ("Logging canvas · Slack", "VDP change ·
 * VDP", "Feedback · #team-feedback"), never "Reply and approve · Email".
 */
export function actionHeading(dest: Pick<ActionDestination, 'action' | 'input'>): { kind: string; where: string } {
  const family = actionFamily(dest.action);
  if (family === 'feedback') {
    const f = feedbackInputOf(dest);
    return { kind: 'Feedback', where: f.channelName ? (f.channelName.startsWith('#') ? f.channelName : `#${f.channelName}`) : 'Slack' };
  }
  return { kind: actionKindLabel(dest), where: APP[family] };
}

/** The exact request payload of an action item: what the preview, the dry run and a live Apply all use. */
export function actionPayloadFor(dest: ActionDestination): Record<string, unknown> {
  const family = actionFamily(dest.action);
  switch (family) {
    case 'vdp':
      return vdpActionPayload(dest);
    case 'slack_canvas':
      return canvasActionPayload(dest);
    case 'feedback':
      return feedbackActionPayload(dest);
  }
}

const show = (v: ActionChange['before']) => (v === null || v === '' ? '(empty)' : String(v).replace(/\s+/g, ' ').slice(0, 120));

/** "Persona: (empty) → Data team" */
export const changeLine = (c: ActionChange): string => `${c.label}: ${show(c.before)} → ${show(c.after)}`;

/** The one-line summary (Outbox rows, search, the draft's plain text). */
export function actionSummary(dest: Pick<ActionDestination, 'changes' | 'text'>): string {
  const lines = dest.changes.map(changeLine);
  if (!lines.length && dest.text) lines.push(dest.text.split('\n').find((l) => l.trim())?.trim() ?? '');
  return lines.join('\n');
}

/** The read-only doc an action draft carries (its summary, then the long text), so text-based views keep working. */
export function actionDoc(dest: Pick<ActionDestination, 'changes' | 'text'>): TipTapDoc {
  const paras = [...dest.changes.map(changeLine), ...(dest.text ? dest.text.trim().split(/\n{2,}/) : [])];
  return {
    type: 'doc',
    content: paras.map((p) => ({ type: 'paragraph', content: p.split('\n').flatMap((line, i) => [...(i > 0 ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) })),
  };
}

/** A stable id of what the action targets (the db's `target_external_id`). */
export function actionTargetId(dest: ActionDestination): string | null {
  const i = dest.input as Record<string, unknown>;
  switch (actionFamily(dest.action)) {
    case 'vdp':
      // a new VDP or company has no id yet: its account's details key stands in (D-59)
      return (typeof i.useCaseId === 'string' && i.useCaseId) || (typeof i.vdpId === 'string' && i.vdpId) || (typeof i.vdpSlug === 'string' ? i.vdpSlug : null);
    case 'slack_canvas':
      return `log:${canvasInputOf(dest).eventIds[0] ?? 'batch'}`;
    case 'feedback':
      return feedbackInputOf(dest).channelId || null;
  }
}
