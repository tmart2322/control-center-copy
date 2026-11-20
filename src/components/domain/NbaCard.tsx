'use client';
/**
 * NbaCard: the Home A lead card (DESIGN-V2, mockup home-1-briefing "Do now"; UI-SPEC §5.1 for behaviour).
 *
 *   rank · neutral account tag ·························· ONE status badge (start-by / blocked / drafted)
 *   Title, 22 px (#1) or 20 px
 *   Why, one muted line
 *   [prep / purpose line, or the `extra` slot]                       (hidden in `compact`)
 *   ── expanded only: status line · sources · proposals · draft / answer / plan / deliverable block ──
 *   You ~20m + ✦ agent ~20m in background ···· [snooze · done · not now on hover] [ONE action]
 *   ↻ update strip (revised) — or ProposalDiff strip (user-touched draft)
 *
 * Quiet actions, loud selection: the one action is filled only when the card is `selected` or has
 * `emphasis` (default: rank 1); otherwise it is secondary. A card open in the docked panel (`inPanel`) hands
 * its filled action to the panel footer and keeps a quiet verb. Color is an indicator only: the top edge and
 * the single badge carry the state (accent = now, red = late/blocked, amber = tight, violet = AI).
 *
 * Presentational: no data fetching. Every action fires a callback; deep links are passed up, never opened.
 * Click or Enter opens Details (`onOpen`; without it, a click expands in place).
 * Keyboard (card focused): Space expand/preview · Enter details · ⇧Enter page · ⌘↵ primary · e edit ·
 * s snooze · n not now · d done · ⇧D resolve · o open source · ? why · a accept · m merge · Esc close.
 */
import type { AgentRun, Draft, EntityRef, NbaAlternative, NbaCard as NbaCardVm, NbaVerb, NotNowReason, Proposal, SourceRef, WorkItem } from '@/contract';
import { useId, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Button, ConfidenceWord, cn, Icon, Kbd, StaleMark } from '@/ui';
import { AccountTag, AiMark, EDGE_TOP, EffortNote, itemIndicator, RAISED_BG, SourceChip, StatusBadge, TONE_TO_BADGE, useClock, type BadgeTone } from './lib';
import { clock, dueLabel, dur, minutesBetween } from './lib/time';
import { mergeSources, toolName } from './derive';
import { openInLabel } from './lib/source-link';
import { looksDoneEvidence } from '@/engines/home/looks-done';
import { DraftPreviewBlock } from './DraftPreviewBlock';
import { ProposalDiff } from './ProposalDiff';
import { RunGlyph } from './RunGlyph';
import { statePill, VERB_LABEL } from './vocab';
import './domain.css';

export type NbaPrimaryKind = NbaVerb | 'accept' | 'open_in_claude';

export interface NbaPrimaryEvent {
  kind: NbaPrimaryKind;
  label: string;
  item: WorkItem;
  nba: NbaCardVm | null;
  draft: Draft | null;
  run: AgentRun | null;
  /** start_in_claude / open_in_claude: the claude:// deep link from the contract. The parent opens it. */
  url: string | null;
  /** answer: the chosen chip or typed reply. */
  answer?: string;
}

export type NbaSecondaryKey = 'edit' | 'shorter' | 'snooze' | 'done' | 'resolve' | 'not_done' | 'merge';

export interface NbaCardProps {
  item: WorkItem;
  nba?: NbaCardVm | null;
  draft?: Draft | null;
  run?: AgentRun | null;
  proposals?: Proposal[];
  /** Defaults to item.rank. */
  rank?: number | null;
  /** Controlled expansion; omit to let the card manage it (defaultExpanded). */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** `triage` forces the dashed "Suggested" treatment (primary = Accept). */
  variant?: 'now' | 'triage';
  /** Collapsed cards show the draft's first line (UI-SPEC §4.3: from 1600 px up; the page decides). */
  draftLine?: boolean;
  /** Spine ↔ card hover link. */
  highlighted?: boolean;
  /** Override preview HTML (still sanitized). Default: derived from the serialized payload. */
  previewHtml?: string;
  /** v1 large start-by headline. v2 always shows the start-by as the badge; kept for compatibility. */
  headline?: boolean;
  now?: string;
  className?: string;

