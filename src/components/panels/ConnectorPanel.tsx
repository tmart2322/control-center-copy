'use client';
/**
 * Details renderer for `connector` (Health rows, the header health dot, Today's re-auth fit-in).
 *
 *   head    Source · one state badge / what it reads up to, or since when it's broken
 *   body    loud only when broken: what's affected, the re-auth command with Copy, the MFA notes ·
 *           Last scan (its real state, including a dead-lettered scan job) · Coverage and gaps per scope ·
 *           Recent scans
 *   footer  ONE filled action: the re-auth (Reconnect / Open Terminal / Run refresh) when broken, else Rescan
 *
 * Rescan uses the existing POST /connectors/:id/scan; this panel then shows whatever the ledger says about
 * that run (queued, running, auth failed…) and the scan job's state, never an assumed success.
 */
import type { Connector, ScanRun } from '@/contract';
import { useApi } from '@/client/hooks';
import { clock, dayLabel, sameDay } from '@/components/domain/lib/time';
import { useConnectorActions } from '@/components/health/actions';
import { CONNECTOR_META } from '@/components/domain';
import { cn, Icon, PanelBoundary, Skeleton, SOURCE_META, StaleMark, useNow, useTimeZone } from '@/ui';
import { CommandBlock, Facts, PanelFrame, PanelLoading, PanelProblem, PanelSection, QuietAction, StateBadge, type PanelPrimary } from './bits';
import { ATTENTION, BROKEN, connectorLine, connectorPrimary, coverage, ledgerHref, SCAN_STATUS, scanJobs } from './derive';
import { navigate } from '@/components/shell/router';

export interface ConnectorPanelProps {
  connectorId: string;
}

export function ConnectorPanel(props: ConnectorPanelProps) {
  return (
    <PanelBoundary name="health.connector-panel" resetKeys={[props.connectorId]}>
      <ConnectorPanelBody {...props} />
    </PanelBoundary>
  );
}

function ConnectorPanelBody({ connectorId }: ConnectorPanelProps) {
  const q = useApi('getHealth'); // live: the health topic (the sidebar's query keeps the 5-minute safety net)
  const c = q.data?.connectors.find((x) => x.id === connectorId);
  if (q.isLoading) return <PanelLoading label="Loading the connector" />;
  if (!c) return <PanelProblem gone={!!q.data} error={q.error} what="connector" onRetry={() => void q.refetch()} />;
  return <Loaded c={c} />;
}

const STATE_GLYPH: Record<Connector['state'], string> = { ok: '✓', catching_up: '◷', degraded: '▲', auth_needed: '✕', error: '✕', offline: '–', paused: '–' };

function when(iso: string, now: string, tz?: string) {
  return sameDay(iso, now, tz) ? clock(iso, tz) : `${dayLabel(iso, tz)} ${clock(iso, tz)}`;
}

function ScanLine({ r, now, tz }: { r: ScanRun; now: string; tz?: string }) {
  const s = SCAN_STATUS[r.status];
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className={cn('font-bold', s.tone === 'risk' ? 'text-danger-700' : s.tone === 'warn' ? 'text-warning-700' : s.tone === 'ok' ? 'text-fg' : 'text-link')}>{s.label}</span>
      <span className="text-caption text-muted tabular-nums">
        {when(r.startedAt, now, tz)} · {r.scope} · {r.itemsNew} new of {r.itemsSeen}
        {r.costUsd ? ` · $${r.costUsd.toFixed(2)}` : ''}
      </span>
    </span>
  );
}

