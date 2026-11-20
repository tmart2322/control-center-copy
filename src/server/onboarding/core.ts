/**
 * Onboarding (B-079), the part both DataSources share: the steps, what each one needs before you move on, the
 * persona choice (D-55) and its starter policy, prefill, and the state the page reads. Pure apart from `Intl`.
 */
import {
  DEFAULT_BACKFILL_BUDGET_USD,
  DEFAULT_LOOKBACK_DAYS,
  ONBOARDING_STEPS,
  PersonaFeature,
  OnboardingDraft,
  OnboardingHistory,
  OnboardingIds,
  OnboardingYou,
  OnboardingYouBasics,
  type DetectionSpend,
  type FirstScanRequest,
  type IdentityDetection,
  type IdentityKind,
  type OnboardingCost,
  type OnboardingIssue,
  type OnboardingPriorities,
  type OnboardingReason,
  type OnboardingRolePack,
  type OnboardingState,
  type OnboardingStatus,
  type OnboardingStep,
  type OnboardingRole,
  type OnboardingYouDraft,
  type PersonaId,
  type PersonaLevel,
  type RolePack,
  type SaveOnboardingStepRequest,
  type StarterTemplate,
} from '@/contract';
import { ALL_CONNECTORS, PERSONAS } from '@/personas';
import { rolePolicy, type BootstrapProfileInput } from '@/server/datasource/db/bootstrap';
import { invalid } from '@/server/errors';

import type { StoredOnboarding } from './drafts';

/** Deep equality for plain JSON values (key order ignored). */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export const stepIndex = (s: OnboardingStep) => ONBOARDING_STEPS.indexOf(s);
export const laterStep = (a: OnboardingStep, b: OnboardingStep) => (stepIndex(a) >= stepIndex(b) ? a : b);

export type Packs = Record<StarterTemplate, OnboardingRolePack>;

/** Every starter template's policy (SE IC, SE manager, Specialist AE), exactly what `bootstrapUser()` writes as v1. */
export function rolePacks(now: Date = new Date()): Packs {
  const pack = (role: StarterTemplate): OnboardingRolePack => {
    const { policy } = rolePolicy(role, now.toISOString(), `starter:${role}`);
    return { role, name: policy.name, weights: policy.weights, rules: policy.rules };
  };
  return { se_ic: pack('se_ic'), se_manager: pack('se_manager'), ae: pack('ae') };
}

/**
 * The persona and level the draft holds (D-55). A draft from before personas has only `you.role`: it reads as SE at
 * that level. A level the persona doesn't have stays as written (the role step flags it); no level = the persona's
 * first (SE: IC), or SE manager when `you.role` says so.
 */
export function personaChoice(draft: Pick<OnboardingDraft, 'persona' | 'you'>): { id: PersonaId | null; level: PersonaLevel } {
  const id: PersonaId | null = draft.persona?.id ?? (draft.you?.role ? 'se' : null);
  const levels = Object.keys(PERSONAS[id ?? 'se'].levels) as PersonaLevel[];
  const level = draft.persona?.level ?? (draft.you?.role === 'se_manager' && levels.includes('manager') ? 'manager' : (levels[0] ?? 'ic'));
  return { id, level };
}

/** The starter template of the draft's persona level (SE when no role is picked yet). */
export function templateOf(draft: Pick<OnboardingDraft, 'persona' | 'you'>): StarterTemplate {
  const { id, level } = personaChoice(draft);
  return PERSONAS[id ?? 'se'].levels[level]?.priorityTemplate ?? PERSONAS[id ?? 'se'].levels.ic?.priorityTemplate ?? 'se_ic';
}

/** The profile's role for a persona level: an SE manager is se_manager; everyone else se_ic (the profile's own enum). */
export function profileRole(id: PersonaId, level: PersonaLevel): RolePack {
  return id === 'se' && level === 'manager' ? 'se_manager' : 'se_ic';
}

const FEATURES = new Set<string>(PersonaFeature.options);
const CONNECTORS = new Set<string>(ALL_CONNECTORS);
/** Only known features and sources, as booleans (a stray key from an old client never reaches the persona section). */
export function cleanOverrides(o: Record<string, boolean> | undefined, kind: 'features' | 'connectors'): Record<string, boolean> {
  const known = kind === 'features' ? FEATURES : CONNECTORS;
  return Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => known.has(k) && typeof v === 'boolean'));
}

