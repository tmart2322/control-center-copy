/**
 * Use cases in both VDP and Org62 `Use_Case__c` (D-67): the round trip, pure. The VDP mirror (src/lib/vdp/types.ts) and
 * the Org62 read-back (`Use_Case__c` on my opps, src/jobs/handlers/org62-readback.ts) are read; the logging canvases
 * the Outbox holds or sent say what is on its way to Org62; the VDP items this returns go in the VDP tree (D-63) as
 * Outbox items the user pushes. Nobody writes from here, and neither side is ever overwritten silently.
 *
 *   scope    D-63: an open opp where my DC split is 100%. A VDP use case goes on the VDP's first such opp, primary
 *            first (the account's only one when the VDP lists none); closed opps, 50% DCs and team-only opps create
 *            nothing (a VDP made before the DC exists waits for it).
 *   match    the link first (VDP use case id ↔ Use_Case__c id, kept across renames), else the opp (15-character id, any
 *            opp of the VDP) and the title (`sameUseCaseTitle`: equal once normalized, or nearly the same words).
 *            Two records of mine that match one use case: the oldest is it, the other a duplicate (never deleted).
 *   VDP → Org62   a titled use case with no record: a canvas row (OwnerId me) on the next logging canvas.
 *   Org62 → VDP   a record on my opps that no VDP use case is: a `create_use_case` item under that opp's VDP.
 *   drift    Stage (in VDP's phase terms), Go-Live, title, opp and account, against what the app last wrote or read
 *            (`synced*`). Only VDP changed: Org62 follows on the canvas for Stage / Go-Live on records the app created
 *            that I own (D-67), else "change it in Org62". Only Org62 changed (or VDP is empty): an `update_use_case`
 *            item. Both changed: both values, the user chooses. Never cleared, never deleted.
 *   deleted  a linked record gone from Org62: Add it again or Leave it (decisions); a linked VDP use case gone from VDP:
 *            the record is Org62-only again (re-add it to VDP, or Leave it). An archived or no-longer-mine VDP: quiet.
 *   holds    a canvas waiting for Apply holds its rows; a sent one handed them to Slackbot, offered again only when a
 *            read two days later still has no such record (Slackbot's duplicate rule skips any that did land).
 *   done     every state is derived from the reads: the next read after an Apply or a manual edit closes the item.
 */
import type { VdpGap } from '@/contract';
import { sameUseCaseTitle } from '@/engines/vdp/gaps';
import { NO_ROW_OVERRIDES, ucRowKey, updateOverrideOf, type RowOverride, type RowOverrides } from '@/lib/canvas/overrides';
import { oppIdsOf, type VdpSnapshot, type VdpUseCase } from '@/lib/vdp/types';

import { cell } from './slackbot';

export const USE_CASE_OBJECT = 'Use_Case__c';

// ---------------------------------------------------------------------------
// The Org62 picklists (Use_Case__c describe, read 2026-11-12) and VDP's mapping onto them
// ---------------------------------------------------------------------------

/** VDP execution phase → Stage__c (VDP's own export map; On Hold has no Org62 stage, so it stays as it is). */
export const UC_STAGE_OF_PHASE: Readonly<Record<string, string>> = {
  'Not Started': 'U01 - Not Started',
  Discovery: 'U03 - Scoping',
  Build: 'U05 - Implementation',
  Live: 'U06 - In Production',
  'On Hold': '',
};

export type UcTrack = 'd360' | 'agentforce';

/** Use_Case_Agent_Type__c (multi-select) values per track, in Org62's order; the first is the "… Custom" fallback. */
export const UC_AGENT_TYPES: Readonly<Record<UcTrack, readonly string[]>> = {
  d360: [
    'D360 Custom',
    'D360 for Agentforce',
    'D360 for Analytics (e.g. Tableau Next)',
    'D360 for Industry',
    'D360 for Marketing (aka traditional "CDP")',
    'D360 for Sales',
    'D360 for Service',
    'D360 Other Cloud (Commerce, Revenue)',
  ],
  agentforce: [
    'Agentforce Custom',
    'Agentforce Voice (Internal)',
    'Agentforce Voice (External)',
    'Agentforce for Analytics',
    'Agentforce for Commerce',
    'Agentforce for Field Service',
    'Agentforce for Industry',
    'Agentforce for Integration',
    'Agentforce for Marketing',
    'Agentforce for Platform',
    'Agentforce for Revenue Cloud',
    'Agentforce for Sales',
    'Agentforce for Service',
    'Agentforce for Slack',
    'help.salesforce',
    'Agentforce Operations',
    'Qualified',
  ],
};

/**
 * Org62's own picklists on Use_Case__c (its schema, read 2026-11-13), for the canvas review's edit forms: Stage__c,
 * Product__c, Entitlement_Leveraged__c. Use_Case_Agent_Type__c is UC_AGENT_TYPES.
 */
export const UC_STAGES: readonly string[] = ['U01 - Not Started', 'U02 - Ideation', 'U03 - Scoping', 'U04 - Validation', 'U05 - Implementation', 'U06 - In Production', 'U07 - Lost'];
export const UC_PRODUCTS: readonly string[] = ['Data Cloud', 'Agentforce'];
export const UC_ENTITLEMENTS: readonly string[] = ['Flex', 'Data Services', 'Conversations', 'Bundled Products'];

export const ucTrack = (t: string | null | undefined): UcTrack => (t === 'agentforce' ? 'agentforce' : 'd360');

/** Product__c of a track. */
export const ucProduct = (t: string | null | undefined): 'Data Cloud' | 'Agentforce' => (ucTrack(t) === 'agentforce' ? 'Agentforce' : 'Data Cloud');

/** Stage__c for a VDP execution phase: '' when VDP has none (Org62 then keeps its default, U01) or it is On Hold. */
export const ucStage = (phase: string | null | undefined): string => (phase ? (UC_STAGE_OF_PHASE[phase] ?? '') : '');

/** Go_Live_Date__c (YYYY-MM-DD) from VDP's target date, '' when none. */
export const ucGoLive = (d: string | null | undefined): string => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : '');

const genStr = (uc: Pick<VdpUseCase, 'generatedFields'>, key: string): string => {
  const v = uc.generatedFields?.[key];
  return typeof v === 'string' ? v.trim() : '';
};

/** The agent types VDP inferred for a use case (on the track's list, in Org62's order), else the track's "… Custom". */
export function ucAgentTypes(uc: Pick<VdpUseCase, 'track' | 'generatedFields'>): string[] {
  const allowed = UC_AGENT_TYPES[ucTrack(uc.track)];
  const raw = uc.generatedFields?.consumption_use_cases;
  const vals = new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).filter((v): v is string => typeof v === 'string'));
  const picked = allowed.filter((a) => vals.has(a));
  return picked.length ? picked : [allowed[0]!];
}

/** Entitlement_Leveraged__c: Flex, unless the VDP header names the track's one other value (VDP's resolveEntitlementForTrack). */
export function ucEntitlement(override: string | null | undefined, track: string | null | undefined): string {
  const v = override?.trim();
  if (ucTrack(track) === 'agentforce') return v === 'Conversations' ? 'Conversations' : 'Flex';
  return v === 'Data Services' ? 'Data Services' : 'Flex';
}

/**
 * The longest text the Org62 field holds: Business_Problem_Solved__c, Business_Problem_KPIs__c and Notes__c are Long
 * Text Areas of 32,768 characters (Org62 Use_Case__c schema, read 2026-11-13). Only text past that stays in VDP,
 * linked from Notes; the canvas itself holds ~900 KB (CANVAS_MAX_BYTES), so it never forces a cut.
 */
export const UC_TEXT_MAX = 32_768;
const MORE = ' … (more in VDP)';
/** Text cut to what the field holds (a line break counts once in Org62: the canvas's ` ⏎ ` turns back into one). */
export const ucClip = (s: string, max = UC_TEXT_MAX): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - MORE.length)).trimEnd()}${MORE}`);
const clip = (s: string, max = UC_TEXT_MAX) => ucClip(s, max);

/** How names compare: case, spacing and Unicode forms aside. */
export const ucNameKey = (s: string | null | undefined): string => (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const id15 = (s: string | null | undefined) => (s ?? '').slice(0, 15);
/** The opp + name key of a use case. */
export const ucMatchKey = (org62OppId: string | null | undefined, name: string | null | undefined) => `${id15(org62OppId)}|${ucNameKey(name)}`;

/** The key a use case's ADD row carries (`CC-UC#<VDP use case id>` at the end of Notes__c). */
export const ucCreateKey = (vdpUseCaseId: string) => `uc:${vdpUseCaseId}`;
/** The key of one field update on a record. */
export const ucUpdateKey = (recordId: string, field: string) => `ucu:${id15(recordId)}|${field}`;
const CC_UC = /CC-UC#([A-Za-z0-9-]+)/;

