'use client';
/**
 * <AssistantPage/> at /assistant (v2 mockup chat.html): the assistant as a full page.
 *
 *   threads | conversation (a ≤ 760 px reading column) | In this thread | composer (≥ 2,400 px)
 *
 * Width becomes panes, never longer lines. Below ~1,600 px the context pane drops; at 2,400 px and wider
 * the draft you open sits in the real composer next to the thread, and its in-thread card goes quiet.
 * Keys: ⌘↵ applies the focused proposal, z undoes, ↑ edits your last message.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatThread, Draft } from '@/contract';
import type { ChatMessageView } from '@/client/chat';
import { Button, PanelBoundary, useNow } from '@/ui';
import { Composer } from '@/components/composer';
import { useRightPanel } from '@/components/shell/panel';
import { AssistantSurfaceContext, useBaseSurface, type AssistantSurface } from './assistant-context';
import { usePanelContextBridge } from './AssistantPanel';
import { MessageList } from './ChatMessages';
import { EnsureChatProvider, useChat } from './ChatProvider';
import { ConnectedComposer } from './ConnectedComposer';
import { fmtAgoShort, fmtTime, threadTitle } from './format';
import { ChatIcon } from './icons';
import { threadTouched } from './thread-model';
import { ThreadContextPane } from './ThreadContextPane';
import { useAssistantCommands, useAssistantKeys } from './useAssistantKeys';
import { useChatUi } from './ui-context';
import s from './assistant.module.css';
import { navigate } from '@/components/shell/router';

/** Content width at which the composer pane appears (≈ a 2,400 px viewport minus the sidebar). */
export const COMPOSER_PANE_MIN = 2100;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── Threads ──────────────────────────────────────────────────────────────────────────────────

