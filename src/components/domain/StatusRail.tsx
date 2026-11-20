'use client';
/**
 * @deprecated Design v2 has no status rail: its lanes became Home's verb sections (`SectionColumn`) and the
 * Today agent's-plan pane. Kept compiling, restyled minimally (sentence case, neutral glyphs), until the
 * Today page lane drops it.
 *
 * StatusRail + RailLane (UI-SPEC §4.4, brief 08 §2.2). Each lane is an eyebrow with a count and its first
 * 1–2 entries; it expands in place, and "Open ›" goes to its page or sheet. Lane order is the contract's.
 * Only "Waiting on you" gets a count badge (it needs action); informational lanes show a plain number.
 *
 * Waiting on you: Claude sessions show the reason + Open in Claude (deep link passed up, never opened here);
 * app runs get inline answer chips or a one-line reply; Outbox approvals get Review.
 */
import type { RailAction, RailEntry, RailLane as RailLaneVm, RailLaneId, SourceRef } from '@/contract';
import { useState, type ReactNode } from 'react';
import { Button, cn, Icon, Kbd, TONE_DOT } from '@/ui';
import { SourceChip, useClock } from './lib';
import { age } from './lib/time';
import { RunGlyph } from './RunGlyph';

export interface RailCallbacks {
  /** Any entry action: open_in_claude (href = claude:// link), answer (choice / typed reply), approve, nudge, undo, reauth, open, review. */
  onEntryAction?: (lane: RailLaneVm, entry: RailEntry, action: RailAction, answer?: string) => void;
  onOpenEntry?: (lane: RailLaneVm, entry: RailEntry) => void;
  onOpenLane?: (lane: RailLaneVm) => void;
  onOpenEvidence?: (source: SourceRef, entry: RailEntry) => void;
}

export interface RailLaneProps extends RailCallbacks {
  lane: RailLaneVm;
  expanded?: boolean;
  onToggle?: (lane: RailLaneId, expanded: boolean) => void;
  /** Entries shown while collapsed (1–2). */
  peek?: number;
  now?: string;
}

const ACTIONABLE: ReadonlySet<RailLaneId> = new Set(['waiting_on_you']);