/**
 * Two use-case titles that name the same use case. D-69 (VD-34): VDP's `sameUseCaseTitle` itself now requires the
 * numbers and other distinguishing tokens to match ("Phase 1" is never "Phase 2"), so this is that matcher; the name
 * stays for this lane's callers and tests.
 */
export const ucSameTitle = sameUseCaseTitle;

/** Stage__c → VDP's execution phase (the reverse of UC_STAGE_OF_PHASE; U02-U04 are all VDP's Discovery, U07 its On Hold). */
export function phaseOfStage(stage: string | null | undefined): string {
  const m = /^U0([1-7])\b/.exec(stage ?? '');
  if (!m) return '';
  return ({ '1': 'Not Started', '2': 'Discovery', '3': 'Discovery', '4': 'Discovery', '5': 'Build', '6': 'Live', '7': 'On Hold' } as Record<string, string>)[m[1]!] ?? '';
}
/** Phases as the drift check compares them: Not Started is the same as none (Org62's default stage is U01). */
const phaseKey = (p: string | null | undefined) => (!p || p === 'Not Started' ? '' : p);
/** Product__c → VDP track. */
export const trackOfProduct = (p: string | null | undefined): UcTrack => (p === 'Agentforce' ? 'agentforce' : 'd360');

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One opportunity as the plan reads it. */
export interface UcOpp {
  /** The app's opportunity id. */
  id: string;
  org62Id: string;
  name: string;
  /** The app's account id. */
  accountId: string | null;
  accountOrg62Id: string | null;
  isOpen: boolean;
  /** D-63: my DC split on it (100 makes it in scope); null when I hold none or it was not read. */
  dcSplit: number | null;
  closeDate: string | null;
}

/**
 * A mirror snapshot made safe to read: rows stored before a field existed (or by an older reader) may lack the company,
 * the slug, the flags or the use-case list. A bad VDP row must never stop a logging batch.
 */
export function ucNormalizeVdp(v: UcVdp, slug?: string | null): UcVdp {
  const s = (v.snapshot ?? {}) as Partial<VdpSnapshot>;
  const sl = s.slug || slug || s.id || 'vdp';
  return {
    accountId: v.accountId ?? null,
    snapshot: {
      ...(s as VdpSnapshot),
      id: s.id ?? sl,
      slug: sl,
      url: s.url ?? null,
      company: s.company?.name ? s.company : { id: s.company?.id ?? null, name: s.company?.name || sl, slug: s.company?.slug ?? null, industry: s.company?.industry ?? null, segment: s.company?.segment ?? null },
      salesforceAccountId: s.salesforceAccountId ?? null,
      salesforceOpportunityId: s.salesforceOpportunityId ?? null,
      isSeed: !!s.isSeed,
      archivedAt: s.archivedAt ?? null,
      useCases: (Array.isArray(s.useCases) ? s.useCases : []).filter((u): u is VdpUseCase => !!u && typeof u.id === 'string').map((u) => ({ ...u, displayOrder: typeof u.displayOrder === 'number' ? u.displayOrder : 0, track: u.track ?? 'd360' })),
    },
  };
}

/** D-63: an open opp with my 100% DC: the only kind a new use case goes on. */
export const ucInScope = (o: Pick<UcOpp, 'isOpen' | 'dcSplit'>) => o.isOpen && o.dcSplit === 100;

/** One VDP of mine (not gone) and the app account it links to (linkVdp). */
export interface UcVdp {
  snapshot: VdpSnapshot;
  accountId: string | null;
}

/** One Use_Case__c the read-back saw on my opps. */
export interface Org62UseCase {
  id: string;
  opportunityId: string | null;
  accountId: string | null;
  name: string | null;
  ownerId: string | null;
  createdById: string | null;
  stage: string | null;
  goLive: string | null;
  product: string | null;
  createdAt: string | null;
  /** A complete read of its opp no longer returned it (deleted, or moved to an opp the app doesn't read). */
  goneAt: string | null;
}

/** VDP use case ↔ Use_Case__c, and the values the app last wrote there or saw agree on both sides. */
export interface UseCaseLink {
  vdpUseCaseId: string;
  org62UseCaseId: string;
  /** `app`: a logging canvas the user applied created it; `adopted`: it was there already (never updated by the app). */
  origin: 'app' | 'adopted';
  syncedStage: string | null;
  syncedGoLive: string | null;
  syncedName: string | null;
}

/** A create row as a canvas carries it (read back from the markdown). */
export interface UcCanvasCreate {
  vdpUseCaseId: string;
  opportunityId: string;
  name: string;
  stage: string;
  goLive: string;
}

/** An update row as a canvas carries it. */
export interface UcCanvasUpdate {
  recordId: string;
  field: string;
  newValue: string;
}

/** What the logging canvases hold: pending ones (waiting for Apply) and sent ones (Slackbot has them). */
export interface UseCaseHolds {
  /** Row key → the canvas item waiting for Apply that holds it. */
  held: ReadonlyMap<string, string>;
  /** Row key → the sent canvas item and when it was sent. */
  sent: ReadonlyMap<string, { draftId: string; at: string }>;
  /** VDP use case id → the create row a sent canvas carried (the opp and name exactly as Slackbot got them). */
  sentCreates: ReadonlyMap<string, UcCanvasCreate & { draftId: string; at: string }>;
}

export const NO_UC_HOLDS: UseCaseHolds = { held: new Map(), sent: new Map(), sentCreates: new Map() };

/**
 * The user's choices on items with no right answer for the app (D-61 decisions, `use_case` / `use_case_readd`), by
 * item key (`uc:<VDP use case id>` or `rec:<Use_Case__c id, 15>`): leave it as it is, or add a deleted one again.
 */
export interface UseCaseDecisions {
  leave: ReadonlySet<string>;
  readd: ReadonlySet<string>;
}
export const NO_UC_DECISIONS: UseCaseDecisions = { leave: new Set(), readd: new Set() };
/** The decisions' rules (src/contract/needs.ts NeedRule). */
export const UC_LEAVE_RULE = 'use_case';
export const UC_READD_RULE = 'use_case_readd';

/**
 * D-70: your pick of the right value of one field that differs (Activity ▸ Org62 ▸ Use cases), with both values as they
 * were when you picked: it holds only while they still read that way (a new difference asks again).
 */
export interface UcPick {
  take: 'org62' | 'vdp';
  vdp: string;
  org62: string;
}
/** A pick's key: the VDP use case and the Org62 field. */
export const ucPickKey = (vdpUseCaseId: string, field: UcDriftField) => `${vdpUseCaseId}|${field}`;
/** Where a pick is kept: with your other canvas-row edits (src/lib/canvas/overrides.ts), under `pick:<ucPickKey>`. */
export const ucPickRowKey = (vdpUseCaseId: string, field: UcDriftField) => `pick:${ucPickKey(vdpUseCaseId, field)}`;

/** Your picks among your row edits (a cleared one has an empty `take`). */
export function ucPicksOf(overrides: RowOverrides | null | undefined): Map<string, UcPick> {
  const out = new Map<string, UcPick>();
  for (const [k, o] of Object.entries(overrides ?? {})) {
    if (!k.startsWith('pick:')) continue;
    const take = o.fields.take;
    if (take !== 'org62' && take !== 'vdp') continue;
    out.set(k.slice(5), { take, vdp: typeof o.fields.vdp === 'string' ? o.fields.vdp : '', org62: typeof o.fields.org62 === 'string' ? o.fields.org62 : '' });
  }
  return out;
}

