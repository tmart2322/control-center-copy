/**
 * One status per VDP (pure, D-59): the ONE function every surface reads (the Time ▸ VDP card and its head sentence,
 * the details panel, Home ▸ Log & fix and the Time badge), so they can never disagree.
 *
 *   done     nothing open: a check and "Done"
 *   open     "N open": items that need you (to do, blocked behind another, or staged for your Apply)
 *   waiting  "Waiting for VDP to refresh": everything left was applied or marked added after the last VDP read; the
 *            next read (every 30 min, `nextReadAt`) confirms it, and the item closes (or comes back if it didn't take)
 *   past     an old fiscal period on closed opps: listed quietly, never checked
 *
 * Staged and applied Outbox items are matched to their item by `itemKey` (the draft's input), or for items staged
 * before D-59 by the op, the VDP, the use case and the field they set.
 */
import type { Draft, VdpCoveragePayload, VdpStatus, VdpStep } from '@/contract';

import type { DraftRef } from './steps';
import { itemKey } from './steps';

/** The mirror reads VDP every 30 minutes (src/scanner/runtime/connectors.ts). */
export const VDP_READ_EVERY_MS = 30 * 60_000;

export const nextReadAt = (lastReadAt: string | null): string | null => (lastReadAt ? new Date(Date.parse(lastReadAt) + VDP_READ_EVERY_MS).toISOString() : null);

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The item a `vdp.*` action closes: its `itemKey`, else (staged before D-59) derived from its op and field. */
export function vdpItemKeyOf(action: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  const key = str(i.itemKey);
  if (key) return key;
  const slug = str(i.vdpSlug);
  const field = str(i.field);
  if (!slug || !field) return null;
  switch (action) {
    case 'vdp.update_use_case':
      return str(i.useCaseId) ? itemKey.useCase(slug, str(i.useCaseId)!) : null;
    case 'vdp.create_use_case':
      return itemKey.createUseCase(slug);
    case 'vdp.update_vdp_header':
      if (field === 'fiscal_year' || field === 'fiscal_quarter') return itemKey.fiscalPeriod(slug);
      if (field === 'salesforce_account_id') return itemKey.accountId(slug);
      return itemKey.linkOpp(slug);
    default:
      return null;
  }
}

const STAGED = new Set<Draft['status']>(['ready', 'failed']);
const APPLIED = new Set<Draft['status']>(['sending', 'sent', 'verified']);
/** D-69 (VD-23): the ops that make something; sending one twice makes two. */
export const VDP_CREATE_OPS: ReadonlySet<string> = new Set(['create_company', 'create_vdp', 'create_use_case']);

/**
 * D-69 (VD-23): a create that may have reached VDP: its live write failed in a way that does not say it never arrived
 * (a timeout, a dropped connection, a 5xx: `transient` / `unknown`), or it was written and its read-back could not
 * confirm it either way. Such an item is "maybe made": a push looks in VDP first, never sends it again blind.
 */
export function maybeMade(d: Pick<Draft, 'status' | 'attempts' | 'destination'> & Partial<Pick<Draft, 'verification'>>): boolean {
  if (d.destination.kind !== 'action' || !VDP_CREATE_OPS.has(d.destination.action.slice(4))) return false;
  if (d.status === 'verify_failed') return d.verification?.state !== 'failed';
  if (d.status !== 'failed') return false;
  const last = [...(d.attempts ?? [])].reverse().find((a) => !a.dryRun);
  return !!last && last.outcome === 'failed' && /\((transient|unknown)\)/.test(last.detail ?? '');
}

/** When an applied item reached VDP: its newest live (not dry-run) send, else when it last changed. */
function appliedAt(d: Pick<Draft, 'attempts' | 'updatedAt'>): string {
  const sent = (d.attempts ?? []).filter((a) => !a.dryRun && (a.outcome === 'sent' || a.outcome === 'unconfirmed')).map((a) => a.at).sort();
  return sent.at(-1) ?? d.updatedAt;
}

/**
 * Staged and applied VDP items by item key: the newest one per key wins. A dry-run Apply leaves the item staged
 * (nothing reached VDP); a rejected, discarded or failed-read-back item is not counted (the item stays open).
 */
