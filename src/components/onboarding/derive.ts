/** Onboarding (B-079): pure helpers for the page (step copy, summaries, checks). Tested in tests/onboarding/derive.test.ts. */
import {
  ONBOARDING_SOURCE_CONNECTORS,
  ONBOARDING_STEPS,
  OnboardingHistory,
  OnboardingIds,
  OnboardingYouBasics,
  type OnboardingDraft,
  type OnboardingIssue,
  type OnboardingPriorities,
  type OnboardingPersonaDraft,
  type OnboardingRolePack,
  type OnboardingSource,
  type OnboardingSourceId,
  type OnboardingSourcesPayload,
  type OnboardingState,
  type OnboardingStep,
  type OnboardingYouDraft,
  type PersonaFeature,
  type PersonaId,
  type PersonaLevel,
  type PolicyRule,
  type PolicyWeights,
  type RolePack,
  type StarterTemplate,
  type UsdRange,
} from '@/contract';
import { DAY_NAMES } from '@/components/settings/derive';
import { FEATURE_CONNECTORS, PERSONAS, personaOf, type ResolvedPersona } from '@/personas';

export const STEP_META: Record<OnboardingStep, { label: string; title: string; blurb: string }> = {
  role: { label: 'Role', title: 'Your role', blurb: 'What you do at work. It sets your starter priorities, which sources are read, and what the app helps you keep up with.' },
  you: { label: 'You', title: 'About you', blurb: 'Who you are and when you work, so the scanners find what is yours.' },
  priorities: { label: 'Priorities', title: 'What comes first', blurb: 'How your to-do list is ranked. Your role sets the starting point.' },
  sources: { label: 'Sources', title: 'Your sources', blurb: 'What Command Center reads, and whether each one is signed in. It only ever reads.' },
  history: { label: 'History', title: 'How far back to read', blurb: 'The first scan reads this much history once. After that it keeps up as things happen.' },
  review: { label: 'Review and start', title: 'Review and start', blurb: 'Check your choices, then start the first scan.' },
};

// ── The role (persona and level, D-55) ──────────────────────────────────────────────────────

export interface PersonaChoice {
  id: PersonaId | null;
  level: PersonaLevel;
}

/** The persona and level of a draft (the server's rule too: a draft with only `you.role` reads as SE at that level). */
export function personaChoice(persona: Partial<OnboardingPersonaDraft> | undefined, you: OnboardingYouDraft | undefined): PersonaChoice {
  const id: PersonaId | null = persona?.id ?? (you?.role ? 'se' : null);
  const levels = Object.keys(PERSONAS[id ?? 'se'].levels) as PersonaLevel[];
  const level = persona?.level ?? (you?.role === 'se_manager' && levels.includes('manager') ? 'manager' : (levels[0] ?? 'ic'));
  return { id, level };
}

export function templateOf(c: PersonaChoice): StarterTemplate {
  const def = PERSONAS[c.id ?? 'se'];
  return def.levels[c.level]?.priorityTemplate ?? def.levels.ic?.priorityTemplate ?? 'se_ic';
}

/** The profile's role for a persona level (SE manager → se_manager; everyone else se_ic). */
export const profileRole = (c: PersonaChoice): RolePack => (c.id === 'se' && c.level === 'manager' ? 'se_manager' : 'se_ic');

/** "Solutions Engineer", "SE manager", "Specialist AE". */
export function roleLabel(c: PersonaChoice): string {
  if (!c.id) return 'Not picked yet';
  const def = PERSONAS[c.id];
  return Object.keys(def.levels).length > 1 && c.level !== 'ic' ? (def.levels[c.level]?.label ?? def.label) : def.label;
}

/** The persona with your activations applied (null before you pick one). */
export function resolvedPersona(c: PersonaChoice, overrides?: Pick<OnboardingPersonaDraft, 'features' | 'connectors'>): ResolvedPersona | null {
  if (!c.id) return null;
  return personaOf({ persona: { id: c.id, level: c.level, features: overrides?.features ?? {}, connectors: overrides?.connectors ?? {} } });
}

// ── Sources: your role's preconfiguration, and the rest ─────────────────────────────────────

/** Is this Sources row read for this persona (any of its connectors active)? */
export function sourceActive(id: OnboardingSourceId, p: ResolvedPersona | null): boolean {
  if (!p) return true;
  return ONBOARDING_SOURCE_CONNECTORS[id].some((c) => (p.connectors as readonly string[]).includes(c));
}

export interface SourceGroups {
  /** In your role's preconfiguration. */
  active: OnboardingSource[];
  /** Not in it: listed with an Activate toggle (`on` = you activated it). */
  available: Array<{ src: OnboardingSource; on: boolean }>;
}

/** Splits the Sources rows by the persona preset; your activations only flip the `on` of the available ones. */
export function groupSources(sources: OnboardingSource[], c: PersonaChoice, overrides: Pick<OnboardingPersonaDraft, 'features' | 'connectors'>): SourceGroups {
  const preset = resolvedPersona(c);
  const mine = resolvedPersona(c, overrides);
  const out: SourceGroups = { active: [], available: [] };
  for (const src of sources) {
    if (sourceActive(src.id, preset)) out.active.push(src);
    else out.available.push({ src, on: sourceActive(src.id, mine) });
  }
  return out;
}

