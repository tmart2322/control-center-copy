'use client';
/**
 * The spotlight tour's surface: the page dimmed with the scrim token, a cutout around the step's element (concentric
 * corners, a soft focus ring), and the step card beside it with an arrow. The card is the app's own panel (L2
 * `surface-raised`, `rounded-lg`, the strong hairline and `shadow-pop`), placed by floating.ts (flip and shift).
 *
 * Modal while it is up: the dimmed page and the highlighted element take no clicks (a click nudges the card), focus
 * stays in the card, and a modal key scope silences page shortcuts and ⌘K. → / Enter is Next, ← Back, Esc Skip.
 * The cutout follows scrolling, resizing and layout shifts (scroll and resize listeners, a ResizeObserver, a slow
 * poll; all rAF-throttled). Reduced motion: no glide, no nudge, no smooth scroll.
 *
 * Sequencing and seen state live in CoachMarks.tsx and tour.ts; this only draws a step and reports the move.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKeyScope } from '@/client/keyboard/KeyboardProvider';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import type { Rect, Side } from '@/ui/floating';
import { cutoutRadius, cutoutRect, needsScroll, placeCard, primaryLabel, scrollDelta, stepLabel, tourKeyAction, trapTab, type CardPlacement, type TourMove } from './tour';

/** The tour's own DOM carries `data-guide-tour` (its card is a dialog; "is another dialog open?" must not count it). */
export const TOUR_SELECTOR = '[data-guide-tour]';

export interface TourStep {
  id: string;
  selector: string;
  title: string;
  text: string;
  side?: Side;
  /** A second button that settles the step as it is ("Looks right"); the card calls `onConfirm`. */
  confirm?: { label: string };
}

export interface SpotlightTourProps {
  steps: readonly TourStep[];
  index: number;
  onMove: (move: TourMove) => void;
  /** The step's `confirm` button was pressed. */
  onConfirm?: (step: TourStep) => void;
}

/**
 * The element a step points at, if the page shows it: rendered, not a loading skeleton (aria-busy) or hidden copy,
 * at least 4 px each way. It may be scrolled out of its panel; the tour scrolls it in.
 */
export function findAnchor(selector: string): HTMLElement | null {
  let els: HTMLElement[];
  try {
    els = [...document.querySelectorAll<HTMLElement>(selector)];
  } catch {
    return null;
  }
  for (const el of els) {
    if (!el.isConnected || el.closest('[aria-busy="true"],[aria-hidden="true"],[inert]')) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 4 && r.height >= 4) return el;
  }
  return null;
}

/** A step not placed on screen by then moves on (the next step, or the end). */
export const UNPLACEABLE_MS = 2500;

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const rectOf = (b: DOMRect | Rect): Rect => ({ top: b.top, left: b.left, width: b.width, height: b.height });

