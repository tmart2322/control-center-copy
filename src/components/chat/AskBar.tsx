'use client';
/**
 * The ask bar (UI-SPEC §3/§4.4): always visible at the bottom of the right rail below 1920 px, so chat is
 * one keystroke away even while the rail shows Status. It shares the active thread's draft and context with
 * the dock; sending hands off to the Chat tab via `onOpenChat`.
 */
import { useEffect, useState } from 'react';
import { Icon, Kbd } from '@/ui';
import { AssistantAvatar } from './AssistantAvatar';
import { EnsureChatProvider, useChat } from './ChatProvider';
import styles from './chat.module.css';

export interface AskBarProps {
  /** Show the chat (switch the rail to its Chat tab). Called on send and on "Open". */
  onOpenChat?: () => void;
  placeholder?: string;
  className?: string;
}

function ConnectedAskBar({ onOpenChat, placeholder = 'Ask or tell…', className = '' }: AskBarProps) {
  const chat = useChat();
  const s = chat.stream;
  const last = s.messages.at(-1);
  const receiptCount = last?.role === 'assistant' ? last.receipts.reduce((n, r) => n + r.changes.length, 0) : 0;
  const [justSent, setJustSent] = useState(false);
  useEffect(() => {
    if (!s.busy) setJustSent(false);
  }, [s.busy]);

  const submit = () => {
    const text = s.draft.trim();
    if (!text || s.busy) return;
    if (chat.sendMessage(text)) {
      setJustSent(true);
      onOpenChat?.();
    }
  };

  return (
    <div data-chat-root data-chat-askbar className={`flex flex-col gap-1 ${className}`}>
      {chat.autoContext ? <p className="truncate px-1 text-caption text-muted">In view: {chat.autoContext.label}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex h-10 items-center gap-2 rounded-full border border-line-input bg-surface pl-1.5 pr-1 transition-shadow duration-(--dur-quick) focus-within:border-brand-600 focus-within:shadow-[0_0_0_1px_var(--color-brand-600)]"
      >
        <AssistantAvatar size={28} />
        <input
          ref={chat.askRef}
          value={s.draft}
          onChange={(e) => s.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              chat.returnFocus();
            }
          }}
          placeholder={placeholder}
          aria-label="Ask the assistant"
          className="min-w-0 flex-1 bg-transparent text-body-lg text-fg outline-none placeholder:text-faint"
          data-askbar-input
        />
        {!s.draft ? <Kbd className="mr-1">⌘J</Kbd> : null}
        <button type="submit" disabled={!s.draft.trim() || s.busy} className="grid size-8 place-items-center rounded-full text-brand-600 hover:bg-brand-50 disabled:text-ink-300 disabled:hover:bg-transparent" aria-label="Send">
          <Icon name="send" size="md" />
        </button>
      </form>
      {s.busy || justSent ? (
        <button type="button" onClick={onOpenChat} className="flex items-center gap-1.5 px-1 text-left text-caption text-muted hover:text-fg">
          <span className={`size-1.5 rounded-full bg-brand-600 ${styles.running}`} aria-hidden /> Answering… <span className="text-link">Open chat</span>
        </button>
      ) : receiptCount ? (
        <button type="button" onClick={onOpenChat} className="flex items-center gap-1.5 px-1 text-left text-caption text-muted hover:text-fg">
          <Icon name="check" size="xs" className="text-success-700" /> Changed {receiptCount} thing{receiptCount === 1 ? '' : 's'} · <span className="text-link">Review or undo</span>
        </button>
      ) : null}
    </div>
  );
}

export function AskBar(props: AskBarProps) {
  return (
    <EnsureChatProvider>
      <ConnectedAskBar {...props} />
    </EnsureChatProvider>
  );
}
