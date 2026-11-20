'use client';
/**
 * Agents ▸ Tools (UI-SPEC §12, R-UI-13, DESIGN-V2): two panes, the launcher (registered ToolAdapters: what each
 * does, whether it's up, how long it takes, ONE verb "Run…") and the tool runs (recent runs with their state
 * and result). Click or Enter opens the docked panel: the run form for a tool (`tool_adapter`), the progress
 * for a run (`tool_run`). No page-owned sheet. Nothing runs until you click Run in the panel.
 *
 * Deep links: /agents/tools?run=<tool id>[&workItemId=…] opens that tool's form (the waffle launcher uses it);
 * ?run=<tool run id> opens that run.
 */
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToolAdapter, ToolRun } from '@/contract';
import { useApi } from '@/client/hooks';
import { useCommands, useKeyBinding, useListKeys } from '@/client/keyboard';
import { useResumeSelection } from '@/client/resume/hooks';
import { EDGE_BG, type Indicator } from '@/components/domain';
import { useRightPanel, type PanelEntity } from '@/components/shell/panel';
import { cn, EmptyState, fmtAgo, PanelBoundary, PanelError, RowVerb, useNow, usePanelState } from '@/ui';
import { notifyDetailsSpy } from './actions';
import { AgentsHeader } from './AgentsHeader';
import { ToolsBodySkeleton } from './AgentsSkeleton';
import { capFor, Section, useWideScreen } from './Section';
import { estimatedDurationOf } from './schema-form';
import { HEALTH_BADGE, RUN_TONE, setToolRunContext, STATUS_LABEL } from './ToolRunPanel';
import { navigate } from '@/components/shell/router';

function summarizeInputs(inputs: Record<string, unknown>): string {
  const first = Object.values(inputs).find((v) => typeof v === 'string' && v.trim());
  return typeof first === 'string' ? first : Object.keys(inputs).length ? `${Object.keys(inputs).length} inputs` : 'No inputs';
}

const TONE_TEXT: Record<string, string> = { ok: 'text-fg', risk: 'font-bold text-danger-700', warn: 'font-bold text-warning-700', ai: 'text-ai-700', neutral: 'text-muted', brand: 'text-link' };

const toolKey = (id: string) => `tool:${id}`;
const runKey = (id: string) => `run:${id}`;

function useOpen() {
  const panel = useRightPanel();
  return useCallback(
    (e: PanelEntity) => {
      notifyDetailsSpy(e);
      panel.openDetails(e);
    },
    [panel],
  );
}

interface RowBase {
  selected?: boolean;
  emphasized?: boolean;
  inPanel?: boolean;
  onOpen: () => void;
  rowProps?: Record<string, unknown>;
}

/** A registered tool: name, what it does, up or down, how long, ONE verb. */
export function ToolRow({ adapter: a, lastRun, selected, emphasized, inPanel, onOpen, rowProps }: RowBase & { adapter: ToolAdapter; lastRun?: ToolRun }) {
  const now = useNow(30_000);
  const m = a.manifest;
  const h = HEALTH_BADGE[a.health.state];
  const down = a.health.state === 'down';
  const ind: Indicator = down ? 'danger' : selected ? 'now' : 'none';
  const dur = estimatedDurationOf(m);
  return (
    <div
      role="listitem"
      {...rowProps}
      data-tool-row={m.id}
      data-health={a.health.state}
      data-selected={selected || undefined}
      aria-label={`${m.name}, ${h.label}`}
      onClick={onOpen}
      className={cn('group/run relative grid cursor-pointer grid-cols-[3px_minmax(0,1fr)] gap-x-3 rounded-md px-3 py-2.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]', selected ? 'bg-selected' : 'hover:bg-surface-muted')}
    >
      <span aria-hidden className={cn('row-span-3 my-0.5 w-[3px] rounded-full', EDGE_BG[ind])} />
      <span className="min-w-0 truncate text-body-lg font-bold text-fg-heading" title={m.name}>
        {m.name}
      </span>
      <p className="col-start-2 min-w-0 truncate text-caption text-muted" title={m.description}>
        {m.description}
      </p>
      <div className="col-start-2 mt-1 flex min-w-0 items-center gap-x-2 text-caption text-muted">
        <span className={cn('shrink-0 whitespace-nowrap', TONE_TEXT[h.tone])}>{down ? '✕ Down: start it first' : h.label}</span>
        <span className="shrink-0 whitespace-nowrap">· takes {dur.label}</span>
        {lastRun?.startedAt ? <span className="hidden min-w-0 truncate whitespace-nowrap @[26rem]/sec:inline">· last run {fmtAgo(lastRun.startedAt, now)}</span> : null}
        <span className="ml-auto shrink-0 pl-1">
          <RowVerb action={{ label: down ? 'How to start' : 'Run…', onClick: onOpen, kbd: 'enter', disabled: !a.enabled }} filled={(selected || !!emphasized) && !inPanel} />
        </span>
      </div>
    </div>
  );
}

