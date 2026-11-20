'use client';
/**
 * /dev/kit/chat: every chat surface and state on one page. The first row is live (mock API, real stream,
 * real undo); everything else renders from fixtures through the same components.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Proposal } from '@/contract';
import { api, queryKey } from '@/client/api';
import { actionsReducer, EMPTY_ACTIONS, type ChatAction, type ChatActionsState, type ChatMessageView } from '@/client/chat';
import {
  AskBar,
  ChatComposer,
  ChatDock,
  ChatDockView,
  ChatEmptyState,
  ChatProvider,
  ChatTabPanel,
  ChatUiContext,
  CollapsedRail,
  MessageList,
  ReceiptPart,
  ProposalPart,
  ToolRow,
  ToolRows,
  setChatContext,
  useChatContextValue,
  type ChatModel,
  type ChatUi,
} from '@/components/chat';
import * as fx from './fixtures';

// ── Fixture UI: same reducer as the live dock, with a simulated server ─────────────────────────

function useFixtureUi(initial: ChatActionsState = EMPTY_ACTIONS, extra: Partial<ChatUi> = {}): ChatUi {
  const [state, dispatch] = useReducer(actionsReducer, initial);
  const later = (a: ChatAction, ms = 350) => setTimeout(() => dispatch(a), ms);
  return {
    actions: state,
    undo: (ids) => ids.forEach((id, i) => (dispatch({ type: 'undo/start', auditId: id }), later({ type: 'undo/ok', auditId: id }, 350 + i * 200))),
    apply: (p: Proposal) => (dispatch({ type: 'proposal/start', id: p.id, verb: 'apply' }), later({ type: 'proposal/applied', id: p.id, auditId: `aud_apply_${p.id}`, receipt: { id: 'r', at: p.createdAt, actor: 'chat', summary: 'Policy v4 applied: 4 of the Top 10 moved', changes: [], staged: false } }, 450)),
    dismiss: (p: Proposal) => (dispatch({ type: 'proposal/start', id: p.id, verb: 'dismiss' }), later({ type: 'proposal/dismissed', id: p.id })),
    retry: () => undefined,
    followUp: () => undefined,
    timeZone: fx.KIT_TZ,
    busy: false,
    ...extra,
  };
}

function FixtureUi({ initial, children, busy }: { initial?: ChatActionsState; children: ReactNode; busy?: boolean }) {
  const ui = useFixtureUi(initial, { busy: !!busy });
  return <ChatUiContext.Provider value={ui}>{children}</ChatUiContext.Provider>;
}

const undone = (...ids: string[]): ChatActionsState => ({ ...EMPTY_ACTIONS, undo: Object.fromEntries(ids.map((id) => [id, { status: 'undone' as const }])) });

// ── Layout bits ─────────────────────────────────────────────────────────────────────────────

function Frame({ label, note, width, height = 760, children, className = '' }: { label: string; note?: string; width?: number; height?: number; children: ReactNode; className?: string }) {
  return (
    <figure className="m-0 flex shrink-0 flex-col gap-1.5" style={{ width }}>
      <figcaption className="flex min-h-5 flex-wrap items-baseline gap-x-2">
        <span className="whitespace-nowrap text-body font-bold text-fg-heading">{label}</span>
        {note ? <span className="text-caption text-muted">{note}</span> : null}
      </figcaption>
      <div className={`flex overflow-hidden rounded-lg border border-line-strong bg-bg shadow-card ${className}`} style={{ height }}>
        {children}
      </div>
    </figure>
  );
}

function Card({ label, children, width = 400 }: { label: string; children: ReactNode; width?: number }) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5" style={{ width }}>
      <h3 className="text-caption font-bold text-muted">{label}</h3>
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">{children}</div>
    </section>
  );
}

function StaticComposer(props: Partial<Parameters<typeof ChatComposer>[0]> & { initial?: string }) {
  const [v, setV] = useState(props.initial ?? '');
  return <ChatComposer value={v} onChange={setV} onSend={() => setV('')} search={async () => fx.mentionHits} {...props} />;
}

// ── Live pieces ─────────────────────────────────────────────────────────────────────────────

function LiveRail() {
  const [tab, setTab] = useState<'status' | 'chat'>('status');
  return (
    <div className="flex h-full w-full flex-col bg-surface" data-kit-rail>
      <div role="tablist" className="flex h-9 shrink-0 items-stretch gap-4 border-b border-line px-3">
        {(['status', 'chat'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative text-body ${tab === t ? 'font-bold text-fg-heading' : 'text-muted hover:text-fg'}`}>
            {t === 'status' ? 'Status' : 'Chat'}
            {tab === t ? <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-sm bg-brand-600" /> : null}
          </button>
        ))}
      </div>
      {tab === 'chat' ? (
        <div className="min-h-0 flex-1">
          <ChatTabPanel />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {['Waiting on you · 1', 'Agents · 2 running', 'Closed for you · 2', 'Health · ● 7/8'].map((l) => (
            <div key={l} className="rounded-lg border border-line px-3 py-2 text-body text-muted">
              {l}
            </div>
          ))}
          <p className="text-caption text-faint">Status lanes belong to the rail lane; placeholders here.</p>
        </div>
      )}
      <div className="shrink-0 border-t border-line bg-surface-muted p-3">
        <AskBar onOpenChat={() => setTab('chat')} />
      </div>
    </div>
  );
}

function ContextDemo() {
  const today = useQuery({ queryKey: queryKey('getToday'), queryFn: ({ signal }) => api('getToday', undefined, { signal }) });
  const current = useChatContextValue();
  const cards = today.data?.nowStack.cards.slice(0, 3) ?? [];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-caption text-muted">Focus a card (setChatContext):</span>
      {cards.map((c) => {
        const on = current?.id === c.item.id;
        return (
          <button
            key={c.item.id}
            type="button"
            onClick={() => setChatContext(on ? null : { kind: 'work_item', id: c.item.id, label: c.item.title })}
            className={`h-6 max-w-56 truncate rounded-full border px-2 text-caption ${on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line bg-surface text-fg hover:bg-brand-50'}`}
            data-kit-focus={c.item.id}
          >
            {c.item.title}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────────────────

export function ChatKit() {
  const [theme, setTheme] = useState<'lightning-blue' | 'cosmos'>('lightning-blue');
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'lightning-blue') el.setAttribute('data-sf-theme', 'lightning-blue');
    else el.removeAttribute('data-sf-theme');
  }, [theme]);

  const [model, setModel] = useState<ChatModel>('Sonnet');
  const noop = useCallback(() => undefined, []);
  const dockViewCommon = useMemo(
    () => ({ model, models: ['Sonnet', 'Opus'] as ChatModel[], onModelChange: setModel, onNewThread: noop, threads: fx.threads, threadId: 'th_today', onSelectThread: noop }),
    [model, noop],
  );

  const streamingThread: ChatMessageView[] = [fx.userRescan, fx.assistantStreaming];

  return (
    <main className="min-h-screen bg-bg pb-16" data-kit="chat">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-6 py-3">
        <div>
          <h1 className="text-heading font-bold text-fg-heading">Chat kit</h1>
          <p className="text-caption text-muted">FE-1d · dock, rail tab, ask bar and every message state. Row one talks to the mock API.</p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-line p-0.5" role="radiogroup" aria-label="Brand ramp">
          {(['lightning-blue', 'cosmos'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={`h-6 rounded-full px-2.5 text-caption ${theme === t ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg'}`}>
              {t === 'cosmos' ? 'Cosmos' : 'Lightning Blue'}
            </button>
          ))}
        </div>
      </header>

      <ChatProvider>
        <div className="flex flex-col gap-3 px-6 pt-5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-title text-fg-heading">Live</h2>
            <ContextDemo />
          </div>
          <div className="flex flex-wrap items-start gap-6">
            <Frame label="Dock · 420 px" note="⌘J focuses · drag the left edge (360–560) · collapse" width={480} className="justify-end">
              <div className="flex-1 bg-bg" />
              <div className="flex h-full" data-kit-live>
                <ChatDock />
              </div>
            </Frame>
            <Frame label="Rail · 340 px" note="< 1920 px: Status ⇄ Chat tabs, ask bar always visible" width={340}>
              <LiveRail />
            </Frame>
          </div>
        </div>
      </ChatProvider>

      <div className="flex flex-col gap-3 px-6 pt-8">
        <h2 className="text-title text-fg-heading">Fixtures</h2>
        <div className="flex flex-wrap items-start gap-6">
          <FixtureUi>
            <Frame label="Dock · 560 px" note="settled conversation, pending proposal" width={560}>
              <ChatDockView
                {...dockViewCommon}
                width={560}
                onResize={noop}
                onCollapse={noop}
                messages={fx.dockConversation}
                composer={<StaticComposer autoContext={{ type: 'work_item', id: 'w_sow', label: 'Send Marcus the revised SOW pricing', via: 'auto' }} onRemoveAuto={noop} />}
              />
            </Frame>
          </FixtureUi>
          <Frame label="Collapsed" note="44 px rail" width={96} className="justify-end">
            <CollapsedRail onExpand={noop} streaming />
          </Frame>
          <FixtureUi busy>
            <Frame label="Dock · 360 px, streaming" note="caret, live tool rows, Stop" width={360}>
              <ChatDockView {...dockViewCommon} width={360} onResize={noop} onCollapse={noop} streamingThreadId="th_today" status="streaming" messages={streamingThread} composer={<StaticComposer busy onStop={noop} />} />
            </Frame>
          </FixtureUi>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-6 pt-8">
        <h2 className="text-title text-fg-heading">Message states</h2>
        <div className="flex flex-wrap items-start gap-6">
          <Card label="Receipt · before undo">
            <FixtureUi>
              <ReceiptPart receipt={fx.receiptMove} />
            </FixtureUi>
          </Card>
          <Card label="Receipt · one line undone">
            <FixtureUi initial={undone('aud_start')}>
              <ReceiptPart receipt={fx.receiptMove} />
            </FixtureUi>
          </Card>
          <Card label="Receipt · all undone">
            <FixtureUi initial={undone('aud_start', 'aud_note')}>
              <ReceiptPart receipt={fx.receiptMove} />
            </FixtureUi>
          </Card>
          <Card label="Receipt · one change set, 7 lines">
            <FixtureUi>
              <ReceiptPart receipt={fx.receiptRerank} />
            </FixtureUi>
          </Card>
          <Card label="Receipt · undo failed">
            <FixtureUi initial={{ ...EMPTY_ACTIONS, undo: { aud_start: { status: 'error', message: 'Changed since, so it can’t be undone here.' } } }}>
              <ReceiptPart receipt={fx.receiptMove} />
            </FixtureUi>
          </Card>
          <Card label="Proposal · pending (Apply)">
            <FixtureUi>
              <ProposalPart proposal={fx.proposalPolicy} summary="Customer-facing work ranks above internal work: 4 of your Top 10 move" />
            </FixtureUi>
          </Card>
          <Card label="Proposal · applied, with Undo">
            <FixtureUi initial={{ ...EMPTY_ACTIONS, proposals: { prop_policy: { status: 'applied', auditId: 'aud_apply', receipt: { id: 'r', at: fx.proposalPolicy.createdAt, actor: 'chat', summary: 'Policy v4 applied: 4 of the Top 10 moved', changes: [], staged: false } } } }}>
              <ProposalPart proposal={fx.proposalPolicy} summary="Customer-facing work ranks above internal work" />
            </FixtureUi>
          </Card>
          <Card label="Proposal · more than 5 changes (preview)">
            <FixtureUi>
              <ProposalPart proposal={fx.proposalBulk} summary="Replan around the moved ACME demo: 7 changes" />
            </FixtureUi>
          </Card>
          <Card label="Proposal · DC claims, long labels (conversation width)" width={680}>
            <div style={{ containerType: 'inline-size', containerName: 'conv' }}>
              <FixtureUi>
                <ProposalPart proposal={fx.proposalDcClaims} summary="Claim 100% AI + Data Architect DCs on 6 open opps?" />
              </FixtureUi>
            </div>
          </Card>
          <Card label="Proposal · DC claims, narrow (dock)" width={380}>
            <div style={{ containerType: 'inline-size', containerName: 'conv' }}>
              <FixtureUi>
                <ProposalPart proposal={fx.proposalDcClaims} summary="Claim 100% AI + Data Architect DCs on 6 open opps?" />
              </FixtureUi>
            </div>
          </Card>
          <Card label="Proposal · 220 DC claims, one card (dock)" width={380}>
            <div style={{ containerType: 'inline-size', containerName: 'conv' }} data-kit="dc220-dock">
              <FixtureUi>
                <ProposalPart proposal={fx.proposalDcClaims220} summary="Claim 100% AI + Data Architect DCs on these 220 opps?" />
              </FixtureUi>
            </div>
          </Card>
          <Card label="Proposal · 220 DC claims, one card (conversation width)" width={680}>
            <div style={{ containerType: 'inline-size', containerName: 'conv' }} data-kit="dc220-wide">
              <FixtureUi>
                <ProposalPart proposal={fx.proposalDcClaims220} summary="Claim 100% AI + Data Architect DCs on these 220 opps?" />
              </FixtureUi>
            </div>
          </Card>
          <Card label="Proposal · applied, 54 of 55 (1 failed)" width={420}>
            <div style={{ containerType: 'inline-size', containerName: 'conv' }} data-kit="partial-card">
              <FixtureUi initial={{ ...EMPTY_ACTIONS, proposals: { prop_dc220: { status: 'applied', auditId: 'aud_dc_53', receipt: fx.receiptPartial } } }}>
                <ProposalPart proposal={{ ...fx.proposalDcClaims220, changes: fx.proposalDcClaims220.changes.slice(0, 55), status: 'applied' }} summary="Claim DCs on these 55 opportunities?" />
              </FixtureUi>
            </div>
          </Card>
          <Card label="Receipt · partial Apply (54 of 55)" width={420}>
            <div style={{ containerType: 'inline-size', containerName: 'conv' }} data-kit="partial-receipt">
              <FixtureUi>
                <ReceiptPart receipt={fx.receiptPartial} />
              </FixtureUi>
            </div>
          </Card>
          <Card label="Proposal · dismissed">
            <FixtureUi initial={{ ...EMPTY_ACTIONS, proposals: { prop_policy: { status: 'dismissed' } } }}>
              <ProposalPart proposal={fx.proposalPolicy} summary="Customer-facing work ranks above internal work" />
            </FixtureUi>
          </Card>
          <Card label="Tool rows · live, folded, expanded, failed">
            <ToolRows tools={fx.toolsLive} live />
            <ToolRows tools={fx.toolsDone} live={false} />
            <ul className="flex flex-col gap-1">
              <ToolRow tool={fx.toolsDone[3]} defaultOpen />
              <ToolRow tool={fx.toolsFailed[0]} />
            </ul>
          </Card>
          <Card label="Thread · error with Retry, why, promise" width={420}>
            <FixtureUi>
              <div className="flex h-[620px] flex-col">
                <MessageList messages={[fx.userError, fx.assistantError, fx.userWhy, fx.assistantWhy, fx.userPromise, fx.assistantPromise]} />
              </div>
            </FixtureUi>
          </Card>
          <Card label="Composer · context chips, / and @">
            <StaticComposer
              initial="move this after lunch"
              autoContext={{ type: 'work_item', id: 'w_sow', label: 'Send Marcus the revised SOW pricing', via: 'auto' }}
              explicitContext={[{ type: 'account', id: 'acc_globex', label: 'Globex', via: 'explicit' }]}
              onRemoveAuto={noop}
              onRemoveContext={noop}
            />
            <div className="pt-[17.5rem]">
              <StaticComposer initial="/" defaultCaret={1} footnote={false} />
            </div>
            <div className="pt-[19.5rem]">
              <StaticComposer initial="@glo" defaultCaret={4} footnote={false} />
            </div>
          </Card>
          <Card label="Empty thread · loading">
            <FixtureUi>
              <div className="flex h-[340px] flex-col">
                <ChatEmptyState onPick={noop} />
              </div>
              <div className="flex h-[180px] flex-col border-t border-line pt-2">
                <MessageList messages={[]} loading />
              </div>
            </FixtureUi>
          </Card>
        </div>
      </div>
    </main>
  );
}
