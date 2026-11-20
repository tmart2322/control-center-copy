'use client';
/**
 * /dev/kit/domain: every domain component in design v2, every state, rendered from the mock DataSource's
 * real view models. Callbacks land in the bottom-right log. `?theme=light` for the light theme.
 */
import type { BriefHighlight, NbaVerb, Proposal, RailLane as RailLaneVm, ReceiptChange, RunState, SourceKind, WorkItem, WorkState } from '@/contract';
import { useMemo, useState } from 'react';
import {
  AccountTag,
  ActivityRow,
  ActivityRowHeader,
  AgentRunRow,
  AheadStrip,
  AiMark,
  BriefHighlightCard,
  BriefSummary,
  CapacityMeter,
  ConnectorRow,
  ConnectorRowHeader,
  DayRibbon,
  DaySpine,
  EffortNote,
  HeaderStrip,
  NbaCard,
  ProposalDiff,
  RailLane,
  ReceiptCard,
  ResolvePicker,
  RunGlyph,
  SectionColumn,
  Shelf,
  StateGlyph,
  StatusBadge,
  StatusRail,
  WorkGroup,
  WorkList,
  WorkRow,
  useClock,
  type BadgeTone,
} from '@/components/domain';
import { EntityChip, SourceChip, StartBy } from '@/components/domain/lib';
import { Button } from '@/ui';
import { agentBlocks, capacity, homeSections, pullForward, runOfDay } from './compose';
import { HomeSpecimen } from './HomeSpecimen';
import { KitLogProvider, useKitLog } from './kit-log';
import { KitFrame, Section, Specimen } from './KitFrame';
import type { KitData } from './load';
import { buildVariants, type CardProps } from './variants';

const SECTIONS: Array<[string, string]> = [
  ['home', 'Home A composition'],
  ['marks', 'Marks'],
  ['nba', 'NbaCard'],
  ['rows', 'WorkRow'],
  ['day', 'DayRibbon · DaySpine'],
  ['capacity', 'CapacityMeter · AheadStrip · SectionColumn'],
  ['shelves', 'Shelves'],
  ['receipts', 'ReceiptCard · ProposalDiff'],
  ['agents', 'AgentRunRow'],
  ['briefs', 'Briefs'],
  ['health', 'ConnectorRow'],
  ['time', 'ActivityRow'],
  ['resolve', 'ResolvePicker'],
  ['deprecated', 'Deprecated'],
];

export function KitGallery({ data }: { data: KitData }) {
  return (
    <KitLogProvider quiet>
      <KitFrame now={data.now} tz={data.tz} sections={SECTIONS}>
        <Gallery data={data} />
      </KitFrame>
    </KitLogProvider>
  );
}

