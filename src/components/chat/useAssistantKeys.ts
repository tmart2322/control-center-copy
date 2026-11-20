'use client';
/**
 * Assistant keys (v2): ⌘↵ applies the focused proposal (or the newest pending one), `z` undoes the newest
 * live change in the thread, Esc closes the panel. Typing is never hijacked: a composer with text keeps
 * ⌘↵ (send), and `z` only counts outside inputs.
 */
import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ChatMessageView } from '@/client/chat';
import { useCommands } from '@/client/keyboard';
import { latestPendingProposal, latestUndoable } from './thread-model';
import { useChatUi } from './ui-context';

const typingIn = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable="true"]');

export function useAssistantKeys(messages: ChatMessageView[], opts: { onClose?: () => void } = {}) {
  const ui = useChatUi();
  const { onClose } = opts;

  /** Returns true when the key was handled. Usable from a React onKeyDown or a document listener. */
  const handle = useCallback(
    (e: KeyboardEvent | ReactKeyboardEvent): boolean => {
      if (e.defaultPrevented) return false;
      const target = e.target as HTMLElement | null;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (target instanceof HTMLTextAreaElement && target.value.trim()) return false;
        const focusedId = target?.closest<HTMLElement>('[data-proposal]')?.dataset.proposal;
        const focused = focusedId ? messages.flatMap((m) => m.proposals).find((p) => p.proposal.id === focusedId)?.proposal : null;
        const p = focused ?? latestPendingProposal(messages, ui.actions);
        if (!p) return false;
        e.preventDefault();
        ui.apply(p);
        return true;
      }
      if ((e.key === 'z' || e.key === 'Z') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !typingIn(target)) {
        const ids = latestUndoable(messages, ui.actions);
        if (!ids) return false;
        e.preventDefault();
        ui.undo(ids);
        return true;
      }
      if (e.key === 'Escape' && onClose && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onClose();
        return true;
      }
      return false;
    },
    [messages, ui, onClose],
  );

  return handle;
}

/** The same actions in ⌘K (BUILD-V2: every action reachable by keyboard and in the palette). */
export function useAssistantCommands(messages: ChatMessageView[], opts: { onNewThread: () => void; onFocus?: () => void; switchSurface?: { title: string; run: () => void } }) {
  const ui = useChatUi();
  const pending = latestPendingProposal(messages, ui.actions);
  const undoable = latestUndoable(messages, ui.actions);
  useCommands([
    { id: 'assistant.ask', title: 'Ask the assistant', group: 'Assistant', shortcut: 'mod+j', keywords: ['chat', 'claude'], run: () => opts.onFocus?.() },
    { id: 'assistant.new-thread', title: 'New assistant thread', group: 'Assistant', keywords: ['chat', 'conversation'], run: opts.onNewThread },
    { id: 'assistant.apply', title: 'Apply the proposed change', subtitle: pending ? (pending.reason || pending.entity.label) : 'No proposal waiting', group: 'Assistant', shortcut: 'mod+enter', disabled: !pending, run: () => pending && ui.apply(pending) },
    { id: 'assistant.undo', title: 'Undo the assistant’s last change', group: 'Assistant', shortcut: 'z', disabled: !undoable, run: () => undoable && ui.undo(undoable) },
    ...(opts.switchSurface ? [{ id: 'assistant.switch', title: opts.switchSurface.title, group: 'Assistant', run: opts.switchSurface.run }] : []),
  ]);
}
