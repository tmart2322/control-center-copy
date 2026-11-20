/**
 * ToolAdapter manifest schema (R-UI-13, brief 10 §3.7).
 *
 * A manifest is declarative data: an NBA references a manifest id plus inputs,
 * and the worker runs the launch. The app renders the input form from `input.fields`
 * (a JSON-schema-like subset) and never needs tool-specific UI code.
 */
import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase slug');
const fieldKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, 'identifier');

// ---------------------------------------------------------------- input form

const fieldBase = {
  key: fieldKey,
  label: z.string().min(1),
  help: z.string().optional(),
  required: z.boolean().default(false),
  /** Mustache-style prefill against the work item, e.g. "{{workItem.account.name}}". */
  prefill: z.string().optional(),
};

export const entityKinds = ['account', 'opp', 'work_item'] as const;

export const inputFieldSchema = z.discriminatedUnion('type', [
  z.object({ ...fieldBase, type: z.literal('string'), default: z.string().optional(), maxLength: z.number().int().positive().optional(), pattern: z.string().optional() }),
  z.object({ ...fieldBase, type: z.literal('text'), default: z.string().optional(), maxLength: z.number().int().positive().optional() }),
  z.object({ ...fieldBase, type: z.literal('enum'), options: z.array(z.object({ value: z.string(), label: z.string() })).min(1), default: z.string().optional() }),
  z.object({ ...fieldBase, type: z.literal('number'), default: z.number().optional(), min: z.number().optional(), max: z.number().optional(), integer: z.boolean().default(false) }),
  z.object({ ...fieldBase, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.object({ ...fieldBase, type: z.literal('file'), accept: z.array(z.string()).default([]), multiple: z.boolean().default(false) }),
  z.object({ ...fieldBase, type: z.literal('entity_ref'), entity: z.enum(entityKinds) }),
]);
export type InputField = z.infer<typeof inputFieldSchema>;

// -------------------------------------------------------------------- launch

export const launchKinds = ['http', 'cli', 'claude_session', 'skill'] as const;
export type LaunchKind = (typeof launchKinds)[number];

const httpLaunch = z.object({
  kind: z.literal('http'),
  /** Must be a loopback URL: tools are local apps on their own ports. */
  baseUrl: z.string().url(),
  port: z.number().int().min(1).max(65535),
});
const cliLaunch = z.object({
  kind: z.literal('cli'),
  /** Working directory; `~` is expanded by the adapter. */
  cwd: z.string().min(1),
  argv: z.array(z.string()).min(1),
  timeoutSec: z.number().int().positive().default(300),
});
const claudeSessionLaunch = z.object({
  kind: z.literal('claude_session'),
  repoPath: z.string().min(1),
  /** Prompt template; context-packed by claude-launch.ts. */
  promptTemplate: z.string().min(1),
});
const skillLaunch = z.object({
  kind: z.literal('skill'),
  skill: z.string().min(1),
  repoPath: z.string().min(1),
});
export const launchSchema = z.discriminatedUnion('kind', [httpLaunch, cliLaunch, claudeSessionLaunch, skillLaunch]);
export type Launch = z.infer<typeof launchSchema>;

/** How a stopped tool can be brought up. A command *string* is shown to the user; the app never runs it silently. */
export const lifecycleSchema = z.object({
  startCommand: z.string().min(1),
  cwd: z.string().min(1),
  env: z.record(z.string()).default({}),
  readyTimeoutSec: z.number().int().positive().default(30),
});

// -------------------------------------------------------------------- output

export const outputSchema = z
  .object({
    kind: z.enum(['link', 'artifact', 'both']),
    link: z.object({ urlTemplate: z.string().min(1), label: z.string().min(1) }).optional(),
    artifacts: z
      .array(z.object({ pathTemplate: z.string().min(1), label: z.string().min(1), mime: z.string().optional(), revealable: z.boolean().default(true) }))
      .default([]),
  })
  .superRefine((o, ctx) => {
    if ((o.kind === 'link' || o.kind === 'both') && !o.link) ctx.addIssue({ code: 'custom', message: `output.kind=${o.kind} requires output.link`, path: ['link'] });
    if ((o.kind === 'artifact' || o.kind === 'both') && o.artifacts.length === 0) ctx.addIssue({ code: 'custom', message: `output.kind=${o.kind} requires at least one artifact`, path: ['artifacts'] });
  });

// -------------------------------------------------------------- health/progress

export const healthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('http'), url: z.string().url(), expectStatus: z.number().int().default(200), timeoutMs: z.number().int().positive().default(1500) }),
  z.object({ type: z.literal('cli'), cwd: z.string(), argv: z.array(z.string()).min(1), timeoutMs: z.number().int().positive().default(10000) }),
  z.object({ type: z.literal('file'), path: z.string() }),
  z.object({ type: z.literal('none') }),
]);

export const progressSchema = z.object({
  protocol: z.enum(['ndjson', 'sse', 'poll', 'none']),
  /** Path template relative to baseUrl, e.g. "/api/talk-tracks/{{trackId}}/jobs/{{jobId}}/stream". */
  path: z.string().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
});

// ------------------------------------------------------------------- privacy

export const privacySchema = z.object({
  /** One honest sentence for the UI: what the tool does with the inputs. */
  note: z.string().min(1),
  dataClass: z.enum(['public', 'internal', 'customer']),
  network: z.enum(['localhost-only', 'external']).default('localhost-only'),
  /** Local paths the tool itself writes to (the only mutations an adapter may cause). */
  writes: z.array(z.string()).default([]),
  /** Honest list of external services the tool's endpoint may itself call (Slack, Org62, Drive writes, LLM...). */
  externalCalls: z.array(z.object({ service: z.string(), kind: z.enum(['read', 'write', 'llm']), note: z.string().optional() })).default([]),
  /** When true the adapter refuses to start unless `confirm: true` is passed. Forced on for any external write. */
  requiresConfirm: z.boolean().default(false),
});

