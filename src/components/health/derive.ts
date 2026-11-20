/**
 * Health page: pure derivations. The broken / attention states mirror UI-SPEC §9 and the header health dot
 * (`health.summary.broken`), so this page, its loud part (./NeedsYou.tsx) and the chrome never disagree.
 */
import type { Connector, ConnectorState, EventLogEntry, HealthPayload, Job, JobStatus, ScanRun } from '@/contract';

/** States that need a person (auth/error) or are visibly degraded; matches the header dot's `broken` list. */
export const BROKEN_STATES: ReadonlySet<ConnectorState> = new Set(['auth_needed', 'error']);
export const ATTENTION_STATES: ReadonlySet<ConnectorState> = new Set(['auth_needed', 'error', 'degraded', 'offline']);

/**
 * The calm one-liner (DESIGN-V2 principle 10: system status shows only when something is broken):
 * "7/8 sources live · dry run". `broken` lists what needs a person; the page turns loud only for those.
 */
export function calmLine(h: Pick<HealthPayload, 'summary' | 'dryRun'>): { text: string; allLive: boolean } {
  const { ok, total } = h.summary;
  return { text: `${ok}/${total} sources live · ${h.dryRun ? 'dry run' : 'live send'}`, allLive: ok === total };
}

/** Connectors that need you (broken first, then degraded/offline), in a stable order. */
export function needsYou(connectors: Connector[]): Connector[] {
  const rank = (c: Connector) => (BROKEN_STATES.has(c.state) ? 0 : ATTENTION_STATES.has(c.state) ? 1 : 2);
  return connectors.filter((c) => rank(c) < 2).sort((a, b) => rank(a) - rank(b));
}

/** Width tiers for the Health panes, from the page's (= main's) width in px. */
export type HealthTier = 'stack' | 'two' | 'three' | 'four';
export function healthTier(width: number): HealthTier {
  if (width >= 2240) return 'four';
  if (width >= 1600) return 'three';
  if (width >= 896) return 'two';
  return 'stack';
}

export function reauthToastCopy(c: Pick<Connector, 'label'>, kind: 'in_app' | 'terminal_command' | 'refresh_script' | 'instructions'): { title: string; body: string } {
  switch (kind) {
    case 'in_app':
      return { title: `Reconnecting ${c.label}`, body: 'Complete the Google prompt if one appears. Scanning resumes and catches up.' };
    case 'terminal_command':
      return { title: `Opening Terminal for ${c.label}`, body: 'Finish the login in Terminal, then come back. The command is also copyable.' };
    case 'refresh_script':
      return { title: `Refreshing ${c.label}`, body: 'The refresh script runs on this Mac. If Okta needs MFA, Terminal and a browser window open: approve it there.' };
    default:
      return { title: c.label, body: 'Follow the instructions on the row.' };
  }
}

export const JOB_ORDER: JobStatus[] = ['dead', 'running', 'retrying', 'queued', 'succeeded', 'cancelled'];
export const JOB_LABEL: Record<JobStatus, string> = { dead: 'Dead-letter', running: 'Running', retrying: 'Retrying', queued: 'Queued', succeeded: 'Succeeded', cancelled: 'Cancelled' };

export function groupJobs(jobs: Job[]): Array<{ status: JobStatus; jobs: Job[] }> {
  return JOB_ORDER.map((s) => ({ status: s, jobs: jobs.filter((j) => j.status === s) })).filter((g) => g.jobs.length > 0);
}

export interface EventFilter {
  level: 'all' | 'error' | 'warn' | 'info';
  source: string;
  showAcknowledged: boolean;
}

export function filterEvents(entries: EventLogEntry[], f: EventFilter): EventLogEntry[] {
  return entries
    .filter((e) => (f.showAcknowledged || !e.acknowledged) && (f.level === 'all' || e.level === f.level) && (f.source === 'all' || e.source === f.source))
    .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function filterScans(runs: ScanRun[], connectorId: string): ScanRun[] {
  return runs.filter((r) => connectorId === 'all' || r.connectorId === connectorId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface SpendRow {
  name: string;
  usd: number;
}

/** Bars sorted high to low, with a 4-row cap folded into "Other" so labels never crowd. */
export function topWithOther(rows: SpendRow[], max = 6): SpendRow[] {
  const sorted = [...rows].sort((a, b) => b.usd - a.usd);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, r) => s + r.usd, 0);
  return [...head, { name: 'Other', usd: Math.round(rest * 1000) / 1000 }];
}

export function budgetSegments(today: HealthPayload['spend']['today']) {
  const used = Math.min(today.usd, today.hardCapUsd);
  return { usedPct: (used / today.hardCapUsd) * 100, softPct: (today.softBudgetUsd / today.hardCapUsd) * 100 };
}

export const usd = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;

/**
 * "Couldn't start re-auth": the failure, the command to run instead with a Copy button (no dead end), and a long but
 * finite life so a stale one never sits on the screen.
 */
export function reauthErrorToast(c: Pick<Connector, 'id' | 'label' | 'reauth'>, message: string, copy: (text: string) => unknown = copyCommand) {
  const command = c.reauth?.command ?? null;
  return {
    key: `reauth-${c.id}`,
    tone: 'error' as const,
    title: `Couldn’t start re-auth for ${c.label}`,
    body: command ? `${message.replace(/\.$/, '')}. Copy the command and run it in Terminal instead.` : message,
    durationMs: 20_000,
    ...(command ? { action: { label: 'Copy command', onClick: () => void copy(command) } } : {}),
  };
}

function copyCommand(text: string): Promise<void> | undefined {
  return typeof navigator !== 'undefined' ? navigator.clipboard?.writeText(text) : undefined;
}
