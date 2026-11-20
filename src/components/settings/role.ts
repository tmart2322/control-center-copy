/**
 * Settings ▸ Role & rules (D-55): pure helpers for the persona draft. Tested in __tests__/role.test.ts.
 *
 * The section stores only CHANGES to the preset (PersonaSettings). Every edit here ends in `normalizePersona`, which
 * drops whatever matches the preset again: a rule override equal to the preset's wording and state, a threshold
 * equal to its default, a feature or source switched back to what the role preconfigures. So the draft is always
 * minimal, and the PATCH body is just its top-level keys that differ from the server (`personaPatch`).
 *
 * The carry-over: Agent behavior's "what counts as a task" list (`agentBehavior.taskCapture`) is read by nothing; it
 * now points here. Entries the user typed there (not the defaults, not already a rule) become custom rules.
 */
import type { PersonaCustomRule, PersonaFeature, PersonaId, PersonaLevel, PersonaRuleOverride, PersonaSettings, PersonaSettingsPatch } from '@/contract';
import { ALL_CONNECTORS, ALL_FEATURES, FEATURE_CONNECTORS, PERSONAS, personaOf, SE_PERSONA, type PersonaDefinition, type PersonaThreshold, type ResolvedPersona } from '@/personas';
import type { ConnectorId } from '@/scanner/types';
import { changedKeys } from './derive';

export type PersonaDraft = Omit<PersonaSettings, 'version'>;
export const PERSONA_KEYS = ['id', 'level', 'rules', 'customRules', 'thresholds', 'features', 'connectors'] as const;

/** Mirrors src/contract/persona.ts: PersonaCustomRule.id, the rule text limits, the custom-rule cap, ThresholdValue. */
export const CUSTOM_RULE_ID = /^[a-z0-9_-]{1,60}$/;
export const RULE_TEXT_MAX = 400;
export const CUSTOM_RULES_MAX = 50;
export const THRESHOLD_TEXT_MAX = 400;

export const FEATURE_LABEL: Record<PersonaFeature, string> = {
  vdp: 'VDP',
  activityLogging: 'Activity logging',
  dealContributions: 'Deal contributions',
  missedOpps: 'Missed opportunities',
  specialistForecast: 'Specialist Forecast',
  solutionsJudgement: 'Solutions judgement (SE comments)',
};

export const FEATURE_HELP: Record<PersonaFeature, string> = {
  vdp: 'VDP pages and drafts for engaged opportunities, with the VDP source.',
  activityLogging: 'Customer meetings and the work around them, logged in Org62.',
  dealContributions: 'Deal Contribution claims on opportunities you helped with.',
  missedOpps: 'Opportunities you worked on that have no Deal Contribution yet.',
  specialistForecast: 'Forecast notes, Deal Roles and missing records on Specialist Forecasts.',
  solutionsJudgement: 'SE comments and the solutions judgement on Specialist Forecasts.',
};

export const CONNECTOR_LABEL: Record<ConnectorId, string> = {
  slack: 'Slack',
  org62: 'Org62',
  gmail: 'Gmail',
  calendar: 'Calendar',
  drive: 'Drive',
  gemini_notes: 'Gemini notes',
  claude_sessions: 'Claude sessions',
  trainings: 'Trainings',
  watch: 'Watches',
  vdp: 'VDP',
};

export const CADENCE_LABEL: Record<NonNullable<PersonaDefinition['duties'][number]['cadence']>, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  quarterly: 'Quarterly',
  as_needed: 'As needed',
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Sources that belong to a feature (vdp): they follow the feature, so they are never listed on their own. */
export const FEATURE_OWNED_SOURCES: ReadonlySet<ConnectorId> = new Set(Object.values(FEATURE_CONNECTORS).flat());

export function definitionOf(id: PersonaId | null | undefined): PersonaDefinition {
  return PERSONAS[id ?? 'se'] ?? SE_PERSONA;
}

/** Case- and whitespace-insensitive key for comparing rule texts. */
export const ruleKey = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

const omit = <V>(o: Record<string, V> | undefined, key: string): Record<string, V> => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));

// ── Normalising: only what differs from the preset is stored ──────────────────────────────

