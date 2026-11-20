'use client';
/**
 * Today's keyboard (UI-SPEC §14, BUILD-V2): one selection across Run of day → Fit-ins → Pull forward →
 * Promises. j/k only move the selection · 1 2 3 jump to the first run rows · Enter opens Details in the
 * right panel · ⇧Enter the full page · Space shows the full why · ⌘↵ the primary action ·
 * e a s d ⇧D n o act on the selected row · r re-rank · w waiting on you · z undo (toast first, then the
 * newest Closed-for-you) · ⇧A accept the agent's plan · p the plan tab.
 *
 * The scope is live while focus is on the page or nowhere; a focused button keeps its own Enter / Space,
 * and the panel, popovers and dialogs push their own scopes.
 */
import { useEffect, useState } from 'react';
import { useKeyBinding, useKeyScope } from '@/client/keyboard';

export const TODAY_SCOPE = 'page:today';
const REGION = '[data-today-root]';

export interface TodayKeyHandlers {
  move: (delta: number) => void;
  jump: (n: number) => boolean | void;
  open: (mode: 'details' | 'page') => boolean | void;
  expand: () => boolean | void;
  primary: () => boolean | void;
  edit: () => boolean | void;
  accept: () => boolean | void;
  snooze: () => boolean | void;
  done: () => boolean | void;
  resolve: () => boolean | void;
  notNow: () => boolean | void;
  openSource: () => boolean | void;
  rerank: () => void;
  waiting: () => boolean | void;
  /** Return false to let the next handler (the toast stack) take `z`. */
  undo: () => boolean | void;
  acceptPlan: () => boolean | void;
  togglePlan: () => boolean | void;
}

function focusState(): 'body' | 'inside' | 'outside' {
  if (typeof document === 'undefined') return 'outside';
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return 'body';
  if (el.closest(REGION)) return 'inside';
  // A toast you just clicked (Undo) is neutral: page keys keep working.
  return el.closest('[aria-live]') ? 'body' : 'outside';
}

/** True while DOM focus is on the page (or on nothing). */
export function useTodayFocus(): 'body' | 'inside' | 'outside' {
  const [state, setState] = useState<'body' | 'inside' | 'outside'>('body');
  useEffect(() => {
    const update = () => setState(focusState());
    const later = () => setTimeout(update, 0);
    update();
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return state;
}

/** Enter / Space belong to a focused control unless the focus is a row (or nothing). */
function onRowOrBody(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return true;
  if (el.matches('[data-row-key]')) return true;
  return !el.matches('button,a,[role="button"],summary,select,input,textarea,[contenteditable="true"]');
}

export function useTodayKeys(enabled: boolean, h: TodayKeyHandlers) {
  const focus = useTodayFocus();
  const live = enabled && focus !== 'outside';
  useKeyScope(TODAY_SCOPE, { active: live });
  const opts = { scope: TODAY_SCOPE, enabled: live };

  useKeyBinding(['j', 'down'], () => h.move(1), opts);
  useKeyBinding(['k', 'up'], () => h.move(-1), opts);
  useKeyBinding(['1', '2', '3'], (e) => h.jump(Number(e.key)), opts);
  useKeyBinding('space', () => (onRowOrBody() ? h.expand() : false), opts);
  useKeyBinding('enter', () => (onRowOrBody() ? h.open('details') : false), opts);
  useKeyBinding('shift+enter', () => h.open('page'), opts);
  useKeyBinding('mod+enter', () => h.primary(), opts);
  useKeyBinding('e', () => h.edit(), opts);
  useKeyBinding('a', () => h.accept(), opts);
  useKeyBinding('s', () => h.snooze(), opts);
  useKeyBinding('d', () => h.done(), opts);
  useKeyBinding('shift+d', () => h.resolve(), opts);
  useKeyBinding('n', () => h.notNow(), opts);
  useKeyBinding('o', () => h.openSource(), opts);
  useKeyBinding('r', () => h.rerank(), opts);
  useKeyBinding('w', () => h.waiting(), opts);
  useKeyBinding('z', () => h.undo(), opts);
  useKeyBinding('shift+a', () => h.acceptPlan(), opts);
  useKeyBinding('p', () => h.togglePlan(), opts);

  return { focus, live };
}
