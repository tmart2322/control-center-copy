'use client';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Live content-box width of an element (0 before the first layout). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