export interface UseCasePlanInput {
  /** My live VDPs (not gone from my list). */
  vdps: readonly UcVdp[];
  /** VDPs no longer mine (gone from my list): their linked records stay quiet, never Org62-only. */
  goneVdps?: readonly UcVdp[];
  opps: readonly UcOpp[];
  /** The read-back: when it last read my opps' use cases (null: never), and the records it saw. */
  org62: { readAt: string | null; records: readonly Org62UseCase[] };
  links: readonly UseCaseLink[];
  holds: UseCaseHolds;
  /** My Org62 user id (OwnerId of the records the app creates; ownership checks). */
  me: string | null;
  decisions?: UseCaseDecisions;
  /** Your edits on canvas rows before Apply (src/lib/canvas/overrides.ts): a create's fields, a fix's new value. */
  overrides?: RowOverrides;
  /** D-70: your picks of the right value where the two systems differ, by ucPickKey. */
  picks?: ReadonlyMap<string, UcPick>;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface UseCaseCreate {
  vdpUseCaseId: string;
  vdpSlug: string;
  vdpUrl: string | null;
  companyName: string;
  displayOrder: number;
  name: string;
  /** Org62 ids. */
  opportunityId: string;
  accountId: string;
  oppName: string;
  oppCloseDate: string | null;
  product: string;
  agentTypes: string[];
  entitlement: string;
  stage: string;
  goLive: string;
  businessProblem: string;
  kpis: string;
  notes: string;
  /** Offered again: a canvas carried it and a read two days later had no such record, or you chose Add it again. */
  again: boolean;
}

/** The Use_Case__c fields a canvas UPDATE row may set: Stage / Go-Live as VDP changes them (D-67), and any of these four on your pick (D-70). */
export type UcUpdateField = 'Stage__c' | 'Go_Live_Date__c' | 'Use_Case_Name__c' | 'Product__c';

export interface UseCaseUpdate {
  vdpUseCaseId: string;
  recordId: string;
  field: UcUpdateField;
  newValue: string;
  currentValue: string;
  name: string;
  why: string;
}

export type UseCaseState = 'create' | 'update' | 'in_canvas' | 'handed_off' | 'in_org62' | 'drift' | 'org62_only' | 'duplicate' | 'others' | 'gone' | 'left' | 'skipped';
export const USE_CASE_STATES: readonly UseCaseState[] = ['create', 'update', 'in_canvas', 'handed_off', 'in_org62', 'drift', 'org62_only', 'duplicate', 'others', 'gone', 'left', 'skipped'];
/** States that ask nothing of anyone (done, or set aside). */
export const UC_QUIET: ReadonlySet<UseCaseState> = new Set(['in_org62', 'others', 'left']);

export type UcDriftField = 'Stage__c' | 'Go_Live_Date__c' | 'Use_Case_Name__c' | 'Product__c' | 'Opportunity__c' | 'Account__c';
/**
 * How one difference gets fixed: `canvas` (Org62 follows on the next logging canvas), `vdp` (an item in the VDP tree),
 * `org62_by_hand` (change it in Org62: not a field or record the app writes), `choose` (both sides changed).
 */
export type UcDriftFix = 'canvas' | 'vdp' | 'org62_by_hand' | 'choose';
export interface UcDrift {
  field: UcDriftField;
  vdp: string;
  org62: string;
  fix: UcDriftFix;
}

/** One use case (in VDP, in Org62, or both) and where it stands (tenet: Legible). */
export interface UseCaseItem {
  /** `uc:<VDP use case id>`, or `rec:<Use_Case__c id, 15>` for one only Org62 has: the decision subject. */
  key: string;
  vdpSlug: string | null;
  vdpUrl: string | null;
  companyName: string;
  vdpUseCaseId: string | null;
  title: string;
  track: string;
  oppName: string | null;
  org62OpportunityId: string | null;
  state: UseCaseState;
  why: string;
  org62UseCaseId: string | null;
  canvasDraftId: string | null;
  /** Field fixes on their way to Org62 (state update, in_canvas or handed_off). */
  updates: Array<{ field: UcUpdateField; from: string; to: string }>;
  /** Every value the two sides disagree on, both values, and how each is fixed. */
  drift: UcDrift[];
  /** What the user can decide here: leave it as it is, or add a deleted one again (and undo either). */
  options: Array<'leave' | 'readd'>;
  decided: 'leave' | 'readd' | null;
  /**
   * D-70: what only you can answer before it can go to Org62 (Needs you): the opp it goes on (`pick_opp`, with the
   * choices), a name (`no_title`), an account (`no_account`), your 100% DC (`waiting_dc`). Null: none.
   */
  question?: UcQuestion | null;
}

export interface UcQuestion {
  code: 'pick_opp' | 'no_title' | 'no_account' | 'waiting_dc';
  opps: Array<{ org62Id: string; name: string }>;
}

export interface UseCasePlan {
  creates: UseCaseCreate[];
  updates: UseCaseUpdate[];
  items: UseCaseItem[];
  counts: Record<UseCaseState, number>;
  /** VDP-side items (Org62 → VDP): per VDP slug, the gaps the VDP tree turns into `use_cases` items. */
  vdpGaps: ReadonlyMap<string, VdpGap[]>;
}

/** A sent row is offered again only when a read this long after the canvas still has no such record. */
export const UC_REOFFER_AFTER_MS = 48 * 3_600_000;

/** Why a VDP has no opp a use case can go on (null: it has one). */
function noOppWhy(v: UcVdp, opps: readonly UcOpp[]): string {
  const by15 = new Map(opps.map((o) => [id15(o.org62Id), o] as const));
  const listed = oppIdsOf(v.snapshot).map((id) => by15.get(id15(id))).filter((o): o is UcOpp => !!o);
  const waiting = listed.find((o) => o.isOpen && o.dcSplit !== 100);
  if (waiting) return `Waiting for your 100% DC on ${waiting.name}: Claim DC (Deals), then it goes to Org62`;
  if (listed.length && listed.every((o) => !o.isOpen)) return 'Its opps are closed: no new use case goes to Org62 on a closed opp (D-63)';
  const acct = v.accountId ? opps.filter((o) => o.accountId === v.accountId && ucInScope(o)) : [];
  if (acct.length > 1) return 'The VDP lists no open opportunity with your 100% DC: add the opp to the VDP (Activity ▸ VDP)';
  return 'No open opportunity with your 100% DC on this VDP or its account (D-63)';
}

/** The opp a VDP's use cases go on: its first in-scope opp, primary first; else the linked account's only one. */
export function ucOppFor(v: UcVdp, opps: readonly UcOpp[]): { opp: UcOpp; why: string } | null {
  const by15 = new Map(opps.map((o) => [id15(o.org62Id), o] as const));
  for (const id of oppIdsOf(v.snapshot)) {
    const o = by15.get(id15(id));
    if (o && ucInScope(o)) return { opp: o, why: 'the VDP’s first open opp with your 100% DC' };
  }
  // only a VDP that lists no opp at all falls back to its account (one that lists opps waits for their DC)
  const acct = v.accountId;
  if (!acct || oppIdsOf(v.snapshot).length) return null;
  const mine = opps.filter((o) => o.accountId === acct && ucInScope(o));
  return mine.length === 1 ? { opp: mine[0]!, why: 'the account’s only open opp with your 100% DC' } : null;
}

/** The Use_Case__c a VDP use case becomes on an opp (VDP's export mapping, plus where it came from in Notes__c). */
export function ucCreateRow(v: UcVdp, uc: VdpUseCase, opp: UcOpp, accountOrg62Id: string, again = false): UseCaseCreate {
  const s = v.snapshot;
  const details = [uc.detailsInput?.trim(), genStr(uc, 'detailed_user_story')].filter((x): x is string => !!x).join('\n\n');
  const source = `Source: VDP ${s.url ?? s.slug} · CC-UC#${uc.id}`;
  return {
    vdpUseCaseId: uc.id,
    vdpSlug: s.slug,
    vdpUrl: s.url,
    companyName: s.company.name,
    displayOrder: uc.displayOrder,
    name: uc.title!.trim().slice(0, 255),
    opportunityId: opp.org62Id,
    accountId: accountOrg62Id,
    oppName: opp.name,
    oppCloseDate: opp.closeDate,
    product: ucProduct(uc.track),
    agentTypes: ucAgentTypes(uc),
    entitlement: ucEntitlement(s.entitlementLeveraged, uc.track),
    stage: ucStage(uc.executionPhase),
    goLive: ucGoLive(uc.executionTargetDate),
    businessProblem: clip(genStr(uc, 'business_challenge')),
    kpis: clip(genStr(uc, 'kpis_impacted')),
    notes: details ? `${clip(details, UC_TEXT_MAX - source.length - 2)}\n\n${source}` : source,
    again,
  };
}

/** Notes__c's last part: where the row came from, with the `CC-UC#` key the read-back links it by (never edited). */
const UC_SOURCE = /(?:^|\n\n)(Source: VDP [^\n]*CC-UC#[A-Za-z0-9-]+)\s*$/;

/** Notes__c without its source line: the part you can edit. */
export const ucNotesText = (notes: string): string => notes.replace(UC_SOURCE, '').trim();

/** The Org62 fields of a create you can edit before Apply (the canvas review). */
export const UC_EDITABLE = ['name', 'product', 'agentTypes', 'entitlement', 'stage', 'goLive', 'businessProblem', 'kpis', 'notes'] as const;
export type UcEditable = (typeof UC_EDITABLE)[number];

/**
 * A create with your edits (canvas review): each field you set replaces the app's, cut to the Org62 field's length;
 * Notes__c keeps its source line and `CC-UC#` key last, whatever you wrote.
 */
export function withUcOverride(c: UseCaseCreate, o: Pick<RowOverride, 'fields'> | null | undefined): UseCaseCreate {
  if (!o) return c;
  const f = o.fields;
  const str = (k: UcEditable) => (typeof f[k] === 'string' ? (f[k] as string) : undefined);
  const out: UseCaseCreate = { ...c };
  const name = str('name')?.trim();
  if (name) out.name = name.slice(0, 255);
  for (const k of ['product', 'entitlement', 'stage', 'goLive'] as const) {
    const v = str(k);
    if (v !== undefined) out[k] = v.trim();
  }
  if (Array.isArray(f.agentTypes)) out.agentTypes = (f.agentTypes as string[]).map((x) => x.trim()).filter(Boolean);
  for (const k of ['businessProblem', 'kpis'] as const) {
    const v = str(k);
    if (v !== undefined) out[k] = clip(v.trim());
  }
  const notes = str('notes');
  if (notes !== undefined) {
    const source = UC_SOURCE.exec(c.notes)?.[1] ?? '';
    const text = notes.trim();
    out.notes = source ? (text ? `${clip(text, UC_TEXT_MAX - source.length - 2)}\n\n${source}` : source) : clip(text);
  }
  return out;
}

const zeroCounts = (): Record<UseCaseState, number> => Object.fromEntries(USE_CASE_STATES.map((s) => [s, 0])) as Record<UseCaseState, number>;

/** Creates in the order a batch takes them: the soonest-closing opp first, then the VDP, then VDP's own order. */
const createOrder = (a: UseCaseCreate, b: UseCaseCreate) =>
  (a.oppCloseDate ?? '9999').localeCompare(b.oppCloseDate ?? '9999') || a.vdpSlug.localeCompare(b.vdpSlug) || a.displayOrder - b.displayOrder || a.vdpUseCaseId.localeCompare(b.vdpUseCaseId);

const readAfter = (readAt: string | null, at: string) => !!readAt && Date.parse(readAt) >= Date.parse(at) + UC_REOFFER_AFTER_MS;
const oldestFirst = (a: Org62UseCase, b: Org62UseCase) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
export const ucItemKey = { vdp: (vdpUseCaseId: string) => `uc:${vdpUseCaseId}`, rec: (org62UseCaseId: string) => `rec:${id15(org62UseCaseId)}` };

/**
 * The differences between a VDP use case and its record, each with how it is fixed. `owned`: the app created the
 * record and I still own it (Org62 may follow on the canvas, Stage / Go-Live only).
 */
export function ucDrift(
  uc: VdpUseCase,
  rec: Org62UseCase,
  link: Pick<UseCaseLink, 'syncedStage' | 'syncedGoLive' | 'syncedName'>,
  o: { owned: boolean; opp?: UcOpp | null; vdpOpps15?: ReadonlySet<string>; chosen?: UcOpp | null; mine?: boolean; picks?: ReadonlyMap<string, UcPick> },
): UcDrift[] {
  const out: UcDrift[] = [];
  const pick = (field: UcDriftField, vdp: string, org: string, synced: string | null, same: (a: string, b: string) => boolean, canvas: boolean) => {
    if (same(vdp, org)) return;
    let fix: UcDriftFix;
    // D-70: your pick, while both values still read as they did when you picked: the wrong side is corrected. VDP's
    // value goes to Org62 on the next canvas (any record you own); Org62's value is an item in the VDP tree.
    const chosen = o.picks?.get(ucPickKey(uc.id, field));
    if (chosen && chosen.vdp === vdp && chosen.org62 === org) fix = chosen.take === 'vdp' ? (o.mine ? 'canvas' : 'org62_by_hand') : 'vdp';
    else if (!vdp) fix = 'vdp';
    else if (!org) fix = canvas && o.owned ? 'canvas' : 'org62_by_hand';
    else {
      const vdpChanged = synced === null || !same(vdp, synced);
      const orgChanged = synced === null || !same(org, synced);
      fix = vdpChanged && !orgChanged ? (canvas && o.owned ? 'canvas' : 'org62_by_hand') : orgChanged && !vdpChanged ? 'vdp' : 'choose';
    }
    out.push({ field, vdp, org62: org, fix });
  };
  const ph = (a: string, b: string) => phaseKey(a) === phaseKey(b);
  pick('Stage__c', uc.executionPhase ?? '', phaseOfStage(rec.stage), link.syncedStage === null ? null : phaseOfStage(link.syncedStage), ph, true);
  pick('Go_Live_Date__c', ucGoLive(uc.executionTargetDate), rec.goLive ?? '', link.syncedGoLive, (a, b) => a === b, true);
  pick('Use_Case_Name__c', uc.title?.trim() ?? '', rec.name?.trim() ?? '', link.syncedName, (a, b) => ucNameKey(a) === ucNameKey(b), false);
  // D-70: Product__c against the track (no synced value: when both are set and differ, you pick)
  if (rec.product?.trim() && ucProduct(uc.track) !== rec.product.trim()) pick('Product__c', ucProduct(uc.track), rec.product.trim(), null, (a, b) => a === b, false);
  // the record sits on an opp the VDP no longer lists (primary changed, or the use case moved to another VDP)
  if (o.vdpOpps15 && rec.opportunityId && !o.vdpOpps15.has(id15(rec.opportunityId)) && o.chosen && id15(o.chosen.org62Id) !== id15(rec.opportunityId))
    out.push({ field: 'Opportunity__c', vdp: o.chosen.org62Id, org62: rec.opportunityId, fix: 'org62_by_hand' });
  // the opp moved to another account in Org62
  if (o.opp?.accountOrg62Id && rec.accountId && id15(o.opp.accountOrg62Id) !== id15(rec.accountId)) out.push({ field: 'Account__c', vdp: o.opp.accountOrg62Id, org62: rec.accountId, fix: 'org62_by_hand' });
  return out;
}

const DRIFT_LABEL: Record<UcDriftField, string> = { Stage__c: 'Stage', Go_Live_Date__c: 'Go-Live', Use_Case_Name__c: 'Title', Product__c: 'Product', Opportunity__c: 'Opportunity', Account__c: 'Account' };
/** The label of an Org62 Use_Case__c field the round trip compares or writes. */
export const ucFieldLabel = (f: UcDriftField) => DRIFT_LABEL[f];
const driftWords = (d: UcDrift) => `${DRIFT_LABEL[d.field]}: VDP ${d.vdp || '(empty)'} · Org62 ${d.org62 || '(empty)'}`;
const FIX_WORDS: Record<UcDriftFix, string> = { canvas: 'Org62 follows on your next logging canvas', vdp: 'VDP follows: push the item in Activity ▸ VDP', org62_by_hand: 'change it in Org62 (the app writes only Stage / Go-Live on records it created, or the value you pick on a record you own)', choose: 'both changed: pick the right one (Activity ▸ Org62 ▸ Use cases)' };

/** The VDP field and value a VDP-side drift fix sets (null when VDP has no such field). */
function vdpFieldOf(d: UcDrift): { field: string; value: string } | null {
  if (!d.org62) return null;
  if (d.field === 'Stage__c') return { field: 'execution_phase', value: d.org62 };
  if (d.field === 'Go_Live_Date__c') return { field: 'execution_target_date', value: d.org62 };
  if (d.field === 'Use_Case_Name__c') return { field: 'title', value: d.org62 };
  return null;
}

/**
 * What goes to Org62, what goes to VDP, and where every use case stands. Deterministic: the same mirror, read-back,
 * links, canvases and decisions give the same plan on both DataSources.
 */
export function planUseCases(i0: UseCasePlanInput): UseCasePlan {
  const i: UseCasePlanInput = { ...i0, vdps: i0.vdps.map((v) => ucNormalizeVdp(v)), goneVdps: (i0.goneVdps ?? []).map((v) => ucNormalizeVdp(v)), picks: i0.picks ?? ucPicksOf(i0.overrides) };
  const creates: UseCaseCreate[] = [];
  const updates: UseCaseUpdate[] = [];
  const items: UseCaseItem[] = [];
  const counts = zeroCounts();
  const vdpGaps = new Map<string, VdpGap[]>();
  const dec = i.decisions ?? NO_UC_DECISIONS;
  const records = i.org62.records;
  const byId = new Map(records.map((r) => [id15(r.id), r] as const));
  const recsByOpp = new Map<string, Org62UseCase[]>();
  for (const r of records) if (!r.goneAt && r.opportunityId) recsByOpp.set(id15(r.opportunityId), [...(recsByOpp.get(id15(r.opportunityId)) ?? []), r]);
  for (const list of recsByOpp.values()) list.sort(oldestFirst);
  const oppBy15 = new Map(i.opps.map((o) => [id15(o.org62Id), o] as const));
  // a link whose record was deleted and the user chose Add it again no longer counts
  const links = new Map(i.links.filter((l) => !dec.readd.has(ucItemKey.vdp(l.vdpUseCaseId))).map((l) => [l.vdpUseCaseId, l] as const));
  const linkedRec = new Map(i.links.map((l) => [id15(l.org62UseCaseId), l] as const));
  /** Record ids a VDP use case of this plan stands for (linked or matched), and their duplicates. */
  const claimed = new Set<string>();
  const dupOf = new Map<string, Org62UseCase>();
  const claimedTitle = new Map<string, string>(); // `${opp15}|${title}` → VDP use case id
  const mine = (r: Org62UseCase) => !!i.me && id15(r.ownerId) === id15(i.me);
  const live = new Set(i.vdps.flatMap((v) => (v.snapshot.archivedAt ? [] : v.snapshot.useCases.map((u) => u.id))));
  const addGap = (slug: string, g: VdpGap) => vdpGaps.set(slug, [...(vdpGaps.get(slug) ?? []), g]);

  const push = (item: UseCaseItem, state: UseCaseState, why: string, extra: Partial<UseCaseItem> = {}) => {
    const decided = dec.leave.has(item.key) ? 'leave' : dec.readd.has(item.key) ? 'readd' : null;
    // D-70: a use case waiting to go to Org62 (or asking you something) can be left out of it too
    const settable = state === 'drift' || state === 'gone' || state === 'org62_only' || state === 'duplicate' || state === 'create' || state === 'skipped';
    const s: UseCaseState = decided === 'leave' && settable ? 'left' : state;
    Object.assign(item, { state: s, why: s === 'left' ? `Left as it is (your choice): ${why}` : why, decided }, extra);
    counts[s] += 1;
    items.push(item);
  };
  /** Records of mine that match a title on these opps (oldest first), and the rest of them as duplicates. */
  const matchOn = (opps15: readonly string[], names: readonly string[], skip: ReadonlySet<string>) => {
    const found = [...new Set(opps15)].flatMap((o) => recsByOpp.get(o) ?? []).filter((r) => !skip.has(id15(r.id)) && names.some((n) => sameUseCaseTitle(n, r.name)));
    return found.sort(oldestFirst);
  };

  for (const v of [...i.vdps, ...(i.goneVdps ?? []).map((g) => ({ ...g, gone: true }))] as Array<UcVdp & { gone?: boolean }>) {
    const s = v.snapshot;
    if (s.isSeed && !v.gone) continue;
    const vdpChoice = ucOppFor(v, i.opps);
    const vdpOpps15 = new Set(oppIdsOf(s).map(id15));
    // D-70: the opps a use case of this VDP may go on (open, my 100% DC; listed on the VDP or on its account), for Needs you
    const pickable = i.opps.filter((o) => ucInScope(o) && (vdpOpps15.has(id15(o.org62Id)) || (!!v.accountId && o.accountId === v.accountId)));
    const ucs = [...s.useCases].sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
    for (const uc0 of ucs) {
      // D-70: your answers (Needs you): a name while VDP has none, the opp it goes on
      const ov = (i.overrides ?? NO_ROW_OVERRIDES)[ucRowKey(uc0.id)];
      const ovName = typeof ov?.fields.name === 'string' ? ov.fields.name.trim() : '';
      const ovOpp = typeof ov?.fields.opportunityId === 'string' ? pickable.find((o) => id15(o.org62Id) === id15(ov.fields.opportunityId as string)) : undefined;
      const choice = ovOpp ? { opp: ovOpp, why: 'the opp you picked' } : vdpChoice;
      const uc = !uc0.title?.trim() && ovName ? { ...uc0, title: ovName } : uc0;
      const title = uc.title?.trim() ?? '';
      const link = links.get(uc.id);
      const rec = link ? byId.get(id15(link.org62UseCaseId)) : undefined;
      const item: UseCaseItem = {
        key: ucItemKey.vdp(uc.id),
        vdpSlug: s.slug,
        vdpUrl: s.url,
        companyName: s.company.name,
        vdpUseCaseId: uc.id,
        title: title || '(untitled)',
        track: ucTrack(uc.track),
        oppName: choice?.opp.name ?? null,
        org62OpportunityId: choice?.opp.org62Id ?? null,
        state: 'skipped',
        why: '',
        org62UseCaseId: link?.org62UseCaseId ?? null,
        canvasDraftId: null,
        updates: [],
        drift: [],
        options: [],
        decided: null,
      };
      // a VDP that is archived or no longer mine: its linked record stays as it is, nothing new goes anywhere
      if (s.archivedAt || v.gone) {
        if (link) {
          claimed.add(id15(link.org62UseCaseId));
          push(item, 'in_org62', s.archivedAt ? 'Its VDP is archived: the app leaves the Org62 record as it is' : 'Its VDP is no longer one of yours: the app leaves the Org62 record as it is');
        }
        continue;
      }

      // Linked: the record is the use case, whatever the names say now.
      if (link) {
        claimed.add(id15(link.org62UseCaseId));
        const recOpp = rec?.opportunityId ? (oppBy15.get(id15(rec.opportunityId)) ?? null) : null;
        if (recOpp) {
          item.oppName = recOpp.name;
          item.org62OpportunityId = rec!.opportunityId;
        }
        if (!rec || rec.goneAt) {
          push(item, 'gone', 'Deleted in Org62 (or moved off your opps): Add it again (it goes on your next logging canvas), Leave it, or delete it in VDP too (the app never deletes)', { options: ['readd', 'leave'] });
          continue;
        }
        // its duplicates (a double export): records of mine with the same title on the same opp
        for (const d of matchOn([id15(rec.opportunityId ?? '')], [rec.name ?? '', title], new Set([id15(rec.id), ...linkedRec.keys()])).filter(mine)) dupOf.set(id15(d.id), rec);
        const owned = link.origin === 'app' && mine(rec);
        const drift = ucDrift(uc, rec, link, { owned, opp: recOpp, vdpOpps15, chosen: choice?.opp ?? null, mine: mine(rec), picks: i.picks });
        // Org62 follows VDP (canvas): Stage / Go-Live on records the app created that I own; any of the four on your pick
        const picked = (f: UcDriftField) => !!i.picks?.get(ucPickKey(uc.id, f));
        const ups: UseCaseUpdate[] = drift
          .filter((d) => d.fix === 'canvas' && d.field !== 'Opportunity__c' && d.field !== 'Account__c')
          .flatMap((d): UseCaseUpdate[] => {
            const field = d.field as UcUpdateField;
            const newValue = field === 'Stage__c' ? ucStage(uc.executionPhase) : d.vdp;
            const currentValue = (field === 'Stage__c' ? rec.stage : field === 'Go_Live_Date__c' ? rec.goLive : field === 'Use_Case_Name__c' ? rec.name : rec.product) ?? '(blank)';
            const why = picked(field) ? `your pick: VDP's ${DRIFT_LABEL[field]} ${d.vdp}` : field === 'Stage__c' ? `VDP execution phase is ${uc.executionPhase}` : `VDP target date is ${d.vdp}`;
            return newValue ? [{ vdpUseCaseId: uc.id, recordId: rec.id, field, newValue, currentValue, name: title || rec.name || '', why }] : [];
          });
        // VDP follows Org62 (or the user picks): one update_use_case item under the VDP
        for (const d of dec.leave.has(item.key) ? [] : drift.filter((x) => x.fix === 'vdp' || x.fix === 'choose')) {
          const f = vdpFieldOf(d);
          if (!f) continue;
          addGap(s.slug, {
            id: `${s.slug}:use_case_drift:${uc.id}:${f.field}`,
            code: 'use_case_drift',
            severity: 'medium',
            title: `${title || 'Use case'}: ${driftWords(d)}`,
            vdpSlug: s.slug,
            vdpUrl: s.url,
            useCaseId: uc.id,
            useCaseTitle: title || null,
            accountId: v.accountId,
            opportunityId: recOpp?.id ?? null,
            fix: { kind: 'app', op: 'update_use_case', field: f.field, current: (f.field === 'execution_phase' ? uc.executionPhase : f.field === 'execution_target_date' ? ucGoLive(uc.executionTargetDate) || null : uc.title) ?? null, suggested: f.value, options: [], values: {}, known: false, unsupported: null },
            check: 'wrong',
            why: d.fix === 'choose' ? `Both changed since they last agreed: push this to take Org62's value, or change Org62 to VDP's (${d.vdp}) by hand` : `Org62 changed it to ${d.org62}${d.vdp ? ` (VDP: ${d.vdp})` : ''}: push this to bring VDP along`,
          });
        }
        const diff = ups.map((u) => ({ field: u.field, from: u.currentValue, to: u.newValue }));
        const heldBy = ups.map((u) => i.holds.held.get(ucUpdateKey(u.recordId, u.field))).find(Boolean) ?? null;
        const take = ups.filter((u) => {
          const k = ucUpdateKey(u.recordId, u.field);
          if (i.holds.held.has(k)) return false;
          const sent = i.holds.sent.get(k);
          return !sent || readAfter(i.org62.readAt, sent.at);
        });
        const rest = drift.filter((d) => d.fix !== 'canvas');
        const restWhy = rest.length ? ` · ${rest.map((d) => `${driftWords(d)}: ${FIX_WORDS[d.fix]}`).join(' · ')}` : '';
        if (take.length) {
          updates.push(...take.map((u) => ({ ...u, newValue: updateOverrideOf(i.overrides ?? NO_ROW_OVERRIDES, USE_CASE_OBJECT, u.recordId, u.field) ?? u.newValue })));
          push(item, 'update', `${take.some((u) => picked(u.field)) ? 'Your pick' : 'VDP changed'}: ${take.map((u) => `${DRIFT_LABEL[u.field]} ${u.currentValue} → ${u.newValue}`).join(', ')} on your next logging canvas${restWhy}`, { updates: diff, drift });
        } else if (heldBy) push(item, 'in_canvas', `Its field fix is on a logging canvas waiting for your Apply on Activity${restWhy}`, { updates: diff, drift, canvasDraftId: heldBy });
        else if (ups.length) push(item, 'handed_off', `Its field fix is on a canvas you applied: waiting for Slackbot and the next Org62 read${restWhy}`, { updates: diff, drift, canvasDraftId: ups.map((u) => i.holds.sent.get(ucUpdateKey(u.recordId, u.field))?.draftId).find(Boolean) ?? null });
        else if (rest.length) push(item, 'drift', rest.map((d) => `${driftWords(d)}: ${FIX_WORDS[d.fix]}`).join(' · '), { drift, options: ['leave'] });
        else push(item, 'in_org62', link.origin === 'app' ? (mine(rec) ? 'In Org62 and the same in VDP' : 'In Org62, now owned by someone else: the app never changes it') : 'In Org62 (it was there before the app logged it) and the same in VDP');
        continue;
      }

      if (!title) {
        push(item, 'skipped', 'No title in VDP yet: a use case needs a name before it goes to Org62', { question: { code: 'no_title', opps: [] }, options: ['leave'] });
        continue;
      }
      // what Org62 has under this title on any opp of the VDP (or under the name and opp a sent canvas gave it)
      const sent = i.holds.sentCreates.get(uc.id);
      const opps15 = [...vdpOpps15, ...(choice ? [id15(choice.opp.org62Id)] : []), ...(sent ? [id15(sent.opportunityId)] : [])];
      const names = [title, sent?.name].filter((x): x is string => !!x);
      const found = matchOn(opps15, names, new Set(linkedRec.keys()));
      const free = found.filter((r) => !claimed.has(id15(r.id)));
      if (found.length) {
        const own = free.find(mine);
        if (own) {
          claimed.add(id15(own.id));
          for (const d of free.filter((r) => r !== own && mine(r))) dupOf.set(id15(d.id), own);
          push(item, 'in_org62', 'Already in Org62 (yours): linked on the next Org62 read', { org62UseCaseId: own.id });
        } else if (free.length) {
          claimed.add(id15(free[0]!.id));
          push(item, 'others', `Org62 already has it on ${oppBy15.get(id15(free[0]!.opportunityId ?? ''))?.name ?? 'the opp'}, owned by someone else: the app never touches it`, { org62UseCaseId: free[0]!.id });
        } else push(item, 'skipped', 'Another VDP use case already has this title on the opp: rename one of them in VDP');
        continue;
      }
      if (!choice) {
        const why = noOppWhy(v, i.opps);
        const opps = pickable.map((o) => ({ org62Id: o.org62Id, name: o.name }));
        const question: UcQuestion | null = why.startsWith('Waiting for your 100% DC') && !opps.length ? { code: 'waiting_dc', opps: [] } : opps.length ? { code: 'pick_opp', opps } : null;
        push(item, 'skipped', why, { question, options: ['leave'] });
        continue;
      }
      const opp = choice.opp;
      // Account__c: the opp's account in Org62 (an opp that moved takes its new account); the VDP header's otherwise
      const account = opp.accountOrg62Id || s.salesforceAccountId?.trim() || null;
      if (!account) {
        push(item, 'skipped', 'No Org62 account id (the opp’s account or the VDP header): Account__c is required', { question: { code: 'no_account', opps: pickable.filter((o) => o.accountOrg62Id && id15(o.org62Id) !== id15(opp.org62Id)).map((o) => ({ org62Id: o.org62Id, name: o.name })) }, options: ['leave'] });
        continue;
      }
      const tk = `${id15(opp.org62Id)}|${ucNameKey(title)}`;
      const dup = [...claimedTitle.entries()].find(([k]) => k.startsWith(`${id15(opp.org62Id)}|`) && sameUseCaseTitle(k.slice(16), title));
      if (dup && dup[1] !== uc.id) {
        push(item, 'skipped', 'Another VDP use case has (nearly) the same title on this opp: rename one of them in VDP');
        continue;
      }
      claimedTitle.set(tk, uc.id);
      const held = i.holds.held.get(ucCreateKey(uc.id));
      if (held) {
        push(item, 'in_canvas', 'On a logging canvas waiting for your Apply on Activity', { canvasDraftId: held });
        continue;
      }
      const again = dec.readd.has(item.key);
      if (sent && !readAfter(i.org62.readAt, sent.at) && !again) {
        push(item, 'handed_off', 'On a canvas you applied: waiting for Slackbot and the next Org62 read', { canvasDraftId: sent.draftId });
        continue;
      }
      if (!i.org62.readAt) {
        push(item, 'skipped', 'Waiting for the first Org62 read of your use cases (Health ▸ Org62 ▸ Re-check Org62 records)');
        continue;
      }
      const createWhy = again ? 'You chose Add it again: it goes on your next logging canvas' : sent ? 'Not in Org62 two days after the canvas you applied: offered again (Slackbot skips it if it did land)' : `Goes on ${opp.name} (${choice.why})`;
      // D-70: left out of Org62 by you: nothing goes (Undo brings it back)
      if (dec.leave.has(item.key)) {
        push(item, 'create', createWhy, { options: ['leave'] });
        continue;
      }
      creates.push(withUcOverride(ucCreateRow(v, uc, opp, account, !!sent || again), (i.overrides ?? NO_ROW_OVERRIDES)[ucRowKey(uc.id)]));
      push(item, 'create', createWhy, { options: ['leave'] });
    }
  }

  // Org62 → VDP: the records on my opps no VDP use case stands for
  const vdpForOpp = (opp15: string) => {
    const on = i.vdps.filter((v) => !v.snapshot.archivedAt && !v.snapshot.isSeed && oppIdsOf(v.snapshot).some((x) => id15(x) === opp15));
    if (on.length) return on[0]!;
    const opp = oppBy15.get(opp15);
    const acct = opp?.accountId ? i.vdps.filter((v) => !v.snapshot.archivedAt && !v.snapshot.isSeed && v.accountId === opp.accountId) : [];
    return acct.length === 1 ? acct[0]! : null;
  };
  for (const r of [...records].sort(oldestFirst)) {
    const k15 = id15(r.id);
    if (r.goneAt || claimed.has(k15) || !r.opportunityId) continue;
    const opp = oppBy15.get(id15(r.opportunityId)) ?? null;
    const was = linkedRec.get(k15);
    const v = vdpForOpp(id15(r.opportunityId));
    const item: UseCaseItem = {
      key: ucItemKey.rec(r.id),
      vdpSlug: v?.snapshot.slug ?? null,
      vdpUrl: v?.snapshot.url ?? null,
      companyName: v?.snapshot.company.name ?? opp?.name ?? '',
      vdpUseCaseId: null,
      title: r.name?.trim() || '(untitled)',
      track: trackOfProduct(r.product),
      oppName: opp?.name ?? null,
      org62OpportunityId: r.opportunityId,
      state: 'org62_only',
      why: '',
      org62UseCaseId: r.id,
      canvasDraftId: null,
      updates: [],
      drift: [],
      options: ['leave'],
      decided: null,
    };
    const dupe = dupOf.get(k15);
    if (dupe) {
      push(item, 'duplicate', `Duplicate in Org62 of ${dupe.id} (same opp and title): delete the extra one in Org62 (the app never deletes)`);
      continue;
    }
    // a record linked to a VDP use case VDP no longer has (deleted in VDP)
    const vdpGone = was && !live.has(was.vdpUseCaseId);
    if (!v) {
      push(item, 'org62_only', `Org62 has it; ${opp ? `no VDP of yours lists ${opp.name} yet` : 'its opp is not one the app knows'}: once the VDP exists, adding it there is an item in Activity ▸ VDP`);
      continue;
    }
    const slug = v.snapshot.slug;
    if (!dec.leave.has(item.key))
      addGap(slug, {
        id: `${slug}:org62_use_case:${k15}`,
        code: 'org62_use_case',
        severity: 'medium',
        title: `Add “${r.name?.trim() || 'Use case'}” from Org62`,
        vdpSlug: slug,
        vdpUrl: v.snapshot.url,
        useCaseId: null,
        useCaseTitle: r.name?.trim() || null,
        accountId: v.accountId,
        opportunityId: opp?.id ?? null,
        fix: { kind: 'app', op: 'create_use_case', field: 'title', current: null, suggested: r.name?.trim() || null, options: [], values: { track: trackOfProduct(r.product), org62_use_case_id: r.id }, known: false, unsupported: null },
        check: 'missing',
        why: vdpGone ? `Org62 still has it on ${opp?.name ?? 'the opp'}, but VDP no longer does (deleted in VDP?): add it back, or Leave it` : `Org62 has it on ${opp?.name ?? 'the opp'}${mine(r) ? '' : ' (someone else’s record)'}; this VDP doesn’t`,
      });
    push(item, 'org62_only', vdpGone ? 'Deleted in VDP, still in Org62: add it back to VDP (an item in Activity ▸ VDP), Leave it, or delete it in Org62 (the app never deletes)' : 'Org62 has it, VDP doesn’t: adding it to VDP is an item in Activity ▸ VDP', { vdpSlug: slug });
  }
  return { creates: creates.sort(createOrder), updates, items, counts, vdpGaps };
}

// ---------------------------------------------------------------------------
// Links: what a read ties together
// ---------------------------------------------------------------------------

export interface UseCaseLinkChanges {
  /** New links (a record found for a VDP use case). */
  add: UseCaseLink[];
  /** Links whose synced values move to what VDP and Org62 now agree on. */
  synced: Array<Pick<UseCaseLink, 'vdpUseCaseId'> & Partial<Pick<UseCaseLink, 'syncedStage' | 'syncedGoLive' | 'syncedName'>>>;
}

/**
 * After a read: tie each VDP use case to its record. A create row a sent canvas carried links to my oldest record
 * with that opp and title (origin `app`, synced to what the canvas sent); a use case whose record was already there,
 * or one added to VDP from Org62, links as `adopted` (synced where the two agree, so a later change on one side has a
 * direction). A linked pair whose values now agree moves its synced values there (an update landed, or someone made
 * the two the same by hand), so it is never sent again.
 */
export function reconcileUseCaseLinks(i0: UseCasePlanInput): UseCaseLinkChanges {
  const i: UseCasePlanInput = { ...i0, vdps: i0.vdps.map((v) => ucNormalizeVdp(v)) };
  const add: UseCaseLink[] = [];
  const synced: UseCaseLinkChanges['synced'] = [];
  const dec = i.decisions ?? NO_UC_DECISIONS;
  const mine = (r: Org62UseCase) => !!i.me && id15(r.ownerId) === id15(i.me);
  const links = new Map(i.links.filter((l) => !dec.readd.has(ucItemKey.vdp(l.vdpUseCaseId))).map((l) => [l.vdpUseCaseId, l] as const));
  const taken = new Set([...links.values()].map((l) => id15(l.org62UseCaseId)));
  const byId = new Map(i.org62.records.map((r) => [id15(r.id), r] as const));
  const recsByOpp = new Map<string, Org62UseCase[]>();
  for (const r of [...i.org62.records].sort(oldestFirst)) if (!r.goneAt && r.opportunityId && mine(r)) recsByOpp.set(id15(r.opportunityId), [...(recsByOpp.get(id15(r.opportunityId)) ?? []), r]);
  for (const v of i.vdps) {
    if (v.snapshot.archivedAt) continue;
    const choice = ucOppFor(v, i.opps);
    const vdpOpps = oppIdsOf(v.snapshot).map(id15);
    for (const uc of v.snapshot.useCases) {
      const link = links.get(uc.id);
      if (link) {
        const rec = byId.get(id15(link.org62UseCaseId));
        if (!rec || rec.goneAt) continue;
        const ch: UseCaseLinkChanges['synced'][number] = { vdpUseCaseId: uc.id };
        if (uc.executionPhase && phaseKey(uc.executionPhase) === phaseKey(phaseOfStage(rec.stage)) && rec.stage && rec.stage !== link.syncedStage) ch.syncedStage = rec.stage;
        const goLive = ucGoLive(uc.executionTargetDate);
        if (goLive && goLive === rec.goLive && goLive !== link.syncedGoLive) ch.syncedGoLive = goLive;
        if (uc.title?.trim() && ucNameKey(uc.title) === ucNameKey(rec.name) && rec.name !== link.syncedName) ch.syncedName = rec.name;
        if (ch.syncedStage !== undefined || ch.syncedGoLive !== undefined || ch.syncedName !== undefined) synced.push(ch);
        continue;
      }
      const title = uc.title?.trim();
      if (!title) continue;
      const sent = i.holds.sentCreates.get(uc.id);
      const opps15 = [...new Set([...(sent ? [id15(sent.opportunityId)] : []), ...(choice ? [id15(choice.opp.org62Id)] : []), ...vdpOpps])];
      const names = [sent?.name, title].filter((x): x is string => !!x);
      const rec = opps15.flatMap((o) => recsByOpp.get(o) ?? []).find((r) => !taken.has(id15(r.id)) && names.some((n) => sameUseCaseTitle(n, r.name)));
      if (!rec) continue;
      // an `app` record was made by Slackbot after the canvas was sent (as me); anything older was already there
      const madeByCanvas = !!sent && (!rec.createdAt || Date.parse(rec.createdAt) >= Date.parse(sent.at) - 3_600_000);
      const agree = (a: string, b: string) => !!a && a === b;
      add.push(
        madeByCanvas
          ? { vdpUseCaseId: uc.id, org62UseCaseId: rec.id, origin: 'app', syncedStage: sent!.stage || rec.stage || null, syncedGoLive: sent!.goLive || rec.goLive || null, syncedName: sent!.name || rec.name }
          : {
              vdpUseCaseId: uc.id,
              org62UseCaseId: rec.id,
              origin: 'adopted',
              syncedStage: phaseKey(uc.executionPhase) === phaseKey(phaseOfStage(rec.stage)) ? rec.stage : null,
              syncedGoLive: agree(ucGoLive(uc.executionTargetDate), rec.goLive ?? '') ? rec.goLive : null,
              syncedName: ucNameKey(title) === ucNameKey(rec.name) ? rec.name : null,
            },
      );
      taken.add(id15(rec.id));
    }
  }
  return { add, synced };
}

// ---------------------------------------------------------------------------
// Before proposing a new use case: does either system (or a staged item) have it already?
// ---------------------------------------------------------------------------

export interface UcExistingContext {
  /** Every VDP of the company the app knows (live, past and gone from my list). */
  vdps: readonly Pick<VdpSnapshot, 'slug' | 'useCases'>[];
  /** The account's Use_Case__c (any owner, any of its opps). */
  records: readonly Pick<Org62UseCase, 'id' | 'name' | 'goneAt'>[];
  /** Use cases on their way: staged or applied VDP creates, and canvas rows. */
  pending: ReadonlyArray<{ title: string; where: string }>;
  /** VDPs of the company I am not on (VDP's `get_company` vdp_count, when the mirror has it). */
  hiddenVdps?: number;
}

/**
 * The use case a proposed title already is, anywhere: a VDP use case (past VDPs too), a Use_Case__c, or something
 * staged. `exclude` leaves out the record an Org62 → VDP item comes from. Null: it is new (hidden VDPs aside).
 */
export function ucExisting(title: string, ctx: UcExistingContext, exclude: { org62UseCaseId?: string | null } = {}): { where: 'vdp' | 'org62' | 'pending'; label: string } | null {
  if (!title.trim()) return null;
  for (const v of ctx.vdps) {
    const u = v.useCases.find((x) => sameUseCaseTitle(x.title, title));
    if (u) return { where: 'vdp', label: `“${u.title?.trim()}” on VDP ${v.slug}` };
  }
  for (const r of ctx.records) {
    if (r.goneAt || (exclude.org62UseCaseId && id15(r.id) === id15(exclude.org62UseCaseId))) continue;
    if (sameUseCaseTitle(r.name, title)) return { where: 'org62', label: `“${r.name?.trim()}” in Org62 (${r.id})` };
  }
  for (const p of ctx.pending) if (sameUseCaseTitle(p.title, title)) return { where: 'pending', label: `“${p.title}” ${p.where}` };
  return null;
}

// ---------------------------------------------------------------------------
// The canvas rows
// ---------------------------------------------------------------------------

export const UC_TITLE = '# USE CASES (';
export const UC_HEADER = '|#|Object|Use_Case_Name__c|Opportunity__c|Account__c|Product__c|Use_Case_Agent_Type__c|Entitlement_Leveraged__c|Stage__c|Go_Live_Date__c|Business_Problem_Solved__c|Business_Problem_KPIs__c|Notes__c|';
const UC_SEP = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';

/** The rule Slackbot follows for use-case rows: create as me, skip any opp + name that exists, never edit or delete others. */
export function ucRule(n: number, ownerOrg62Id: string, has: { creates: boolean; updates: boolean }): string {
  const who = ownerOrg62Id ? `\`${ownerOrg62Id}\`` : 'the owner';
  const parts: string[] = [];
  if (has.creates)
    parts.push(
      `**USE CASES table:** create one Use_Case__c per row with OwnerId ${who}, and Use_Case_Name__c, Opportunity__c, Account__c, Product__c, Use_Case_Agent_Type__c (a multi-select: its values are separated by \`;\`), Entitlement_Leveraged__c, Stage__c and Go_Live_Date__c (only when given), Business_Problem_Solved__c, Business_Problem_KPIs__c and Notes__c exactly as given, with every ⏎ replaced by a line break; set Is_Internal__c = \`Customer Facing\` and IsSlackbot__c = false. Skip a row ONLY if a Use_Case__c with the same Opportunity__c and Use_Case_Name__c already exists, whoever owns it, and report it as skipped. Never edit or delete an existing use case from this table.`,
    );
  if (has.updates) parts.push(`**UPDATE table, rows with Object = Use_Case__c:** change only that Use_Case__c (the Record Id), and only if ${who} owns it: set Field = New value, nothing else.`);
  return `${n}. ${parts.join(' ')}`;
}

/** One USE CASES row (numbered `n`): what Slackbot creates. */
export const ucCreateLine = (n: number, c: UseCaseCreate) =>
  `|${n}|Use_Case__c|${cell(c.name)}|${cell(c.opportunityId)}|${cell(c.accountId)}|${cell(c.product)}|${cell(c.agentTypes.join(';'))}|${cell(c.entitlement)}|${cell(c.stage)}|${cell(c.goLive)}|${cell(c.businessProblem)}|${cell(c.kpis)}|${cell(c.notes)}|`;
/** One UPDATE row on a Use_Case__c (a Stage / Go-Live fix). */
export const ucUpdateLine = (n: number, u: UseCaseUpdate) => `|${n}|Use_Case__c|${cell(u.recordId)}|${u.field}|${cell(u.newValue)}|${cell(u.currentValue)}|${cell(`${u.name}: ${u.why}`)}|`;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * A rendered work order with use-case rows added: the rule after the ADD-table rules (before the UPDATE rule; the rules
 * after it number on), a USE CASES table before the UPDATE table, and Stage / Go-Live fixes at the end of the UPDATE
 * table. Unchanged when there is nothing to add.
 */
export function withUseCaseRows(markdown: string, creates: readonly UseCaseCreate[], ups: readonly UseCaseUpdate[], ownerOrg62Id: string): string {
  if (!creates.length && !ups.length) return markdown;
  let out = markdown.split('\n');
  const upAt = out.findIndex((l) => l.startsWith('# UPDATE ('));
  if (upAt < 0) throw new Error('work order has no UPDATE table');
  if (ups.length) {
    let end = out.findIndex((l, i) => i > upAt && l.startsWith('|---')) + 1;
    let lastN = 0;
    for (; end > 0 && end < out.length && out[end]!.startsWith('|'); end++) lastN = Number(out[end]!.split('|')[1]) || lastN;
    out = [...out.slice(0, end), ...ups.map((u, k) => ucUpdateLine(lastN + k + 1, u)), ...out.slice(end)];
    out[upAt] = out[upAt]!.replace(/^# UPDATE \((\d+) rows?/, (_, n: string) => `# UPDATE (${Number(n) + ups.length} rows`).replace(/\)$/, ` · ${plural(ups.length, 'use-case fix')})`);
  }
  if (creates.length) {
    const table = [`${UC_TITLE}${plural(creates.length, 'row')})`, '', UC_HEADER, UC_SEP, ...creates.map((c, k) => ucCreateLine(k + 1, c)), ''];
    out.splice(upAt, 0, ...table);
  }
  const gen = out.findIndex((l) => l.startsWith('_Generated'));
  const ruleEnd = gen < 0 ? out.length : gen;
  const numbered = out.slice(0, ruleEnd).flatMap((l, i) => (/^\d+\. /.test(l) ? [i] : []));
  if (!numbered.length) return out.join('\n');
  const at = numbered.find((i) => /^\d+\. \*\*UPDATE table/.test(out[i]!)) ?? numbered.at(-1)! + 1;
  const n = at <= numbered.at(-1)! ? Number(/^(\d+)\./.exec(out[at]!)![1]) : Number(/^(\d+)\./.exec(out[numbered.at(-1)!]!)![1]) + 1;
  for (const i of numbered) if (i >= at) out[i] = out[i]!.replace(/^(\d+)\./, (_, k: string) => `${Number(k) + 1}.`);
  out.splice(at, 0, ucRule(n, ownerOrg62Id, { creates: creates.length > 0, updates: ups.length > 0 }));
  return out.join('\n');
}

/** The use-case rows a work order carries: creates (USE CASES table) and Stage / Go-Live fixes (UPDATE table). */
export function ucRowsIn(markdown: string): { creates: UcCanvasCreate[]; updates: UcCanvasUpdate[] } {
  const creates: UcCanvasCreate[] = [];
  const updates: UcCanvasUpdate[] = [];
  let section: 'uc' | 'update' | null = null;
  for (const ln of markdown.split('\n')) {
    if (ln.startsWith('# ')) section = ln.startsWith(UC_TITLE) ? 'uc' : ln.startsWith('# UPDATE') ? 'update' : null;
    if (!section || !ln.startsWith('|')) continue;
    const c = ln.split('|');
    if (c[2] !== USE_CASE_OBJECT) continue;
    if (section === 'uc') {
      // ['', n, obj, name, opp, account, product, agent, entitlement, stage, goLive, bp, kpis, notes, '']
      const key = CC_UC.exec(c[13] ?? '')?.[1];
      if (key) creates.push({ vdpUseCaseId: key, opportunityId: c[4] ?? '', name: (c[3] ?? '').trim(), stage: (c[9] ?? '').trim(), goLive: (c[10] ?? '').trim() });
    } else if (c[3] && c[4]) updates.push({ recordId: c[3].trim(), field: c[4].trim(), newValue: (c[5] ?? '').trim() });
  }
  return { creates, updates };
}
