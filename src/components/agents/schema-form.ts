/**
 * Tool run forms are generated from the manifest's JSON Schema (`input.schema`, draft 2020-12 subset):
 * string / number / integer / boolean, `enum`, `title`, `description`, `default`, `maxLength`, `pattern`,
 * `minimum` / `maximum`, `required`. Pure: no React.
 */
import type { ToolAdapterManifest } from '@/contract';

export type FieldKind = 'text' | 'textarea' | 'number' | 'boolean' | 'select';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  integer?: boolean;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
}

type Json = Record<string, unknown>;

const LONG_TEXT_KEY = /context|notes?|description|body|prompt|references|summary/i;

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function fieldsFromSchema(schema: Json | undefined | null): FieldSpec[] {
  const props = ((schema?.properties as Record<string, Json> | undefined) ?? {}) as Record<string, Json>;
  const required = new Set(((schema?.required as string[] | undefined) ?? []).map(String));
  return Object.entries(props).map(([key, p]) => {
    const type = Array.isArray(p.type) ? String(p.type[0]) : String(p.type ?? 'string');
    const enumVals = Array.isArray(p.enum) ? (p.enum as unknown[]).map(String) : null;
    const maxLength = typeof p.maxLength === 'number' ? p.maxLength : undefined;
    let kind: FieldKind = 'text';
    if (enumVals) kind = 'select';
    else if (type === 'boolean') kind = 'boolean';
    else if (type === 'number' || type === 'integer') kind = 'number';
    else if ((maxLength ?? 0) > 500 || p.format === 'textarea' || LONG_TEXT_KEY.test(key)) kind = 'textarea';
    return {
      key,
      label: typeof p.title === 'string' ? p.title : humanize(key),
      kind,
      required: required.has(key),
      integer: type === 'integer',
      help: typeof p.description === 'string' ? p.description : undefined,
      options: enumVals?.map((v) => ({ value: v, label: v })),
      defaultValue: p.default,
      maxLength,
      pattern: typeof p.pattern === 'string' ? p.pattern : undefined,
      min: typeof p.minimum === 'number' ? p.minimum : undefined,
      max: typeof p.maximum === 'number' ? p.maximum : undefined,
    };
  });
}

export type FormValues = Record<string, string | boolean>;

/** Starting values: schema defaults, then literal (non-mustache) prefill, then caller overrides. */
export function initialValues(fields: FieldSpec[], prefill: Json = {}, overrides: Json = {}): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    const raw = overrides[f.key] ?? (typeof prefill[f.key] === 'string' && (prefill[f.key] as string).includes('{{') ? undefined : prefill[f.key]) ?? f.defaultValue;
    if (f.kind === 'boolean') out[f.key] = raw === true || raw === 'true';
    else out[f.key] = raw === undefined || raw === null ? (f.kind === 'select' && f.required ? (f.options?.[0]?.value ?? '') : '') : String(raw);
  }
  return out;
}

export function validate(fields: FieldSpec[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.kind === 'boolean') continue;
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) {
      if (f.required) errors[f.key] = 'Required';
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(s);
      if (!Number.isFinite(n)) errors[f.key] = 'Enter a number';
      else if (f.integer && !Number.isInteger(n)) errors[f.key] = 'Enter a whole number';
      else if (f.min !== undefined && n < f.min) errors[f.key] = `At least ${f.min}`;
      else if (f.max !== undefined && n > f.max) errors[f.key] = `At most ${f.max}`;
    } else {
      if (f.maxLength && s.length > f.maxLength) errors[f.key] = `At most ${f.maxLength} characters`;
      else if (f.pattern) {
        try {
          if (!new RegExp(f.pattern).test(s)) errors[f.key] = 'Not in the expected format';
        } catch {
          /* invalid pattern in a manifest: don't block the run */
        }
      }
    }
  }
  return errors;
}

/** Coerce form values to the request's `inputs`: numbers as numbers, empty optionals dropped. */
export function toInputs(fields: FieldSpec[], values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.kind === 'boolean') {
      out[f.key] = v === true;
      continue;
    }
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    out[f.key] = f.kind === 'number' ? Number(s) : s;
  }
  return out;
}

// ── Registry card facts ─────────────────────────────────────────────────────────────────────

/** "cd ~/Projects/talk-track && npm start" (what to run when the tool is down). Null if the manifest has none. */
export function startCommandOf(m: ToolAdapterManifest): string | null {
  const s = m.lifecycle?.start;
  if (!s || !s.argv.length) return null;
  const env = s.env ? `${Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(' ')} ` : '';
  return `cd ${s.cwd} && ${env}${s.argv.join(' ')}`;
}

/**
 * Estimated duration. The contract manifest has no field for it (the registry JSON does), so this reads an
 * optional `estimatedDuration {minSec,maxSec}` if the server passes it through, else a coarse default by kind.
 * TODO(contract): add `estimatedDuration` to ToolAdapterManifest.
 */
export function estimatedDurationOf(m: ToolAdapterManifest): { label: string; derived: boolean } {
  const e = (m as unknown as { estimatedDuration?: { minSec?: number; maxSec?: number } }).estimatedDuration;
  if (e && typeof e.minSec === 'number' && typeof e.maxSec === 'number') return { label: `${fmtSec(e.minSec)} to ${fmtSec(e.maxSec)}`, derived: false };
  const byKind: Record<string, string> = { cli: 'about a minute', http: '2 to 10 min', 'claude-session': '10 to 60 min', skill: 'about 5 min' };
  return { label: byKind[m.kind] ?? 'unknown', derived: true };
}

function fmtSec(s: number): string {
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 360) / 10} h`;
}

export interface PrivacyFacts {
  dataClass: string;
  network: string;
  writes: string[];
  requiresConfirm: boolean;
}

export function privacyOf(m: ToolAdapterManifest): PrivacyFacts {
  return { dataClass: m.safety.dataClass, network: m.safety.network, writes: m.safety.writes, requiresConfirm: m.safety.requiresApproval };
}

export const NETWORK_LABEL: Record<string, string> = { 'localhost-only': 'Localhost only', internal: 'Internal network', none: 'No network' };
