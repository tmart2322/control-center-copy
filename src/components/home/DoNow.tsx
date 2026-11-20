'use client';
/**
 * Do now: the capacity summary and up to three lead cards. Only #1 (or the selected card) gets the filled
 * button; the card open in the panel hands its filled button to the panel footer.
 */
import type { HomeCapacity, HomeCard, HomeClosedForYou, HomePayload } from '@/contract';
import { AppLink } from '@/components/shell/AppLink';
import { FillingIn } from '@/components/shell/FillingIn';
import { AccountTag, AiMark, CapacityMeter, NbaCard } from '@/components/domain';
import { ReadIn, useHomeView } from './ctx';
import { ageShort, cardKey, fmtDur, type HomeTarget } from './model';
import { navigate } from '@/components/shell/router';
import { useNewIds } from '@/components/lists/live-list';
import { openDeepLink } from '@/components/detail/nba/ClaudeLaunchPanel';

function Capacity({ c }: { c: HomeCapacity }) {
  const pf = c.pullForward.map((p) => `${p.title} (~${fmtDur(p.youMin)})`).join('\n');
  return (
    <span className="hm-cap" title={pf ? `Pull forward if you have time:\n${pf}` : undefined} data-home-panel="capacity">
      <CapacityMeter youMin={c.youMinToday} freeMin={c.freeMin} agentMin={c.agentMinBackground} agentRuns={c.agentRunsBackground} dayLabel={c.dayLabel} variant="inline" />
    </span>
  );
}

/** The prep checklist (or the initiative line) under the why, plus the read-in note. */
function CardExtra({ card }: { card: HomeCard }) {
  const readIn = <ReadIn state={card.readInState} colored={!card.state && !card.aiLabel && card.agentMin === 0} />;
  if (card.prep)
    return (
      <p className="hm-prep">
        <span>{card.prep.label}</span>
        {card.prep.steps.map((st, i) => (
          <span key={i} className={st.done ? 'is-done' : 'is-todo'} title={st.label}>
            {st.done ? '✓' : '○'} {st.label}
          </span>
        ))}
        {readIn}
      </p>
    );
  if (!card.context && !card.readInState) return null;
  return (
    <p className="hm-context hm-trunc" title={card.context ?? undefined}>
      {card.context}
      {readIn}
    </p>
  );
}

/** Planning ahead: why a card is on the planned day without being due then. */
function CarriedNote({ card }: { card: HomeCard }) {
  if (!card.carried) return null;
  return (
    <p className="hm-carried" data-carried={card.carried}>
      <span aria-hidden>↪ </span>
      {card.carried === 'moved' ? 'Moved here' : 'Carried over from today'}
    </p>
  );
}

