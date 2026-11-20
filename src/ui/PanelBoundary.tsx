'use client';
/**
 * One error boundary per panel (R-UI-19): a panel that throws shows
 * "This panel failed to load · Retry · Details" and the rest of the cockpit keeps working.
 * `PanelError` is the same surface for query errors (no throw needed).
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { useForcedPanelStates } from './panel-state';

/** Redact credential-like text before showing error details (invariant 3). */
export function redactSecrets(text: string): string {
  return text
    .replace(/(xox[abprs]-[A-Za-z0-9-]{6,})/g, '[redacted]')
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[redacted]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]')
    .replace(/((?:token|secret|password|cookie|api[_-]?key)["'\s:=]+)[^\s"',;]{6,}/gi, '$1[redacted]');
}

export interface PanelErrorProps {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

export function PanelError({ title = 'This panel failed to load', error, onRetry, className, compact }: PanelErrorProps) {
  const [open, setOpen] = useState(false);
  const detail = error instanceof Error ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack.split('\n').slice(1, 6).join('\n')}` : ''}` : error ? String(error) : '';
  return (
    <div role="alert" className={cn('flex flex-col gap-2 text-body', compact ? 'px-3 py-2' : 'items-start px-4 py-6', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon name="error" size="sm" className="text-danger-700" />
        <span className="font-bold text-fg">{title}</span>
        {onRetry ? (
          <>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <button type="button" onClick={onRetry} className="rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
              Retry
            </button>
          </>
        ) : null}
        {detail ? (
          <>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-sm text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
              {open ? 'Hide details' : 'Details'}
            </button>
          </>
        ) : null}
      </div>
      {open && detail ? (
        <pre className="cc-scroll max-h-40 w-full overflow-auto rounded-md bg-surface-muted p-2 font-mono text-caption whitespace-pre-wrap text-muted">{redactSecrets(detail)}</pre>
      ) : null}
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Panel name, for the console and the dev toolbar's forced "error" state. */
  name?: string;
  /** Called after Retry resets the boundary (e.g. refetch the panel's query). */
  onRetry?: () => void;
  /** Changing any of these resets the boundary (e.g. the selected id). */
  resetKeys?: unknown[];
  fallbackClassName?: string;
}

interface BoundaryState {
  error: Error | null;
  keys: unknown[] | undefined;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    const a = props.resetKeys ?? [];
    const b = state.keys ?? [];
    if (state.error && (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i])))) return { error: null, keys: props.resetKeys };
    if (a !== b) return { keys: props.resetKeys };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[panel:${this.props.name ?? 'unnamed'}] render failed`, error.message, info.componentStack?.split('\n').slice(0, 4).join('\n'));
  }

  retry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) return <PanelError error={this.state.error} onRetry={this.retry} className={this.props.fallbackClassName} />;
    return this.props.children;
  }
}

function ForcedThrow({ name }: { name?: string }): null {
  throw new Error(`Forced error state (dev toolbar)${name ? ` for panel "${name}"` : ''}`);
}

/** Error boundary per panel. Honors the dev toolbar's forced "error" state for this panel. */
export function PanelBoundary(props: BoundaryProps) {
  const forced = useForcedPanelStates();
  const f = (props.name ? forced.byId[props.name] : undefined) ?? forced.all;
  return (
    <Boundary {...props} resetKeys={[...(props.resetKeys ?? []), f]}>
      {f === 'error' ? <ForcedThrow name={props.name} /> : props.children}
    </Boundary>
  );
}