function Gallery({ data }: { data: KitData }) {
  const cb = useKitLog();
  const v = useMemo(() => buildVariants(data), [data]);
  const verbOf = useMemo(() => new Map(data.details.map((d) => [d.item.id, d.nba?.verb ?? null] as const)), [data.details]);
  const [hl, setHl] = useState<string | null>(null);
  const [rowSel, setRowSel] = useState<string | null>(data.today.nowStack.cards[1]?.item.id ?? null);

  const cardCb = {
    onPrimary: cb('NbaCard.onPrimary'),
    onAlternative: cb('NbaCard.onAlternative'),
    onSecondary: cb('NbaCard.onSecondary'),
    onNotNow: cb('NbaCard.onNotNow'),
    onOpenSource: cb('NbaCard.onOpenSource'),
    onOpenEntity: cb('NbaCard.onOpenEntity'),
    onOpen: cb('NbaCard.onOpen'),
    onApplyProposal: cb('NbaCard.onApplyProposal'),
    onKeepMine: cb('NbaCard.onKeepMine'),
    onUndoReopen: cb('NbaCard.onUndoReopen'),
  };
  const card = (label: string, c: CardProps | null, extra: Partial<Parameters<typeof NbaCard>[0]> = {}) =>
    c ? (
      <Specimen label={label} key={label}>
        <NbaCard {...c} {...cardCb} {...extra} />
      </Specimen>
    ) : null;

  const rowCb = {
    onOpen: (it: WorkItem, mode: 'sheet' | 'page') => {
      setRowSel(it.id);
      cb('WorkRow.onOpen')(it, mode);
    },
    onAction: cb('WorkRow.onAction'),
    onVerb: cb('WorkRow.onVerb'),
    onOpenSource: cb('WorkRow.onOpenSource'),
    onOpenEntity: cb('WorkRow.onOpenEntity'),
  };
  const nowItems = data.today.nowStack.cards.map((c) => c.item);
  const waitingOthers = data.details.filter((d) => d.item.state === 'waiting_on_others').map((d) => d.item);
  const doneItems = data.details.filter((d) => d.item.state === 'done').map((d) => d.item);
  const row = (it: WorkItem, extra: Partial<Parameters<typeof WorkRow>[0]> = {}) => (
    <WorkRow key={it.id} item={it} nbaVerb={verbOf.get(it.id) as NbaVerb | null} selected={rowSel === it.id} {...rowCb} {...extra} />
  );
  const cap = useMemo(() => capacity(data), [data]);
  const sec = useMemo(() => homeSections(data), [data]);
  const run = useMemo(() => runOfDay(data), [data]);
  const pulls = useMemo(() => pullForward(data), [data]);
  const lanes = useMemo(() => agentBlocks(data), [data]);
  const important = data.today.nowStack.cards.map((c) => c.item.refs.meeting?.id).filter((x): x is string => !!x);

  return (
    <>
      <Section id="home" title="Home A composition" note="Domain components only, in the mockup's arrangement (home-1-briefing). Selection moves the one filled button; hover a row or card for snooze / done / not now.">
        <HomeSpecimen data={data} />
      </Section>

      <Marks />

      <Section id="nba" title="NbaCard" note="The lead card: rank · neutral tag · ONE badge; 20–22 px title; why; effort split; ONE action (filled only when selected or #1). Focus a card: Space expands, Enter opens Details, ⌘↵ fires the action, e s n d ⇧D o ?.">
        <div className="space-y-8">
          <Specimen label="Lead row · #1 emphasis (filled) · #2 · #3 (secondary)">
            <div className="grid grid-cols-[1.3fr_1fr_1fr] items-stretch gap-6">
              {data.today.nowStack.cards.map((c, i) => (
                <NbaCard key={c.item.id} {...c} rank={i + 1} {...cardCb} className="h-full" draftLine={false} />
              ))}
            </div>
          </Specimen>
          <Specimen label="Compact (the with-panel layout) · #2 selected · #3 open in the panel (quiet action)">
            <div className="grid max-w-[64rem] grid-cols-[1.2fr_1fr_1fr] items-stretch gap-4">
              {data.today.nowStack.cards.map((c, i) => (
                <NbaCard key={c.item.id} {...c} rank={i + 1} compact selected={i === 1} filled={i === 0 ? false : undefined} inPanel={i === 2} {...cardCb} className="h-full" draftLine={false} />
              ))}
            </div>
          </Specimen>
          <div className="grid grid-cols-1 items-start gap-6 min-[1400px]:grid-cols-2 min-[2200px]:grid-cols-3">
            {card('Expanded · #1 · Start in Claude, plan block', v.now1, { defaultExpanded: true })}
            {card('Expanded · Slack draft in place · new evidence', v.now2, { defaultExpanded: true, selected: true })}
            {card('Expanded · update strip (draft revised) · email', v.now3, { defaultExpanded: true })}
            {card('Touched draft + new info → ProposalDiff strip', v.touched, { defaultExpanded: true })}
            {card('Low confidence · alternatives replace the action', v.guess, { defaultExpanded: true })}
            {card('Re-evaluating · calm wash on the why line, never blank', v.now2 ? { ...v.now2, item: { ...v.now2.item, reevaluating: true } } : null, { rank: 2 })}
            {card('Waiting on you · app run, inline answer', v.waitingApp, { defaultExpanded: true })}
            {card('Waiting on you · Claude session → Open in Claude', v.claudeWaiting, { defaultExpanded: true })}
            {card('Likely done · confirm with evidence', v.likely, { defaultExpanded: true })}
            {card('Looped back in (R-UI-22)', v.looped, { defaultExpanded: true })}
            {card('Reopened · new requirement', v.reopened, { defaultExpanded: true })}
            {card('Stale · connector broken (StaleMark)', v.stale, { defaultExpanded: true })}
            {card('Suggested · dashed, Triage only', v.suggested, { defaultExpanded: true, variant: 'triage' })}
            {card('Blocked (page-known) · red badge + edge', v.now3, { rank: 3, blocked: true })}
            {card('Run tool (R-UI-13)', v.runTool, { defaultExpanded: true })}
            {card('Log (activity)', v.log, { defaultExpanded: true })}
            {card('Review · Drive deliverable (R-UI-15)', v.deliverable, { defaultExpanded: true })}
            {card('Engine proposal on a locked field (inline)', v.fieldProposal, { defaultExpanded: true })}
            {card('Email · new thread', v.emailNew, { defaultExpanded: true })}
            {card('Collapsed · highlighted from the day ribbon', v.now1, { highlighted: true })}
          </div>
        </div>
      </Section>

      <Section id="rows" title="WorkRow · WorkList · WorkGroup" note="18 px title · muted why line · the state edge · a quiet verb (filled when selected). Hover: done / snooze / edit / source. j/k move; Enter opens. `dense` keeps a one-line row for long tables.">
        <div className="grid grid-cols-1 gap-8 min-[1700px]:grid-cols-[minmax(0,1fr)_26rem]">
          <Specimen label="Full width · grouped · a row selected (click another to move the filled verb)">
            <WorkList label="Work" className="max-h-[40rem] overflow-y-auto">
              <WorkGroup label="Do now" count={nowItems.length}>
                {nowItems.map((it) => row(it))}
              </WorkGroup>
              <WorkGroup label="Later today" count={data.today.moreToday.count} action={<span className="text-link">See all {data.today.moreToday.count} →</span>}>
                {data.today.moreToday.items.slice(0, 6).map((it) => row(it))}
              </WorkGroup>
              <WorkGroup label="WAITING ON OTHERS" count={waitingOthers.length}>
                {waitingOthers.map((it) => row(it))}
              </WorkGroup>
              <WorkGroup label="Done today" count={doneItems.length} defaultCollapsed>
                {doneItems.map((it) => row(it))}
              </WorkGroup>
            </WorkList>
          </Specimen>
          <Specimen label="Narrow (a Home column) · timing folds into the why line" className="max-w-[26rem]">
            <WorkList label="Narrow">{[...nowItems, ...data.today.moreToday.items.slice(0, 4)].map((it) => row(it, { hideMeta: true }))}</WorkList>
          </Specimen>
          <Specimen label="Dense · one-line table rows (Work page)" className="min-[1700px]:col-span-2">
            <WorkList label="Dense">{[...nowItems, ...data.today.moreToday.items.slice(0, 6)].map((it) => row(it, { dense: true }))}</WorkList>
          </Specimen>
          <Specimen label="Run of day · with the `when` column" className="max-w-[44rem]">
            <WorkList label="Run of day">
              {run.slice(0, 4).map((r, i) => (
                <WorkRow key={r.item.id} item={r.item} when={r.when} nbaVerb={r.verb} emphasis={i === 0 && !rowSel} selected={rowSel === r.item.id} {...rowCb} />
              ))}
            </WorkList>
          </Specimen>
        </div>
      </Section>

      <Section id="day" title="DayRibbon · DaySpine" note="True proportions (08:00–17:30, widened to fit). Past dims, a now line, declined meetings are ghosts, open time and planned work are dashed, ★ meetings carry their prep state, the agent's background runs get a violet lane. Hover a block: the linked card lights.">
        <div className="space-y-8">
          <Specimen label="DayRibbon · Home">
            <DayRibbon
              events={data.today.spine.events}
              slots={data.today.spine.slots}
              importantEventIds={important}
              highlightedItemId={hl}
              onHoverItem={setHl}
              onOpenEvent={cb('DayRibbon.onOpenEvent')}
              onOpenSlot={cb('DayRibbon.onOpenSlot')}
              onOpenTakeaways={cb('DayRibbon.onOpenTakeaways')}
              onOpenPrep={cb('DayRibbon.onOpenPrep')}
            />
          </Specimen>
          <div className="grid grid-cols-[minmax(26rem,36rem)_minmax(0,1fr)] items-start gap-8">
            <Specimen label="DaySpine · the Today timeline (drag a ▶ block onto open time to re-plan)">
              <DaySpine
                className="h-[48rem]"
                events={data.today.spine.events}
                slots={data.today.spine.slots}
                later={data.today.spine.later}
                agentBlocks={lanes}
                importantEventIds={important}
                highlightedItemId={hl}
                selectedItemId={rowSel}
                onHoverItem={setHl}
                onOpenEvent={cb('DaySpine.onOpenEvent')}
                onOpenPrep={cb('DaySpine.onOpenPrep')}
                onOpenTakeaways={cb('DaySpine.onOpenTakeaways')}
                onOpenSlot={cb('DaySpine.onOpenSlot')}
                onReplan={cb('DaySpine.onReplan')}
                onOpenLater={cb('DaySpine.onOpenLater')}
              />
            </Specimen>
            <Specimen label="Linked cards (hover a block)">
              <div className="space-y-3">
                {data.today.nowStack.cards.map((c, i) => (
                  <NbaCard key={c.item.id} {...c} rank={i + 1} {...cardCb} highlighted={hl === c.item.id} onHover={setHl} />
                ))}
              </div>
            </Specimen>
          </div>
        </div>
      </Section>

      <Section id="capacity" title="CapacityMeter · AheadStrip · SectionColumn" note="Only today-scoped, hands-on minutes count; agent time is a quiet violet note. Over only when it's true (hatched amber overflow). Sections are verb-named, capped at 3 (5 at 2,400 px), with See all N.">
        <div className="grid grid-cols-1 gap-8 min-[1500px]:grid-cols-2">
          <Specimen label="Inline (Home) · the mock day">
            <CapacityMeter youMin={cap.youMin} freeMin={cap.freeMin} agentMin={cap.agentMin} agentRuns={cap.agentRuns} />
          </Specimen>
          <Specimen label="Inline · fits, one agent run (mockup copy)">
            <CapacityMeter youMin={90} freeMin={390} agentRuns={1} />
          </Specimen>
          <Specimen label="Bar (Today header) · fits">
            <CapacityMeter variant="bar" youMin={90} freeMin={390} agentMin={20} />
          </Specimen>
          <Specimen label="Bar · truly over (hatched overflow)">
            <CapacityMeter variant="bar" youMin={460} freeMin={330} />
          </Specimen>
          <Specimen label="AheadStrip · 14 days from tomorrow (amber = prep missing)">
            <div className="max-w-[26rem]">
              <AheadStrip days={sec.aheadDays} onSelectDay={cb('AheadStrip.onSelectDay')} caption />
            </div>
          </Specimen>
          <Specimen label="AheadStrip · narrow (minor day labels drop)">
            <div className="max-w-[15rem]">
              <AheadStrip days={sec.aheadDays} />
            </div>
          </Specimen>
          <Specimen label="SectionColumn · batch action · capped · See all" className="max-w-[28rem]">
            <div className="rounded-lg border border-line bg-surface">
              <SectionColumn title="Reply & approve" count={data.today.moreToday.items.length} action={<Button size="sm" variant="ghost">Approve 2 ready</Button>} seeAllLabel="See all in Outbox →" onSeeAll={cb('SectionColumn.onSeeAll')}>
                {data.today.moreToday.items.map((it) => row(it, { hideMeta: true }))}
              </SectionColumn>
            </div>
          </Specimen>
          <Specimen label="SectionColumn · empty: renders nothing, or a calm line" className="max-w-[28rem]">
            <div className="rounded-lg border border-line bg-surface">
              <SectionColumn title="Chase" count={0} empty="Nobody to chase." />
              <SectionColumn title="Prep" count={0} />
            </div>
          </Specimen>
        </div>
      </Section>

      <Section id="shelves" title="Shelves" note="Pull-forward style rows: a when column, the edge, a title with a faint tag, a quiet verb (filled when selected), hover for snooze / renegotiate / let go.">
        <div className="grid max-w-[1600px] grid-cols-1 gap-8 min-[1400px]:grid-cols-2">
          <Shelf kind="fit_ins" entries={data.today.shelves.fitIns} total={data.today.spine.later.fitIns} onOpenAll={cb('Shelf.onOpenAll')} rowProps={{ onAction: cb('FitInRow.onAction'), onOpen: cb('FitInRow.onOpen'), onSnooze: cb('FitInRow.onSnooze') }} />
          <Shelf
            kind="pull_forward"
            subtitle={`not due today · ~${Math.max(0, Math.round((cap.freeMin - cap.youMin) / 60))}h open`}
            entries={pulls.length ? pulls : sec.ahead.map((d) => ({ item: d.item, hint: d.item.why, action: { label: 'Pull in', verb: 'start' as const } }))}
            max={4}
            selectedItemId={pulls[0]?.item.id ?? sec.ahead[0]?.item.id ?? null}
            onOpenAll={cb('Shelf.onOpenAll')}
            rowProps={{ onAction: cb('PullForward.onAction'), onOpen: cb('PullForward.onOpen'), onSnooze: cb('PullForward.onSnooze') }}
          />
          <Shelf
            kind="promises"
            entries={data.today.shelves.promises}
            total={data.today.spine.later.promises}
            onOpenAll={cb('Shelf.onOpenAll')}
            rowProps={{ onAction: cb('PromiseRow.onAction'), onOpen: cb('PromiseRow.onOpen'), onRenegotiate: cb('PromiseRow.onRenegotiate'), onLetGo: cb('PromiseRow.onLetGo') }}
          />
          <Shelf kind="fit_ins" entries={[]} />
        </div>
      </Section>

      <ReceiptsSection v={v} />

      <Section id="agents" title="AgentRunRow" note="Glyph = state: ○ queued · ◐ running (violet) · ⏸ waiting on you (amber) · ● review (accent) · ✓ done · ✕ failed · ☾ stale. Deep links go to the callback, never opened here.">
        <div className="grid grid-cols-1 items-start gap-8 min-[1500px]:grid-cols-[minmax(0,1fr)_26rem]">
          <Specimen label="Agents page width (second row selected)">
            <div className="overflow-clip rounded-lg border border-line bg-surface">
              {data.agents.runs.map((r, i) => (
                <AgentRunRow key={r.id} run={r} selected={i === 1} taskTitle={data.details.find((d) => d.item.id === r.workItemId)?.item.title} onAction={cb('AgentRunRow.onAction')} onOpenDeepLink={cb('AgentRunRow.onOpenDeepLink')} onOpenTask={cb('AgentRunRow.onOpenTask')} onAnswer={cb('AgentRunRow.onAnswer')} />
              ))}
            </div>
          </Specimen>
          <Specimen label="Narrow" className="max-w-[26rem]">
            <div className="overflow-clip rounded-lg border border-line bg-surface">
              {data.agents.runs.slice(0, 5).map((r) => (
                <AgentRunRow key={r.id} run={r} onAction={cb('AgentRunRow.onAction')} onOpenDeepLink={cb('AgentRunRow.onOpenDeepLink')} onAnswer={cb('AgentRunRow.onAnswer')} />
              ))}
            </div>
          </Specimen>
        </div>
      </Section>

      <BriefsSection data={data} />

      <Section id="health" title="ConnectorRow" note="R-UI-12. Sources are neutral glyphs; only the state is colored. Re-auth by reauth.kind: in-app · terminal command · refresh script · instructions.">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <div className="min-w-[84rem]">
            <ConnectorRowHeader />
            {data.health.connectors.map((c) => (
              <ConnectorRow key={c.id} connector={c} onReauth={cb('ConnectorRow.onReauth')} onCopyCommand={cb('ConnectorRow.onCopyCommand')} onScan={cb('ConnectorRow.onScan')} onOpen={cb('ConnectorRow.onOpen')} />
            ))}
            {data.health.connectors[1] ? (
              <ConnectorRow
                connector={{ ...data.health.connectors[1], id: 'gmail_broken', state: 'auth_needed', lastError: { class: 'auth', message: 'invalid_grant: token expired', at: data.now, count: 1 }, impact: 'Email after 09:40 may be missing' }}
                onReauth={cb('ConnectorRow.onReauth')}
              />
            ) : null}
            {data.health.connectors[0] ? (
              <ConnectorRow
                connector={{ ...data.health.connectors[0], id: 'x', label: 'Zscaler tunnel', state: 'offline', reauth: { kind: 'instructions', label: 'Connect Zscaler', command: null, instructions: 'Off the corporate network: connect Zscaler, then scanning resumes on its own.' }, lastError: { class: 'offline', message: 'ENOTFOUND (off network)', at: data.now, count: 4 } }}
                onReauth={cb('ConnectorRow.onReauth')}
              />
            ) : null}
          </div>
        </div>
      </Section>

      <TimeSection data={data} />

      <Section id="resolve" title="ResolvePicker" note="R-UI-22 · ⇧D. Keys 1–7 pick a reason, Enter resolves, Esc cancels.">
        <div className="flex flex-wrap items-start gap-6">
          <ResolvePicker title={v.now2?.item.title} people={data.people} threadPeople={v.now2?.item.people.map((p) => p.id) ?? []} relatedItems={data.details.slice(0, 5).map((d) => ({ id: d.item.id, title: d.item.title }))} onResolve={cb('ResolvePicker.onResolve')} onCancel={cb('ResolvePicker.onCancel')} />
          <ResolvePicker title={v.now3?.item.title} defaultResolution="handed_off" people={data.people} threadPeople={v.now3?.item.people.map((p) => p.id) ?? []} onResolve={cb('ResolvePicker.onResolve')} onCancel={cb('ResolvePicker.onCancel')} />
          <ResolvePicker defaultResolution="duplicate" people={data.people} relatedItems={data.details.slice(0, 5).map((d) => ({ id: d.item.id, title: d.item.title }))} onResolve={cb('ResolvePicker.onResolve')} />
        </div>
      </Section>

      <DeprecatedSection data={data} />
    </>
  );
}

