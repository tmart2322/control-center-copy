'use client';
/** The composer wired to the provider: shared per-thread draft, context chips, model, ↑ edit, ⌘J/Esc focus. */
import { ChatComposer } from './ChatComposer';
import { useChat } from './ChatProvider';
import { EMPTY_SUGGESTIONS, followUpsFor } from './commands';

export function ConnectedComposer({
  footnote = true,
  variant,
  onEscape,
}: {
  footnote?: boolean;
  /** v2 surfaces: suggestion chips under the box; page = two-column commands. */
  variant?: 'panel' | 'page';
  onEscape?: () => void;
}) {
  const chat = useChat();
  const s = chat.stream;
  const lastAnswer = [...s.messages].reverse().find((m) => m.role === 'assistant' && !m.streaming);
  const follow = lastAnswer && !s.busy ? followUpsFor(lastAnswer) : [];
  const suggestions = (follow.length ? follow : EMPTY_SUGGESTIONS).slice(0, 3);
  return (
    <ChatComposer
      value={s.draft}
      onChange={s.setDraft}
      onSend={(t) => chat.sendMessage(t)}
      onStop={s.stop}
      busy={s.busy}
      autoContext={chat.autoContext}
      onRemoveAuto={chat.dismissAutoContext}
      restorable={chat.restorableContext}
      onRestoreAuto={chat.restoreAutoContext}
      explicitContext={chat.explicitContext}
      onAddContext={chat.addContext}
      onRemoveContext={chat.removeContext}
      inputRef={chat.composerRef}
      onEscape={onEscape ?? chat.returnFocus}
      footnote={footnote}
      model={chat.model}
      models={chat.models}
      onModelChange={chat.setModel}
      onEditLast={chat.editLast}
      onEditEnd={chat.endEdit}
      suggestions={variant ? suggestions : []}
      variant={variant ?? 'panel'}
    />
  );
}
