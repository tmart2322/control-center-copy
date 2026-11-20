import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLoopbackHost, parseManifest, toolManifestSchema, validateInput } from '@/tools/manifest';
import { loadManifests } from '@/tools/registry';
import { readManifestFile } from './helpers/mock-servers';

const REG = path.resolve(__dirname, '../../tools-registry');

describe('committed manifests', () => {
  it('every file in tools-registry validates and ids are unique', async () => {
    const ms = await loadManifests(REG);
    expect(ms.map((m) => m.id).sort()).toEqual(['afd360-estimate-new', 'afd360-estimator', 'pulse-footprint', 'talk-track']);
    expect(readdirSync(REG).filter((f) => f.endsWith('.json')).length).toBe(ms.length);
  });

  it('talk-track: http/ndjson on 4320 with a health check', () => {
    const m = parseManifest(readManifestFile('talk-track'));
    expect(m.launch).toMatchObject({ kind: 'http', port: 4320 });
    expect(m.progress.protocol).toBe('ndjson');
    expect(m.health).toMatchObject({ type: 'http', url: 'http://localhost:4320/api/talk-tracks' });
    expect(m.lifecycle?.startCommand).toBe('npm start');
  });

  it('pulse-footprint: SSE on 4318, external read gated by confirm', () => {
    const m = parseManifest(readManifestFile('pulse-footprint'));
    expect(m.progress.protocol).toBe('sse');
    expect(m.privacy.requiresConfirm).toBe(true);
    expect(m.privacy.externalCalls[0]).toMatchObject({ service: 'Pulse Superset', kind: 'read' });
  });

  it('afd360-estimator: cli that always passes --out', () => {
    const m = parseManifest(readManifestFile('afd360-estimator'));
    expect(m.launch.kind).toBe('cli');
    expect((m.launch as { argv: string[] }).argv).toContain('--out');
  });

  it('afd360-estimate-new: claude_session launch', () => {
    expect(parseManifest(readManifestFile('afd360-estimate-new')).launch.kind).toBe('claude_session');
  });
});

describe('schema rules', () => {
  const base = () => structuredClone(readManifestFile('talk-track')) as Record<string, any>;

  it('rejects non-loopback http tools', () => {
    const m = base();
    m.launch.baseUrl = 'https://example.com';
    expect(toolManifestSchema.safeParse(m).success).toBe(false);
  });

  it('rejects non-loopback health urls', () => {
    const m = base();
    m.health.url = 'http://example.com/health';
    expect(toolManifestSchema.safeParse(m).success).toBe(false);
  });

  it('forces confirm when an external write is declared', () => {
    const m = base();
    m.privacy.externalCalls = [{ service: 'Slack', kind: 'write' }];
    m.privacy.requiresConfirm = false;
    const r = toolManifestSchema.safeParse(m);
    expect(r.success).toBe(false);
    // and localhost-only is contradicted too
    m.privacy.requiresConfirm = true;
    expect(toolManifestSchema.safeParse(m).success).toBe(false);
    m.privacy.network = 'external';
    expect(toolManifestSchema.safeParse(m).success).toBe(true);
  });

  it('rejects duplicate input keys, bad slugs and inconsistent output', () => {
    const m = base();
    m.input.fields.push({ ...m.input.fields[0] });
    expect(toolManifestSchema.safeParse(m).success).toBe(false);
    const s = base(); s.id = 'Talk Track';
    expect(toolManifestSchema.safeParse(s).success).toBe(false);
    const o = base(); o.output = { kind: 'link' };
    expect(toolManifestSchema.safeParse(o).success).toBe(false);
  });

  it('requires lifecycle for http tools and streaming path', () => {
    const m = base(); delete m.lifecycle;
    expect(toolManifestSchema.safeParse(m).success).toBe(false);
    const p = base(); delete p.progress.path;
    expect(toolManifestSchema.safeParse(p).success).toBe(false);
  });

  it('isLoopbackHost', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', 'a.localhost']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['example.com', '10.0.0.1', 'localhost.evil.com']) expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('validateInput (form subset)', () => {
  const m = parseManifest({
    ...(readManifestFile('talk-track') as object),
    input: {
      fields: [
        { key: 's', type: 'string', label: 's', required: true, maxLength: 5 },
        { key: 'e', type: 'enum', label: 'e', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
        { key: 'n', type: 'number', label: 'n', integer: true, min: 1, max: 10 },
        { key: 'b', type: 'boolean', label: 'b' },
        { key: 'f', type: 'file', label: 'f', multiple: true },
        { key: 'acct', type: 'entity_ref', entity: 'account', label: 'acct' },
        { key: 't', type: 'text', label: 't' },
      ],
    },
  });

  it('accepts valid input and applies defaults', () => {
    const r = validateInput(m, { s: 'abc', n: 3, b: true, f: '/x.md', acct: 'acc_1', t: 'long' });
    expect(r).toEqual({ ok: true, value: { s: 'abc', e: 'a', n: 3, b: true, f: ['/x.md'], acct: 'acc_1', t: 'long' } });
  });

  it('reports every problem', () => {
    const r = validateInput(m, { s: 'too long!', e: 'z', n: 2.5, b: 'yes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('|')).toMatch(/s: longer than 5.*e: must be one of.*n: must be an integer.*b: must be a boolean/);
  });

  it('requires required fields', () => {
    const r = validateInput(m, {});
    expect(r).toEqual({ ok: false, errors: ['s: required'] });
  });
});
