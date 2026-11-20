'use client';
/**
 * The v2 detail sections (the Details tab in docs/ui mockups): Why, Plan (your steps vs agent steps),
 * Readiness and Same initiative. Each disappears when it has nothing to say (DESIGN-V2 principle 2).
 */
import { AppLink } from '@/components/shell/AppLink';
import { useState } from 'react';
import type { AgentRun, NbaCard, WorkItem, WorkItemDetail } from '@/contract';
import { RunGlyph, RUN_META } from '@/components/domain';
import { hasSlackMarkup } from '@/lib/compose';
import { cn, Icon } from '@/ui';
import { fmtMin } from '../lib/derive';
import { evidenceSources, readiness, siblingsForPanel, siblingTone, siblingWhen, type PlanStep } from '../lib/panel-derive';
import { fmtWhen } from '../lib/tz';
import { SourceText } from '../SourceText';
import { DetailSection, EvidenceChips, ReadyBadge, ToneDot } from './bits';

// ── Why ──────────────────────────────────────────────────────────────────────────────────────

/** An engine-written line: plain text, or Slack mrkdwn when it quotes a message (mentions by name, links, bold). */
function WhyText({ text, mentions, className }: { text: string; mentions?: Record<string, string>; className: string }) {
  if (!hasSlackMarkup(text)) return <p className={className}>{text}</p>;
  return <SourceText text={text} format="slack_mrkdwn" mentions={mentions} className={className} />;
}

export function WhySection({ item, nba, heading, mentions }: { item: WorkItem; nba: NbaCard | null; heading: string; mentions?: Record<string, string> }) {
  const [more, setMore] = useState(false);
  const why = nba?.why || item.why;
  const detail = nba?.whyDetail ?? item.whyDetail;
  const sources = evidenceSources(item, nba);
  if (!why && !sources.length) return null;
  return (
    <DetailSection title={heading} data-why-section>
      {why ? <WhyText text={why} mentions={mentions} className="max-w-[68ch] text-body text-fg" /> : null}
      {detail ? (
        <>
          {more ? <WhyText text={detail} mentions={mentions} className="mt-2 max-w-[68ch] text-body text-muted" /> : null}
          <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="mt-1 inline-flex items-center gap-1 rounded-sm text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            {more ? 'Less' : 'The full reasoning'}
            <Icon name={more ? 'chevrondown' : 'chevronright'} size="xs" />
          </button>
        </>
      ) : null}
      <EvidenceChips sources={sources} />
    </DetailSection>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────

function StepRun({ run }: { run: AgentRun }) {
  return (
    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-muted" data-run-state={run.state}>
      <RunGlyph state={run.state} size={12} />
      <span className="shrink-0 font-bold whitespace-nowrap text-fg">{RUN_META[run.state].label}</span>
      {run.lastEvent ? <span className="min-w-0 truncate">· {run.lastEvent}</span> : null}
    </span>
  );
}

export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  let n = 0;
  return (
    <ol className="flex flex-col gap-2" data-plan-steps={steps.length}>
      {steps.map((s, i) => (
        <li key={i} data-step={s.who} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-3">
          <span aria-hidden className={cn('font-bold tabular-nums', s.who === 'agent' ? 'text-ai-700' : 'text-faint')}>
            {s.who === 'agent' ? '✦' : ++n}
          </span>
          <span className="min-w-0 text-body text-fg">
            <span className="sr-only">{s.who === 'agent' ? 'Agent: ' : 'You: '}</span>
            {s.label}
          </span>
          <span className="text-caption whitespace-nowrap text-muted tabular-nums">{s.minutes ? `~${fmtMin(s.minutes)}` : '—'}</span>
          {s.sub || s.run ? (
            <span className="col-start-2 col-end-4 flex flex-col text-caption text-muted">
              {s.sub ? <span>{s.sub}</span> : null}
              {s.run ? <StepRun run={s.run} /> : null}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

// ── Readiness ────────────────────────────────────────────────────────────────────────────────

export function ReadinessSection({ detail, now, tz, onOpenItem }: { detail: WorkItemDetail; now: string; tz?: string; onOpenItem: (id: string) => void }) {
  const r = readiness(detail);
  if (!r) return null;
  const m = detail.item.refs.meeting;
  return (
    <DetailSection title={r.title} suffix={m ? fmtWhen(m.start, now, tz, { today: true }) : undefined} data-readiness={r.checks.filter((c) => c.ready).length}>
      <ul className="flex flex-wrap gap-2">
        {r.checks.map((c) => (
          <li key={c.id} className="max-w-full min-w-0" data-ready={c.ready || undefined}>
            <ReadyBadge ready={c.ready} label={c.label} onOpen={c.itemId && !c.self ? () => onOpenItem(c.itemId!) : undefined} />
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

// ── Same initiative ──────────────────────────────────────────────────────────────────────────

export function SameInitiativeSection({
  detail,
  now,
  tz,
  cap = 3,
  onOpenItem,
}: {
  detail: WorkItemDetail;
  now: string;
  tz?: string;
  cap?: number;
  onOpenItem: (id: string) => void;
}) {
  const ini = detail.initiative ?? (detail.item.refs.initiative ? { id: detail.item.refs.initiative.id, title: detail.item.refs.initiative.label } : null);
  const { shown, more } = siblingsForPanel(detail.siblings, detail.item.id, cap);
  if (!ini || !shown.length) return null;
  return (
    <DetailSection
      title="Same initiative"
      suffix={
        <AppLink href={`/initiatives/${ini.id}`} className="text-muted hover:text-link">
          {ini.title}
        </AppLink>
      }
      data-same-initiative={shown.length}
    >
      <ul className="flex flex-col">
        {shown.map((s) => {
          const tone = siblingTone(s, now);
          return (
            <li key={s.id} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => onOpenItem(s.id)}
                data-sibling-id={s.id}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-sm py-2 text-left transition-colors hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none"
              >
                <ToneDot tone={tone} label={tone === 'risk' ? 'Overdue' : tone === 'warn' ? 'Needs you' : tone === 'ok' ? 'Done' : tone === 'brand' ? 'Now' : undefined} />
                <span className={cn('min-w-0 text-body', tone === 'ok' ? 'text-muted line-through decoration-line-strong' : 'text-fg')}>{s.title}</span>
                <span className="text-caption whitespace-nowrap text-muted tabular-nums">{siblingWhen(s, now, tz)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {more ? (
        <AppLink href={`/initiatives/${ini.id}`} className="mt-2 inline-flex text-caption font-bold text-link">
          See all {shown.length + more} →
        </AppLink>
      ) : null}
    </DetailSection>
  );
}
