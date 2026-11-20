'use client';
/**
 * Dock chrome: header (identity, model switch, New thread, collapse), thread tabs, the 44 px collapsed rail
 * and the resize handle. Presentational; ChatDock wires them to the provider.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ChatThread } from '@/contract';
import { Button, Icon, IconButton, Kbd, Popover } from '@/ui';
import { AssistantAvatar } from './AssistantAvatar';
import type { ChatModel } from './ChatProvider';
import styles from './chat.module.css';

export const DOCK_MIN = 360;
export const DOCK_MAX = 560;
export const DOCK_DEFAULT = 420;
export const RAIL_WIDTH = 44;

export interface ChatHeaderProps {
  model: ChatModel;
  models: ChatModel[];
  onModelChange: (m: ChatModel) => void;
  onNewThread: () => void;
  onCollapse?: () => void;
}

export function ChatHeader({ model, models, onModelChange, onNewThread, onCollapse }: ChatHeaderProps) {
  const [open, setOpen] = useState(false);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <AssistantAvatar size={28} />
      <div className="flex min-w-0 flex-col leading-none">
        <h2 className="text-body-lg font-bold text-fg-heading">Assistant</h2>
        <Popover
          open={open}
          onOpenChange={setOpen}
          placement="bottom-start"
          className="w-56 py-1"
          label="Model"
          role="menu"
          trigger={
            <button
              type="button"
              className="-ml-0.5 inline-flex items-center gap-0.5 rounded-sm px-0.5 text-caption text-muted hover:text-fg"
              data-model={model}
            >
              Claude · {model}
              <Icon name="chevrondown" size="xs" />
            </button>
          }
        >
          <div role="group" aria-label="Model">
            {models.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={m === model}
                onClick={() => {
                  onModelChange(m);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body hover:bg-brand-50"
              >
                <span className="w-3.5">{m === model ? <Icon name="check" size="xs" className="text-brand-700" /> : null}</span>
                <span className="flex-1">Claude {m}</span>
                <span className="text-caption text-muted">{m === 'Opus' ? 'deeper' : 'faster'}</span>
              </button>
            ))}
            <p className="border-t border-line px-3 pt-1.5 pb-1 text-caption text-muted">For new messages in every thread.</p>
          </div>
        </Popover>
      </div>
      <span className="ml-auto flex items-center gap-1">
        <Button variant="secondary" size="sm" icon="add" onClick={onNewThread} data-new-thread>
          New
        </Button>
        {onCollapse ? <IconButton icon="toggle_panel_right" label="Collapse assistant" size="sm" onClick={onCollapse} title="Collapse  ]" /> : null}
      </span>
    </header>
  );
}

export interface ThreadTabsProps {
  threads: ChatThread[];
  threadId: string | null;
  onSelect: (id: string) => void;
  streamingThreadId?: string | null;
}

export function ThreadTabs({ threads, threadId, onSelect, streamingThreadId }: ThreadTabsProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = threads.findIndex((t) => t.id === threadId);
    const next = threads[(i + (e.key === 'ArrowRight' ? 1 : threads.length - 1)) % threads.length];
    if (next) {
      e.preventDefault();
      onSelect(next.id);
      requestAnimationFrame(() => (e.currentTarget.querySelector(`[data-thread-id="${next.id}"]`) as HTMLElement | null)?.focus());
    }
  };
  if (!threads.length) return <div className="h-8 shrink-0 border-b border-line" />;
  return (
    <div role="tablist" aria-label="Threads" onKeyDown={onKeyDown} className={`${styles.scroll} flex h-8 shrink-0 items-stretch gap-3 overflow-x-auto border-b border-line px-3`}>
      {threads.map((t) => {
        const active = t.id === threadId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(t.id)}
            data-thread-id={t.id}
            title={t.lastMessagePreview ?? t.title}
            className={`relative inline-flex max-w-[11rem] shrink-0 items-center gap-1.5 text-body ${active ? 'font-bold text-fg-heading' : 'text-muted hover:text-fg'}`}
          >
            <span className="truncate">{t.title}</span>
            {streamingThreadId === t.id ? <span className={`size-1.5 rounded-full bg-brand-600 ${styles.running}`} aria-label="Answering" /> : null}
            {active ? <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-sm bg-brand-600" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function CollapsedRail({ onExpand, streaming }: { onExpand: () => void; streaming?: boolean }) {
  return (
    <aside data-chat-root data-chat-rail className="flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l border-line bg-surface py-2" aria-label="Assistant (collapsed)">
      <button type="button" onClick={onExpand} className="relative rounded-full focus-visible:shadow-focus" aria-label="Open assistant (⌘J)" title="Assistant  ⌘J">
        <AssistantAvatar size={28} />
        {streaming ? <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-surface bg-brand-600 ${styles.running}`} aria-hidden /> : null}
      </button>
      <button type="button" onClick={onExpand} className={`${styles.vertical} text-caption font-bold text-muted hover:text-fg`}>
        Assistant
      </button>
      <span className="mt-auto flex flex-col items-center gap-2">
        <Kbd>⌘J</Kbd>
        <IconButton icon="toggle_panel_left" label="Expand assistant" size="sm" onClick={onExpand} />
      </span>
    </aside>
  );
}

export function ResizeHandle({ width, min = DOCK_MIN, max = DOCK_MAX, onResize, onReset }: { width: number; min?: number; max?: number; onResize: (w: number) => void; onReset?: () => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max, w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize assistant"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(clamp(drag.current.w + (drag.current.x - e.clientX)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowLeft') onResize(clamp(width + step));
        else if (e.key === 'ArrowRight') onResize(clamp(width - step));
        else if (e.key === 'Home') onResize(min);
        else if (e.key === 'End') onResize(max);
        else return;
        e.preventDefault();
      }}
      className="group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none"
      title="Drag to resize · double-click to reset"
      data-chat-resize
    >
      <span className="absolute inset-y-0 left-[3px] w-0.5 rounded-full bg-transparent transition-colors duration-(--dur-quick) group-hover:bg-brand-300 group-focus-visible:bg-brand-600 group-active:bg-brand-600" />
    </div>
  );
}