/** A tool run: tool, inputs, state, when, ONE verb. */
export function ToolRunRow({ run: r, adapter, selected, inPanel, onOpen, rowProps }: RowBase & { run: ToolRun; adapter?: ToolAdapter }) {
  const now = useNow(30_000);
  const tone = RUN_TONE[r.status];
  const ind: Indicator = r.status === 'failed' ? 'danger' : selected ? 'now' : r.status === 'waiting_user' ? 'warning' : 'none';
  return (
    <div
      role="listitem"
      {...rowProps}
      data-testid={`recent-run-${r.id}`}
      data-status={r.status}
      data-selected={selected || undefined}
      onClick={onOpen}
      className={cn('group/run relative grid cursor-pointer grid-cols-[3px_minmax(0,1fr)] gap-x-3 rounded-md px-3 py-2.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]', selected ? 'bg-selected' : 'hover:bg-surface-muted')}
    >
      <span aria-hidden className={cn('row-span-3 my-0.5 w-[3px] rounded-full', EDGE_BG[ind])} />
      <span className="min-w-0 truncate text-body-lg font-bold text-fg-heading">{adapter?.manifest.name ?? r.adapterId}</span>
      <p className="col-start-2 min-w-0 truncate text-caption text-muted" title={summarizeInputs(r.inputs)}>
        {summarizeInputs(r.inputs)}
      </p>
      <div className="col-start-2 mt-1 flex min-w-0 items-center gap-x-2 text-caption text-muted">
        <span className={cn('shrink-0 whitespace-nowrap', TONE_TEXT[tone])}>{STATUS_LABEL[r.status]}</span>
        {r.startedAt ? <span className="shrink-0 tabular-nums whitespace-nowrap">· {fmtAgo(r.startedAt, now)}</span> : null}
        {r.workItemId ? <span className="hidden shrink-0 whitespace-nowrap @[26rem]/sec:inline">· for a task</span> : null}
        <span className="ml-auto shrink-0 pl-1">
          <RowVerb action={{ label: r.status === 'succeeded' && r.linkUrl ? (r.linkLabel ?? 'Open result') : 'View', onClick: onOpen }} filled={!!selected && !inPanel} />
        </span>
      </div>
    </div>
  );
}

/** The launcher as a section column (Agents ▸ Runs shows it as a fourth pane at 2,240 px of main width). */
export function ToolLauncher({ className, cap }: { className?: string; cap: number }) {
  const tools = useApi('getTools');
  const open = useOpen();
  const [expanded, setExpanded] = useState(false);
  const adapters = tools.data?.adapters ?? [];
  if (!adapters.length) return null;
  const shown = expanded ? adapters : adapters.slice(0, cap);
  return (
    <Section className={className} title="Run a tool" count={adapters.length} sub="opens its form" total={adapters.length} cap={cap} expanded={expanded} onToggle={() => setExpanded((v) => !v)} data-section="tools">
      {shown.map((a) => (
        <ToolRow key={a.manifest.id} adapter={a} onOpen={() => open({ kind: 'tool_adapter', id: a.manifest.id, label: a.manifest.name })} />
      ))}
    </Section>
  );
}

