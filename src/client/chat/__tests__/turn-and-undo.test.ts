import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSseEvent, Proposal, Receipt } from '@/contract';
import { actionsReducer, auditIdsForUndoAll, EMPTY_ACTIONS, persistable, proposalStateOf, receiptProgress, settledProposalStatus, undoStateOf, type ChatActionsState } from '../actions';
import { redactCredentials } from '../redact';
import { isReconciled, mergeMessages, reduceTurn, startTurn, stopTurn } from '../turn';

const at = '2026-11-05T16:00:00.000Z';
const receipt: Receipt = {
  id: 'rcpt_1',
  at,
  actor: 'chat',
  summary: 'Moved Globex prep after lunch',
  staged: false,
  changes: [
    { auditId: 'aud_a', entity: { type: 'work_item', id: 'w1', label: 'Globex prep' }, field: 'startBy', before: '2026-11-05T16:30:00.000Z', after: '2026-11-05T19:30:00.000Z' },
    { auditId: 'aud_b', entity: { type: 'work_item', id: 'w1', label: 'Globex prep' }, field: 'notes', before: '', after: 'Deck: Globex estimate' },
    { auditId: 'aud_b', entity: { type: 'work_item', id: 'w2', label: 'Other' }, field: 'rank', before: 2, after: 3 },
  ],
};

const msg = (id: string, role: ChatMessage['role'], text = ''): ChatMessage => ({ id, threadId: 't', role, at, text, parts: [], context: [], isMorningBrief: false });

function play(events: ChatSseEvent[]) {
  return events.reduce(reduceTurn, startTurn({ threadId: 't', text: 'hi', context: [], baseIds: ['m0'] }));
}

