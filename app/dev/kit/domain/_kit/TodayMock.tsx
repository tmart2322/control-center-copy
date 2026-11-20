'use client';
/**
 * The v2 Today composition (mockup today.html), built only from domain components and the mock payloads:
 * a one-line day header with the CapacityMeter, then three panes: the Day timeline (DaySpine with the
 * agent lane), Run of day (WorkRow with the `when` column, Fit-ins, Pull forward) and the agent's plan as a
 * diff (ReceiptCard, staged). Below 1,600 px the plan folds into a tab. The page never scrolls; panes do.
 * Selecting a run-of-day row (click, or j/k) lights its block on the timeline and moves the filled button.
 * The chrome is a kit stand-in for V2-SHELL's.
 */
import type { WorkItem } from '@/contract';
import { useMemo, useState, type FocusEvent } from 'react';
import { approxMin, CapacityMeter, DaySpine, DomainClock, ReceiptCard, Shelf, WorkList, WorkRow, AiMark } from '@/components/domain';
import { cn, Kbd, Portal } from '@/ui';
import { dayLabel } from '@/components/domain/lib/time';
import { hm } from '@/components/domain/lib/v2';
import { agentBlocks, capacity, homeSections, planReceipt, pullForward, runOfDay } from './compose';
import { KitLogProvider, useKitLog } from './kit-log';
import { useBrandAttrs } from './KitFrame';
import type { KitData } from './load';
import { MockSidebar, MockTopbar } from './MockChrome';

export function TodayMock({ data }: { data: KitData }) {
  useBrandAttrs(false);
  return (
    <KitLogProvider quiet>
      <DomainClock now={data.now} tz={data.tz}>
        <Portal>
          <Today data={data} />
        </Portal>
      </DomainClock>
    </KitLogProvider>
  );
}

