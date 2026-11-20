import { describe, expect, it } from 'vitest';
import type { Proposal, Receipt } from '@/contract';
import { EMPTY_ACTIONS, type ChatMessageView, type ChatToolView } from '@/client/chat';
import { threadTitle, fmtDay } from '../format';
import { briefSummary, fmtMin, groupByEntity, latestPendingProposal, latestUndoable, scanViews, splitResources, threadTouched, toolSummaryLine, toolVerb, withPersistedUndo } from '../thread-model';

const tool = (id: string, name: string, startSummary: string | null, summary: string, ok: boolean | null = true): ChatToolView => ({ id, name, startSummary, summary, ok });

function msg(p: Partial<ChatMessageView> & Pick<ChatMessageView, 'id' | 'role'>): ChatMessageView {
  return { threadId: 't', at: '2026-11-05T15:00:00.000Z', text: '', context: [], isMorningBrief: false, tools: [], receipts: [], proposals: [], resources: [], streaming: false, error: null, stopped: false, pending: false, ...p };
}

const proposal = (id: string, status: Proposal['status'] = 'pending'): Proposal => ({
  id,
  entity: { type: 'work_item', id: 'w1', label: 'Send the pricing' },
  changes: [{ field: 'rank', before: 2, after: 1 }],
  reason: 'asked',
  source: null,
  createdAt: '2026-11-05T15:00:00.000Z',
  status,
  actor: 'chat',
  baseVersion: null,
  textDiff: null,
  resolvedAt: null,
});

const receipt = (id: string, auditIds: string[], undoneAt: string | null = null): Receipt => ({
  id,
  at: '2026-11-05T15:01:00.000Z',
  actor: 'chat',
  summary: 'Moved it',
  staged: false,
  changes: auditIds.map((a, i) => ({ auditId: a, entity: { type: 'work_item', id: `w${i}`, label: `Item ${i}` }, field: 'rank', before: 2, after: 1, undoneAt })),
});

describe('tool summary line', () => {
  it('names the verb and source, folds the rest into "n more tools", and drops the source when it repeats', () => {
    const tools = [tool('1', 'slack.search', '"demo" · 2d', '3 threads'), tool('2', 'slack.read_thread', 'prep', '2 messages'), tool('3', 'calendar.events', 'today', '6 events'), tool('4', 'priority.explain', 'x', '3 factors')];
    expect(toolSummaryLine(tools)).toEqual({ line: 'Searched Slack · 3 threads · read 2 messages', more: 2, failed: 0 });
  });
  it('counts failures and leaves scan tools to the scan row', () => {
    const tools = [tool('1', 'slack.scan', 'Re-reading Slack (2d)', 'started'), tool('2', 'work.search', 'q', 'boom', false)];
    expect(toolSummaryLine(tools)).toMatchObject({ more: 0, failed: 1 });
    expect(toolSummaryLine(tools).line).toContain('Searched work');
  });
  it('reads unknown tools in sentence case', () => {
    expect(toolVerb('mystery')).toBe('Mystery');
    expect(toolVerb('calendar.events')).toBe('Read Calendar');
  });
});

describe('scan rows', () => {
  it('shows a running scan with its window, then what the matcher found', () => {
    expect(scanViews([tool('s', 'slack.scan', 'Re-reading Slack since Tue 08:20 (2d)', 'x', null)])[0]).toMatchObject({ status: 'running', title: 'Scanning Slack · 2 days', source: 'Slack' });
    const done = scanViews([tool('s', 'slack.scan', 'Re-reading Slack (2d)', 'Scan abc started'), tool('m', 'linker.match', 'Matching', '2 new · 1 linked')]);
    expect(done[0]).toMatchObject({ status: 'done', title: '2 new · 1 linked', detail: 'Scan abc started', consumed: ['s', 'm'] });
    expect(scanViews([tool('s', 'gmail.scan', 'Re-reading Gmail (1d)', 'auth expired', false)])[0]).toMatchObject({ status: 'failed', title: "Gmail couldn't be re-read" });
  });
});

describe('morning brief summary', () => {
  it('skips the greeting and counts the priorities', () => {
    const md = "**Good morning.** Seven meetings today; the big one is the **ACME demo at 13:00**.\n\n1. **Kick off** the build\n2. Reply\n3. Prep\n\nHeads-up: Gmail is behind.";
    expect(briefSummary(md)).toBe('Seven meetings today; the big one is the ACME demo at 13:00. 3 priorities.');
  });
});

