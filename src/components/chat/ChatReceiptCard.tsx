'use client';
/**
 * Receipt (v2 mockup "Applied 2 changes · Undo z"): every change chat made, before → after, grouped by
 * the item it touched (R-UI-18, UI-SPEC §6). One Undo in the header reverts the whole receipt; when it
 * holds several change sets, each set also gets its own quiet Undo. A line says "Undone" only once the
 * server has reverted it. ⌘Z on the focused card undoes the focused set, or everything still live.
 *
 * Props mirror FE-1b's ReceiptCard (`changes[{label, before, after, auditId}]`, `onUndo`, `onUndoAll`).
 */
import type { KeyboardEvent } from 'react';
import type { Receipt, ReceiptFailure } from '@/contract';
import { auditIdsForUndoAll, undoStateOf, type UndoState } from '@/client/chat';
import { AppLink } from '@/components/shell/AppLink';
import { Button } from '@/ui';
import { appliedHead, FailedLines, useReveal } from './card-parts';
import { fmtTime, receiptLines, sortReceiptLines } from './format';
import { groupByEntity, withPersistedUndo } from './thread-model';
import { useChatUi } from './ui-context';
import s from './assistant.module.css';

export interface ReceiptCardChange {
  label: string;
  before: string;
  after: string;
  auditId: string;
  entityLabel?: string;
  entityHref?: string;
  key?: string;
}

export interface ChatReceiptCardProps {
  title: string;
  at?: string;
  changes: ReceiptCardChange[];
  onUndo: (auditId: string) => void;
  onUndoAll: () => void;
  undoState?: (auditId: string) => UndoState;
  timeZone?: string;
  /** Collapse after this many lines ("Show n more"). */
  maxLines?: number;
  /** Apply landed the rest: the changes that did not, each with why. */
  failed?: ReceiptFailure[];
  /** How many changes the card held (with `failed`: "Applied 54 of 55"). */
  total?: number;
  className?: string;
}

const IDLE: UndoState = { status: 'idle' };

/** Several change sets that are not all the same kind of change (the field each line changes). */
export function setsDiffer(changes: ReadonlyArray<Pick<ReceiptCardChange, 'auditId' | 'label'>>): boolean {
  const sets = new Map<string, string>();
  for (const c of changes) sets.set(c.auditId, [sets.get(c.auditId), c.label].filter(Boolean).join('|'));
  if (sets.size < 2) return false;
  const kinds = new Set([...sets.values()].map((v) => [...new Set(v.split('|'))].sort().join('|')));
  return kinds.size > 1;
}

