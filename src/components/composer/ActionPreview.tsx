/**
 * The one preview for every structured Outbox action (`Destination.kind === 'action'`): the app and target (with
 * its deep link), one line per change (field: before → after), and an optional long text block (a canvas body).
 * Read-only: an action item is approved or rejected, never edited. Used by the composer, the confirm dialog, the
 * Outbox row and the Details panel. Text is rendered as text (React escapes it); nothing here injects HTML.
 */
import type { ActionDestination } from '@/contract';
import { actionApp } from '@/lib/actions';

import { cx } from './_bits';

const show = (v: string | number | null) => (v === null || v === '' ? '(empty)' : String(v));

export interface ActionPreviewProps {
  destination: ActionDestination;
  className?: string;
  /** Hide the header (inside the confirm dialog, which names the target itself). */
  bare?: boolean;
  /** Leave out the long text (a canvas's work order: the canvas review shows its rows instead). */
  hideText?: boolean;
}

export function ActionPreview({ destination, className, bare, hideText }: ActionPreviewProps) {
  const app = actionApp(destination.action);
  const { target, changes, text } = destination;
  return (
    <figure data-testid="action-preview" data-action={destination.action} className={cx('overflow-hidden rounded-md border border-line bg-surface', className)}>
      {!bare ? (
        <figcaption className="flex h-8 items-center gap-1.5 border-b border-line bg-surface-muted px-3 text-caption text-muted">
          <span className="font-bold text-fg">{app}</span>
          {target.url ? (
            <a href={target.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-fg underline-offset-2 hover:underline">
              {target.label}
            </a>
          ) : (
            <span className="min-w-0 truncate">{target.label}</span>
          )}
          <span className="ml-auto shrink-0">Applied on approve</span>
        </figcaption>
      ) : null}
      {changes.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 text-body" data-testid="action-changes">
          {changes.map((c, i) => (
            <div key={`${c.label}-${i}`} className="contents">
              <dt className="text-muted">{c.label}</dt>
              <dd className="min-w-0">
                <span className="whitespace-pre-wrap text-muted">{show(c.before)}</span>
                <span aria-label="becomes" className="mx-1.5 text-faint">
                  →
                </span>
                <span className="whitespace-pre-wrap text-fg">{show(c.after)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {text && !hideText ? <div className={cx('max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 text-body text-fg', changes.length ? 'border-t border-line' : '')}>{text}</div> : null}
    </figure>
  );
}