describe('keys: what ⌘↵ applies and z undoes', () => {
  it('⌘↵ targets the newest pending proposal', () => {
    const ms = [msg({ id: 'a', role: 'assistant', proposals: [{ proposal: proposal('p1'), summary: null }] }), msg({ id: 'b', role: 'assistant', proposals: [{ proposal: proposal('p2'), summary: null }] })];
    expect(latestPendingProposal(ms, EMPTY_ACTIONS)?.id).toBe('p2');
    const applied = { ...EMPTY_ACTIONS, proposals: { p2: { status: 'applied' as const, auditId: 'aud_p2' } } };
    expect(latestPendingProposal(ms, applied)?.id).toBe('p1');
  });
  it('z undoes the newest live change: an applied proposal, else a receipt; persisted undone lines are skipped', () => {
    const ms = [msg({ id: 'a', role: 'assistant', receipts: [receipt('r1', ['a1', 'a2'])] }), msg({ id: 'b', role: 'assistant', proposals: [{ proposal: proposal('p1'), summary: null }] })];
    expect(latestUndoable(ms, EMPTY_ACTIONS)).toEqual(['a2', 'a1']);
    const applied = { ...EMPTY_ACTIONS, proposals: { p1: { status: 'applied' as const, auditId: 'aud_p1' } } };
    expect(latestUndoable(ms, applied)).toEqual(['aud_p1']);
    const gone = [msg({ id: 'a', role: 'assistant', receipts: [receipt('r1', ['a1'], '2026-11-05T15:02:00.000Z')] })];
    expect(latestUndoable(gone, EMPTY_ACTIONS)).toBeNull();
    expect(withPersistedUndo(gone[0].receipts[0], EMPTY_ACTIONS).undo.a1?.status).toBe('undone');
  });
});

describe('in this thread', () => {
  it('collects changes, pending proposals, items, drafts, sessions, scans and sources', () => {
    const ms = [
      msg({ id: 'u', role: 'user', text: 'hi' }),
      msg({
        id: 'a',
        role: 'assistant',
        tools: [tool('s', 'slack.scan', 'Re-reading Slack (2d)', 'done')],
        receipts: [receipt('r1', ['a1'])],
        proposals: [{ proposal: proposal('p1'), summary: 'Move it up' }],
        resources: [
          { kind: 'draft', id: 'd1', label: 'Reply', href: '/outbox' },
          { kind: 'agent_run', id: 'run1', label: 'Deck', href: '/agents' },
          { kind: 'calendar_event', id: 'e1', label: '13:30 review', href: '/today' },
          { kind: 'work_item', id: 'w9', label: 'Other item', href: '/work/w9' },
        ],
      }),
    ];
    const t = threadTouched(ms, EMPTY_ACTIONS);
    expect(t.changes.map((c) => c.key)).toEqual(['r1']);
    expect(t.pending.map((p) => p.proposal.id)).toEqual(['p1']);
    expect(t.itemIds.map((i) => i.id).sort()).toEqual(['w0', 'w1', 'w9']);
    expect(t.drafts.map((d) => d.id)).toEqual(['d1']);
    expect(t.sessions.map((d) => d.id)).toEqual(['run1']);
    expect(t.scans).toHaveLength(1);
    expect(t.sources.map((r) => r.id)).toEqual(['e1']);
    expect(splitResources(ms[1].resources).evidence.map((r) => r.kind)).toEqual(['calendar_event', 'work_item']);
  });
});

describe('formatting', () => {
  it('groups consecutive lines on one item', () => {
    expect(groupByEntity([{ what: 'A' }, { what: null }, { what: 'B' }]).map((g) => g.rows.length)).toEqual([2, 1]);
  });
  it('minutes, days and the default thread title', () => {
    expect([fmtMin(20), fmtMin(90), fmtMin(60), fmtMin(3 * 24 * 60)]).toEqual(['20m', '1h 30m', '1h', '3d']);
    const now = new Date('2026-11-05T15:00:00.000Z');
    expect(fmtDay(now, 'UTC')).toBe('Thu 5 Nov');
    expect(threadTitle({ title: 'Today', isDefault: true }, now, 'UTC')).toBe('Today · Thu 5 Nov');
    expect(threadTitle({ title: 'Hooli scoping', isDefault: false }, now, 'UTC')).toBe('Hooli scoping');
  });
});
