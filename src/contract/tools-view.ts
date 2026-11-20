/**
 * ToolAdapter view mapper (CONTRACT-1).
 *
 * The TOOLS lane's manifest (src/tools/manifest.ts, tools-registry/*.json) is the source of truth. The API
 * never ships it raw: `toToolView()` derives what the UI needs (id, name, description, icon, launch kind,
 * run-form fields, health, estimated duration, the confirm gate), and `toToolAdapter()` adds registry state.
 *
 * Every row also keeps the older manifest shape (`ToolAdapter.manifest`, deprecated) so pre-CONTRACT-1
 * readers keep working: seeds carry their own, and `toToolAdapter()` synthesizes one with
 * `legacyManifestFromTools()`. `ToolAdapterSeedRow` maps a seed row onto the view and keeps its manifest,
 * so a parsed seed re-parses (the mock shifts dates and parses again).
 */
import { z } from 'zod';
import type { ToolManifest } from '../tools/manifest';
import { ToolAdapterManifest, ToolHealth, type ToolAdapter, type ToolFormField, type ToolLaunchKind, type ToolView } from './agents';
import { Id } from './common';

export const UNKNOWN_TOOL_HEALTH: ToolHealth = { state: 'unknown', checkedAt: null, message: null };
export const DEFAULT_TOOL_ICON = 'wrench';

/** TOOLS manifest → the contract view. `health` is runtime state the manifest does not hold. */
export function toToolView(manifest: ToolManifest, health: ToolHealth = UNKNOWN_TOOL_HEALTH): ToolView {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    launchKind: manifest.launch.kind,
    fields: manifest.input.fields.map((f) => ({ ...f })),
    health: { ...health },
    estimatedDuration: { minSec: manifest.estimatedDuration.minSec, maxSec: manifest.estimatedDuration.maxSec },
    requiresConfirm: manifest.privacy.requiresConfirm,
  };
}

/** TOOLS manifest + registry state → one Agents ▸ Tools row (with the deprecated compatibility manifest). */
export function toToolAdapter(manifest: ToolManifest, opts: { health?: ToolHealth; enabled?: boolean; recentRunIds?: string[] } = {}): ToolAdapter {
  return {
    ...toToolView(manifest, opts.health),
    enabled: opts.enabled ?? true,
    recentRunIds: [...(opts.recentRunIds ?? [])],
    manifest: legacyManifestFromTools(manifest),
  };
}

const TO_LEGACY_KIND: Record<ToolLaunchKind, ToolAdapterManifest['kind']> = { http: 'http', cli: 'cli', claude_session: 'claude-session', skill: 'skill' };

/** Run-form fields → the JSON Schema the legacy manifest used (`input.schema` + `input.prefill`). */
export function jsonSchemaFromFields(fields: ToolFormField[]): { schema: Record<string, unknown>; prefill: Record<string, unknown> } {
  const properties: Record<string, unknown> = {};
  const prefill: Record<string, unknown> = {};
  for (const f of fields) {
    const base = { title: f.label, ...(f.help ? { description: f.help } : {}) };
    switch (f.type) {
      case 'enum':
        properties[f.key] = { ...base, type: 'string', enum: f.options.map((o) => o.value), ...(f.default !== undefined ? { default: f.default } : {}) };
        break;
      case 'number':
        properties[f.key] = { ...base, type: f.integer ? 'integer' : 'number', ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}), ...(f.default !== undefined ? { default: f.default } : {}) };
        break;
      case 'boolean':
        properties[f.key] = { ...base, type: 'boolean', ...(f.default !== undefined ? { default: f.default } : {}) };
        break;
      case 'file':
        properties[f.key] = f.multiple ? { ...base, type: 'array', items: { type: 'string', format: 'path' } } : { ...base, type: 'string', format: 'path' };
        break;
      case 'entity_ref':
        properties[f.key] = { ...base, type: 'string', format: `ref:${f.entity}` };
        break;
      default:
        properties[f.key] = { ...base, type: 'string', ...(f.maxLength ? { maxLength: f.maxLength } : {}), ...('pattern' in f && f.pattern ? { pattern: f.pattern } : {}), ...(f.default !== undefined ? { default: f.default } : {}) };
    }
    if (f.prefill) prefill[f.key] = f.prefill;
  }
  return { schema: { type: 'object', required: fields.filter((f) => f.required).map((f) => f.key), properties }, prefill };
}

