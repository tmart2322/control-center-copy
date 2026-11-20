'use client';
/**
 * The chat dock (R-UI-10, UI-SPEC §3 / §6): a docked, non-modal panel. Resizable 360–560 px (default 420,
 * remembered), collapsible to a 44 px rail. At ≥ 1920 px the shell shows it as its own column; below that
 * it is a tab in the right rail (ChatTabPanel) with the AskBar always visible.
 *
 *   <ChatProvider>          // once, in the shell (optional: each export adds one if missing)
 *     <ChatDock />          // column mode
 *     <ChatTabPanel />      // rail-tab mode
 *     <AskBar onOpenChat={() => setRailTab('chat')} />
 *   </ChatProvider>
 *
 * v2: these are compatibility exports. ChatTabPanel now renders <AssistantPanel/> (the docked right
 * panel's Assistant tab); ChatDock keeps the resizable column around the same v2 thread and composer.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ChatThread } from '@/contract';
import { CHAT_KEYS, type ChatMessageView } from '@/client/chat';
import { readString, writeString } from '@/client/chat/storage';
import { Icon } from '@/ui';
import { AssistantSurfaceContext, useBaseSurface } from './assistant-context';
import { AssistantPanel } from './AssistantPanel';
import { CollapsedRail, ChatHeader, DOCK_DEFAULT, DOCK_MAX, DOCK_MIN, ResizeHandle, ThreadTabs } from './ChatDockParts';
import { MessageList } from './ChatMessages';
import { EnsureChatProvider, useChat, type ChatModel } from './ChatProvider';
import { ConnectedComposer } from './ConnectedComposer';
import v2 from './assistant.module.css';

export interface ChatDockViewProps {
  variant?: 'dock' | 'tab';
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (w: number) => void;
  onResizeReset?: () => void;
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  model: ChatModel;
  models: ChatModel[];
  onModelChange: (m: ChatModel) => void;
  onNewThread: () => void;
  threads: ChatThread[];
  threadId: string | null;
  onSelectThread: (id: string) => void;
  streamingThreadId?: string | null;
  messages: ChatMessageView[];
  loading?: boolean;
  loadError?: { message: string } | null;
  onReload?: () => void;
  notice?: string | null;
  onDismissNotice?: () => void;
  composer: ReactNode;
  status?: string;
  lastEvent?: string | null;
  className?: string;
}

/** Presentational dock: everything as props (the kit gallery renders it from fixtures). */
export function ChatDockView(p: ChatDockViewProps) {
  const variant = p.variant ?? 'dock';
  if (variant === 'dock' && p.collapsed) return <CollapsedRail onExpand={() => p.onExpand?.()} streaming={!!p.streamingThreadId} />;
  return (
    <aside
      data-chat-root
      data-chat-dock={variant}
      data-chat-status={p.status ?? 'idle'}
      data-chat-last-event={p.lastEvent ?? ''}
      aria-label="Assistant"
      className={`${v2.root} @container relative flex h-full min-h-0 flex-col bg-surface ${variant === 'dock' ? 'shrink-0 border-l border-line' : 'w-full'} ${p.className ?? ''}`}
      style={variant === 'dock' ? { width: p.width ?? DOCK_DEFAULT } : undefined}
    >
      {variant === 'dock' && p.onResize ? <ResizeHandle width={p.width ?? DOCK_DEFAULT} min={p.minWidth} max={p.maxWidth} onResize={p.onResize} onReset={p.onResizeReset} /> : null}
      <ChatHeader model={p.model} models={p.models} onModelChange={p.onModelChange} onNewThread={p.onNewThread} onCollapse={variant === 'dock' ? p.onCollapse : undefined} />
      <ThreadTabs threads={p.threads} threadId={p.threadId} onSelect={p.onSelectThread} streamingThreadId={p.streamingThreadId} />
      {p.notice ? (
        <div className="flex items-start gap-2 border-b border-line bg-info-50 px-3 py-1.5 text-caption text-info-700" role="status">
          <Icon name="info" size="xs" className="mt-0.5" />
          <span className="flex-1">{p.notice}</span>
          {p.onDismissNotice ? (
            <button type="button" onClick={p.onDismissNotice} aria-label="Dismiss" className="rounded-sm hover:bg-info-100">
              <Icon name="close" size="xs" />
            </button>
          ) : null}
        </div>
      ) : null}
      <MessageList messages={p.messages} loading={p.loading} error={p.loadError} onReload={p.onReload} />
      <div className={v2.composer}>{p.composer}</div>
    </aside>
  );
}

export { ConnectedComposer } from './ConnectedComposer';

export interface ChatDockProps {
  variant?: 'dock' | 'tab';
  /** Controlled width; otherwise remembered in localStorage. */
  width?: number;
  defaultWidth?: number;
  onWidthChange?: (w: number) => void;
  resizable?: boolean;
  collapsible?: boolean;
  className?: string;
}

function ConnectedDock({ variant = 'dock', width: controlled, defaultWidth = DOCK_DEFAULT, onWidthChange, resizable = true, collapsible = true, className }: ChatDockProps) {
  const chat = useChat();
  const s = chat.stream;
  const [width, setWidthState] = useState(controlled ?? defaultWidth);
  useEffect(() => {
    if (controlled !== undefined) return setWidthState(controlled);
    const saved = Number(readString(CHAT_KEYS.width));
    if (saved >= DOCK_MIN && saved <= DOCK_MAX) setWidthState(saved);
  }, [controlled]);
  const setWidth = (w: number) => {
    setWidthState(w);
    onWidthChange?.(w);
    if (controlled === undefined) writeString(CHAT_KEYS.width, String(w));
  };
  const surface = useBaseSurface();
  return (
    <AssistantSurfaceContext.Provider value={surface}>
    <ChatDockView
      variant={variant}
      width={width}
      onResize={resizable ? setWidth : undefined}
      onResizeReset={() => setWidth(defaultWidth)}
      collapsed={collapsible && chat.collapsed}
      onCollapse={collapsible ? () => chat.setCollapsed(true) : undefined}
      onExpand={() => chat.setCollapsed(false)}
      model={chat.model}
      models={chat.models}
      onModelChange={chat.setModel}
      onNewThread={() => {
        void chat.createThread().then((t) => {
          if (t) requestAnimationFrame(() => chat.composerRef.current?.focus());
        });
      }}
      threads={s.threads}
      threadId={s.threadId}
      onSelectThread={s.selectThread}
      streamingThreadId={s.streamingThreadId}
      messages={s.messages}
      loading={s.loading}
      loadError={s.loadError}
      onReload={s.reload}
      notice={s.notice}
      onDismissNotice={s.notice ? s.dismissNotice : undefined}
      composer={<ConnectedComposer variant="panel" />}
      status={s.status}
      lastEvent={s.lastEvent}
      className={className}
    />
    </AssistantSurfaceContext.Provider>
  );
}

/** Column-mode dock (≥ 1920 px), resizable and collapsible. */
export function ChatDock(props: Omit<ChatDockProps, 'variant'>) {
  return (
    <EnsureChatProvider>
      <ConnectedDock {...props} variant="dock" />
    </EnsureChatProvider>
  );
}

/** Rail-tab mode, kept for the shell until the swap: the v2 <AssistantPanel/>. */
export function ChatTabPanel({ className }: { className?: string }) {
  return <AssistantPanel className={className} />;
}
