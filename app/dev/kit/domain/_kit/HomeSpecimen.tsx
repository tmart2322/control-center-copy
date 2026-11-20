'use client';
/**
 * The Home A ("Morning paper") composition, built only from domain components and the mock payloads, so
 * the v2 rules can be judged in place: the day ribbon, "Do now" with the capacity line and three lead
 * cards, and the verb sections (capped rows, See all). Selection is live: click or focus (j/k) moves it,
 * and the filled button moves with it (#1 gives its fill up while anything else is selected).
 * "Panel open" narrows the composition the way the docked right panel does (compact cards, the open item
 * hands its filled action to the panel footer).
 */
import type { NowCard, WorkItemDetail } from '@/contract';
import { useMemo, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { AheadStrip, CapacityMeter, DayRibbon, NbaCard, SectionColumn, StatusBadge, WorkRow } from '@/components/domain';
import { Button, cn } from '@/ui';
import { useKitLog } from './kit-log';
import { capacity, homeSections } from './compose';
import type { KitData } from './load';

export function HomeSpecimen({ data, panelDefault = false }: { data: KitData; panelDefault?: boolean }) {
  const cb = useKitLog();
  const t = data.today;
  const cap = useMemo(() => capacity(data), [data]);
  const sec = useMemo(() => homeSections(data), [data]);
  const [sel, setSel] = useState<string | null>(null);
  const [panel, setPanel] = useState(panelDefault);
  const [hl, setHl] = useState<string | null>(null);
  const cards = t.nowStack.cards;
  const important = cards.map((c) => c.item.refs.meeting?.id).filter((x): x is string => !!x);
  const openItem = sel ? data.details.find((d) => d.item.id === sel) ?? null : null;

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
    if (id) setSel(id);
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      setSel(null);
      (document.activeElement as HTMLElement | null)?.blur();
    }
  };
  const open = (id: string) => {
    setSel(id);
    cb('onOpen → Details')(id);
  };

  const card = (c: NowCard, i: number) => (
    <NbaCard
      key={c.item.id}
      {...c}
      rank={i + 1}
      emphasis={i === 0}
      selected={sel === c.item.id}
      filled={i === 0 ? !sel || sel === c.item.id : undefined}
      inPanel={panel && sel === c.item.id}
      compact={panel}
      highlighted={hl === c.item.id}
      draftLine={false}
      onOpen={(it) => open(it.id)}
      onHover={setHl}
      onPrimary={cb('NbaCard.onPrimary')}
      onSecondary={cb('NbaCard.onSecondary')}
      onNotNow={cb('NbaCard.onNotNow')}
      onOpenEntity={cb('NbaCard.onOpenEntity')}
      onAlternative={cb('NbaCard.onAlternative')}
      className="h-full"
    />
  );

  const row = (d: WorkItemDetail, extra: Partial<Parameters<typeof WorkRow>[0]> = {}) => (
    <WorkRow
      key={d.item.id}
      item={d.item}
      nbaVerb={d.nba?.verb ?? 'review'}
      verbLabel={d.nba?.primaryLabel || undefined}
      selected={sel === d.item.id}
      inPanel={panel && sel === d.item.id}
      highlighted={hl === d.item.id}
      hideMeta
      edge={d.draft && !d.draft.userTouched && sel !== d.item.id ? 'ai' : undefined}
      badge={d.draft && !d.draft.userTouched ? <StatusBadge tone="ai" icon="sparkle">Drafted</StatusBadge> : undefined}
      onOpen={(it) => open(it.id)}
      onHover={setHl}
      onAction={cb('WorkRow.onAction')}
      onVerb={cb('WorkRow.onVerb')}
      onOpenSource={cb('WorkRow.onOpenSource')}
      {...extra}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-caption text-muted">
          <input type="checkbox" checked={panel} onChange={(e) => setPanel(e.target.checked)} data-kit-panel-toggle />
          Panel open (docked Details, 520 px)
        </label>
        <span className="text-caption text-faint">Click a card or row (or Tab, then j / k) to select it · Esc clears</span>
      </div>
      <div className={cn('flex gap-0 overflow-hidden rounded-xl border border-line bg-bg', panel && 'min-h-[52rem]')} data-kit-home>
        <div className="@container/home min-w-0 flex-1 space-y-6 px-8 pb-6 pt-6" onFocus={onFocus} onKeyDown={onKey} data-kit-home-content>
          <DayRibbon
            events={t.spine.events}
            slots={t.spine.slots}
            importantEventIds={important}
            highlightedItemId={hl}
            selectedItemId={sel}
            onHoverItem={setHl}
            onOpenEvent={cb('DayRibbon.onOpenEvent')}
            onOpenPrep={cb('DayRibbon.onOpenPrep')}
            onOpenSlot={cb('DayRibbon.onOpenSlot')}
            onOpenTakeaways={cb('DayRibbon.onOpenTakeaways')}
          />

          <section aria-labelledby="kit-donow" className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="kit-donow" className="whitespace-nowrap text-lead font-bold text-fg-heading">
                Do now
              </h2>
              <span className="text-caption text-muted">Top {cards.length} across every tab.</span>
              <CapacityMeter className="ml-auto" youMin={cap.youMin} freeMin={cap.freeMin} agentMin={cap.agentMin} agentRuns={cap.agentRuns} onOpen={cb('CapacityMeter.onOpen')} />
            </div>
            <div className={cn('grid', panel ? 'grid-cols-[1.2fr_1fr_1fr] gap-4' : 'grid-cols-[1.3fr_1fr_1fr] gap-6')}>{cards.map(card)}</div>
          </section>

          <section aria-label="Everything else, by verb" className={cn('grid rounded-lg border border-line bg-surface', panel ? 'grid-cols-3' : 'grid-cols-4 min-[2400px]:grid-cols-4')} data-kit-sections>
            <SectionColumn title="Reply & approve" count={sec.reply.length} onSeeAll={cb('SectionColumn.onSeeAll')} seeAllLabel={`See all ${sec.reply.length} in Outbox →`} action={sec.reply.length > 1 ? <Button size="sm" variant="ghost" onClick={cb('SectionColumn.batch')}>Approve ready</Button> : null} empty="Nothing to reply to.">
              {sec.reply.map((d) => row(d))}
            </SectionColumn>
            <SectionColumn
              title="Think ahead"
              count={sec.ahead.length}
              sub="next 14 days"
              className="border-l border-line"
              before={<AheadStrip days={sec.aheadDays} onSelectDay={cb('AheadStrip.onSelectDay')} className="my-1" />}
              onSeeAll={cb('SectionColumn.onSeeAll')}
              empty="Nothing in the next 14 days."
            >
              {sec.ahead.map((d) => row(d))}
            </SectionColumn>
            <SectionColumn title="Log & fix" count={sec.log.length} className="border-l border-line" onSeeAll={cb('SectionColumn.onSeeAll')} empty="Nothing to log.">
              {sec.log.map((d) => row(d))}
            </SectionColumn>
            {panel ? null : (
              <SectionColumn title="Chase" count={sec.chase.length} className="border-l border-line" onSeeAll={cb('SectionColumn.onSeeAll')} empty="Nobody to chase.">
                {sec.chase.map((d) => row(d, { verbLabel: d.item.state === 'waiting_on_others' ? 'Nudge' : 'Do or drop', nbaVerb: 'nudge' }))}
              </SectionColumn>
            )}
          </section>

          <footer className="flex items-baseline gap-6 px-1">
            <span className="text-body-lg font-bold text-fg-heading">That&apos;s everything for today.</span>
            <span className="text-caption text-faint">
              Sources {data.health.connectors.filter((c) => c.state === 'ok').length}/{data.health.connectors.length} · {data.today.dryRun ? 'Dry run' : 'Live send'}
            </span>
          </footer>
        </div>

        {panel ? (
          <aside className="flex w-[520px] shrink-0 flex-col border-l border-line bg-surface" aria-label="Details (kit stand-in)" data-kit-dock>
            <div className="flex h-14 items-center gap-1 border-b border-line px-4">
              <span className="inline-flex h-9 items-center rounded-md bg-selected px-3 font-bold text-fg-heading">Details</span>
              <span className="inline-flex h-9 items-center px-3 font-bold text-muted">Assistant</span>
            </div>
            <div className="flex-1 space-y-2 p-6">
              <h2 className="text-title font-bold text-fg-heading">{openItem?.item.title ?? 'Select a card or row'}</h2>
              <p className="max-w-[68ch] text-body text-muted">{openItem?.item.why ?? 'V2-SHELL renders the real panel; V2-DETAIL renders the item.'}</p>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-6 py-4">
              {openItem ? (
                <Button variant="primary" size="md" data-kit-dock-primary onClick={cb('Panel.primary')}>
                  {openItem.nba?.primaryLabel ?? 'Open'}
                </Button>
              ) : null}
              <Button variant="secondary" size="md">
                Snooze
              </Button>
              <span className="ml-auto text-caption text-faint">Esc to close</span>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