export function vdpDraftRefs(drafts: readonly (Pick<Draft, 'id' | 'status' | 'destination' | 'attempts' | 'updatedAt' | 'createdAt'> & Partial<Pick<Draft, 'externalId' | 'resultUrl' | 'verification'>>)[]): Map<string, DraftRef> {
  const out = new Map<string, DraftRef>();
  for (const d of drafts) {
    if (d.destination.kind !== 'action' || !d.destination.action.startsWith('vdp.')) continue;
    const state = maybeMade(d) ? 'maybe' : STAGED.has(d.status) ? 'staged' : APPLIED.has(d.status) ? 'applied' : null;
    if (!state) continue;
    const key = vdpItemKeyOf(d.destination.action, d.destination.input);
    if (!key) continue;
    const pending = !!(d.destination.input as { pending?: unknown } | null)?.pending;
    const ref: DraftRef = { id: d.id, state, at: state === 'applied' || state === 'maybe' ? appliedAt(d) : d.updatedAt, externalId: d.externalId ?? null, resultUrl: d.resultUrl ?? null, pending, verified: d.status === 'verified' };
    const cur = out.get(key);
    if (!cur || ref.at > cur.at) out.set(key, ref);
  }
  return out;
}

/** The reason a staged VDP change is withdrawn once VDP shows what it would set (D-60). */
export const VDP_WITHDRAWN_REASON = 'Withdrawn: VDP already has this';
/** A staged change still waiting after this long asks "Stale: still want this?" on the Changes tab (D-60). */
export const VDP_STALE_AFTER_MS = 14 * 86_400_000;

/**
 * The staged VDP changes to withdraw (D-60): waiting for Apply (ready or failed), staged before the last VDP read, and
 * their item is open nowhere any more (VDP already has it, or the item went away). An item key no row knows keeps the
 * draft only when it could not be matched at all (a legacy change), so nothing hides behind a badge with no item.
 */
export function goneVdpDrafts(cov: Pick<VdpCoveragePayload, 'vdps' | 'notInVdp' | 'lastReadAt'>, drafts: readonly Pick<Draft, 'id' | 'status' | 'destination' | 'createdAt'>[], o: { running?: ReadonlySet<string> } = {}): string[] {
  if (!cov.lastReadAt) return [];
  const open = new Set<string>();
  for (const r of cov.vdps) {
    for (const s of r.steps) if (s.apply?.key) open.add(s.apply.key);
    for (const a of r.assetItems ?? []) if (a.apply?.key) open.add(a.apply.key);
  }
  for (const r of cov.notInVdp) {
    for (const s of [r.step, ...(r.children ?? [])]) if (s.apply?.key) open.add(s.apply.key);
    for (const a of r.assetItems ?? []) if (a.apply?.key) open.add(a.apply.key);
  }
  const out: string[] = [];
  for (const d of drafts) {
    if (!STAGED.has(d.status) || d.destination.kind !== 'action' || !d.destination.action.startsWith('vdp.')) continue;
    if (d.createdAt >= cov.lastReadAt) continue;
    // VD-24: a running push's own items are its to finish (the read that landed mid-push withdraws nothing of it)
    if (o.running?.has(d.id)) continue;
    // VD-23: a create that may have reached VDP stays until a push has looked
    if (maybeMade(d as unknown as Parameters<typeof maybeMade>[0])) continue;
    const key = vdpItemKeyOf(d.destination.action, d.destination.input);
    if (key && !open.has(key)) out.push(d.id);
  }
  return out;
}

/** Still waiting for Apply 14 days after it was staged. */
export const isStaleVdpDraft = (d: Pick<Draft, 'createdAt'>, nowMs: number): boolean => nowMs - Date.parse(d.createdAt) >= VDP_STALE_AFTER_MS;

