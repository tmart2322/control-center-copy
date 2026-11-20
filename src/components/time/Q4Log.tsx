'use client';
/**
 * Time ▸ Log it (docs/ui/time-redesign.md): what is ready to log, and each logging run with its own status.
 *
 *   Ready to log   the rows that have ended with what they need, listed (./ReadyToLog.tsx), editable inline, then
 *                  (D-70) the updates to Events already in Org62 and the use cases ready for Org62, each a row you tick
 *                  the same way; the button names what it takes ("Log 3 rows, 2 use cases and 1 update to Slackbot ·
 *                  4.5 h", or the ticked ones). POST /time/log/batches stages ONE new private canvas item (D-47).
 *   Logging runs   every logging canvas still going is its own item (./CanvasRuns.tsx): Staged → Applied → Slackbot
 *                  told → In Org62, its Org62 progress, why its rows are read only, and the one thing it waits on:
 *                  Review & apply (the draft panel, D-52, which pages through every waiting one), Copy Slackbot
 *                  prompt (nothing is sent from here; the app re-checks Org62 after), Slackbot's done: check now.
 *                  Finished runs (everything in Org62) fold under "Show N finished"; each still opens. A run's
 *                  writes (every create and update exactly as sent, "update · Duration 2 h → 3 h") open under it.
 *
 * Exactly one button is the page's filled one: Log these rows, else the first run waiting for Apply, else the first
 * run to tell Slackbot; ⌘↵ runs it. Human hours only: agent time is never totalled here.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ActivityEntry, LogCanvas, TimeSettings, TimeWeek } from '@/contract';
import { useApi } from '@/client/hooks';
import { usePersona } from '@/client/persona';
import { featureActive } from '@/personas/gates';
import { api } from '@/client/api';
import { useCommands, useKeyBinding, type Command } from '@/client/keyboard';
import { toast } from '@/client/toast';
import { copySlackbotPrompt, OpenResult, usePromptWording } from '@/components/domain/ResultLinks';
import { useDetails } from '@/components/deals/context-frame';
import { AppLink } from '@/components/shell/AppLink';
import { useDraftQueueSource } from '@/components/detail/lib/draft-queue';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { Button, Icon } from '@/ui';
import { errorText } from '@/lib/error-text';
import { dcWaitingCount, ucWaitingCount } from '@/lib/waiting-work';
import { usePatchRows } from './bulk';
import { CanvasRuns } from './CanvasRuns';
import { canvasPrompt, confirmPrompt, type Q4Step } from './derive';
import { type LogPath } from './path-derive';
import { ReadyToLog, type ReadySelection } from './ReadyToLog';
import { runCounts, splitRuns, type CanvasRun } from './rows-derive';
import { copyText } from './shared';

/**
 * Link only: your own Slackbot work-order canvas, from Settings ▸ Time ▸ Work-order canvas link (each teammate has
 * their own), else NEXT_PUBLIC_CC_WORKORDER_CANVAS_URL. Null: no link is shown.
 */
export function workOrderCanvasUrl(time: Pick<TimeSettings, 'logging'> | undefined, env: string | undefined = process.env.NEXT_PUBLIC_CC_WORKORDER_CANVAS_URL): string | null {
  return time?.logging?.workOrderCanvasUrl || env || null;
}

export function useWorkOrderCanvasUrl(): string | null {
  return workOrderCanvasUrl(useApi('getSettings').data?.time);
}

