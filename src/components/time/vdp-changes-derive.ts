/**
 * Time ▸ VDP (D-60, D-63): the pure parts shared by the two sub-tabs. The server decides everything (the items, who
 * applies each, the suggestions, what autopilot did: src/engines/vdp/*); these only shape it for the screen. The
 * Changes tab's tree and its selection rules are in ./vdp-tree-derive.ts.
 *
 *   Changes   who applies an item ("Autopilot applies it", "The app suggests, you approve"), what autopilot did
 *   My VDPs   each current VDP's summary: who is on it, its use cases and assets, "N missing" / "N to check" or Done.
 */
import type { VdpCoveragePayload, VdpCoverageRow, VdpStep, VdpStepAutopilot } from '@/contract';

const fiscal = (v: Pick<VdpCoverageRow, 'fiscalYear' | 'fiscalQuarter'>) => (v.fiscalYear !== null && v.fiscalYear !== undefined ? `FY${String(v.fiscalYear).padStart(2, '0').slice(-2)}${v.fiscalQuarter ? ` Q${v.fiscalQuarter}` : ''}` : null);

/** Who applies it, in the row's words (D-63: an item VDP's MCP can't take yet says so instead). */
export function whoLine(r: Pick<VdpStep, 'policy' | 'state' | 'check'> & { disabled?: string | null }, autopilotOn: boolean): string {
  if (r.disabled) return r.disabled;
  if (r.policy === 'auto') return autopilotOn ? 'Autopilot applies it' : 'The app can apply it (autopilot is off)';
  if (r.policy === 'suggest') return r.check === 'wrong' ? 'Looks wrong: the app suggests a fix, you approve it' : 'The app suggests, you approve';
  return 'You approve it';
}

/** What autopilot did or will do, in words ("Applied automatically · Nov 11 14:02"). */
export function autopilotLabel(a: VdpStepAutopilot, when: (iso: string) => string): { text: string; tone: 'success' | 'danger' | 'warning' | 'neutral' } {
  if (a.state === 'applied') return { text: `Applied automatically${a.at ? ` · ${when(a.at)}` : ''}`, tone: 'success' };
  if (a.state === 'failed') return { text: `Autopilot could not apply it: ${a.detail ?? 'open its details'}`, tone: 'danger' };
  if (a.state === 'paused') return { text: a.detail ?? 'Autopilot is paused', tone: 'warning' };
  return { text: a.detail ?? 'Autopilot applies it on its next run', tone: 'neutral' };
}

// ---------------------------------------------------------------------------

// My VDPs
// ---------------------------------------------------------------------------

export interface MineRow {
  row: VdpCoverageRow;
  fiscal: string | null;
  missing: number;
  toCheck: number;
  /** "Done", "3 missing · 1 to check", "Waiting for VDP to refresh", "Past" */
  state: 'done' | 'open' | 'waiting' | 'waiting_dc' | 'past';
}

/** My VDPs: the current ones first (open, waiting, done), then past ones; each with its missing / to-check counts. */
export function mineRows(cov: Pick<VdpCoveragePayload, 'vdps'>): { current: MineRow[]; past: MineRow[] } {
  const rows = cov.vdps.map((r) => ({ row: r, fiscal: fiscal(r), missing: r.status.missing ?? r.status.open, toCheck: r.status.toCheck ?? 0, state: r.status.state }));
  return { current: rows.filter((r) => r.state !== 'past'), past: rows.filter((r) => r.state === 'past') };
}

/** "Dana Lee (CIO)", "dana@example.com" */
export const personText = (p: { name: string | null; email?: string | null; title?: string | null }) => [p.name ?? p.email ?? 'Someone', p.title ? `(${p.title})` : null].filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// The last push's failures (2026-11-13 audit C6)
// ---------------------------------------------------------------------------

export interface PushFailure {
  itemKey: string;
  /** The row's title ("Use case: …"), else the item key. */
  label: string;
  /** Why it was not pushed, in full. */
  why: string;
}

/**
 * Every item a push did not send (failed, or skipped because an item it needs failed), each with its own reason, in
 * the push's order: listed until you dismiss it, never only the first one in a toast.
 */
export function pushFailures(results: ReadonlyArray<{ itemKey: string; state: string; error?: string | null; required?: boolean }>, rows: ReadonlyArray<{ key: string | null; title: string }>): PushFailure[] {
  const title = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r.title] as const));
  return results
    .filter((x) => x.state === 'failed' || x.state === 'skipped')
    .map((x) => ({
      itemKey: x.itemKey,
      label: `${title.get(x.itemKey) ?? x.itemKey}${x.required ? ' (needed first)' : ''}`,
      why: x.error?.trim() || (x.state === 'skipped' ? 'Not pushed: an item it needs failed first' : 'Not pushed: no reason came back (see the row)'),
    }));
}