export function normalizePersona(d: PersonaDraft): PersonaDraft {
  const def = definitionOf(d.id);

  const rules: Record<string, PersonaRuleOverride> = {};
  for (const [id, o] of Object.entries(d.rules ?? {})) {
    const preset = def.rules.find((r) => r.id === id);
    // Another persona's rule: inert here, kept for when you switch back.
    if (!preset) {
      rules[id] = o;
      continue;
    }
    const next: PersonaRuleOverride = {};
    if (o.enabled !== undefined && o.enabled !== preset.enabled) next.enabled = o.enabled;
    if (o.text !== undefined && o.text.trim() !== preset.text) next.text = o.text;
    if (Object.keys(next).length) rules[id] = next;
  }

  const thresholds: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(d.thresholds ?? {})) {
    const t = def.thresholds.find((x) => x.key === k);
    if (t && sameThreshold(t, v)) continue;
    thresholds[k] = v;
  }

  const features: Record<string, boolean> = {};
  for (const [f, on] of Object.entries(d.features ?? {})) if (on !== (def.features[f as PersonaFeature] === true)) features[f] = on;

  // A source's preset is what it resolves to without its own override (a feature's source follows the feature).
  const base = personaOf({ persona: { ...d, features, connectors: {} } });
  const connectors: Record<string, boolean> = {};
  for (const [c, on] of Object.entries(d.connectors ?? {})) if (on !== base.connectors.includes(c as ConnectorId)) connectors[c] = on;

  return { ...d, rules, thresholds, features, connectors };
}

/** The minimal PATCH body: the top-level keys of the (normalised) draft that differ from the saved section. */
export function personaPatch(draft: PersonaDraft, saved: PersonaDraft): PersonaSettingsPatch {
  return changedKeys(normalizePersona(draft) as Record<string, unknown>, saved as Record<string, unknown>, PERSONA_KEYS as never) as PersonaSettingsPatch;
}

// ── Persona and level ─────────────────────────────────────────────────────────────────────

/**
 * Pick another persona. Your own rules, rule edits and thresholds stay (another persona's edits are inert and come
 * back when you switch back); feature and source switches that match the new preset drop away.
 */
export function switchPersona(d: PersonaDraft, id: PersonaId): PersonaDraft {
  const def = definitionOf(id);
  const level = d.level && def.levels[d.level] ? d.level : null;
  return normalizePersona({ ...d, id, level });
}

/** A level equal to the one `profile.role` gives is stored as null (it keeps following the profile). */
export function setLevel(d: PersonaDraft, level: PersonaLevel, profile: { role?: string | null } | null | undefined): PersonaDraft {
  const fromProfile = personaOf({ persona: { ...d, level: null }, profile }).level;
  return { ...d, level: level === fromProfile ? null : level };
}

// ── Preset rules ──────────────────────────────────────────────────────────────────────────

export function setRule(d: PersonaDraft, id: string, patch: PersonaRuleOverride): PersonaDraft {
  return normalizePersona({ ...d, rules: { ...d.rules, [id]: { ...d.rules?.[id], ...patch } } });
}

/** "Reset to preset": the rule's override goes. */
export function resetRule(d: PersonaDraft, id: string): PersonaDraft {
  return normalizePersona({ ...d, rules: omit(d.rules, id) });
}

// ── Your rules ────────────────────────────────────────────────────────────────────────────

