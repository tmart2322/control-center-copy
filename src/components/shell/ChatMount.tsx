'use client';
/**
 * Chat in the shell. The docked panel's Assistant tab renders the frame's `chatRail` slot, which the
 * root layout fills with <ChatRail/> = P-CHAT's <AssistantPanel/>. There is no other chat surface in the
 * frame (the v1 ChatDock rail is gone); /assistant renders <AssistantPage/> as the page itself.
 *
 * ⌘J belongs to the shell's key manager (ChatProvider is mounted with registerHotkey={false}): it
 * calls useRightPanel().toggleAssistant / shell.focusChat, which focus the composer via focusChat().
 */
import { useEffect } from 'react';
import { AssistantPanel, focusChat } from '@/components/chat';
import { useShell } from './ShellContext';

export function ChatRail() {
  const { registerChatFocus } = useShell();
  useEffect(() => registerChatFocus(focusChat), [registerChatFocus]);
  return <AssistantPanel className="min-h-0 flex-1" />;
}