export function starterPriorities(role: StarterTemplate, packs: Packs): OnboardingPriorities {
  const p = packs[role];
  return { basedOn: role, weights: { ...p.weights }, rules: p.rules.map((r) => ({ ...r, when: { ...r.when } })) };
}

/** Your edited weights when they were made for your current role's template; that template's starter otherwise. */
export function prioritiesFor(draft: OnboardingDraft, packs: Packs): OnboardingPriorities {
  const tpl = templateOf(draft);
  return draft.priorities && draft.priorities.basedOn === tpl ? draft.priorities : starterPriorities(tpl, packs);
}

/** The history choice with defaults for what you never touched (a cleared budget stays null, so the check flags it). */
export function historyFor(draft: OnboardingDraft): { lookbackDays: OnboardingHistory['lookbackDays']; budgetUsd: number | null } {
  return { lookbackDays: draft.history.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, budgetUsd: draft.history.budgetUsd === undefined ? DEFAULT_BACKFILL_BUDGET_USD : draft.history.budgetUsd };
}

/** The role step's own check: a persona, and a level it has. */
export function roleIssues(draft: Pick<OnboardingDraft, 'persona' | 'you'>): OnboardingIssue[] {
  const { id, level } = personaChoice(draft);
  if (!id) return [{ step: 'role', field: 'id', message: 'Pick your role to continue.' }];
  const def = PERSONAS[id];
  if (!def.levels[level]) return [{ step: 'role', field: 'level', message: `${def.label} has no ${level === 'manager' ? 'manager' : 'IC'} level. Pick one it has.` }];
  return [];
}

/** What still blocks each step. Sources never blocks: it only shows state. */
export function issuesOf(draft: OnboardingDraft, packs: Packs): OnboardingIssue[] {
  const out: OnboardingIssue[] = [...roleIssues(draft)];
  const you = OnboardingYouBasics.safeParse(draft.you);
  if (!you.success) for (const i of you.error.issues) out.push({ step: 'you', field: i.path.join('.') || 'you', message: i.message });
  // the Slack and Org62 ids sit on the Sources step, next to their source
  const ids = OnboardingIds.safeParse(draft.you);
  if (!ids.success) for (const i of ids.error.issues) out.push({ step: 'sources', field: i.path.join('.') || 'sources', message: i.message });
  const pri = prioritiesFor(draft, packs);
  pri.rules.forEach((r, i) => {
    if (!r.text.trim()) out.push({ step: 'priorities', field: `rules.${i}.text`, message: 'Give every rule a short description.' });
  });
  const hist = OnboardingHistory.safeParse(historyFor(draft));
  if (!hist.success) for (const i of hist.error.issues) out.push({ step: 'history', field: i.path.join('.') || 'history', message: i.message });
  return out;
}

/** The first step before `target` that still has an issue (moving to `target` needs every earlier step to pass). */
export function blockingStep(issues: OnboardingIssue[], target: OnboardingStep): OnboardingStep | null {
  for (const s of ONBOARDING_STEPS) {
    if (stepIndex(s) >= stepIndex(target)) return null;
    if (issues.some((i) => i.step === s)) return s;
  }
  return null;
}

export interface PrefillInput {
  /** An existing (unfinished) user: its email is kept. */
  user?: { email: string; name: string | null; timezone: string | null } | null;
  /** `profile.json` from `npm run setup`, already mapped (profileFromSetupFile). */
  setupProfile?: Partial<BootstrapProfileInput> | null;
  envEmail?: string | null;
  timezone?: string;
}

/** Step 1 before you type anything: what this machine already knows, else the bootstrap's defaults. */
export function prefillYou(p: PrefillInput): OnboardingYouDraft {
  const sp = p.setupProfile ?? {};
  const tz = p.user?.timezone ?? sp.timezone ?? p.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // no role unless this machine knows it: the role step asks (an AE must never sail through as an SE)
  const out: OnboardingYouDraft = {
    name: p.user?.name ?? sp.name ?? '',
    email: p.user?.email ?? sp.email ?? p.envEmail ?? '',
    ...(sp.role ? { role: sp.role } : {}),
    timezone: tz,
    workingHours: { start: sp.workingHours?.start ?? '09:00', end: sp.workingHours?.end ?? '18:00', days: sp.workingHours?.days ?? [1, 2, 3, 4, 5] },
    slackUserId: typeof sp.slackUserId === 'string' ? sp.slackUserId : '',
    org62UserId: typeof sp.org62UserId === 'string' ? sp.org62UserId : '',
  };
  return out;
}

