/**
 * Time ▸ VDP details (pure): the panel's head sentence, the asset candidates split into open and closed, the "Find
 * assets" run line, and small labels. The panel renders what these return.
 */
import { OPEN_CANDIDATE_STATUSES, type VdpAssetCandidate, type VdpAssetKind, type VdpBackfillState, type VdpDetailPayload, type VdpPersonView } from '@/contract';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { statusLine } from './vdp-derive';

export const KIND_LABEL: Record<VdpAssetKind, string> = {
  deck: 'Deck',
  doc: 'Doc',
  sheet: 'Sheet',
  pdf: 'PDF',
  recording: 'Recording',
  demo: 'Demo org',
  canvas: 'Canvas',
  link: 'Link',
};

/** Open (suggested first, then unsure, then marked added) and closed (in VDP, dismissed). */
export function candidateGroups(list: readonly VdpAssetCandidate[]): {
  open: VdpAssetCandidate[];
  closed: VdpAssetCandidate[];
} {
  const open = list.filter((c) => OPEN_CANDIDATE_STATUSES.includes(c.status));
  return {
    open,
    closed: list.filter((c) => !OPEN_CANDIDATE_STATUSES.includes(c.status)),
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The panel's line under the title, from the same status the card shows: "3 open · 2 the app can fix · 2 assets to
 * add" / "Done: VDP has everything the app checks" / "Waiting for VDP to refresh · next read 14:30" / "No VDP yet".
 */
export function panelSentence(d: Pick<VdpDetailPayload, 'vdp' | 'steps' | 'status'>, g: { open: readonly VdpAssetCandidate[] }, nowMs: number = Date.now(), tz?: string): string {
  const add = g.open.filter((c) => c.status === 'suggested').length;
  const confirm = g.open.filter((c) => c.status === 'unsure').length;
  const parts: string[] = [];
  if (!d.vdp) parts.push(d.steps.some((s) => s.kind === 'add_opp') ? 'Not on its VDP yet: add it' : d.steps.some((s) => s.kind === 'create_company') ? 'VDP lacks the company: one push creates it, its VDP and what goes under it' : 'No VDP yet: one push creates it and what goes under it');
  else parts.push(statusLine(d.status, nowMs, tz));
  if (add) parts.push(d.vdp ? `${plural(add, 'asset')} to add` : `${plural(add, 'asset')} ready for it`);
  if (confirm) parts.push(`${confirm} to confirm`);
  return parts.join(' · ');
}

/** "Alex Doe, Sam Roe" (names, else emails); null when nobody. */
export function personList(ps: readonly VdpPersonView[]): string | null {
  const names = ps.map((p) => p.name ?? p.email).filter((x): x is string => !!x);
  return names.length ? names.join(', ') : null;
}

/** The last "Find assets" run in one line. */
export function runLine(b: Pick<VdpBackfillState, 'last'>, tz: string | undefined): string {
  const r = b.last;
  if (!r) return 'Not searched yet';
  if (r.status === 'queued') return 'Find assets is queued';
  if (r.status === 'running') return 'Looking through Drive, Slack, Gmail and Calendar…';
  const when = r.finishedAt ?? r.startedAt;
  const at = `${dayLabel(when, tz)} ${clock(when, tz)}`;
  if (r.status === 'done') return `Searched ${at} · ${r.found ? `${plural(r.found, 'new find')}` : 'nothing new'}${r.costUsd ? ` · $${r.costUsd.toFixed(2)}` : ''}`;
  return `Last search ${at} didn't finish${r.note ? `: ${r.note}` : ''}`;
}
