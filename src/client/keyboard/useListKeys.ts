'use client';
/**
 * List keyboard model (UI-SPEC §14): j/k move, Space expand, Enter side sheet, ⇧Enter full page,
 * ⌘↵ primary, single-key verbs (e a s d n x o r, ⇧D). Keys are live only while focus is inside the
 * list, or (for the page's `primary` list) while nothing else has focus.
 *
 *   const list = useListKeys({ scope: 'list:work', ids, activeId, onActiveChange: setActive,
 *     onOpen: openSheet, actions: { d: markDone, s: snooze } });
 *   <div {...list.containerProps}>{rows.map((r) => <Row key={r.id} {...list.rowProps(r.id)} />)}</div>
 */
import { useCallback, useEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';
import { useKeyBinding, useKeyScope } from './KeyboardProvider';

export type ListVerb = 'e' | 'a' | 's' | 'd' | 'n' | 'x' | 'o' | 'r' | 'shift+d' | '1' | '2' | '3';

export interface ListKeysOptions {
  scope: string;
  ids: string[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
  /** Also live when focus is on <body> (the page's main list). Default false. */
  primary?: boolean;
  /** Disable all keys (e.g. while loading). */
  enabled?: boolean;
  onExpand?: (id: string) => void;
  onOpen?: (id: string) => void;
  onOpenPage?: (id: string) => void;
  onPrimary?: (id: string) => void;
  actions?: Partial<Record<ListVerb, (id: string) => void>>;
  /** Move DOM focus to the row on j/k (default true). */
  moveFocus?: boolean;
}

function cssEscape(v: string) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"');
}

export function useListKeys(opts: ListKeysOptions) {
  const { scope, ids, activeId, onActiveChange, primary = false, enabled = true, moveFocus = true } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null) as RefObject<HTMLDivElement | null>;
  const [focusWithin, setFocusWithin] = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);

  useEffect(() => {
    if (!primary) return;
    const update = () => setBodyFocused(!document.activeElement || document.activeElement === document.body);
    const later = () => setTimeout(update, 0);
    update();
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
    };
  }, [primary]);

  const active = enabled && (focusWithin || (primary && bodyFocused));
  useKeyScope(scope, { active });

  const focusRow = useCallback(
    (id: string) => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-row-id="${cssEscape(id)}"]`);
      if (!el) return;
      if (moveFocus) el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    },
    [moveFocus],
  );

  const move = useCallback(
    (delta: number) => {
      if (!ids.length) return;
      const i = activeId ? ids.indexOf(activeId) : -1;
      const next = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? (delta > 0 ? 0 : ids.length - 1) : i + delta))]!;
      onActiveChange(next);
      requestAnimationFrame(() => focusRow(next));
    },
    [ids, activeId, onActiveChange, focusRow],
  );

  const withActive = (fn?: (id: string) => void) => () => {
    if (!fn || !activeId) return false;
    fn(activeId);
  };

  useKeyBinding(['j', 'down'], () => move(1), { scope, enabled: active });
  useKeyBinding(['k', 'up'], () => move(-1), { scope, enabled: active });
  useKeyBinding('space', withActive(opts.onExpand), { scope, enabled: active && !!opts.onExpand });
  useKeyBinding('enter', withActive(opts.onOpen), { scope, enabled: active && !!opts.onOpen });
  useKeyBinding('shift+enter', withActive(opts.onOpenPage), { scope, enabled: active && !!opts.onOpenPage });
  useKeyBinding('mod+enter', withActive(opts.onPrimary), { scope, enabled: active && !!opts.onPrimary });
  const actions = opts.actions ?? {};
  const verbs = Object.keys(actions) as ListVerb[];
  useKeyBinding(
    verbs.length ? verbs : ['__none__'],
    (e) => {
      const k = (e.shiftKey && e.key.toLowerCase() === 'd' ? 'shift+d' : e.key.toLowerCase()) as ListVerb;
      const fn = actions[k];
      if (!fn) return false;
      if (['1', '2', '3'].includes(k)) {
        const id = ids[Number(k) - 1];
        if (!id) return false;
        onActiveChange(id);
        requestAnimationFrame(() => focusRow(id));
        fn(id);
        return;
      }
      if (!activeId) return false;
      fn(activeId);
    },
    { scope, enabled: active && verbs.length > 0 },
  );

  const containerProps = {
    ref: containerRef,
    'data-key-scope': scope,
    onFocus: () => setFocusWithin(true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
    },
  };

  const rowProps = (id: string) => ({
    'data-row-id': id,
    'data-active': id === activeId ? '' : undefined,
    'aria-current': id === activeId ? ('true' as const) : undefined,
    tabIndex: id === activeId || (!activeId && id === ids[0]) ? 0 : -1,
    onFocus: () => {
      if (id !== activeId) onActiveChange(id);
    },
  });

  return { containerProps, rowProps, move, focusRow, active };
}
