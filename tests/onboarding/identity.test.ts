/**
 * B-079 id detection on the Sources step: the read-only lookups (fake SDK: no model, no network, no MCP), how their
 * output is read, and how outcomes land in the draft. Placeholder data only. Ambiguous and failed lookups leave the
 * field empty.
 */
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OnboardingState, Seed } from '@/contract';
import type { QueryFn } from '@/llm/skill-runner';
import { MockDataSource } from '@/server/datasource/mock';
import { applyDetections, freshStored } from '@/server/onboarding/core';
import { LiveIdentityDetector, lookupFor, MOCK_IDENTITIES, parseOrg62User, parseSlackSelf, toolText } from '@/server/onboarding/identity';

const NOW = new Date('2026-11-06T15:00:00.000Z');
const EMAIL = 'ada.placeholder@example.com';

const slackResults = (froms: string[]) =>
  JSON.stringify({
    results: `# Search Results for: from:me\n\n## Messages (${froms.length} results)\n${froms
      .map((f, i) => `### Result ${i + 1} of ${froms.length}\nChannel: #team-updates (ID: C0TEAMUPD)\nFrom: ${f}\nTime: 2026-11-05 08:42:14 MST\nMessage_ts: 179389333${i}.322509\nPermalink: [link](https:\\/\\/example.slack.com\\/archives\\/C0TEAMUPD\\/p1793893334322509)\nText: \nplaceholder message ${i}\n\n---\n\n`)
      .join('')}`,
  });
const ADA = `Ada Placeholder <${EMAIL}> (ID: U0PLACE001) `;
const soql = (rows: Array<{ Id: string; Name: string; Email?: string }>) => JSON.stringify({ totalSize: rows.length, done: true, records: rows.map((r) => ({ attributes: { type: 'User' }, Email: EMAIL, ...r })) });

describe('reading a lookup’s output', () => {
  it('Org62: exactly one active user with your email', () => {
    expect(parseOrg62User(soql([{ Id: '005XX0000000PLAAAA', Name: 'Ada Placeholder' }]), EMAIL)).toMatchObject({ status: 'found', id: '005XX0000000PLAAAA', name: 'Ada Placeholder' });
    expect(parseOrg62User(soql([]), EMAIL)).toMatchObject({ status: 'not_found', id: null });
    expect(parseOrg62User(soql([{ Id: '005XX0000000PLAAAA', Name: 'A' }, { Id: '005XX0000000PLBAAA', Name: 'B' }]), EMAIL)).toMatchObject({ status: 'ambiguous', id: null });
    expect(parseOrg62User(soql([{ Id: '005XX0000000PLAAAA', Name: 'A', Email: 'someone.else@example.com' }]), EMAIL)).toMatchObject({ status: 'not_found', id: null });
    expect(parseOrg62User('Error: session expired', EMAIL)).toMatchObject({ status: 'failed', id: null });
  });

  it('Slack: one author on your own messages, with your email', () => {
    expect(parseSlackSelf(slackResults([ADA, ADA]), EMAIL)).toMatchObject({ status: 'found', id: 'U0PLACE001', name: 'Ada Placeholder' });
    expect(parseSlackSelf(slackResults([ADA, 'Lee Placeholder <lee@example.com> (ID: U0PLACE002) ']), EMAIL)).toMatchObject({ status: 'ambiguous', id: null });
    expect(parseSlackSelf(slackResults(['Ada Placeholder <ada@other.example> (ID: U0PLACE001) ']), EMAIL)).toMatchObject({ status: 'ambiguous', id: null });
    expect(parseSlackSelf(JSON.stringify({ results: '# Search Results for: from:me\n\nNo results found.' }), EMAIL)).toMatchObject({ status: 'not_found', id: null });
  });

  it('unwraps the result shapes the SDK hands back', () => {
    expect(toolText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(toolText({ content: [{ type: 'text', text: 'x' }] })).toBe('x');
    expect(toolText('plain')).toBe('plain');
  });

  it('builds only the one query per lookup, and refuses an email that could change it', () => {
    expect(lookupFor('org62', EMAIL)).toEqual({ connector: 'org62', tool: 'soqlQuery', args: { q: `SELECT Id, Name, Email FROM User WHERE Email = '${EMAIL}' AND IsActive = true LIMIT 2` } });
    expect(lookupFor('slack', EMAIL).args).toMatchObject({ filters: 'from:me' });
    expect(() => lookupFor('org62', "x' OR Name != '@example.com")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The run, through a scripted SDK
// ---------------------------------------------------------------------------

interface Script {
  /** What the "model" asks for (it may try other arguments or tools). */
  tool: string;
  input?: Record<string, unknown>;
  /** The tool's output, when it runs. */
  output?: string;
  costUsd?: number;
  throws?: boolean;
}

function fakeSdk(s: Script, seen: { options?: Options; ranWith?: unknown; ran: boolean }): QueryFn {
  return ({ options }) => {
    seen.options = options;
    const signal = options.abortController!.signal;
    async function* gen(): AsyncGenerator<SDKMessage> {
      if (s.throws) throw new Error('spawn claude ENOENT');
      yield { type: 'assistant', message: { id: 'msg_1', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: 'toolu_1', name: s.tool, input: s.input ?? {} }], usage: { input_tokens: 2400, output_tokens: 40 } } } as unknown as SDKMessage;
      const pre = options.hooks!.PreToolUse![0]!.hooks[0]!;
      const d = (await pre({ hook_event_name: 'PreToolUse', tool_name: s.tool, tool_input: s.input ?? {} } as never, 'toolu_1', { signal })) as { continue?: boolean; hookSpecificOutput?: { permissionDecision?: string; updatedInput?: unknown } };
      if (d.hookSpecificOutput?.permissionDecision === 'allow' && !signal.aborted) {
        seen.ran = true;
        seen.ranWith = d.hookSpecificOutput.updatedInput;
        const post = options.hooks!.PostToolUse![0]!.hooks[0]!;
        await post({ hook_event_name: 'PostToolUse', tool_name: s.tool, tool_input: d.hookSpecificOutput.updatedInput, tool_response: [{ type: 'text', text: s.output ?? '' }] } as never, 'toolu_1', { signal });
      }
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'DONE',
        num_turns: 1,
        total_cost_usd: s.costUsd ?? 0.0009,
        usage: { input_tokens: 2400, output_tokens: 40 },
        modelUsage: { 'claude-haiku-5-5': { inputTokens: 2400, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: s.costUsd ?? 0.0009, contextWindow: 200000 } },
        permission_denials: [],
      } as unknown as SDKMessage;
    }
    return gen();
  };
}

const detector = (s: Script, seen: { options?: Options; ranWith?: unknown; ran: boolean }) =>
  new LiveIdentityDetector({ queryFn: fakeSdk(s, seen), gateway: { env: {} }, mcpServersFor: (c) => ({ [c === 'slack' ? 'slack' : 'Org62-Sobject-Read']: { type: 'http', url: 'https://mcp.example' } }), now: () => NOW });

describe('the lookup run (fake SDK)', () => {
  it('Slack: loads only Slack, allows only the search tool, runs it with our arguments, reads the id from its output', async () => {
    const seen = { ran: false } as { options?: Options; ranWith?: unknown; ran: boolean };
    const r = await detector({ tool: 'mcp__slack__slack_search_public_and_private', input: { query: 'from:me in:#anything', limit: 100 }, output: slackResults([ADA, ADA]), costUsd: 0.0011 }, seen).detect('slack', { email: EMAIL });
    expect(r.detection).toMatchObject({ status: 'found', id: 'U0PLACE001', name: 'Ada Placeholder', costUsd: 0.0011 });
    expect(r.spend).toMatchObject({ kind: 'slack', model: 'claude-haiku-5-5', costUsd: 0.0011, status: 'ok', inputTokens: 2400, outputTokens: 40 });
    expect(seen.ranWith).toEqual(lookupFor('slack', EMAIL).args);
    const o = seen.options!;
    expect(Object.keys(o.mcpServers ?? {})).toEqual(['slack']);
    expect(o.allowedTools).toEqual(['mcp__slack__slack_search_public_and_private']);
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['mcp__slack__slack_send_message', 'mcp__slack__slack_read_user_profile']));
    expect([o.tools, o.strictMcpConfig, o.permissionMode, o.model]).toEqual([[], true, 'dontAsk', 'claude-haiku-5-5']);
    expect(o.maxBudgetUsd).toBeLessThanOrEqual(0.03);
  });

  it('Org62: the SOQL lookup finds exactly one user', async () => {
    const seen = { ran: false } as { options?: Options; ranWith?: unknown; ran: boolean };
    const r = await detector({ tool: 'mcp__Org62-Sobject-Read__soqlQuery', input: { q: 'SELECT Id FROM User' }, output: soql([{ Id: '005XX0000000PLAAAA', Name: 'Ada Placeholder' }]) }, seen).detect('org62', { email: EMAIL });
    expect(r.detection).toMatchObject({ status: 'found', id: '005XX0000000PLAAAA' });
    expect(seen.ranWith).toEqual({ q: `SELECT Id, Name, Email FROM User WHERE Email = '${EMAIL}' AND IsActive = true LIMIT 2` });
    expect(seen.options!.allowedTools).toEqual(['mcp__Org62-Sobject-Read__soqlQuery']);
  });

  it('ambiguous and failed lookups leave the id empty', async () => {
    const two = await detector({ tool: 'mcp__Org62-Sobject-Read__soqlQuery', output: soql([{ Id: '005XX0000000PLAAAA', Name: 'A' }, { Id: '005XX0000000PLBAAA', Name: 'B' }]) }, { ran: false }).detect('org62', { email: EMAIL });
    expect(two.detection).toMatchObject({ status: 'ambiguous', id: null });
    const crashed = await detector({ tool: 'x', throws: true }, { ran: false }).detect('slack', { email: EMAIL });
    expect(crashed.detection).toMatchObject({ status: 'failed', id: null });
    const noEmail = await detector({ tool: 'x' }, { ran: false }).detect('org62', { email: '' });
    expect(noEmail).toMatchObject({ detection: { status: 'failed', id: null }, spend: null });
  });

  it('a call to any other tool is stopped, never run, and fills nothing', async () => {
    const seen = { ran: false } as { options?: Options; ranWith?: unknown; ran: boolean };
    const r = await detector({ tool: 'mcp__slack__slack_send_message', input: { channel_id: 'C0TEAMUPD', message: 'hi' } }, seen).detect('slack', { email: EMAIL });
    expect(seen.ran).toBe(false);
    expect(r.detection).toMatchObject({ status: 'failed', id: null });
  });
});

describe('outcomes in the draft', () => {
  it('fills an empty field only when found; a typed value stays; spend accumulates', () => {
    const base = freshStored('x', { email: EMAIL, slackUserId: '', org62UserId: 'typed-by-you' }, NOW);
    const det = (status: 'found' | 'ambiguous', id: string | null) => ({ status, id, name: null, message: '', at: NOW.toISOString(), costUsd: 0.001, simulated: false });
    const spend = { kind: 'slack' as const, model: 'claude-haiku-5-5', costUsd: 0.001, inputTokens: 2400, outputTokens: 40, status: 'ok' as const, errorCode: null, startedAt: NOW.toISOString(), ms: 4000 };
    const next = applyDetections(base, [{ kind: 'slack', detection: det('found', 'U0PLACE001'), spend }, { kind: 'org62', detection: det('found', '005XX0000000PLAAAA'), spend: { ...spend, kind: 'org62' } }], NOW);
    expect(next.draft.you).toMatchObject({ slackUserId: 'U0PLACE001', org62UserId: 'typed-by-you' });
    expect(next.draft.spend).toHaveLength(2);
    expect([next.step, next.reached]).toEqual([base.step, base.reached]);
    const amb = applyDetections(freshStored('x', { slackUserId: '' }, NOW), [{ kind: 'slack', detection: det('ambiguous', null), spend: null }], NOW);
    expect(amb.draft.you.slackUserId).toBe('');
    expect(amb.draft.identities.slack?.status).toBe('ambiguous');
  });
});

describe('mock mode', () => {
  const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
  let ds: MockDataSource;
  beforeEach(() => {
    ds = new MockDataSource({ seed: structuredClone(seed), delays: { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 }, autoplay: false, clockMode: 'seed' });
  });
  afterEach(() => ds.dispose());

  it('returns placeholder ids without any call, and they count for the Sources step', async () => {
    expect((await ds.getOnboarding({} as never)).detection).toBe('simulated');
    const s = OnboardingState.parse(await ds.saveOnboardingStep({ body: { step: 'sources', value: { detect: ['slack', 'org62'] } } }));
    expect(s.draft.identities.slack).toMatchObject({ status: 'found', id: MOCK_IDENTITIES.slack, simulated: true, costUsd: 0 });
    expect(s.draft.you).toMatchObject({ slackUserId: MOCK_IDENTITIES.slack, org62UserId: MOCK_IDENTITIES.org62 });
    expect(s.draft.spend).toEqual([]);
    expect(s.step).toBe('role'); // a lookup never moves the step (a fresh draft starts at the role)
    expect(s.issues.filter((i) => i.step === 'sources')).toEqual([]);
  });
});