  /** v2: the selected card (j/k or click). Its one action is filled and its border turns accent. */
  selected?: boolean;
  /** v2: the #1 treatment (raised surface, accent top edge, 22 px title, filled action). Default: rank 1. */
  emphasis?: boolean;
  /** v2: the narrower "with panel" layout (smaller padding, no prep line, short effort note). */
  compact?: boolean;
  /** v2: the item is open in the docked panel; the panel footer holds the filled action. */
  inPanel?: boolean;
  /** v2: force the one action filled or quiet (default: filled when `selected` or `emphasis`). Pages pass
   *  `filled={false}` to #1 while another row holds the selection. */
  filled?: boolean;
  /** v2: the page knows the item is blocked (red badge + edge). */
  blocked?: boolean;
  /** v2: replaces the neutral tag's text (e.g. "Outbox" on an aggregate card). */
  tagLabel?: string;
  /** v2: extra content under the why line (prep checklist, a drafts list). Hidden in `compact` unless `extraInCompact`. */
  extra?: ReactNode;
  extraInCompact?: boolean;
  /** v2: replaces the foot's effort note (e.g. "Nothing sends until you approve"). */
  footNote?: ReactNode;
  /** v2: clamp the why line to this many lines (Home: 2 on the lead card, 1 on the others). Unset = the default (2 in compact). */
  whyLines?: 1 | 2 | 3;
  /** The snooze action's label (Home: "Move to Fri", where it wakes on the next working day). Default "Snooze". */
  snoozeLabel?: string;

  onPrimary?: (e: NbaPrimaryEvent) => void;
  onAlternative?: (alt: NbaAlternative, item: WorkItem) => void;
  onSecondary?: (key: NbaSecondaryKey, item: WorkItem) => void;
  onNotNow?: (reason: NotNowReason, item: WorkItem) => void;
  onOpenSource?: (source: SourceRef, item: WorkItem) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  /** Click / Enter → Details (docked panel), ⇧Enter → full page. */
  onOpen?: (item: WorkItem, mode: 'sheet' | 'page') => void;
  onApplyProposal?: (proposal: Proposal) => void;
  onKeepMine?: (proposal: Proposal) => void;
  /** Undo a reopen / loop-back label. */
  onUndoReopen?: (item: WorkItem) => void;
  onHover?: (itemId: string | null) => void;
}

const NOT_NOW: Array<{ reason: NotNowReason; label: string }> = [
  { reason: 'done_elsewhere', label: 'Done elsewhere' },
  { reason: 'not_mine', label: 'Not mine' },
  { reason: 'later', label: 'Later' },
  { reason: 'wrong_account', label: 'Wrong account' },
];

type Primary = { kind: NbaPrimaryKind; label: string; url: string | null } | null;

function primaryFor(item: WorkItem, nba: NbaCardVm | null, run: AgentRun | null, triage: boolean): Primary {
  if (triage || item.state === 'suggested') return { kind: 'accept', label: 'Accept', url: null };
  if (item.state === 'likely_done') return { kind: 'confirm_done', label: 'Confirm done', url: null };
  if (item.state === 'waiting_on_me' && run?.kind === 'claude_session') return { kind: 'open_in_claude', label: 'Open in Claude', url: run.deepLink };
  if (!nba) return { kind: 'review', label: 'Review', url: null };
  if (nba.confidence === 'guess' && nba.alternatives.length) return null;
  const url = nba.verb === 'start_in_claude' ? run?.deepLink ?? nba.claudeLaunch?.url ?? null : null;
  return { kind: nba.verb, label: nba.primaryLabel || VERB_LABEL[nba.verb], url };
}

function isInteractive(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest('button,a,input,textarea,select,label,[role="radio"],[role="tooltip"]');
}

/** Static classes so Tailwind sees them. */
const WHY_CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' } as const;

