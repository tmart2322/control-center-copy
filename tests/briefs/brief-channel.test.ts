/** BE-5 channel briefs, pure parts: when a watch is due, and the engine's quiet / repair / salvage paths. */
import { describe, expect, it } from 'vitest';

import { briefDue, channelBrief, lastLocalSlot, type ChannelBriefRequest, type ChannelMessage } from '../../src/engines/briefs/channel';
import type { CompletionModel, CompletionModelRequest } from '../../src/scanner/completion';

const TZ = 'America/Denver';
const H = 3_600_000;

describe('briefDue', () => {
  it('Daily 7:30 is due once per local day, from 07:30', () => {
    const before = new Date('2026-11-11T14:00:00Z'); // 07:00 MST
    const after = new Date('2026-11-11T14:31:00Z'); // 07:31 MST
    expect(briefDue({ cadence: 'daily_0730', lastBriefAt: null }, after, TZ).due).toBe(true);
    // Yesterday's brief: not due before today's slot, due after it.
    const y = '2026-11-10T14:32:00Z';
    expect(briefDue({ cadence: 'daily_0730', lastBriefAt: y }, before, TZ)).toEqual({ due: false, nextAt: new Date('2026-11-11T14:30:00Z') });
    expect(briefDue({ cadence: 'daily_0730', lastBriefAt: y }, after, TZ).due).toBe(true);
    // Today's brief: not due again until tomorrow 07:30.
    expect(briefDue({ cadence: 'daily_0730', lastBriefAt: '2026-11-11T14:31:00Z' }, new Date('2026-11-11T20:00:00Z'), TZ)).toEqual({ due: false, nextAt: new Date('2026-11-12T14:30:00Z') });
  });

  it('"Since last open" is briefed daily (the worker has no open signal yet)', () => {
    expect(briefDue({ cadence: 'since_last_open', lastBriefAt: '2026-11-10T14:32:00Z' }, new Date('2026-11-11T14:31:00Z'), TZ).due).toBe(true);
  });

  it('the 07:30 slot holds across a DST change (MDT → MST on 2026-11-01)', () => {
    expect(lastLocalSlot(new Date('2026-11-01T15:00:00Z'), '07:30', TZ).toISOString()).toBe('2026-11-01T14:30:00.000Z');
    expect(lastLocalSlot(new Date('2026-11-01T14:00:00Z'), '07:30', TZ).toISOString()).toBe('2026-10-31T13:30:00.000Z');
  });

  it('Every 4 h is due four hours after the last brief', () => {
    const last = '2026-11-11T14:00:00Z';
    expect(briefDue({ cadence: 'every_4h', lastBriefAt: last }, new Date(Date.parse(last) + 3 * H), TZ)).toEqual({ due: false, nextAt: new Date(Date.parse(last) + 4 * H) });
    expect(briefDue({ cadence: 'every_4h', lastBriefAt: last }, new Date(Date.parse(last) + 4 * H), TZ).due).toBe(true);
  });
});

describe('channelBrief', () => {
  const m = (i: number, text: string): ChannelMessage => ({
    sourceItemId: `00000000-0000-4000-8000-00000000000${i}`,
    at: new Date(Date.parse('2026-11-11T09:00:00Z') + i * 60_000).toISOString(),
    authorName: 'PERSON_A',
    threadRef: `slack:C0TEAM:${i}`,
    isReply: false,
    text,
    source: { kind: 'slack', label: '#team', url: `https://example.slack.com/archives/C0TEAM/p${i}` },
  });
  const base = (model: CompletionModel, messages: ChannelMessage[]): ChannelBriefRequest => ({
    now: new Date('2026-11-11T14:31:00Z'),
    user: { name: 'ME', role: 'Solutions Engineer', tz: TZ },
    watch: { id: 'w1', label: '#team', cadence: 'daily_0730', style: 'digest', detailLevel: 2, maxHighlights: 2 },
    period: { from: '2026-11-10T14:30:00.000Z', to: '2026-11-11T14:30:00.000Z' },
    messages,
    myContext: { accounts: [], opportunities: [], initiatives: [], interests: [], people: [], policyRules: [] },
    model,
    maxCallUsd: 0.1,
  });
  const highlight = (over: Record<string, unknown> = {}) => ({
    title: 'Rate card published',
    body: 'New tiers are out.',
    level: 'medium',
    reasons: [{ kind: 'my_interest', featureKey: 'interest:pricing', explanation: 'You follow pricing' }],
    evidenceIds: ['s_1'],
    suggestedAction: 'ignore',
    topicKey: 'slack:C0TEAM:1',
    entity: { accountId: null, opportunityId: null, initiativeId: null },
    ...over,
  });
  const reply = (hs: unknown[]) => JSON.stringify({ summary: 'A rate card was shared.', nothingNew: false, highlights: hs, everythingElse: [], coverageNote: null });

  it('a quiet period makes no model call and is already read', async () => {
    let calls = 0;
    const out = await channelBrief(base(async () => (calls++, { ok: true, text: '', costUsd: 0, inputTokens: 0, outputTokens: 0 }), []));
    expect(calls).toBe(0);
    expect(out.status).toBe('quiet');
    if (out.status === 'quiet') expect(out.brief).toMatchObject({ unread: false, highlights: [] });
  });

  it('a rejected reply gets one repair attempt with the errors', async () => {
    const seen: CompletionModelRequest[] = [];
    const replies = [reply([highlight({ evidenceIds: ['s_9'] })]), reply([highlight()])];
    const model: CompletionModel = async (req) => (seen.push(req), { ok: true, text: replies[seen.length - 1]!, costUsd: 0.002, inputTokens: 100, outputTokens: 50 });
    const out = await channelBrief(base(model, [m(1, 'Rate card is out')]));
    expect(seen).toHaveLength(2);
    expect(seen[1]!.user).toContain('unknown_evidence');
    expect(out).toMatchObject({ status: 'ready', calls: 2, costUsd: 0.004 });
    if (out.status === 'ready') {
      expect(out.brief.highlights[0]!.sources[0]!.url).toBe('https://example.slack.com/archives/C0TEAM/p1');
      expect(out.evidence[out.brief.highlights[0]!.id]).toEqual([m(1, '').sourceItemId]);
    }
  });

  it('still invalid after the repair: keeps the summary and the highlights that cite real messages', async () => {
    const bad = reply([highlight({ evidenceIds: ['s_9'] }), highlight({ title: 'Real one', evidenceIds: ['s_1'], level: 'high' })]);
    const out = await channelBrief(base(async () => ({ ok: true, text: bad, costUsd: 0.001, inputTokens: 1, outputTokens: 1 }), [m(1, 'Rate card is out')]));
    expect(out.status).toBe('ready');
    // The `high` with only a weak reason reads as medium.
    if (out.status === 'ready') expect(out.brief.highlights.map((h) => [h.title, h.relevance])).toEqual([['Real one', 'medium']]);
  });

  it('a failed model call is a failed brief, with its spend', async () => {
    const out = await channelBrief(base(async () => ({ ok: false, text: '', costUsd: 0.001, inputTokens: 0, outputTokens: 0, error: { message: 'gateway down', errorClass: 'transient' } }), [m(1, 'x')]));
    expect(out).toMatchObject({ status: 'failed', code: 'model_error', calls: 1, costUsd: 0.001 });
  });
});
