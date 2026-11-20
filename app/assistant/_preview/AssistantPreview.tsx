'use client';
/**
 * Dev preview (P-CHAT verify): the v2 assistant outside the shell, for screenshots and the smoke test.
 *
 *   /assistant?embed=panel                 <AssistantPanel/> at 520 and 600 px (live mock)
 *   /assistant?embed=page                  <AssistantPage/> beside a 232 px sidebar gap (live mock)
 *   &fixture=1                             a scripted thread with every card type (no server writes)
 *   &theme=light|dark                      default dark (DESIGN-V2: dark first)
 *   &type=v2                               the DESIGN-V2 type scale and radii, until V2-TOKENS lands
 *   fixture states: &applied=1 &scan=running &pop=slash|mention &threads=1 &brief=closed &tools=open
 *                   &session=ready &at=<message id>
 *
 * Never rendered in production builds (page.tsx gates it).
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Proposal } from '@/contract';
import { api, queryKey } from '@/client/api';
import { actionsReducer, type ChatAction, type ChatMessageView } from '@/client/chat';
import { useNow } from '@/ui';
import { RightPanelProvider, useRightPanel } from '@/components/shell/panel';
import {
  AssistantPage,
  AssistantPageView,
  AssistantPanel,
  AssistantPanelView,
  AssistantSurfaceContext,
  ChatComposer,
  ChatUiContext,
  useBaseSurface,
  type ChatUi,
  type ComposerModel,
} from '@/components/chat';
import { FIXTURE_AUDIT_ID, fixtureActions, fixtureAppliedReceipt, fixtureMessages, fixtureReply, fixtureThreads, type FixtureRefs } from './fixtures';

/** DESIGN-V2 type scale (brief 14 §5) and radii, scoped to the preview until V2-TOKENS merges. */
const V2_TYPE: CSSProperties = {
  ['--text-micro' as string]: '0.75rem',
  ['--text-micro--line-height' as string]: '1rem',
  ['--text-caption' as string]: '0.875rem',
  ['--text-caption--line-height' as string]: '1.25rem',
  ['--text-body' as string]: '1rem',
  ['--text-body--line-height' as string]: '1.5rem',
  ['--text-body-lg' as string]: '1.125rem',
  ['--text-body-lg--line-height' as string]: '1.75rem',
  ['--text-title' as string]: '1.375rem',
  ['--text-title--line-height' as string]: '1.75rem',
  ['--radius-sm' as string]: '6px',
  ['--radius-md' as string]: '10px',
  ['--radius-lg' as string]: '16px',
};

/** Tokens are light-dark() pairs, so the preview picks its scheme locally (the shell's prefs keep the page's). */
const schemeOf = (theme: string | undefined): CSSProperties['colorScheme'] => (theme === 'light' ? 'light' : 'dark');

// ── Fixture data: real ids from the mock, scripted copy ─────────────────────────────────────

