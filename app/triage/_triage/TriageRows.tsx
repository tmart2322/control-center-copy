'use client';
/**
 * Triage rows (design v2): every kind is a two-line LineRow with a dashed edge, because everything in
 * Triage is a guess until you confirm it (UI-SPEC §1.4). One verb per row, quiet until selected:
 *   looks done → Confirm (a) · Not done (n), both visible buttons · source (o)   (LD-1: green ✓ badge, the evidence as its why)
 *   still needed? → Keep (a) · Close (n), both visible buttons · edit (e) · merge (m) · source (o)   (DEEP-1: old asks)
 *   suggestion → Accept (a) · edit (e) · merge (m) · dismiss (n) · source (o)
 *   missed opp → Claim (a) · dismiss (n) · Space shows the evidence
 *   mapping    → its choices inline (1 2 …), never a filled default · not sure (n)
 *   closed for you → Open message (o) · Undo, or Reopen when there is nothing to undo   (SETTLE-1: a record, no Confirm)
 * Every row's hover / selected set carries its origin source ("Open in Slack", icon only, named for screen readers).
 * Click or Enter opens Details in the docked panel; ⇧Enter opens the item's page.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { SourceRef, TriageItem } from '@/contract';
import { hm, itemIndicator, openInLabel, originSource, StatusBadge, useClock } from '@/components/domain';
import { openDeepLink } from '@/components/detail/nba/ClaudeLaunchPanel';
import { dayDiff, wallParts } from '@/components/detail/lib/tz';
import { LineRow, type LineRowAction } from '@/components/lists/LineRow';
import { money } from '@/components/lists/triage-panels';
import { closedBadge } from '@/engines/home/closed';
import { fmtDay, Icon, Kbd } from '@/ui';

export interface TriageRowProps {
  item: TriageItem;
  rowProps: Record<string, unknown>;
  selected: boolean;
  emphasis: boolean;
  inPanel: boolean;
  expanded: boolean;
  onOpen: (mode: 'details' | 'page') => void;
  onAccept: () => void;
  onDismiss: () => void;
  onEdit: () => void;
  onMerge: () => void;
  onChoose: (choiceId: string, label: string) => void;
  /** SETTLE-1 (Closed for you): Undo the close (its audit id), else Reopen. */
  onUndo?: () => void;
  /** The inline editor (e), under the row. */
  editor?: ReactNode;
}

/** ROW-1: a mouse press on a row button must not move focus (the selected row redraws its buttons; the click is lost). */
const keepFocus = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();

/** The origin source as the row's icon action: "Open in Slack" (o), through the app's deep-link helper. */
function sourceAction(sources: SourceRef[] | undefined, k: string | undefined = 'o'): LineRowAction[] {
  const src = originSource(sources);
  return src ? [{ label: openInLabel(src.kind), k, icon: 'new_window', onClick: () => openDeepLink(src.url), testId: 'row-source' }] : [];
}