/** The persona this machine already knows (`profile.json`'s `persona`, or the mock's settings), as a draft. */
export function prefillPersona(p: { persona?: PersonaId | null; role?: RolePack | null }): OnboardingDraft['persona'] {
  if (!p.persona) return { features: {}, connectors: {} };
  return { id: p.persona, ...(p.persona === 'se' && p.role === 'se_manager' ? { level: 'manager' as const } : p.persona === 'ae' ? { level: 'ic' as const } : {}), features: {}, connectors: {} };
}

export function freshStored(database: string, you: OnboardingYouDraft, now: Date, persona: OnboardingDraft['persona'] = { features: {}, connectors: {} }): StoredOnboarding {
  const first = ONBOARDING_STEPS[0];
  return { version: 1, database, step: first, reached: first, draft: OnboardingDraft.parse({ you, persona }), updatedAt: now.toISOString() };
}

/**
 * Merge one step into the draft and move. Back (or any earlier step) always works; forward needs every step before
 * the target to check out, else a 400 with the issues. Returns the new stored draft.
 */
export function applyStep(cur: StoredOnboarding, req: SaveOnboardingStepRequest, o: { now: Date; packs: Packs; lockedEmail?: string | null }): StoredOnboarding {
  const draft: OnboardingDraft = structuredClone(cur.draft);
  switch (req.step) {
    case 'role': {
      const was = personaChoice(draft).id;
      if (req.value.id !== undefined) {
        // another persona: the overrides were relative to the old preset, and its level may not exist here
        if (req.value.id !== was) draft.persona = { id: req.value.id, features: {}, connectors: {} };
        draft.persona.id = req.value.id;
      }
      if (req.value.level !== undefined) draft.persona.level = req.value.level;
      const c = personaChoice(draft);
      if (c.id) {
        if (!draft.persona.level && PERSONAS[c.id].levels[c.level]) draft.persona.level = c.level;
        draft.you.role = profileRole(c.id, c.level);
      }
      break;
    }
    case 'you':
      draft.you = { ...draft.you, ...req.value };
      if (o.lockedEmail) draft.you.email = o.lockedEmail;
      break;
    case 'priorities':
      draft.priorities = req.value;
      break;
    case 'sources':
      draft.sourcesSeenAt = o.now.toISOString();
      if (req.value.slackUserId !== undefined) draft.you.slackUserId = req.value.slackUserId;
      if (req.value.org62UserId !== undefined) draft.you.org62UserId = req.value.org62UserId;
      if (req.value.features !== undefined) draft.persona.features = cleanOverrides(req.value.features, 'features');
      if (req.value.connectors !== undefined) draft.persona.connectors = cleanOverrides(req.value.connectors, 'connectors');
      break;
    case 'history':
      draft.history = { ...draft.history, ...req.value };
      break;
    case 'review':
      break;
  }
  const goTo = req.goTo ?? req.step;
  if (stepIndex(goTo) > stepIndex(req.step) || stepIndex(goTo) > stepIndex(cur.reached)) {
    const issues = issuesOf(draft, o.packs);
    const blocked = blockingStep(issues, goTo);
    if (blocked) {
      throw invalid(`Finish "${STEP_LABEL[blocked]}" first`, { step: blocked, issues: issues.filter((i) => i.step === blocked) });
    }
  }
  return { ...cur, draft, step: goTo, reached: laterStep(cur.reached, goTo), updatedAt: o.now.toISOString() };
}

export const STEP_LABEL: Record<OnboardingStep, string> = { role: 'Role', you: 'You', priorities: 'Priorities', sources: 'Sources', history: 'History', review: 'Review and start' };