function useFixtureRefs(params: Record<string, string>): FixtureRefs | null {
  const now = useNow(60_000);
  const today = useQuery({ queryKey: queryKey('getToday'), queryFn: ({ signal }) => api('getToday', undefined, { signal }) });
  const agents = useQuery({ queryKey: queryKey('getAgents'), queryFn: ({ signal }) => api('getAgents', undefined, { signal }) });
  const items = useQuery({ queryKey: queryKey('listItems', { query: { tab: 'all_open' } }), queryFn: ({ signal }) => api('listItems', { query: { tab: 'all_open' } }, { signal }) });
  return useMemo(() => {
    if (!today.data || !agents.data || !items.data) return null;
    const cards = today.data.nowStack.cards;
    const top = [...cards.map((c) => c.item), ...items.data.items].filter((x, i, xs) => xs.findIndex((y) => y.id === x.id) === i).slice(0, 3);
    const withDraft = cards.find((c) => c.draft) ?? null;
    const sessions = agents.data.runs.filter((r) => r.kind === 'claude_session' && r.deepLink);
    const prefer = params.session === 'ready' ? ['queued', 'running'] : ['running', 'queued', 'waiting_on_you', 'done_review'];
    const run = prefer.map((st) => sessions.find((r) => r.state === st)).find(Boolean) ?? sessions[0] ?? null;
    return {
      now,
      items: top.map((i) => ({ id: i.id, title: i.title })),
      runId: run?.id ?? null,
      runTitle: run?.title ?? null,
      draftId: withDraft?.draft?.id ?? null,
      draftLabel: withDraft ? `Reply · ${withDraft.item.title}` : null,
      scan: params.scan === 'running' ? 'running' : 'done',
    };
    // `now` is captured once per data load so the thread doesn't reshuffle every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today.data, agents.data, items.data, params.session, params.scan]);
}

function useFixtureUi(refs: FixtureRefs, params: Record<string, string>): ChatUi {
  const [state, dispatch] = useReducer(actionsReducer, fixtureActions(refs, params.applied === '1'));
  const later = (a: ChatAction, ms = 350) => setTimeout(() => dispatch(a), ms);
  return {
    actions: state,
    undo: (ids) => ids.forEach((id, i) => (dispatch({ type: 'undo/start', auditId: id }), later({ type: 'undo/ok', auditId: id }, 350 + i * 150))),
    apply: (p: Proposal) => (dispatch({ type: 'proposal/start', id: p.id, verb: 'apply' }), later({ type: 'proposal/applied', id: p.id, auditId: FIXTURE_AUDIT_ID, receipt: fixtureAppliedReceipt(refs) }, 450)),
    dismiss: (p: Proposal) => (dispatch({ type: 'proposal/start', id: p.id, verb: 'dismiss' }), later({ type: 'proposal/dismissed', id: p.id })),
    retry: () => undefined,
    followUp: () => undefined,
    busy: false,
    defaults: { toolsOpen: params.tools === 'open', briefCollapsed: params.brief === 'closed' },
  };
}

function FixtureComposer({ params, onSend, variant }: { params: Record<string, string>; onSend: (t: string) => void; variant: 'panel' | 'page' }) {
  const panel = useRightPanel();
  const initial = params.pop === 'slash' ? '/' : params.pop === 'mention' ? 'Draft the reply to @a' : '';
  const [value, setValue] = useState(initial);
  const [model, setModel] = useState<ComposerModel>('Sonnet');
  const [removed, setRemoved] = useState(false);
  const label = panel.entity?.label ?? null;
  const ctx = label ? { type: panel.entity!.kind, id: panel.entity!.id, label, via: 'auto' as const } : null;
  return (
    <ChatComposer
      value={value}
      onChange={setValue}
      onSend={(t) => {
        onSend(t);
        setValue('');
      }}
      defaultCaret={initial.length}
      autoContext={removed ? null : ctx}
      onRemoveAuto={() => setRemoved(true)}
      restorable={removed ? ctx : null}
      onRestoreAuto={() => setRemoved(false)}
      model={model}
      onModelChange={setModel}
      onEditLast={() => null}
      suggestions={['Plan my afternoon', "What's at risk this week?", '/rescan slack 2d']}
      variant={variant}
    />
  );
}

function FixturePanel({ params, refs, width }: { params: Record<string, string>; refs: FixtureRefs; width: number }) {
  const ui = useFixtureUi(refs, params);
  const base = useBaseSurface();
  const [extra, setExtra] = useState<ChatMessageView[]>([]);
  const messages = useMemo(() => [...fixtureMessages(refs), ...extra], [refs, extra]);
  const threads = useMemo(() => fixtureThreads(refs.now), [refs.now]);
  const send = useCallback((t: string) => setExtra((xs) => [...xs, ...fixtureReply(t, new Date(), xs.length)]), []);
  return (
    <ChatUiContext.Provider value={ui}>
      <AssistantSurfaceContext.Provider value={base}>
        <AssistantPanelView
          threads={threads}
          threadId="fx_today"
          onSelectThread={() => undefined}
          onNewThread={() => undefined}
          messages={messages}
          composer={<FixtureComposer params={params} onSend={send} variant="panel" />}
          anchor={params.at || null}
          initialThreadsOpen={params.threads === '1' && width === 520}
        />
      </AssistantSurfaceContext.Provider>
    </ChatUiContext.Provider>
  );
}

function FixturePage({ params, refs }: { params: Record<string, string>; refs: FixtureRefs }) {
  const ui = useFixtureUi(refs, params);
  const base = useBaseSurface();
  const [extra, setExtra] = useState<ChatMessageView[]>([]);
  const messages = useMemo(() => [...fixtureMessages(refs), ...extra], [refs, extra]);
  const threads = useMemo(() => fixtureThreads(refs.now), [refs.now]);
  const send = useCallback((t: string) => setExtra((xs) => [...xs, ...fixtureReply(t, new Date(), xs.length)]), []);
  return (
    <ChatUiContext.Provider value={ui}>
      <AssistantPageView
        threads={threads}
        threadId="fx_today"
        onSelectThread={() => undefined}
        onNewThread={() => undefined}
        messages={messages}
        composer={<FixtureComposer params={params} onSend={send} variant="page" />}
        anchor={params.at || null}
        model="Sonnet"
        onOpenAsPanel={() => undefined}
        surface={base}
      />
    </ChatUiContext.Provider>
  );
}

// ── Selection strip: what the right panel "is looking at" ────────────────────────────────────

function SelectionStrip() {
  const panel = useRightPanel();
  const today = useQuery({ queryKey: queryKey('getToday'), queryFn: ({ signal }) => api('getToday', undefined, { signal }) });
  const cards = today.data?.nowStack.cards.slice(0, 3) ?? [];
  useEffect(() => {
    const first = cards[0]?.item;
    if (first && !panel.entity) panel.openDetails({ kind: 'work_item', id: first.id, label: first.title });
    // first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} data-preview-select data-panel-open={panel.open ? 'true' : 'false'} data-panel-entity={panel.entity?.id ?? ''}>
      <span style={{ color: 'var(--color-faint)', fontSize: 'var(--text-caption)' }}>Select (right-panel entity):</span>
      {cards.map((c) => (
        <button
          key={c.item.id}
          type="button"
          onClick={() => panel.openDetails({ kind: 'work_item', id: c.item.id, label: c.item.title })}
          aria-pressed={panel.entity?.id === c.item.id}
          data-preview-select-item={c.item.id}
          style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid var(--color-line-strong)', background: panel.entity?.id === c.item.id ? 'var(--color-selected)' : 'transparent', color: 'var(--color-fg)', fontSize: 'var(--text-caption)' }}
        >
          {c.item.title}
        </button>
      ))}
    </div>
  );
}

function Frame({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, width, minHeight: 0 }} data-preview-frame={width}>
      <figcaption style={{ color: 'var(--color-faint)', fontSize: 'var(--text-caption)' }}>{label}</figcaption>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', borderLeft: '1px solid var(--color-line)', borderRight: '1px solid var(--color-line)', background: 'var(--color-surface)' }}>{children}</div>
    </figure>
  );
}

function PreviewBody({ params }: { params: Record<string, string> }) {
  const fixture = params.fixture === '1';
  const refs = useFixtureRefs(params);
  if (params.embed === 'page') {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateColumns: '232px minmax(0, 1fr)', gridTemplateRows: '64px minmax(0, 1fr)' }}>
        <div style={{ gridRow: '1 / -1', background: 'var(--color-surface-muted)', borderRight: '1px solid var(--color-line)' }} aria-hidden />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', borderBottom: '1px solid var(--color-line)' }}>
          <h1 style={{ fontSize: 'var(--text-title)', lineHeight: 'var(--text-title--line-height)' }}>Assistant</h1>
          <SelectionStrip />
        </div>
        <div style={{ minHeight: 0 }}>{fixture ? refs ? <FixturePage params={params} refs={refs} /> : null : <AssistantPage initialThreadId={params.thread || null} anchor={params.at || null} />}</div>
      </div>
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 0' }}>
      <SelectionStrip />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 32, justifyContent: 'flex-end' }}>
        {[520, 600].map((w) => (
          <Frame key={w} label={`AssistantPanel · ${w} px`} width={w}>
            {fixture ? refs ? <FixturePanel params={params} refs={refs} width={w} /> : null : <AssistantPanel anchor={params.at || null} initialThreadsOpen={params.threads === '1' && w === 520} />}
          </Frame>
        ))}
      </div>
    </div>
  );
}

export function AssistantPreview({ params }: { params: Record<string, string> }) {
  const style: CSSProperties = { position: 'fixed', inset: 0, zIndex: 60, colorScheme: schemeOf(params.theme), background: 'var(--color-bg)', color: 'var(--color-fg)', ...(params.type === 'v2' ? V2_TYPE : {}) };
  return (
    <div style={style} data-assistant-preview={params.embed}>
      <RightPanelProvider>
        <PreviewBody params={params} />
      </RightPanelProvider>
    </div>
  );
}
