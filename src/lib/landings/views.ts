/**
 * D-70: what the landings read as (pure, the same on both DataSources): a logging run's writes exactly as sent, one
 * record's landings, and every use case with its two landings ("Org62 ✓ · VDP —"), its differences, its assets and
 * its question for Needs you.
 */
import type { CanvasWrites, Draft, Landing, LandingWrite, RecordKind, RecordLandings, UseCaseDifference, UseCaseField, UseCaseLanding, UseCaseLandingsPayload, UseCaseQuestion, WriteField } from '@/contract';
import { phaseOfStage, ucFieldLabel, ucGoLive, ucNameKey, ucPickKey, ucPicksOf, ucProduct, type UcDrift, type UcPick, type UseCaseItem } from '@/engines/activity/use-cases';
import { org62RecordUrl } from '@/projections/links';

import { fieldDef, fieldValue, ucFieldOf } from './fields';
import { id15, type LandingRow, type LandingStore, type WriteRow } from './model';
import { assetRecordId, normUrl, type LandingWorld } from './sync';

const OBJECT: Partial<Record<RecordKind, string>> = { activity_event: 'Event', deal_contribution: 'Deal_Contribution__c', use_case: 'Use_Case__c' };

/** The record in its destination, when the app can link it. */
export function landingUrl(l: Pick<LandingRow, 'recordKind' | 'destination' | 'externalId' | 'remoteValues'>, vdpUrl?: string | null): string | null {
  if (l.destination === 'org62') return l.externalId ? org62RecordUrl(OBJECT[l.recordKind] ?? null, l.externalId) : null;
  if (l.recordKind === 'asset') return l.remoteValues?.url ?? null;
  return vdpUrl ?? null;
}

export function landingView(l: LandingRow, vdpUrl?: string | null): Landing {
  return { id: l.id, recordKind: l.recordKind, recordId: l.recordId, destination: l.destination, externalId: l.externalId, url: landingUrl(l, vdpUrl), state: l.state, remoteValues: l.remoteValues, verifiedAt: l.verifiedAt, lastReadAt: l.lastReadAt };
}

/** What a write names: the row's subject, the use case, the DC's opp (the caller's labels, else the write's own values). */
export type LabelOf = (kind: RecordKind, recordId: string) => string | null;

const MAIN: Partial<Record<RecordKind, string[]>> = {
  activity_event: ['Duration__c', 'SE_Task_Type__c'],
  deal_contribution: ['Split_Percentage__c', 'Opportunity_Role__c'],
  use_case: ['Stage__c', 'Go_Live_Date__c'],
  asset: ['type'],
};

export function writeView(w: WriteRow, l: LandingRow, labelOf: LabelOf, draftTitle: (id: string) => string | null): LandingWrite {
  const fields: WriteField[] = Object.keys(w.after).map((f) => ({ field: f, label: fieldDef(l.recordKind, l.destination, f).label, before: w.op === 'update' ? (w.before?.[f] ?? null) : null, after: w.after[f] ?? null }));
  const label = labelOf(l.recordKind, l.recordId) ?? w.after.Subject ?? w.after.Use_Case_Name__c ?? w.after.title ?? (l.externalId ? `${OBJECT[l.recordKind] ?? l.recordKind} ${id15(l.externalId)}` : l.recordId);
  const v = (f: string, x: string | null) => fieldValue(l.recordKind, l.destination, f, x);
  const summary =
    w.op === 'update'
      ? `update · ${fields.map((f) => `${f.label} ${v(f.field, f.before)} → ${v(f.field, f.after)}`).join(' · ')}`
      : w.op === 'delete'
        ? 'delete'
        : `create${(MAIN[l.recordKind] ?? []).filter((f) => w.after[f]).map((f) => ` · ${fieldDef(l.recordKind, l.destination, f).label} ${v(f, w.after[f]!)}`).join('')}`;
  return {
    id: w.id,
    landingId: l.id,
    recordKind: l.recordKind,
    recordId: l.recordId,
    destination: l.destination,
    label,
    draftId: w.draftId,
    draftTitle: w.draftId ? draftTitle(w.draftId) : null,
    rowKey: w.rowKey,
    op: w.op,
    state: w.state,
    origin: w.origin,
    reason: w.reason,
    fields,
    summary,
    createdAt: w.createdAt,
    sentAt: w.sentAt,
    verifiedAt: w.verifiedAt,
  };
}