/** SETTLE-1: the message that settled a closed row: the cited one, else the item's origin source. */
export function closedMessageUrl(it: TriageItem): string | null {
  return it.workItem?.resolutionDetail?.settle?.sourceUrl ?? originSource(it.sources)?.url ?? null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday", "Mon Nov 3" in the profile zone: the Closed for you day headers. */
export function closedDayLabel(iso: string, now: string, tz?: string): string {
  const d = dayDiff(iso, now, tz);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  const w = wallParts(iso, tz);
  return `${WEEKDAYS[w.weekday]} ${MONTHS[w.m - 1]} ${w.d}`;
}

/** SETTLE-1: when a Closed for you row closed (its day header). */
export const closedAt = (it: TriageItem) => it.workItem?.doneAt ?? it.createdAt;

const CONFIDENCE: Record<string, string> = { sure: 'Sure', likely: 'Likely', guess: 'Guess' };

/** Confidence as a word, never a colour: the dashed edge already says "unconfirmed". */
function Confidence({ value }: { value: string }) {
  return (
    <span className={value === 'guess' ? 'underline decoration-dashed decoration-1 underline-offset-2' : undefined} title={value === 'guess' ? 'Weak evidence: check before accepting' : undefined}>
      {CONFIDENCE[value] ?? value}
    </span>
  );
}

export function TriageRow(p: TriageRowProps) {
  const { item } = p;
  if (item.kind === 'missed_opp') return <MissedOppRow {...p} />;
  if (item.kind === 'mapping') return <MappingRow {...p} />;
  if (item.group === 'looks_done') return <LooksDoneRow {...p} />;
  if (item.group === 'still_needed') return <StillNeededRow {...p} />;
  if (item.group === 'closed_for_you') return <ClosedRow {...p} />;
  return <SuggestionRow {...p} />;
}

/**
 * SETTLE-1: work the app closed for you. A record, not a guess: a solid neutral edge, the reason class as the one
 * badge (green ✓ for done or resolved, neutral for the rest), the plain reason and how long after the ask as the why.
 * Open message opens what settled it; Undo puts it back as it was (Reopen when there is no change set to undo).
 * No Confirm: it is already closed.
 */
function ClosedRow({ item, rowProps, selected, inPanel, onOpen, onUndo }: TriageRowProps) {
  const w = item.workItem!;
  const badge = closedBadge(w);
  const message = closedMessageUrl(item);
  const origin = originSource(w.sources);
  // the origin link only when it is not the message itself (Open message already opens that)
  const actions = origin && origin.url !== message ? sourceAction(w.sources, undefined) : [];
  const canUndo = !!item.undoAuditId;
  return (
    <LineRow
      rowId={item.id}
      data-kind="closed_for_you"
      {...rowProps}
      title={w.title}
      why={item.why}
      badge={
        <span data-testid="closed-badge" data-tone={badge.tone}>
          <StatusBadge tone={badge.tone} icon={badge.tone === 'success' ? 'check' : undefined}>
            {badge.label}
          </StatusBadge>
        </span>
      }
      meta={w.sources[0] ? <span className="min-w-0 truncate">{w.sources[0].label}</span> : null}
      edge="none"
      actions={actions}
      trailing={
        <>
          {message ? (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={() => openDeepLink(message)}
              title={`Open the message that settled it (o)${origin ? `: ${openInLabel(origin.kind).replace(/^Open in /, '')}` : ''}`}
              data-testid="closed-open-message"
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Icon name="new_window" size="xs" />
              Open message
            </button>
          ) : null}
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={onUndo}
            title={canUndo ? 'Undo the close: back to how it was (it will not be closed for you again)' : 'Reopen it as open work (it will not be closed for you again)'}
            data-testid={canUndo ? 'closed-undo' : 'closed-reopen'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-caption font-bold text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
          >
            {canUndo ? 'Undo' : 'Reopen'}
          </button>
        </>
      }
      selected={selected}
      inPanel={inPanel}
      onOpen={onOpen}
    />
  );
}

/**
 * DEEP-1: an ask that was already over 30 days old when it was found. Dashed (still a guess), its why says how old;
 * both answers are visible buttons (Keep a · Close n), one click either way. Keep makes it open work, Close resolves
 * it as not needed; both have Undo on the toast.
 */
function StillNeededRow({ item, rowProps, selected, emphasis, inPanel, onOpen, onAccept, onDismiss, onEdit, onMerge, editor }: TriageRowProps) {
  const w = item.workItem!;
  const src = w.sources[0];
  const actions: LineRowAction[] = [
    { label: 'Edit, then keep', k: 'e', icon: 'edit', onClick: onEdit, testId: 'triage-edit' },
    { label: 'Merge into an existing item', k: 'm', icon: 'merge', onClick: onMerge, testId: 'triage-merge' },
    ...sourceAction(w.sources),
  ];
  return (
    <>
      <LineRow
        rowId={item.id}
        data-kind="still_needed"
        {...rowProps}
        title={w.title}
        why={item.why}
        meta={
          <>
            {src ? <span className="min-w-0 truncate">{src.label}</span> : null}
            <span className="tabular-nums">you ~{hm(w.effort.youMin)}</span>
          </>
        }
        edge="none"
        dashed
        actions={actions}
        trailing={
          <>
            <button
              type="button"
              onClick={onDismiss}
              title="Not needed any more: close it (n; Undo on the toast)"
              data-testid="triage-close"
              className="inline-flex h-8 items-center rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onAccept}
              title="Still needed: make it open work (a; Undo on the toast)"
              data-testid="triage-keep"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-caption font-bold text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Kbd>a</Kbd> Keep
            </button>
          </>
        }
        selected={selected}
        emphasis={emphasis}
        inPanel={inPanel}
        onOpen={onOpen}
      />
      {editor}
    </>
  );
}

/**
 * LD-1: the engine thinks it is finished. Solid green edge (ready), the badge, the evidence; both answers are visible
 * buttons (Confirm a · Not done n), one click either way, like Home's band and Work's row.
 */
function LooksDoneRow({ item, rowProps, selected, inPanel, onOpen, onAccept, onDismiss }: TriageRowProps) {
  const w = item.workItem!;
  return (
    <LineRow
      rowId={item.id}
      data-kind="looks_done"
      {...rowProps}
      title={w.title}
      why={item.why}
      badge={
        <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-success-200 bg-success-50 px-2 text-caption font-bold text-success-700" data-testid="looks-done-badge">
          <span aria-hidden>✓</span>Looks done
        </span>
      }
      meta={w.sources[0] ? <span className="min-w-0 truncate">{w.sources[0].label}</span> : null}
      edge="success"
      actions={sourceAction(w.sources)}
      trailing={
        <>
          <button
            type="button"
            onClick={onDismiss}
            title="Not finished: back among the open work (n)"
            data-testid="triage-not-done"
            className="inline-flex h-8 items-center rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
          >
            Not done
          </button>
          <button
            type="button"
            onClick={onAccept}
            title="Close it as done (a; Undo on the toast)"
            data-testid="triage-confirm"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-success-200 bg-surface px-2.5 text-caption font-bold text-success-700 hover:bg-success-50 focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Kbd>a</Kbd>
            <span aria-hidden>✓</span> Confirm
          </button>
        </>
      }
      selected={selected}
      inPanel={inPanel}
      onOpen={onOpen}
    />
  );
}

function SuggestionRow({ item, rowProps, selected, emphasis, inPanel, onOpen, onAccept, onDismiss, onEdit, onMerge, editor }: TriageRowProps) {
  const { now } = useClock();
  const w = item.workItem!;
  const late = itemIndicator(w, now) === 'danger';
  const src = w.sources[0];
  const actions: LineRowAction[] = [
    { label: 'Edit, then accept', k: 'e', icon: 'edit', onClick: onEdit, testId: 'triage-edit' },
    { label: 'Merge into an existing item', k: 'm', icon: 'merge', onClick: onMerge, testId: 'triage-merge' },
    { label: 'Dismiss', k: 'n', icon: 'close', onClick: onDismiss, testId: 'triage-dismiss' },
    ...sourceAction(w.sources),
  ];
  return (
    <>
      <LineRow
        rowId={item.id}
        data-kind="work_item"
        {...rowProps}
        title={w.title}
        why={w.why}
        meta={
          <>
            <Confidence value={w.confidence} />
            {src ? <span className="min-w-0 truncate">{src.label}</span> : null}
            <span className="tabular-nums">you ~{hm(w.effort.youMin)}</span>
          </>
        }
        edge={late ? 'danger' : 'none'}
        dashed
        verb={{ label: 'Accept', kbd: 'a', onClick: onAccept, title: 'Make it a task (Undo on the toast)' }}
        actions={actions}
        selected={selected}
        emphasis={emphasis}
        inPanel={inPanel}
        onOpen={onOpen}
      />
      {editor}
    </>
  );
}

function MissedOppRow({ item, rowProps, selected, emphasis, inPanel, expanded, onOpen, onAccept, onDismiss }: TriageRowProps) {
  const m = item.missedOpp!;
  const amount = money(m.amount);
  return (
    <>
      <LineRow
        rowId={item.id}
        data-kind="missed_opp"
        {...rowProps}
        title={m.oppName}
        why={m.evidence.length ? m.evidence.join(' · ') : item.why}
        meta={
          <>
            <Confidence value={item.confidence} />
            <span className="min-w-0 truncate">{m.accountName}</span>
            {amount ? <span className="tabular-nums">{amount}</span> : null}
            {m.closeDate ? <span className="tabular-nums">closes {fmtDay(`${m.closeDate}T12:00:00Z`, 'UTC')}</span> : null}
          </>
        }
        dashed
        verb={{ label: m.verdict === 'claim' ? 'Claim' : 'Check, then claim', kbd: 'a', onClick: onAccept, title: 'Adds a DC request for your next logging canvas at 100% (edit it in Deals ▸ DCs; Undo on the toast)' }}
        actions={[{ label: 'Dismiss', k: 'n', icon: 'close', onClick: onDismiss, testId: 'triage-dismiss' }, ...sourceAction(item.sources)]}
        selected={selected}
        emphasis={emphasis}
        inPanel={inPanel}
        onOpen={onOpen}
      />
      {expanded ? (
        <div className="cc-row-more space-y-1.5" data-testid="row-expansion">
          <p className="text-caption text-muted">
            {m.stage}
            {m.otherDcs.length ? ` · other DCs on it: ${m.otherDcs.join(', ')}` : ''}
          </p>
          <ul className="space-y-1">
            {m.evidence.map((ev) => (
              <li key={ev} className="flex items-start gap-2">
                <Icon name="check" size="xs" className="mt-1.5 text-muted" />
                <span className="max-w-[68ch]">{ev}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function MappingRow({ item, rowProps, selected, inPanel, onOpen, onDismiss, onChoose }: TriageRowProps) {
  const q = item.mapping!;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= q.choices.length) {
      e.preventDefault();
      const c = q.choices[n - 1]!;
      onChoose(c.id, c.label);
    }
  };
  return (
    <LineRow
      rowId={item.id}
      data-kind="mapping"
      {...rowProps}
      onKeyDown={onKeyDown}
      title={q.question}
      why={
        <>
          About <span className="text-fg">{q.subject.label}</span> · {q.source.label}
        </>
      }
      whyTitle={`About ${q.subject.label} · ${q.source.label}`}
      dashed
      actions={sourceAction([q.source])}
      selected={selected}
      inPanel={inPanel}
      onOpen={onOpen}
      trailing={
        <>
          {q.choices.map((c, i) => (
            <button
              key={c.id}
              type="button"
              data-testid="mapping-choice"
              onClick={() => onChoose(c.id, c.label)}
              title={`Answer: ${c.label} (${i + 1})`}
              className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-caption font-bold text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Kbd>{i + 1}</Kbd>
              <span className="truncate">{c.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onDismiss}
            title="Not sure (n)"
            className="inline-flex h-8 items-center rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
          >
            Not sure
          </button>
        </>
      }
    />
  );
}
