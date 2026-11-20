'use client';
/**
 * What deep message parts (receipts, proposals, follow-ups, errors) need from their surroundings. The live
 * surfaces fill it from ChatProvider; the kit gallery and the /assistant dev preview fill it with local
 * state, so every card can be shown in every state without a server.
 */
import { createContext, useContext } from 'react';
import type { Proposal } from '@/contract';
import { EMPTY_ACTIONS, type ChatActionsState } from '@/client/chat';

export interface ChatUi {
  actions: ChatActionsState;
  undo: (auditIds: string[]) => void;
  apply: (p: Proposal) => void;
  dismiss: (p: Proposal) => void;
  retry: (opts?: { allowExtraUsd?: number }) => void;
  followUp: (text: string) => void;
  timeZone?: string;
  busy: boolean;
  /** Initial disclosure (previews and screenshots): tool lists open, briefs collapsed. */
  defaults?: { toolsOpen?: boolean; briefCollapsed?: boolean };
}

const noop = () => undefined;
export const ChatUiContext = createContext<ChatUi>({ actions: EMPTY_ACTIONS, undo: noop, apply: noop, dismiss: noop, retry: noop, followUp: noop, busy: false });

export function useChatUi(): ChatUi {
  return useContext(ChatUiContext);
}