/** @deprecated No status rail in design v2; see `SectionColumn`. */
export function RailLane({ lane, expanded: controlled, onToggle, peek, onEntryAction, onOpenEntry, onOpenLane, onOpenEvidence, ...rest }: RailLaneProps) {
  const { now } = useClock({ now: rest.now });
  const [inner, setInner] = useState(false);
  const expanded = controlled ?? inner;
  const toggle = () => {
    if (controlled === undefined) setInner(!expanded);
    onToggle?.(lane.lane, !expanded);
  };
  const first = peek ?? (lane.lane === 'waiting_on_you' ? 2 : lane.lane === 'since_you_left' ? 0 : 1);
  const shown = expanded ? lane.entries : lane.entries.slice(0, first);
  const healthOk = lane.lane === 'health' && lane.count === 0;

  return (
    <section className="border-b border-line last:border-b-0" aria-label={lane.label}>
      <div className="flex h-8 items-center gap-2 px-3">
        <button type="button" onClick={toggle} aria-expanded={expanded} className="inline-flex min-w-0 shrink-0 items-center gap-1.5">
          <Icon name={expanded ? 'chevrondown' : 'chevronright'} size="xs" className="text-faint" />
          <span className="text-body font-bold text-fg-heading">{laneTitle(lane)}</span>
          {ACTIONABLE.has(lane.lane) && lane.count > 0 ? (
            <span className="text-caption font-bold text-link tabular-nums">{lane.count}</span>
          ) : lane.count > 0 && !healthOk && lane.lane !== 'since_you_left' ? (
            <span className="text-caption font-bold text-muted tabular-nums">{lane.count}</span>
          ) : null}
        </button>
        <button type="button" onClick={() => onOpenLane?.(lane)} className="min-w-0 flex-1 truncate text-right text-caption text-muted hover:text-fg hover:underline" title={lane.summary}>
          {healthOk ? (
            <span className="inline-flex items-center gap-1 text-success-700">
              <span className="size-1.5 rounded-full bg-success-500" /> {lane.summary}
            </span>
          ) : lane.lane === 'since_you_left' ? (
            <span className="font-bold text-link">{lane.summary} ›</span>
          ) : (
            lane.summary
          )}
        </button>
      </div>
      {shown.length ? (
        <ul className="pb-1.5">
          {shown.map((e, i) => (
            <RailEntryRow key={e.id} lane={lane} entry={e} now={now} firstUndo={lane.lane === 'closed_for_you' && i === 0} onEntryAction={onEntryAction} onOpenEntry={onOpenEntry} onOpenEvidence={onOpenEvidence} />
          ))}
        </ul>
      ) : null}
      {expanded && lane.href ? (
        <div className="flex items-center gap-3 px-3 pb-2 pl-[1.625rem] text-caption">
          {expanded ? (
            <button type="button" className="text-link hover:underline" onClick={() => onOpenLane?.(lane)}>
              Open ›
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function laneTitle(lane: RailLaneVm): string {
  return lane.label.charAt(0) + lane.label.slice(1).toLowerCase();
}

function EntryGlyph({ lane, entry }: { lane: RailLaneId; entry: RailEntry }) {
  if (lane === 'waiting_on_you') {
    if (entry.ref.type === 'draft') return <span aria-hidden className="text-caption text-ai-700">✦</span>;
    return <RunGlyph state="waiting_on_you" size={12} />;
  }
  if (lane === 'agents') return <RunGlyph state={entry.tone === 'ai' || entry.action?.kind === 'review' ? 'done_review' : entry.tone === 'risk' ? 'failed' : 'running'} size={12} />;
  if (lane === 'closed_for_you') return <Icon name="check" size="xs" className="text-success-700" />;
  if (lane === 'waiting_on_others') return <Icon name="away" size="xs" className="text-muted" />;
  if (lane === 'briefs') return <Icon name="summary" size="xs" className="text-faint" />;
  return <span className={cn('mt-1 block size-1.5 rounded-full', TONE_DOT[entry.tone])} />;
}

function RailEntryRow({
  lane,
  entry: e,
  now,
  firstUndo,
  onEntryAction,
  onOpenEntry,
  onOpenEvidence,
}: {
  lane: RailLaneVm;
  entry: RailEntry;
  now: string;
  firstUndo?: boolean;
  onEntryAction?: RailCallbacks['onEntryAction'];
  onOpenEntry?: RailCallbacks['onOpenEntry'];
  onOpenEvidence?: RailCallbacks['onOpenEvidence'];
}) {
  const [reply, setReply] = useState('');
  const a = e.action;
  const id = lane.lane;
  const showAge = e.at && (id === 'waiting_on_you' || id === 'waiting_on_others' || id === 'agents');
  const inlineAnswer = a?.kind === 'answer' && a.choices.length > 0;

  let action: ReactNode = null;
  if (a && !inlineAnswer) {
    if (a.kind === 'undo') {
      action = (
        <button type="button" className="inline-flex shrink-0 items-center gap-1 text-caption text-link hover:underline" onClick={() => onEntryAction?.(lane, e, a)}>
          Undo {firstUndo ? <Kbd>z</Kbd> : null}
        </button>
      );
    } else {
      action = (
        <Button size="xs" variant={a.kind === 'open_in_claude' || a.kind === 'reauth' ? 'secondary' : 'ghost'} className={a.kind === 'reauth' || a.kind === 'open_in_claude' ? '' : '-mr-1.5'} onClick={() => onEntryAction?.(lane, e, a)}>
          {a.label}
        </Button>
      );
    }
  }

  return (
    <li className="group/entry px-3 py-1">
      <div className="flex items-start gap-2">
        <span className="mt-1 flex w-3 shrink-0 justify-center">
          <EntryGlyph lane={id} entry={e} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onOpenEntry?.(lane, e)} className="min-w-0 flex-1 truncate text-left text-body text-fg hover:underline" title={e.title}>
              {e.title}
            </button>
            {showAge ? <span className="shrink-0 text-caption text-muted tabular-nums">{age(e.at!, now)}</span> : null}
            {action}
          </div>
          {e.detail ? <p className={cn('text-caption', id === 'waiting_on_you' ? 'text-fg' : 'text-muted', 'line-clamp-2')}>{e.detail}</p> : null}
          {e.evidence ? (
            <div className="mt-0.5">
              <SourceChip source={e.evidence} className="h-5" onOpen={onOpenEvidence ? (s) => onOpenEvidence(s, e) : undefined} />
            </div>
          ) : null}
          {inlineAnswer ? (
            <div className="mt-1 space-y-1">
              <div className="flex flex-wrap gap-1">
                {a!.choices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onEntryAction?.(lane, e, a!, c)}
                    className="h-7 rounded-md border border-line-input bg-surface px-2.5 text-caption text-fg hover:border-accent hover:bg-selected"
                  >
                    {c}
                  </button>
                ))}
              </div>
              <form
                className="flex items-center gap-1"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  if (reply.trim()) {
                    onEntryAction?.(lane, e, a!, reply.trim());
                    setReply('');
                  }
                }}
              >
                <input
                  value={reply}
                  onChange={(ev) => setReply(ev.target.value)}
                  placeholder="Or reply in one line…"
                  aria-label={`Reply to ${e.title}`}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line-input bg-surface px-2 text-caption placeholder:text-faint focus:border-accent focus:outline-none"
                />
                <Button size="xs" variant="ghost" type="submit" disabled={!reply.trim()}>
                  Send
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export interface StatusRailProps extends RailCallbacks {
  lanes: RailLaneVm[];
  /** Controlled expansion per lane. */
  expanded?: Partial<Record<RailLaneId, boolean>>;
  onToggleLane?: (lane: RailLaneId, expanded: boolean) => void;
  /** Header slot (e.g. the [Status] ⇄ [Chat] tabs below 1920 px). */
  header?: ReactNode;
  /** Footer slot: the always-visible ask bar (FE-1d). */
  footer?: ReactNode;
  now?: string;
  className?: string;
}

/** @deprecated No status rail in design v2; see `SectionColumn`. */
export function StatusRail({ lanes, expanded, onToggleLane, header, footer, className, now, ...cb }: StatusRailProps) {
  const visible = lanes.filter((l) => l.visible);
  return (
    <aside className={cn('flex min-h-0 flex-col rounded-lg border border-line bg-surface', className)} aria-label="Status">
      {header ? <div className="shrink-0 border-b border-line">{header}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length ? (
          visible.map((l) => <RailLane key={l.lane} lane={l} now={now} expanded={expanded?.[l.lane]} onToggle={onToggleLane} {...cb} />)
        ) : (
          <p className="px-3 py-6 text-center text-body text-muted">All clear. Nothing is waiting on you.</p>
        )}
      </div>
      {footer ? <div className="shrink-0 border-t border-line p-2">{footer}</div> : null}
    </aside>
  );
}