const COPIED_KEY = 'cc:time:confirm-copied';
function readCopied(): number | null {
  try {
    const v = sessionStorage.getItem(COPIED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/** How many rows "Tell Slackbot" last copied the prompt for (session memory): the stop then waits on Org62. */
export function useConfirmCopied(): [number | null, (n: number | null) => void] {
  const [copiedFor, setCopiedFor] = useState<number | null>(() => (typeof window === 'undefined' ? null : readCopied()));
  const mark = useCallback((n: number | null) => {
    setCopiedFor(n);
    try {
      if (n === null) sessionStorage.removeItem(COPIED_KEY);
      else sessionStorage.setItem(COPIED_KEY, String(n));
    } catch {
      /* memory only */
    }
  }, []);
  return [copiedFor, mark];
}

/**
 * D-58: Deal Contribution requests waiting for a canvas (they ride on the next one with rows, or Log DCs now). Null
 * while the list loads (2026-11-13 audit C2: never a "Nothing ready" flash before the count is known); 0 when the role
 * has no DCs, or the list could not be read (Deals ▸ DCs says why).
 */
export function useDcPending(): number | null {
  const persona = usePersona();
  const dcActive = featureActive(persona, 'dealContributions');
  const dcList = useApi('listDcRequests', undefined, { enabled: dcActive });
  if (!dcActive) return 0;
  if (dcList.data) return dcWaitingCount(dcList.data.requests);
  return dcList.isError ? 0 : null;
}

/** D-67: VDP use cases waiting for a canvas (creates and Stage / Go-Live fixes ride on the next one with rows). Null while loading. */
export function useUcPending(): number | null {
  const persona = usePersona();
  const on = featureActive(persona, 'vdp');
  const sync = useApi('getUseCaseSync', undefined, { enabled: on });
  if (!on) return 0;
  if (sync.data) return ucWaitingCount(sync.data.counts);
  return sync.isError ? 0 : null;
}

/** "3 rows · 4.5 h · 1 DC request" */
export function canvasCounts(c: Pick<LogCanvas, 'rows' | 'hours' | 'dcs' | 'updates'> & Partial<Pick<LogCanvas, 'useCases'>>): string {
  return runCounts({ useCases: 0, ...c });
}

/** "Slackbot's done: check now": the Org62 reads for this canvas at once (read only, deduped with the queued ones). */
export function useCanvasCheck() {
  const [busy, setBusy] = useState<string | null>(null);
  const check = useCallback(async (c: Pick<LogCanvas, 'draftId' | 'title'>, reason: 'copied' | 'now') => {
    if (reason === 'now') setBusy(c.draftId);
    try {
      const r = await api('checkCanvasOrg62', { params: { id: c.draftId }, body: { reason } });
      if (reason === 'now' || r.note)
        toast({
          key: `canvas-check:${c.draftId}`,
          tone: r.queued.length ? 'success' : 'info',
          title: r.queued.length ? `Checking Org62 for ${c.title}` : `Nothing to check for ${c.title}`,
          body: r.note ?? 'The Org62 reads run now (read only); this canvas’s line updates when they finish.',
        });
    } catch (err) {
      toast({ key: `canvas-check:${c.draftId}`, tone: 'error', title: `Couldn't queue the Org62 check for ${c.title}`, body: errorText(err) });
    } finally {
      if (reason === 'now') setBusy(null);
    }
  }, []);
  return { check, busy };
}

export interface LogItProps {
  path: LogPath;
  /** This week (its `logCanvases`: the canvases waiting for Apply and the applied ones). */
  week: TimeWeek;
  /** The quarter so far and at least the last 3 weeks (GET /time/log, q4Range), deduped with this week's rows. */
  rows: ActivityEntry[];
  now: string;
  tz?: string;
  dryRun: boolean;
  /** Jump to rows in the week's table. */
  onShow: (ids: string[]) => void;
  /** Open a row in the docked panel. */
  onOpen?: (id: string) => void;
  /** Open Needs you (a run with rows missing in Org62). */
  onNeeds?: () => void;
  /** Tell Slackbot's session memory (useConfirmCopied): the copy moves the stop to waiting. */
  markCopied: (n: number | null) => void;
  /** The page's key scope: ⌘↵ runs the current stop. */
  scope?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function LogIt({ path, week, rows, now: _now, tz, dryRun, onShow, onOpen, onNeeds, markCopied, scope = 'page:time' }: LogItProps) {
  const canvasUrl = useWorkOrderCanvasUrl();
  const wording = usePromptWording();
  const { many, busy: approving } = usePatchRows();
  const { check: checkCanvas, busy: checkingId } = useCanvasCheck();
  const { stages, steps } = path;
  const label = week.quarter.label;
  const ready = stages.find((s) => s.id === 'ready')!;
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const readyRows = useMemo(() => path.readyIds.map((id) => byId.get(id)).filter((e): e is ActivityEntry => !!e).sort((a, b) => a.start.localeCompare(b.start)), [path.readyIds, byId]);
  const { active, finished } = useMemo(() => splitRuns(week.logCanvases, tz), [week.logCanvases, tz]);
  const lastCanvas = (week.logCanvases ?? []).find((c) => c.state !== 'pending' && c.state !== 'retry' && c.state !== 'applying') ?? null;
  // D-52: canvas items are applied here, in the same draft panel as the Outbox; it pages through every waiting one
  const { open: openPanel } = useDetails();
  const canvasIds = steps.find((x) => x.id === 'outbox')?.draftIds;
  useDraftQueueSource('time-log', canvasIds);
  const openCanvas = useCallback((id: string) => openPanel({ kind: 'draft', id, label: 'Logging canvas' }), [openPanel]);
  const pick = { taskTypeRequired: wording.taskType, taskTypes: wording.taskTypes, internalActivity: wording.internal };
  // D-70: use cases ready for Org62 and updates to Events already there are rows of Ready to log like any other
  const persona = usePersona();
  const vdpOn = featureActive(persona, 'vdp');
  const ucq = useApi('getUseCaseLandings', undefined, { enabled: vdpOn });
  const upq = useApi('getEventUpdates', undefined);
  const readyUcs = useMemo(() => (vdpOn ? (ucq.data?.items ?? []).filter((x) => x.ready) : []), [vdpOn, ucq.data]);
  const readyUps = useMemo(() => (upq.data?.updates ?? []).filter((u) => u.state !== 'dismissed'), [upq.data]);
  const anyReady = readyRows.length + readyUcs.length + readyUps.length > 0;
  // the button names what it logs: it waits until the use cases and Event updates are counted too (they load apart)
  const counting = (vdpOn && ucq.isPending) || upq.isPending;
  const readySel = useRef<ReadySelection>(null);

  const approveAll = useCallback(
    async (ids: string[]) => {
      await many(
        ids.map((id) => byId.get(id)).filter((e): e is ActivityEntry => !!e),
        () => ({ status: 'approved' }),
        { key: 'time:approve', title: (n) => `Approved ${n} ${n === 1 ? 'row' : 'rows'}`, body: 'They stay in Ready to log until you log them to Slackbot.' },
      );
    },
    [many, byId],
  );

  // Log to Slackbot: stage the batch (one canvas item); nothing leaves until its Apply, here.
  const [logging, setLogging] = useState(false);
  const logBatch = useCallback(
    async (opts: { dcOnly?: boolean; sel?: ReadySelection } = {}) => {
      const dcOnly = !!opts.dcOnly;
      setLogging(true);
      try {
        const sel = opts.sel;
        const body = dcOnly ? { dcOnly: true } : sel ? { ...(sel.ids.length ? { ids: sel.ids } : {}), useCases: sel.useCases, updates: sel.updates } : {};
        const r = (await api('stageLogBatch', { body })).entity;
        if (dcOnly) {
          toast(
            r.draftIds.length
              ? { key: 'time:log-batch', tone: 'success', title: 'DC canvas ready to apply', body: 'Only your DC requests are on it. It is under Logging runs: Review & apply, then tell Slackbot "Execute this canvas".', action: { label: 'Review & apply', onClick: () => openCanvas(r.draftIds[0]!) } }
              : { key: 'time:log-batch', tone: 'info', title: 'No DC requests waiting', body: 'They may already be on a canvas waiting for your Apply (Deals ▸ DCs).' },
          );
          return;
        }
        if (!r.draftIds.length) {
          if (r.waiting.rows) {
            toast({ key: 'time:log-batch', tone: 'info', title: 'Already waiting for your Apply', body: `${r.waiting.rows} ${r.waiting.rows === 1 ? 'row is' : 'rows are'} on a canvas you have not applied yet (Logging runs).`, action: { label: 'Review & apply', onClick: () => openCanvas(r.waiting.draftIds[0]!) } });
            return;
          }
          toast({ key: 'time:log-batch', tone: 'info', title: 'Nothing ready to log', body: r.skipped.length ? `${r.skipped.length} ${r.skipped.length === 1 ? 'row needs' : 'rows need'} ${wording.taskType ? 'a task type or ' : ''}an opportunity first (Needs you).` : 'Fix the rows in Needs you first.' });
          return;
        }
        const n = r.canvases.length;
        const waiting = r.waiting.rows ? ` ${r.waiting.rows} ${r.waiting.rows === 1 ? 'row was' : 'rows were'} already waiting on an earlier canvas.` : '';
        const extra = [r.useCases.rows ? plural(r.useCases.rows, 'use case') : null, r.eventUpdates ? plural(r.eventUpdates, 'update') : null].filter(Boolean).join(' · ');
        toast({
          key: 'time:log-batch',
          tone: 'success',
          title: `New logging run: ${n === 1 ? '1 canvas' : `${n} canvases`} · ${plural(r.events, 'row')}${extra ? ` · ${extra}` : ''} · ${r.hours} h`,
          body: `${r.approved ? `${r.approved} complete ${r.approved === 1 ? 'row' : 'rows'} approved. ` : ''}It is under Logging runs, waiting for your Apply; then tell Slackbot "Execute this canvas".${waiting}`,
          action: { label: 'Review & apply', onClick: () => openCanvas(r.draftIds[0]!) },
        });
      } catch (err) {
        toast({ key: 'time:log-batch-err', tone: 'error', durationMs: null, title: "Couldn't build the batch", body: errorText(err, 200) });
      } finally {
        setLogging(false);
      }
    },
    [openCanvas, wording.taskType],
  );

  // Tell Slackbot for every created canvas at once (⌘K): each one's own prompt, copied in one go
  const confirm = useCallback(
    async (s: Q4Step) => {
      const ok = await copyText(confirmPrompt(s, wording, week.canvas.label, rows));
      if (ok) markCopied(s.ids.length);
      // 2026-11-13 audit C4: the app re-checks Org62 for each of these canvases about 5, 15, 30 and 60 min from now
      if (ok) for (const c of s.canvases ?? []) void checkCanvas(c, 'copied');
      const n = s.canvases?.length ?? 0;
      toast({
        key: 'slackbot-prompt',
        tone: ok ? 'success' : 'error',
        title: ok ? `Slackbot prompt copied: ${plural(s.ids.length, 'row')}${n > 1 ? ` on ${n} canvases` : ''}` : "Couldn't copy the prompt",
        body: ok ? 'Paste it to Slackbot yourself; it runs the canvas in Org62. Nothing was sent from here.' : 'Open the canvas in Slack and tell Slackbot "Execute this canvas" instead.',
        undo: ok ? { label: 'Not yet', run: () => markCopied(null) } : undefined,
      });
    },
    [wording, week.canvas.label, rows, markCopied, checkCanvas],
  );

  // the page's one filled button: log the ready rows, else the first run waiting for Apply, else the first to tell
  const applyRun = active.find((r) => r.next === 'apply' || r.next === 'check_slack') ?? null;
  const tellRun = active.find((r) => r.next === 'tell') ?? null;
  const primary: { kind: 'log' } | { kind: 'run'; run: CanvasRun } | null = anyReady ? { kind: 'log' } : applyRun ? { kind: 'run', run: applyRun } : tellRun ? { kind: 'run', run: tellRun } : null;
  const runPrimary = (): false | void => {
    if (!primary) return false;
    // the same as the button: the ticked ones, or everything ready; never while the use cases and updates are counted
    if (primary.kind === 'log') {
      if (counting) return false;
      void logBatch({ sel: readySel.current });
    } else if (primary.run.next === 'tell') {
      const c = primary.run.canvas;
      void copySlackbotPrompt(canvasPrompt(c, wording), c.title).then((ok) => {
        if (ok) void checkCanvas(c, 'copied');
      });
    } else openCanvas(primary.run.canvas.draftId);
  };
  useKeyBinding('mod+enter', runPrimary, { scope, enabled: !!primary });

  const run = (s: Q4Step) => {
    if (s.id === 'approve') void approveAll(s.ids);
    else if (s.id === 'submit') void logBatch();
    else if (s.id === 'dcs') void logBatch({ dcOnly: true });
    else if (s.id === 'outbox' && s.draftIds?.length) openCanvas(s.draftIds[0]!);
    else if (s.id === 'confirm') void confirm(s);
    else onShow(s.ids);
  };
  const commands = useMemo<Command[]>(
    () => [
      ...stages.flatMap((st) => [st.step, ...st.secondary]).filter((s): s is Q4Step => !!s).map((s) => ({ id: `time.q4.${s.id}`, title: `${label} log: ${s.verb}`, subtitle: s.why, group: 'Time', run: () => run(s) })),
      ...(lastCanvas?.url ? [{ id: 'time.last-canvas', title: 'Open the last logging canvas', subtitle: lastCanvas.title, group: 'Time', run: () => window.open(lastCanvas.url!, '_blank', 'noopener,noreferrer') }] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages.map((s) => `${s.id}:${s.state}:${s.rows}:${s.secondary.map((x) => x.ids.length).join(',')}`).join('|'), label, lastCanvas?.url],
  );
  useCommands(commands);

  const approveNow = ready.secondary.find((s) => s.id === 'approve');
  const dcsStep = steps.find((s) => s.id === 'dcs');
  // D-58: DC requests ride along on the canvas (D-70: use cases are rows of their own above, no longer riders)
  const along = ready.dcs ? (
    <span>
      {anyReady ? 'Riding along on it: ' : 'Waiting for your next canvas: '}
      <AppLink href="/deals/dcs" className="font-bold text-link hover:underline" data-testid="q4-dcs-link">
        {ready.dcs === 1 ? 'your DC request' : `your ${ready.dcs} DC requests`}
      </AppLink>
    </span>
  ) : null;
  const secondary = (
    <>
      {approveNow ? (
        <Button size="xs" variant="quiet" onClick={() => run(approveNow)} loading={approving} title={approveNow.why} data-testid="q4-approve">
          {approveNow.verb}
        </Button>
      ) : null}
      {!anyReady && dcsStep ? (
        <Button size="xs" variant={primary ? 'quiet' : 'secondary'} onClick={() => run(dcsStep)} loading={logging} title={dcsStep.why} data-testid="q4-dcs">
          {dcsStep.verb}
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="@container/logit flex min-w-0 flex-col gap-5" data-guide="log-steps">
      <section aria-labelledby="q4-ready-h" className="min-w-0 rounded-lg bg-surface" data-testid="q4-ready" data-step="ready">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 pb-2">
          <h3 id="q4-ready-h" className="text-body-lg font-bold text-fg-heading">
            Ready to log
          </h3>
          <span className="text-caption text-muted tabular-nums" data-testid="stage-count-ready">
            {ready.count}
          </span>
          <span className="min-w-0 basis-full text-caption text-muted @min-[44rem]/logit:basis-auto">{anyReady ? 'Check them and change anything inline, then log them: they go on one new canvas.' : ready.why}</span>
        </div>
        <ReadyToLog rows={readyRows} useCases={readyUcs} updates={readyUps} tz={tz} pick={pick} onLog={(sel) => void logBatch({ sel })} logging={logging} counting={counting} selectionRef={readySel} primary={primary?.kind === 'log'} along={along} secondary={secondary} onOpen={(id) => onOpen?.(id)} onShow={onShow} />
      </section>

      <section aria-labelledby="q4-runs-h" className="min-w-0 rounded-lg bg-surface" data-testid="q4-runs" data-step="runs">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 pb-2">
          <h3 id="q4-runs-h" className="text-body-lg font-bold text-fg-heading">
            Logging runs
          </h3>
          <span className="text-caption text-muted tabular-nums">{active.length ? `${plural(active.length, 'run')} in progress` : 'None in progress'}</span>
          <span className="min-w-0 basis-full text-caption text-muted @min-[44rem]/logit:basis-auto">Each batch you log is a run: Apply it here, tell Slackbot, and the app checks Org62. Click one to see its rows.</span>
        </div>
        <CanvasRuns
          active={active}
          finished={finished}
          tz={tz}
          a={{ onOpen: openCanvas, onCheck: (c, r) => void checkCanvas(c, r), checkingId, onMissing: onNeeds, primaryId: primary?.kind === 'run' ? primary.run.canvas.draftId : null }}
          empty={<p className="border-t border-line px-4 py-3 text-caption text-muted">Nothing in flight. Logging the rows above starts a run here.</p>}
        />
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
        <span>{dryRun ? 'Dry run: Apply shows the payload and creates nothing.' : 'Apply creates one private canvas; Slackbot writes Org62.'}</span>
        {lastCanvas ? (
          <span className="ml-auto inline-flex items-center gap-2 tabular-nums" data-testid="q4-last-canvas">
            <span>{`Last canvas: ${lastCanvas.appliedAt ? `${dayLabel(lastCanvas.appliedAt, tz)} ${clock(lastCanvas.appliedAt, tz)}` : lastCanvas.title}`}</span>
            {lastCanvas.url ? <OpenResult href={lastCanvas.url} title="Open the last canvas in Slack" testId="q4-last-canvas-open" /> : null}
          </span>
        ) : canvasUrl ? (
          <a href={canvasUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-bold text-link hover:underline">
            Work-order canvas <Icon name="new_window" size="xs" />
          </a>
        ) : null}
      </div>
      {primary ? (
        <span className="sr-only" aria-live="polite">
          {primary.kind === 'log' ? `Next: log ${plural(readyRows.length + readyUcs.length + readyUps.length, 'row')} to Slackbot` : `Next: ${primary.run.status} (${primary.run.canvas.title})`}
        </span>
      ) : null}
    </div>
  );
}

/** ⌘↵ / ⌘K: run the current step from outside the card. */
export function q4CurrentStep(steps: Q4Step[]): Q4Step | null {
  return steps.find((s) => s.state === 'current') ?? null;
}