function Loaded({ c }: { c: Connector }) {
  const now = useNow(15_000).toISOString();
  const tzCtx = useTimeZone();
  const settings = useApi('getSettings', undefined, { enabled: !tzCtx });
  const tz = tzCtx ?? settings.data?.profile.timezone;
  const scans = useApi('getScans', { query: {} });
  const jobs = useApi('getJobs');
  const a = useConnectorActions();

  const broken = BROKEN.has(c.state);
  const attention = ATTENTION.has(c.state);
  const meta = CONNECTOR_META[c.state];
  const src = SOURCE_META[c.source] ?? SOURCE_META.manual;
  const p = connectorPrimary(c);
  const r = c.reauth;
  const rows = coverage(scans.data?.runs ?? [], c.id);
  const mine = (scans.data?.runs ?? []).filter((x) => x.connectorId === c.id).sort((x, y) => y.startedAt.localeCompare(x.startedAt));
  const startedId = a.started[c.id];
  const last = (startedId ? mine.find((x) => x.id === startedId) : undefined) ?? mine[0];
  const job = scanJobs(jobs.data?.jobs ?? [], c)[0];
  const jobBroken = job && (job.status === 'dead' || job.status === 'retrying');
  const gaps = rows.filter((x) => x.gap);

  const primary: PanelPrimary =
    p.kind === 'reauth' && r
      ? { id: 'reauth', label: p.label, icon: r.kind === 'terminal_command' ? 'new_window' : 'refresh', loading: a.reauthing(c.id), run: () => a.reauth.mutate(c) }
      : { id: 'rescan', label: 'Rescan', icon: 'sync', loading: a.scanning(c.id), run: () => a.scan.mutate(c) };

  return (
    <PanelFrame
      label={`${c.label} connector`}
      data-connector-panel={c.id}
      data-connector-state={c.state}
      context={
        <>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <Icon set={src.icon.set} name={src.icon.name} size="sm" className="text-muted" />
            Source
          </span>
          <StateBadge tone={meta.tone} label={`${STATE_GLYPH[c.state]} ${meta.label}`} />
        </>
      }
      title={c.label}
      sub={<span className="tabular-nums">{connectorLine(c, now, tz)}</span>}
      primary={primary}
      quiet={
        <>
          {p.kind === 'reauth' ? (
            <QuietAction icon="sync" onClick={() => a.scan.mutate(c)} disabled={a.scanning(c.id)} data-quiet="rescan">
              Rescan
            </QuietAction>
          ) : null}
          {c.source === 'org62' && !broken ? (
            <QuietAction icon="sync" onClick={() => a.recheck.mutate(c)} disabled={a.rechecking(c.id)} data-quiet="recheck">
              Re-check Org62 records
            </QuietAction>
          ) : null}
          <QuietAction onClick={() => navigate(ledgerHref(c.id))}>Scan ledger</QuietAction>
        </>
      }
    >
      {attention ? (
        <section className={cn('rounded-lg border p-4', broken ? 'border-danger-200 bg-danger-50' : 'border-warning-200 bg-warning-50')} aria-label={broken ? `${c.label} is broken` : `${c.label} needs attention`} data-connector-alert>
          <p className={cn('text-body font-bold', broken ? 'text-danger-700' : 'text-warning-700')}>{c.impact ?? `Items from ${c.label} may be missing or stale until it’s fixed.`}</p>
          {c.lastError ? (
            <p className="mt-1 text-caption text-fg">
              {c.lastError.message}
              <span className="text-muted">
                {' '}
                · {c.lastError.class.replace('_', ' ')}
                {c.lastError.count > 1 ? ` ×${c.lastError.count}` : ''} · {when(c.lastError.at, now, tz)}
              </span>
            </p>
          ) : null}
          {r?.command ? <CommandBlock className="mt-3" command={r.command} note={r.instructions ?? undefined} /> : r?.instructions ? <p className="mt-2 max-w-[68ch] text-body text-fg">{r.instructions}</p> : null}
          {c.affects.length ? (
            <p className="mt-3 text-caption text-muted">
              <StaleMark reason={c.impact ?? `${c.label} data may be behind`}>Marks items in {c.affects.join(', ')} as stale.</StaleMark>
            </p>
          ) : null}
        </section>
      ) : null}

      <PanelSection title="Last scan" suffix={last || scans.isLoading ? undefined : 'none yet'} data-last-scan={last?.status ?? (scans.isLoading ? 'loading' : 'none')}>
        <div className="flex flex-col gap-2">
          {scans.isLoading ? <Skeleton variant="line" count={2} /> : last ? <ScanLine r={last} now={now} tz={tz} /> : <p className="text-body text-muted">No scan recorded. Rescan reads it now.</p>}
          {last?.error ? <p className="text-caption text-danger-700">{last.error}</p> : null}
          {jobBroken ? (
            <p className="text-caption text-danger-700" data-scan-job={job.status}>
              The scan job {job.status === 'dead' ? 'dead-lettered' : 'is retrying'} after {job.attempts} of {job.maxAttempts} tries{job.error ? `: ${job.error}` : ''}. Retry it under Jobs.
            </p>
          ) : job && (job.status === 'queued' || job.status === 'running') ? (
            <p className="text-caption text-muted" data-scan-job={job.status}>
              A scan job is {job.status}.
            </p>
          ) : null}
        </div>
      </PanelSection>

      <PanelSection title="Coverage and gaps" suffix={rows.length ? (gaps.length ? `${gaps.length} with gaps` : 'complete') : undefined}>
        {rows.length ? (
          <ul className="flex flex-col">
            {rows.map((x) => (
              <li key={x.scope} className="flex min-w-0 items-start gap-3 border-t border-line py-2 first:border-t-0" data-coverage={x.gap ? 'gap' : 'ok'}>
                <span aria-hidden className={cn('mt-0.5 w-4 shrink-0 text-center font-bold', x.gap ? 'text-warning-700' : 'text-success-700')}>
                  {x.gap ? '▲' : '✓'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-caption text-fg" title={x.scope}>
                    {x.scope}
                  </span>
                  <span className="block text-caption text-muted tabular-nums">{x.through ? `read through ${when(x.through, now, tz)}` : 'no complete read in the ledger yet'}</span>
                  {x.gap ? <span className="block text-caption text-warning-700">{x.gap}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : scans.isLoading ? null : (
          <p className="text-body text-muted">No scans in the ledger yet, so coverage is unknown.</p>
        )}
      </PanelSection>

      <Facts
        rows={[
          ['Reads', c.cursor.label],
          ['Last success', c.lastSuccessAt ? when(c.lastSuccessAt, now, tz) : 'never'],
          ['Today', `${c.itemsToday} items`],
          c.backlog ? ['Backlog', `${c.backlog} waiting`] : null,
          r && !attention ? ['Re-auth', r.kind === 'in_app' ? `${r.label}, in the app` : r.kind === 'terminal_command' ? 'A Terminal command, when needed' : r.kind === 'refresh_script' ? 'A refresh script, when needed' : (r.instructions ?? r.label)] : null,
        ]}
      />
    </PanelFrame>
  );
}
