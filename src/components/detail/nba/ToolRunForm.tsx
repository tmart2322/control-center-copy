'use client';
/**
 * Run tool (R-UI-13): a short input form rendered from the adapter's JSON Schema, prefilled from the
 * NBA's tool inputs. Explicit Run (UI-SPEC §8: half-filled is invalid), then progress and the result
 * link come back on the same panel.
 */
import { useMemo, useState } from 'react';
import type { NbaCard, ToolRun, WorkItem } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic';
import { Button, cn, Icon, PanelError, Skeleton, StatePill } from '@/ui';
import { failFromUrl } from '../lib/mutations';
import { usePublishPrimary } from '../lib/primary';
import { openDeepLink } from './ClaudeLaunchPanel';

interface PropSchema {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  format?: string;
  default?: unknown;
}

const TERMINAL = new Set<ToolRun['status']>(['succeeded', 'failed', 'cancelled']);

function initialValue(key: string, p: PropSchema, nba: NbaCard, prefill: Record<string, unknown>): string {
  const fromNba = nba.toolInputs?.[key];
  if (fromNba !== undefined && fromNba !== null) return typeof fromNba === 'string' ? fromNba : JSON.stringify(fromNba);
  const pre = prefill[key];
  if (typeof pre === 'string' && !pre.includes('{{')) return pre;
  if (p.default !== undefined) return String(p.default);
  return '';
}

