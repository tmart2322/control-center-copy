'use client';
/**
 * Non-modal side sheet (UI-SPEC §2 drill model: Enter opens it, the list stays visible).
 * - "n of N" with ↑/↓, and j/k (or ↑/↓ keys) call onPrev/onNext while open.
 * - Esc closes and returns focus to the exact row (`returnFocus`), else to what had focus on open.
 * - Resizable from its left edge (width remembered); docks as a real column at ≥ 2400 px when the
 *   shell provides a dock host (AppFrame does).
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useKeyBinding, useKeyScope } from '@/client/keyboard/KeyboardProvider';
import { IconButton } from './Button';
import { cn } from './cn';
import { Eyebrow } from './badges';
import { KbdHint } from './Kbd';
import { Tooltip } from './Tooltip';

// ── Host (provided by the shell) ────────────────────────────────────────────────────────────

export interface SheetHost {
  /** Positioned layer over the right of the main region (overlay mode). */
  overlay: HTMLElement | null;
  /** Docked detail column (≥ 2400 px); null when the frame is narrower. */
  dock: HTMLElement | null;
  /** Tell the shell a sheet wants the dock column (it renders the column only while > 0). */
  claimDock: () => () => void;
}

const SheetHostContext = createContext<SheetHost | null>(null);
export const SheetHostProvider = SheetHostContext.Provider;
export function useSheetHost() {
  return useContext(SheetHostContext);
}

// ── SideSheet ───────────────────────────────────────────────────────────────────────────────

export interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Object type eyebrow ("Task", "Run", "Connector"). */
  eyebrow?: string;
  /** 0-based position in the list, and the list length: renders "n of N". */
  index?: number;
  total?: number;
  onPrev?: () => void;
  onNext?: () => void;
  /** ⇧Enter / expand: open the full page. */
  onOpenPage?: () => void;
  /** Esc returns focus here (the exact row). */
  returnFocus?: () => HTMLElement | null;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Default width in overlay mode (px). */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** localStorage key for the remembered width. */
  storageKey?: string;
  label?: string;
  /** Docked column when the host allows it (default true). */
  dockable?: boolean;
}

function readWidth(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function SideSheet({
  open,
  onClose,
  title,
  eyebrow,
  index,
  total,
  onPrev,
  onNext,
  onOpenPage,
  returnFocus,
  actions,
  footer,
  children,
  width: defaultWidth = 560,
  minWidth = 420,
  maxWidth = 920,
  storageKey = 'cc:sheet-width',
  label,
  dockable = true,
}: SideSheetProps) {
  const host = useSheetHost();
  const scope = `sheet${useId()}`;
  const titleId = useId();
  const openerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    setWidth(readWidth(storageKey, defaultWidth));
  }, [storageKey, defaultWidth]);

  // Claim the dock column while open.
  const claimDock = host?.claimDock;
  useEffect(() => {
    if (!open || !dockable || !claimDock) return;
    return claimDock();
  }, [open, dockable, claimDock]);
  const docked = Boolean(open && dockable && host?.dock);

  useEffect(() => {
    if (open) openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [open]);

  const close = useCallback(() => {
    const target = returnFocus?.() ?? openerRef.current;
    onClose();
    if (target && document.contains(target)) requestAnimationFrame(() => target.focus({ preventScroll: false }));
  }, [onClose, returnFocus]);

  useKeyScope(scope, { active: open });
  useKeyBinding('escape', () => close(), { scope, enabled: open });
  useKeyBinding(['j', 'down'], () => (onNext ? onNext() : false), { scope, enabled: open && !!onNext });
  useKeyBinding(['k', 'up'], () => (onPrev ? onPrev() : false), { scope, enabled: open && !!onPrev });
  useKeyBinding('shift+enter', () => (onOpenPage ? onOpenPage() : false), { scope, enabled: open && !!onOpenPage });

  const onKeyDown = (e: KeyboardEvent) => {
    // Esc inside a field blurs it first; the next Esc closes the sheet.
    if (e.key === 'Escape' && e.target !== panelRef.current && (e.target as HTMLElement).matches('input,textarea,[contenteditable="true"]')) {
      e.preventDefault();
      panelRef.current?.focus();
    }
  };

  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.max(minWidth, Math.min(maxWidth, startW + (startX - ev.clientX))));
    const up = (ev: globalThis.PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      const w = Math.max(minWidth, Math.min(maxWidth, startW + (startX - ev.clientX)));
      try {
        localStorage.setItem(storageKey, String(Math.round(w)));
      } catch {
        /* ignore */
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  if (!open) return null;

  const hasNav = typeof index === 'number' && typeof total === 'number' && total > 0;
  const panel = (
    <section
      ref={panelRef}
      role="complementary"
      aria-labelledby={titleId}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-docked={docked ? '' : undefined}
      style={docked ? undefined : { width }}
      className={cn(
        'flex min-h-0 flex-col text-fg focus:outline-none',
        docked ? 'h-full w-full border-l border-line bg-surface' : 'pointer-events-auto absolute inset-y-0 right-0 max-w-[calc(100%-1rem)] rounded-l-lg bg-surface-raised shadow-pop',
      )}
    >
      {!docked ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sheet"
          onPointerDown={startResize}
          className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
        >
          <span className="absolute inset-y-0 left-1 w-px bg-transparent transition-colors group-hover:bg-accent" />
        </div>
      ) : null}
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-6 pt-3 pb-4">
        <div className="flex h-8 items-center gap-2">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          {hasNav ? (
            <span className="text-caption text-muted tabular-nums" aria-live="polite">
              {index! + 1} of {total}
            </span>
          ) : null}
          <span className="flex-1" />
          {hasNav ? (
            <span className="flex items-center gap-0.5">
              <Tooltip content={<span className="inline-flex items-center gap-1.5">Previous <KbdHint combo="k" tone="inverse" /></span>}>
                <IconButton icon="chevronup" label="Previous" size="sm" onClick={onPrev} disabled={!onPrev || index === 0} />
              </Tooltip>
              <Tooltip content={<span className="inline-flex items-center gap-1.5">Next <KbdHint combo="j" tone="inverse" /></span>}>
                <IconButton icon="chevrondown" label="Next" size="sm" onClick={onNext} disabled={!onNext || index === total! - 1} />
              </Tooltip>
            </span>
          ) : null}
          {onOpenPage ? (
            <Tooltip content={<span className="inline-flex items-center gap-1.5">Open full page <KbdHint combo="shift+enter" tone="inverse" /></span>}>
              <IconButton icon="expand_alt" label="Open full page" size="sm" onClick={onOpenPage} />
            </Tooltip>
          ) : null}
          <Tooltip content={<span className="inline-flex items-center gap-1.5">Close <KbdHint combo="escape" tone="inverse" /></span>}>
            <IconButton icon="close" label="Close" size="sm" onClick={close} />
          </Tooltip>
        </div>
        <div className="flex items-start gap-3">
          <h2 id={titleId} className="min-w-0 flex-1 text-title text-fg-heading">
            {title}
          </h2>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <div className="cc-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">{children}</div>
      {footer ? <footer className="shrink-0 border-t border-line px-6 py-4">{footer}</footer> : null}
    </section>
  );

  const target = docked ? host!.dock : host?.overlay;
  if (target) return createPortal(panel, target);
  // No shell host (isolated render): fixed to the viewport's right edge.
  return <div className="pointer-events-none fixed inset-y-0 right-0 z-[60] w-full">{panel}</div>;
}
