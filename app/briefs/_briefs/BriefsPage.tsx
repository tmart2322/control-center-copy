'use client';
/**
 * Briefs (R-UI-21, UI-SPEC §12, design v2): "What happened that I might care about?" Reading material that never
 * competes with Do now, so the page has no filled button until you select a highlight.
 *
 *   list pane      Watched · My opportunities (unread, "n worth a look") · Watches
 *   reading pane   the brief: ✦ AI summary (68ch prose), Worth a closer look (beside the prose when there is room),
 *                  Everything else; or the Watches section (explicit Save) when Watches is picked
 *
 * URL state: `?brief=<id>` and `?view=watches`. Keys: in the list j/k move and Enter reads the brief (focus moves
 * into its highlights); in the highlights j/k move, Enter opens Details in the docked panel, p promote → Triage,
 * t make task, n not relevant, o open the source, Esc back to the list.
 */
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BriefHighlight, BriefSummary } from '@/contract';
import { useApi } from '@/client/hooks';
import { useLiveList } from '@/components/lists/live-list';
import { useCommands, useFocusedCommands } from '@/client/keyboard';
import { useResumeSelection } from '@/client/resume';
import { useChatContext } from '@/components/chat';
import { BriefList } from '@/components/briefs/BriefList';
import { BriefReader } from '@/components/briefs/BriefReader';
import { promotedState } from '@/components/briefs/promoted';
import { readingPaneFlags, readingPaneState } from '@/components/briefs/reading-pane';
import { useHighlightActions } from '@/components/briefs/useHighlightActions';
import { WatchesSection } from '@/components/briefs/Watches';
import { ContextHead, ContextPage, Pane, useContextKeys, useDetails, useMainWidth } from '@/components/deals/context-frame';
import { useContextPanels } from '@/components/deals/register-panels';
import { DomainClock } from '@/components/domain';
import { isOpenHighlight } from '@/components/lists/cache-patches';
import { Button, EmptyState, PanelBoundary, PanelError, useNow, usePanelState, useTimeZone } from '@/ui';
import { BriefListSkeleton, BriefPaneSkeleton } from './BriefsSkeleton';
import { navigate } from '@/components/shell/router';

