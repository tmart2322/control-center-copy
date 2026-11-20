'use client';
/**
 * Where chat lives at this width (UI-SPEC §3): its own column at ≥ 1920 px, else a tab in the right rail.
 * The shell decides; this is the shared breakpoint so every lane agrees.
 */
import { useSyncExternalStore } from 'react';

export const CHAT_COLUMN_MIN_VIEWPORT = 1920;
export type ChatPlacement = 'column' | 'tab';

export function chatPlacementFor(viewportWidth: number): ChatPlacement {
  return viewportWidth >= CHAT_COLUMN_MIN_VIEWPORT ? 'column' : 'tab';
}

const query = `(min-width: ${CHAT_COLUMN_MIN_VIEWPORT}px)`;

export function useChatPlacement(): ChatPlacement {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => (window.matchMedia(query).matches ? 'column' : 'tab'),
    () => 'tab',
  );
}
