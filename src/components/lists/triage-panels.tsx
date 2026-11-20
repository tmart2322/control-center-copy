'use client';
/**
 * Details renderers for the two Triage kinds that are not work items: a missed-opportunity hit
 * (`missed_opp`) and a mapping question (`triage_mapping`). They replace Triage's old side sheet and render
 * in the v2 docked right panel (registerDetailRenderer seam), reading the item from the Triage query.
 *
 * Same anatomy as the work-item panel: a small head, the facts and the evidence, and a footer holding the
 * ONE filled action (Claim) beside a quiet Dismiss with reason chips. A mapping question has no filled
 * default: Triage never guesses an answer for you. Everything is optimistic with Undo (useTriageActions).
 *
 * Registered only when no other lane registered the kind first (Deals may own `missed_opp`).
 */
import { AppLink } from '@/components/shell/AppLink';
import { createElement, useState } from 'react';
import type { TriageItem } from '@/contract';
import { useApi } from '@/client/hooks';
import { getDetailRenderer, registerDetailRenderer, type PanelEntity } from '@/components/shell/panel';
import { Button, EmptyState, fmtDay, Icon, Kbd, PanelBoundary, PanelError, Skeleton, SourceChip } from '@/ui';
import { DISMISS_REASONS } from './triage-reasons';
import { useTriageActions } from './useTriageActions';

export const money = (n: number | null) => (n == null ? null : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);

function useTriageItem(id: string): { item: TriageItem | null; loading: boolean; error: unknown; retry: () => void } {
  const q = useApi('getTriage');
  const item = q.data?.groups.flatMap((g) => g.items).find((i) => i.id === id) ?? null;
  return { item, loading: q.isLoading, error: q.isError ? q.error : null, retry: () => void q.refetch() };
}

function Shell({ eyebrow, title, children, footer }: { eyebrow: string; title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="triage-panel">
      <header className="shrink-0 space-y-1 border-b border-line px-6 py-4">
        <p className="text-caption text-muted">{eyebrow}</p>
        <h2 className="text-title font-bold text-fg-heading">{title}</h2>
      </header>
      <div className="cc-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">{children}</div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-6 py-4">{footer}</footer>
    </div>
  );
}

