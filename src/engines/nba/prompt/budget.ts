import { createHash } from 'node:crypto';

/**
 * Token budgeting with explicit truncation priorities.
 *
 * A prompt is a list of sections; each section is a list of units. Units carry a priority
 * (0 = required, never dropped; 1 = most important … 5 = first to go) and may be trimmable
 * (long excerpts are shortened before anything is dropped). When the total exceeds the budget:
 *   1. trim trimmable units, lowest priority first, down to their `trimTo` length;
 *   2. drop whole units, lowest priority first, oldest first within a priority;
 *   3. every drop is reported, and the section gets an "<n> omitted" note, so the model knows
 *      context is missing (tenet: Legible).
 */

/** Conservative estimate (no tokenizer dependency): ~3.6 chars per token for mixed prose + JSON. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export interface Unit {
  text: string;
  priority: 0 | 1 | 2 | 3 | 4 | 5;
  /** Higher = newer. Within a priority, lower order is dropped first. */
  order?: number;
  /** Shorten to this many characters before dropping (adds an ellipsis). */
  trimTo?: number;
  label?: string;
}

export interface Section {
  key: string;
  /** Opening line, e.g. "<evidence>"; closing tag is derived. */
  tag: string;
  header?: string;
  units: Unit[];
  /** Never render the section if it has no units. */
  optional?: boolean;
}

export interface BudgetReport {
  budgetTokens: number;
  estimatedTokens: number;
  trimmed: string[];
  dropped: string[];
}

function render(sections: Section[], kept: Map<Section, Unit[]>, omitted: Map<Section, number>): string {
  const parts: string[] = [];
  for (const s of sections) {
    const units = kept.get(s) ?? [];
    const om = omitted.get(s) ?? 0;
    if (units.length === 0 && om === 0 && s.optional !== false) continue;
    const lines: string[] = [`<${s.tag}>`];
    if (s.header) lines.push(s.header);
    for (const u of units) lines.push(u.text);
    if (om > 0) lines.push(`(${om} lower-priority ${s.key} entr${om === 1 ? 'y' : 'ies'} omitted for length)`);
    lines.push(`</${s.tag}>`);
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}

export function fitToBudget(sections: Section[], budgetTokens: number): { text: string; report: BudgetReport } {
  const kept = new Map<Section, Unit[]>();
  const omitted = new Map<Section, number>();
  for (const s of sections) kept.set(s, s.units.map((u) => ({ ...u })));
  const trimmed: string[] = [];
  const dropped: string[] = [];

  let text = render(sections, kept, omitted);
  if (estimateTokens(text) <= budgetTokens) {
    return { text, report: { budgetTokens, estimatedTokens: estimateTokens(text), trimmed, dropped } };
  }

  type Ref = { s: Section; u: Unit };
  const all = (): Ref[] => [...kept.entries()].flatMap(([s, us]) => us.map((u) => ({ s, u })));
  const byWeakest = (a: Ref, b: Ref) => b.u.priority - a.u.priority || (a.u.order ?? 0) - (b.u.order ?? 0);

  // 1. trim
  for (const { s, u } of all().filter((r) => r.u.trimTo && r.u.text.length > (r.u.trimTo ?? 0)).sort(byWeakest)) {
    if (estimateTokens(text) <= budgetTokens) break;
    u.text = u.text.slice(0, Math.max(0, (u.trimTo ?? 0) - 1)).trimEnd() + '…';
    trimmed.push(`${s.key}:${u.label ?? '?'}`);
    text = render(sections, kept, omitted);
  }

  // 2. drop
  for (const { s, u } of all().filter((r) => r.u.priority > 0).sort(byWeakest)) {
    if (estimateTokens(text) <= budgetTokens) break;
    const list = kept.get(s) ?? [];
    kept.set(
      s,
      list.filter((x) => x !== u),
    );
    omitted.set(s, (omitted.get(s) ?? 0) + 1);
    dropped.push(`${s.key}:${u.label ?? '?'}`);
    text = render(sections, kept, omitted);
  }

  return { text, report: { budgetTokens, estimatedTokens: estimateTokens(text), trimmed, dropped } };
}

/** Stable JSON (sorted keys) so the same inputs always hash the same (next_best_actions.inputs_hash). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function hashInputs(...parts: unknown[]): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

/** Single-line, collapsed, clipped text for prompt lines. */
export function oneLine(text: string, max = 600): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