function Today({ data }: { data: KitData }) {
  const cb = useKitLog();
  const t = data.today;
  const cap = useMemo(() => capacity(data), [data]);
  const run = useMemo(() => runOfDay(data), [data]);
  const lanes = useMemo(() => agentBlocks(data), [data]);
  const plan = useMemo(() => planReceipt(data), [data]);
  const pulls = useMemo(() => {
    const p = pullForward(data);
    if (p.length >= 2) return p;
    return [
      ...p,
      ...homeSections(data).ahead.map((d) => ({
        item: d.item,
        hint: d.item.why,
        action: { label: 'Pull in', verb: 'start' as const },
      })),
    ].slice(0, 4);
  }, [data]);
  const [sel, setSel] = useState<string | null>(run[0]?.item.id ?? null);
  const [hl, setHl] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [undone, setUndone] = useState<string[]>([]);
  const important = t.nowStack.cards.map((c) => c.item.refs.meeting?.id).filter((x): x is string => !!x);
  const meetings = t.spine.events.filter((e) => e.attendance !== 'declined' && e.attendance !== 'cancelled').length;
  const open = Math.max(0, cap.freeMin - cap.youMin);
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
    if (id) setSel(id);
  };
  const select = (it: WorkItem) => {
    setSel(it.id);
    cb('onOpen → Details')(it.id);
  };

  const planPane = (
    <aside className="flex min-h-0 flex-1 flex-col rounded-lg border-agentic" aria-label="Agent's plan" data-kit-plan>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4 cc-scroll">
        <ReceiptCard
          bare
          title="Agent's plan"
          receipt={plan}
          undone={undone}
          onApply={cb('Plan.onAcceptAll')}
          onUndo={(c) => {
            setUndone((u) => (u.includes(c.auditId) ? u.filter((x) => x !== c.auditId) : [...u, c.auditId]));
            cb('Plan.onUndo')(c.auditId);
          }}
          onOpenEntity={cb('Plan.onOpenEntity')}
        />
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-body font-bold text-fg-heading">Since you left</h3>
          <p className="mt-1 text-body text-muted">{t.rail.find((l) => l.lane === 'since_you_left')?.summary ?? 'Nothing changed.'}</p>
          <button type="button" className="mt-2 text-caption font-bold text-link hover:underline" onClick={cb('Today.openDigest')}>
            Open the digest →
          </button>
        </div>
        <p className="mt-5 flex items-center gap-2 text-caption text-muted">
          Want a different plan? Tell the assistant <Kbd>⌘J</Kbd>
        </p>
      </div>
    </aside>
  );

  return (
    <div className="fixed inset-0 z-[70] flex overflow-hidden bg-bg" data-kit-today>
      <MockSidebar today={t} active="Today" />
      <main className="flex min-w-0 flex-1 flex-col">
        <MockTopbar
          title="Today"
          right={
            t.header.nextMeeting ? (
              <span className="hidden text-caption text-muted min-[1500px]:inline">
                Next <b className="text-fg">{t.header.nextMeeting.title}</b>
              </span>
            ) : null
          }
        />
        <div className="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-5 px-6 pb-6 pt-5">
          <section className="flex min-w-0 items-center gap-7" aria-label="Day summary">
            <p className="whitespace-nowrap text-heading-lg font-bold tracking-[-0.015em] text-fg-heading">{dayLabel(data.now, data.tz)}</p>
            <div className="grid min-w-0 gap-1">
              <p className="max-w-[68ch] text-lead text-muted">
                About {hm(approxMin(cap.youMin))} of your work, ~{hm(approxMin(cap.freeMin))} free outside meetings:{' '}
                <b className="text-fg-heading">{cap.youMin > cap.freeMin ? `over by ~${hm(approxMin(cap.youMin - cap.freeMin))}.` : `~${hm(approxMin(open))} open to pull work forward.`}</b>
              </p>
              {cap.agentMin || cap.agentRuns ? (
                <p className="text-caption text-muted">
                  <AiMark>{cap.agentRuns || 1} agent run in the background</AiMark> (~{hm(approxMin(cap.agentMin))}). It doesn&apos;t count against your time.
                </p>
              ) : null}
            </div>
            <CapacityMeter className="ml-auto shrink-0" variant="bar" youMin={cap.youMin} freeMin={cap.freeMin} />
          </section>

          <div className="relative grid min-h-0 gap-5 grid-cols-[clamp(400px,34vw-60px,520px)_minmax(0,1fr)_52px] min-[1600px]:grid-cols-[clamp(420px,30vw-36px,640px)_minmax(0,1fr)_clamp(360px,21vw,460px)] min-[2400px]:grid-cols-[640px_minmax(0,1fr)_520px]">
            <DaySpine
              className="min-h-0"
              events={t.spine.events}
              slots={t.spine.slots}
              agentBlocks={lanes}
              importantEventIds={important}
              highlightedItemId={hl}
              selectedItemId={sel}
              onHoverItem={setHl}
              onOpenEvent={cb('DaySpine.onOpenEvent')}
              onOpenPrep={cb('DaySpine.onOpenPrep')}
              onOpenTakeaways={cb('DaySpine.onOpenTakeaways')}
              onOpenSlot={cb('DaySpine.onOpenSlot')}
              onReplan={cb('DaySpine.onReplan')}
            />

            <section className="flex min-h-0 flex-col rounded-lg border border-line bg-surface" aria-label="Run of day" onFocus={onFocus}>
              <div className="flex items-baseline gap-3 px-5 pb-2 pt-4">
                <h2 className="whitespace-nowrap text-title font-bold text-fg-heading">Run of day</h2>
                <span className="truncate text-caption text-muted">
                  {run.length} to do, in order · ~{hm(approxMin(cap.youMin))} of you
                </span>
                <span className="ml-auto flex items-center gap-1 text-caption text-muted">
                  <Kbd>j</Kbd>
                  <Kbd>k</Kbd> move
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1 cc-scroll">
                <WorkList bare label="Run of day" className="-mx-3">
                  {run.map((r) => (
                    <WorkRow
                      key={r.item.id}
                      item={r.item}
                      when={r.when}
                      nbaVerb={r.verb ?? 'review'}
                      selected={sel === r.item.id}
                      highlighted={hl === r.item.id}
                      onOpen={select}
                      onHover={setHl}
                      onAction={cb('WorkRow.onAction')}
                      onVerb={cb('WorkRow.onVerb')}
                      onOpenSource={cb('WorkRow.onOpenSource')}
                    />
                  ))}
                </WorkList>
                {run.length === 0 ? <p className="py-6 text-body text-muted">Nothing scoped to today. Pull something forward below.</p> : null}

                <Shelf
                  className="mt-7"
                  kind="fit_ins"
                  entries={t.shelves.fitIns}
                  total={t.spine.later.fitIns}
                  selectedItemId={sel}
                  onOpenAll={cb('Shelf.onOpenAll')}
                  rowProps={{
                    onAction: cb('FitInRow.onAction'),
                    onOpen: select,
                    onHover: setHl,
                    onSnooze: cb('FitInRow.onSnooze'),
                  }}
                />
                <Shelf
                  className="mt-7"
                  kind="pull_forward"
                  subtitle={`not due today · ~${hm(approxMin(open))} open`}
                  entries={pulls}
                  max={4}
                  selectedItemId={sel}
                  onOpenAll={cb('Shelf.onOpenAll')}
                  rowProps={{
                    onAction: cb('PullForward.onAction'),
                    onOpen: select,
                    onHover: setHl,
                    onSnooze: cb('PullForward.onSnooze'),
                  }}
                />
                <p className="mt-4 text-caption text-faint">That&apos;s the day. It ends at 17:30.</p>
              </div>
            </section>

            <div className="hidden min-h-0 min-[1600px]:flex min-[1600px]:flex-col">{planPane}</div>
            <button
              type="button"
              aria-controls="kit-plan"
              aria-expanded={planOpen}
              onClick={() => setPlanOpen((v) => !v)}
              className="flex flex-col items-center gap-3 rounded-lg border-agentic py-4 font-bold text-fg-heading min-[1600px]:hidden"
              title="Agent's plan (p)"
            >
              <span className="text-ai-700">✦</span>
              <span className="[writing-mode:vertical-rl]">Agent&apos;s plan</span>
              <span className="rounded-sm border border-ai-200 bg-ai-50 px-1.5 text-caption text-ai-700">{plan.changes.length}</span>
            </button>
            {planOpen ? (
              <div id="kit-plan" className={cn('absolute bottom-0 right-[72px] top-0 z-30 flex w-[400px] flex-col shadow-pop min-[1600px]:hidden')}>
                {planPane}
              </div>
            ) : null}
          </div>
          <p className="sr-only">
            {meetings} meetings today. {t.nowStack.cards.length} items on Home.
          </p>
        </div>
      </main>
    </div>
  );
}
