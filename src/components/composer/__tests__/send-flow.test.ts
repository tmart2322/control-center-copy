import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchResult, DraftPreview } from '@/contract';
import { SendFlow, type SendFlowDeps } from '../send-flow';

const preview = (mode: 'draft' | 'send' = 'send', version = 3): DraftPreview => ({
  draftId: 'dr_1',
  version,
  destination: { kind: 'slack', target: 'thread', channelId: 'C1', channelName: '#acme-ext', threadTs: '1.1' },
  mode,
  rendition: { format: 'slack_mrkdwn', body: 'Hi', text: 'Hi', lossy: [] },
  payload: { api: 'chat.postMessage', channel: 'C1', text: 'Hi' },
  confirmToken: `ct_dr_1_${version}_${mode}_abc`,
  dryRun: true,
});

const result = (over: Partial<DispatchResult['attempt']> = {}, dryRun = true): DispatchResult =>
  ({
    draft: { id: 'dr_1', version: 4 } as DispatchResult['draft'],
    dryRun,
    payload: { text: 'Hi' },
    rendition: { format: 'slack_mrkdwn', body: 'Hi', text: 'Hi', lossy: [] },
    attempt: { id: 'att_1', at: new Date().toISOString(), mode: 'send', dryRun, outcome: dryRun ? 'rendered' : 'sent', ...over },
    auditId: 'aud_1',
  }) as DispatchResult;

function setup(over: Partial<SendFlowDeps> = {}) {
  const calls: string[] = [];
  const deps: SendFlowDeps = {
    flush: vi.fn(async () => {
      calls.push('flush');
      return true;
    }),
    preview: vi.fn(async (mode) => {
      calls.push(`preview:${mode}`);
      return preview(mode);
    }),
    dispatch: vi.fn(async (req) => {
      calls.push(`dispatch:${req.mode}:${req.confirmToken}`);
      return result();
    }),
    undoMs: 10_000,
    ...over,
  };
  const flow = new SendFlow(deps, 'draft');
  const phases: string[] = [];
  flow.subscribe((s) => {
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
  });
  return { flow, deps, calls, phases };
}

