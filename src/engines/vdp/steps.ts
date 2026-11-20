/**
 * A VDP's open items (pure): the gaps from src/engines/vdp/gaps.ts and the open asset candidates, rolled up into one
 * item per VDP call, each with its Apply (`apply`: the call you push or Apply), where it sits under its VDP
 * (`section`), what must be applied first (`requires`), and, when VDP's MCP can't take it yet, why it is disabled.
 * D-63: there are no handoffs: every item is a VDP call, or the in-app "Find assets".
 *
 *   a VDP        opportunities (add an engaged opp, link one, remove a closed-lost one) · people (the AE from the
 *                Specialist Forecast, the TA = me) · use cases (a new one and its Generate, each one's empty inputs and
 *                its Generate after them; D-67: a Use_Case__c the VDP lacks, and Org62's values where the two disagree) · assets (strong candidates are their own items, made in coverage; Find assets
 *                when there are none) · header (account id, fiscal period, what looks wrong, the entitlement leveraged)
 *   no VDP yet   the company (when VDP lacks it) → the VDP (company, account id, opps and period in one call) → what
 *                it needs under it (the AE and TA, a use case and its Generate, Find assets), each `requires` the ones
 *                above it, so a push applies them in order and passes the new ids down
 *
 * State: todo · staged (its Apply waits for you, `draftId`) · waiting (applied after the last VDP read: the next read
 * confirms it). `blocked` is no longer made: an item that needs another first names it in `requires`.
 */
import type { VdpApply, VdpApplyField, VdpAssetCandidate, VdpGap, VdpStep, VdpValue } from '@/contract';
import { VDP_ENTITLEMENT_VALUES, VDP_FIELD_LABEL, VDP_FIELD_OPTIONS, VDP_PRIORITY_VALUES } from '@/lib/vdp/payload';

/** An Outbox item staged for an item (waiting for your Apply) or applied (waiting for the next VDP read). */
export interface DraftRef {
  id: string;
  /** D-69 (VD-23): `maybe` = a create that may have reached VDP (timed out, or its read-back could not tell). */
  state: 'staged' | 'applied' | 'maybe';
  /** Staged: when it was staged; applied: when the Apply reached VDP. */
  at: string;
  /** D-63: what VDP returned for a create (its new id), once applied. */
  externalId?: string | null;
  /** D-63: where the result lives (a new VDP's link carries its slug). */
  resultUrl?: string | null;
  /** D-63: the staged payload still waits for a parent's new id (it is staged again once that is known). */
  pending?: boolean;
  /** Its read-back confirmed it in VDP. */
  verified?: boolean;
}

export interface StepsInput {
  /** The details key: the VDP's slug, or `account:<id>` when there is no VDP yet. */
  key: string;
  companyName: string;
  /** The VDP's label ("Acme FY27 Q4"); null when there is no VDP yet. */
  vdpLabel: string | null;
  /** The VDP's gaps, or the account's (company not in VDP, opp without VDP, and what the new VDP needs). */
  gaps: readonly VdpGap[];
  /** Open candidates (unsure, suggested, added) for this VDP. */
  candidates: readonly (Pick<VdpAssetCandidate, 'id' | 'status' | 'title'> & { statusAt?: string | null })[];
  /** The VDP's use cases (their titles), for the per-use-case items. */
  useCases: ReadonlyArray<{ id: string; title: string }>;
  /** New VDP (`<base>/vdp/new`). Kept for callers; no item links there any more (D-63). */
  newVdpUrl?: string;
  /** Staged and applied Outbox items by item key (src/engines/vdp/status.ts `vdpDraftRefs`). */
  drafts?: ReadonlyMap<string, DraftRef>;
  /** When VDP was last read (this VDP's row, or the mirror's newest read). */
  lastReadAt?: string | null;
  /** add_vdp_asset is available: each suggested candidate is its own item (in coverage). */
  addAsset?: boolean;
  /** D-63: create_vdp takes `entitlement_leveraged` (an optional input on the new VDP). */
  entitlementCreate?: boolean;
  /** D-63: create_company takes `sales_segment_id`: VDP's segments (labels) for its optional input. */
  salesSegments?: readonly string[] | null;
}

