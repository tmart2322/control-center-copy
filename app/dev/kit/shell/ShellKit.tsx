'use client';
/**
 * Shell kit: the v2 frame with the panel closed, open on Details and open on Assistant, as scaled
 * specimens (each with its own panel state), plus buttons that drive the live frame around this page
 * and the sidebar footer in every system state.
 */
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import type { Connector, HealthPayload } from '@/contract';
import { useApi } from '@/client/hooks';
import { RightPanelProvider, useRightPanel, type PanelEntity } from '@/components/shell/panel';
import { RightPanelView } from '@/components/shell/RightPanel';
import { Sidebar, SidebarFooter } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { PANEL_W } from '@/components/shell/nav';
import { Button } from '@/ui/Button';
import { Skeleton } from '@/ui/states';

type FrameState = 'closed' | 'details' | 'assistant';

const FRAME_W = 1440;
const FRAME_H = 820;
const SCALE = 0.5;

function useSampleItem(): PanelEntity | null {
  const today = useApi('getToday');
  const item = today.data?.nowStack.cards[0]?.item;
  return item ? { kind: 'work_item', id: item.id, label: item.title } : null;
}

function ApplyState({ state, entity }: { state: FrameState; entity: PanelEntity | null }) {
  const panel = useRightPanel();
  const { openDetails, openAssistant, close } = panel;
  useEffect(() => {
    if (state === 'details' && entity) openDetails(entity);
    else if (state === 'assistant') openAssistant(entity);
    else close();
  }, [state, entity, openDetails, openAssistant, close]);
  return null;
}

/** Stand-in for the Assistant tab inside a specimen (the live chat stays in the real panel). */
function AssistantStandIn({ entity }: { entity: PanelEntity | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pt-4 pb-6">
      <span className="inline-flex h-8 items-center gap-2 self-start rounded-md border border-line bg-surface-muted px-3 text-caption text-muted">
        Looking at: <b className="text-fg">{entity?.label ?? 'Home'}</b>
      </span>
      <div className="flex flex-1 flex-col gap-3">
        <div className="max-w-[60ch] self-end rounded-md bg-selected px-4 py-3 text-body text-fg">What&apos;s left before the review?</div>
        <div className="max-w-[60ch] rounded-md border border-line bg-surface-raised px-4 py-3 text-body text-fg">
          <span className="mb-1 block text-caption font-bold text-ai-700">Assistant</span>
          Just the smoke test. The agent checks run in the background, then it&apos;s about 20 minutes of yours.
        </div>
      </div>
      <div className="flex min-h-12 items-center rounded-md border border-line-input bg-surface-input px-4 text-body text-faint">Ask about this item, or anything on the page…</div>
    </div>
  );
}

function PagePlaceholder() {
  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <Skeleton variant="line" className="h-9 w-2/3" />
      <Skeleton variant="line" count={2} className="w-1/2" />
      <div className="grid grid-cols-3 gap-6 @max-[900px]/main:grid-cols-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
      <Skeleton variant="row" count={6} />
    </div>
  );
}