/** TOOLS manifest → the deprecated pre-CONTRACT-1 manifest shape (compatibility only; nothing runs from it). */
export function legacyManifestFromTools(m: ToolManifest): ToolAdapterManifest {
  const l = m.launch;
  const launch: ToolAdapterManifest['launch'] =
    l.kind === 'http'
      ? { http: { baseUrl: l.baseUrl, steps: [] } }
      : l.kind === 'cli'
        ? { cli: { cwd: l.cwd, argv: [...l.argv], timeoutSec: l.timeoutSec } }
        : l.kind === 'claude_session'
          ? { claudeSession: { cwd: l.repoPath, prompt: l.promptTemplate } }
          : { skill: { name: l.skill } };
  const h = m.health;
  const health: ToolAdapterManifest['health'] =
    h.type === 'http' ? { type: 'http', http: { url: h.url, expectStatus: h.expectStatus, timeoutMs: h.timeoutMs } } : { type: h.type };
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    icon: m.icon,
    version: m.version,
    kind: TO_LEGACY_KIND[l.kind],
    capabilities: [],
    match: { taskTypes: [], keywords: [] },
    input: jsonSchemaFromFields(m.input.fields),
    launch,
    progress: { type: m.progress.protocol, ...(m.progress.path ? { http: { path: m.progress.path } } : {}) },
    output: {
      kind: m.output.kind,
      ...(m.output.link ? { link: { url: m.output.link.urlTemplate, label: m.output.link.label } } : {}),
      ...(m.output.artifacts.length ? { artifacts: m.output.artifacts.map((a) => ({ path: a.pathTemplate, mime: a.mime ?? 'application/octet-stream', label: a.label, revealable: a.revealable })) } : {}),
    },
    health,
    safety: {
      network: m.privacy.network === 'external' ? 'internal' : 'localhost-only',
      writes: [...m.privacy.writes],
      requiresApproval: m.privacy.requiresConfirm,
      dataClass: m.privacy.dataClass,
    },
    estimatedDuration: { ...m.estimatedDuration },
  };
}

/** Keys of the run form that must be filled before Run. */
export function requiredFieldKeys(view: Pick<ToolView, 'fields'>): string[] {
  return view.fields.filter((f) => f.required).map((f) => f.key);
}

// ---------------------------------------------------------------------------
// Legacy seed manifests
// ---------------------------------------------------------------------------

const LEGACY_KIND: Record<ToolAdapterManifest['kind'], ToolLaunchKind> = { http: 'http', cli: 'cli', 'claude-session': 'claude_session', skill: 'skill' };

type JsonProp = { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown; minimum?: number; maximum?: number; maxLength?: number; pattern?: string; format?: string };

/** JSON Schema properties (the legacy `input.schema`) → run-form fields. Unknown property types become strings. */
export function fieldsFromJsonSchema(schema: Record<string, unknown>, prefill: Record<string, unknown> = {}): ToolFormField[] {
  const props = (schema.properties ?? {}) as Record<string, JsonProp>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(props).map(([key, p]): ToolFormField => {
    const base = {
      key,
      label: p.title ?? key,
      ...(p.description ? { help: p.description } : {}),
      required: required.has(key),
      ...(typeof prefill[key] === 'string' ? { prefill: prefill[key] as string } : {}),
    };
    if (Array.isArray(p.enum) && p.enum.length) {
      const options = p.enum.map((v) => ({ value: String(v), label: String(v) }));
      return { ...base, type: 'enum', options, ...(typeof p.default === 'string' ? { default: p.default } : {}) };
    }
    switch (p.type) {
      case 'number':
      case 'integer':
        return { ...base, type: 'number', integer: p.type === 'integer', ...(p.minimum !== undefined ? { min: p.minimum } : {}), ...(p.maximum !== undefined ? { max: p.maximum } : {}), ...(typeof p.default === 'number' ? { default: p.default } : {}) };
      case 'boolean':
        return { ...base, type: 'boolean', ...(typeof p.default === 'boolean' ? { default: p.default } : {}) };
      default:
        return { ...base, type: 'string', ...(p.maxLength ? { maxLength: p.maxLength } : {}), ...(p.pattern ? { pattern: p.pattern } : {}), ...(typeof p.default === 'string' ? { default: p.default } : {}) };
    }
  });
}

/** Legacy seed manifest → the contract view. */
export function toolViewFromLegacyManifest(m: ToolAdapterManifest, health: ToolHealth = UNKNOWN_TOOL_HEALTH): ToolView {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    icon: m.icon ?? DEFAULT_TOOL_ICON,
    launchKind: LEGACY_KIND[m.kind],
    fields: fieldsFromJsonSchema(m.input.schema, m.input.prefill),
    health: { ...health },
    estimatedDuration: m.estimatedDuration ? { ...m.estimatedDuration } : null,
    requiresConfirm: m.safety.requiresApproval,
  };
}

/**
 * A `toolAdapters[]` row in a seed: input = the legacy shape (unchanged, so existing seeds and the seed
 * builders keep compiling), output = the ToolAdapter view with the legacy `manifest` kept for re-parsing.
 */
export const ToolAdapterSeedRow = z
  .object({
    manifest: ToolAdapterManifest,
    health: ToolHealth,
    enabled: z.boolean().default(true),
    recentRunIds: z.array(Id).default([]),
  })
  .transform((row): ToolAdapter => ({
    ...toolViewFromLegacyManifest(row.manifest, row.health),
    enabled: row.enabled,
    recentRunIds: row.recentRunIds,
    manifest: row.manifest,
  }));
