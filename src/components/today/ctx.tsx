'use client';
/** Shared Today state and handlers (one provider in TodayPage; the panes and popovers read it). */
import { createContext, useContext } from 'react';
import type { NowCard, TodayPayload } from '@/contract';
import type { PanelEntity } from '@/components/shell/panel';
import type { TodayActions } from './useTodayActions';

export type PopoverKind = 'snooze' | 'resolve' | 'tool';
export type Surface = 'run' | 'fit' | 'pull' | 'promise';
export interface PopoverState {
  kind: PopoverKind;
  itemId: string;
  surface: Surface;
}

export interface TodayCtx {
  now: string;
  tz?: string;
  data: TodayPayload;
  actions: TodayActions;
  popover: PopoverState | null;
  setPopover: (p: PopoverState | null) => void;
  /** Close a popover and put focus back on the row it belongs to. */
  closePopover: () => void;
  /** People and sibling items for the resolve picker. */
  relatedItems: Array<{ id: string; title: string }>;
  /** The NOW card for an item if it is on screen (tool form, primary action). */
  cardFor: (itemId: string) => NowCard | null;
  /** Click / Enter on any row or block: the docked right panel's Details tab. */
  openDetails: (entity: PanelEntity) => void;
  navigate: (href: string) => void;
}

const Ctx = createContext<TodayCtx | null>(null);
export const TodayProvider = Ctx.Provider;

export function useToday(): TodayCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToday() needs <TodayProvider>');
  return c;
}