/** The prefix of the item keys of the VDP an account is about to get (`account:<id>:new_vdp`). */
export const newVdpSlug = (accountId: string) => `account:${accountId}:new_vdp`;

/** Which ids of an item's call come from the items it `requires` (D-63): their Apply keys. */
export interface IdSources {
  /** create_vdp under a new company: its company id. */
  companyId?: string;
  /** Anything under a new VDP: its VDP id. */
  vdpId?: string;
  /** The Generate of a new use case: its use case id. */
  useCaseId?: string;
}

/** The parents an item's ids come from, by its op and what it requires (pure; the push resolves them in order). */
export function idSources(s: { op: string; requires: readonly string[] }): IdSources {
  const out: IdSources = {};
  for (const k of s.requires) {
    if (/^account:[^:]+:create_company$/.test(k) && s.op === 'create_vdp') out.companyId = k;
    else if (/^account:[^:]+:create_vdp$/.test(k) && s.op !== 'create_vdp' && s.op !== 'create_company') out.vdpId = k;
    else if (/:create_use_case$/.test(k) && s.op === 'generate_use_case') out.useCaseId = k;
  }
  return out;
}

/** Item keys (`VdpApply.key`, the staged draft's `itemKey`), stable across reads. */
export const itemKey = {
  linkOpp: (slug: string) => `${slug}:link_opp`,
  accountId: (slug: string) => `${slug}:account_id`,
  fiscalPeriod: (slug: string) => `${slug}:fiscal_period`,
  createUseCase: (slug: string) => `${slug}:create_use_case`,
  /** D-63: the Generate of the use case the create_use_case item makes. */
  generateNew: (slug: string) => `${slug}:create_use_case:generate`,
  useCase: (slug: string, ucId: string) => `${slug}:use_case:${ucId}`,
  generate: (slug: string, ucId: string) => `${slug}:generate:${ucId}`,
  /** Before D-63: AE and TA in one item. */
  owners: (slug: string) => `${slug}:owners`,
  /** D-63: one item per role (each set_vdp_owners call sends that role's full list). */
  ae: (slug: string) => `${slug}:owners:ae`,
  /** D-69 (VD-30): add the AE the Specialist Forecast names now (the live list plus them). */
  aeAdd: (slug: string) => `${slug}:owners:ae:add`,
  ta: (slug: string) => `${slug}:owners:ta`,
  asset: (candidateId: string) => `asset:${candidateId}`,
  addOpp: (oppId: string) => `opp:${oppId}:add`,
  removeOpp: (slug: string, oppId: string) => `${slug}:remove_opp:${oppId}`,
  entitlement: (slug: string) => `${slug}:entitlement`,
  createVdp: (accountId: string) => `account:${accountId}:create_vdp`,
  createCompany: (accountId: string) => `account:${accountId}:create_company`,
  /** A looks-wrong check's suggested fix (D-60): `fiscal_period`, `account_id`. */
  check: (slug: string, what: string) => `${slug}:check:${what}`,
  /** D-67: add a Use_Case__c this VDP lacks (its record id, 15). */
  org62UseCase: (slug: string, recordId: string) => `${slug}:org62_use_case:${recordId}`,
  /** D-67: take Org62's values into a use case they disagree on. */
  useCaseDrift: (slug: string, ucId: string) => `${slug}:use_case_drift:${ucId}`,
};

type StepDefaults = 'detail' | 'blockedBy' | 'blockedReason' | 'gaps' | 'handoff' | 'candidateIds' | 'state' | 'who' | 'apply' | 'draftId' | 'policy' | 'suggestion' | 'autopilot' | 'check' | 'requires' | 'disabled' | 'section' | 'parentKey';
const step = (s: Omit<VdpStep, StepDefaults> & Partial<VdpStep>): VdpStep => ({
  detail: null,
  state: 'todo',
  who: 'app',
  apply: null,
  draftId: null,
  blockedBy: null,
  blockedReason: null,
  gaps: [],
  handoff: null,
  candidateIds: [],
  // who applies it, its suggestion and autopilot's part are set by the coverage pass (src/engines/vdp/autopilot.ts)
  policy: 'you',
  suggestion: null,
  autopilot: null,
  check: 'missing',
  requires: [],
  disabled: null,
  section: null,
  parentKey: null,
  ...s,
});

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
type AppFix = Extract<VdpGap['fix'], { kind: 'app' }>;
const isApp = (g: VdpGap): g is VdpGap & { fix: AppFix } => g.fix.kind === 'app';
const MULTILINE = new Set(['details_input', 'description']);

