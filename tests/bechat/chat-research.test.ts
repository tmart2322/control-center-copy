/**
 * `chat_research`: a question-scoped research run with the read-in agent's guards. Covers the research tools
 * (Calendar search filter and range limits, the finish call refusing links the run was never shown), the run itself
 * over a fake agent that executes the real tools, the chat tool (budget gate, one recorded spend line, mock mode
 * says it can't go live), and the turn deadline a long research run extends. Placeholder data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedEvent } from '@/connectors/google/parse';
import type { GoogleTools } from '@/connectors/google/client';
import { createFakeChatQuery } from '@/llm/chat/fake';
import { CHAT_TOOL_TIMEOUT_MS } from '@/llm/chat/server';
import { runChatTurn } from '@/llm/chat/runner';
import type { ChatUsageRecord } from '@/llm/chat/types';
import type { ResearchAgent, ResearchRunInput } from '@/llm/readin/agent';
import { calendarLines, createResearchState, createResearchTools } from '@/llm/research/tools';
import { createChatHost } from '@/server/chat/host';
import { RESEARCH_TIMEOUT_MS, runChatResearch, type ChatResearchResult } from '@/server/chat/research';
import type { MockDataSource } from '@/server/datasource/mock';
import { collect, mockWith, of, textOf } from './helpers';

type G = { __ccDataSource?: unknown };
let ds: MockDataSource;
beforeEach(() => {
  ds = mockWith();
  (globalThis as G).__ccDataSource = ds;
});
afterEach(() => {
  delete (globalThis as G).__ccDataSource;
  ds.dispose();
});

const ev = (o: Partial<ParsedEvent> & { title: string; start: string }): ParsedEvent => ({
  id: o.title,
  startsRaw: o.start,
  endsRaw: o.start,
  end: o.start,
  allDay: false,
  description: '',
  location: '',
  attendeeEmails: [],
  attendees: [],
  attachments: [],
  ...o,
});

describe('research tools', () => {
  it('calendar lines keep only events mentioning every word, with attendee domains and links', () => {
    const events = [
      ev({ title: 'ACME workshop', start: '2025-03-12T15:00:00Z', attendeeEmails: ['a@acme.example', 'b@example.com'], link: 'https://calendar.example.com/e1' }),
      ev({ title: 'Team sync', start: '2025-03-13T15:00:00Z', description: 'nothing here' }),
      ev({ title: 'Prep', start: '2025-03-14T15:00:00Z', description: 'for the ACME renewal' }),
    ];
    expect(calendarLines(events, 'acme')).toEqual(['- 2025-03-12T15:00 · ACME workshop · with acme.example, example.com (https://calendar.example.com/e1)', '- 2025-03-14T15:00 · Prep']);
    expect(calendarLines(events, 'acme renewal')).toHaveLength(1);
    expect(calendarLines(events)).toHaveLength(3);
  });

  it('calendar search refuses a range over a year and says when Google is unavailable', async () => {
    const google: GoogleTools = { call: async () => 'No events found' } as unknown as GoogleTools;
    const state = createResearchState();
    const h = createResearchTools({ google }, state);
    expect((await h.research_calendar_search({ from: '2023-01-01', to: '2025-01-01' })).text).toMatch(/at most 366 days/);
    expect((await h.research_calendar_search({ from: '2025-01-01', to: '2025-06-01', words: 'acme' })).text).toMatch(/No events mentioning "acme"/);
    const none = createResearchTools({ google: null }, createResearchState());
    expect((await none.research_calendar_search({ from: '2025-01-01', to: '2025-02-01' })).text).toMatch(/not available/);
  });

  it('finish refuses a link the run was never shown, and accepts one it was', async () => {
    const state = createResearchState(['https://slack.example.com/archives/C1/p1']);
    const h = createResearchTools({}, state);
    const out = { answer: 'Yes: one thread.', findings: [{ text: 'A thread about the workshop', source: 'slack', permalink: 'https://made-up.example.com/x' }], searched: [{ source: 'slack', query: 'acme', hits: 1 }], notFound: [], confidence: 'likely' };
    expect((await h.research_finish(out)).isError).toBe(true);
    expect(state.output).toBeNull();
    const ok = await h.research_finish({ ...out, findings: [{ ...out.findings[0], permalink: 'https://slack.example.com/archives/C1/p1' }] });
    expect(ok.isError).toBeFalsy();
    expect(state.output?.answer).toBe('Yes: one thread.');
  });
});

/** A fake agent that runs the real local tools through `local.call`, as the model would. */
function fakeAgent(script: (call: NonNullable<NonNullable<ResearchRunInput['local']>['call']>, input: ResearchRunInput) => Promise<void>): ResearchAgent & { seen?: ResearchRunInput } {
  const a: ResearchAgent & { seen?: ResearchRunInput } = {
    async run(input) {
      a.seen = input;
      await script(input.local!.call!, input);
      const done = input.local!.done();
      return { ok: done, output: null, costUsd: 0.12, inputTokens: 9000, outputTokens: 700, turns: 4, toolCalls: ['mcp__cc_research__research_ledger_search', 'mcp__cc_research__research_finish'], ...(done ? {} : { error: { code: 'invalid_output', message: 'no finish', errorClass: 'unknown' as const } }) };
    },
  };
  return a;
}

