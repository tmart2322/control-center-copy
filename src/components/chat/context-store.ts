'use client';
/**
 * The focused-thing context other lanes hand to chat (UI-SPEC §6: "the focused card, row or page is
 * auto-attached as a removable ContextChip").
 *
 * A module-level store, so callers need no provider and no prop drilling:
 *
 *   import { setChatContext, useChatContext } from '@/components/chat';
 *   setChatContext({ kind: 'work_item', id: item.id, label: item.title });   // on focus / selection
 *   setChatContext(null);                                                       // on blur, if you own it
 *   useChatContext(account && { kind: 'account', id: account.id, label: account.name }); // declarative (pages)
 *
 * `kind` is a contract EntityType: the server validates context refs against it.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ContextRef, EntityType } from '@/contract';

export interface ChatContextInput {
  kind: EntityType;
  id: string;
  label: string;
  href?: string;
}

type Listener = () => void;
let current: ChatContextInput | null = null;
const listeners = new Set<Listener>();

function same(a: ChatContextInput | null, b: ChatContextInput | null) {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id && a.label === b.label);
}

export function setChatContext(next: ChatContextInput | null): void {
  if (same(current, next)) return;
  current = next ? { ...next } : null;
  for (const l of listeners) l();
}

export function getChatContext(): ChatContextInput | null {
  return current;
}

/** Clear only if `ref` is still the current context (safe in unmount cleanups). */
export function clearChatContext(ref?: Pick<ChatContextInput, 'kind' | 'id'>): void {
  if (!ref || (current && current.kind === ref.kind && current.id === ref.id)) setChatContext(null);
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChatContextValue(): ChatContextInput | null {
  return useSyncExternalStore(subscribe, getChatContext, () => null);
}

/** Returns the setter; stable identity, usable anywhere (also outside React). */
export function useSetChatContext(): typeof setChatContext {
  return setChatContext;
}

/** Declarative: attach while mounted (and while `ref` is non-null); detach on unmount. */
export function useChatContext(ref: ChatContextInput | null | false | undefined): void {
  const kind = ref ? ref.kind : null;
  const id = ref ? ref.id : null;
  const label = ref ? ref.label : null;
  const href = ref ? ref.href : undefined;
  useEffect(() => {
    if (!kind || !id || label === null) return;
    setChatContext({ kind, id, label, href });
    return () => clearChatContext({ kind, id });
  }, [kind, id, label, href]);
}

export function toContextRef(c: ChatContextInput, via: 'auto' | 'explicit' = 'auto'): ContextRef {
  return { type: c.kind, id: c.id, label: c.label, ...(c.href ? { href: c.href } : {}), via };
}