describe('SendFlow: the border', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs toggle → confirm → countdown → dispatch in order, and only after the undo window', async () => {
    const { flow, deps, calls, phases } = setup();
    await flow.open('send'); // the Draft ↔ Send toggle chose "send"
    expect(flow.getState().phase).toBe('confirming');
    expect(flow.getState().preview?.mode).toBe('send');
    expect(deps.dispatch).not.toHaveBeenCalled();

    flow.confirm();
    expect(flow.getState().phase).toBe('countdown');
    expect(flow.getState().deadline).toBe(Date.now() + 10_000);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(deps.dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();

    expect(calls).toEqual(['flush', 'preview:send', 'dispatch:send:ct_dr_1_3_send_abc']);
    expect(deps.dispatch).toHaveBeenCalledWith({ ifVersion: 3, mode: 'send', confirmToken: 'ct_dr_1_3_send_abc' });
    expect(phases).toEqual(['previewing', 'confirming', 'countdown', 'dispatching', 'done']);
    expect(flow.getState().outcome).toBe('dry_run');
    expect(flow.getState().dispatches).toBe(1);
  });

  it('Undo inside the window cancels: nothing is dispatched, ever', async () => {
    const { flow, deps } = setup();
    await flow.open('send');
    flow.confirm();
    await vi.advanceTimersByTimeAsync(6_000);
    flow.undo();
    expect(flow.getState()).toMatchObject({ phase: 'idle', undone: true, deadline: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(flow.getState().dispatches).toBe(0);
  });

  it('Cancel on the confirm dialog dispatches nothing', async () => {
    const { flow, deps } = setup();
    await flow.open('draft');
    flow.cancel();
    expect(flow.getState().phase).toBe('idle');
    flow.confirm(); // no-op outside confirming
    await vi.advanceTimersByTimeAsync(20_000);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('never previews (or sends) when the latest edits are not saved', async () => {
    const { flow, deps } = setup({ flush: vi.fn(async () => false) });
    await flow.open('send');
    expect(deps.preview).not.toHaveBeenCalled();
    expect(flow.getState().error).toMatchObject({ stage: 'save' });
  });

  it('maps outcomes: staged (Draft mode), sent, and a `dry_run` error from the real backend', async () => {
    const staged = setup({ dispatch: vi.fn(async () => result({ outcome: 'staged', mode: 'draft' }, false)) });
    await staged.flow.open('draft');
    staged.flow.confirm();
    await vi.runAllTimersAsync();
    expect(staged.flow.getState().outcome).toBe('staged');

    const sent = setup({ dispatch: vi.fn(async () => result({ outcome: 'sent' }, false)) });
    await sent.flow.open('send');
    sent.flow.confirm();
    await vi.runAllTimersAsync();
    expect(sent.flow.getState().outcome).toBe('sent');

    const locked = setup({
      dispatch: vi.fn(async () => {
        throw Object.assign(new Error('dry run'), { code: 'dry_run', retryable: false });
      }),
    });
    await locked.flow.open('send');
    locked.flow.confirm();
    await vi.runAllTimersAsync();
    expect(locked.flow.getState()).toMatchObject({ phase: 'done', outcome: 'dry_run' });
  });

  it('a failed dispatch (BE-OUTBOX: retry=reconfirm) is never re-posted: Retry runs a fresh preview and confirm', async () => {
    let n = 0;
    const { flow, deps } = setup({
      dispatch: vi.fn(async () => {
        if (n++ === 0) throw Object.assign(new Error('Delivery failed: channel_not_found'), { code: 'upstream_unavailable', retryable: false, details: { retry: 'reconfirm' } });
        return result({ outcome: 'sent' }, false);
      }),
    });
    await flow.open('send');
    flow.confirm();
    await vi.runAllTimersAsync();
    expect(flow.getState()).toMatchObject({ phase: 'error', error: { code: 'upstream_unavailable', retryable: false, reconfirm: true, stage: 'dispatch' } });
    await flow.retry();
    // No second dispatch with the spent token: the confirm dialog is back with a fresh server preview.
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.preview).toHaveBeenCalledTimes(2);
    expect(flow.getState().phase).toBe('confirming');
    flow.confirm();
    await vi.runAllTimersAsync();
    expect(deps.dispatch).toHaveBeenCalledTimes(2);
    expect(flow.getState().outcome).toBe('sent');
  });

  it('even a retryable dispatch error re-confirms instead of re-posting the old token', async () => {
    const { flow, deps } = setup({
      dispatch: vi.fn(async () => {
        throw Object.assign(new Error('Slack is down'), { code: 'upstream_unavailable', retryable: true });
      }),
    });
    await flow.open('send');
    flow.confirm();
    await vi.runAllTimersAsync();
    expect(flow.getState().error).toMatchObject({ stage: 'dispatch', reconfirm: true });
    await flow.retry();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(flow.getState().phase).toBe('confirming');
  });

  it('a stale confirm (409 / token mismatch) is not retried blindly: Review again re-previews', async () => {
    const { flow, deps } = setup({
      dispatch: vi.fn(async () => {
        throw Object.assign(new Error('changed'), { code: 'conflict', retryable: true });
      }),
    });
    await flow.open('send');
    flow.confirm();
    await vi.runAllTimersAsync();
    expect(flow.getState().error).toMatchObject({ code: 'conflict', retryable: false });
    await flow.retry();
    expect(deps.preview).toHaveBeenCalledTimes(2);
    expect(flow.getState().phase).toBe('confirming');
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });

  it('ignores a second open while locked and a double confirm', async () => {
    const { flow, deps } = setup();
    await flow.open('send');
    await flow.open('draft');
    expect(deps.preview).toHaveBeenCalledTimes(1);
    flow.confirm();
    flow.confirm();
    await vi.runAllTimersAsync();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });
});
