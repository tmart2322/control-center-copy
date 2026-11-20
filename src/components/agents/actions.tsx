'use client';
/**
 * Run actions shared by the Agents list and the agent_run Details renderer (one behaviour, two surfaces):
 * answer (app runs) and cancel are optimistic with rollback, an inline error and an Undo toast (auditId);
 * retry re-starts a tool run with the same inputs; Open in Claude and Start in Claude open a claude:// link
 * ONLY on the user's click, Start after a confirm that shows the folder and the context pack.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { AgentRun } from '@/contract';
import { api } from '@/client/api';
import { useOptimisticMutation } from '@/client/optimistic';
import { toast } from '@/client/toast';
import { getDetailRenderer, useRightPanel, type PanelEntity } from '@/components/shell/panel';
import { openClaudeUrl, openInClaudeUrl, startInClaudeUrl } from './claude';
import type { RunVerbKey } from './needs';
import { StartConfirmDialog } from './StartInClaude';
import { navigate } from '@/components/shell/router';

/** Smoke-test seam: `window.__ccOpenDetails` sees every Details request (the panel is a no-op until V2-SHELL). */
export function notifyDetailsSpy(e: PanelEntity) {
  const spy = typeof window !== 'undefined' ? (window as { __ccOpenDetails?: (e: PanelEntity) => void }).__ccOpenDetails : undefined;
  if (spy) spy(e);
}

export function useRunActions() {
  const qc = useQueryClient();
  const panel = useRightPanel();
  const [confirm, setConfirm] = useState<{ url: string; title: string } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const answer = useOptimisticMutation({
    route: 'answerAgent',
    topics: ['agents', 'today', 'home'],
    rebase: false,
    optimistic: (i, c) => c.patchEntity(i.params.id, (e) => ({ ...e, state: 'running', waiting: null, lastEvent: `You answered: ${i.body?.answer ?? ''}` })),
    toast: (r) => ({ title: `Answered: ${r.entity.title}`, key: `answer:${r.entity.id}` }),
    onError: (err) => toast({ title: 'Couldn’t send the answer', body: err.message, tone: 'error', durationMs: null, key: 'answer-err' }),
  });
  const cancel = useOptimisticMutation({
    route: 'cancelAgent',
    topics: ['agents', 'today', 'tools', 'home'],
    rebase: false,
    optimistic: (i, c) => c.patchEntity(i.params.id, (e) => ({ ...e, state: 'failed', error: 'Cancelled by you', lastEvent: 'Cancelled' })),
    toast: (r) => ({ title: `Cancelled: ${r.entity.title}`, key: `cancel:${r.entity.id}` }),
    onError: (err) => toast({ title: 'Couldn’t cancel', body: err.message, tone: 'error', durationMs: null, key: 'cancel-err' }),
  });

  const openInClaude = useCallback((run: AgentRun) => {
    const url = openInClaudeUrl(run);
    if (!url || !openClaudeUrl(url)) toast({ title: 'No Claude session to open yet', body: 'This run has no host session id.', tone: 'warning', key: 'no-session' });
  }, []);

  const requestStart = useCallback((run: AgentRun) => {
    const url = startInClaudeUrl(run);
    if (url) setConfirm({ url, title: run.title });
  }, []);

  const retry = useCallback(
    async (run: AgentRun) => {
      if (run.kind !== 'tool_run' || !run.toolRunId) {
        toast({ title: 'Retry isn’t available for this run', body: 'App runs have no retry route yet. Start it again from its task.', tone: 'warning', key: 'retry-na' });
        return;
      }
      setRetrying(run.id);
      try {
        const tr = await api('getToolRun', { params: { id: run.toolRunId } });
        await api('startToolRun', { params: { id: tr.adapterId }, body: { inputs: tr.inputs, ...(tr.workItemId ? { workItemId: tr.workItemId } : {}) } });
        void qc.invalidateQueries({ queryKey: ['agents'] });
        void qc.invalidateQueries({ queryKey: ['tools'] });
        toast({ title: `Retrying: ${run.title}`, key: `retry:${run.id}` });
      } catch (e) {
        toast({ title: 'Couldn’t retry', body: (e as Error).message, tone: 'error', durationMs: null, key: 'retry-err' });
      } finally {
        setRetrying(null);
      }
    },
    [qc],
  );

  const openDetails = useCallback(
    (e: PanelEntity) => {
      notifyDetailsSpy(e);
      panel.openDetails(e);
    },
    [panel],
  );

  /** The linked task: in the panel once it can render work items, else its page. */
  const openTask = useCallback(
    (workItemId: string, label?: string) => {
      if (getDetailRenderer('work_item')) openDetails({ kind: 'work_item', id: workItemId, label });
      else navigate(`/work/${workItemId}`);
    },
    [openDetails],
  );

  const openRun = useCallback((run: AgentRun) => openDetails({ kind: 'agent_run', id: run.id, label: run.title }), [openDetails]);

  const perform = useCallback(
    (key: RunVerbKey | 'stop', run: AgentRun, taskTitle?: string | null) => {
      switch (key) {
        case 'open_in_claude':
          return openInClaude(run);
        case 'start_in_claude':
          return requestStart(run);
        case 'review':
          if (run.workItemId) return openTask(run.workItemId, taskTitle ?? undefined);
          return run.kind === 'claude_session' && openInClaudeUrl(run) ? openInClaude(run) : openRun(run);
        case 'retry':
          return void retry(run);
        case 'cancel':
          if (run.kind === 'claude_session') {
            toast({ title: 'Stop Claude sessions in Claude', body: 'Command Center can’t cancel a session.', tone: 'warning', key: 'cancel-claude' });
            return;
          }
          return cancel.mutate({ params: { id: run.id }, body: {} });
        case 'stop':
          return cancel.mutate({ params: { id: run.id }, body: {} });
        case 'nudge':
          if (run.kind === 'claude_session') return openInClaude(run);
          return openRun(run);
        case 'answer':
        case 'open_log':
          return openRun(run);
      }
    },
    [cancel, openInClaude, requestStart, retry, openTask, openRun],
  );

  const dialog = <StartConfirmDialog url={confirm?.url ?? null} title={confirm?.title} onClose={() => setConfirm(null)} />;

  return { answer, cancel, retry, retrying, openInClaude, requestStart, openTask, openRun, openDetails, perform, dialog };
}