export function ChatReceiptCard({ title, at, changes, onUndo, onUndoAll, undoState = () => IDLE, timeZone, maxLines = 5, failed, total, className = '' }: ChatReceiptCardProps) {
  const reveal = useReveal(changes.length, maxLines);
  const groups = [...new Set(changes.map((c) => c.auditId))];
  const states = changes.map((c) => undoState(c.auditId).status);
  const undone = states.filter((x) => x === 'undone').length;
  const pending = states.some((x) => x === 'pending');
  const allUndone = changes.length > 0 && undone === changes.length;
  const liveGroups = groups.filter((id) => undoState(id).status !== 'undone');
  // 2026-11-13 audit C8: one Undo per change set only when the sets differ (54 DC claims are one kind of change: the
  // header's Undo all reverts them, not 54 "Undo this" buttons)
  const perSet = setsDiffer(changes);
  const shown = changes.slice(0, reveal.shown);
  const errors = [...new Set(groups.map((id) => undoState(id)).filter((u) => u.status === 'error').map((u) => u.message ?? 'Couldn’t undo.'))];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    e.stopPropagation();
    const line = (e.target as HTMLElement).closest<HTMLElement>('[data-audit-id]');
    if (line?.dataset.auditId) onUndo(line.dataset.auditId);
    else onUndoAll();
  };

  const applied = failed?.length ? appliedHead(changes.length, failed, total) : null;
  const head = allUndone ? 'Undone · nothing changed' : undone ? `${undone} of ${changes.length} undone` : applied ? applied.text : title;
  // One Undo per change set, on the first line of that set.
  const setLead = new Map<string, ReceiptCardChange>();
  for (const c of shown) if (!setLead.has(c.auditId)) setLead.set(c.auditId, c);
  const groups2 = groupByEntity(shown.map((c, i) => ({ c, what: i === 0 || c.entityLabel !== shown[i - 1].entityLabel ? (c.entityLabel ?? null) : null })));
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Changes: ${title}`}
      onKeyDown={onKeyDown}
      data-receipt
      data-receipt-undone={allUndone ? 'all' : undone ? 'some' : 'none'}
      className={`${s.card} ${allUndone ? s.settled : ''} ${className}`}
    >
      <header className={s.rcHead}>
        <span className={allUndone ? undefined : s.ok} aria-hidden>
          {allUndone ? '↶' : '✓'}
        </span>
        <b>{head}</b>
        {applied?.warn && !allUndone && !undone ? <span className={s.warn}>· {applied.warn}</span> : null}
        {at ? <span className={s.t}>{fmtTime(at, timeZone)}</span> : null}
        {liveGroups.length ? (
          <Button variant="ghost" size="sm" kbd="z" onClick={onUndoAll} loading={pending} data-undo-all>
            {liveGroups.length > 1 ? 'Undo all' : 'Undo'}
          </Button>
        ) : (
          <span />
        )}
      </header>
      {allUndone ? <p className={s.note}>{title}</p> : null}
      {!allUndone ? (
        <ol className={`${s.diff} ${s.done} ${reveal.scroll ? s.scroll : ''}`}>
          {groups2.map((g) => {
            const lead = g.rows[0].c;
            const allRowsUndone = g.rows.every((r) => undoState(r.c.auditId).status === 'undone');
            return (
              <li key={lead.key ?? `${lead.auditId}:${lead.label}`} data-audit-id={lead.auditId} data-undo-status={undoState(lead.auditId).status} className={allRowsUndone ? s.undone : undefined}>
                {g.what ? (
                  lead.entityHref ? (
                    <AppLink href={lead.entityHref} className={s.what}>
                      {g.what}
                    </AppLink>
                  ) : (
                    <span className={s.what}>{g.what}</span>
                  )
                ) : null}
                <span className={s.chgs}>
                  {g.rows.map(({ c }) => {
                    // a new value or an addition (nothing before) reads as the value alone, not "— → value"
                    const addOnly = c.before === '—';
                    return (
                      <span key={c.key ?? `${c.auditId}:${c.label}`} className={s.chg} data-audit-id={c.auditId}>
                        <span className={s.fld}>{c.label}</span>
                        <span className={s.val}>
                          {addOnly ? null : (
                            <>
                              <span className={s.b}>{c.before}</span>
                              <span className={s.arr} aria-label="to">
                                →
                              </span>
                            </>
                          )}
                          <span className={s.a}>{c.after}</span>
                        </span>
                      </span>
                    );
                  })}
                </span>
                {perSet
                  ? g.rows
                      .filter(({ c }) => setLead.get(c.auditId) === c)
                      .map(({ c }) => {
                        const st = undoState(c.auditId);
                        return (
                          <span key={`undo:${c.auditId}`} className={s.lineAct}>
                            {st.status === 'undone' ? (
                              <span className={s.note}>Undone</span>
                            ) : (
                              <Button variant="ghost" size="xs" onClick={() => onUndo(c.auditId)} loading={st.status === 'pending'} title="Undo this change" data-undo>
                                {st.status === 'error' ? 'Retry undo' : 'Undo this'}
                              </Button>
                            )}
                          </span>
                        );
                      })
                  : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {!allUndone ? reveal.control : null}
      {!allUndone ? <FailedLines failed={failed} /> : null}
      {errors.map((m) => (
        <p key={m} className={s.err} role="alert">
          {m}
        </p>
      ))}
    </div>
  );
}

/** A streamed Receipt, wired to the chat's undo state (persisted `undoneAt` lines read as undone). */
export function ReceiptPart({ receipt }: { receipt: Receipt }) {
  const ui = useChatUi();
  const actions = withPersistedUndo(receipt, ui.actions);
  const lines = sortReceiptLines(receiptLines(receipt.changes, ui.timeZone));
  return (
    <ChatReceiptCard
      title={receipt.summary}
      at={receipt.at}
      changes={lines}
      timeZone={ui.timeZone}
      undoState={(id) => undoStateOf(actions, id)}
      onUndo={(id) => ui.undo([id])}
      onUndoAll={() => ui.undo(auditIdsForUndoAll(receipt, actions))}
      {...(receipt.failed?.length ? { failed: receipt.failed, total: receipt.total } : {})}
    />
  );
}