function FrameSpecimen({ state, entity, label }: { state: FrameState; entity: PanelEntity | null; label: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-caption text-muted">{label}</figcaption>
      <div className="overflow-hidden rounded-lg border border-line-strong" style={{ width: FRAME_W * SCALE, height: FRAME_H * SCALE }}>
        <div className="flex origin-top-left bg-bg" style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${SCALE})` }} inert>
          <RightPanelProvider>
            <ApplyState state={state} entity={entity} />
            <Sidebar static collapsed={false} pathname="/" />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar specimen title="Home" />
              <div className="flex min-h-0 flex-1">
                <SpecimenMain state={state} />
                <RightPanelView specimen width={PANEL_W} assistant={<AssistantStandIn entity={entity} />} />
              </div>
            </div>
          </RightPanelProvider>
        </div>
      </div>
    </figure>
  );
}

function SpecimenMain({ state }: { state: FrameState }) {
  return (
    <div data-panel={state === 'closed' ? 'closed' : 'open'} className="cc-scroll @container/main min-w-0 flex-1 overflow-hidden">
      <PagePlaceholder />
    </div>
  );
}

// ── Sidebar footer states ───────────────────────────────────────────────────────────────────

function conn(id: string, label: string, state: Connector['state'], extra: Partial<Connector> = {}): Connector {
  const now = Date.now();
  return {
    id,
    label,
    source: 'slack',
    state,
    since: new Date(now - 3600_000).toISOString(),
    lastSuccessAt: new Date(now - 40_000).toISOString(),
    cursor: { label: `${label} through 10:41`, at: null },
    backlog: 0,
    itemsToday: 0,
    catchUpPct: null,
    lastError: null,
    impact: null,
    reauth: null,
    affects: [],
    ...extra,
  };
}

function health(connectors: Connector[], opts: { dryRun?: boolean; spend?: Partial<HealthPayload['spend']>; workerAlive?: boolean } = {}): HealthPayload {
  const broken = connectors.filter((c) => c.state !== 'ok').map((c) => ({ id: c.id, label: c.label, state: c.state }));
  return {
    connectors,
    summary: { ok: connectors.filter((c) => c.state === 'ok').length, total: connectors.length, worst: broken[0]?.state ?? 'ok', broken },
    spend: { today: { usd: 0.64, softBudgetUsd: 5, hardCapUsd: 15, pct: 13 }, state: 'ok', last7d: [], byScanner: [], byModel: [], ...opts.spend },
    worker: { alive: opts.workerAlive ?? true, lastHeartbeatAt: null, queueDepth: 0 },
    dryRun: opts.dryRun ?? true,
    firstScan: null,
  };
}

const OK8 = ['Slack', 'Gmail', 'Calendar', 'Drive', 'Gemini', 'Org62', 'VDP', 'Claude'].map((l) => conn(l.toLowerCase(), l, 'ok'));

const FOOTER_STATES: Array<{ label: string; health: HealthPayload }> = [
  { label: 'All healthy · dry run', health: health(OK8) },
  { label: 'One broken: the only time health shows', health: health(OK8.map((c) => (c.id === 'vdp' ? { ...c, state: 'auth_needed' as const } : c))) },
  { label: 'Catching up: the dot breathes', health: health(OK8.map((c) => (c.id === 'slack' ? { ...c, state: 'catching_up' as const, catchUpPct: 60 } : c))) },
  { label: 'Live send is the loud state', health: health(OK8, { dryRun: false }) },
  { label: 'Soft budget alert', health: health(OK8, { spend: { today: { usd: 4.2, softBudgetUsd: 5, hardCapUsd: 15, pct: 84 }, state: 'soft_alert' } }) },
  { label: 'Worker down + two broken', health: health(OK8.map((c) => (c.id === 'gmail' ? { ...c, state: 'error' as const } : c.id === 'vdp' ? { ...c, state: 'auth_needed' as const } : c)), { workerAlive: false }) },
];

function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-title text-fg-heading">{title}</h2>
        {intro ? <p className="mt-1 max-w-[72ch] text-body text-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ShellKit() {
  const panel = useRightPanel();
  const entity = useSampleItem();
  return (
    <div className="flex flex-col gap-10 px-8 py-6">
      <div>
        <h1 className="text-heading text-fg-heading">Shell</h1>
        <p className="mt-1 max-w-[72ch] text-body text-muted">
          The v2 frame: a 232 px sidebar (`[` collapses it to 64), a 64 px topbar, and one docked right panel shared by Details and the Assistant (⌘J). The panel pushes the page; Esc closes it and focus goes back to the opener.
        </p>
      </div>

      <Section title="Drive the live frame" intro="These act on the real frame around this page. Reload keeps the panel (it lives in the URL).">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={panel.close}>
            Panel closed
          </Button>
          <Button variant="secondary" disabled={!entity} onClick={() => entity && panel.openDetails(entity)}>
            Details: {entity?.label ?? 'loading…'}
          </Button>
          <Button variant="secondary" onClick={() => panel.openDetails({ kind: 'brief', id: 'b_sample', label: 'A kind with no renderer' })}>
            Details: unknown kind (fallback)
          </Button>
          <Button variant="secondary" onClick={() => panel.openAssistant()}>
            Assistant
          </Button>
          <span className="text-caption text-muted">
            or open <Link href="/dev/kit/shell?panel=assistant">?panel=assistant</Link>
            {entity ? (
              <>
                {' '}
                · <Link href={`/dev/kit/shell?panel=details&item=${entity.id}`}>?panel=details&amp;item=…</Link>
              </>
            ) : null}
          </span>
        </div>
      </Section>

      <Section title="Frame states" intro="Scaled to 50 % of a 1,440 × 820 frame. Each specimen has its own panel state.">
        <div className="flex flex-wrap gap-6">
          <FrameSpecimen state="closed" entity={entity} label="Panel closed" />
          <FrameSpecimen state="details" entity={entity} label="Open on Details" />
          <FrameSpecimen state="assistant" entity={entity} label="Open on Assistant ⌘J" />
        </div>
      </Section>

      <Section title="Sidebar" intro="Expanded and collapsed (the icon rail below a 1,440 px frame).">
        <div className="flex gap-6">
          <div className="h-[44rem] overflow-hidden rounded-lg border border-line-strong">
            <Sidebar static collapsed={false} pathname="/outbox" />
          </div>
          <div className="h-[44rem] overflow-hidden rounded-lg border border-line-strong">
            <Sidebar static collapsed pathname="/work" />
          </div>
        </div>
      </Section>

      <Section title="Sidebar footer" intro="System state shows as one quiet line. Health appears only when something is broken; live send and budget alerts are the loud states.">
        <div className="grid grid-cols-3 gap-4">
          {FOOTER_STATES.map((s) => (
            <figure key={s.label} className="flex flex-col gap-2">
              <figcaption className="text-caption text-muted">{s.label}</figcaption>
              <div className="w-[232px] rounded-lg border border-line-strong bg-bg px-3 pb-3">
                <SidebarFooter static health={s.health} pathname="/" />
              </div>
            </figure>
          ))}
        </div>
      </Section>
    </div>
  );
}
