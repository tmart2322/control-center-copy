'use client';
/**
 * A proposed change (v2 mockup "Proposed change"): the agentic gradient border means the AI proposed it.
 * A before → after diff, then Apply ⌘↵ (the one primary) or Discard. Nothing changes until you apply
 * (UI-SPEC §6, R-UI-18). Once applied it turns into a receipt in place: "Applied 2 changes · Undo z".
 * Undo goes through the apply's audit id; an undone or discarded card settles quietly.
 */
import type { Proposal, Receipt } from '@/contract';
import { auditIdsForUndoAll, proposalStateOf, undoStateOf, type ProposalState, type UndoState } from '@/client/chat';
import { Button } from '@/ui';
import { appliedHead, FailedLines, useReveal } from './card-parts';
import { fieldLabel, fmtTime, formatChange, receiptLines, sortReceiptLines } from './format';
import { groupByEntity, withPersistedUndo } from './thread-model';
import { useChatUi } from './ui-context';
import s from './assistant.module.css';

export interface ChatProposalCardProps {
  proposal: Proposal;
  summary?: string | null;
  state: ProposalState;
  /** Undo state of the apply (by its audit id). */
  undo?: UndoState;
  onApply: () => void;
  onDismiss: () => void;
  onUndo: () => void;
  timeZone?: string;
  previewLines?: number;
}

const ENTITY_WORD: Record<string, string> = { policy: 'Priority policy', settings: 'Settings' };

interface Line {
  key: string;
  what: string | null;
  label: string;
  before: string;
  after: string;
}

