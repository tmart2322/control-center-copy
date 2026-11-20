'use client';
/**
 * The docked panel's anatomy for the context renderers (calendar_event, connector, agent_run, tool_adapter,
 * tool_run), the same calm shape as V2-DETAIL's item panel (src/components/detail/ItemDetail.tsx):
 *
 *   head    context line (section · neutral tag · one state badge) · title (22 px) · one muted sub line
 *   body    one scroll; sections with sentence-case 16 px headings that disappear when empty
 *   footer  sticky: the ONE filled action, quiet secondary actions, "Esc to close"
 *
 * Fits 520 px (1440–1920) and 600 px (2560): no fixed widths inside, prose capped at 68ch, label-left facts
 * that stack under 26 rem. Token names only (src/styles/brand.css). Never `text-faint` on `surface-sunken`.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Tone } from '@/contract';
import { Button, cn, EmptyState, Icon, PanelError, Skeleton, StatePill } from '@/ui';

export interface PanelPrimary {
  label: string;
  run: () => void;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Why it is disabled (title). */
  hint?: string;
  /** Stable hook for tests ("join", "reauth", "rescan", "open_in_claude", …). */
  id?: string;
}

export interface PanelFrameProps {
  /** Short noun for the panel region ("Meeting brief"). */
  label: string;
  /** Context line: section word, neutral tags, one state badge. */
  context?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  /** The sticky footer's ONE filled action (null: nothing needs you, quiet actions only). */
  primary?: PanelPrimary | null;
  /** Quiet secondary actions in the footer. */
  quiet?: ReactNode;
  /** Replaces the primary button (e.g. an inline answer form's submit state). */
  footerLead?: ReactNode;
  className?: string;
  [data: `data-${string}`]: unknown;
}

/** One renderer's frame: head, one scroll, the sticky footer. ⌘↵ fires the primary. */
export function PanelFrame({ label, context, title, sub, children, primary, quiet, footerLead, className, ...data }: PanelFrameProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.defaultPrevented && primary && !primary.disabled && !primary.loading) {
      e.preventDefault();
      primary.run();
    }
  };
  return (
    <div tabIndex={-1} role="region" aria-label={label} onKeyDown={onKeyDown} className={cn('@container/panel flex h-full min-h-0 flex-col bg-surface focus:outline-none', className)} {...data}>
      <header className="shrink-0 space-y-2 border-b border-line px-6 pt-4 pb-4">
        {context ? <div className="flex min-w-0 flex-wrap items-center gap-2 text-caption text-muted">{context}</div> : null}
        <h2 className="text-title font-bold text-balance text-fg-heading">{title}</h2>
        {sub ? <div className="max-w-[68ch] text-body text-muted">{sub}</div> : null}
      </header>
      <div className="cc-scroll relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" data-panel-scroll>
        <div className="flex flex-col gap-6 px-6 pt-5 pb-6">{children}</div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-2 border-t border-line bg-surface px-6 py-4" data-panel-footer>
        {footerLead ??
          (primary ? (
            <Button
              variant="primary"
              size="md"
              icon={primary.icon}
              disabled={primary.disabled}
              loading={primary.loading}
              title={primary.disabled && primary.hint ? primary.hint : `${primary.label} (⌘↵)`}
              onClick={() => primary.run()}
              className="mr-1"
              data-panel-primary={primary.id ?? true}
            >
              {primary.label}
            </Button>
          ) : null)}
        {quiet}
        <span className="ml-auto hidden text-caption text-faint @min-[34rem]/panel:inline">Esc to close</span>
      </footer>
    </div>
  );
}

/** A quiet footer action (link-colour text). */
export function QuietAction({ children, onClick, icon, disabled, title, ...data }: { children: ReactNode; onClick: () => void; icon?: string; disabled?: boolean; title?: string; [d: `data-${string}`]: unknown }) {
  return (
    <Button variant="quiet" size="xs" icon={icon} onClick={onClick} disabled={disabled} title={title} {...data}>
      {children}
    </Button>
  );
}

