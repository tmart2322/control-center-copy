'use client';
/**
 * Deliverable Drive panel (R-UI-15, UI-SPEC §12): the file, its last edit and editor, whether it changed
 * since the item was created, the latest diff (slides added · removed · changed), and the judgment
 * "were the requested updates made?" as yes · partial · no · unknown, with the reasons.
 */
import type { DeliverableInfo, WorkItem } from '@/contract';
import { cn, Icon, SourceChip, StaleMark, StatePill, usePanelState } from '@/ui';
import { diffLines, doctypeIcon, judgmentWord } from './lib/derive';
import { fmtWhen } from './lib/tz';
import { openDeepLink } from './nba/ClaudeLaunchPanel';

// The judgment is the one color signal on the panel (green yes, amber partial/no, red regressed).
const WORD_CLS = {
  ok: 'bg-success-50 text-success-700 border-success-200',
  warn: 'bg-warning-50 text-warning-700 border-warning-200',
  risk: 'bg-danger-50 text-danger-700 border-danger-200',
  neutral: 'bg-surface-muted text-fg border-line',
  brand: 'bg-surface-muted text-fg border-line',
  ai: 'bg-ai-50 text-ai-700 border-ai-200',
} as const;

export function DrivePanel({ item, now, tz }: { item: WorkItem; now: string; tz?: string }) {
  const d: DeliverableInfo | null = item.deliverable;
  const state = usePanelState('item.drive', { empty: !d });
  if (!d || state === 'empty') return null;
  const j = judgmentWord(d);
  const lines = diffLines(d.diffSummary);
  const stale = item.stale && item.sources.some((s) => s.kind === 'drive') ? item.stale : null;

  return (
    <section aria-label="Drive file" data-drive-panel={d.judgment?.verdict ?? 'none'} className="rounded-lg border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3" data-doctype={doctypeIcon(d.mimeKind)}>
        <Icon name="file" size="md" className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted">Deliverable · Drive</p>
          <p className="truncate text-body font-bold text-fg" title={d.fileName}>
            {d.fileName}
          </p>
        </div>
        {stale ? <StaleMark reason={stale.reason} /> : null}
        {d.url ? (
          <button type="button" onClick={() => openDeepLink(d.url!)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-caption font-bold text-link hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none">
            <Icon name="new_window" size="xs" /> Open file
          </button>
        ) : (
          <SourceChip source="drive" />
        )}
      </header>
      <div className="grid gap-4 p-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-body">
          <dt className="text-caption text-muted">Last edit</dt>
          <dd className="tabular-nums text-fg">
            {d.lastEditedAt ? (
              <>
                {fmtWhen(d.lastEditedAt, now, tz, { today: true })}
                {d.lastEditedBy ? <span className="text-muted"> by {d.lastEditedBy}</span> : null}
              </>
            ) : (
              <span className="text-muted">Not seen yet</span>
            )}
          </dd>
          <dt className="text-caption text-muted">Since created</dt>
          <dd>
            <StatePill tone="neutral" label={d.changedSinceCreated ? 'Changed' : 'No change'} title={d.changedSinceCreated ? 'The file changed after this item was created' : 'No edits since this item was created'} size="sm" />
          </dd>
          <dt className="text-caption text-muted">Latest diff</dt>
          <dd className="min-w-0">
            {lines.length ? (
              <ul className="space-y-0.5" data-diff-lines={lines.length}>
                {lines.map((l, i) => (
                  <li key={i} className="flex gap-1.5 text-body">
                    <span className={cn('w-3 shrink-0 text-center font-bold', l.sign === '+' ? 'text-success-700' : l.sign === '-' ? 'text-danger-700' : 'text-muted')} aria-hidden>
                      {l.sign === '+' ? '+' : l.sign === '-' ? '−' : '~'}
                    </span>
                    <span className="min-w-0 text-fg">{l.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted">No diff sampled yet</span>
            )}
          </dd>
        </dl>
        <div className={cn('rounded-md border px-4 py-3', WORD_CLS[j.tone])} data-judgment={j.word}>
          <p className="text-caption text-muted">Requested updates made?</p>
          <p className="flex items-baseline gap-2">
            <span className="text-title font-bold">{j.word}</span>
            <span className="text-caption">{j.label}</span>
          </p>
          {d.judgment ? (
            <>
              <p className="mt-0.5 text-caption tabular-nums">
                {d.judgment.made} of {d.judgment.requested} requested updates made
              </p>
              <span className="mt-1 block h-1.5 w-full rounded-full bg-surface-sunken">
                <span className={cn('block h-full rounded-full', j.tone === 'ok' ? 'bg-success-500' : j.tone === 'risk' ? 'bg-danger-500' : j.tone === 'warn' ? 'bg-warning-500' : 'bg-faint')} style={{ width: `${Math.round((d.judgment.made / Math.max(1, d.judgment.requested)) * 100)}%` }} />
              </span>
              <p className="mt-1.5 max-w-[68ch] text-body text-fg">{d.judgment.summary}</p>
            </>
          ) : (
            <p className="mt-1 text-body text-fg">The judgment runs after the next Drive sample.</p>
          )}
        </div>
      </div>
    </section>
  );
}