describe('timeouts', () => {
  it('the chat tool server waits longer than a research run, so a long run is never cut off mid-way', () => {
    // A live run was cut at the old 60 s tool timeout and then cancelled when the turn ended.
    expect(CHAT_TOOL_TIMEOUT_MS).toBeGreaterThan(RESEARCH_TIMEOUT_MS + 10_000);
  });
});

describe('runChatResearch', () => {
  const db = { execute: async () => ({ rows: [{ name: 'PERSON_ME', system: 'org62_user', external_id: '005XX0000000MOCKAA' }] }) } as never;
  const base = { db, userId: 'u1', now: new Date('2026-11-10T20:00:00Z'), timezone: 'America/Denver', google: null, costCapUsd: 0.5, signal: new AbortController().signal, external: () => ({ servers: {}, tools: [], unavailable: ['Slack', 'Org62'] }) };

  it('runs the question-scoped skill with the research tools and returns the validated answer', async () => {
    const ledger = { search: async () => [{ kind: 'message' as const, at: '2025-03-12T15:00:00Z', label: '#acme-ext', text: 'Workshop recap', fromMe: true, permalink: 'https://slack.example.com/archives/C1/p1' }] };
    const agent = fakeAgent(async (call) => {
      await call('research_ledger_search', { text: 'ACME' });
      await call('research_finish', { answer: 'Yes: a workshop in March 2025.', findings: [{ text: 'Workshop recap you posted', source: 'slack', label: '#acme-ext', at: '2025-03-12', permalink: 'https://slack.example.com/archives/C1/p1' }], searched: [{ source: 'ledger', query: 'ACME', hits: 1 }], notFound: ['no Drive files'], confidence: 'sure' });
    });
    const r = await runChatResearch({ question: 'Have I done anything for ACME?', names: ['ACME'] }, { ...base, ledger, agent });
    expect(r.output?.answer).toBe('Yes: a workshop in March 2025.');
    expect(r.error).toBeUndefined();
    expect(r.unavailable).toEqual(expect.arrayContaining(['Slack', 'Org62', 'Gmail', 'Calendar']));
    expect(r.skill).toMatch(/^research-question@/);
    const sys = agent.seen!.systemPrompt.join('\n');
    expect(sys).toContain('"org62UserId":"005XX0000000MOCKAA"');
    expect(sys).toContain('"names":["ACME"]');
    expect(agent.seen!.local!.tools).toContain('mcp__cc_research__research_calendar_search');
    expect(agent.seen!.prompt).toContain('unavailable this run');
  });

  it('a run that never finishes comes back as an error, not an answer', async () => {
    const r = await runChatResearch({ question: 'Anything for ACME?' }, { ...base, ledger: { search: async () => [] }, agent: fakeAgent(async () => undefined) });
    expect(r.output).toBeNull();
    expect(r.error?.code).toBe('invalid_output');
  });
});

