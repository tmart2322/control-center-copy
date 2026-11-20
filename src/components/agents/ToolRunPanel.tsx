'use client';
/**
 * Run a tool, in the docked panel (Details renderers for `tool_adapter` and `tool_run`; no page-owned sheet).
 *
 *   tool_adapter  the form generated from the manifest's input schema, privacy facts, the start command when
 *                 the tool is down; the footer's ONE filled action is "Run <tool>" (explicit Run, plus a confirm
 *                 when the manifest requires approval). After Run the same panel follows the run's progress.
 *   tool_run      one run's progress and results; the footer's action is "Open result", else "Run again".
 *
 * Nothing runs until you click Run. Progress polls while live (and SSE invalidation makes it near-instant).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ToolAdapter, ToolRun, Tone } from '@/contract';
import { api, ApiError } from '@/client/api';
import { useApi } from '@/client/hooks';
import { toast } from '@/client/toast';
import { CommandBlock, Facts, openExternal, PanelFrame, PanelLoading, PanelProblem, PanelSection, QuietAction, StateBadge, Tag, type PanelPrimary } from '@/components/panels/bits';
import { useRightPanel } from '@/components/shell/panel';
import { Dialog, fmtAgo, Icon, PanelBoundary, Skeleton, useNow } from '@/ui';
import { notifyDetailsSpy } from './actions';
import { shortPath } from './claude';
import { SchemaForm } from './SchemaForm';
import { estimatedDurationOf, fieldsFromSchema, initialValues, NETWORK_LABEL, privacyOf, startCommandOf, toInputs, validate, type FormValues } from './schema-form';

export const TERMINAL: ToolRun['status'][] = ['succeeded', 'failed', 'cancelled'];

export const RUN_TONE: Record<ToolRun['status'], Tone> = {
  queued: 'neutral',
  starting: 'ai',
  running: 'ai',
  waiting_user: 'warn',
  succeeded: 'ok',
  failed: 'risk',
  cancelled: 'neutral',
};

export const STATUS_LABEL: Record<ToolRun['status'], string> = {
  queued: 'Queued',
  starting: 'Starting',
  running: 'Running',
  waiting_user: 'Waiting on you',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const HEALTH_BADGE: Record<ToolAdapter['health']['state'], { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: '✓ Up' },
  down: { tone: 'risk', label: '✕ Down' },
  unknown: { tone: 'neutral', label: 'Not checked' },
};

/** "Run again" and the launcher hand inputs and the linked task to the tool's form (read once when it mounts). */
const prefillOnce = new Map<string, Record<string, unknown>>();
const workItemOnce = new Map<string, string>();

/** Before `openDetails({kind:'tool_adapter'})`: prefill the form and link the run to a task (`?workItemId=`). */
export function setToolRunContext(adapterId: string, ctx: { inputs?: Record<string, unknown>; workItemId?: string }) {
  if (ctx.inputs) prefillOnce.set(adapterId, ctx.inputs);
  if (ctx.workItemId) workItemOnce.set(adapterId, ctx.workItemId);
}

function useToolRunQuery(runId: string) {
  // live: the tool_run topic follows each state change (no poll)
  return useApi('getToolRun', { params: { id: runId } });
}

/** Progress and results for one tool run (display only; the footer holds the actions). */
export function RunProgress({ run: r }: { run: ToolRun }) {
  const now = useNow(1000);
  const pct = r.progress ? Math.round((r.progress.done / Math.max(1, r.progress.total)) * 100) : r.status === 'succeeded' ? 100 : 0;
  const done = TERMINAL.includes(r.status);
  const inputs = Object.entries(r.inputs).filter(([, v]) => v !== '' && v !== undefined && v !== null);
  return (
    <div className="flex flex-col gap-6" data-testid="tool-run-progress" data-status={r.status} aria-live="polite">
      <PanelSection title="Progress" suffix={r.startedAt ? (done && r.finishedAt ? `took ${Math.max(0, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000))}s` : `started ${fmtAgo(r.startedAt, now)}`) : undefined}>
        <div>
          <div className="flex items-center justify-between text-caption text-muted">
            <span data-testid="tool-run-label">{r.progress?.label ?? STATUS_LABEL[r.status]}</span>
            {r.progress ? (
              <span className="tabular-nums">
                {r.progress.done}/{r.progress.total}
              </span>
            ) : null}
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-sunken" role="progressbar" aria-label="Tool run progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-[width] duration-300 ${r.status === 'failed' ? 'bg-danger-500' : r.status === 'succeeded' ? 'bg-success-500' : 'bg-ai-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {r.status === 'failed' && r.error ? (
          <p role="alert" className="mt-3 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-body text-danger-700">
            {r.error}
          </p>
        ) : null}
      </PanelSection>
      {r.status === 'succeeded' ? (
        <PanelSection title="Result" data-testid="tool-run-results">
          {r.artifacts.length ? (
            <ul className="flex flex-col gap-1">
              {r.artifacts.map((a) => (
                <li key={a.path} className="flex min-w-0 items-center gap-2 text-caption text-fg">
                  <Icon name="file" size="xs" className="shrink-0 text-muted" />
                  <span className="shrink-0 font-bold">{a.label}</span>
                  <code className="min-w-0 truncate font-mono text-muted" title={a.path}>
                    {shortPath(a.path)}
                  </code>
                </li>
              ))}
            </ul>
          ) : r.linkUrl ? (
            <p className="text-body text-fg">Ready to open: {r.linkLabel ?? 'the result'}.</p>
          ) : (
            <p className="text-body text-muted">Finished with no link or file to open.</p>
          )}
        </PanelSection>
      ) : null}
      {inputs.length ? (
        <PanelSection title="Inputs">
          <Facts rows={inputs.map(([k, v]) => [k, String(v)] as [string, string])} />
        </PanelSection>
      ) : null}
    </div>
  );
}