export function NbaCard(props: NbaCardProps) {
  const {
    snoozeLabel = 'Snooze',
    item,
    nba = null,
    draft = null,
    run = null,
    proposals = [],
    variant = 'now',
    draftLine = true,
    highlighted,
    previewHtml,
    className,
    selected = false,
    compact = false,
    inPanel = false,
    blocked = false,
    tagLabel,
    extra,
    extraInCompact,
    whyLines,
    footNote,
    onPrimary,
    onAlternative,
    onSecondary,
    onNotNow,
    onOpenSource,
    onOpenEntity,
    onOpen,
    onApplyProposal,
    onKeepMine,
    onUndoReopen,
    onHover,
  } = props;
  const { now, tz } = useClock({ now: props.now });
  const rank = props.rank === undefined ? item.rank : props.rank;
  const emphasis = props.emphasis ?? rank === 1;
  const [innerExpanded, setInnerExpanded] = useState(props.defaultExpanded ?? false);
  const expanded = props.expanded ?? innerExpanded;
  const setExpanded = (v: boolean) => {
    if (props.expanded === undefined) setInnerExpanded(v);
    props.onExpandedChange?.(v);
  };
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notNowOpen, setNotNowOpen] = useState(false);
  const [whyPinned, setWhyPinned] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [answer, setAnswer] = useState<string>('');
  const whyId = useId();

  const triage = variant === 'triage' || item.state === 'suggested';
  const primary = primaryFor(item, nba, run, triage);
  const alternatives = !primary && nba ? nba.alternatives.slice(0, expandedFor(props) ? 3 : 2) : [];
  const sources = useMemo(() => mergeSources(item.sources, nba?.sources), [item.sources, nba?.sources]);
  const openable = sources.find((s) => s.url) ?? null;
  const pill = statePill(item);
  const title = nba?.title ?? item.title;
  const waitingRun = item.state === 'waiting_on_me' && run?.state === 'waiting_on_you' ? run : null;
  const answerChoices = waitingRun && waitingRun.kind !== 'claude_session' ? waitingRun.waiting?.choices ?? [] : [];
  const isAnswer = primary?.kind === 'answer' || answerChoices.length > 0;
  const drafted = !!draft && !draft.userTouched;

  // Update strip (24 h): revised in place, or a proposal for a user-touched draft.
  const update = nba?.update && minutesBetween(nba.update.at, now) <= 24 * 60 ? nba.update : null;
  const draftProposal =
    proposals.find((p) => p.status === 'pending' && update?.proposalId && p.id === update.proposalId) ??
    (update?.kind === 'proposal' ? proposals.find((p) => p.status === 'pending' && p.entity.type === 'draft') : undefined);
  const fieldProposals = proposals.filter((p) => p.status === 'pending' && p !== draftProposal);

  const fire = (kind: NbaPrimaryKind, label: string, url: string | null, ans?: string) => onPrimary?.({ kind, label, item, nba, draft, run, url, answer: ans });
  const firePrimary = () => {
    if (!primary) return;
    if (isAnswer) {
      if (!answer.trim()) return;
      fire('answer', primary.label, null, answer.trim());
      return;
    }
    fire(primary.kind, primary.label, primary.url);
  };

  const secondaries: Array<{ key: NbaSecondaryKey | 'not_now'; label: string; kbd?: string }> = triage
    ? [
        { key: 'edit', label: 'Edit', kbd: 'e' },
        { key: 'merge', label: 'Merge', kbd: 'm' },
        { key: 'not_now', label: 'Dismiss', kbd: 'n' },
      ]
    : item.state === 'likely_done'
      ? [
          { key: 'not_done', label: 'Not done yet' },
          { key: 'snooze', label: snoozeLabel, kbd: 's' },
        ]
      : draft
        ? [
            { key: 'edit', label: 'Edit', kbd: 'e' },
            { key: 'shorter', label: 'Shorter' },
            { key: 'snooze', label: snoozeLabel, kbd: 's' },
            { key: 'not_now', label: 'Not now', kbd: 'n' },
          ]
        : alternatives.length
          ? [
              { key: 'snooze', label: snoozeLabel, kbd: 's' },
              { key: 'not_now', label: 'Not now', kbd: 'n' },
            ]
          : [
              { key: 'snooze', label: snoozeLabel, kbd: 's' },
              { key: 'done', label: 'Done', kbd: 'd' },
              { key: 'not_now', label: 'Not now', kbd: 'n' },
            ];

  const secondary = (key: NbaSecondaryKey | 'not_now') => {
    if (key === 'not_now') setNotNowOpen((v) => !v);
    else onSecondary?.(key, item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) {
      if (e.key === 'Escape') {
        setNotNowOpen(false);
        setWhyPinned(false);
        e.currentTarget.focus();
      }
      return;
    }
    const k = e.key;
    const mod = e.metaKey || e.ctrlKey;
    if (k === ' ') {
      e.preventDefault();
      if (!expanded) setExpanded(true);
      else setPreviewOpen((v) => !v);
    } else if (k === 'Enter' && mod) {
      e.preventDefault();
      firePrimary();
    } else if (k === 'Enter') {
      e.preventDefault();
      if (onOpen) onOpen(item, e.shiftKey ? 'page' : 'sheet');
      else setExpanded(!expanded);
    } else if (k === 'Escape') {
      setNotNowOpen(false);
      setWhyPinned(false);
    } else if (mod || e.altKey) {
      return;
    } else if (k === 'e') secondary('edit');
    else if (k === 's' && !triage) secondary('snooze');
    else if (k === 'n') secondary('not_now');
    else if (k === 'd' && !triage) secondary('done');
    else if (k === 'D' && !triage) secondary('resolve');
    else if (k === 'o' && openable) onOpenSource?.(openable, item);
    else if (k === '?') setWhyPinned((v) => !v);
    else if (k === 'a' && triage) fire('accept', 'Accept', null);
    else if (k === 'm' && triage) secondary('merge');
    else return;
    e.preventDefault();
  };

  const onCardClick = (e: MouseEvent<HTMLElement>) => {
    if (isInteractive(e.target)) return;
    if (onOpen) onOpen(item, 'sheet');
    else if (!expanded) setExpanded(true);
  };

  // ---- the one color signal -------------------------------------------------
  const ind = triage ? 'ai' : itemIndicator(item, now, { blocked, drafted });
  const late = ind === 'danger';
  const lead = item.startBy ? { at: item.startBy, word: 'Start by' } : item.due ? { at: item.due, word: 'Due' } : null;
  const leadLeft = lead ? minutesBetween(now, lead.at) : null;
  // One badge on the right of the top row. Late/blocked first, then a state pill, then a tight start-by,
  // then the AI mark. Calm timing moves to the foot as plain text.
  let badge: ReactNode = null;
  let timingInFoot = !!lead;
  if (blocked) badge = <StatusBadge tone="danger" icon="ban">Blocked</StatusBadge>;
  else if (lead && late && !item.isBackground) {
    badge = (
      <StatusBadge tone="danger" icon="clock" title={`${lead.word} ${dueLabel(lead.at, now, tz)} · late ${dur(-(leadLeft ?? 0))}`}>
        {lead.word} {dueLabel(lead.at, now, tz)}
      </StatusBadge>
    );
    timingInFoot = false;
  } else if (pill && item.state !== 'suggested') badge = <StatusBadge tone={TONE_TO_BADGE[pill.tone] as BadgeTone} dashed={pill.dashed}>{pill.label}</StatusBadge>;
  else if (item.startBy && !item.isBackground && leadLeft !== null && leadLeft <= 60) {
    badge = (
      <StatusBadge tone="warning" icon="clock" title={`Start by ${dueLabel(item.startBy, now, tz)} · in ${dur(leadLeft)}`}>
        Start by {dueLabel(item.startBy, now, tz)}
      </StatusBadge>
    );
    timingInFoot = false;
  } else if (triage) badge = <AiMark>Suggested</AiMark>;
  else if (drafted) badge = <AiMark>Draft ready</AiMark>;
  else if (run?.state === 'running') badge = <AiMark>Agent running</AiMark>;
  const footTiming = timingInFoot && lead ? (lead.word === 'Start by' && item.due ? { at: item.due, word: 'Due' } : lead) : null;

  // The one action is filled only for the selected or #1 card, and never while the panel holds it.
  const filled = (props.filled ?? (selected || emphasis)) && !inPanel && !triage;
  const acct = item.refs.account;
  const ini = item.refs.initiative;
  const tagText = tagLabel ?? acct?.label ?? ini?.label ?? (item.kind === 'training' ? 'Training' : item.refs.meeting?.label ?? null);
  const tagRef = tagLabel ? null : acct ?? ini ?? null;

  // ---- top row ------------------------------------------------------------
  const top = (
    <div className="flex min-w-0 items-center gap-2">
      {rank ? <span className={cn('min-w-3 shrink-0 text-caption font-bold tabular-nums', emphasis ? 'text-fg-heading' : 'text-faint')}>{rank}</span> : null}
      {tagText ? <AccountTag label={tagText} onOpen={tagRef && onOpenEntity ? () => onOpenEntity(tagRef) : undefined} /> : null}
      {item.stale ? <StaleMark reason={item.stale.reason} /> : null}
      {item.newEvidenceCount > 0 ? <NewDot count={item.newEvidenceCount} /> : null}
      <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{badge}</span>
    </div>
  );

  // ---- title + why ----------------------------------------------------------
  const titleCls = emphasis ? (compact ? 'text-lead' : 'text-title') : compact ? 'text-body-lg' : 'text-lead';
  const detail = item.whyDetail ?? nba?.whyDetail;
  const why = (
    <div className="group/why relative min-w-0">
      <p className={cn('max-w-[60ch] text-body text-muted', !expanded && (whyLines ? WHY_CLAMP[whyLines] : compact && 'line-clamp-2'), item.reevaluating && 'cc-reeval -mx-1 px-1')} aria-describedby={whyId}>
        {item.why}
        {item.reevaluating ? <span className="ml-1.5 whitespace-nowrap text-caption text-ai-700">re-evaluating…</span> : null}
      </p>
      <WhyPopover id={whyId} pinned={whyPinned} detail={detail} item={item} sources={sources} onOpenSource={onOpenSource ? (s) => onOpenSource(s, item) : undefined} />
    </div>
  );

  const purpose = item.purpose ? item.purpose.replace(/^For:\s*/i, '') : null;
  const prepLine = extra ?? (purpose || (ini && acct) ? (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-caption text-faint">
      {purpose ? <span className="min-w-0 truncate">For: {purpose}</span> : null}
      {ini && acct ? <span className="min-w-0 truncate">Initiative: {ini.label}</span> : null}
    </p>
  ) : null);

  // ---- status line (state-specific, persists) ------------------------------
  let statusLine: ReactNode = null;
  if (item.loopedBackIn || item.reopened) {
    statusLine = (
      <StatusLine tone="warn" icon="rotate">
        <span className="font-bold">{item.loopedBackIn ? 'Looped back in:' : 'Reopened:'}</span>{' '}
        {item.loopedBackIn ? `${item.loopedBackIn.byPersonName} asked you directly` : item.reopened!.reason.replace(/^Reopened:\s*/i, '')}
        {onUndoReopen ? (
          <button type="button" className="ml-1.5 font-bold text-link hover:underline" onClick={(e) => { e.stopPropagation(); onUndoReopen(item); }}>
            Undo
          </button>
        ) : null}
      </StatusLine>
    );
  } else if (item.state === 'likely_done' && item.likelyDone) {
    statusLine = (
      <StatusLine tone="ready" icon="check">
        <span className="font-bold">Looks done:</span> {looksDoneEvidence(item)}
      </StatusLine>
    );
  } else if (item.state === 'waiting_on_me' && (waitingRun || item.waiting)) {
    statusLine = (
      <StatusLine tone="warn" glyph={<RunGlyph state="waiting_on_you" size={14} />}>
        <span className="font-bold">{waitingRun?.kind === 'claude_session' ? 'Session asked:' : 'Waiting on you:'}</span> {waitingRun?.waiting?.question ?? item.waiting?.reason}
        {waitingRun?.waiting ? <span className="text-muted"> · {dur(minutesBetween(waitingRun.waiting.since, now))}</span> : null}
      </StatusLine>
    );
  } else if (item.stale) {
    statusLine = (
      <StatusLine tone="neutral" glyph={<span aria-hidden className="leading-none">☾</span>}>
        {item.stale.reason}
      </StatusLine>
    );
  }

  // ---- body block: draft · answer · plan -----------------------------------
  let block: ReactNode = null;
  if (draft) {
    block = <DraftPreviewBlock draft={draft} html={previewHtml} open={previewOpen} onToggle={() => setPreviewOpen((v) => !v)} />;
  } else if (answerChoices.length || (isAnswer && waitingRun)) {
    block = (
      <div className="rounded-md border border-line bg-surface-muted p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-caption font-bold text-fg-heading">Answer{waitingRun?.title ? ` · ${waitingRun.title}` : ''}</p>
        <div role="radiogroup" aria-label="Choices" className="mt-2 flex flex-wrap gap-2">
          {answerChoices.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={answer === c}
              onClick={() => setAnswer(answer === c ? '' : c)}
              className={cn('h-8 rounded-md border px-3 text-body', answer === c ? 'border-accent bg-selected font-bold text-fg-heading' : 'border-line-input bg-surface text-fg hover:bg-surface-muted')}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          value={answerChoices.includes(answer) ? '' : answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              firePrimary();
            }
          }}
          placeholder="Or type a reply…"
          aria-label="Reply"
          className="mt-2 h-9 w-full rounded-md border border-line-input bg-surface-input px-3 text-body placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>
    );
  } else if (nba && (nba.verb === 'start_in_claude' || nba.verb === 'run_tool' || run)) {
    block = <PlanBlock nba={nba} run={run} now={now} />;
  } else if (item.deliverable) {
    const d = item.deliverable;
    block = (
      <div className="rounded-md border border-line bg-surface p-3 text-caption">
        <div className="flex items-center gap-2">
          <Icon set="doctype" name={d.mimeKind === 'slides' ? 'gpres' : d.mimeKind === 'sheet' ? 'gsheet' : d.mimeKind === 'pdf' ? 'pdf' : 'gdoc'} size="md" />
          <span className="truncate font-bold text-fg">{d.fileName}</span>
          {d.lastEditedAt ? (
            <span className="text-muted">
              · edited {clock(d.lastEditedAt, tz)}
              {d.lastEditedBy ? ` by ${d.lastEditedBy}` : ''}
            </span>
          ) : null}
        </div>
        {d.judgment ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg">
            <StatusBadge tone={d.judgment.verdict === 'complete' ? 'success' : d.judgment.verdict === 'regressed' ? 'danger' : d.judgment.verdict === 'not_started' ? 'warning' : 'ai'}>
              {d.judgment.made} of {d.judgment.requested} updates made
            </StatusBadge>
            <span className="min-w-0">{d.judgment.summary.replace(/^\d+ of \d+ requested updates made[.;]?\s*/i, '') || (d.changedSinceCreated ? 'Changed since the item was created.' : 'No edits since the item was created.')}</span>
          </p>
        ) : d.diffSummary ? (
          <p className="mt-1.5 text-body text-fg">{d.diffSummary}</p>
        ) : null}
      </div>
    );
  }

  // ---- foot: effort · quiet secondaries · ONE action ---------------------------
  const quietSecondaries = (
    <span
      className={cn('items-center gap-0.5', expanded || selected ? 'flex' : 'hidden group-focus-within/card:flex group-hover/card:flex')}
      onClick={(e) => e.stopPropagation()}
      data-card-secondaries
    >
      {secondaries.map((s) => (
        <Button
          key={s.key}
          variant="ghost"
          size="sm"
          kbd={expanded && !compact ? s.kbd : undefined}
          title={s.kbd ? `${s.label} (${s.kbd})` : s.label}
          aria-pressed={s.key === 'not_now' ? notNowOpen : undefined}
          onClick={() => secondary(s.key)}
        >
          {s.label}
        </Button>
      ))}
      {/* Provenance: the origin source, icon only (the expanded card shows the labelled link instead) */}
      {!expanded && openable && onOpenSource ? (
        <button
          type="button"
          aria-label={openInLabel(openable.kind)}
          title={`${openInLabel(openable.kind)} (o)`}
          data-card-source={openable.kind}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpenSource(openable, item)}
          className="inline-grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Icon name="new_window" size="sm" />
        </button>
      ) : null}
    </span>
  );
  const oneAction = primary ? (
    <Button
      variant={filled ? 'primary' : inPanel ? 'ghost' : 'secondary'}
      size="md"
      kbd={filled && !compact ? 'mod+enter' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (isAnswer && !answer.trim() && !expanded) {
          setExpanded(true);
          return;
        }
        firePrimary();
      }}
      disabled={isAnswer && expanded && !answer.trim()}
      data-card-primary={filled ? 'filled' : 'quiet'}
      className="ml-auto"
    >
      {primary.label}
    </Button>
  ) : (
    <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {alternatives.map((alt) => (
        <Button key={alt.label} variant="secondary" size="sm" title={alt.reason} onClick={() => onAlternative?.(alt, item)}>
          {alt.label}
        </Button>
      ))}
    </span>
  );
  const foot = (
    <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pt-1">
      <span className="flex min-w-[9rem] flex-[1_1_auto] items-center gap-2 text-caption text-muted">
        {footNote ?? (
          <>
            {footTiming ? (
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {footTiming.word} {dueLabel(footTiming.at, now, tz)} <span className="text-faint">·</span>
              </span>
            ) : null}
            <EffortNote youMin={item.effort.youMin} agentMin={item.effort.agentMin} long={!compact} inline={!!footTiming} />
          </>
        )}
        {nba?.confidence === 'guess' ? <ConfidenceWord value="guess" /> : null}
      </span>
      {expanded && openable ? (
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-caption text-muted hover:bg-surface-muted hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSource?.(openable, item);
          }}
        >
          <Icon name="new_window" size="xs" />
          {SOURCE_LABEL[openable.kind]}
          <Kbd>o</Kbd>
        </button>
      ) : null}
      {quietSecondaries}
      {oneAction}
    </div>
  );

  const notNowRow = notNowOpen ? (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2" onClick={(e) => e.stopPropagation()} role="group" aria-label="Not now because">
      <span className="text-caption text-muted">{triage ? 'Dismiss because' : 'Not now because'}</span>
      {NOT_NOW.map((r) => (
        <button
          key={r.reason}
          type="button"
          onClick={() => {
            onNotNow?.(r.reason, item);
            setNotNowOpen(false);
          }}
          className="h-8 rounded-md border border-line bg-surface px-2.5 text-caption text-fg hover:border-line-strong hover:bg-surface-muted"
        >
          {r.label}
        </button>
      ))}
      <button type="button" className="ml-auto text-caption text-muted hover:text-fg" onClick={() => setNotNowOpen(false)}>
        Cancel <Kbd>Esc</Kbd>
      </button>
    </div>
  ) : null;

  // ---- update strip -------------------------------------------------------
  let strip: ReactNode = null;
  if (update && update.kind === 'proposal' && draftProposal) {
    strip = <ProposalDiff variant="strip" proposal={draftProposal} onApply={onApplyProposal} onKeepMine={onKeepMine} className="rounded-b-lg" />;
  } else if (update) {
    strip = (
      <div className="rounded-b-lg border-t border-line px-6 py-2 text-caption" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-ai-700">
            ✦
          </span>
          <span className="min-w-0 flex-1 text-fg">
            <span className="font-bold">Updated {clock(update.at, tz)}:</span> {update.reason}
            <span className="text-muted"> → {draft ? 'draft revised' : 'next step revised'}</span>
          </span>
          {update.diffSummary ? (
            <button type="button" className="inline-flex shrink-0 items-center gap-1 font-bold text-link hover:underline" aria-expanded={diffOpen} onClick={() => setDiffOpen((v) => !v)}>
              Diff <Icon name={diffOpen ? 'chevrondown' : 'chevronright'} size="xs" />
            </button>
          ) : null}
        </div>
        {diffOpen && update.diffSummary ? (
          <pre className="mt-1.5 whitespace-pre-wrap rounded-sm bg-surface-muted px-2 py-1 font-sans text-caption">
            {update.diffSummary.split('\n').map((l, i) => (
              <span key={i} className={cn('block', l.startsWith('+') ? 'text-success-700' : l.startsWith('-') ? 'text-danger-700 line-through' : 'text-muted')}>
                {l}
              </span>
            ))}
          </pre>
        ) : null}
      </div>
    );
  }

  // ---- collapsed one-liner --------------------------------------------------
  const collapsedLine = draft ? (
    <p data-draft-line className="flex min-w-0 items-center gap-1.5 text-caption text-muted">
      {draft.userTouched ? <Icon name="edit" size="xs" className="text-faint" /> : <span aria-hidden className="text-ai-700">✦</span>}
      <span className="shrink-0 font-bold text-fg">{draft.destination.kind === 'slack' ? 'Slack' : 'Gmail'} draft:</span>
      <span className="truncate">“{draft.plainText.replace(/\s*\n+\s*/g, ' ').trim()}”</span>
    </p>
  ) : run ? (
    <p data-draft-line className="flex min-w-0 items-center gap-1.5 text-caption text-muted">
      <RunGlyph state={run.state} size={14} />
      <span className="truncate">{run.lastEvent}</span>
    </p>
  ) : null;

  const edge = triage ? 'none' : emphasis || late ? (late ? 'danger' : ind === 'warning' ? 'now' : ind === 'none' ? 'now' : ind) : 'none';

  return (
    <article
      tabIndex={0}
      data-item-id={item.id}
      data-selected={selected || undefined}
      data-emphasis={emphasis || undefined}
      aria-current={selected || inPanel || undefined}
      aria-label={`${rank ? `${rank}. ` : ''}${title}`}
      onKeyDown={onKeyDown}
      onClick={onCardClick}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        'group/card @container relative flex w-full min-w-0 cursor-pointer flex-col rounded-lg border transition-[border-color,background-color,box-shadow] duration-100',
        'focus-visible:outline-none focus-visible:shadow-focus',
        triage ? 'border-dashed bg-surface' : emphasis ? RAISED_BG : 'bg-surface',
        selected || inPanel ? 'border-accent' : highlighted ? 'border-focus' : triage ? 'border-ai-200' : emphasis ? 'border-line-strong' : 'border-line hover:border-line-strong',
        !triage && EDGE_TOP[edge],
        className,
      )}
    >
      <div className={cn('flex min-w-0 flex-1 flex-col', compact ? 'gap-1.5 px-4 py-3' : 'gap-2 px-6 py-4')}>
        {top}
        <h3 className={cn('min-w-0 font-bold text-fg-heading', titleCls)}>{title}</h3>
        {why}
        {compact && !extraInCompact && !expanded ? null : prepLine}
        {expanded ? (
          <>
            {statusLine}
            {sources.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {sources.slice(0, 4).map((s) => (
                  <SourceChip key={`${s.kind}${s.label}`} source={s} onOpen={onOpenSource ? (src) => onOpenSource(src, item) : undefined} />
                ))}
                <button
                  type="button"
                  className="inline-flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-caption font-bold text-link hover:bg-surface-muted"
                  aria-expanded={whyPinned}
                  aria-controls={whyId}
                  onClick={(e) => {
                    e.stopPropagation();
                    setWhyPinned((v) => !v);
                  }}
                >
                  {sources.length > 4 ? `+${sources.length - 4} · why` : 'Why'}
                  <Icon name="chevronright" size="xs" />
                </button>
              </div>
            ) : null}
            {fieldProposals.map((p) => (
              <ProposalDiff key={p.id} proposal={p} variant="strip" className={cn('rounded-md border', compact ? '-mx-1' : '')} onApply={onApplyProposal} onKeepMine={onKeepMine} />
            ))}
            {block}
          </>
        ) : draftLine ? (
          collapsedLine
        ) : null}
        {foot}
        {notNowRow}
      </div>
      {expanded ? strip : null}
    </article>
  );
}