/** The nearest ancestor that scrolls (panels scroll on their own; the page itself never does). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|overlay)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** Scroll the element's panel so it sits in view (smoothly unless reduced motion). */
function bringIntoView(el: HTMLElement) {
  const box = scrollParent(el);
  if (!box) return;
  const c = box.getBoundingClientRect();
  const top = Math.max(0, c.top);
  const view = { top, left: c.left, width: c.width, height: Math.min(window.innerHeight, c.top + c.height) - top };
  const r = rectOf(el.getBoundingClientRect());
  if (view.height <= 0 || !needsScroll(r, view)) return;
  const dy = scrollDelta(r, view);
  if (dy && typeof box.scrollBy === 'function') box.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

interface Geo {
  cut: Rect;
  radius: number;
  card: CardPlacement;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
function sameGeo(a: Geo, b: Geo): boolean {
  return (
    near(a.cut.top, b.cut.top) &&
    near(a.cut.left, b.cut.left) &&
    near(a.cut.width, b.cut.width) &&
    near(a.cut.height, b.cut.height) &&
    near(a.radius, b.radius) &&
    near(a.card.top, b.card.top) &&
    near(a.card.left, b.card.left) &&
    a.card.side === b.card.side &&
    a.card.arrow === b.card.arrow
  );
}

/** Ring, soft glow, then the scrim as a spread shadow: everything outside the cutout is dimmed. Tokens only. */
const CUTOUT_SHADOW = '0 0 0 2px var(--color-focus), 0 0 0 6px color-mix(in oklab, var(--color-focus) 24%, transparent), 0 0 0 200vmax var(--color-scrim)';

/** The arrow is a rotated square on the card edge that faces the cutout, bordered on its outer two sides. */
const ARROW: Record<Side, string> = {
  bottom: '-top-[7px] border-t border-l',
  top: '-bottom-[7px] border-b border-r',
  right: '-left-[7px] border-l border-b',
  left: '-right-[7px] border-r border-t',
};

const NUDGE: Keyframe[] = [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }];

const FOCUSABLE = 'button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export function SpotlightTour({ steps, index, onMove, onConfirm }: SpotlightTourProps) {
  const step = steps[index];
  const count = steps.length;
  const selector = step?.selector ?? '';
  const side = step?.side ?? 'bottom';
  const titleId = useId();
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const anchorRef = useRef<{ sel: string; el: HTMLElement | null }>({ sel: '', el: null });
  /** The step on screen before this one (null until the first is shown). */
  const shownSelector = useRef<string | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [moving, setMoving] = useState(false);
  const [entered, setEntered] = useState(false);

  /** Placed on screen (the step's element measured). Until then the tour takes no clicks, keys or focus. */
  const shown = geo !== null;
  useKeyScope('guide-tour', { active: shown, modal: true });

  /** The step's element; looked up again when React replaced it (same selector, new node). */
  const target = useCallback(() => {
    const cur = anchorRef.current;
    if (cur.sel === selector && cur.el?.isConnected) return cur.el;
    const el = findAnchor(selector);
    anchorRef.current = { sel: selector, el };
    return el;
  }, [selector]);

  const measure = useCallback(() => {
    const el = target();
    const card = cardRef.current;
    if (!el || !card) return; // gone for a moment (a re-render): keep the last cutout
    const vp = { width: window.innerWidth, height: window.innerHeight };
    const b = el.getBoundingClientRect();
    const cut = cutoutRect(rectOf(b), vp);
    if (!cut) return;
    const next: Geo = {
      cut,
      radius: cutoutRadius(getComputedStyle(el).borderTopLeftRadius, b.width, b.height),
      card: placeCard(cut, { width: card.offsetWidth, height: card.offsetHeight }, side, vp),
    };
    setGeo((prev) => (prev && sameGeo(prev, next) ? prev : next));
  }, [target, side]);

  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const el = target();
    if (el) ro?.observe(el);
    if (cardRef.current) ro?.observe(cardRef.current);
    // a shift nothing above reports: the first-scan banner arriving, content loading above the element
    const poll = setInterval(schedule, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(poll);
      ro?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [measure, target]);

  // each step: scroll its element into view; on a step change (not the first show) the cutout and card glide to it
  useEffect(() => {
    const el = target();
    if (el) bringIntoView(el);
    const prev = shownSelector.current;
    shownSelector.current = selector;
    if (prev !== null && prev !== selector) setMoving(true);
  }, [target, selector]);
  useEffect(() => {
    if (!moving) return;
    const t = setTimeout(() => setMoving(false), 450);
    return () => clearTimeout(t);
  }, [moving]);

  // a step whose element can't be placed (gone, zero-sized, off-layout) never leaves an invisible tour holding the page
  useEffect(() => {
    if (shown) return;
    const t = setTimeout(() => onMove('next'), UNPLACEABLE_MS);
    return () => clearTimeout(t);
  }, [shown, index, onMove]);
  useEffect(() => {
    if (!shown || entered) return;
    const f = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(f);
  }, [shown, entered]);

  // focus moves into the card once it is placed, and back to Next when the focused control went away (Back on step 1)
  useEffect(() => {
    if (!shown) return;
    if (!cardRef.current?.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true });
  }, [shown, index]);

  // focus never settles outside the tour (the page focusing its own field after a load, say)
  useEffect(() => {
    if (!shown) return;
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      primaryRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [shown]);

  // keys: the tour's own, and nothing beneath it (capture, so page listeners never see them)
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const inCard = !!(card && t && card.contains(t));
      e.stopPropagation();
      if (e.key === 'Tab') {
        if (!card) return;
        e.preventDefault();
        const els = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
        els[trapTab(els.length, inCard && t ? els.indexOf(t) : -1, e.shiftKey)]?.focus();
        return;
      }
      const move = tourKeyAction(e, { onControl: inCard && !!t?.closest('button,a[href]') });
      if (!move) return;
      e.preventDefault();
      if (move === 'back' && index === 0) return;
      onMove(move);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown, index, onMove]);

  /** A click on the dimmed page: nothing happens there, the card nudges and takes focus. */
  const nudge = useCallback(() => {
    primaryRef.current?.focus({ preventScroll: true });
    const card = cardRef.current;
    if (!card || reducedMotion() || typeof card.animate !== 'function') return;
    card.animate(NUDGE, { duration: 320, easing: 'ease-out' });
  }, []);

  if (!step || typeof document === 'undefined') return null;
  const glide = moving ? 'transition-[top,left,width,height,border-radius] duration-(--dur-slow) ease-out' : null;
  const arrowSide = geo?.card.side ?? null;
  const arrow = geo?.card.arrow ?? null;

  return createPortal(
    <div
      ref={rootRef}
      data-guide-tour=""
      data-testid="coach-tour"
      className={cn('fixed inset-0 z-[84] transition-opacity duration-(--dur-prompt) ease-out', entered ? 'opacity-100' : 'opacity-0', !shown && 'pointer-events-none')}
    >
      {/* takes every click, the highlighted element's too, so nothing on the page fires mid-tour (only once it is on screen) */}
      {shown ? <div aria-hidden className="absolute inset-0" data-testid="coach-scrim" onMouseDown={(e) => e.preventDefault()} onPointerDown={nudge} /> : null}
      {geo ? (
        <div
          aria-hidden
          data-testid="coach-cutout"
          className={cn('pointer-events-none absolute', glide)}
          style={{ top: geo.cut.top, left: geo.cut.left, width: geo.cut.width, height: geo.cut.height, borderRadius: geo.radius, boxShadow: CUTOUT_SHADOW }}
        />
      ) : null}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="coach-mark"
        data-mark={step.id}
        className={cn('absolute w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-line-strong bg-surface-raised p-4 text-body text-fg shadow-pop', moving && 'transition-[top,left] duration-(--dur-slow) ease-out')}
        style={{ top: geo?.card.top ?? 0, left: geo?.card.left ?? 0, visibility: geo ? 'visible' : 'hidden' }}
      >
        {arrowSide && arrow !== null ? (
          <span
            aria-hidden
            data-testid="coach-arrow"
            data-side={arrowSide}
            className={cn('pointer-events-none absolute size-3 rotate-45 border-line-strong bg-surface-raised', ARROW[arrowSide])}
            style={arrowSide === 'top' || arrowSide === 'bottom' ? { left: arrow - 6 } : { top: arrow - 6 }}
          />
        ) : null}
        <div className="flex items-center gap-3">
          <p aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 text-caption font-bold text-muted tabular-nums" data-testid="coach-step">
            {stepLabel(index, count)}
          </p>
          {count > 1 ? (
            <span aria-hidden className="flex shrink-0 items-center gap-1" data-testid="coach-dots">
              {steps.map((s, i) => (
                <span key={s.id} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-(--dur-prompt)', i === index ? 'w-4 bg-accent' : i < index ? 'w-1.5 bg-muted' : 'w-1.5 bg-line-strong')} />
              ))}
            </span>
          ) : null}
        </div>
        <h2 id={titleId} className="mt-1 text-body-lg font-bold text-fg-heading">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1 text-body text-fg">
          {step.text}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {count > 1 ? (
            <button type="button" className="mr-auto rounded-sm text-caption text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none" onClick={() => onMove('skip')} data-testid="coach-skip">
              Skip tour
            </button>
          ) : (
            <span className="mr-auto" />
          )}
          {index > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => onMove('back')} data-testid="coach-back">
              Back
            </Button>
          ) : null}
          {step.confirm && onConfirm ? (
            <Button variant="secondary" size="sm" onClick={() => onConfirm(step)} data-testid="coach-confirm">
              {step.confirm.label}
            </Button>
          ) : null}
          <Button ref={primaryRef} variant="primary" size="sm" onClick={() => onMove('next')} data-testid="coach-next">
            {primaryLabel(index, count)}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