function field(f: string, o: Partial<VdpApplyField> = {}): VdpApplyField {
  return { field: f, label: VDP_FIELD_LABEL[f] ?? f, current: null, suggested: null, options: [...(VDP_FIELD_OPTIONS[f] ?? [])], required: false, multiline: MULTILINE.has(f), fixed: false, ...o };
}

/** The fields an app fix's call sets: its own field, then the ones it carries (`values`, ids the app knows). */
function fieldsOfFix(fix: AppFix, required: boolean): VdpApplyField[] {
  // the VDP company of a new VDP is an id the app found (list_companies) or the one the company item makes: shown, not typed
  const own = field(fix.field, { current: fix.current, suggested: fix.suggested, options: fix.options.length ? fix.options : [...(VDP_FIELD_OPTIONS[fix.field] ?? [])], required, fixed: fix.field === 'company_id' });
  const more = Object.entries(fix.values ?? {}).map(([f, v]) => field(f, { suggested: v as VdpValue, fixed: !/^fiscal_/.test(f), required: /^fiscal_/.test(f) }));
  return [own, ...more];
}

/** The first reason an item's fixes can't be pushed yet (D-63). */
const disabledOf = (fixes: readonly AppFix[]) => fixes.map((f) => f.unsupported).find((x): x is string => !!x) ?? null;

/** An item made of app fixes of one op: its Apply, its state from the drafts, disabled when VDP can't take it. */
function item(i: StepsInput, s: Parameters<typeof step>[0] & { gaps: VdpGap[] }, apply: (fixes: AppFix[]) => VdpApply): VdpStep {
  const fixes = s.gaps.filter(isApp).map((g) => g.fix);
  const ok = fixes.length === s.gaps.length && fixes.length > 0 && fixes.every((f) => f.op === fixes[0]!.op);
  if (!ok) return step({ ...s, disabled: 'Nothing for the app to send' });
  const a = apply(fixes);
  return withDraft(i, step({ ...s, apply: a, disabled: s.disabled ?? disabledOf(fixes) }), a.key);
}

/**
 * Staged → `staged`; applied after the last read → `waiting` (the read confirms it); D-69 (VD-23): a create that may
 * have reached VDP, or one applied before a read that still does not show it → `maybe_made` (a push looks first);
 * else as built.
 */
function withDraft(i: StepsInput, s: VdpStep, key: string): VdpStep {
  const d = i.drafts?.get(key);
  if (!d) return s;
  if (d.state === 'maybe') return { ...s, state: 'maybe_made', draftId: d.id };
  if (d.state === 'staged') return { ...s, state: 'staged', draftId: d.id };
  if (!i.lastReadAt || d.at > i.lastReadAt) return { ...s, state: 'waiting', draftId: d.id };
  if (s.apply && CREATE_OPS.has(s.apply.op) && d.state === 'applied' && !d.verified) return { ...s, state: 'maybe_made', draftId: d.id };
  return s;
}
const CREATE_OPS = new Set(['create_company', 'create_vdp', 'create_use_case']);

