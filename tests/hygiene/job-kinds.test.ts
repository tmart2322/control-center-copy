/**
 * HYG-1: no job is queued that no worker handles. Captures queued `enrich` for months with no handler, so every one
 * dead-lettered and every captured to-do stayed "enriching"; `agent.answer`, `tool.run` and `canvas.sync` were the
 * same. This is the creation-time guard: every `enqueueJob(…, { kind })` in src must name a kind the worker's
 * registry handles (the hygiene sweep cancels any that slip through at runtime).
 *
 * Also the Org62 cursor: the windowed Events and DCs reads go by SystemModstamp only, so an edit to an OLD record
 * (its SystemModstamp moves to now) falls in the next poll's window and is read.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDefaultRegistry } from '../../src/jobs';
import { activitySyncJobDef } from '../../src/jobs/handlers/activity-sync';
import { settleJobDef } from '../../src/jobs/handlers/settle';
import { vdpPushJobDef } from '../../src/jobs/handlers/vdp-push';
import { vdpAutopilotJobDef } from '../../src/jobs/handlers/vdp-autopilot';
import { outboxJobDef } from '../../src/outbox';
import { DEFAULT_MAINTENANCE } from '../../src/worker/schedules';

const ROOT = path.resolve(__dirname, '../..');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** The worker's registry as src/worker/index.ts builds it (deps are only used when a job runs). Keep in step with it. */
function workerKinds(): Set<string> {
  const r = createDefaultRegistry({});
  r.register(outboxJobDef({} as never));
  r.register(settleJobDef({} as never));
  r.register(activitySyncJobDef({} as never));
  r.register(vdpAutopilotJobDef({} as never));
  r.register(vdpPushJobDef({} as never));
  return new Set(r.kinds());
}

describe('every job kind the code queues has a handler', () => {
  const src = files(path.join(ROOT, 'src')).map((f) => ({ f, text: readFileSync(f, 'utf8') }));
  // string constants (`export const SETTLE_JOB_KIND = 'settle.check'`) anywhere in src
  const consts = new Map<string, string>();
  for (const { text } of src) for (const m of text.matchAll(/(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*'([a-z0-9_.]+)'/g)) consts.set(m[1]!, m[2]!);
  const queued: Array<{ file: string; kind: string }> = [];
  for (const { f, text } of src) {
    for (const m of text.matchAll(/enqueueJob\(\s*[\w.]+,\s*\{[^}]*?\bkind:\s*('([a-z0-9_.]+)'|([A-Z][A-Z0-9_]*))/g)) {
      const kind = m[2] ?? consts.get(m[3]!);
      if (kind) queued.push({ file: path.relative(ROOT, f), kind });
    }
  }

  it('finds the enqueue sites (the scan works)', () => {
    expect(queued.length).toBeGreaterThan(8);
    expect(queued.some((q) => q.kind === 'enrich')).toBe(true);
    expect(queued.some((q) => q.kind === 'hygiene.sweep')).toBe(true);
    expect(queued.some((q) => q.kind === 'org62.readback')).toBe(true);
  });

  it('each is registered with the worker (no dead-letter "no handler for …")', () => {
    const kinds = workerKinds();
    const missing = queued.filter((q) => !kinds.has(q.kind));
    expect(missing, missing.map((m) => `${m.kind} (${m.file})`).join('\n')).toEqual([]);
  });

  it('the scheduled kinds too, and the dead stubs are gone', () => {
    const kinds = workerKinds();
    for (const s of DEFAULT_MAINTENANCE) expect(kinds.has(s.kind), s.kind).toBe(true);
    const all = src.map((x) => x.text).join('\n');
    expect(all).not.toMatch(/kind: 'agent\.answer'/);
    expect(all).not.toMatch(/kind: 'canvas\.sync'/);
    expect(kinds.has('enrich')).toBe(true);
    expect(kinds.has('tool.run')).toBe(true);
  });
});

describe('the Org62 cursor sees edits to old records', () => {
  const skill = readFileSync(path.join(ROOT, 'skills/scan-org62.md'), 'utf8');
  const query = (from: string) => skill.split('\n').find((l) => l.startsWith('SELECT') && l.includes(`FROM ${from} WHERE`) && l.includes('{{window.fromSoql}}'));

  it.each(['Event', 'Deal_Contribution__c'])('the windowed %s read filters by SystemModstamp only, never by its own dates', (obj) => {
    const q = query(obj);
    expect(q, obj).toBeTruthy();
    expect(q).toMatch(/SystemModstamp >= \{\{window\.fromSoql\}\} AND SystemModstamp < \{\{window\.toSoql\}\}/);
    expect(q).toMatch(/ORDER BY SystemModstamp, Id/);
    expect(q).not.toMatch(/StartDateTime\s*[<>=]|CreatedDate\s*[<>=]|LastModifiedDate\s*[<>=]/);
  });
});
