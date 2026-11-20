'use client';
/**
 * ReceiptCard: chat or engine changes as before → after rows, with per-line Undo and Undo all (UI-SPEC
 * §5.3, §6, R-UI-18). DESIGN-V2: the agent's work wears the agentic gradient border and one ✦; each line
 * reads like the Today mockup's plan diff (a mark, the change, a quiet Undo). A staged receipt (more than
 * five changes, or the agent's day plan) is a preview awaiting Apply: the only filled button.
 */
import type { Actor, EntityRef, Receipt, ReceiptChange } from '@/contract';
import { Button, cn } from '@/ui';
import { useClock } from './lib';
import { clock } from './lib/time';
import { fmtValue } from './format';

const ACTOR: Record<Actor, string> = {
  user: 'You',
  engine: 'Engine',
  chat: 'Assistant',
  connector: 'Connector',
  system: 'System',
  scenario: 'Scenario',
};

export interface ReceiptCardProps {
  receipt: Receipt;
  /** auditIds already undone (rendered struck with "Redo"/"Undone"). */
  undone?: readonly string[];
  onUndo?: (change: ReceiptChange) => void;
  onUndoAll?: (receipt: Receipt) => void;
  /** Staged receipts: apply the previewed changes. */
  onApply?: (receipt: Receipt) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  className?: string;
  /** v2: header title override (e.g. "Agent's plan"). */
  title?: string;
  /** v2: drop the card chrome (inside a pane that already has the agentic border). */
  bare?: boolean;
}

type Mark = { glyph: string; word: string };

/** + added · − removed · ↑ / ↓ rank moves · ↓ deferred / snoozed · → anything else. */
function markFor(c: ReceiptChange): Mark {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(c.before) && !empty(c.after)) return { glyph: '+', word: 'Added' };
  if (!empty(c.before) && empty(c.after)) return { glyph: '−', word: 'Removed' };
  if (c.field === 'rank' && typeof c.before === 'number' && typeof c.after === 'number') return c.after < c.before ? { glyph: '↑', word: 'Moved up' } : { glyph: '↓', word: 'Moved down' };
  if (c.field === 'state' && (c.after === 'snoozed' || c.after === 'dismissed')) return { glyph: '↓', word: c.after === 'snoozed' ? 'Deferred' : 'Dismissed' };
  return { glyph: '→', word: 'Changed' };
}

export function ReceiptCard({ receipt, undone = [], onUndo, onUndoAll, onApply, onOpenEntity, className, title, bare }: ReceiptCardProps) {
  const { now, tz } = useClock();
  const all = receipt.changes.length > 0 && receipt.changes.every((c) => undone.includes(c.auditId) || !!c.undoneAt);
  const ai = receipt.actor === 'chat' || receipt.actor === 'engine';
  const n = receipt.changes.length;
  const counts = receipt.changes.reduce<Record<string, number>>((acc, c) => {
    const w = markFor(c).word.replace(/ (up|down)$/, '');
    acc[w] = (acc[w] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <section
      className={cn('min-w-0', bare ? '' : cn('rounded-lg p-5', ai ? 'border-agentic' : 'border border-line bg-surface'), className)}
      aria-label={title ?? 'Receipt'}
    >
      <div className="flex items-center gap-2">
        {ai ? (
          <span aria-hidden className="text-body-lg text-ai-700">
            ✦
          </span>
        ) : null}
        <h3 className="min-w-0 truncate text-body-lg font-bold text-fg-heading">{title ?? (receipt.staged ? 'Proposed changes' : `${ACTOR[receipt.actor]} changed ${n} thing${n === 1 ? '' : 's'}`)}</h3>
        {receipt.staged && onApply ? (
          <Button variant="secondary" size="sm" kbd="shift+a" onClick={() => onApply(receipt)} className="ml-auto" title={`Apply ${n} change${n === 1 ? '' : 's'}`}>
            Accept all
          </Button>
        ) : (
          <span className="ml-auto shrink-0 text-caption text-muted tabular-nums">{clock(receipt.at, tz)}</span>
        )}
      </div>
      <p className="mt-1 text-caption text-muted">
        {receipt.staged ? `Proposed ${clock(receipt.at, tz)} · nothing applied yet` : receipt.summary}
      </p>
      {receipt.staged ? (
        <>
          <p className="mt-2 text-body text-fg">{receipt.summary}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body text-muted">
            {Object.entries(counts).map(([w, k]) => (
              <span key={w}>
                <b className="text-body-lg font-bold text-fg-heading tabular-nums">{w === 'Added' ? `+${k}` : k}</b> {w.toLowerCase()}
              </span>
            ))}
          </p>
        </>
      ) : null}
      <ol className="mt-3">
        {receipt.changes.map((c) => {
          const isUndone = undone.includes(c.auditId) || !!c.undoneAt;
          const m = markFor(c);
          return (
            <li key={c.auditId} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 border-t border-line py-3">
              <span aria-label={m.word} className="row-span-2 grid size-7 place-items-center rounded-sm border border-line bg-surface-sunken text-body font-bold text-fg-heading">
                {m.glyph}
              </span>
              <button
                type="button"
                onClick={() => onOpenEntity?.(c.entity)}
                className={cn('min-w-0 truncate text-left text-body font-bold hover:underline hover:underline-offset-2', isUndone ? 'text-muted line-through opacity-70' : 'text-fg-heading')}
                title={c.entity.label}
              >
                {c.entity.label}
              </button>
              {receipt.staged && !onUndo ? (
                <span />
              ) : isUndone ? (
                <span className="row-span-2 text-caption text-muted">Undone</span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => onUndo?.(c)} className="row-span-2 -mt-1">
                  Undo
                </Button>
              )}
              <p className={cn('col-start-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-caption text-fg tabular-nums', isUndone && 'opacity-60')}>
                {m.word === 'Added' ? (
                  <>
                    <span>{c.label && c.label !== 'Planned' ? `Added · ${c.label} ·` : 'Added ·'}</span>
                    <span className="font-bold">{fmtValue(c.after, { now, tz })}</span>
                  </>
                ) : (
                  <>
                    <span>{m.word === 'Changed' || m.word.startsWith('Moved') ? `${m.word === 'Changed' ? c.label ?? c.field : m.word} ·` : `${m.word} ·`}</span>
                    <s className="text-faint">{fmtValue(c.before, { now, tz })}</s>
                    <span aria-hidden className="text-faint">
                      →
                    </span>
                    <span className="font-bold">{fmtValue(c.after, { now, tz })}</span>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="mt-1 flex items-center gap-2 border-t border-line pt-3">
        {receipt.staged ? (
          onApply ? (
            <span className="text-caption text-muted">
              Nothing changes until you accept. Undo a line to leave it out.
            </span>
          ) : (
            <span className="text-caption text-muted">Preview only: nothing applied.</span>
          )
        ) : (
          <Button variant="ghost" size="sm" icon="undo" disabled={all} onClick={() => onUndoAll?.(receipt)} className="-ml-2">
            {all ? 'All undone' : 'Undo all'}
          </Button>
        )}
      </div>
    </section>
  );
}