export function ThreadList({
  threads,
  threadId,
  onSelect,
  onNew,
  creating,
  streamingThreadId,
  now,
  tz,
}: {
  threads: ChatThread[];
  threadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  creating?: boolean;
  streamingThreadId?: string | null;
  now: Date;
  tz?: string;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const match = (t: ChatThread) => !needle || `${t.title} ${t.lastMessagePreview ?? ''}`.toLowerCase().includes(needle);
  const today = threads.filter((t) => t.isDefault && match(t));
  const topics = threads.filter((t) => !t.isDefault && match(t)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const item = (t: ChatThread) => (
    <button key={t.id} type="button" className={s.thItem} aria-current={t.id === threadId} onClick={() => onSelect(t.id)} data-thread-id={t.id}>
      <span className={s.t}>{threadTitle(t, now, tz)}</span>
      <span className={s.w}>{fmtAgoShort(t.updatedAt, now, tz)}</span>
      <span className={s.p}>
        {streamingThreadId === t.id ? (
          <span className={s.run}>
            <span className={`${s.dot} ${s.run}`} aria-hidden /> answering…
          </span>
        ) : (
          (t.lastMessagePreview ?? (t.messageCount ? `${t.messageCount} messages` : 'Empty'))
        )}
      </span>
    </button>
  );
  return (
    <nav className={s.th} aria-label="Threads" data-thread-list>
      <div className={s.thHead}>
        <h2>Threads</h2>
        <Button variant="secondary" size="sm" onClick={onNew} loading={creating} data-new-thread>
          <ChatIcon name="plus" size={14} /> New thread
        </Button>
      </div>
      <label className={s.thSearch}>
        <ChatIcon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threads" aria-label="Search threads" />
      </label>
      <div className={s.thList}>
        {today.length ? <div className={s.thGroup}>Today</div> : null}
        {today.map(item)}
        {topics.length ? <div className={s.thGroup}>Topics</div> : null}
        {topics.map(item)}
        {!today.length && !topics.length ? <p className={s.cxEmpty}>{needle ? `No thread matches “${q}”.` : 'No threads yet.'}</p> : null}
      </div>
    </nav>
  );
}

// ── Composer pane (≥ 2,400 px) ───────────────────────────────────────────────────────────────

function ComposerPane({ draftId, label, onClose }: { draftId: string; label: string; onClose: () => void }) {
  return (
    <section className={`${s.pane} ${s.cmp}`} aria-label="Composer" data-composer-pane={draftId}>
      <header className={s.cmpHead}>
        <h2>{label}</h2>
        <span className={s.aiMark}>Draft</span>
        <button type="button" className={s.iconBtn} aria-label="Close composer" title="Close" onClick={onClose}>
          <ChatIcon name="x" />
        </button>
      </header>
      <div className={s.cmpBody}>
        <Composer draftId={draftId} />
      </div>
      <footer className={s.cmpFoot}>
        <p className={s.note}>Sending happens in the Outbox, after a confirm. In dry run nothing leaves this machine.</p>
      </footer>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────

export interface AssistantPageViewProps {
  threads: ChatThread[];
  threadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  creatingThread?: boolean;
  streamingThreadId?: string | null;
  messages: ChatMessageView[];
  loading?: boolean;
  loadError?: { message: string } | null;
  onReload?: () => void;
  notice?: string | null;
  composer: React.ReactNode;
  editingId?: string | null;
  anchor?: string | null;
  model?: string;
  onOpenAsPanel?: () => void;
  timeZone?: string;
  status?: string;
  /** Base surface for drafts/items outside the page's panes. */
  surface: AssistantSurface;
}

export function AssistantPageView(p: AssistantPageViewProps) {
  const now = useNow(60_000);
  const ui = useChatUi();
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const wide = width >= COMPOSER_PANE_MIN;
  const thread = p.threads.find((t) => t.id === p.threadId) ?? null;
  const exchanges = p.messages.filter((m) => m.role === 'user').length;
  const first = p.messages[0];

  // The composer pane: the draft you opened, or the thread's newest draft, at ≥ 2,400 px.
  const drafts = useMemo(() => threadTouched(p.messages, ui.actions).drafts, [p.messages, ui.actions]);
  const [chosen, setChosen] = useState<{ thread: string | null; id: string | null } | null>(null);
  const chosenHere = chosen && chosen.thread === p.threadId ? chosen.id : undefined;
  const paneDraft = wide ? (chosenHere === undefined ? (drafts[0]?.id ?? null) : chosenHere) : null;
  const paneLabel = drafts.find((d) => d.id === paneDraft)?.label ?? 'Draft';

  const surface = useMemo<AssistantSurface>(
    () => ({
      ...p.surface,
      openDraftId: paneDraft,
      openDraft: (d: Pick<Draft, 'id' | 'workItemId'>) => {
        if (wide) setChosen({ thread: p.threadId, id: d.id });
        else p.surface.openDraft(d);
      },
    }),
    [p.surface, paneDraft, wide, p.threadId],
  );

  const keys = useAssistantKeys(p.messages);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // The page owns ⌘↵ and z while nothing else has focus (the panel handles its own keys).
      if (t && t !== document.body && !t.closest('[data-assistant-page]')) return;
      keys(e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keys]);

  return (
    <AssistantSurfaceContext.Provider value={surface}>
      <div ref={wrapRef} className={s.pageWrap}>
        <div className={`${s.root} ${s.page} ${paneDraft ? s.withComposer : ''}`} data-chat-root data-assistant-page data-chat-status={p.status ?? 'idle'}>
          <ThreadList threads={p.threads} threadId={p.threadId} onSelect={p.onSelectThread} onNew={p.onNewThread} creating={p.creatingThread} streamingThreadId={p.streamingThreadId} now={now} tz={p.timeZone} />

          <section className={`${s.pane} ${s.cv}`} aria-label="Conversation">
            <header className={s.cvHead}>
              <div>
                <h2>{threadTitle(thread, now, p.timeZone)}</h2>
                <div className={s.meta}>
                  {[first ? `Started ${fmtTime(first.at, p.timeZone)}` : null, `${exchanges} exchange${exchanges === 1 ? '' : 's'}`, p.model ?? null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className={`${s.acts}`} style={{ marginLeft: 'auto' }}>
                {p.onOpenAsPanel ? (
                  <Button variant="ghost" size="sm" kbd="mod+j" onClick={p.onOpenAsPanel} title="Open as a panel on Home (⌘J)" data-open-as-panel>
                    <ChatIcon name="dock" size={14} /> Open as panel
                  </Button>
                ) : null}
              </div>
            </header>
            {p.notice ? (
              <div className={s.notice} role="status">
                {p.notice}
              </div>
            ) : null}
            <PanelBoundary name="assistant-thread" resetKeys={[p.threadId]} onRetry={p.onReload}>
              <MessageList variant="page" messages={p.messages} loading={p.loading} error={p.loadError} onReload={p.onReload} editingId={p.editingId} anchor={p.anchor} />
            </PanelBoundary>
            <div className={s.composer}>{p.composer}</div>
          </section>

          <PanelBoundary name="assistant-context" resetKeys={[p.threadId]}>
            <ThreadContextPane messages={p.messages} />
          </PanelBoundary>

          {paneDraft ? <ComposerPane draftId={paneDraft} label={paneLabel} onClose={() => setChosen({ thread: p.threadId, id: null })} /> : null}
        </div>
      </div>
    </AssistantSurfaceContext.Provider>
  );
}

function ConnectedPage({ initialThreadId, anchor }: AssistantPageProps) {
  const chat = useChat();
  const st = chat.stream;
  const panel = useRightPanel();
  const base = useBaseSurface();
  usePanelContextBridge();

  // ?thread=<id> picks the thread once; picking another keeps the URL in step (no navigation).
  const picked = useRef(false);
  const { selectThread, threads } = st;
  useEffect(() => {
    if (picked.current || !initialThreadId || !threads.some((t) => t.id === initialThreadId)) return;
    picked.current = true;
    selectThread(initialThreadId);
  }, [initialThreadId, threads, selectThread]);
  const select = useCallback(
    (id: string) => {
      selectThread(id);
      const url = new URL(window.location.href);
      url.searchParams.set('thread', id);
      url.searchParams.delete('at');
      window.history.replaceState(window.history.state, '', url.toString());
    },
    [selectThread],
  );

  const newThread = () => {
    void chat.createThread().then((t) => {
      if (!t) return;
      select(t.id);
      requestAnimationFrame(() => chat.composerRef.current?.focus());
    });
  };
  const openAsPanel = () => {
    navigate('/');
    panel.openAssistant();
  };
  useAssistantCommands(st.messages, { onNewThread: newThread, onFocus: chat.focus, switchSurface: { title: 'Open the assistant as a panel on Home', run: openAsPanel } });

  return (
    <AssistantPageView
      threads={st.threads}
      threadId={st.threadId}
      onSelectThread={select}
      onNewThread={newThread}
      creatingThread={chat.creatingThread}
      streamingThreadId={st.streamingThreadId}
      messages={st.messages}
      loading={st.loading}
      loadError={st.loadError}
      onReload={st.reload}
      notice={st.notice}
      composer={<ConnectedComposer variant="page" />}
      editingId={chat.editingId}
      anchor={anchor}
      model={chat.model}
      onOpenAsPanel={openAsPanel}
      timeZone={chat.timeZone}
      status={st.status}
      surface={base}
    />
  );
}

export interface AssistantPageProps {
  initialThreadId?: string | null;
  /** Scroll this message into view first (`?at=<message id>`). */
  anchor?: string | null;
}

export function AssistantPage(props: AssistantPageProps) {
  return (
    <EnsureChatProvider>
      <ConnectedPage {...props} />
    </EnsureChatProvider>
  );
}
