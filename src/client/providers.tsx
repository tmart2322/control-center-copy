'use client';
/**
 * App providers: TanStack Query, live invalidation, the key manager, the ⌘K command registry and
 * the toast stack. The shell (AppFrame) adds layout-level context on top (rails, sheets, prefs).
 */
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { CommandRegistryProvider } from './keyboard/commands';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { idsOfInput, installGestureTracking, noteLocalWrite } from './intent';
import { subscribeLive, useLiveEvents, type LiveStatus } from './live';
import { Toaster } from './toast/Toaster';
import { toast } from './toast/store';

const LiveStatusContext = createContext<LiveStatus>('connecting');

/** SSE connection state ('connecting' | 'open' | 'reconnecting' | 'closed') for the scanner pulse. */
export function useLiveStatus(): LiveStatus {
  return useContext(LiveStatusContext);
}

/**
 * Routes LiveEvent notify hints to their single channel (UI-SPEC §9). Only `toast` and `os` are
 * handled here; `rail` and `banner` are rendered by the panels that own them from fresh data.
 * A `toast` hint is only ever set on events the user caused (a tool run they started finished, a send they approved
 * verified): background events never toast (docs/UX.md "Live updates").
 */
function LiveBridge({ children }: { children: ReactNode }) {
  const status = useLiveEvents();
  useEffect(() => installGestureTracking(), []);
  useEffect(
    () =>
      subscribeLive((ev) => {
        const n = ev.notify;
        if (!n) return;
        if (n.channel === 'toast') {
          toast({
            key: `live:${ev.reason}:${ev.ids.join(',')}`,
            title: n.title,
            body: n.body,
            tone: n.tone === 'ok' ? 'success' : n.tone === 'risk' ? 'error' : n.tone === 'warn' ? 'warning' : 'info',
            action: n.href ? { label: 'View', href: n.href } : undefined,
          });
        } else if (n.channel === 'os' && typeof document !== 'undefined' && document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          // macOS notification only when the app isn't focused, and only with prior permission.
          new Notification(n.title, { body: n.body, tag: `${ev.reason}:${ev.ids.join(',')}` });
        }
      }),
    [],
  );
  return <LiveStatusContext.Provider value={status}>{children}</LiveStatusContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // Every mutation notes the ids it names before its optimistic patch: a row it removes leaves as "mine"
        // (at once, the panel moves on), not as "changed elsewhere" (src/client/intent.ts).
        mutationCache: new MutationCache({ onMutate: (variables) => noteLocalWrite(idsOfInput(variables)) }),
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => count < 2 && (err as { retryable?: boolean }).retryable !== false,
          },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <KeyboardProvider>
        <CommandRegistryProvider>
          <LiveBridge>
            {children}
            <Toaster />
          </LiveBridge>
        </CommandRegistryProvider>
      </KeyboardProvider>
    </QueryClientProvider>
  );
}
