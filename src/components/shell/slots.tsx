'use client';
/**
 * Slots pages use to place content in the chrome without owning it.
 *
 *   <NavStrip>{headerFacts}</NavStrip>
 *     → the topbar, right of the page title (small content: ≤ 4 short facts).
 *
 *   <RailPanel …>  v1 compatibility shim. v2 has no right rail (DESIGN-V2 principle 10): it renders
 *     nothing and warns once in dev. Detail goes to the docked panel (useRightPanel().openDetails).
 *
 * Children render through portals, so they keep the page's React context (queries, state).
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useShellOptional } from './ShellContext';

export interface RailPanelProps {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  count?: number;
  children: ReactNode;
}

/** @deprecated v1 rail host id; no element carries it in v2. */
export function railPanelDomId(id: string) {
  return `cc-rail-panel-${id}`;
}

let warned = false;

/** @deprecated v2 has no right rail: renders nothing. Move the content into the page or the docked panel. */
export function RailPanel({ id }: RailPanelProps) {
  useEffect(() => {
    if (warned || process.env.NODE_ENV !== 'development') return;
    warned = true;
    console.warn(`[shell] <RailPanel id="${id}"> is a no-op in v2 (no right rail). Render it in the page, or open Details with useRightPanel().`);
  }, [id]);
  return null;
}

export function NavStrip({ children }: { children: ReactNode }) {
  const shell = useShellOptional();
  const el = shell?.navStrip ?? null;
  if (!shell) return <>{children}</>;
  return el ? createPortal(children, el) : null;
}