const writeOrder = (a: LandingWrite, b: LandingWrite) => b.createdAt.localeCompare(a.createdAt) || a.label.localeCompare(b.label) || a.rowKey.localeCompare(b.rowKey);

const titleOf = (d: Draft) => (d.destination.kind === 'action' ? d.destination.target.label : 'Draft');

/** A logging run (one canvas item): its writes in the canvas's order (Events, DCs, use cases, updates), removed ones last. */
export function canvasWritesView(store: LandingStore, draftId: string, draft: Draft | null, labelOf: LabelOf, draftTitle: (id: string) => string | null): CanvasWrites {
  const landing = new Map(store.landings.map((l) => [l.id, l] as const));
  const rank = (w: LandingWrite) => (w.state === 'removed' || w.state === 'rejected' ? 9 : 0) + ({ activity_event: 0, deal_contribution: 1, use_case: 2, asset: 3 } as const)[w.recordKind] + (w.op === 'update' ? 4 : 0);
  const writes = store.writes
    .filter((w) => w.draftId === draftId)
    .flatMap((w) => {
      const l = landing.get(w.landingId);
      return l ? [writeView(w, l, labelOf, draftTitle)] : [];
    })
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label) || a.rowKey.localeCompare(b.rowKey));
  const live = writes.filter((w) => w.state !== 'removed' && w.state !== 'rejected');
  let appliedAt: string | null = null;
  for (const a of draft?.attempts ?? []) if (!a.dryRun && a.outcome !== 'failed' && a.outcome !== 'rendered') appliedAt = a.at;
  return {
    draftId,
    title: draft ? titleOf(draft) : (writes[0]?.draftTitle ?? 'Logging canvas'),
    status: draft?.status ?? 'gone',
    appliedAt,
    writes,
    counts: { create: live.filter((w) => w.op === 'create').length, update: live.filter((w) => w.op === 'update').length, delete: live.filter((w) => w.op === 'delete').length, removed: writes.length - live.length },
  };
}

