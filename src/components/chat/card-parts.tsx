'use client';
/**
 * Shared pieces of the proposal and receipt cards (2026-11-13): a long list opens up in steps and then scrolls inside
 * the card (a 200-claim card stays readable in the dock), and an Apply that landed some changes lists the ones that
 * did not, each with its reason.
 */
import { useState } from 'react';
import type { ReceiptFailure } from '@/contract';
import s from './assistant.module.css';

/** Lines shown per "Show more" step once a card is opened up. */
export const MORE_STEP = 50;
/** Past this many shown lines the list scrolls inside the card. */
export const SCROLL_AFTER = 12;

/** How many of `total` lines to show, and the control that shows more (in steps) or fewer. */
export function useReveal(total: number, first: number) {
  const [shown, setShown] = useState(first);
  const n = Math.min(total, Math.max(first, shown));
  const left = total - n;
  const control =
    total > first ? (
      <div className={s.moreRow}>
        {left > 0 ? (
          <button type="button" className={s.more} onClick={() => setShown(n + MORE_STEP)} data-show-more>
            {left > MORE_STEP ? `Show ${MORE_STEP} more` : `Show ${left} more`}
          </button>
        ) : null}
        {left > MORE_STEP ? (
          <button type="button" className={s.more} onClick={() => setShown(total)} data-show-all>
            Show all {total}
          </button>
        ) : null}
        {n > first ? (
          <button type="button" className={s.more} onClick={() => setShown(first)} data-show-fewer>
            Show fewer
          </button>
        ) : null}
        <span className={s.n}>
          {n} of {total}
        </span>
      </div>
    ) : null;
  return { shown: n, control, scroll: n > SCROLL_AFTER };
}

/** The receipt's head line: "Applied 54 of 55 · 1 failed" (or "Applied 3 changes"). */
export function appliedHead(lines: number, failed: ReceiptFailure[] | undefined, total: number | undefined): { text: string; warn: string | null } {
  const f = failed?.length ?? 0;
  if (!f) return { text: `Applied ${lines} change${lines === 1 ? '' : 's'}`, warn: null };
  const all = total ?? f;
  return { text: `Applied ${Math.max(0, all - f)} of ${all}`, warn: `${f} failed` };
}

/** The changes that did not land, each with why. */
export function FailedLines({ failed }: { failed: ReceiptFailure[] | undefined }) {
  const list = failed ?? [];
  const { shown, control } = useReveal(list.length, 5);
  if (!list.length) return null;
  return (
    <div className={s.failed} role="group" aria-label="Not applied" data-failed>
      <b>Not applied ({list.length}): the rest landed</b>
      <ul className={s.failList}>
        {list.slice(0, shown).map((f, i) => (
          <li key={`${f.label}:${i}`}>
            <span className={s.fl}>{f.label}</span>
            <span className={s.why}>{f.reason}</span>
          </li>
        ))}
      </ul>
      {control}
    </div>
  );
}