/** The sources a group reads, for counts ("4 of 6 ready"): the preconfigured ones and the ones you activated. */
export function readSources(g: SourceGroups): OnboardingSource[] {
  return [...g.active, ...g.available.filter((a) => a.on).map((a) => a.src)];
}

const OWNER = new Map<string, PersonaFeature>(Object.entries(FEATURE_CONNECTORS).flatMap(([f, cs]) => (cs ?? []).map((c) => [c as string, f as PersonaFeature] as const)));

/**
 * Activate (or not) one Sources row: a source that belongs to a feature (VDP) switches the feature, so its pages and
 * drafts come with it; any other switches the connector. Only differences from the preset are kept.
 */
export function toggleSource(c: PersonaChoice, overrides: Pick<OnboardingPersonaDraft, 'features' | 'connectors'>, id: OnboardingSourceId, on: boolean): Pick<OnboardingPersonaDraft, 'features' | 'connectors'> {
  if (!c.id) return overrides;
  const def = PERSONAS[c.id];
  const features = { ...overrides.features };
  const connectors = { ...overrides.connectors };
  for (const conn of ONBOARDING_SOURCE_CONNECTORS[id]) {
    const f = OWNER.get(conn);
    if (f) {
      if (on === (def.features[f] === true)) delete features[f];
      else features[f] = on;
    } else if (on === (def.connectors as readonly string[]).includes(conn)) delete connectors[conn];
    else connectors[conn] = on;
  }
  return { features, connectors };
}

/** The labels of the rows you activated, for the review ("VDP"). */
export function activatedLabels(sources: OnboardingSource[] | undefined, c: PersonaChoice, overrides: Pick<OnboardingPersonaDraft, 'features' | 'connectors'>): string[] {
  if (!sources) return [];
  return groupSources(sources, c, overrides)
    .available.filter((a) => a.on)
    .map((a) => a.src.label);
}

/** What a source reads, in your role's words (the server's line is the SE's). */
export function readsFor(src: OnboardingSource, persona: PersonaId | null): string {
  if (persona !== 'ae') return src.reads;
  if (src.id === 'org62') return 'The opportunities you own or are on, their Specialist Forecasts, and your events.';
  if (src.id === 'vdp') return 'VDP records on your opportunities (usually kept by the SE).';
  return src.reads;
}

/** The Org62 user id's hint, in your role's words. */
export function org62IdHint(persona: PersonaId | null): string {
  return persona === 'ae'
    ? 'Optional. Your User Id in Org62 (starts with 005); the Org62 scan finds the opportunities you own, their Specialist Forecasts and your events with it.'
    : 'Optional. Your User Id in Org62 (starts with 005); the Org62 scan finds your opportunity teams, events and DCs with it.';
}

export const stepIndex = (s: OnboardingStep) => ONBOARDING_STEPS.indexOf(s);
export const prevStep = (s: OnboardingStep): OnboardingStep | null => ONBOARDING_STEPS[stepIndex(s) - 1] ?? null;
export const nextStep = (s: OnboardingStep): OnboardingStep | null => ONBOARDING_STEPS[stepIndex(s) + 1] ?? null;

export function starterOf(pack: OnboardingRolePack): OnboardingPriorities {
  return { basedOn: pack.role, weights: { ...pack.weights }, rules: pack.rules.map((r) => ({ ...r, when: { ...r.when } })) };
}

/** Your edits when they were made for this role's template; the template's starter otherwise (the server's rule too). */
export function prioritiesFor(draft: OnboardingDraft, packs: OnboardingState['rolePacks']): OnboardingPriorities {
  const tpl = templateOf(personaChoice(draft.persona, draft.you));
  return draft.priorities && draft.priorities.basedOn === tpl ? draft.priorities : starterOf(packs[tpl]);
}

function sameRules(a: PolicyRule[], b: PolicyRule[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function editedCount(p: OnboardingPriorities, pack: OnboardingRolePack): number {
  const w = (Object.keys(pack.weights) as Array<keyof PolicyWeights>).filter((k) => p.weights[k] !== pack.weights[k]).length;
  return w + (sameRules(p.rules, pack.rules) ? 0 : 1);
}

/** The step's field → message map from a list of issues. */
export function fieldErrors(issues: OnboardingIssue[], step: OnboardingStep): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) if (i.step === step && !out[i.field]) out[i.field] = i.message;
  return out;
}

/** The role step's check (the server's `roleIssues` too). */
export function roleIssues(c: PersonaChoice): OnboardingIssue[] {
  if (!c.id) return [{ step: 'role', field: 'id', message: 'Pick your role to continue.' }];
  const def = PERSONAS[c.id];
  if (!def.levels[c.level]) return [{ step: 'role', field: 'level', message: `${def.label} has no ${c.level === 'manager' ? 'manager' : 'IC'} level. Pick one it has.` }];
  return [];
}