/** One record's landings, each with its writes (newest first). */
export function recordLandingsView(store: LandingStore, kind: RecordKind, recordId: string, labelOf: LabelOf, draftTitle: (id: string) => string | null): RecordLandings {
  const ls = store.landings.filter((l) => l.recordKind === kind && l.recordId === recordId).sort((a, b) => a.destination.localeCompare(b.destination));
  return {
    recordKind: kind,
    recordId,
    landings: ls.map((l) => ({ ...landingView(l), writes: store.writes.filter((w) => w.landingId === l.id).map((w) => writeView(w, l, labelOf, draftTitle)).sort(writeOrder) })),
  };
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

const PRESENT = new Set(['verified', 'differs']);
const DIFF_FIELDS: ReadonlySet<string> = new Set(['Use_Case_Name__c', 'Product__c', 'Stage__c', 'Go_Live_Date__c']);

export interface UseCaseViewInput {
  store: LandingStore;
  world: LandingWorld;
  useCaseByKey: ReadonlyMap<string, string>;
  accountName: (id: string) => string | null;
  labelOf: LabelOf;
  draftTitle: (id: string) => string | null;
  readAt: string | null;
}

const QUESTION_TEXT: Record<NonNullable<UseCaseItem['question']>['code'], string> = {
  pick_opp: 'Which opportunity does it go on? (open, with your 100% DC)',
  no_title: 'VDP has no name for it yet: name it here, or in VDP',
  no_account: 'Org62 needs an account for it: pick an opp whose account Org62 knows, or set the account on the VDP',
  waiting_dc: 'It waits for your 100% DC on the opp: claim it (Deals ▸ DCs)',
};

export function ucLandingsView(i: UseCaseViewInput): UseCaseLandingsPayload {
  const items: UseCaseLanding[] = [];
  const uc = i.world.useCases;
  if (!uc) return { readAt: i.readAt, items, counts: { both: 0, org62: 0, vdp: 0, neither: 0, differs: 0, ready: 0, questions: 0 } };
  const { plan, input } = uc;
  const landings = new Map(i.store.landings.map((l) => [`${l.recordKind}|${l.recordId}|${l.destination}`, l] as const));
  const byLanding = new Map<string, WriteRow[]>();
  for (const w of i.store.writes) byLanding.set(w.landingId, [...(byLanding.get(w.landingId) ?? []), w]);
  const recs = new Map(input.org62.records.map((r) => [id15(r.id), r] as const));
  const links = new Map(input.links.map((l) => [l.vdpUseCaseId, l] as const));
  const liveUc = new Map<string, NonNullable<(typeof input.vdps)[number]['snapshot']['useCases']>[number]>();
  for (const v of input.vdps) if (!v.snapshot.archivedAt) for (const u of v.snapshot.useCases ?? []) liveUc.set(u.id, u);
  const vdpBySlug = new Map(input.vdps.map((v) => [v.snapshot.slug, v.snapshot] as const));
  const opps = new Map(input.opps.map((o) => [id15(o.org62Id), o] as const));
  const me = id15(input.me);
  const picks: ReadonlyMap<string, UcPick> = input.picks ?? ucPicksOf(input.overrides);

  for (const x of plan.items) {
    const id = i.useCaseByKey.get(x.key);
    if (!id) continue;
    const org = landings.get(`use_case|${id}|org62`) ?? null;
    const vdp = landings.get(`use_case|${id}|vdp`) ?? null;
    const inOrg = !!org && PRESENT.has(org.state);
    const inVdp = !!vdp && PRESENT.has(vdp.state);
    const rec = x.org62UseCaseId ? recs.get(id15(x.org62UseCaseId)) : undefined;
    const mine = !!rec && !!me && id15(rec.ownerId) === me;
    const vuc = x.vdpUseCaseId ? liveUc.get(x.vdpUseCaseId) : undefined;
    const link = x.vdpUseCaseId ? links.get(x.vdpUseCaseId) : undefined;
    const differences = x.drift.filter((d) => DIFF_FIELDS.has(d.field)).map((d) => difference(x, d, { rec, mine, vuc: !!vuc, link, picks }));
    const opp = x.org62OpportunityId ? opps.get(id15(x.org62OpportunityId)) : undefined;
    const ready = (x.state === 'create' || x.state === 'update') && x.decided !== 'leave';
    const question: UseCaseQuestion | null = x.question && x.state === 'skipped' ? { code: x.question.code, text: QUESTION_TEXT[x.question.code], opps: x.question.opps } : differences.some((d) => !d.pick && x.drift.find((y) => ucFieldOf(y.field) === d.field)?.fix === 'choose') && x.state === 'drift' ? { code: 'pick_value', text: 'Org62 and VDP differ, and both changed: which value is right?', opps: [] } : null;
    const sends = x.state === 'create' ? `New in Org62${x.oppName ? ` on ${x.oppName}` : ''}` : x.state === 'update' ? x.updates.map((u) => `${ucFieldLabel(u.field)} ${u.from || '(empty)'} → ${u.to}`).join(' · ') : null;
    const snap = x.vdpSlug ? vdpBySlug.get(x.vdpSlug) : undefined;
    const assets: UseCaseLanding['assets'] = [];
    const seenUrl = new Set<string>();
    for (const c of i.world.candidates) {
      if (!x.vdpSlug || c.vdpSlug !== x.vdpSlug || c.status === 'dismissed') continue;
      seenUrl.add(normUrl(c.url));
      const l = landings.get(`asset|${c.id}|vdp`);
      const state = l?.state ?? 'not_sent';
      assets.push({ id: c.id, title: c.title, url: c.url, kind: c.kind, state, words: state === 'verified' ? 'In VDP' : state === 'sent' ? 'Added: waiting for the VDP read' : state === 'staged' ? 'On a VDP push waiting' : 'Suggested: not in VDP yet' });
    }
    for (const a of snap?.assets ?? []) {
      if (seenUrl.has(normUrl(a.url))) continue;
      assets.push({ id: assetRecordId(a.id), title: a.title ?? a.url, url: a.url, kind: a.type, state: 'verified', words: 'In VDP' });
    }
    const ws = [...(org ? (byLanding.get(org.id) ?? []).map((w) => writeView(w, org, i.labelOf, i.draftTitle)) : []), ...(vdp ? (byLanding.get(vdp.id) ?? []).map((w) => writeView(w, vdp, i.labelOf, i.draftTitle)) : [])].sort(writeOrder);
    items.push({
      id,
      key: x.key,
      title: x.title,
      track: x.track,
      companyName: x.companyName,
      vdpSlug: x.vdpSlug,
      vdpUrl: x.vdpUrl,
      vdpUseCaseId: x.vdpUseCaseId,
      org62UseCaseId: x.org62UseCaseId,
      accountId: opp?.accountId ?? null,
      accountName: opp?.accountId ? i.accountName(opp.accountId) : null,
      oppId: opp?.id ?? null,
      oppName: x.oppName,
      org62OpportunityId: x.org62OpportunityId,
      org62: org ? { ...landingView(org), url: landingUrl(org) ?? (x.org62UseCaseId ? org62RecordUrl('Use_Case__c', x.org62UseCaseId) : null) } : null,
      vdp: vdp ? landingView(vdp, x.vdpUrl) : null,
      where: inOrg && inVdp ? 'both' : inOrg ? 'org62' : inVdp ? 'vdp' : 'neither',
      state: x.state,
      why: x.why,
      ready,
      sends,
      question,
      differences,
      assets: assets.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
      writes: ws,
      canvasDraftId: x.canvasDraftId,
    });
  }
  items.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  const n = (p: (x: UseCaseLanding) => boolean) => items.filter(p).length;
  return {
    readAt: i.readAt,
    items,
    counts: { both: n((x) => x.where === 'both'), org62: n((x) => x.where === 'org62'), vdp: n((x) => x.where === 'vdp'), neither: n((x) => x.where === 'neither'), differs: n((x) => x.differences.length > 0), ready: n((x) => x.ready), questions: n((x) => !!x.question) },
  };
}

function difference(x: UseCaseItem, d: UcDrift, o: { rec?: { stage: string | null; ownerId: string | null }; mine: boolean; vuc: boolean; link?: { syncedStage: string | null; syncedGoLive: string | null; syncedName: string | null }; picks: ReadonlyMap<string, UcPick> }): UseCaseDifference {
  const field = ucFieldOf(d.field) as UseCaseField;
  const synced = !o.link ? null : field === 'stage' ? (o.link.syncedStage === null ? null : phaseOfStage(o.link.syncedStage)) : field === 'goLive' ? o.link.syncedGoLive : field === 'name' ? o.link.syncedName : null;
  const eq = (a: string, b: string) => (field === 'name' ? ucNameKey(a) === ucNameKey(b) : field === 'stage' ? (a || 'Not Started') === (b || 'Not Started') : a === b);
  const changed: UseCaseDifference['changed'] = synced === null ? 'unknown' : !eq(d.vdp, synced) && !eq(d.org62, synced) ? 'both' : !eq(d.vdp, synced) ? 'vdp' : 'org62';
  const p = x.vdpUseCaseId ? o.picks.get(ucPickKey(x.vdpUseCaseId, d.field)) : undefined;
  const pick = p && p.vdp === d.vdp && p.org62 === d.org62 ? p.take : null;
  const onCanvas = x.state === 'in_canvas' ? 'On a canvas waiting for your Apply' : x.state === 'handed_off' ? 'Sent to Slackbot: waiting for the next Org62 read' : 'Org62 follows on your next logging canvas';
  const next = d.fix === 'canvas' ? onCanvas : d.fix === 'vdp' ? 'VDP follows: push it in Activity ▸ VDP ▸ Changes' : d.fix === 'org62_by_hand' ? `Change it in Org62${o.mine ? '' : ' (not your record: the app never writes it)'}` : 'Pick the right value';
  return {
    field,
    label: ucFieldLabel(d.field),
    org62: field === 'stage' ? (o.rec?.stage ?? d.org62) : d.org62,
    vdp: d.vdp,
    changed,
    pick,
    next,
    take: {
      // Org62's value is right: VDP is written (its update_use_case has no track)
      org62: field === 'product' ? 'VDP can’t change a use case’s track: change it in VDP' : !d.org62 ? 'Org62 has no value' : !o.vuc ? 'Not in VDP' : null,
      // VDP's value is right: Org62 is written on the next canvas (a record you own)
      vdp: !o.mine ? 'Not your record in Org62: change it there' : !d.vdp ? 'VDP has no value' : null,
    },
  };
}

/** Product__c / go-live of a VDP use case in Org62's terms (the picks compare them). */
export const vdpValueOf = { product: ucProduct, goLive: ucGoLive };