/** A stable id from the text ("Asks from my RVP…" → "asks-from-my-rvp"), unique among `taken`, matching CUSTOM_RULE_ID. */
export function customRuleId(text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    text
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'rule';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Add a rule of your own. Blank text, a duplicate of one of your rules, or a full list leaves the draft as it is. */
export function addCustomRule(d: PersonaDraft, text: string): PersonaDraft {
  const t = text.trim().slice(0, RULE_TEXT_MAX);
  const list = d.customRules ?? [];
  if (!t || list.length >= CUSTOM_RULES_MAX || list.some((r) => ruleKey(r.text) === ruleKey(t))) return d;
  return { ...d, customRules: [...list, { id: customRuleId(t, list.map((r) => r.id)), text: t, enabled: true }] };
}

export function editCustomRule(d: PersonaDraft, id: string, patch: Partial<Pick<PersonaCustomRule, 'text' | 'enabled'>>): PersonaDraft {
  return { ...d, customRules: (d.customRules ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function removeCustomRule(d: PersonaDraft, id: string): PersonaDraft {
  return { ...d, customRules: (d.customRules ?? []).filter((r) => r.id !== id) };
}

// ── Thresholds ────────────────────────────────────────────────────────────────────────────

function sameThreshold(t: PersonaThreshold, v: number | string): boolean {
  return typeof v === 'string' && typeof t.default === 'string' ? v.trim() === t.default : v === t.default;
}

/** A value equal to the preset default is not stored. */
export function setThreshold(d: PersonaDraft, key: string, value: number | string): PersonaDraft {
  return normalizePersona({ ...d, thresholds: { ...d.thresholds, [key]: value } });
}

export function resetThreshold(d: PersonaDraft, key: string): PersonaDraft {
  return normalizePersona({ ...d, thresholds: omit(d.thresholds, key) });
}

/** The thresholds to show: those with no feature, or whose feature is active. */
export function visibleThresholds(def: PersonaDefinition, p: ResolvedPersona): PersonaThreshold[] {
  return def.thresholds.filter((t) => !t.feature || p.features[t.feature]);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A threshold value in words: "$100,000", "7 days", "Monday", "09:00". */
export function thresholdText(t: PersonaThreshold, v: number | string): string {
  if (typeof v === 'number') {
    if (t.unit === 'usd') return `$${v.toLocaleString('en-US')}`;
    if (t.unit === 'days') return plural(v, 'day');
    if (t.unit === 'hours') return plural(v, 'hour');
    if (t.unit === 'weekday') return WEEKDAYS[((v % 7) + 7) % 7]!;
  }
  return String(v);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why a value can't be saved, in words; null when it can. */
export function thresholdError(t: PersonaThreshold, v: number | string | undefined): string | null {
  switch (t.unit) {
    case 'usd':
    case 'days':
    case 'hours': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Enter a number.';
      if (t.unit === 'days' && !Number.isInteger(v)) return 'Whole days.';
      const fmt = (n: number) => thresholdText(t, n);
      if (t.min !== undefined && t.max !== undefined && (v < t.min || v > t.max)) return `Between ${fmt(t.min)} and ${fmt(t.max)}.`;
      if (t.min !== undefined && v < t.min) return `At least ${fmt(t.min)}.`;
      if (t.max !== undefined && v > t.max) return `At most ${fmt(t.max)}.`;
      return null;
    }
    case 'weekday':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6 ? null : 'Pick a day.';
    case 'hhmm':
      return typeof v === 'string' && HHMM.test(v) ? null : 'A time like 09:00.';
    case 'text':
      if (typeof v !== 'string' || !v.trim()) return 'Write something, or reset to the preset.';
      return v.length > THRESHOLD_TEXT_MAX ? `At most ${THRESHOLD_TEXT_MAX} characters.` : null;
  }
}

// ── Features and sources ──────────────────────────────────────────────────────────────────

/** Switch a feature. Its own sources (VDP) follow it, so their overrides go. Back to the preset = no override. */
export function setFeature(d: PersonaDraft, f: PersonaFeature, on: boolean): PersonaDraft {
  const owned = new Set<string>(FEATURE_CONNECTORS[f] ?? []);
  const connectors = Object.fromEntries(Object.entries(d.connectors ?? {}).filter(([c]) => !owned.has(c)));
  return normalizePersona({ ...d, features: { ...d.features, [f]: on }, connectors });
}

/** Switch a source. Back to the preset = no override. */
export function setSource(d: PersonaDraft, c: ConnectorId, on: boolean): PersonaDraft {
  return normalizePersona({ ...d, connectors: { ...d.connectors, [c]: on } });
}

export interface FeaturesAndSources {
  activeFeatures: PersonaFeature[];
  availableFeatures: PersonaFeature[];
  /** Sources on their own (a feature's source, VDP, is listed with its feature only). */
  activeSources: ConnectorId[];
  availableSources: ConnectorId[];
}

export function featuresAndSources(p: ResolvedPersona): FeaturesAndSources {
  const sources = ALL_CONNECTORS.filter((c) => !FEATURE_OWNED_SOURCES.has(c));
  return {
    activeFeatures: ALL_FEATURES.filter((f) => p.features[f]),
    availableFeatures: ALL_FEATURES.filter((f) => !p.features[f]),
    activeSources: sources.filter((c) => p.connectors.includes(c)),
    availableSources: sources.filter((c) => !p.connectors.includes(c)),
  };
}

export const featureInPreset = (def: PersonaDefinition, f: PersonaFeature) => def.features[f] === true;
export const sourceInPreset = (def: PersonaDefinition, c: ConnectorId) => def.connectors.includes(c);

// ── Validation and the nav line ───────────────────────────────────────────────────────────

/** What blocks Save, keyed `rule:<id>`, `custom:<id>` or `threshold:<key>`. */
export function personaErrors(d: PersonaDraft): Record<string, string> {
  const def = definitionOf(d.id);
  const out: Record<string, string> = {};
  const textErr = (t: string) => (!t.trim() ? 'Write the rule, or reset it.' : t.trim().length > RULE_TEXT_MAX ? `At most ${RULE_TEXT_MAX} characters.` : null);
  for (const [id, o] of Object.entries(d.rules ?? {})) {
    const e = o.text !== undefined && def.rules.some((r) => r.id === id) ? textErr(o.text) : null;
    if (e) out[`rule:${id}`] = e;
  }
  for (const r of d.customRules ?? []) {
    const e = !r.text.trim() ? 'Write the rule, or delete it.' : textErr(r.text);
    if (e) out[`custom:${r.id}`] = e;
  }
  for (const t of def.thresholds) {
    if (!(t.key in (d.thresholds ?? {}))) continue;
    const e = thresholdError(t, d.thresholds[t.key]);
    if (e) out[`threshold:${t.key}`] = e;
  }
  return out;
}

/** "SE · 6 rules", "Specialist AE (Preview) · 8 rules": the label beside the nav item (rules that are on). */
export function roleSummary(p: ResolvedPersona): string {
  const on = p.rules.filter((r) => r.enabled).length;
  return `${p.levelLabel}${p.status === 'preview' ? ' (Preview)' : ''} · ${plural(on, 'rule')}`;
}

// ── The taskCapture carry-over ────────────────────────────────────────────────────────────

/** What Agent behavior's task list held before personas (bootstrap and seed): never carried. */
export const DEFAULT_TASK_CAPTURE: readonly string[] = ['Anything I say I will do', 'Direct asks of me from customers, my AE or my manager', 'Direct asks from customers or my manager', 'Action items assigned to me in meeting notes'];

/**
 * The entries of `agentBehavior.taskCapture` to carry into Role & rules as custom rules: not a default, and not
 * already present (case- and whitespace-insensitive) among the persona's rule texts or custom rules. Trimmed, with
 * inner whitespace collapsed, each once, in order.
 */
export function carriedTaskRules(taskCapture: readonly string[] | null | undefined, persona: Pick<PersonaDraft, 'customRules'> | null | undefined, resolved: ResolvedPersona): string[] {
  const def = definitionOf(resolved.id);
  const seen = new Set([...DEFAULT_TASK_CAPTURE, ...def.rules.map((r) => r.text), ...resolved.rules.map((r) => r.text), ...(persona?.customRules ?? []).map((r) => r.text)].map(ruleKey));
  const out: string[] = [];
  for (const raw of taskCapture ?? []) {
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, RULE_TEXT_MAX);
    if (!t || seen.has(ruleKey(t))) continue;
    seen.add(ruleKey(t));
    out.push(t);
  }
  return out;
}

/** Add carried entries to the draft's custom rules (up to the cap). Returns the ids and texts actually added. */
export function carryTaskRules(d: PersonaDraft, texts: readonly string[]): { draft: PersonaDraft; ids: string[]; texts: string[] } {
  let draft = d;
  const ids: string[] = [];
  const added: string[] = [];
  for (const t of texts) {
    const before = draft.customRules?.length ?? 0;
    draft = addCustomRule(draft, t);
    const list = draft.customRules ?? [];
    if (list.length === before) continue;
    ids.push(list[list.length - 1]!.id);
    added.push(t);
  }
  return { draft, ids, texts: added };
}

/** Agent behavior's task list without the carried entries (so they never carry twice). */
export function withoutCarried(taskCapture: readonly string[], carried: readonly string[]): string[] {
  const gone = new Set(carried.map(ruleKey));
  return taskCapture.filter((t) => !gone.has(ruleKey(t)));
}