export function ToolRunForm({ adapterId, item, nba }: { adapterId: string; item: WorkItem; nba: NbaCard }) {
  const tools = useApi('getTools');
  const adapter = tools.data?.adapters.find((a) => a.manifest.id === adapterId) ?? null;
  const schema = (adapter?.manifest.input.schema ?? {}) as { properties?: Record<string, PropSchema>; required?: string[] };
  const props = useMemo(() => Object.entries(schema.properties ?? {}), [schema.properties]);
  const required = new Set(schema.required ?? []);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const v = values ?? Object.fromEntries(props.map(([k, p]) => [k, initialValue(k, p, nba, adapter?.manifest.input.prefill ?? {})]));
  const [runId, setRunId] = useState<string | null>(null);
  // live: the tool_run topic follows each state change (no poll)
  const run = useApi('getToolRun', { params: { id: runId ?? '' } }, { enabled: !!runId });
  const start = useOptimisticMutation({
    route: 'startToolRun',
    topics: ['tools', 'agents', 'item', 'today'],
    writeBack: false,
    entityId: () => undefined,
    onSuccess: (res) => setRunId(res.entity.id),
    toast: () => ({ title: `Started ${adapter?.manifest.name ?? 'tool'}`, body: 'Progress shows on the task and in Agents.' }),
    fail: failFromUrl,
  });

  const missing = [...required].filter((k) => !v[k]?.trim());
  const missingLabel = missing.map((k) => (schema.properties?.[k]?.title ?? k).toLowerCase()).join(', ');
  const submit = () => {
    if (!adapter || missing.length || start.isPending) return;
    const inputs: Record<string, unknown> = {};
    for (const [k, p] of props) {
      const raw = v[k] ?? '';
      if (raw === '') continue;
      inputs[k] = p.type === 'number' || p.type === 'integer' ? Number(raw) : p.type === 'boolean' ? raw === 'true' : raw;
    }
    start.mutate({ params: { id: adapter.manifest.id }, body: { inputs, workItemId: item.id, nbaId: nba.id } });
  };
  // Docked panel: Run goes to the footer (lib/primary.tsx). Published before the early returns (hook order).
  const external = usePublishPrimary(
    adapter ? { label: nba.primaryLabel || `Run ${adapter.manifest.name}`, disabled: missing.length > 0, loading: start.isPending, hint: missing.length ? `Fill in ${missingLabel} first` : null, kbd: 'mod+enter', run: submit } : null,
  );

  if (tools.isLoading) return <Skeleton variant="block" className="h-28 w-full" />;
  if (tools.error) return <PanelError title="Couldn't load the tool" error={tools.error} onRetry={() => void tools.refetch()} compact />;
  if (!adapter) return <p className="rounded-md border border-line px-3 py-2 text-body text-muted">This tool ({adapterId}) isn&apos;t installed.</p>;

  const down = adapter.health.state === 'down';
  const tr = run.data;
  const pct = tr?.progress ? Math.round((tr.progress.done / Math.max(1, tr.progress.total)) * 100) : null;

  return (
    <form
      className="@container rounded-lg border border-line bg-surface px-4 py-3"
      data-tool-form={adapterId}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <Icon name="apps" size="sm" className="text-muted" />
        <span className="text-caption font-bold text-fg">Run {adapter.manifest.name}</span>
        <StatePill tone={down ? 'risk' : adapter.health.state === 'ok' ? 'ok' : 'neutral'} icon={false} label={down ? '✕ Not running' : adapter.health.state === 'ok' ? '✓ Ready' : 'Unknown'} size="sm" className="ml-auto" />
      </div>
      <p className="mt-1 max-w-[68ch] text-caption text-muted">{adapter.manifest.description}</p>
      <div className="mt-2 grid gap-2 @md:grid-cols-2">
        {props.map(([k, p]) => (
          <label key={k} className="text-caption text-muted">
            {p.title ?? k}
            {required.has(k) ? <span className="text-danger-700"> *</span> : null}
            {p.enum ? (
              <select
                value={v[k] ?? ''}
                onChange={(e) => setValues({ ...v, [k]: e.target.value })}
                className="mt-1 h-8 w-full rounded-md border border-line-input bg-surface-input px-2 text-body text-fg focus:border-focus focus:outline-none"
              >
                <option value="">Choose…</option>
                {p.enum.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={p.type === 'number' || p.type === 'integer' ? 'number' : 'text'}
                value={v[k] ?? ''}
                onChange={(e) => setValues({ ...v, [k]: e.target.value })}
                aria-invalid={required.has(k) && !v[k]?.trim() ? true : undefined}
                placeholder={p.description}
                className={cn(
                  'mt-1 h-9 w-full rounded-md border bg-surface-input px-2.5 text-body text-fg focus:outline-none',
                  required.has(k) && !v[k]?.trim() ? 'border-warning-500' : 'border-line-input focus:border-focus',
                )}
              />
            )}
          </label>
        ))}
      </div>
      {tr ? (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-2 text-caption" data-tool-run={tr.status}>
          <StatePill tone={tr.status === 'succeeded' ? 'ok' : tr.status === 'failed' ? 'risk' : 'brand'} label={tr.status === 'succeeded' ? 'Done' : tr.status === 'failed' ? 'Failed' : tr.progress?.label ?? 'Running'} size="xs" />
          {pct !== null && !TERMINAL.has(tr.status) ? (
            <span className="h-1.5 w-24 rounded-full bg-surface-sunken">
              <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </span>
          ) : null}
          {tr.linkUrl ? (
            <button type="button" onClick={() => openDeepLink(tr.linkUrl!)} className="ml-auto inline-flex items-center gap-1 text-link hover:underline">
              <Icon name="new_window" size="xs" /> {tr.linkLabel ?? 'Open result'}
            </button>
          ) : null}
          {tr.error ? <span className="text-danger-700">{tr.error}</span> : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!external ? (
          <Button type="submit" variant="primary" kbd="mod+enter" disabled={missing.length > 0} loading={start.isPending} data-nba-primary>
            {nba.primaryLabel || `Run ${adapter.manifest.name}`}
          </Button>
        ) : null}
        {missing.length ? <span className="text-caption text-muted">Fill in {missingLabel} first.</span> : null}
        {start.error ? (
          <span role="alert" className="text-caption text-danger-700">
            {start.error.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