function Marks() {
  const tones: BadgeTone[] = ['danger', 'warning', 'success', 'ai', 'now', 'neutral'];
  const kinds: SourceKind[] = ['slack', 'gmail', 'calendar', 'drive', 'gemini', 'org62', 'vdp', 'claude', 'manual'];
  const runStates: RunState[] = ['queued', 'running', 'waiting_on_you', 'done_review', 'done', 'failed', 'stale'];
  const workStates: WorkState[] = ['suggested', 'open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'done', 'reopened', 'snoozed', 'dismissed'];
  const label: Record<BadgeTone, [string, string]> = {
    danger: ['ban', 'Blocked'],
    warning: ['clock', 'Start by 08:35'],
    success: ['check', 'Fits'],
    ai: ['sparkle', 'Drafted'],
    now: ['clock', 'Now'],
    neutral: ['clock', 'Snoozed'],
  };
  return (
    <Section id="marks" title="Marks" note="Color is an indicator, never identity: blue = the one action, now, selection · red = overdue, blocked, broken · amber = at risk, prep missing · green = ready · violet = AI. Accounts and sources are neutral. Status is always icon + word.">
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 min-[1400px]:grid-cols-2">
        <Specimen label="StatusBadge · the six roles">
          <div className="flex flex-wrap gap-2">
            {tones.map((t) => (
              <StatusBadge key={t} tone={t} icon={label[t][0]}>
                {label[t][1]}
              </StatusBadge>
            ))}
            <StatusBadge tone="ai" dashed>
              Suggested
            </StatusBadge>
          </div>
        </Specimen>
        <Specimen label="Quiet actions, loud selection · quiet verb / secondary / the one filled">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm">
              Send draft
            </Button>
            <Button variant="secondary" size="md">
              Review 3
            </Button>
            <Button variant="primary" size="md" kbd="mod+enter">
              Open in Claude
            </Button>
          </div>
        </Specimen>
        <Specimen label="AccountTag (neutral) · AiMark · EffortNote">
          <div className="flex flex-wrap items-center gap-3">
            <AccountTag label="Account A" />
            <AccountTag label="Outbox" />
            <AccountTag label="Account B · plain" plain />
            <AiMark>Drafted for you</AiMark>
            <EffortNote youMin={20} agentMin={20} />
            <EffortNote youMin={50} />
          </div>
        </Specimen>
        <Specimen label="SourceChip · neutral glyphs, labelled and compact">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {kinds.map((k) => (
                <SourceChip key={k} source={k} />
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {kinds.map((k) => (
                <SourceChip key={k} source={k} compact />
              ))}
            </div>
          </div>
        </Specimen>
        <Specimen label="StartBy · calm / soon / late / headline · EntityChip">
          <div className="flex flex-wrap items-center gap-4">
            <StartByFromClock />
            <EntityChip kind="account" label="Account A" />
            <EntityChip kind="initiative" label="Initiative" />
            <EntityChip kind="person" label="Person" bare />
          </div>
        </Specimen>
        <Specimen label="RunGlyph · StateGlyph">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-caption text-muted">
              {runStates.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <RunGlyph state={s} size={16} /> {s.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-caption text-muted">
              {workStates.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <StateGlyph state={s} size={16} /> {s.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function StartByFromClock() {
  const { now } = useClock();
  const at = (m: number) => new Date(Date.parse(now) + m * 60_000).toISOString();
  return (
    <span className="flex flex-wrap items-center gap-4">
      <StartBy at={at(45)} />
      <StartBy at={at(10)} />
      <StartBy at={at(-5)} />
      <StartBy at={at(13)} size="lg" />
    </span>
  );
}

function DeprecatedSection({ data }: { data: KitData }) {
  const cb = useKitLog();
  const lanes = data.today.rail;
  const railCb = { onEntryAction: cb('RailLane.onEntryAction'), onOpenEntry: cb('RailLane.onOpenEntry'), onOpenLane: cb('RailLane.onOpenLane'), onOpenEvidence: cb('RailLane.onOpenEvidence') };
  const healthy: RailLaneVm = { lane: 'health', label: 'HEALTH', count: 0, summary: '8/8 connected', entries: [], href: '/health', visible: true };
  const waiting = lanes.find((l) => l.lane === 'waiting_on_you');
  return (
    <Section id="deprecated" title="Deprecated" note="Design v2 has no status rail and no header strip: their content moved to Home's verb sections, the agent's plan and CapacityMeter. Kept compiling, restyled minimally, until the page lanes drop them.">
      <div className="flex flex-wrap items-start gap-6 opacity-90">
        <Specimen label="StatusRail · 380 px" className="w-[23.75rem]">
          <StatusRail className="h-[36rem]" lanes={lanes} {...railCb} onToggleLane={cb('StatusRail.onToggleLane')} />
        </Specimen>
        <div className="w-[23.75rem] space-y-6">
          {waiting ? (
            <Specimen label="RailLane · Waiting on you, expanded">
              <div className="rounded-lg border border-line bg-surface">
                <RailLane lane={waiting} expanded {...railCb} />
              </div>
            </Specimen>
          ) : null}
          <Specimen label="RailLane · Health, all connected">
            <div className="rounded-lg border border-line bg-surface">
              <RailLane lane={healthy} {...railCb} />
            </div>
          </Specimen>
          <Specimen label="StatusRail · empty">
            <StatusRail lanes={[]} />
          </Specimen>
        </div>
        <Specimen label="HeaderStrip" className="min-w-0 flex-1">
          <div className="flex h-12 items-center justify-end overflow-hidden rounded-lg border border-line bg-surface px-3">
            <HeaderStrip header={data.today.header} onOpenMeeting={cb('HeaderStrip.onOpenMeeting')} onOpenDeadline={cb('HeaderStrip.onOpenDeadline')} onOpenCatchUp={cb('HeaderStrip.onOpenCatchUp')} onOpenCapacity={cb('HeaderStrip.onOpenCapacity')} />
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function ReceiptsSection({ v }: { v: ReturnType<typeof buildVariants> }) {
  const cb = useKitLog();
  const [undone, setUndone] = useState<string[]>(['aud_kit_3']);
  const [proposals, setProposals] = useState<Record<string, Proposal['status']>>({});
  const settle = (p: Proposal, status: Proposal['status']) => setProposals((s) => ({ ...s, [p.id]: status }));
  const withStatus = (p: Proposal | null | undefined) => (p ? { ...p, status: proposals[p.id] ?? p.status } : null);
  const fieldProposal = withStatus(v.fieldProposal?.proposals.find((p) => p.status === 'pending'));
  const draftProposal = withStatus(v.touched?.proposals[0]);
  const conflict = withStatus(v.conflict);
  return (
    <Section id="receipts" title="ReceiptCard · ProposalDiff" note="The agent's work wears the agentic border and one ✦. Receipts: a mark per line, before → after, quiet Undo, Undo all. Staged (the agent's plan, or more than five changes): Accept all / Apply. Proposals: Apply / Keep mine; the 409 variant is amber.">
      <div className="grid grid-cols-1 items-start gap-6 min-[1400px]:grid-cols-2 min-[2200px]:grid-cols-3">
        <Specimen label="ReceiptCard · chat re-prioritize (one line undone)">
          <ReceiptCard
            receipt={v.receipt}
            undone={undone}
            onUndo={(c: ReceiptChange) => {
              setUndone((u) => [...u, c.auditId]);
              cb('ReceiptCard.onUndo')(c.auditId);
            }}
            onUndoAll={(r) => {
              setUndone(r.changes.map((c) => c.auditId));
              cb('ReceiptCard.onUndoAll')(r);
            }}
            onOpenEntity={cb('ReceiptCard.onOpenEntity')}
          />
        </Specimen>
        <Specimen label="ReceiptCard · staged (Apply)">
          <ReceiptCard receipt={v.staged} onApply={cb('ReceiptCard.onApply')} onOpenEntity={cb('ReceiptCard.onOpenEntity')} />
        </Specimen>
        {fieldProposal ? (
          <Specimen label="ProposalDiff · engine change to a locked field">
            <ProposalDiff
              proposal={fieldProposal}
              onApply={(p) => {
                settle(p, 'applied');
                cb('ProposalDiff.onApply')(p);
              }}
              onKeepMine={(p) => {
                settle(p, 'rejected');
                cb('ProposalDiff.onKeepMine')(p);
              }}
              onOpenSource={cb('ProposalDiff.onOpenSource')}
            />
          </Specimen>
        ) : null}
        {draftProposal ? (
          <Specimen label="ProposalDiff · draft body (text diff)">
            <ProposalDiff proposal={draftProposal} onApply={(p) => settle(p, 'applied')} onKeepMine={(p) => settle(p, 'rejected')} />
          </Specimen>
        ) : null}
        {conflict ? (
          <Specimen label="ProposalDiff · changed elsewhere (409)">
            <ProposalDiff proposal={conflict} conflict onApply={(p) => settle(p, 'applied')} onKeepMine={(p) => settle(p, 'rejected')} />
          </Specimen>
        ) : null}
        {fieldProposal ? (
          <Specimen label="ProposalDiff · strip (inside a card)">
            <div className="overflow-clip rounded-lg border border-line bg-surface">
              <ProposalDiff proposal={{ ...fieldProposal, status: 'pending' }} variant="strip" defaultDiffOpen onApply={cb('ProposalDiff.onApply')} onKeepMine={cb('ProposalDiff.onKeepMine')} className="border-t-0" />
            </div>
          </Specimen>
        ) : null}
      </div>
    </Section>
  );
}

function BriefsSection({ data }: { data: KitData }) {
  const cb = useKitLog();
  const [status, setStatus] = useState<Record<string, BriefHighlight['status']>>({});
  const hs = (data.brief?.highlights ?? []).map((h) => ({ ...h, status: status[h.id] ?? h.status }));
  const set = (h: BriefHighlight, s: BriefHighlight['status']) => setStatus((x) => ({ ...x, [h.id]: s }));
  const [sel, setSel] = useState(data.briefs.watched[0]?.id ?? null);
  return (
    <Section id="briefs" title="Briefs" note="R-UI-21: reading material, never competes with Do now (no filled action). Neutral icons; only 'new' gets the accent dot.">
      <div className="grid grid-cols-1 items-start gap-6 min-[1400px]:grid-cols-[26rem_minmax(0,1fr)]">
        <Specimen label="BriefSummary · Watched + My opportunities">
          <div className="overflow-clip rounded-lg border border-line bg-surface">
            <p className="border-b border-line px-4 py-2.5 text-body font-bold text-fg-heading">Watched</p>
            {data.briefs.watched.map((b) => (
              <BriefSummary key={b.id} brief={b} selected={sel === b.id} onOpen={(x) => { setSel(x.id); cb('BriefSummary.onOpen')(x); }} />
            ))}
            <p className="border-y border-line px-4 py-2.5 text-body font-bold text-fg-heading">My opportunities</p>
            {data.briefs.opportunities.map((b) => (
              <BriefSummary key={b.id} brief={b} selected={sel === b.id} onOpen={(x) => { setSel(x.id); cb('BriefSummary.onOpen')(x); }} />
            ))}
            {data.briefs.watched[0] ? <BriefSummary brief={{ ...data.briefs.watched[0], id: 'gen', title: '#a-channel', status: 'generating', unread: false }} /> : null}
          </div>
        </Specimen>
        <Specimen label="BriefHighlightCard · Promote / Make task / Not relevant change state">
          <div className="grid grid-cols-1 gap-4 min-[1900px]:grid-cols-2">
            {hs.map((h) => (
              <BriefHighlightCard
                key={h.id}
                highlight={h}
                onPromote={(x) => { set(x, 'promoted'); cb('BriefHighlightCard.onPromote')(x); }}
                onMakeTask={(x) => { set(x, 'promoted'); cb('BriefHighlightCard.onMakeTask')(x); }}
                onDismiss={(x) => { set(x, 'dismissed'); cb('BriefHighlightCard.onDismiss')(x); }}
                onUndo={(x) => { set(x, 'new'); cb('BriefHighlightCard.onUndo')(x); }}
                onOpenSource={cb('BriefHighlightCard.onOpenSource')}
              />
            ))}
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function TimeSection({ data }: { data: KitData }) {
  const cb = useKitLog();
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved'>>({});
  const rows = data.time.entries.slice(0, 10);
  return (
    <Section id="time" title="ActivityRow" note="R-UI-6 · autosave per row: edit a field; the status slot shows what the page would render (InlineStatus).">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <div className="min-w-[90rem]">
          <ActivityRowHeader />
          {rows.map((e) => (
            <ActivityRow
              key={e.id}
              entry={e}
              taskTypes={data.taskTypes}
              opps={data.opps}
              statusSlot={saving[e.id] === 'saving' ? 'Saving…' : saving[e.id] === 'saved' ? 'Saved · just now' : e.userLockedFields.length ? 'Edited by you' : null}
              onChange={(patch, entry) => {
                cb('ActivityRow.onChange')(JSON.stringify(patch), entry.description);
                setSaving((s) => ({ ...s, [entry.id]: 'saving' }));
                setTimeout(() => setSaving((s) => ({ ...s, [entry.id]: 'saved' })), 700);
              }}
              onOpenSource={cb('ActivityRow.onOpenSource')}
            />
          ))}
        </div>
      </div>
    </Section>
  );
}
