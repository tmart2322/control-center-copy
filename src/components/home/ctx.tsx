'use client';
/** Home's shared view state: selection (the filled button follows it), the item open in the panel, actions. */
import { createContext, useContext, type ReactNode } from 'react';
import type { HomeSegment, HomeState, ReadInState } from '@/contract';
import { ReadInBadge } from '@/components/readin';
import type { HomeActions } from './useHomeActions';
import { stateGlyph, type HomeTarget } from './model';

export interface HomeView {
  tz: string | undefined;
  nowMs: number;
  /** The key holding the one filled button: the selection, else Do now #1 (null when the panel holds it). */
  primaryKey: string | null;
  selectedKey: string | null;
  openKey: string | null;
  /** Id of the entity open in Details (which draft of the Outbox card's queue is showing). */
  openEntityId: string | null;
  /** The docked panel is open (cards go compact). */
  panelOpen: boolean;
  select: (key: string) => void;
  /** Click / Enter: select it and open Details in the right panel (`entity`: one draft of the Outbox card's queue). */
  openTarget: (t: HomeTarget, entity?: HomeTarget['entity']) => void;
  target: (key: string) => HomeTarget | undefined;
  actions: HomeActions;
  /** Where "Move to …" (the quiet snooze, s) sends an item: "Fri 11/6", the working day after the one shown. */
  moveLabel: string;
  /** That day's working-hours start (ISO): a Log & fix row's "Not now" sets it aside until then. */
  moveAt?: string | null;
  /** The live layer's mark for a key: new (arrived), leaving (left elsewhere), gone (left, still open in the panel). */
  liveOf?: (key: string) => 'new' | 'leaving' | 'gone' | undefined;
}

const Ctx = createContext<HomeView | null>(null);

export function HomeViewProvider({ value, children }: { value: HomeView; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHomeView(): HomeView {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHomeView outside <HomeViewProvider>');
  return v;
}

/** Icon + word badge for a state (never color alone). */
export function StateBadge({ state, label, className }: { state: HomeState | null; label: string | null; className?: string }) {
  if (!state || !label) return null;
  const g = stateGlyph(state, label);
  return (
    <span className={`hm-badge${className ? ` ${className}` : ''}`} data-tone={state}>
      {g ? <span aria-hidden>{g}</span> : null}
      {label}
    </span>
  );
}

/** A sentence made of segments: bold anchors, optional state marks. */
export function Segments({ segs }: { segs: HomeSegment[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.em ? (
          <b key={i} data-mark={s.mark ?? undefined}>
            {s.text}
          </b>
        ) : s.mark ? (
          <span key={i} data-mark={s.mark}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/**
 * BE-READIN's badge ("✦ Read-in ready" / "✦ Reading in…"). Violet = AI, but only as the thing's one color
 * signal: next to a state color it is drawn as neutral text with the ✦ (`hm-readin-neutral`).
 */
export function ReadIn({ state, colored }: { state: ReadInState | undefined; colored: boolean }) {
  if (state !== 'ready' && state !== 'researching') return null;
  return (
    <span className={colored ? 'hm-readin' : 'hm-readin hm-readin-neutral'}>
      {' · '}
      <ReadInBadge state={state} />
    </span>
  );
}