const SOURCE_LABEL: Record<SourceRef['kind'], string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  calendar: 'Calendar',
  drive: 'Drive',
  gemini: 'Notes',
  org62: 'Org62',
  vdp: 'VDP',
  claude: 'Claude',
  manual: 'Source',
};

/** Collapsed cards show at most two alternatives; the expanded card shows three. */
function expandedFor(p: NbaCardProps): boolean {
  return p.expanded ?? p.defaultExpanded ?? false;
}

/** "· 2 new": new evidence is information, not a call to act, so it stays neutral. */
function NewDot({ count }: { count: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted tabular-nums" title={`${count} new evidence`}>
      <span className="size-1.5 rounded-full bg-muted" />
      {count} new
    </span>
  );
}

function StatusLine({ tone, icon, glyph, children }: { tone: 'warn' | 'ai' | 'ready' | 'neutral'; icon?: string; glyph?: ReactNode; children: ReactNode }) {
  const mark = { warn: 'text-warning-700', ai: 'text-ai-700', ready: 'text-success-700', neutral: 'text-muted' }[tone];
  return (
    <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-1.5 text-caption">
      <span className={cn('mt-0.5 shrink-0', mark)}>{glyph ?? (icon ? <Icon name={icon} size="xs" /> : null)}</span>
      <span className="min-w-0 text-fg">{children}</span>
    </p>
  );
}

