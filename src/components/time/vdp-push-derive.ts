/**
 * VDP ▸ Changes ▸ Push runs (2026-11-16): each "Push N to VDP" runs in the background (the click returns at once) and
 * is its own item here, like Activity's Logging runs: when, how many, where it stands, and every item it pushed with
 * how it ended. Pure, so the page and its tests read the same thing.
 */
import type { BadgeTone } from '@/components/domain/lib/v2';
import type { VdpPushNode, VdpPushRun } from '@/contract';

export interface PushRunView {
  id: string;
  /** The status, as a badge: "Pushing · 23 of 133", "Done · 124 in VDP · 9 failed", "Stopped · 23 of 133". */
  status: string;
  tone: BadgeTone;
  /** Still going (queued or running): VDP takes one push at a time, so Push waits for it. */
  active: boolean;
  done: number;
  total: number;
  /** The items that need you (failed, not pushed), in push order. */
  problems: VdpPushNode[];
  /** When the last item ended (ISO), for "last item 09:52". */
  lastAt: string | null;
}

const ENDED = new Set<VdpPushNode['state']>(['applied', 'dry_run', 'failed', 'skipped']);

export function pushRunView(r: VdpPushRun): PushRunView {
  const counts = { applied: 0, recorded: 0, failed: 0, notPushed: 0, waiting: 0 };
  for (const n of r.nodes) {
    if (n.state === 'applied') counts.applied++;
    else if (n.state === 'dry_run') counts.recorded++;
    else if (n.state === 'failed') counts.failed++;
    else if (n.state === 'skipped') counts.notPushed++;
    else counts.waiting++;
  }
  const total = r.nodes.length;
  const done = r.nodes.filter((n) => ENDED.has(n.state)).length;
  const active = r.state === 'queued' || r.state === 'running';
  const problems = r.nodes.filter((n) => n.state === 'failed' || n.state === 'skipped');
  const lastAt = r.nodes.reduce<string | null>((m, n) => (n.at && ENDED.has(n.state) && (!m || n.at > m) ? n.at : m), null);
  const bad = [counts.failed ? `${counts.failed} failed` : null, counts.notPushed ? `${counts.notPushed} not pushed` : null].filter(Boolean).join(' · ');
  let status: string;
  let tone: BadgeTone;
  if (r.state === 'queued' && done === 0) {
    status = `Starting · ${total} ${total === 1 ? 'item' : 'items'}`;
    tone = 'now';
  } else if (active) {
    status = `Pushing · ${done} of ${total} done${bad ? ` · ${bad}` : ''}`;
    tone = 'now';
  } else if (r.state === 'stopped') {
    status = `Stopped · ${done - counts.notPushed} of ${total} done`;
    tone = 'warning';
  } else if (r.dryRun) {
    status = `Dry run · ${counts.recorded} recorded, nothing sent${bad ? ` · ${bad}` : ''}`;
    tone = bad ? 'warning' : 'neutral';
  } else {
    status = bad ? `Done · ${counts.applied} in VDP · ${bad}` : `Done · all ${counts.applied} in VDP`;
    tone = counts.failed ? 'danger' : bad ? 'warning' : 'success';
  }
  return { id: r.id, status, tone, active, done, total, problems, lastAt };
}

/** One item's state, as words and a tone. */
export function pushNodeState(n: Pick<VdpPushNode, 'state'>): { text: string; tone: BadgeTone } {
  switch (n.state) {
    case 'applied':
      return { text: 'In VDP', tone: 'success' };
    case 'dry_run':
      return { text: 'Recorded (dry run)', tone: 'neutral' };
    case 'failed':
      return { text: 'Failed', tone: 'danger' };
    case 'skipped':
      return { text: 'Not pushed', tone: 'warning' };
    case 'running':
      return { text: 'Pushing', tone: 'now' };
    default:
      return { text: 'Waiting', tone: 'neutral' };
  }
}

/** "create company" → "Create company". */
export const pushOpLabel = (op: string) => (op ? `${op.charAt(0).toUpperCase()}${op.slice(1)}`.replace(/_/g, ' ') : 'Change');

/** The push still going, if any (VDP takes one at a time). */
export const activeRun = (runs: readonly VdpPushRun[]): VdpPushRun | null => runs.find((r) => r.state === 'queued' || r.state === 'running') ?? null;

/** The items of a push grouped by company, in push order. */
export function byCompany(nodes: readonly VdpPushNode[]): Array<{ company: string; nodes: VdpPushNode[] }> {
  const out: Array<{ company: string; nodes: VdpPushNode[] }> = [];
  for (const n of nodes) {
    const c = n.companyName || 'Other';
    const g = out.find((x) => x.company === c);
    if (g) g.nodes.push(n);
    else out.push({ company: c, nodes: [n] });
  }
  return out;
}
