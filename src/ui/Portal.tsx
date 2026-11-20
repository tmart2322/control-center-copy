'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Render into document.body (or a target element / element id) after mount. */
export function Portal({ children, target }: { children: ReactNode; target?: HTMLElement | string | null }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (target === null) return setEl(null);
    if (typeof target === 'string') setEl(document.getElementById(target));
    else setEl(target ?? document.body);
  }, [target]);
  return el ? createPortal(children, el) : null;
}