export function ChatProposalCard({ proposal, summary, state, undo, onApply, onDismiss, onUndo, timeZone, previewLines = 5 }: ChatProposalCardProps) {
  const applied = state.status === 'applied';
  const undone = applied && undo?.status === 'undone';
  const dismissed = state.status === 'dismissed';
  const busy = state.status === 'applying' || state.status === 'dismissing';
  const entityWord = ENTITY_WORD[proposal.entity.type] ?? proposal.entity.label;

  // Pending: the proposal's own field diff. Applied: the receipt (it can include knock-on re-ranks).
  const receipt = applied && state.receipt?.changes.length ? sortReceiptLines(receiptLines(state.receipt.changes, timeZone)) : null;
  let lastWhat: string | null = null;
  const lines: Line[] = receipt
    ? receipt.map((l) => {
        const what = l.entityLabel !== lastWhat ? l.entityLabel : null;
        lastWhat = l.entityLabel;
        return { key: l.key, what, label: l.label, before: l.before, after: l.after };
      })
    : // a card of many things (chat_thread: "40 changes from chat") has no one heading: each line names its own thing
      proposal.changes.map((c, i) => ({ key: `${c.field}:${i}`, what: i === 0 && proposal.entity.type !== 'chat_thread' ? entityWord : null, label: fieldLabel(c.field, c.label), ...formatChange(c, timeZone) }));
  const reveal = useReveal(lines.length, previewLines);
  const shown = lines.slice(0, reveal.shown);
  const count = lines.length;
  const title = summary ?? proposal.reason;

  const list = (
    <ol className={`${s.diff} ${applied ? s.done : ''} ${reveal.scroll ? s.scroll : ''}`} data-lines={count}>
      {groupByEntity(shown).map((g) => (
        <li key={g.rows[0].key} className={undone ? s.undone : undefined}>
          {g.what ? <span className={s.what}>{g.what}</span> : null}
          <span className={s.chgs}>
            {g.rows.map((l) => (
              <span key={l.key} className={s.chg}>
                <span className={s.fld}>{l.label}</span>
                <span className={s.val}>
                  {/* a new value (nothing before) reads as the value alone, not "— → value" */}
                  {l.before === '—' ? null : (
                    <>
                      <span className={s.b}>{l.before}</span>
                      <span className={s.arr} aria-label="to">
                        →
                      </span>
                    </>
                  )}
                  <span className={s.a}>{l.after}</span>
                </span>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
  const toggleMore = reveal.control;

  if (dismissed || undone) {
    return (
      <div className={`${s.card} ${s.settled}`} data-proposal={proposal.id} data-proposal-status={undone ? 'undone' : 'dismissed'}>
        <header className={s.cardHead}>
          <span>{undone ? 'Undone · nothing changed' : 'Discarded · nothing changed'}</span>
          {applied && state.receipt?.at ? <span className={s.r}>{fmtTime(state.receipt.at, timeZone)}</span> : null}
        </header>
        <p className={s.note}>{title}</p>
      </div>
    );
  }

  if (applied) {
    const head = appliedHead(count, state.receipt?.failed, state.receipt?.total);
    return (
      <div className={s.card} tabIndex={-1} data-proposal={proposal.id} data-proposal-status="applied" data-receipt data-failed-count={state.receipt?.failed?.length ?? 0}>
        <header className={s.rcHead}>
          <span className={s.ok} aria-hidden>
            ✓
          </span>
          {/* a card read back after a reload has no receipt of its own here: the receipt card under it says what landed */}
          <b>{state.receipt ? head.text : 'Applied'}</b>
          {head.warn ? <span className={s.warn}>· {head.warn}</span> : null}
          {state.receipt?.at ? <span className={s.t}>{fmtTime(state.receipt.at, timeZone)}</span> : null}
          {state.auditId ? (
            <Button variant="ghost" size="sm" kbd="z" onClick={onUndo} loading={undo?.status === 'pending'} data-undo>
              {undo?.status === 'error' ? 'Retry undo' : 'Undo'}
            </Button>
          ) : (
            <span />
          )}
        </header>
        {list}
        {toggleMore}
        <FailedLines failed={state.receipt?.failed} />
        {/* with failures, the head and the Not applied list say it all (the summary repeats them for the model) */}
        {state.receipt?.summary && !state.receipt.failed?.length ? <p className={s.note}>{state.receipt.summary}</p> : null}
        {undo?.status === 'error' && undo.message ? (
          <p className={s.err} role="alert">
            {undo.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${s.card} ${s.agentic}`} tabIndex={-1} data-proposal={proposal.id} data-proposal-status={state.status}>
      <header className={s.cardHead}>
        <span className={s.aiMark}>Proposed change</span>
        <span>
          {count} change{count === 1 ? '' : 's'}
        </span>
      </header>
      <div className={s.cardTitle}>{title}</div>
      {list}
      {toggleMore}
      {proposal.reason && summary && proposal.actor !== 'chat' ? <p className={s.note}>{proposal.reason}</p> : null}
      {state.status === 'error' && state.message ? (
        <p className={s.err} role="alert">
          {state.message}
        </p>
      ) : null}
      <div className={s.acts}>
        <Button variant="primary" size="sm" kbd="mod+enter" onClick={onApply} loading={state.status === 'applying'} disabled={busy} data-apply data-primary>
          {state.status === 'error' ? 'Retry apply' : 'Apply'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy} data-discard>
          Discard
        </Button>
      </div>
      <p className={s.note}>Nothing changes until you apply. Undo anytime.</p>
    </div>
  );
}

export function ProposalPart({ proposal, summary, receipt }: { proposal: Proposal; summary: string | null; receipt?: Receipt }) {
  const ui = useChatUi();
  const local = proposalStateOf(ui.actions, proposal);
  // 2026-11-13 audit C8: after a reload the card shows its stored receipt in place (one card: its counts, failures and
  // Undo), never the bare "Applied" card plus a second receipt card under it
  const stored = local.status === 'applied' && !local.receipt && receipt ? receipt : null;
  const state: ProposalState = stored ? { ...local, receipt: stored } : local;
  const actions = stored ? withPersistedUndo(stored, ui.actions) : ui.actions;
  // A card of many route calls lands as many change sets: Undo reverts every one that landed (Undo all)
  const ids = state.receipt?.changes.length ? [...new Set(state.receipt.changes.map((c) => c.auditId))] : state.auditId ? [state.auditId] : [];
  const undo = undoOfAll(ids.map((id) => undoStateOf(actions, id)));
  return (
    <ChatProposalCard
      proposal={proposal}
      summary={summary}
      state={stored ? { ...state, auditId: state.auditId ?? ids[0] ?? null } : state}
      undo={undo}
      timeZone={ui.timeZone}
      onApply={() => ui.apply(proposal)}
      onDismiss={() => ui.dismiss(proposal)}
      onUndo={() => ids.length && ui.undo(state.receipt ? auditIdsForUndoAll(state.receipt, actions) : ids)}
    />
  );
}

/** One undo state for several change sets: undone when every one is, pending while any is, else the first error. */
function undoOfAll(states: UndoState[]): UndoState | undefined {
  if (!states.length) return undefined;
  if (states.every((u) => u.status === 'undone')) return { status: 'undone' };
  if (states.some((u) => u.status === 'pending')) return { status: 'pending' };
  return states.find((u) => u.status === 'error') ?? { status: 'idle' };
}