/** A section with a 16 px bold heading and an optional muted suffix; renders nothing without children. */
export function PanelSection({ title, suffix, action, children, className, ...data }: { title: ReactNode; suffix?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; [d: `data-${string}`]: unknown }) {
  const id = useId();
  if (children === null || children === undefined || children === false) return null;
  return (
    <section aria-labelledby={id} className={cn('min-w-0', className)} {...data}>
      <div className="mb-2 flex min-w-0 items-baseline gap-2">
        <h3 id={id} className="min-w-0 text-body font-bold text-fg-heading">
          {title}
          {suffix ? <span className="text-caption font-normal text-muted"> · {suffix}</span> : null}
        </h3>
        {action ? <span className="ml-auto shrink-0 text-caption">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Label-left facts that stack in a narrow panel. Rows with an empty value are dropped. */
export function Facts({ rows, className }: { rows: Array<[string, ReactNode] | null | false>; className?: string }) {
  const shown = rows.filter((r): r is [string, ReactNode] => !!r && r[1] !== null && r[1] !== undefined && r[1] !== '');
  if (!shown.length) return null;
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-0.5 @min-[26rem]/panel:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] @min-[26rem]/panel:gap-y-2', className)}>
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-caption text-muted @min-[26rem]/panel:pt-0.5">{k}</dt>
          <dd className="mb-2 min-w-0 text-body break-words text-fg tabular-nums @min-[26rem]/panel:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Neutral tag (accounts, kinds, sources): identity is never a colour. */
export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-6 max-w-[24ch] min-w-0 shrink items-center truncate rounded-sm border border-line-strong bg-surface-sunken px-2 text-caption font-bold text-fg">
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The one state badge in the context line: glyph + word on its tint. */
export function StateBadge({ tone, label }: { tone: Tone; label: string }) {
  return <StatePill tone={tone} icon={false} label={label} size="md" />;
}

/** Copy to the clipboard (with a textarea fallback for non-secure contexts). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A quiet Copy button that says "Copied" for 2 s. */
export function CopyButton({ text, label = 'Copy', size = 'xs', onCopied, className }: { text: string; label?: string; size?: 'xs' | 'sm'; onCopied?: (ok: boolean) => void; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <Button
      variant="secondary"
      size={size}
      icon={state === 'ok' ? 'check' : 'copy'}
      aria-label={`${label}: ${text}`}
      data-copy
      className={className}
      onClick={async () => {
        const ok = await copyToClipboard(text);
        setState(ok ? 'ok' : 'fail');
        onCopied?.(ok);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : label}
    </Button>
  );
}

/** A command to run yourself (never contains secrets, per the contract): mono, wraps, with Copy. */
export function CommandBlock({ command, note, className }: { command: string; note?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)} data-command>
      <div className="flex min-w-0 items-start gap-2 rounded-md border border-line-strong bg-surface-input py-2 pr-2 pl-3">
        <code className="min-w-0 flex-1 pt-1 font-mono text-caption text-fg [overflow-wrap:anywhere]" data-command-text>
          {/* Break long paths after a slash, not mid-name. */}
          {command.split(/(?<=\/)/).map((part, i) => (
            <span key={i}>
              {part}
              <wbr />
            </span>
          ))}
        </code>
        <CopyButton text={command} label="Copy" />
      </div>
      {note ? <p className="mt-1 max-w-[68ch] text-caption text-muted">{note}</p> : null}
    </div>
  );
}

/** Loading silhouette in the final shape. */
export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col" aria-busy aria-label={label}>
      <div className="space-y-3 border-b border-line px-6 py-4">
        <Skeleton variant="line" className="w-40" />
        <Skeleton variant="line" className="w-3/4" />
        <Skeleton variant="line" className="w-1/2" />
      </div>
      <div className="space-y-6 px-6 py-5">
        <Skeleton variant="line" count={3} />
        <Skeleton variant="block" className="h-24 w-full" />
        <Skeleton variant="row" count={3} />
      </div>
    </div>
  );
}

/** The entity is gone, or the fetch failed (with Retry). */
export function PanelProblem({ gone, error, what, onRetry }: { gone: boolean; error?: unknown; what: string; onRetry?: () => void }) {
  return (
    <div className="p-6">
      {gone ? (
        <EmptyState size="panel" icon="search" title={`This ${what} isn’t here any more`} body="It may have finished, been removed or moved out of range. Pick another one from the list." />
      ) : (
        <PanelError title={`This ${what} failed to load`} error={error instanceof Error ? error : undefined} onRetry={onRetry} />
      )}
    </div>
  );
}

/** "Opens in a new tab" link-button for http(s) targets (meeting links, results). Click only. */
export function openExternal(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** A readiness check: ✓ ready (green) / ○ not yet (amber), always word + glyph. */
export function Check({ ready, children, onOpen, meta }: { ready: boolean; children: ReactNode; onOpen?: () => void; meta?: ReactNode }) {
  const body = (
    <>
      <span aria-hidden className={cn('mt-0.5 w-4 shrink-0 text-center font-bold', ready ? 'text-success-700' : 'text-warning-700')}>
        {ready ? '✓' : '○'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{ready ? 'Ready: ' : 'Not ready: '}</span>
        <span className={cn('text-body', ready ? 'text-muted' : 'text-fg')}>{children}</span>
        {meta ? <span className="block text-caption text-muted">{meta}</span> : null}
      </span>
      {onOpen ? <Icon name="chevronright" size="xs" className="mt-1.5 shrink-0 text-muted" /> : null}
    </>
  );
  const cls = 'flex w-full min-w-0 items-start gap-3 rounded-md px-2 py-2 text-left';
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(cls, 'transition-colors hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