export function ToolsView() {
  const params = useSearchParams();
  const panel = useRightPanel();
  const open = useOpen();
  const tools = useApi('getTools');
  const wide = useWideScreen();
  const cap = capFor(wide) + 3;
  const adapters = useMemo(() => tools.data?.adapters ?? [], [tools.data]);
  const recent = useMemo(() => tools.data?.recentRuns ?? [], [tools.data]);
  const state = usePanelState('agents.tools', { loading: tools.isLoading, error: tools.data ? null : tools.error, empty: !!tools.data && !adapters.length });
  const [selected, setSelected] = useResumeSelection('agents-tools');
  const [moreRuns, setMoreRuns] = useState(false);
  const lastRunOf = (id: string) => recent.find((r) => r.adapterId === id);

  const openTool = useCallback((a: ToolAdapter) => open({ kind: 'tool_adapter', id: a.manifest.id, label: a.manifest.name }), [open]);
  const openToolRun = useCallback((r: ToolRun) => open({ kind: 'tool_run', id: r.id, label: adapters.find((a) => a.manifest.id === r.adapterId)?.manifest.name ?? 'Tool run' }), [open, adapters]);

  // Deep link (?run=<tool id | tool run id>) → the docked panel, once.
  const runParam = params.get('run');
  const workItemId = params.get('workItemId') ?? undefined;
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!runParam || applied.current === runParam || !tools.data) return;
    applied.current = runParam;
    const a = adapters.find((x) => x.manifest.id === runParam);
    const r = recent.find((x) => x.id === runParam);
    if (a) {
      if (workItemId) setToolRunContext(a.manifest.id, { workItemId });
      setSelected(toolKey(a.manifest.id));
      openTool(a);
    } else if (r) {
      setSelected(runKey(r.id));
      openToolRun(r);
    }
    navigate('/agents/tools', { replace: true });
  }, [runParam, workItemId, tools.data, adapters, recent, openTool, openToolRun, setSelected]);

  const runsShown = moreRuns ? recent : recent.slice(0, cap);
  const ids = useMemo(() => [...adapters.map((a) => toolKey(a.manifest.id)), ...runsShown.map((r) => runKey(r.id))], [adapters, runsShown]);
  const openKey = useCallback(
    (k: string) => {
      const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (kind === 'tool') {
        const a = adapters.find((x) => x.manifest.id === id);
        if (a) openTool(a);
      } else {
        const r = recent.find((x) => x.id === id);
        if (r) openToolRun(r);
      }
    },
    [adapters, recent, openTool, openToolRun],
  );
  const panelKey = panel.open && panel.tab === 'details' && panel.entity ? (panel.entity.kind === 'tool_adapter' ? toolKey(panel.entity.id) : panel.entity.kind === 'tool_run' ? runKey(panel.entity.id) : null) : null;
  const active = selected && ids.includes(selected) ? selected : panelKey && ids.includes(panelKey) ? panelKey : null;
  const list = useListKeys({
    scope: 'list:agents-tools',
    ids,
    activeId: active,
    onActiveChange: (k) => {
      setSelected(k);
      if (panel.open && panel.tab === 'details') openKey(k);
    },
    primary: true,
    enabled: state === 'ready',
    onOpen: openKey,
    onPrimary: openKey,
  });
  // An open panel: the shell closes it (and restores focus); otherwise Esc clears the selection.
  useKeyBinding('escape', () => (panel.open ? false : active ? void setSelected(null) : false), { scope: 'list:agents-tools', enabled: list.active });

  useCommands(
    adapters.map((a) => ({
      id: `tools.run.${a.manifest.id}`,
      title: `Run tool: ${a.manifest.name}`,
      subtitle: a.health.state === 'down' ? 'Not running: shows how to start it' : 'Opens the run form',
      group: 'Agents',
      keywords: ['tool', 'run', ...a.manifest.match.keywords],
      disabled: !a.enabled,
      run: () => {
        setSelected(toolKey(a.manifest.id));
        openTool(a);
      },
    })),
  );

  const down = adapters.filter((a) => a.health.state === 'down');
  const sentence = tools.data ? (
    <>
      {adapters.length} tool{adapters.length === 1 ? '' : 's'} registered
      {down.length ? (
        <>
          {' '}
          · <b className="font-bold text-danger-700">{down.map((d) => d.manifest.name).join(', ')} {down.length === 1 ? 'isn’t' : 'aren’t'} running</b>
        </>
      ) : null}
      . <span className="text-muted">Each run opens its form first; nothing runs until you click Run.</span>
    </>
  ) : null;

  return (
    <div className="flex min-h-full flex-col gap-5 px-6 pt-5 pb-6" data-tools-root>
      <AgentsHeader tab="tools" sentence={sentence} />
      <PanelBoundary name="agents.tools">
        {state === 'error' ? (
          <PanelError title="Couldn’t load the tool registry" error={tools.error ?? new Error('Forced error state (dev toolbar)')} onRetry={() => void tools.refetch()} />
        ) : state === 'loading' ? (
          <ToolsBodySkeleton />
        ) : state === 'empty' ? (
          <EmptyState size="page" icon="apps" title="No tools registered" body="Add a ToolAdapter manifest to tools-registry/ and it appears here, in the waffle launcher and in ⌘K." />
        ) : (
          <div {...list.containerProps} className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface @min-[70rem]/main:grid-cols-2 @min-[70rem]/main:divide-x @min-[70rem]/main:divide-y-0">
            <Section title="Run a tool" count={adapters.length} sub="opens its form in the panel" total={adapters.length} cap={adapters.length} expanded onToggle={() => {}} data-section="launcher">
              {adapters.map((a) => (
                <ToolRow
                  key={a.manifest.id}
                  rowProps={list.rowProps(toolKey(a.manifest.id))}
                  adapter={a}
                  lastRun={lastRunOf(a.manifest.id)}
                  selected={active === toolKey(a.manifest.id)}
                  inPanel={panelKey === toolKey(a.manifest.id)}
                  onOpen={() => {
                    setSelected(toolKey(a.manifest.id));
                    openTool(a);
                  }}
                />
              ))}
            </Section>
            {recent.length ? (
              <Section title="Tool runs" count={recent.length} sub="newest first" total={recent.length} cap={cap} expanded={moreRuns} onToggle={() => setMoreRuns((v) => !v)} data-section="tool-runs">
                {runsShown.map((r) => (
                  <ToolRunRow
                    key={r.id}
                    rowProps={list.rowProps(runKey(r.id))}
                    run={r}
                    adapter={adapters.find((x) => x.manifest.id === r.adapterId)}
                    selected={active === runKey(r.id)}
                    inPanel={panelKey === runKey(r.id)}
                    onOpen={() => {
                      setSelected(runKey(r.id));
                      openToolRun(r);
                    }}
                  />
                ))}
              </Section>
            ) : (
              <section className="flex flex-col px-4 pt-4 pb-3" aria-label="Tool runs">
                <h2 className="text-lead font-bold text-fg-heading">Tool runs</h2>
                <EmptyState size="inline" title="No runs yet" body="Run a tool and it shows here with its result." />
              </section>
            )}
          </div>
        )}
      </PanelBoundary>
    </div>
  );
}
