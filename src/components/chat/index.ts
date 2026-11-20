/**
 * Chat (R-UI-10): the assistant. Page and shell lanes import from here.
 *
 * v2 (DESIGN-V2):
 *   AssistantPanel          the docked right panel's Assistant tab (V2-SHELL mounts it)
 *   AssistantPage           the full page at /assistant: threads · conversation · In this thread · composer
 *   ChatProvider            mount once in the shell (each surface adds one if missing)
 *   setChatContext / useChatContext   what's in view, when a page has no right-panel entity
 *   focusChat / toggleChatFocus / CHAT_HOTKEY   ⌘J for the shell's key manager
 *
 * Compatibility (pre-v2 shell): ChatDock (resizable column), ChatTabPanel (= AssistantPanel), AskBar,
 * useChatPlacement / chatPlacementFor.
 */
export { ChatProvider, EnsureChatProvider, useChat, useOptionalChat, focusChat, toggleChatFocus, CHAT_HOTKEY, CHAT_MODELS, type ChatController, type ChatModel, type ChatProviderProps } from './ChatProvider';
export { AssistantPanel, AssistantPanelView, ThreadSwitcher, usePanelContextBridge, useAssistantThreadTitle, type AssistantPanelProps, type AssistantPanelViewProps } from './AssistantPanel';
export { AssistantPage, AssistantPageView, ThreadList, COMPOSER_PANE_MIN, type AssistantPageProps, type AssistantPageViewProps } from './AssistantPage';
export { ThreadContextPane } from './ThreadContextPane';
export { DraftCard, SessionCard, ScanRow, openDeepLink } from './ChatActionCards';
export { AssistantSurfaceContext, useAssistantSurface, useBaseSurface, scrollToMessage, type AssistantSurface } from './assistant-context';
export { useAssistantKeys } from './useAssistantKeys';
export { ChatIcon, type ChatIconName } from './icons';
export { threadTouched, toolSummaryLine, toolPhrase, toolVerb, scanViews, briefSummary, latestPendingProposal, latestUndoable, splitResources, type ThreadTouched, type ScanView } from './thread-model';
export { ChatDock, ChatTabPanel, ChatDockView, ConnectedComposer, type ChatDockProps, type ChatDockViewProps } from './ChatDock';
export { AskBar, type AskBarProps } from './AskBar';
export { ChatComposer, COMPOSER_FOOTNOTE, type ChatComposerProps, type ComposerModel } from './ChatComposer';
export { ChatHeader, ThreadTabs, CollapsedRail, ResizeHandle, DOCK_MIN, DOCK_MAX, DOCK_DEFAULT, RAIL_WIDTH } from './ChatDockParts';
export { MessageList, AssistantMessage, UserMessage, BriefCard, MarkdownBubble, InlineError, FollowUps, ChatEmptyState, type MessageListProps } from './ChatMessages';
export { ChatReceiptCard, ReceiptPart, type ChatReceiptCardProps, type ReceiptCardChange } from './ChatReceiptCard';
export { ChatProposalCard, ProposalPart, type ChatProposalCardProps } from './ChatProposalCard';
export { ChatResourceCard, ResourceList, EvidenceChips } from './ChatResourceCard';
export { ToolRows, ToolRow } from './ToolRows';
export { AssistantAvatar } from './AssistantAvatar';
export { ChatUiContext, useChatUi, type ChatUi } from './ui-context';
export { setChatContext, getChatContext, clearChatContext, useChatContext, useChatContextValue, useSetChatContext, type ChatContextInput } from './context-store';
export { useChatPlacement, chatPlacementFor, CHAT_COLUMN_MIN_VIEWPORT, type ChatPlacement } from './placement';
export { SLASH_COMMANDS, followUpsFor } from './commands';
export { renderMarkdown } from './markdown';