function WhyPopover({
  id,
  pinned,
  detail,
  item,
  sources,
  onOpenSource,
}: {
  id: string;
  pinned: boolean;
  detail: string | null | undefined;
  item: WorkItem;
  sources: SourceRef[];
  onOpenSource?: (s: SourceRef) => void;
}) {
  const reasons = [...item.rankReasons].sort((a, b) => b.contribution - a.contribution).slice(0, 4);
  const max = Math.max(1, ...reasons.map((r) => Math.abs(r.contribution)));
  return (
    <div
      id={id}
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute left-0 top-full z-30 mt-1 w-[min(32rem,100%)] cursor-default rounded-md border border-line bg-surface-overlay p-4 shadow-pop transition-[opacity,visibility] duration-100',
        pinned ? 'visible opacity-100' : 'invisible opacity-0 group-hover/why:visible group-hover/why:opacity-100 group-hover/why:delay-500',
      )}
    >
      {detail ? <p className="max-w-[68ch] text-body text-fg">{detail}</p> : <p className="text-body text-muted">{item.why}</p>}
      {reasons.length ? (
        <div className="mt-3">
          <p className="text-caption font-bold text-fg-heading">{item.rank ? `Why it's #${item.rank} for you` : 'Why it ranks'}</p>
          <ul className="mt-1.5 space-y-1">
            {reasons.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 text-caption">
                <span className="truncate text-fg">{r.label}</span>
                <span className="h-1.5 rounded-full bg-surface-sunken">
                  <span className={cn('block h-full rounded-full', r.contribution >= 0 ? 'bg-fg' : 'bg-faint')} style={{ width: `${(Math.abs(r.contribution) / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sources.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {sources.map((s) => (
            <SourceChip key={`${s.kind}${s.label}`} source={s} onOpen={onOpenSource} />
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-micro text-faint">
        <Kbd>?</Kbd> pins this · <Kbd>o</Kbd> opens the source
      </p>
    </div>
  );
}

function PlanBlock({ nba, run, now }: { nba: NbaCardVm; run: AgentRun | null; now: string }) {
  const kind = nba.verb === 'run_tool' ? toolName(nba.toolAdapterId) : run?.kind === 'tool_run' ? 'Tool run' : 'Claude session';
  const inputs = nba.toolInputs
    ? Object.entries(nba.toolInputs)
        .filter(([k, v]) => !/id$/i.test(k) && !(typeof v === 'string' && /^[a-z]+_[a-z0-9_]+$/.test(v)))
        .slice(0, 3)
    : [];
  const pct = run?.progress ? Math.round((run.progress.done / Math.max(1, run.progress.total)) * 100) : null;
  return (
    <div className="rounded-md border-agentic p-3">
      <div className="flex items-center gap-2">
        <AiMark>Plan</AiMark>
        <span className="text-caption text-muted">· {kind}</span>
        {nba.claudeLaunch ? <span className="ml-auto truncate font-mono text-micro text-faint">{nba.claudeLaunch.folder.replace(/^\/Users\/[^/]+/, '~')}</span> : null}
      </div>
      {nba.claudeLaunch ? <p className="mt-1 line-clamp-2 max-w-[68ch] text-body text-fg">{nba.claudeLaunch.promptPreview.replace(/\s*\[cc:[^\]]+\]/g, '')}</p> : null}
      {inputs.length ? (
        <dl className="mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 text-caption">
          {inputs.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="truncate text-fg">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!nba.claudeLaunch && !inputs.length ? <p className="mt-1 max-w-[68ch] text-body text-fg">{nba.why}</p> : null}
      {run ? (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-caption">
          <RunGlyph state={run.state} size={14} />
          <span className="font-bold text-fg">{run.state === 'running' ? 'Running in the background' : run.state.replace(/_/g, ' ')}</span>
          {run.startedAt ? <span className="text-muted tabular-nums">{dur(minutesBetween(run.startedAt, now))}</span> : null}
          <span className="min-w-0 flex-1 truncate text-muted">{run.lastEvent}</span>
          {pct !== null ? (
            <span className="h-1.5 w-16 shrink-0 rounded-full bg-surface-sunken" title={`${run.progress!.done}/${run.progress!.total}`}>
              <span className="block h-full rounded-full bg-ai-500" style={{ width: `${pct}%` }} />
            </span>
          ) : null}
          {run.bgAgents ? <span className="shrink-0 text-muted">+{run.bgAgents} background</span> : null}
        </div>
      ) : null}
    </div>
  );
}