export const toolManifestSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    description: z.string().min(1),
    /** Icon token for the waffle launcher (lucide name or emoji-free key). */
    icon: z.string().min(1),
    version: z.number().int().positive().default(1),
    launch: launchSchema,
    lifecycle: lifecycleSchema.optional(),
    input: z.object({ fields: z.array(inputFieldSchema) }),
    output: outputSchema,
    health: healthSchema,
    progress: progressSchema,
    estimatedDuration: z.object({ minSec: z.number().nonnegative(), maxSec: z.number().positive() }).refine((d) => d.minSec <= d.maxSec, 'minSec <= maxSec'),
    privacy: privacySchema,
  })
  .superRefine((m, ctx) => {
    const keys = new Set<string>();
    m.input.fields.forEach((f, i) => {
      if (keys.has(f.key)) ctx.addIssue({ code: 'custom', message: `duplicate input key ${f.key}`, path: ['input', 'fields', i, 'key'] });
      keys.add(f.key);
    });
    if (m.launch.kind === 'http') {
      let host = '';
      try { host = new URL(m.launch.baseUrl).hostname; } catch { /* zod url() reports it */ }
      if (!isLoopbackHost(host)) ctx.addIssue({ code: 'custom', message: 'http launch baseUrl must be loopback (localhost, 127.0.0.1, ::1)', path: ['launch', 'baseUrl'] });
      if (m.progress.protocol !== 'none' && m.progress.protocol !== 'poll' && !m.progress.path) ctx.addIssue({ code: 'custom', message: 'streaming progress needs progress.path', path: ['progress', 'path'] });
    }
    if (m.launch.kind === 'http' && m.health.type === 'http') {
      let host = '';
      try { host = new URL(m.health.url).hostname; } catch { /* ignore */ }
      if (!isLoopbackHost(host)) ctx.addIssue({ code: 'custom', message: 'health url must be loopback', path: ['health', 'url'] });
    }
    // Any external write forces the confirm gate.
    if (m.privacy.externalCalls.some((c) => c.kind === 'write') && !m.privacy.requiresConfirm) {
      ctx.addIssue({ code: 'custom', message: 'externalCalls with kind=write require privacy.requiresConfirm=true', path: ['privacy', 'requiresConfirm'] });
    }
    if (m.privacy.network === 'localhost-only' && m.privacy.externalCalls.some((c) => c.kind === 'write')) {
      ctx.addIssue({ code: 'custom', message: 'network=localhost-only contradicts external write calls', path: ['privacy', 'network'] });
    }
    if (m.launch.kind === 'http' && !m.lifecycle) {
      ctx.addIssue({ code: 'custom', message: 'http tools need lifecycle.startCommand so a down tool can be offered a start command', path: ['lifecycle'] });
    }
  });

export type ToolManifest = z.infer<typeof toolManifestSchema>;
export type ToolManifestInput = z.input<typeof toolManifestSchema>;

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

export function parseManifest(raw: unknown): ToolManifest {
  return toolManifestSchema.parse(raw);
}

/**
 * Validate user-supplied run input against a manifest's field list.
 * Returns the cleaned input or the list of problems (never throws).
 */
export function validateInput(
  manifest: Pick<ToolManifest, 'input'>,
  raw: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: Record<string, unknown> = {};
  for (const f of manifest.input.fields) {
    let v = raw[f.key];
    if ((v === undefined || v === '') && 'default' in f && f.default !== undefined) v = f.default;
    if (v === undefined || v === null || v === '') {
      if (f.required) errors.push(`${f.key}: required`);
      continue;
    }
    switch (f.type) {
      case 'string':
      case 'text': {
        if (typeof v !== 'string') { errors.push(`${f.key}: must be a string`); break; }
        if (f.maxLength && v.length > f.maxLength) errors.push(`${f.key}: longer than ${f.maxLength}`);
        if (f.type === 'string' && f.pattern && !new RegExp(f.pattern).test(v)) errors.push(`${f.key}: does not match ${f.pattern}`);
        value[f.key] = v;
        break;
      }
      case 'enum':
        if (typeof v !== 'string' || !f.options.some((o) => o.value === v)) errors.push(`${f.key}: must be one of ${f.options.map((o) => o.value).join(', ')}`);
        else value[f.key] = v;
        break;
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${f.key}: must be a number`); break; }
        if (f.integer && !Number.isInteger(v)) errors.push(`${f.key}: must be an integer`);
        if (f.min !== undefined && v < f.min) errors.push(`${f.key}: below ${f.min}`);
        if (f.max !== undefined && v > f.max) errors.push(`${f.key}: above ${f.max}`);
        value[f.key] = v;
        break;
      }
      case 'boolean':
        if (typeof v !== 'boolean') errors.push(`${f.key}: must be a boolean`);
        else value[f.key] = v;
        break;
      case 'file': {
        const list = Array.isArray(v) ? v : [v];
        if (!list.every((p) => typeof p === 'string' && p.length > 0)) { errors.push(`${f.key}: must be file path(s)`); break; }
        if (!f.multiple && list.length > 1) errors.push(`${f.key}: only one file allowed`);
        value[f.key] = f.multiple ? list : list[0];
        break;
      }
      case 'entity_ref':
        if (typeof v !== 'string' || !v) errors.push(`${f.key}: must be a ${f.entity} id`);
        else value[f.key] = v;
        break;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