/** The asset candidates that are not their own items (to confirm, or marked added by hand earlier): one info row. */
function assetsStep(i: StepsInput, id: string, requires: string[]): VdpStep | null {
  const open = i.candidates.filter((c) => c.status === 'unsure' || c.status === 'added' || (c.status === 'suggested' && !i.addAsset));
  if (!open.length) return null;
  const toConfirm = open.filter((c) => c.status === 'unsure').length;
  const toAdd = open.filter((c) => c.status === 'suggested').length;
  const added = open.filter((c) => c.status === 'added');
  const fresh = added.filter((c) => !i.lastReadAt || (c.statusAt ?? '') > i.lastReadAt).length;
  const parts = [toConfirm ? `${toConfirm} to confirm in the details` : null, toAdd ? `${plural(toAdd, 'asset')} to add once VDP's MCP takes add_vdp_asset` : null, fresh ? `${fresh} waiting for the next VDP read` : null, added.length - fresh ? `${added.length - fresh} marked added that VDP doesn't show yet` : null].filter(Boolean);
  return step({
    id,
    kind: 'assets',
    title: toConfirm ? `Confirm ${plural(toConfirm, 'asset')} found for ${i.companyName}` : `${plural(open.length, 'asset')} found for ${i.companyName}`,
    detail: parts.join(' · '),
    state: toConfirm || toAdd ? 'todo' : 'waiting',
    candidateIds: open.map((c) => c.id),
    section: 'assets',
    requires,
    disabled: toConfirm ? 'Confirm it in the details first' : toAdd ? "VDP's MCP can't take this yet: add_vdp_asset" : 'Waiting for the next VDP read',
  });
}

/** The in-app "Find assets" item (D-63: never a handoff): no assets in VDP and no candidate to add. */
const findAssetsStep = (id: string, gaps: VdpGap[], requires: string[]): VdpStep =>
  step({ id, kind: 'find_assets', title: 'Find assets', detail: 'Looks back through Drive, Slack, Gmail and Calendar for this account’s decks, docs and recordings: each find becomes an item here.', gaps, section: 'assets', requires, disabled: 'Find assets runs here: its finds become items to push' });

const createUseCaseFields = (): VdpApplyField[] => [
  field('track', { label: 'Track', options: ['d360', 'agentforce'], suggested: 'd360', required: true }),
  field('title', { required: true }),
  field('priority', { options: [...VDP_PRIORITY_VALUES], required: true }),
  field('division', { required: true }),
  field('persona', { required: true }),
  field('details_input', { required: true }),
];

/** The AE and the TA: one item per empty role (set_vdp_owners with that role's full list, never changing who is there). */
function peopleSteps(i: StepsInput, slug: string, of: (c: VdpGap['code']) => VdpGap[], requires: string[], id: (s: string) => string): VdpStep[] {
  const out: VdpStep[] = [];
  for (const g of of('no_ae')) {
    const fx = g.fix as AppFix;
    const from = 'From the opportunity’s Specialist Forecast (Data Cloud first, then Agentforce).';
    out.push(item(i, { id: id('ae'), kind: 'ae', title: g.title, detail: fx.suggested ? from : 'No Specialist Forecast names one: type the AE’s email.', gaps: [g], section: 'people', requires }, () => ({ key: itemKey.ae(slug), op: 'set_vdp_owners', fields: [field('account_executives', { suggested: fx.suggested, required: true })], label: 'Set the AE' })));
  }
  for (const g of of('ae_not_on_vdp')) {
    const fx = g.fix as AppFix;
    out.push(item(i, { id: id('ae_add'), kind: 'ae', title: g.title, detail: g.why, gaps: [g], section: 'people', requires, check: 'wrong' }, () => ({ key: itemKey.aeAdd(slug), op: 'set_vdp_owners', fields: [field('account_executives', { current: fx.current, suggested: fx.suggested, required: true })], label: 'Add them' })));
  }
  for (const g of of('no_ta')) {
    const fx = g.fix as AppFix;
    out.push(item(i, { id: id('ta'), kind: 'ta', title: g.title, detail: null, gaps: [g], section: 'people', requires }, () => ({ key: itemKey.ta(slug), op: 'set_vdp_owners', fields: [field('technical_architects', { suggested: fx.suggested, required: true })], label: 'Set the TA' })));
  }
  return out;
}

/** A new use case and its Generate (the new use case's id is passed down, D-63). */
function newUseCaseSteps(i: StepsInput, slug: string, of: (c: VdpGap['code']) => VdpGap[], requires: string[], id: (s: string) => string): VdpStep[] {
  const out: VdpStep[] = [];
  const create = of('no_use_case')[0];
  if (!create) return out;
  const key = itemKey.createUseCase(slug);
  out.push(item(i, { id: id('create_use_case'), kind: 'create_use_case', title: create.title, detail: 'Its track, title, priority, division, persona and details, in one call.', gaps: [create], section: 'use_cases', requires }, () => ({ key, op: 'create_use_case', fields: createUseCaseFields(), label: 'Add the use case' })));
  const gen = of('no_ai_fields').find((g) => !g.useCaseId);
  if (gen) out.push(item(i, { id: id('create_use_case:generate'), kind: 'ai_fields', title: gen.title, detail: 'VDP writes them from the new use case’s inputs.', gaps: [gen], section: 'use_cases', requires: [...requires, key], parentKey: key }, () => ({ key: itemKey.generateNew(slug), op: 'generate_use_case', fields: [], label: 'Generate' })));
  return out;
}

