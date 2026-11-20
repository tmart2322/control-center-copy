'use client';
/**
 * ProposalDiff: an engine (or chat) change to a user-locked field, shown as a field diff with
 * Apply / Keep mine (R-UI-20, UI-SPEC §5.3, §9). `conflict` renders the 409 "Changed elsewhere: keep yours /
 * take theirs" variant (§10). `variant="strip"` is the in-card update strip ("New info: X. Update draft?").
 * DESIGN-V2: the proposal wears the agentic gradient border and one ✦; Apply is the one filled button.
 * A conflict is amber (at risk), never violet.
 */
import type { Proposal, SourceRef } from '@/contract';
import { useState } from 'react';
import { Button, cn, Icon } from '@/ui';
import { SourceChip, useClock } from './lib';
import { clock } from './lib/time';
import { fmtValue } from './format';

export interface ProposalDiffProps {
  proposal: Proposal;
  variant?: 'card' | 'strip';
  /** 409 rebase: someone changed this while you edited it. */
  conflict?: boolean;
  defaultDiffOpen?: boolean;
  onApply?: (proposal: Proposal) => void;
  onKeepMine?: (proposal: Proposal) => void;
  onOpenSource?: (source: SourceRef) => void;
  className?: string;
}

export function TextDiff({ ops }: { ops: NonNullable<Proposal['textDiff']> }) {
  return (
    <p className="max-w-[68ch] whitespace-pre-wrap text-body text-fg">
      {ops.map((op, i) =>
        op.op === 'insert' ? (
          <ins key={i} className="mx-0.5 rounded-sm bg-success-50 px-0.5 text-success-700 no-underline">
            {op.text}
          </ins>
        ) : op.op === 'delete' ? (
          <del key={i} className="mx-0.5 rounded-sm bg-danger-50 px-0.5 text-danger-700">
            {op.text}
          </del>
        ) : (
          <span key={i}>{op.text}</span>
        ),
      )}
    </p>
  );
}

function FieldRows({ proposal, now, tz }: { proposal: Proposal; now: string; tz?: string }) {
  const rows = proposal.changes.filter((c) => !(proposal.textDiff && c.field === 'doc'));
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 text-body">
      {rows.map((c) => (
        <div key={c.field} className="contents">
          <dt className="text-caption text-muted">{c.label ?? c.field}</dt>
          <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums">
            <s className="text-faint">{fmtValue(c.before, { now, tz })}</s>
            <span aria-hidden className="text-faint">
              →
            </span>
            <span className="font-bold text-fg">{fmtValue(c.after, { now, tz })}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProposalDiff({ proposal, variant = 'card', conflict, defaultDiffOpen, onApply, onKeepMine, onOpenSource, className }: ProposalDiffProps) {
  const { now, tz } = useClock();
  const [open, setOpen] = useState(defaultDiffOpen ?? variant === 'card');
  const settled = proposal.status !== 'pending';
  const applyLabel = conflict ? 'Take theirs' : proposal.entity.type === 'draft' ? 'Update draft' : 'Apply';
  const keepLabel = conflict ? 'Keep yours' : 'Keep mine';
  const settledLabel = proposal.status === 'applied' ? 'Applied' : proposal.status === 'rejected' ? 'Kept yours' : 'Superseded';

  if (variant === 'strip') {
    return (
      <div className={cn('border-t border-line bg-ai-50 px-4 py-2', className)} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-caption">
          <span aria-hidden className="text-ai-700">
            ✦
          </span>
          <span className="min-w-0 flex-1 text-fg">
            <span className="font-bold">New info</span> {clock(proposal.createdAt, tz)}: {proposal.reason}.{' '}
            <span className="text-muted">{proposal.entity.type === 'draft' ? 'Update your draft?' : 'Apply the change?'}</span>
          </span>
          <button type="button" className="inline-flex items-center gap-1 font-bold text-link hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Diff <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" />
          </button>
          {settled ? (
            <span className="inline-flex items-center gap-1 font-bold text-success-700">
              <Icon name="check" size="xs" />
              {settledLabel}
            </span>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => onApply?.(proposal)}>
                {applyLabel}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onKeepMine?.(proposal)}>
                {keepLabel}
              </Button>
            </>
          )}
        </div>
        {open ? (
          <div className="mt-2 space-y-1.5 rounded-md bg-surface p-3">
            {proposal.textDiff ? <TextDiff ops={proposal.textDiff} /> : null}
            <FieldRows proposal={proposal} now={now} tz={tz} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className={cn('min-w-0 rounded-lg p-5', conflict ? 'border border-warning-200 bg-surface shadow-[inset_3px_0_0_var(--color-warning-500)]' : 'border-agentic', className)}
      aria-label={conflict ? 'Changed elsewhere' : 'Proposed change'}
    >
      <div className="flex items-center gap-2">
        {conflict ? <Icon name="warning" size="sm" className="text-warning-700" /> : <span aria-hidden className="text-body-lg text-ai-700">✦</span>}
        <h3 className={cn('shrink-0 text-body-lg font-bold', conflict ? 'text-warning-700' : 'text-fg-heading')}>{conflict ? 'Changed elsewhere' : 'Proposed change'}</h3>
        <span className="min-w-0 truncate text-caption text-muted">· {proposal.entity.label}</span>
        <span className="ml-auto shrink-0 text-caption text-muted tabular-nums">{clock(proposal.createdAt, tz)}</span>
      </div>
      <p className="mt-1.5 max-w-[68ch] text-body text-fg">{conflict ? 'This changed while you were editing it. Keep your version or take the new one.' : proposal.reason}</p>
      <div className="mt-3 space-y-2">
        {proposal.textDiff ? (
          open ? (
            <TextDiff ops={proposal.textDiff} />
          ) : (
            <button type="button" className="text-caption font-bold text-link hover:underline" onClick={() => setOpen(true)}>
              Show text diff
            </button>
          )
        ) : null}
        <FieldRows proposal={proposal} now={now} tz={tz} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {settled ? (
          <span className="inline-flex items-center gap-1.5 text-caption font-bold text-success-700">
            <Icon name="check" size="xs" />
            {settledLabel}
          </span>
        ) : (
          <>
            <Button variant="primary" size="md" onClick={() => onApply?.(proposal)}>
              {applyLabel}
            </Button>
            <Button variant="secondary" size="md" onClick={() => onKeepMine?.(proposal)}>
              {keepLabel}
            </Button>
          </>
        )}
        {proposal.source ? <SourceChip source={proposal.source} onOpen={onOpenSource} className="ml-auto" /> : null}
      </div>
    </section>
  );
}