/** The checked inputs of the last step. Throws a 400 with every issue when something is missing. */
export function finalChoices(draft: OnboardingDraft, packs: Packs): { role: OnboardingRole; you: OnboardingYou; priorities: OnboardingPriorities; history: OnboardingHistory } {
  const issues = issuesOf(draft, packs);
  if (issues.length) throw invalid(`Finish "${STEP_LABEL[issues[0]!.step]}" first`, { step: issues[0]!.step, issues });
  const { id, level } = personaChoice(draft);
  const role: OnboardingRole = { id: id!, level, features: cleanOverrides(draft.persona.features, 'features'), connectors: cleanOverrides(draft.persona.connectors, 'connectors') };
  const you = OnboardingYou.parse({ ...draft.you, role: profileRole(role.id, role.level) });
  return { role, you, priorities: prioritiesFor(draft, packs), history: OnboardingHistory.parse(historyFor(draft)) };
}

export function bootstrapInput(you: OnboardingYou, role: Pick<OnboardingRole, 'id'>): BootstrapProfileInput {
  return { email: you.email, name: you.name, role: you.role, persona: role.id, timezone: you.timezone, workingHours: you.workingHours, slackUserId: you.slackUserId, org62UserId: you.org62UserId };
}

/**
 * What finishing writes to `settings.persona` beyond what the bootstrap writes (id and level): your activations, and
 * the id and level themselves when an unfinished user's section said otherwise. Empty = nothing to patch.
 */
export function personaPatch(cur: { id: PersonaId; level: PersonaLevel | null; features: Record<string, boolean>; connectors: Record<string, boolean> }, role: OnboardingRole): Partial<OnboardingRole> {
  const out: Partial<OnboardingRole> = {};
  if (cur.id !== role.id) out.id = role.id;
  if (cur.level !== role.level) out.level = role.level;
  if (!same(cur.features, role.features)) out.features = role.features;
  if (!same(cur.connectors, role.connectors)) out.connectors = role.connectors;
  return out;
}

export const ID_FIELD: Record<IdentityKind, 'slackUserId' | 'org62UserId'> = { slack: 'slackUserId', org62: 'org62UserId' };

/**
 * Lookups landed: remember each outcome, add its spend, and fill an id only when it was found and the field is
 * still empty (a value you typed is never replaced). The step does not move.
 */
export function applyDetections(cur: StoredOnboarding, results: Array<{ kind: IdentityKind; detection: IdentityDetection; spend: DetectionSpend | null }>, now: Date): StoredOnboarding {
  const draft: OnboardingDraft = structuredClone(cur.draft);
  for (const r of results) {
    draft.identities[r.kind] = r.detection;
    if (r.spend) draft.spend.push(r.spend);
    const field = ID_FIELD[r.kind];
    if (r.detection.status === 'found' && r.detection.id && !draft.you[field]?.trim()) draft.you[field] = r.detection.id;
  }
  return { ...cur, draft, updatedAt: now.toISOString() };
}

export interface StateParts {
  mode: 'mock' | 'db';
  required: boolean;
  status: OnboardingStatus;
  reason: OnboardingReason;
  stored: StoredOnboarding | null;
  /** The draft to show when nothing is stored yet. */
  prefill: OnboardingYouDraft;
  prefillPersona?: OnboardingDraft['persona'];
  locked?: Array<'email'>;
  packs: Packs;
  cost: OnboardingCost;
  completedAt?: string | null;
  firstScan?: FirstScanRequest | null;
  detection?: OnboardingState['detection'];
}

export function buildState(p: StateParts): OnboardingState {
  const draft = p.stored?.draft ?? OnboardingDraft.parse({ you: p.prefill, persona: p.prefillPersona ?? {} });
  const done = p.status === 'complete';
  const first = ONBOARDING_STEPS[0];
  return {
    mode: p.mode,
    required: p.required,
    status: p.status,
    reason: p.reason,
    step: done ? 'review' : (p.stored?.step ?? first),
    reached: done ? 'review' : (p.stored?.reached ?? first),
    draft,
    issues: done ? [] : issuesOf(draft, p.packs),
    locked: p.locked ?? [],
    rolePacks: p.packs,
    cost: p.cost,
    completedAt: p.completedAt ?? null,
    firstScan: p.firstScan ?? null,
    updatedAt: p.stored?.updatedAt ?? null,
    detection: p.detection ?? 'off',
  };
}