export function vdpSteps(i: StepsInput): VdpStep[] {
  const of = (code: VdpGap['code']) => i.gaps.filter((g) => g.code === code);
  const steps: VdpStep[] = [];

  // ---- No VDP yet: the company (if VDP lacks it), then the VDP, then what the VDP needs under it.
  if (!i.vdpLabel) {
    const accountId = i.gaps.find((g) => g.accountId)?.accountId ?? i.key.replace(/^account:/, '');
    const isOp = (g: VdpGap, op: string) => g.fix.kind === 'app' && g.fix.op === op;
    const company = of('company_not_in_vdp').filter((g) => isOp(g, 'create_company'));
    const vdp = [...of('company_not_in_vdp'), ...of('opp_without_vdp')].filter((g) => isOp(g, 'create_vdp'));
    const above: string[] = [];
    if (company.length) {
      steps.push(
        item(i, { id: 'create_company', kind: 'create_company', title: `Create ${i.companyName} in VDP`, detail: 'VDP has no company by that name yet: this creates it, then the VDP under it.', gaps: company }, (fx) => ({
          key: itemKey.createCompany(accountId),
          op: 'create_company',
          fields: [...fieldsOfFix(fx[0]!, true), ...(i.salesSegments?.length ? [field('sales_segment_id', { options: [...i.salesSegments] })] : [])],
          label: 'Create the company',
        })),
      );
      above.push(itemKey.createCompany(accountId));
    }
    if (vdp.length) {
      const fx0 = vdp[0]!.fix as AppFix;
      const v = fx0.values ?? {};
      const period = typeof v.fiscal_year === 'number' && typeof v.fiscal_quarter === 'number' ? ` FY${String(v.fiscal_year).padStart(2, '0')} Q${v.fiscal_quarter}` : '';
      const opps = Array.isArray(v.salesforce_opportunity_ids) ? v.salesforce_opportunity_ids.length : 0;
      const underNew = !!company.length;
      steps.push(
        item(
          i,
          { id: 'create_vdp', kind: 'create_vdp', title: `Create the${period} VDP`, detail: `With the account id${opps ? `, ${plural(opps, 'opportunity')}` : ''} and the fiscal period, in one call.${underNew ? ' The new company’s id is passed in.' : ''}`, gaps: vdp.slice(0, 1), requires: [...above] },
          (fx) => ({
            key: itemKey.createVdp(accountId),
            op: 'create_vdp',
            // under a new company the id is the one it gets (passed in by the push): shown, not typed, not required here
            fields: [...fieldsOfFix(fx[0]!, !underNew).map((f) => (f.field === 'company_id' ? { ...f, fixed: true, required: !underNew } : f)), ...(i.entitlementCreate ? [field('entitlement_leveraged', { options: [...VDP_ENTITLEMENT_VALUES] })] : [])],
            label: 'Create the VDP',
          }),
        ),
      );
      above.push(itemKey.createVdp(accountId));
    }
    if (!above.length) return steps;
    const slug = newVdpSlug(accountId);
    const id = (s: string) => `new_vdp:${s}`;
    steps.push(...peopleSteps(i, slug, of, [...above], id), ...newUseCaseSteps(i, slug, of, [...above], id));
    const assets = assetsStep(i, id('assets'), [...above]);
    if (assets) steps.push(assets);
    else if (!i.candidates.length) steps.push(findAssetsStep(id('find_assets'), [], [...above]));
    return steps;
  }

  // ---- A VDP: opportunities, people, use cases, assets, header.
  const slug = i.key;
  for (const g of of('opp_not_on_vdp')) {
    steps.push(item(i, { id: `add_opp:${g.opportunityId}`, kind: 'add_opp', title: g.title, detail: 'It goes on the VDP header (Opportunity IDs); nothing else changes.', gaps: [g], section: 'opportunities' }, (fx) => ({ key: itemKey.addOpp(g.opportunityId ?? g.id), op: 'update_vdp_header', fields: [field('add_opportunity_ids', { suggested: fx[0]!.suggested, fixed: true, required: true })], label: 'Add the opportunity' })));
  }
  const link = of('no_opp_link');
  if (link.length) steps.push(item(i, { id: 'link_opp', kind: 'link_opp', title: link[0]!.title, detail: 'Org62 reads the opportunity off the VDP header (Deal Contribution).', gaps: link, section: 'opportunities' }, (fx) => ({ key: itemKey.linkOpp(slug), op: 'update_vdp_header', fields: fieldsOfFix(fx[0]!, true), label: 'Link it' })));
  for (const g of of('wrong_opp_link')) {
    steps.push(item(i, { id: `remove_opp:${g.opportunityId}`, kind: 'remove_opp', title: g.title, detail: g.why, gaps: [g], section: 'opportunities', check: 'wrong' }, (fx) => ({ key: itemKey.removeOpp(slug, g.opportunityId ?? g.id), op: 'update_vdp_header', fields: [field('remove_opportunity_ids', { suggested: fx[0]!.suggested, fixed: true, required: true })], label: 'Remove it' })));
  }

  steps.push(...peopleSteps(i, slug, of, [], (s) => s), ...newUseCaseSteps(i, slug, of, [], (s) => s));

  const fieldGaps = of('use_case_field');
  const ai = of('no_ai_fields').filter((g) => !!g.useCaseId);
  const extra = [...new Set([...fieldGaps, ...ai].map((g) => g.useCaseId).filter((x): x is string => !!x && !i.useCases.some((u) => u.id === x)))];
  const ucs = [...i.useCases, ...extra.map((id) => ({ id, title: [...fieldGaps, ...ai].find((g) => g.useCaseId === id)?.useCaseTitle ?? 'Use case' }))];
  for (const u of ucs) {
    const g = fieldGaps.filter((x) => x.useCaseId === u.id);
    let fill: VdpStep | null = null;
    if (g.length) {
      const labels = g.map((x) => x.title.replace(/^.*: /, '').replace(/ is empty$/, ''));
      fill = item(i, { id: `use_case_fields:${u.id}`, kind: 'use_case_fields', title: `${u.title}: ${labels.join(', ')}`, detail: g.length > 1 ? `All ${g.length} inputs in one call.` : null, gaps: g, section: 'use_cases' }, (fx) => ({
        key: itemKey.useCase(slug, u.id),
        op: 'update_use_case',
        fields: fx.map((f) => field(f.field, { options: f.options, required: true })),
        label: g.length > 1 ? `Fill in ${g.length} inputs` : `Fill in ${labels[0]}`,
      }));
      steps.push(fill);
    }
    for (const x of ai.filter((y) => y.useCaseId === u.id)) {
      // Generate reads the inputs: it goes after them (its own item when they are all in)
      const after = fill && fill.state !== 'waiting' ? (fill.apply?.key ?? null) : null;
      steps.push(item(i, { id: `ai_fields:${u.id}`, kind: 'ai_fields', title: after ? 'Generate the AI fields' : `${u.title}: Generate the AI fields`, detail: 'VDP writes them from the use case’s inputs.', gaps: [x], section: 'use_cases', requires: after ? [after] : [], parentKey: after }, () => ({ key: itemKey.generate(slug, u.id), op: 'generate_use_case', fields: [], label: 'Generate' })));
    }
  }

  // D-67: the round trip with Org62 (src/engines/activity/use-cases.ts): a Use_Case__c this VDP lacks, and the use
  // cases whose record Org62 changed (or both sides did). Suggestions you push, never autopilot; both values shown.
  for (const g of of('org62_use_case')) {
    const fx = g.fix as AppFix;
    const rec = String(fx.values?.org62_use_case_id ?? g.id).slice(0, 15);
    steps.push(
      item(i, { id: `org62_use_case:${rec}`, kind: 'create_use_case', title: g.title, detail: g.why, gaps: [g], section: 'use_cases' }, () => ({
        key: itemKey.org62UseCase(slug, rec),
        op: 'create_use_case',
        fields: createUseCaseFields().map((f) => (f.field === 'track' ? { ...f, suggested: String(fx.values?.track ?? 'd360') } : f.field === 'title' ? { ...f, suggested: fx.suggested } : f)),
        label: 'Add it to VDP',
      })),
    );
  }
  const drift = of('use_case_drift');
  for (const ucId of [...new Set(drift.map((g) => g.useCaseId).filter((x): x is string => !!x))]) {
    const gs = drift.filter((g) => g.useCaseId === ucId);
    const t = gs[0]!.useCaseTitle ?? i.useCases.find((u) => u.id === ucId)?.title ?? 'Use case';
    steps.push(
      item(i, { id: `use_case_drift:${ucId}`, kind: 'use_case_fields', title: gs.length === 1 ? gs[0]!.title : `${t}: ${gs.length} values differ from Org62`, detail: [...new Set(gs.map((g) => g.why).filter(Boolean))].join(' · ') || null, gaps: gs, section: 'use_cases', check: 'wrong' }, (fx) => ({
        key: itemKey.useCaseDrift(slug, ucId),
        op: 'update_use_case',
        fields: fx.map((f) => field(f.field, { current: f.current, suggested: f.suggested, options: f.options.length ? f.options : [...(VDP_FIELD_OPTIONS[f.field] ?? [])], required: true })),
        label: gs.length === 1 ? 'Take Org62’s value' : 'Take Org62’s values',
      })),
    );
  }

  const assets = assetsStep(i, 'assets', []);
  if (assets) steps.push(assets);
  else if (of('no_assets').length && !i.candidates.length) steps.push(findAssetsStep('find_assets', of('no_assets'), []));

  const acc = of('no_account_id');
  if (acc.length) steps.push(item(i, { id: 'account_id', kind: 'account_id', title: acc[0]!.title, detail: 'The Use_Case__c export reads it off the VDP header.', gaps: acc, section: 'header' }, (fx) => ({ key: itemKey.accountId(slug), op: 'update_vdp_header', fields: fieldsOfFix(fx[0]!, true), label: 'Set it' })));
  const fp = of('no_fiscal_period');
  if (fp.length) steps.push(item(i, { id: 'fiscal_period', kind: 'fiscal_period', title: 'Set the fiscal period', detail: 'The quarter the VDP counts in.', gaps: fp, section: 'header' }, (fx) => ({ key: itemKey.fiscalPeriod(slug), op: 'update_vdp_header', fields: fx.flatMap((f) => fieldsOfFix(f, true)), label: 'Set the period' })));
  // Looks wrong (D-60): the period and the account id, each one item that says why; the fix is a suggestion
  for (const code of ['wrong_fiscal_period', 'wrong_account_id'] as const) {
    const gs = of(code);
    if (!gs.length) continue;
    const what = code === 'wrong_fiscal_period' ? 'fiscal_period' : 'account_id';
    steps.push(
      item(i, { id: `check:${code}`, kind: 'check', title: gs[0]!.title, detail: [...new Set(gs.map((g) => g.why).filter(Boolean))].join(' · ') || null, gaps: gs, check: 'wrong', section: 'header' }, (fx) => ({
        key: itemKey.check(slug, what),
        op: fx[0]!.op,
        fields: fx.map((f) => field(f.field, { current: f.current, suggested: f.suggested, options: f.options.length ? f.options : [...(VDP_FIELD_OPTIONS[f.field] ?? [])], required: true })),
        label: 'Fix it',
      })),
    );
  }
  const ent = of('no_entitlement');
  if (ent.length) steps.push(item(i, { id: 'entitlement', kind: 'entitlement', title: ent[0]!.title, detail: 'Data Services, Flex or Conversations: the one this VDP leverages.', gaps: ent, section: 'header' }, () => ({ key: itemKey.entitlement(slug), op: 'update_vdp_header', fields: [field('entitlement_leveraged', { options: [...VDP_ENTITLEMENT_VALUES], required: true })], label: 'Set it' })));
  return steps;
}
