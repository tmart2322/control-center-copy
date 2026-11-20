/**
 * D-70: the landing routes' logic both DataSources share (pure): what a write is called, and what a pick or a use
 * case's answer turns into (your row edits, src/lib/canvas/overrides.ts, and a Leave it decision). The DataSources
 * only load, store and publish.
 */
import type { FixUseCaseRequest, PickUseCaseValueRequest, RecordKind, UseCaseLanding } from '@/contract';
import { ucPickRowKey, UC_LEAVE_RULE, type UcDriftField, type UseCaseItem } from '@/engines/activity/use-cases';
import { ucRowKey } from '@/lib/canvas/overrides';
import type { LandingStore } from '@/lib/landings/model';
import type { LandingWorld } from '@/lib/landings/sync';
import type { LabelOf } from '@/lib/landings/views';
import { invalid, notFound } from '@/server/errors';

/** What each record is called in a write's line. */
export function labelsFor(world: LandingWorld, store: LandingStore): LabelOf {
  const act = new Map(world.activity.map((e) => [e.id, e.description] as const));
  const dcs = new Map(world.dcRequests.map((r) => [r.id, `DC ${r.kind === 'change' ? 'change' : `${r.splitPercent}%`} on ${r.oppName}`] as const));
  const ucs = new Map(store.useCases.map((u) => [u.id, u.title] as const));
  const assets = new Map(world.candidates.map((c) => [c.id, c.title] as const));
  return (kind: RecordKind, id: string) => (kind === 'activity_event' ? (act.get(id) ?? null) : kind === 'deal_contribution' ? (dcs.get(id) ?? null) : kind === 'use_case' ? (ucs.get(id) ?? null) || null : (assets.get(id) ?? null));
}

const ORG62_FIELD: Record<PickUseCaseValueRequest['field'], UcDriftField> = { name: 'Use_Case_Name__c', product: 'Product__c', stage: 'Stage__c', goLive: 'Go_Live_Date__c' };

/** One row edit to keep: its key and fields (a pick, a use case's opp or name). */
export interface RowEdit {
  key: string;
  fields: Record<string, string>;
}

/**
 * A pick: the field must differ now, and the side you take must be writable on the other (the view's `take` says
 * why not). Clearing (take null) always works.
 */
export function pickEdit(view: UseCaseLanding, item: UseCaseItem | undefined, body: PickUseCaseValueRequest): RowEdit {
  if (!item?.vdpUseCaseId) throw invalid('Only a use case VDP has can take a pick (add it to VDP first)');
  const f = ORG62_FIELD[body.field];
  const d = item.drift.find((x) => x.field === f);
  const key = ucPickRowKey(item.vdpUseCaseId, f);
  if (body.take === null) return { key, fields: { take: '', vdp: '', org62: '' } };
  if (!d) throw invalid(`Its ${body.field} reads the same in Org62 and VDP: nothing to pick`);
  const diff = view.differences.find((x) => x.field === body.field);
  const why = diff?.take[body.take];
  if (why) throw invalid(why);
  return { key, fields: { take: body.take, vdp: d.vdp, org62: d.org62 } };
}

/** A use case's answer: the opp it goes on (one it may go on), a name while VDP has none; leave is a decision. */
export function fixEdits(item: UseCaseItem | undefined, body: FixUseCaseRequest, opps: ReadonlyArray<{ org62Id: string; open: boolean; mine100: boolean }>): { edit: RowEdit | null; leave: boolean | null } {
  if (!item) throw notFound('Use case', '');
  const fields: Record<string, string> = {};
  if (body.opportunityId !== undefined) {
    if (!item.vdpUseCaseId) throw invalid('Only a use case VDP has goes to Org62 from here');
    if (body.opportunityId !== null) {
      const o = opps.find((x) => x.org62Id.slice(0, 15) === body.opportunityId!.slice(0, 15));
      if (!o) throw invalid('That opportunity is not one the app tracks');
      if (!o.open || !o.mine100) throw invalid('A use case goes on an open opportunity with your 100% DC (D-63)');
    }
    fields.opportunityId = body.opportunityId ?? '';
  }
  if (body.name !== undefined) {
    if (!item.vdpUseCaseId) throw invalid('Only a use case VDP has can be named here');
    fields.name = body.name ?? '';
  }
  return { edit: Object.keys(fields).length ? { key: ucRowKey(item.vdpUseCaseId!), fields } : null, leave: body.leave === undefined ? null : body.leave };
}

export const UC_LEAVE = UC_LEAVE_RULE;