const cssEscape = (v: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"'));

export function BriefsPage() {
  return (
    <PanelBoundary name="briefs">
      <BriefsInner />
    </PanelBoundary>
  );
}

function BriefsInner() {
  useContextPanels();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tz = useTimeZone();
  const now = useNow(30_000).toISOString();
  const mainW = useMainWidth();
  const { open: openDetails, openId: panelId } = useDetails();
  const list = useApi('getBriefs');
  // Live (docs/UX.md "Live updates"): a new brief joins at its place; the ones on screen keep theirs (a refresh that
  // re-sorts by activity never moves the brief you are reading).
  const watchedLive = useLiveList(list.data?.watched, 'briefs:watched', { linger: false });
  const oppsLive = useLiveList(list.data?.opportunities, 'briefs:opps', { linger: false });
  const watched = useMemo(() => (list.data ? watchedLive.items : []), [list.data, watchedLive.items]);
  const opportunities = useMemo(() => (list.data ? oppsLive.items : []), [list.data, oppsLive.items]);
  const all = useMemo<BriefSummary[]>(() => [...watched, ...opportunities], [watched, opportunities]);
  const ids = useMemo(() => all.map((b) => b.id), [all]);
  const view = sp.get('view') === 'watches' ? 'watches' : 'brief';

  const [cursor, setCursor] = useResumeSelection('briefs-cursor');
  const [opened, setOpened] = useResumeSelection('briefs-open');
  // ?brief= is the page's own param; ?id= is what links saved before hrefFor used ?brief= (notifications, audit rows) carry.
  const wanted = sp.get('brief') ?? sp.get('id');
  useEffect(() => {
    if (wanted && ids.includes(wanted) && wanted !== opened) {
      setOpened(wanted);
      setCursor(wanted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, ids.join('|')]);
  // The default brief is chosen once (first unread, else first). Reading it marks it read, so re-deriving
  // "first unread" would walk through every brief and mark them all read.
  const defaultRef = useRef<string | null>(null);
  if (!defaultRef.current && all.length) defaultRef.current = all.find((b) => b.unread)?.id ?? all[0]!.id;
  const defaultId = defaultRef.current && ids.includes(defaultRef.current) ? defaultRef.current : (all[0]?.id ?? null);
  const openId = opened && ids.includes(opened) ? opened : defaultId;
  const cursorId = cursor && ids.includes(cursor) ? cursor : openId;
  const brief = useApi('getBrief', { params: { id: openId ?? '' } }, { enabled: !!openId && view === 'brief' });

  const listRef = useRef<HTMLDivElement | null>(null);
  const readRef = useRef<HTMLDivElement | null>(null);
  const readScroll = useRef<HTMLDivElement | null>(null);
  const [hlActive, setHlActive] = useState<string | null>(null);
  const actions = useHighlightActions();

  useEffect(() => {
    if (readScroll.current) readScroll.current.scrollTop = 0;
    setHlActive(null);
  }, [openId, view]);

  const highlights = useMemo(() => brief.data?.highlights ?? [], [brief.data]);
  const hlIds = useMemo(() => highlights.map((h) => h.id), [highlights]);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h] as const)), [highlights]);
  const hl = hlActive ? (hlById.get(hlActive) ?? null) : null;
  useChatContext(hl ? { kind: 'brief_highlight', id: hl.id, label: hl.title } : brief.data && view === 'brief' ? { kind: 'brief', id: brief.data.id, label: brief.data.title } : null);

  const state = usePanelState('briefs.list', { loading: list.isLoading, error: list.isError && !list.data, empty: !list.isLoading && all.length === 0 });
  // While the list is pending there is nothing to pick yet: the pane loads, it doesn't ask (B-073a).
  const paneState = usePanelState('briefs.pane', readingPaneFlags(readingPaneState({ listPending: list.isPending, openId, briefPending: brief.isPending, briefError: brief.isError })));

  const setUrl = useCallback(
    (next: { brief?: string | null; view?: 'watches' | null }) => {
      const p = new URLSearchParams(sp.toString());
      if (next.brief !== undefined) {
        if (next.brief) p.set('brief', next.brief);
        else p.delete('brief');
      }
      if (next.view !== undefined) {
        if (next.view) p.set('view', next.view);
        else p.delete('view');
      }
      navigate(`${pathname}${p.size ? `?${p}` : ''}`, { replace: true });
    },
    [sp, pathname],
  );

  const focusBrief = useCallback((id: string) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-brief-id="${cssEscape(id)}"]`)?.focus());
  }, []);
  const openBrief = useCallback(
    (id: string, intoPane: boolean) => {
      setOpened(id);
      setCursor(id);
      setUrl({ brief: id, view: null });
      if (intoPane) {
        // The new brief's highlights render a moment later; select and focus the first one once it is there.
        let tries = 0;
        const go = () => {
          const first = readRef.current?.querySelector<HTMLElement>('[data-highlight-id]');
          if (first) {
            setHlActive(first.dataset.highlightId ?? null);
            first.focus();
          } else if (tries++ < 30) requestAnimationFrame(go);
        };
        requestAnimationFrame(go);
      }
    },
    [setCursor, setOpened, setUrl],
  );
  const manage = useCallback(() => setUrl({ view: 'watches' }), [setUrl]);

  // List keys (the page's primary list).
  useContextKeys({
    scope: 'list:briefs',
    rootRef: listRef,
    ids,
    selected: cursorId,
    setSelected: (id) => id && setCursor(id),
    enabled: state === 'ready',
    followPanel: false,
    onOpen: (id) => openBrief(id, true),
  });

  const openHighlight = useCallback(
    (h: BriefHighlight) => {
      setHlActive(h.id);
      openDetails({ kind: 'brief_highlight', id: h.id, label: h.title });
    },
    [openDetails],
  );
  const live = (id: string, fn: (h: BriefHighlight) => void) => {
    const h = hlById.get(id);
    if (h && isOpenHighlight(h.status)) fn(h);
  };
  // Highlight keys (only while focus is in the reading pane).
  useContextKeys({
    scope: 'list:highlights',
    rootRef: readRef,
    ids: hlIds,
    selected: hlActive,
    setSelected: setHlActive,
    primary: false,
    enabled: view === 'brief' && hlIds.length > 0,
    onOpen: (id) => {
      const h = hlById.get(id);
      if (h) openHighlight(h);
    },
    onPrimary: (id) => live(id, actions.promote),
    actions: {
      p: (id) => live(id, actions.promote),
      t: (id) => live(id, actions.makeTask),
      n: (id) => live(id, actions.dismiss),
      o: (id) => {
        const url = hlById.get(id)?.sources.find((s) => s.url)?.url;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
    onEscape: () => {
      if (cursorId) focusBrief(cursorId);
      return true;
    },
  });

  useCommands([
    { id: 'briefs.manage', title: 'Briefs: manage watches', group: 'View', keywords: ['subscribe', 'channel', 'cadence'], run: manage },
    ...(view === 'watches' ? [{ id: 'briefs.back', title: 'Briefs: back to the brief', group: 'View', run: () => setUrl({ view: null }) }] : []),
  ]);
  useFocusedCommands(
    { label: hl?.title ?? 'Brief highlight', kind: 'brief_highlight' },
    hl && isOpenHighlight(hl.status)
      ? [
          { id: 'briefs.promote', title: 'Promote → Triage', shortcut: 'p', keywords: ['suggest'], run: () => actions.promote(hl) },
          { id: 'briefs.task', title: 'Make task', shortcut: 't', run: () => actions.makeTask(hl) },
          { id: 'briefs.dismiss', title: 'Not relevant', shortcut: 'n', run: () => actions.dismiss(hl) },
          { id: 'briefs.details', title: 'Open in Details', shortcut: 'enter', run: () => openHighlight(hl) },
        ]
      : [],
  );

  const counts = list.data?.counts;
  const watchCount = list.data?.watches.length ?? 0;
  const wide = mainW >= 1600;

  return (
    <DomainClock now={now} tz={tz}>
      <ContextPage label="Briefs">
        <ContextHead
          title="Briefs"
          sentence={
            counts ? (
              <span data-testid="briefs-counts" className="tabular-nums">
                <span className={counts.worthALook ? 'font-bold text-fg' : undefined}>{counts.worthALook ? `${counts.worthALook} worth a closer look` : 'Nothing stands out'}</span>
                {` · ${counts.unread} unread · what happened in your channels and opportunities, so nothing here competes with Do now.`}
              </span>
            ) : (
              'Loading your briefs…'
            )
          }
          actions={
            <Button variant="quiet" size="sm" icon="settings" onClick={manage} data-testid="manage-watches" aria-pressed={view === 'watches'}>
              Manage watches
            </Button>
          }
        />
        <PanelBoundary name="briefs.list" onRetry={() => void list.refetch()}>
          {state === 'error' || list.isError ? (
            <PanelError title="Briefs failed to load" error={list.error} onRetry={() => void list.refetch()} />
          ) : state === 'empty' && view !== 'watches' ? (
            <Pane aria-label="Briefs">
              <EmptyState
                icon="summary"
                title="No briefs yet"
                body="Watch a channel, opportunity, account, person or search and a brief shows up here."
                action={
                  <Button variant="secondary" size="sm" onClick={manage}>
                    Manage watches
                  </Button>
                }
              />
            </Pane>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] gap-5 @max-[1100px]/main:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] @max-[1100px]/main:gap-4">
              <Pane as="aside" aria-label="Briefs" bodyRef={listRef}>
                {state === 'loading' ? <BriefListSkeleton /> : <BriefList watched={watched} opportunities={opportunities} openId={openId} cursorId={cursorId} watchCount={watchCount} watchesOpen={view === 'watches'} onOpen={(b) => openBrief(b.id, false)} onManage={manage} />}
              </Pane>
              <Pane aria-label={view === 'watches' ? 'Watches' : 'Brief'} bodyRef={readScroll} data-testid="brief-scroll">
                <div ref={readRef}>
                  {view === 'watches' ? (
                    <WatchesSection onDone={() => setUrl({ view: null })} />
                  ) : (
                    <PanelBoundary name="briefs.pane" onRetry={() => void brief.refetch()}>
                      {paneState === 'loading' || (paneState === 'ready' && !brief.data && !brief.isError) ? (
                        <BriefPaneSkeleton />
                      ) : paneState === 'error' || brief.isError ? (
                        <PanelError title="This brief failed to load" error={brief.error} onRetry={() => void brief.refetch()} />
                      ) : paneState === 'empty' || !brief.data ? (
                        <EmptyState icon="summary" title="Pick a brief" body="Choose one on the left to read it." />
                      ) : (
                        <BriefReader
                          className="px-6 py-5"
                          brief={brief.data}
                          tz={tz}
                          now={now}
                          wide={wide}
                          selectedHighlight={hlActive}
                          openId={panelId}
                          onPromote={actions.promote}
                          onMakeTask={actions.makeTask}
                          onDismiss={actions.dismiss}
                          onUndo={(h) => void actions.undo(h)}
                          onOpenTask={(h) => {
                            // In Triage → that row in Triage; a task → its Details.
                            const to = promotedState(h, actions.kindOf(h.id))?.open;
                            if (to && 'href' in to) navigate(to.href);
                            else if (to) openDetails({ kind: 'work_item', id: to.taskId, label: h.title });
                          }}
                          onOpenSource={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
                          onOpen={openHighlight}
                        />
                      )}
                    </PanelBoundary>
                  )}
                </div>
              </Pane>
            </div>
          )}
        </PanelBoundary>
      </ContextPage>
    </DomainClock>
  );
}