// ── tool_adapter: the run form ─────────────────────────────────────────────────────────────

export function ToolAdapterPanel({ adapterId, workItemId }: { adapterId: string; workItemId?: string }) {
  const tools = useApi('getTools');
  const adapter = tools.data?.adapters.find((a) => a.manifest.id === adapterId);
  return (
    <PanelBoundary name="agents.tool-panel" resetKeys={[adapterId]}>
      {tools.isLoading ? <PanelLoading label="Loading the tool" /> : !adapter ? <PanelProblem gone={!!tools.data} error={tools.error} what="tool" onRetry={() => void tools.refetch()} /> : <ToolForm key={adapter.manifest.id} adapter={adapter} workItemId={workItemId} />}
    </PanelBoundary>
  );
}

function ToolForm({ adapter, workItemId: workItemProp }: { adapter: ToolAdapter; workItemId?: string }) {
  const qc = useQueryClient();
  const panel = useRightPanel();
  const m = adapter.manifest;
  const [workItemId] = useState(() => {
    const w = workItemOnce.get(m.id);
    workItemOnce.delete(m.id);
    return workItemProp ?? w;
  });
  const fields = useMemo(() => fieldsFromSchema(m.input.schema), [m.input.schema]);
  const [values, setValues] = useState<FormValues>(() => {
    const pre = prefillOnce.get(m.id);
    prefillOnce.delete(m.id);
    return initialValues(fields, m.input.prefill, pre);
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const p = privacyOf(m);
  const start = startCommandOf(m);
  const down = adapter.health.state === 'down';
  const h = HEALTH_BADGE[adapter.health.state];
  const dur = estimatedDurationOf(m);

  const run = async () => {
    setConfirm(false);
    setBusy(true);
    setFailure(null);
    try {
      const res = await api('startToolRun', { params: { id: m.id }, body: { inputs: toInputs(fields, values), ...(workItemId ? { workItemId } : {}) } });
      setRunId(res.entity.id);
      void qc.invalidateQueries({ queryKey: ['tools'] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setFailure(msg);
      toast({ title: `Couldn’t start ${m.name}`, body: msg, tone: 'error', durationMs: null, key: `tool-start-err:${m.id}` });
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const errs = validate(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (p.requiresConfirm) setConfirm(true);
    else void run();
  };

  if (runId) {
    const again = (inputs: Record<string, unknown>) => {
      setValues(initialValues(fields, m.input.prefill, inputs));
      setErrors({});
      setRunId(null);
    };
    return <ToolRunView runId={runId} adapter={adapter} onRunAgain={again} />;
  }

  const primary: PanelPrimary = { id: 'run_tool', label: `Run ${m.name}`, icon: 'play', run: submit, loading: busy, disabled: down, hint: `${m.name} isn’t running` };
  return (
    <>
      <PanelFrame
        label={`Run ${m.name}`}
        data-tool-panel={m.id}
        context={
          <>
            <span className="shrink-0">Run a tool</span>
            <StateBadge tone={h.tone} label={h.label} />
            {p.requiresConfirm ? <Tag title="Asks you to confirm before it runs">Confirms first</Tag> : null}
          </>
        }
        title={m.name}
        sub={m.description}
        primary={primary}
        quiet={
          <QuietAction onClick={() => panel.close()} data-quiet="cancel">
            Cancel
          </QuietAction>
        }
      >
        {down ? (
          <section role="alert" className="rounded-lg border border-danger-200 bg-danger-50 p-4" data-tool-down>
            <p className="text-body font-bold text-danger-700">{m.name} isn’t running, so a run would fail.</p>
            {adapter.health.message ? <p className="mt-1 text-caption text-fg">{adapter.health.message}</p> : null}
            {start ? <CommandBlock className="mt-3" command={start} note="Start it in Terminal, then come back and run it." /> : <p className="mt-1 text-caption text-muted">Its manifest has no start command.</p>}
          </section>
        ) : null}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SchemaForm fields={fields} values={values} errors={errors} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} disabled={busy} />
          {/* Enter in a single-line field submits (the visible Run button is in the panel footer). */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
        {failure ? (
          <p role="alert" className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-caption text-danger-700" data-testid="tool-start-error">
            Couldn’t start it: {failure}. Nothing ran; fix the inputs or start the tool, then run it again.
          </p>
        ) : null}
        <PanelSection title="What it touches">
          <Facts
            rows={[
              ['Takes', `${dur.label}${dur.derived ? ' (typical)' : ''}`],
              ['Data', `${p.dataClass} data`],
              ['Network', NETWORK_LABEL[p.network] ?? p.network],
              ['Writes', p.writes.length ? p.writes.map(shortPath).join(', ') : 'nothing'],
              start && !down ? ['Starts with', <code key="start" className="font-mono text-caption [overflow-wrap:anywhere]">{start}</code>] : null,
            ]}
          />
        </PanelSection>
      </PanelFrame>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Run ${m.name}?`}
        confirmLabel="Run"
        onConfirm={() => void run()}
        description={
          <span>
            This tool works with <b>{p.dataClass}</b> data. Network: {NETWORK_LABEL[p.network] ?? p.network}.{p.writes.length ? ` It writes to ${p.writes.join(', ')}.` : ' It writes nothing.'}
          </span>
        }
      />
    </>
  );
}

// ── tool_run: one run ──────────────────────────────────────────────────────────────────────

export function ToolRunDetail({ runId }: { runId: string }) {
  const tools = useApi('getTools');
  const q = useToolRunQuery(runId);
  const adapter = tools.data?.adapters.find((a) => a.manifest.id === q.data?.adapterId);
  const panel = useRightPanel();
  return (
    <PanelBoundary name="agents.tool-run-panel" resetKeys={[runId]}>
      {q.isLoading ? (
        <PanelLoading label="Loading the tool run" />
      ) : !q.data ? (
        <PanelProblem gone={q.error?.code === 'not_found'} error={q.error} what="tool run" onRetry={() => void q.refetch()} />
      ) : (
        <ToolRunView
          runId={runId}
          adapter={adapter}
          onRunAgain={(inputs) => {
            if (!q.data) return;
            prefillOnce.set(q.data.adapterId, inputs);
            const e = { kind: 'tool_adapter' as const, id: q.data.adapterId, label: adapter?.manifest.name };
            notifyDetailsSpy(e);
            panel.openDetails(e);
          }}
        />
      )}
    </PanelBoundary>
  );
}

function ToolRunView({ runId, adapter, onRunAgain }: { runId: string; adapter: ToolAdapter | undefined; onRunAgain: (inputs: Record<string, unknown>) => void }) {
  const q = useToolRunQuery(runId);
  if (!q.data) {
    return q.isError ? (
      <PanelProblem gone={false} error={q.error} what="tool run" onRetry={() => void q.refetch()} />
    ) : (
      <div className="p-6">
        <Skeleton variant="line" count={3} />
      </div>
    );
  }
  const r = q.data;
  const done = TERMINAL.includes(r.status);
  const name = adapter?.manifest.name ?? r.adapterId;
  const primary: PanelPrimary | null =
    r.status === 'succeeded' && r.linkUrl
      ? { id: 'open_result', label: r.linkLabel ?? 'Open result', icon: 'new_window', run: () => openExternal(r.linkUrl!) }
      : done
        ? { id: 'run_again', label: 'Run again', icon: 'refresh', run: () => onRunAgain(r.inputs) }
        : null;
  return (
    <PanelFrame
      label={`${name} run`}
      data-tool-run-panel={r.id}
      data-status={r.status}
      context={
        <>
          <span className="shrink-0">Tool run</span>
          <StateBadge tone={RUN_TONE[r.status]} label={STATUS_LABEL[r.status]} />
        </>
      }
      title={name}
      sub={done ? (r.workItemId ? 'Linked to a task.' : undefined) : '✦ Runs in the background. It doesn’t count against your day.'}
      primary={primary}
      quiet={
        primary?.id === 'open_result' ? (
          <QuietAction icon="refresh" onClick={() => onRunAgain(r.inputs)}>
            Run again
          </QuietAction>
        ) : null
      }
    >
      <RunProgress run={r} />
    </PanelFrame>
  );
}
