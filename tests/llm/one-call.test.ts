/**
 * The one-call relay (src/llm/one-call.ts) with a fake query: no model, no MCP server, no network. 2026-11-16: a
 * 74,000-character logging canvas timed out on every Apply because the prompt pasted the whole canvas and asked the
 * model to call the tool "with these arguments", so it re-typed ~20,000 tokens before the 90 s watchdog. Now long
 * values reach the model as a stand-in (the hook swaps the real ones in), and a run that ended before the call says
 * so (`called: false`), which the Outbox reads as "nothing was sent". Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import type { HookCallback, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { relayStandIn, runOneToolCall, STAND_IN, STAND_IN_OVER } from '../../src/llm/one-call';
import type { LoadedSkill } from '../../src/llm/skill-loader';
import type { QueryFn } from '../../src/llm/skill-runner';

const FULL = 'mcp__slack__slack_create_canvas';
const SKILL = { frontmatter: { model: 'claude-haiku-5-5', max_turns: 2, budget_usd_per_run: 1 }, body: 'relay' } as unknown as LoadedSkill;
const BIG = '# USE CASES (22 rows)\n' + 'x'.repeat(74_000);
const ARGS = { title: 'Activity log · Placeholder · 22 use cases', content: BIG };

const pre = (o: Options) => (o.hooks!.PreToolUse![0]!.hooks[0] as HookCallback);
const hookInput = (tool: string, input: unknown) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: 's', transcript_path: '', cwd: '' }) as never;

describe('relayStandIn', () => {
  it('long strings become the stand-in, short values and shapes stay', () => {
    const long = 'y'.repeat(STAND_IN_OVER + 1);
    expect(relayStandIn({ title: 'Short title', content: long, n: 3, list: ['a', long], nested: { body: long, ok: true } })).toEqual({ title: 'Short title', content: STAND_IN, n: 3, list: ['a', STAND_IN], nested: { body: STAND_IN, ok: true } });
    expect(relayStandIn({ q: 'y'.repeat(STAND_IN_OVER) })).toEqual({ q: 'y'.repeat(STAND_IN_OVER) });
  });
});

describe('runOneToolCall', () => {
  it('the prompt carries the stand-in, never the canvas; the hook sends the real arguments', async () => {
    let prompt = '';
    let sent: unknown = null;
    const queryFn: QueryFn = ({ prompt: p, options }) => {
      prompt = p;
      return (async function* () {
        const r = (await pre(options)(hookInput(FULL, { title: ARGS.title, content: STAND_IN }), 'tu_1', { signal: new AbortController().signal })) as { hookSpecificOutput?: { updatedInput?: unknown } };
        sent = r.hookSpecificOutput?.updatedInput ?? null;
        yield { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"canvas_id":"F0PLACEHOLD1"}' }] }] } } as unknown as SDKMessage;
        yield { type: 'result', total_cost_usd: 0.001, modelUsage: {} } as unknown as SDKMessage;
      })();
    };
    const r = await runOneToolCall({ servers: {}, fullTool: FULL, args: ARGS, allowedTools: [FULL], disallowedTools: [], skill: SKILL, queryFn, timeoutMs: 5_000 });
    expect(r).toMatchObject({ code: 'ok', called: true, text: '{"canvas_id":"F0PLACEHOLD1"}' });
    expect(prompt.length).toBeLessThan(1_000);
    expect(prompt).not.toContain('xxxxxxxxxx');
    expect(prompt).toContain(STAND_IN);
    expect(prompt).toContain(ARGS.title);
    expect(sent).toEqual(ARGS);
  });

  it('short arguments are passed as they are (a lookup reads the same as before)', async () => {
    let prompt = '';
    const queryFn: QueryFn = ({ prompt: p }) => {
      prompt = p;
      return (async function* () {
        yield { type: 'result', total_cost_usd: 0, modelUsage: {} } as unknown as SDKMessage;
      })();
    };
    await runOneToolCall({ servers: {}, fullTool: FULL, args: { query: 'SELECT Id FROM Opportunity LIMIT 1' }, allowedTools: [FULL], disallowedTools: [], skill: SKILL, queryFn, timeoutMs: 5_000 });
    expect(prompt).toContain('{"query":"SELECT Id FROM Opportunity LIMIT 1"}');
    expect(prompt).not.toContain(STAND_IN);
  });

  it('a timeout before the tool was called: called false (nothing reached the server)', async () => {
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        await new Promise<void>((resolve) => options.abortController!.signal.addEventListener('abort', () => resolve()));
        yield* [];
      })();
    const r = await runOneToolCall({ servers: {}, fullTool: FULL, args: ARGS, allowedTools: [FULL], disallowedTools: [], skill: SKILL, queryFn, timeoutMs: 30 });
    expect(r).toMatchObject({ text: null, code: 'timeout', called: false });
  });

  it('a timeout after the tool was let through: called true (it may have landed)', async () => {
    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        await pre(options)(hookInput(FULL, { title: ARGS.title, content: STAND_IN }), 'tu_1', { signal: new AbortController().signal });
        await new Promise<void>((resolve) => options.abortController!.signal.addEventListener('abort', () => resolve()));
        yield* [];
      })();
    const r = await runOneToolCall({ servers: {}, fullTool: FULL, args: ARGS, allowedTools: [FULL], disallowedTools: [], skill: SKILL, queryFn, timeoutMs: 30 });
    expect(r).toMatchObject({ text: null, code: 'timeout', called: true });
  });
});
