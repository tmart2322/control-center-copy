'use client';
/**
 * "Why is this here?" (AUDIT, north star Legible): the provenance chain of a work item, one step per piece of
 * evidence, origin first:
 *
 *   source message (its link) → the scan run that made it (time, scope, skill version) → the triage verdict and its
 *   reason (and the escalation's final call) → the model spend of that run (cost, calls, which budget).
 *
 * Color is an indicator only: the verdict dot says act (brand) / unsure (warn) / noise (neutral); the model line
 * carries the AI glyph. Sources, connectors and runs are neutral. Reuses the panel kit (EvidenceChip, GroupLabel).
 */
import type { ItemTraceStep } from '@/contract';
import { useApi } from '@/client/hooks';
import { cn, EmptyState, PanelError, Skeleton, usePanelState } from '@/ui';
import { ROLE_META } from '../lib/derive';
import { fmtWhen } from '../lib/tz';
import { EvidenceChip, GroupLabel, ToneDot } from '../panel/bits';

const VERDICT: Record<string, { label: string; tone: 'brand' | 'warn' | 'neutral' }> = {
  act: { label: 'Act', tone: 'brand' },
  unsure: { label: 'Unsure', tone: 'warn' },
  noise: { label: 'Noise', tone: 'neutral' },
  missing: { label: 'No verdict', tone: 'warn' },
};

const usd = (n: number) => `$${n < 0.1 ? n.toFixed(4) : n.toFixed(2)}`;
const short = (id: string) => id.slice(0, 8);

function Line({ label, children, ...rest }: { label: string; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 text-caption" {...rest}>
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-fg">{children}</span>
    </div>
  );
}

function Step({ s, now, tz }: { s: ItemTraceStep; now: string; tz?: string }) {
  const role = ROLE_META[s.role as keyof typeof ROLE_META];
  const v = s.verdict;
  const final = v?.final ? VERDICT[v.final.v] ?? { label: v.final.v, tone: 'neutral' as const } : null;
  const first = v ? VERDICT[v.v] ?? { label: v.v, tone: 'neutral' as const } : null;
  return (
    <li className="relative ml-1 border-l border-line pb-5 pl-5 last:pb-1" data-trace-step={s.evidenceId} data-role={s.role}>
      <span aria-hidden className="absolute top-2.5 -left-[5px] size-2 rounded-full bg-faint ring-2 ring-surface" />
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <GroupLabel>{role?.label ?? s.role}</GroupLabel>
        {s.source ? <EvidenceChip source={s.source} /> : <span className="text-caption text-muted">No source item (added in the app)</span>}
        {s.source?.at ? (
          <time dateTime={s.source.at} className="text-caption text-muted tabular-nums">
            {fmtWhen(s.source.at, now, tz, { today: true })}
          </time>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        {s.rationale ? <Line label="Linked because">{s.rationale}</Line> : null}
        {s.run ? (
          <Line label={s.run.via === 'trace' ? 'Scan run' : 'Recorded by'} data-trace-run={s.run.id}>
            <span className="font-bold">{s.run.connector}</span> {s.run.scope?.replace(`${s.run.connector}:`, '') ?? ''} · {s.run.startedAt ? fmtWhen(s.run.startedAt, now, tz, { today: true }) : 'not started'} · {s.run.mode}
            {s.run.skillVersion ? ` · skill ${s.run.skillVersion}` : ''}
            {s.run.status !== 'succeeded' ? <span className="font-bold text-warning-700"> · {s.run.status}</span> : null}
            <span className="ml-1 font-mono text-micro text-faint" title={`npm run scan:trace -- ${s.run.id}`}>
              run {short(s.run.id)}
            </span>
          </Line>
        ) : s.sourceItemId ? (
          <Line label="Scan run">
            <span className="text-muted">No run on record (recorded before the scan trace)</span>
          </Line>
        ) : null}
        {v && first ? (
          <Line label="Triage" data-trace-verdict={v.final?.v ?? v.v}>
            <span className="inline-flex items-baseline gap-1.5">
              <ToneDot tone={first.tone} className="self-center" />
              <span className="font-bold">{first.label}</span>
            </span>
            {v.why ? <span className="text-muted"> · {v.why}</span> : null}
            {final ? (
              <span className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-muted">Escalated →</span>
                <ToneDot tone={final.tone} className="self-center" />
                <span className="font-bold">{final.label}</span>
                {v.final?.why ? <span className="text-muted">· {v.final.why}</span> : null}
              </span>
            ) : v.escalated ? (
              <span className="text-muted"> · escalated, no final verdict yet</span>
            ) : null}
          </Line>
        ) : null}
        {s.spend ? (
          <Line label="Model" data-trace-spend>
            <span className="font-bold text-ai-700" aria-hidden>
              ✦{' '}
            </span>
            {usd(s.spend.costUsd)} · {s.spend.calls} call{s.spend.calls === 1 ? '' : 's'}
            {s.spend.model ? ` · ${s.spend.model}` : ''}
            {s.spend.budget ? <span className="text-muted"> · {s.spend.budget === 'first_scan' ? 'first-scan budget' : 'daily budget'}</span> : null}
          </Line>
        ) : null}
      </div>
    </li>
  );
}

export function WhyHere({ itemId, now, tz }: { itemId: string; now: string; tz?: string }) {
  const q = useApi('getItemTrace', { params: { id: itemId } });
  const state = usePanelState('item.trace', { loading: q.isLoading, error: q.data ? null : q.error, empty: !!q.data && q.data.steps.length === 0 });
  if (state === 'loading') return <Skeleton count={4} className="py-2" />;
  if (state === 'error') return <PanelError title="The chain failed to load" error={q.error} onRetry={() => void q.refetch()} compact />;
  if (state === 'empty' || !q.data) return <EmptyState size="panel" icon="search" title="No sources yet" body="The message, scan run and verdict behind this task show up here." />;
  const c = q.data.createdBy;
  return (
    <div className="space-y-3" data-why-here={q.data.steps.length}>
      {c ? (
        <p className={cn('text-caption text-muted')}>
          Created by <span className="font-bold text-fg">{c.actor ?? 'someone'}</span>
          {c.at ? ` · ${fmtWhen(c.at, now, tz, { today: true })}` : ''}
        </p>
      ) : null}
      <ol>
        {q.data.steps.map((s) => (
          <Step key={s.evidenceId} s={s} now={now} tz={tz} />
        ))}
      </ol>
    </div>
  );
}
