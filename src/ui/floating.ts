'use client';
/**
 * Minimal anchored positioning for tooltips, popovers and menus: place next to an anchor, flip
 * when it would overflow, clamp to the viewport. Recomputes on scroll (any ancestor) and resize.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';
export type Placement = Side | `${Side}-${Exclude<Align, 'center'>}`;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function splitPlacement(p: Placement): { side: Side; align: Align } {
  const [side, align] = p.split('-') as [Side, Align | undefined];
  return { side, align: align ?? 'center' };
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function place(anchor: Rect, size: { width: number; height: number }, side: Side, align: Align, offset: number) {
  let top = 0;
  let left = 0;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? anchor.top - size.height - offset : anchor.top + anchor.height + offset;
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.left + anchor.width - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = side === 'left' ? anchor.left - size.width - offset : anchor.left + anchor.width + offset;
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.top + anchor.height - size.height : anchor.top + anchor.height / 2 - size.height / 2;
  }
  return { top, left };
}

/** Pure: compute a fixed-position box for `size` next to `anchor` inside `viewport`. */
export function computePosition(
  anchor: Rect,
  size: { width: number; height: number },
  placement: Placement,
  viewport: { width: number; height: number },
  offset = 6,
  padding = 8,
): { top: number; left: number; side: Side } {
  const { side, align } = splitPlacement(placement);
  let s = side;
  let pos = place(anchor, size, s, align, offset);
  const overflows = (p: { top: number; left: number }, sd: Side) =>
    sd === 'top' ? p.top < padding : sd === 'bottom' ? p.top + size.height > viewport.height - padding : sd === 'left' ? p.left < padding : p.left + size.width > viewport.width - padding;
  if (overflows(pos, s)) {
    const flipped = place(anchor, size, OPPOSITE[s], align, offset);
    if (!overflows(flipped, OPPOSITE[s])) {
      s = OPPOSITE[s];
      pos = flipped;
    }
  }
  const left = Math.min(Math.max(padding, pos.left), Math.max(padding, viewport.width - size.width - padding));
  const top = Math.min(Math.max(padding, pos.top), Math.max(padding, viewport.height - size.height - padding));
  return { top, left, side: s };
}

export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  placement: Placement,
  offset = 6,
) {
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    let frame = 0;
    let tries = 0;
    let observed: HTMLElement | null = null;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null;
    const update = () => {
      const a = anchorRef.current;
      const f = floatingRef.current;
      if (!a || !f) {
        // The floating element mounts through a portal one frame later; keep trying briefly.
        if (tries++ < 30) frame = requestAnimationFrame(update);
        return;
      }
      if (observed !== f) {
        if (observed) ro?.unobserve(observed);
        ro?.observe(f);
        observed = f;
      }
      const r = a.getBoundingClientRect();
      setPos(computePosition({ top: r.top, left: r.left, width: r.width, height: r.height }, { width: f.offsetWidth, height: f.offsetHeight }, placement, { width: window.innerWidth, height: window.innerHeight }, offset));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open, anchorRef, floatingRef, placement, offset]);
  return pos;
}