/** Item cards are the domain NbaCard (v2): #1 emphasis, the filled action follows the selection. */
function ItemCard({ card, first }: { card: HomeCard; first: boolean }) {
  const v = useHomeView();
  const key = cardKey(card);
  const target = v.target(key);
  const isOpen = v.openKey === key;
  // The card's minutes are the engine's estimate (what the capacity meter counts). An item nothing has ranked yet (a
  // fresh first scan) carries a 0/0 effort, which drew "You ~0m" on a card the meter counted as 15 min.
  const raw = card.now!;
  const now = raw.item.effort.youMin || raw.item.effort.agentMin || !(card.youMin || card.agentMin) ? raw : { ...raw, item: { ...raw.item, effort: { youMin: card.youMin, agentMin: card.agentMin } } };
  const err = v.actions.errors[card.id];
  const ref = { id: now.item.id, version: now.item.version };
  return (
    <div className={`hm-card-slot${first ? " is-first" : ""}`} data-home-key={key} data-live={v.liveOf?.(key)} data-home-verb-owner={card.verb.action} onFocusCapture={() => v.select(key)}>
      <NbaCard
        {...now}
        rank={card.rank}
        emphasis={first}
        selected={v.selectedKey === key}
        filled={v.primaryKey === key && !isOpen}
        inPanel={isOpen}
        compact={v.panelOpen}
        whyLines={first ? 2 : 1}
        tagLabel={card.tag ?? undefined}
        draftLine={false}
        extra={
          <>
            <CarriedNote card={card} />
            <CardExtra card={card} />
          </>
        }
        snoozeLabel={`Move to ${v.moveLabel}`}
        className="h-full"
        onOpen={(it, mode) => (mode === 'page' ? navigate(`/work/${it.id}`) : target && v.openTarget(target))}
        onPrimary={() => v.actions.run(card.verb, { title: card.title, card, fallbackHref: `/work/${card.id}` })}
        onAlternative={() => target && v.openTarget(target)}
        onSecondary={(k) => {
          if (k === 'done') v.actions.done(ref, card.title);
          else if (k === 'snooze') v.actions.snooze(ref, card.title);
          // Not done yet (a likely-done card): back among the open work, the same not-done step as Work, Triage and Looks done.
          else if (k === 'not_done') v.actions.notDone(ref, card.title);
          else if (target) v.openTarget(target);
        }}
        // The reason is the action: the same not-now Details runs, optimistic with an Undo toast.
        onNotNow={(reason) => v.actions.notNow(ref, card.title, reason)}
        onOpenEntity={(r) => r.href && navigate(r.href)}
        onOpenSource={(s) => s.url && openDeepLink(s.url)}
      />
      {err ? (
        <p className="hm-inline-err" role="alert">
          Couldn’t {err.verb}: {err.message} ·{' '}
          <button type="button" className="hm-link" onClick={err.retry}>
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Outbox card's first three drafts, each a button that opens that draft in the panel, and "+N more" for
 * the first of the rest. The panel pages through the whole queue from there (draftIds).
 */
function DraftRows({ card, target }: { card: HomeCard; target: HomeTarget | undefined }) {
  const v = useHomeView();
  const shown = new Set(card.drafts.map((d) => d.draftId));
  const rest = card.draftIds.filter((id) => !shown.has(id));
  const open = (id: string, label: string) => target && v.openTarget(target, { kind: 'draft', id, label });
  const total = Math.max(card.draftIds.length, card.drafts.length);
  // a draft that just came in is marked in the AI color (docs/UX.md "Live updates")
  const fresh = useNewIds(card.drafts.map((d) => d.draftId));
  return (
    <ul className="hm-drafts" aria-label={`${total} ${total === 1 ? 'draft' : 'drafts'} to approve`}>
      {card.drafts.map((d, i) => (
        <li key={d.draftId} data-live={fresh.has(d.draftId) ? 'new' : undefined} data-live-tone={fresh.has(d.draftId) ? 'ai' : undefined}>
          <button type="button" className="hm-draft" data-draft-id={d.draftId} aria-current={v.openEntityId === d.draftId ? 'true' : undefined} aria-label={`Open draft ${i + 1} of ${total}: ${d.who}, ${d.text}`} onClick={() => open(d.draftId, `Draft to ${d.who}`)}>
            <span className="who">{d.who}</span>
            <span className="hm-trunc">{d.text}</span>
            <span className="age">{ageShort(d.at, v.nowMs)}</span>
          </button>
        </li>
      ))}
      {rest.length ? (
        <li>
          <button type="button" className="hm-link hm-draft-more" data-draft-id={rest[0]} aria-label={`Open draft ${card.drafts.length + 1} of ${total}, ${rest.length} more to approve`} onClick={() => open(rest[0]!, card.title)}>
            +{rest.length} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function OutboxCard({ card, first }: { card: HomeCard; first: boolean }) {
  const v = useHomeView();
  const key = cardKey(card);
  const selected = v.selectedKey === key;
  const isOpen = v.openKey === key;
  const primary = v.primaryKey === key;
  const target = v.target(key);
  const err = v.actions.errors[card.id] ?? (card.verb.targetId ? v.actions.errors[card.verb.targetId] : undefined);
  return (
    <article
      className={['hm-panel', 'hm-card', first ? 'is-first' : '', selected ? 'is-selected' : '', isOpen ? 'is-open' : ''].filter(Boolean).join(' ')}
      tabIndex={0}
      data-home-key={key}
      data-live={v.liveOf?.(key)}
      aria-label={`Do now ${card.rank}: ${card.title}`}
      aria-current={selected ? 'true' : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button,a')) return;
        if (target) v.openTarget(target);
      }}
      onFocus={() => v.select(key)}
    >
      <div className="hm-card-top">
        <span className="hm-rank">{card.rank}</span>
        {card.tag ? <AccountTag label={card.tag} /> : null}
        {card.aiLabel ? <AiMark className="hm-push">{card.aiLabel}</AiMark> : null}
      </div>
      <h3>{card.title}</h3>
      {card.kind === 'outbox' ? <DraftRows card={card} target={target} /> : null}
      {err ? (
        <p className="hm-inline-err" role="alert">
          Couldn’t {err.verb}: {err.message} ·{' '}
          <button type="button" className="hm-link" onClick={err.retry}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="hm-card-foot">
        <span className="hm-foot-text hm-wide-only">{card.foot}</span>
        <span className="hm-spacer" />
        <button
          type="button"
          className={`hm-btn ${primary && !isOpen ? 'is-primary' : isOpen ? 'is-quiet' : 'is-secondary'}`}
          data-home-verb={card.verb.action}
          disabled={card.verb.action === 'open_in_claude' && v.actions.launching}
          onClick={() => v.actions.run(card.verb, { title: card.title, card, fallbackHref: card.kind === 'item' ? `/work/${card.id}` : '/outbox' })}
        >
          {card.verb.label}
        </button>
      </div>
    </article>
  );
}

/**
 * SETTLE-1: one quiet line beside Do now when "Tell me what closed" is on: what the app closed for you since you left,
 * one click from the list (Triage ▸ Closed for you, each with its reason, its message and Undo).
 */
function ClosedLine({ c }: { c: HomeClosedForYou }) {
  return (
    <span className="hm-closed" data-home-panel="closed-for-you" data-testid="home-closed-line">
      <span aria-hidden className="hm-closed-mark">
        ✓
      </span>
      <span className="hm-trunc">
        Closed {c.count} for you since you left
      </span>
      <span aria-hidden>·</span>
      <AppLink className="hm-link" href={c.href} aria-label={`Review the ${c.count} items closed for you`}>
        Review
      </AppLink>
    </span>
  );
}

/** The lead line: "Top 3 of 7 across every tab." · planning: "What tomorrow starts with · 2 carried over from today." */
export function leadNote(h: Pick<HomePayload, 'day' | 'nextDay' | 'doNow'>): string {
  const cards = h.doNow.cards;
  if (h.day !== 'next') return cards.length ? `Top ${cards.length} of ${h.doNow.total} across every tab.` : 'Nothing needs you right now.';
  const day = h.nextDay ? (h.nextDay.label === 'Tomorrow' ? 'tomorrow' : h.nextDay.label) : 'the day';
  if (!cards.length) return `Nothing lined up for ${day} yet.`;
  const carried = cards.filter((c) => c.carried === 'from_today').length;
  const moved = cards.filter((c) => c.carried === 'moved').length;
  const extra = [carried ? `${carried} carried over from today` : '', moved ? `${moved} moved here` : ''].filter(Boolean).join(', ');
  return `What ${day} starts with${extra ? ` · ${extra}` : ''}.`;
}

export function DoNow({ h }: { h: HomePayload }) {
  const cards = h.doNow.cards;
  const plan = h.day === 'next';
  return (
    <section className="hm-lead-wrap" aria-labelledby="hm-donow" data-home-panel="donow">
      <div className="hm-lead-head">
        <h2 id="hm-donow">{plan ? 'Up first' : 'Do now'}</h2>
        <span className="hm-note hm-trunc">
          {cards.length || plan ? leadNote(h) : <FillingIn variant="note">{leadNote(h)}</FillingIn>}
          {h.doNow.elsewhereNote && !plan ? <span className="hm-wide-only"> {h.doNow.elsewhereNote}</span> : null}
        </span>
        {h.closedForYou ? <ClosedLine c={h.closedForYou} /> : null}
        <Capacity c={h.capacity} />
      </div>
      {cards.length ? (
        <div className="hm-lead">
          {cards.map((c, i) => (c.kind === 'item' && c.now ? <ItemCard key={c.id} card={c} first={i === 0} /> : <OutboxCard key={c.id} card={c} first={i === 0} />))}
          {Array.from({ length: Math.max(0, 3 - cards.length) }, (_, i) => (
            <div key={`empty-${i}`} className="hm-panel hm-card hm-card-empty" aria-hidden>
              {plan ? 'Nothing else lined up' : 'Nothing else needs you now'}
            </div>
          ))}
        </div>
      ) : (
        <div className="hm-lead">
          <div className="hm-panel hm-card hm-card-empty" style={{ gridColumn: '1 / -1', minHeight: 96 }}>
            {plan ? 'Nothing lined up yet. “Move to …” on a card today sends it here; Think ahead shows what is coming.' : <FillingIn variant="card">Nothing needs you right now. Think ahead, or pull something forward.</FillingIn>}
          </div>
        </div>
      )}
    </section>
  );
}