describe('chat_research in a chat turn', () => {
  const answer: ChatResearchResult = {
    output: { answer: 'Yes: a workshop in March 2025.', findings: [{ text: 'Workshop recap', source: 'slack', permalink: 'https://slack.example.com/archives/C1/p1' }], searched: [{ source: 'slack', query: 'ACME', hits: 3 }], notFound: [], confidence: 'sure' },
    costUsd: 0.21,
    inputTokens: 20_000,
    outputTokens: 900,
    model: 'claude-sonnet-5-5',
    toolCalls: ['a', 'b', 'c'],
    unavailable: [],
    latencyMs: 600,
    skill: 'research-question@1',
  };
  const input = (text: string) => ({ threadId: 't1', messageId: 'm1', userMessageId: 'u1', text, context: [], model: 'sonnet' as const, signal: new AbortController().signal });

  it('mock mode says live research is not available', async () => {
    const evs = await collect(ds.chat({ body: { text: 'Have I done anything for ACME in the past?', context: [] }, signal: new AbortController().signal } as never));
    const start = of(evs, 'tool-start').find((e) => e.name === 'research.search');
    expect(start).toBeTruthy();
    expect(of(evs, 'tool-result').find((e) => e.id === start!.id)).toMatchObject({ ok: false, summary: 'Live research not available here' });
    expect(textOf(evs)).toMatch(/couldn't research that live/);
  });

  it('a slow research run extends the turn deadline, records its spend once, and its answer reaches the reply', async () => {
    const usage: ChatUsageRecord[] = [];
    const b = ds.be6.backend();
    const host = createChatHost(ds, {
      ...b,
      recordUsage: async (u) => void usage.push(u),
      research: async (_i, o) => {
        for (let n = 0; n < 4; n++) {
          await new Promise((r) => setTimeout(r, 120));
          o.onTool?.('mcp__slack__slack_search_public_and_private');
        }
        return answer;
      },
    }, () => ds.now());
    const steps: Array<{ type: string; [k: string]: unknown }> = [];
    for await (const s of runChatTurn(input('Have I done anything for ACME in the past?'), host, { queryFn: createFakeChatQuery(), timeoutMs: 200 })) steps.push(s as never);
    expect(steps.filter((s) => s.type === 'error')).toEqual([]);
    expect(steps.filter((s) => s.type === 'tool-progress').length).toBeGreaterThanOrEqual(4);
    const text = steps.filter((s) => s.type === 'text').map((s) => s.text).join('');
    expect(text).toContain('Yes: a workshop in March 2025.');
    expect(text).toContain('https://slack.example.com/archives/C1/p1');
    const research = usage.filter((u) => u.skill === 'research-question@1');
    expect(research).toHaveLength(1);
    expect(research[0]).toMatchObject({ costUsd: 0.21, status: 'ok' });
  });

  it("with no room left in the day's limit it refuses before running", async () => {
    const b = ds.be6.backend();
    let ran = false;
    const host = createChatHost(ds, { ...b, budget: async () => ({ chatTodayUsd: 3, chatDailyUsd: 3.02, totalTodayUsd: 3, hardCapUsd: 15, perMessageUsd: 0.25, maxTurns: 12, researchUsd: 0.5 }), research: async () => ((ran = true), answer) }, () => ds.now());
    const steps: Array<{ type: string; [k: string]: unknown }> = [];
    for await (const s of runChatTurn(input('Have I done anything for ACME in the past?'), host, { queryFn: createFakeChatQuery() })) steps.push(s as never);
    expect(ran).toBe(false);
    expect(steps.find((s) => s.type === 'tool-result')).toMatchObject({ ok: false, summary: 'No budget left for research' });
  });
});