describe('LiveTurn reducer', () => {
  it('folds every event type in order and settles on done', () => {
    const t = play([
      { type: 'tool-start', id: 'x1', name: 'drive.search', summary: 'Searching Drive' },
      { type: 'text-delta', messageId: 'm2', delta: 'Found ' },
      { type: 'tool-result', id: 'x1', summary: '1 match', ok: true },
      { type: 'text-delta', messageId: 'm2', delta: 'it.' },
      { type: 'receipt', receipt },
      { type: 'resource', resource: { kind: 'asset', id: 'as1', label: 'Deck', href: '/x' } },
      { type: 'done', threadId: 't', messageId: 'm2', userMessageId: 'm1' },
    ]);
    expect(t.status).toBe('done');
    expect(t.text).toBe('Found it.');
    expect(t.tools).toEqual([{ id: 'x1', name: 'drive.search', startSummary: 'Searching Drive', summary: '1 match', ok: true }]);
    expect(t.receipts).toHaveLength(1);
    expect(t.resources).toHaveLength(1);
    expect(t.userMessageId).toBe('m1');
  });

  it('error ends the turn and marks unfinished tools failed; later events are ignored', () => {
    const t = play([
      { type: 'tool-start', id: 'x1', name: 'slack.search', summary: 'Searching Slack' },
      { type: 'error', error: { code: 'upstream_unavailable', message: 'Slack is disconnected', retryable: true } },
      { type: 'text-delta', messageId: 'm2', delta: 'late' },
    ]);
    expect(t.status).toBe('error');
    expect(t.tools[0].ok).toBe(false);
    expect(t.text).toBe('');
  });

  it('stop keeps partial text and stops pulsing tools', () => {
    const t = stopTurn(play([{ type: 'text-delta', messageId: 'm2', delta: 'Half an ans' }, { type: 'tool-start', id: 'x', name: 'n', summary: 's' }]));
    expect(t.status).toBe('stopped');
    expect(t.text).toBe('Half an ans');
    expect(t.tools[0].ok).toBe(false);
  });

  it('merge shows the live turn once, even after a mid-stream refetch, then swaps to the server copy', () => {
    const live = play([{ type: 'text-delta', messageId: 'm2', delta: 'Working' }]);
    const midStream = [msg('m0', 'assistant', 'brief'), msg('m1', 'user', 'hi')]; // server already has the user msg
    const views = mergeMessages(midStream, live);
    expect(views.map((v) => v.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(views[2].streaming).toBe(true);
    const done = reduceTurn(live, { type: 'done', threadId: 't', messageId: 'm2', userMessageId: 'm1' });
    expect(isReconciled(done, midStream)).toBe(false);
    const persisted = [...midStream, msg('m2', 'assistant', 'Working')];
    expect(isReconciled(done, persisted)).toBe(true);
    expect(mergeMessages(persisted, done).map((v) => v.id)).toEqual(['m0', 'm1', 'm2']);
  });

  it('a failed POST (nothing persisted) keeps the user message and the error visible', () => {
    const failed = play([{ type: 'error', error: { code: 'upstream_unavailable', message: 'down', retryable: true } }]);
    const views = mergeMessages([msg('m0', 'assistant')], failed);
    expect(views).toHaveLength(3);
    expect(views[2].error?.message).toBe('down');
  });
});

describe('receipt undo state', () => {
  it('undoing one line flips every line that shares its audit id, and only after the server confirms', () => {
    let s: ChatActionsState = EMPTY_ACTIONS;
    s = actionsReducer(s, { type: 'undo/start', auditId: 'aud_b' });
    expect(undoStateOf(s, 'aud_b').status).toBe('pending');
    expect(receiptProgress(receipt, s)).toEqual({ total: 3, undone: 0, pending: 2 });
    s = actionsReducer(s, { type: 'undo/ok', auditId: 'aud_b' });
    expect(receiptProgress(receipt, s)).toEqual({ total: 3, undone: 2, pending: 0 });
    expect(undoStateOf(s, 'aud_a').status).toBe('idle');
  });

  it('Undo all reverts unique audit ids most-recent first, skipping undone ones and retrying failures', () => {
    expect(auditIdsForUndoAll(receipt, EMPTY_ACTIONS)).toEqual(['aud_b', 'aud_a']);
    let s = actionsReducer(EMPTY_ACTIONS, { type: 'undo/ok', auditId: 'aud_b' });
    expect(auditIdsForUndoAll(receipt, s)).toEqual(['aud_a']);
    s = actionsReducer(s, { type: 'undo/fail', auditId: 'aud_a', message: 'Changed since' });
    expect(undoStateOf(s, 'aud_a')).toEqual({ status: 'error', message: 'Changed since' });
    expect(auditIdsForUndoAll(receipt, s)).toEqual(['aud_a']);
  });

  it('persists only settled results and hydrates without clobbering newer local state', () => {
    let s = actionsReducer(EMPTY_ACTIONS, { type: 'undo/ok', auditId: 'aud_a' });
    s = actionsReducer(s, { type: 'undo/start', auditId: 'aud_b' });
    s = actionsReducer(s, { type: 'proposal/applied', id: 'prop_1', auditId: 'aud_p', receipt: null });
    const saved = persistable(s);
    expect(Object.keys(saved.undo)).toEqual(['aud_a']);
    expect(saved.proposals.prop_1.status).toBe('applied');
    const fresh = actionsReducer(actionsReducer(EMPTY_ACTIONS, { type: 'undo/start', auditId: 'aud_a' }), { type: 'hydrate', state: saved });
    expect(undoStateOf(fresh, 'aud_a').status).toBe('pending');
  });

  it('proposal state: local action wins; server status is the fallback; stale cards settle', () => {
    const p = { id: 'prop_1', status: 'pending' } as Proposal;
    expect(proposalStateOf(EMPTY_ACTIONS, p).status).toBe('pending');
    expect(proposalStateOf(EMPTY_ACTIONS, { ...p, status: 'applied' }).status).toBe('applied');
    const s = actionsReducer(EMPTY_ACTIONS, { type: 'proposal/start', id: 'prop_1', verb: 'apply' });
    expect(proposalStateOf(s, p).status).toBe('applying');
    expect(settledProposalStatus('Proposal is applied')).toBe('applied');
    expect(settledProposalStatus('Proposal is rejected')).toBe('dismissed');
    expect(settledProposalStatus('boom')).toBeNull();
  });
});

describe('redactCredentials', () => {
  it('masks tokens, passwords and connection strings', () => {
    const out = redactCredentials('token=xoxb-123456789012-abcdef password: hunter22 Bearer abc.def.ghijkl postgres://cc:s3cret@localhost/cc sk-ant-abcdefghijklmnop');
    expect(out).not.toMatch(/hunter22|s3cret|abcdefghijklmnop|xoxb-1234/);
    expect(out).toContain('postgres://cc:[redacted]@');
  });
});