/** One VDP's (or one Not-in-VDP row's) status from its items. */
export function vdpStatusOf(steps: readonly (Pick<VdpStep, 'state' | 'who'> & Partial<Pick<VdpStep, 'check' | 'apply' | 'disabled'>>)[], scope: 'current' | 'waiting_dc' | 'past', lastReadAt: string | null): VdpStatus {
  const next = nextReadAt(lastReadAt);
  if (scope === 'past') return { state: 'past', open: 0, appCanFix: 0, waiting: 0, missing: 0, toCheck: 0, label: 'Past', nextReadAt: next };
  // D-69 (VD-11): a current VDP whose account has no open 100%-DC opp of mine yet: not checked until the DC lands
  if (scope === 'waiting_dc') return { state: 'waiting_dc', open: 0, appCanFix: 0, waiting: 0, missing: 0, toCheck: 0, label: 'Waiting for your DC', nextReadAt: next };
  const open = steps.filter((s) => s.state !== 'waiting');
  const waiting = steps.length - open.length;
  // D-63: what the app can push now (an item with a call VDP's MCP takes); a disabled one waits for the tool
  const appCanFix = open.filter((s) => s.who === 'app' && (s.apply === undefined || (!!s.apply && !s.disabled))).length;
  // D-60: "N missing" (VDP lacks it) and "N to check" (a value looks wrong)
  const toCheck = open.filter((s) => s.check === 'wrong').length;
  const state = open.length ? 'open' : waiting ? 'waiting' : 'done';
  return { state, open: open.length, appCanFix, waiting, missing: open.length - toCheck, toCheck, label: state === 'open' ? `${open.length} open` : state === 'waiting' ? 'Waiting for VDP to refresh' : 'Done', nextReadAt: next };
}

/** The page's counts: VDPs that need you, are waiting, are done, are past; Not-in-VDP rows that need you. */
export function vdpSummary(c: Pick<VdpCoveragePayload, 'vdps' | 'notInVdp'>): VdpCoveragePayload['summary'] {
  const n = (s: VdpStatus['state']) => c.vdps.filter((v) => v.status.state === s).length;
  const rows = c.notInVdp.filter((r) => r.status.state === 'open');
  return {
    needYou: n('open'),
    waiting: n('waiting') + c.notInVdp.filter((r) => r.status.state === 'waiting').length,
    done: n('done'),
    past: n('past'),
    waitingDc: n('waiting_dc'),
    notInVdp: rows.length,
    appCanFix: c.vdps.reduce((t, v) => t + v.status.appCanFix, 0) + rows.reduce((t, r) => t + r.status.appCanFix, 0),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one sentence (Time ▸ VDP head, Home, the badge's label): "3 VDPs need you · 2 waiting · 9 done", then the
 * accounts and opps not in VDP yet. Null when there is nothing to say (no VDPs and nothing missing).
 */
export function vdpStatusSentence(s: VdpCoveragePayload['summary']): string {
  const parts = [s.needYou ? `${plural(s.needYou, 'VDP needs you', 'VDPs need you')}` : null, s.waiting ? `${s.waiting} waiting` : null, s.waitingDc ? `${s.waitingDc} waiting for your DC` : null, s.done ? `${s.done} done` : null, s.notInVdp ? `${s.notInVdp} not in VDP yet` : null].filter(Boolean);
  if (!parts.length) return s.past ? `No current VDPs · ${s.past} past` : 'No VDPs yet';
  return parts.join(' · ');
}

/** How many need you, for Home and the Time badge: VDPs open plus Not-in-VDP rows open. */
export const vdpNeedYouCount = (s: Pick<VdpCoveragePayload['summary'], 'needYou' | 'notInVdp'>) => s.needYou + s.notInVdp;

/** Home ▸ Log & fix's VDP input: the summary and the first VDP (or Not-in-VDP row) that needs you. */
export function vdpHomeOf(c: Pick<VdpCoveragePayload, 'vdps' | 'notInVdp' | 'summary' | 'lastReadAt'>): { summary: VdpCoveragePayload['summary']; first: { key: string; label: string } | null } | undefined {
  if (!c.lastReadAt) return undefined;
  const v = c.vdps.find((x) => x.status.state === 'open');
  const r = c.notInVdp.find((x) => x.status.state === 'open');
  return { summary: c.summary, first: v ? { key: v.vdpSlug, label: v.companyName } : r ? { key: r.key, label: r.title } : null };
}
