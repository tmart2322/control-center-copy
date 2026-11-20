import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateTokens, fitToBudget, hashInputs, stableStringify } from '../../src/engines/nba/prompt/budget';
import { buildNbaPrompt, systemPromptFor } from '../../src/engines/nba/prompt/build';
import { loadSkill, parseSkill } from '../../src/engines/nba/prompt/skills';
import type { NbaInput } from '../../src/engines/nba/prompt/types';
import { NBA_VERBS } from '../../src/engines/nba/prompt/types';
import { MODELS, VERB_SPECS } from '../../src/engines/nba/prompt/verbs';
import { REPO } from './eval-kit';
import { SCENARIOS } from './scenarios';

const nbaScenarios = SCENARIOS.filter((s): s is Extract<(typeof SCENARIOS)[number], { kind: 'nba' }> => s.kind === 'nba');
const byId = (id: string) => nbaScenarios.find((s) => s.id === id)!.input;

describe('skill files', () => {
  it('every verb has a versioned skill whose frontmatter names it', () => {
    for (const verb of NBA_VERBS) {
      const spec = VERB_SPECS[verb];
      const skill = loadSkill(spec.skill);
      expect(skill.version).toMatch(/^\d+/);
      expect(skill.meta.verb).toBe(verb);
      expect(skill.body).toContain('Update rule');
      expect(skill.body.length).toBeGreaterThan(1500);
    }
  });

  it('all required skills exist and parse', () => {
    const files = readdirSync(resolve(REPO, 'skills')).filter((f) => f.endsWith('.md'));
    for (const name of [
      'nba-common',
      'nba-reply',
      'nba-send-email',
      'nba-start-claude-session',
      'nba-run-tool',
      'nba-log-activity',
      'nba-update-vdp',
      'nba-nudge',
      'nba-schedule',
      'nba-review-deliverable',
      'draft-slack',
      'draft-email',
      'brief-channel',
      'brief-opportunity',
      'brief-relevance',
      'enrich-capture',
    ])
      expect(files).toContain(`${name}.md`);
    for (const f of files) expect(() => loadSkill(f.replace(/\.md$/, ''))).not.toThrow();
  });

  it('rejects a skill without a version', () => {
    expect(() => parseSkill('x', '---\nname: x\n---\nbody')).toThrow(/version/);
  });

  it('skills carry no real-looking secrets', () => {
    const files = readdirSync(resolve(REPO, 'skills'));
    for (const f of files) {
      const body = loadSkill(f.replace(/\.md$/, '')).body;
      expect(body).not.toMatch(/sk-ant-|xox[bp]-|AKIA[0-9A-Z]{16}/);
    }
  });
});