/** The same checks the server runs before you move on, for instant feedback. */
export function localIssues(step: OnboardingStep, d: { role: PersonaChoice; you: OnboardingYouDraft; priorities: OnboardingPriorities; history: Partial<OnboardingHistory> }): OnboardingIssue[] {
  const out: OnboardingIssue[] = [];
  if (step === 'role') return roleIssues(d.role);
  if (step === 'you') {
    const r = OnboardingYouBasics.safeParse(d.you);
    if (!r.success) for (const i of r.error.issues) out.push({ step, field: i.path.join('.') || 'you', message: i.message });
  } else if (step === 'sources') {
    // the Slack and Org62 ids live on the Sources step
    const r = OnboardingIds.safeParse(d.you);
    if (!r.success) for (const i of r.error.issues) out.push({ step, field: i.path.join('.') || 'sources', message: i.message });
  } else if (step === 'priorities') {
    d.priorities.rules.forEach((r, i) => {
      if (!r.text.trim()) out.push({ step, field: `rules.${i}.text`, message: 'Give every rule a short description.' });
    });
  } else if (step === 'history') {
    const r = OnboardingHistory.safeParse(d.history);
    if (!r.success) for (const i of r.error.issues) out.push({ step, field: i.path.join('.') || 'history', message: i.message });
  }
  return out;
}

export const usd = (n: number) => (n >= 10 || Number.isInteger(n) ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
/** "$0.37–1.00", "$11–30": one precision for both ends (whole dollars once the high end reaches $10). */
export function usdRange(r: UsdRange): string {
  const whole = r.highUsd >= 10;
  const f = (n: number) => (whole ? String(Math.round(n)) : n.toFixed(2));
  return f(r.lowUsd) === f(r.highUsd) ? `$${f(r.lowUsd)}` : `$${f(r.lowUsd)}–${f(r.highUsd)}`;
}

/** "Mon–Fri", "Mon, Wed, Fri". */
export function daysText(days: number[] | undefined): string {
  const d = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (!d.length) return 'No days';
  const run = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  if (run && d.length >= 3) return `${DAY_NAMES[d[0]!]}–${DAY_NAMES[d[d.length - 1]!]}`;
  return d.map((x) => DAY_NAMES[x]).join(', ');
}

/** One line per step for the step list (what you chose so far). */
export function stepSummary(step: OnboardingStep, s: OnboardingState, local: { role: PersonaChoice; you: OnboardingYouDraft; priorities: OnboardingPriorities; history: Partial<OnboardingHistory>; activated?: string[] }): string {
  switch (step) {
    case 'role': {
      if (!local.role.id) return 'SE or Specialist AE';
      return `${roleLabel(local.role)}${PERSONAS[local.role.id].status === 'preview' ? ' · Preview' : ''}`;
    }
    case 'you': {
      const y = local.you;
      if (!y.name?.trim()) return 'Name, email, hours';
      return `${y.name.trim()} · ${y.workingHours ? `${y.workingHours.start}–${y.workingHours.end}` : ''}`;
    }
    case 'priorities': {
      const pack = s.rolePacks[templateOf(local.role)];
      const n = editedCount(local.priorities, pack);
      return n ? `${pack.name} starter · ${n} change${n === 1 ? '' : 's'}` : `${pack.name} starter`;
    }
    case 'sources': {
      const slack = local.you.slackUserId?.trim();
      const extra = local.activated?.length ? ` · +${local.activated.join(', ')}` : '';
      return slack ? `Slack ${slack}${local.you.org62UserId?.trim() ? ' · Org62 set' : ''}${extra}` : `Sign-ins and your ids${extra}`;
    }
    case 'history': {
      const days = local.history.lookbackDays ?? s.cost.defaultDays;
      const est = s.cost.options.find((o) => o.days === days);
      return est ? `${days} days · about ${usdRange(est)}` : `${days} days`;
    }
    case 'review':
      return 'Start the first scan';
  }
}

/** "5 of 7 ready · to sign in: Org62, VDP", or what wasn't checked (`only`: the sources you read). */
export function sourcesLine(p: OnboardingSourcesPayload | undefined, only?: OnboardingSource[]): string {
  if (!p) return 'Not checked yet.';
  const list = only ?? p.sources;
  const total = list.length;
  const ok = list.filter((x) => x.state === 'ok').length;
  const sign = list.filter((x) => x.state === 'auth_needed' || x.state === 'offline').map((x) => x.label);
  const unknown = list.filter((x) => x.state === 'unknown').map((x) => x.label);
  if (unknown.length === total) return 'Not checked on this server. Health shows each source after its first scan.';
  const parts = [ok === total ? `All ${total} ready.` : `${ok} of ${total} ready.`];
  if (sign.length) parts.push(`To sign in: ${sign.join(', ')}.`);
  if (unknown.length) parts.push(`Not checked: ${unknown.join(', ')}.`);
  return parts.join(' ');
}