function DismissChips({ item, onDone }: { item: TriageItem; onDone: () => void }) {
  const actions = useTriageActions();
  const [open, setOpen] = useState(false);
  const reasons = DISMISS_REASONS[item.kind];
  if (!open)
    return (
      <Button variant="quiet" size="sm" kbd="n" onClick={() => setOpen(true)} data-testid="panel-dismiss">
        {item.kind === 'mapping' ? 'Not sure…' : 'Dismiss…'}
      </Button>
    );
  return (
    <div role="group" aria-label="Dismiss because" className="flex flex-wrap items-center gap-1.5">
      <span className="text-caption text-muted">Why?</span>
      {reasons.map((r, i) => (
        <button
          key={r.value}
          type="button"
          onClick={() => {
            actions.dismiss(item.id, r.value);
            onDone();
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-body text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Kbd>{i + 1}</Kbd>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Gone() {
  return <EmptyState size="panel" icon="success" title="This left Triage" body="It was accepted, dismissed or merged. Undo is on the toast for a few seconds." />;
}

function Loading() {
  return (
    <div className="space-y-4 p-6" aria-busy aria-label="Loading">
      <Skeleton variant="line" className="w-40" />
      <Skeleton variant="line" className="w-3/4" />
      <Skeleton variant="block" className="h-32 w-full" />
    </div>
  );
}

function MissedOppBody({ id }: { id: string }) {
  const { item, loading, error, retry } = useTriageItem(id);
  const actions = useTriageActions();
  const [left, setLeft] = useState(false);
  if (loading) return <Loading />;
  if (error) return <div className="p-6"><PanelError title="Triage failed to load" error={error} onRetry={retry} compact /></div>;
  if (!item || !item.missedOpp || left) return <Gone />;
  const m = item.missedOpp;
  return (
    <Shell
      eyebrow={`Missed opportunity · ${m.verdict === 'claim' ? 'worth claiming' : 'worth a check'}`}
      title={m.oppName}
      footer={
        <>
          <Button
            variant="primary"
            size="sm"
            kbd="a"
            onClick={() => {
              actions.accept(item.id);
              setLeft(true);
            }}
            data-testid="panel-claim"
          >
            Claim: add a DC request
          </Button>
          <DismissChips item={item} onDone={() => setLeft(true)} />
        </>
      }
    >
      <p className="max-w-[68ch] text-body text-fg">{item.why}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        {[
          ['Account', m.accountName],
          ['Stage', m.stage],
          ['Amount', money(m.amount) ?? '—'],
          ['Close date', m.closeDate ? fmtDay(`${m.closeDate}T12:00:00Z`, 'UTC') : '—'],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-caption text-muted">{k}</dt>
            <dd className="truncate text-body text-fg tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h3 className="mb-2 text-body font-bold text-fg-heading">
          Evidence <span className="font-normal text-muted tabular-nums">{m.evidence.length}</span>
        </h3>
        <ul className="space-y-1.5">
          {m.evidence.map((e) => (
            <li key={e} className="flex items-start gap-2 text-body text-fg">
              <Icon name="check" size="xs" className="mt-1.5 text-muted" />
              <span className="max-w-[68ch]">{e}</span>
            </li>
          ))}
        </ul>
      </section>
      {m.otherDcs.length ? <p className="text-body text-muted">Other DCs on it: {m.otherDcs.join(', ')}.</p> : null}
      <AppLink href="/deals/missed" className="inline-flex items-center gap-1 text-caption font-bold text-link hover:underline">
        See every missed opp in Deals <Icon name="chevronright" size="xs" />
      </AppLink>
    </Shell>
  );
}

function MappingBody({ id }: { id: string }) {
  const { item, loading, error, retry } = useTriageItem(id);
  const actions = useTriageActions();
  const [left, setLeft] = useState(false);
  if (loading) return <Loading />;
  if (error) return <div className="p-6"><PanelError title="Triage failed to load" error={error} onRetry={retry} compact /></div>;
  if (!item || !item.mapping || left) return <Gone />;
  const q = item.mapping;
  return (
    <Shell eyebrow={`Mapping question · about ${q.subject.label}`} title={q.question} footer={<DismissChips item={item} onDone={() => setLeft(true)} />}>
      <p className="max-w-[68ch] text-body text-fg">{item.why}</p>
      <SourceChip source={q.source.kind} href={q.source.url} label={q.source.label} />
      <section>
        <h3 className="mb-2 text-body font-bold text-fg-heading">Pick the answer</h3>
        <div role="group" aria-label="Choices" className="flex flex-wrap gap-2">
          {q.choices.map((c, i) => (
            <button
              key={c.id}
              type="button"
              data-testid="panel-mapping-choice"
              onClick={() => {
                actions.accept(item.id, { choiceId: c.id, choiceLabel: c.label });
                setLeft(true);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-body text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Kbd>{i + 1}</Kbd>
              {c.label}
            </button>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export function MissedOppPanel({ id }: { id: string }) {
  return (
    <PanelBoundary name="triage.panel" resetKeys={[id]}>
      <MissedOppBody id={id} />
    </PanelBoundary>
  );
}

export function MappingPanel({ id }: { id: string }) {
  return (
    <PanelBoundary name="triage.panel" resetKeys={[id]}>
      <MappingBody id={id} />
    </PanelBoundary>
  );
}

if (typeof window !== 'undefined') {
  if (!getDetailRenderer('missed_opp')) registerDetailRenderer('missed_opp', (e: PanelEntity) => createElement(MissedOppPanel, { key: e.id, id: e.id }));
  if (!getDetailRenderer('triage_mapping')) registerDetailRenderer('triage_mapping', (e: PanelEntity) => createElement(MappingPanel, { key: e.id, id: e.id }));
}

/** Imported for its side effect (the registrations above). */
export const TRIAGE_PANELS_REGISTERED = true;