describe('buildNbaPrompt', () => {
  it('builds every NBA scenario within budget, with the right model and skills', () => {
    for (const s of nbaScenarios) {
      const p = buildNbaPrompt(s.input);
      const spec = VERB_SPECS[s.input.verb];
      expect(p.model).toBe(MODELS[spec.tier]);
      expect(p.system).toContain('Next best action: shared contract');
      expect(p.promptVersion).toContain(`${spec.skill}@`);
      expect(p.user).toContain(`id: ${s.input.workItem.id}`);
      expect(p.user).toContain('<task>');
      expect(p.budget.estimatedTokens).toBeLessThanOrEqual(spec.contextBudgetTokens);
      expect(p.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('picks the draft style by destination', () => {
    expect(systemPromptFor(byId('missed-meeting-takeaway')).skills.map((s) => s.name)).toContain('draft-email');
    expect(systemPromptFor(byId('reply-scope-change')).skills.map((s) => s.name)).toContain('draft-slack');
    expect(systemPromptFor(byId('log-activity-week')).skills.map((s) => s.name)).not.toContain('draft-slack');
  });

  it('renders local times with weekday and zone', () => {
    const p = buildNbaPrompt(byId('reply-scope-change'));
    expect(p.user).toMatch(/Thu 2026-11-05 08:40 MST/);
    expect(p.user).toMatch(/\[cal_demo\] Fri 2026-11-06 14:00 MST → 15:00/);
  });

  it('marks user-touched drafts and tells the model not to overwrite', () => {
    const p = buildNbaPrompt(byId('user-touched-draft-new-info'));
    expect(p.user).toContain('USER-TOUCHED DRAFT: yes');
    expect(p.user).toContain('architecture diagram we sketched');
    expect(p.user).toContain('draft MUST be null');
  });

  it('omits voice for plan-only verbs', () => {
    const input = { ...byId('kickoff-long-build-first'), voice: 'VOICE-BLOCK' };
    expect(buildNbaPrompt(input).user).not.toContain('VOICE-BLOCK');
    expect(buildNbaPrompt({ ...byId('reply-scope-change'), voice: 'VOICE-BLOCK' }).user).toContain('VOICE-BLOCK');
  });

  it('redacts credential-like text before it reaches the prompt', () => {
    const input: NbaInput = {
      ...byId('reply-scope-change'),
      evidence: [...byId('reply-scope-change').evidence, { id: 'ev_pw', source: 'slack', role: 'context', at: '2026-11-05T08:00:00-07:00', excerpt: 'demo login password: Hunter2Secret!' }],
    };
    const p = buildNbaPrompt(input);
    expect(p.user).not.toContain('Hunter2Secret');
    expect(p.user).toContain('[redacted:labeled_secret]');
  });

  it('inputsHash ignores time of day but not evidence', () => {
    const a = byId('reply-scope-change');
    const later = { ...a, now: '2026-11-05T13:10:00-07:00', calendar: { ...a.calendar!, now: '2026-11-05T13:10:00-07:00' } };
    expect(buildNbaPrompt(later).inputsHash).toBe(buildNbaPrompt(a).inputsHash);
    const more = { ...a, evidence: [...a.evidence, { ...a.evidence[0]!, id: 'ev_extra' }] };
    expect(buildNbaPrompt(more).inputsHash).not.toBe(buildNbaPrompt(a).inputsHash);
    const nextDay = { ...a, now: '2026-11-06T08:40:00-07:00' };
    expect(buildNbaPrompt(nextDay).inputsHash).not.toBe(buildNbaPrompt(a).inputsHash);
  });

  it('truncates low-priority context first and says so', () => {
    const a = byId('reply-scope-change');
    const filler = Array.from({ length: 80 }, (_, i) => ({
      id: `ctx_${i}`,
      source: 'slack' as const,
      role: 'context' as const,
      at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00-07:00`,
      excerpt: 'Background chatter about an unrelated topic. '.repeat(20),
    }));
    const input: NbaInput = { ...a, evidence: [...a.evidence, ...filler] };
    const p = buildNbaPrompt(input, { contextBudgetTokens: 3000 });
    expect(p.budget.estimatedTokens).toBeLessThanOrEqual(3000);
    expect(p.budget.dropped.length).toBeGreaterThan(0);
    expect(p.budget.dropped.every((d) => d.startsWith('evidence:ctx_') || d.startsWith('thread:'))).toBe(true);
    expect(p.user).toContain('[ev_new]'); // NEW evidence survives
    expect(p.user).toContain('[ev_notes]'); // origin survives
    expect(p.user).toMatch(/lower-priority evidence entries omitted for length/);
    expect(p.user).toContain('id: wi_scope'); // required work item survives
  });
});

describe('budget primitives', () => {
  it('fitToBudget keeps required units even over budget', () => {
    const { text, report } = fitToBudget([{ key: 'k', tag: 'k', units: [{ priority: 0, text: 'x'.repeat(4000) }, { priority: 5, text: 'drop me' }] }], 100);
    expect(text).toContain('x'.repeat(100));
    expect(text).not.toContain('drop me');
    expect(report.dropped).toHaveLength(1);
  });

  it('trims before dropping', () => {
    const { report } = fitToBudget(
      [{ key: 'k', tag: 'k', units: [{ priority: 3, text: 'a'.repeat(2000), trimTo: 200, label: 'long' }, { priority: 3, text: 'short', label: 'short' }] }],
      estimateTokens('a'.repeat(260)) + 20,
    );
    expect(report.trimmed).toContain('k:long');
    expect(report.dropped).not.toContain('k:short');
  });

  it('stableStringify sorts keys and skips undefined', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe('{"a":{"c":[2,1]},"b":1}');
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
  });
});
