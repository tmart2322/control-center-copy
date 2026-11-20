/**
 * "Push N to VDP" (Time ▸ VDP ▸ Changes; D-60, chained and ordered since D-63), shared by both DataSources and the
 * worker's `vdp.push`.
 *
 *   plan     the ticked items plus what they need first (a child of a company or VDP that does not exist yet brings
 *            its ancestors), in dependency order: company → VDP → header → people → opportunities → use cases →
 *            Generate → assets. Every item is staged as its own Outbox item, from the mirror like a single Apply (its
 *            suggested values when asked); one under a parent that does not exist yet carries a placeholder for the
 *            parent's new id ("(new company id)") and names it in `pending`
 *   run      in order, each item applied through the DataSource's own delivery (preview payload, confirm proof,
 *            dry run, read-back): the click on Push is the approval of each item (approval method `click`), so
 *            nothing here can send what a single Apply would not. A new company's, VDP's or use case's id is passed
 *            down: the waiting item is staged again with it (the same values) and the placeholder one is withdrawn
 *   failure  stops that branch: what needed it is skipped ("Not pushed: <parent> failed"); other branches go on
 *   dry run  records each payload, placeholders included; nothing is sent, nothing is re-staged
 *   again    a re-push never creates a second company or VDP: right before a create the item is looked up again,
 *            and one already applied (or that VDP now shows) passes its id down instead
 *
 * D-69 guards (live pushes; a dry run records only):
 *   sign-in   VD-28: VDP's sign-in is stale → nothing is pushed ("Sign in to VDP first")
 *   mirror    VD-22: the last VDP read is older than 30 minutes → nothing is pushed (the next read is due; push after it)
 *   values    VD-26: a staged item whose values were edited since it was staged (typed again, or the mirror's `before`
 *             moved) is staged again with the new values, the old one withdrawn
 *   limits    VD-27: VDP generates 20 use cases per 10 minutes, so a push paces its Generates to that window (it waits,
 *             never refuses); every call shares one 60/min window; a push of any size runs (its time limit scales)
 *   creates   VD-23 / VD-25: before each create (company, VDP, use case) VDP is read live (`liveMade`): one that is there
 *             (made by hand mid-push, or a "maybe made" one that did arrive) passes its id down and is not sent again;
 *             when VDP can't be read, it is not sent ("never blind")
 *
 * The db route plans the push and hands it to the worker at once (`vdp.push`: it stages each item right before it
 * pushes it, with a fixed id so a resumed push never stages one twice, and delivers inline through the Outbox gateway;
 * a dry-run push records only); the mock runs it right away. One push at a time: a new one (a single Apply too) is
 * refused while one is queued or running; a push whose job ended reads as stopped (settlePushRuns). A worker that
 * shuts down mid-push gives the job back and the push resumes: what landed counts as applied, never sent again. The
 * recent runs are kept (kv `cc.vdp.push`) so VDP ▸ Changes ▸ Push runs follows them through live events. The Assistant never calls this route (D-58 classification `deny`).
 */
import { createHash } from 'node:crypto';

import { VdpActionInput, VdpPushRun, type ActionDestination, type Draft, type PushVdpChangesRequest, type PushVdpChangesResult, type VdpCoveragePayload, type VdpPushNode } from '@/contract';
import { VDP_MAX_GENERATES_PER_PUSH } from '@/connectors/vdp/limiter';
import { AppError } from '@/server/errors';
import { VDP_CREATE_OPS, VDP_READ_EVERY_MS, vdpItemKeyOf } from '@/engines/vdp/status';
import { idSources } from '@/engines/vdp/steps';
import { pushRankOf } from '@/engines/vdp/tree';
import { sameUseCaseTitle } from '@/engines/vdp/gaps';
import { companyMatchesName, companyQuery } from '@/lib/vdp/company-name';
import type { VdpCompanyLookup, VdpSnapshot } from '@/lib/vdp/types';

import { findVdpItem, rebaseVdpAction, vdpActionForItem, type ApplyableCandidate, type FoundItem, type ResolvedParent, type UseCaseDuplicateCheck } from './coverage';

/** Where each DataSource keeps the latest pushes (a per-user key-value row: newest first, at most five). */
export const VDP_PUSH_KV = 'cc.vdp.push';
export const VDP_PUSH_JOB = 'vdp.push';
const VDP_PUSH_KEEP = 5;

/** The stored pushes, checked (newest first; a missing or odd value reads as none). */
export function pushRunsOf(raw: unknown): VdpPushRun[] {
  return (Array.isArray(raw) ? raw : []).map((x) => VdpPushRun.safeParse(x)).filter((r) => r.success).map((r) => r.data!);
}

/** The stored pushes with this one first (replacing its older state). */
export const nextPushRuns = (runs: readonly VdpPushRun[], run: VdpPushRun): VdpPushRun[] => [run, ...runs.filter((r) => r.id !== run.id)].slice(0, VDP_PUSH_KEEP);

/** The order a push applies in (D-63): parents before children, the header before the rest. */
export const pushRank = (f: Pick<FoundItem, 'apply' | 'step'>): number => pushRankOf({ op: f.apply.op, section: f.step?.section ?? null });

export interface PushState {
  coverage: VdpCoveragePayload;
  snapshots: readonly VdpSnapshot[];
  candidates?: readonly ApplyableCandidate[];
  /** Every VDP draft by id (the staged ones a push reuses, the applied ones whose new ids it passes down). */
  drafts: ReadonlyMap<string, Pick<Draft, 'id' | 'status' | 'destination' | 'externalId' | 'resultUrl'>>;
  /** D-67: a new use case either system (or a staged item) already has is refused (src/server/deals/use-cases.ts). */
  duplicateOf?: UseCaseDuplicateCheck;
}

export interface PlannedNode extends VdpPushNode {
  /** Staged now (null: refused at planning). */
  dest: ActionDestination | null;
  /** Reuse this staged item instead of staging a new one. */
  reuse: boolean;
  /** Not ticked: a ticked item needs it first. */
  required: boolean;
  /** VD-26: the staged item this one replaces (its values changed): withdrawn once the new one is staged. */
  replaces?: string | null;
}

/** D-69 (VD-22): a live push plans from a mirror at most this old (the read runs every 30 minutes). */
export const PUSH_MIRROR_MAX_AGE_MS = VDP_READ_EVERY_MS;

/** VD-26: the calls two staged versions of one item make, compared (field, value; `before` too: the mirror moved). */
const callOf = (d: Pick<ActionDestination, 'input'> | null | undefined) => {
  const p = VdpActionInput.safeParse(d?.input);
  if (!p.success) return null;
  const changes = p.data.changes.length ? p.data.changes : [{ field: p.data.field, before: p.data.before, value: p.data.value }];
  return JSON.stringify(changes.map((c) => [c.field, c.before ?? null, c.value]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
};

/** The values a staged item sends, as an Apply's typed values (lists joined). */
function valuesOf(d: Pick<ActionDestination, 'input'>): Record<string, string> {
  const p = VdpActionInput.safeParse(d.input);
  if (!p.success) return {};
  const changes = p.data.changes.length ? p.data.changes : [{ field: p.data.field, before: p.data.before, value: p.data.value }];
  const out: Record<string, string> = Object.fromEntries(changes.map((c) => [c.field, Array.isArray(c.value) ? c.value.join(', ') : String(c.value)]));
  if (p.data.track) out.track = p.data.track;
  return out;
}

/** Why a live push can't start now (VD-28 sign-in, VD-22 a stale mirror), else null. */
export function pushGate(cov: Pick<VdpCoveragePayload, 'signIn' | 'lastReadAt'>, nowMs: number): string | null {
  if (cov.signIn === 'stale') return 'Sign in to VDP first (Health ▸ VDP ▸ Re-auth): nothing was pushed';
  if (!cov.lastReadAt) return 'VDP has not been read yet: push after the first read';
  const age = nowMs - Date.parse(cov.lastReadAt);
  if (age > PUSH_MIRROR_MAX_AGE_MS) return `The last VDP read is ${Math.round(age / 60_000)} min old: push again after the next read (every 30 min), so nothing is planned from an old copy`;
  return null;
}

const slugOfLink = (url: string | null | undefined): string | null => (url ? (/\/vdp\/([^/?#]+)/.exec(url)?.[1] ?? null) : null);
const originOf = (url: string | null | undefined) => (url ? url.replace(/[?#].*$/, '') : null);

/** What applied parents (an earlier push, a single Apply, autopilot) made: their new ids, for the items under them. */
export function appliedParents(st: Pick<PushState, 'drafts'>): Map<string, ResolvedParent> {
  const out = new Map<string, ResolvedParent>();
  for (const d of st.drafts.values()) {
    if (!d.externalId || !APPLIED_ANY.has(d.status) || d.destination.kind !== 'action' || !/^vdp\.create_(company|vdp|use_case)$/.test(d.destination.action)) continue;
    const key = vdpItemKeyOf(d.destination.action, d.destination.input);
    if (key) out.set(key, { id: d.externalId, slug: slugOfLink(d.resultUrl), url: originOf(d.resultUrl) });
  }
  return out;
}
const APPLIED_ANY = new Set<Draft['status']>(['sent', 'verified']);

/**
 * The push plan: each ticked item and the ones it needs first, in order, each staged (`dest`) or refused (`state:
 * failed` with why). Pure over the coverage; the caller stages the drafts.
 */
export function planVdpPush(st: PushState, items: PushVdpChangesRequest['items'], o: { id: string; at: string; dryRun: boolean }): { run: VdpPushRun; nodes: PlannedNode[] } {
  const cov = st.coverage;
  const applied = appliedParents(st);
  // D-69: a live push needs VDP's sign-in and a fresh mirror (VD-28, VD-22); a dry run records either way
  const gate = o.dryRun ? null : pushGate(cov, Date.parse(o.at));
  const nodes: PlannedNode[] = [];
  const byKey = new Map<string, PlannedNode>();
  const want = new Map<string, { values: Record<string, string>; useSuggestion: boolean; ticked: boolean }>();
  for (const it of items) if (!want.has(it.itemKey)) want.set(it.itemKey, { values: it.values ?? {}, useSuggestion: !!it.useSuggestion, ticked: true });
  // the ancestors a ticked item needs (outermost first), unless they are applied already
  for (const [key] of [...want]) {
    const f = findVdpItem(cov, key);
    for (const r of f?.requires ?? []) if (!want.has(r) && !applied.has(r)) want.set(r, { values: {}, useSuggestion: true, ticked: false });
  }
  const order = [...want.keys()].map((key, i) => ({ key, i, f: findVdpItem(cov, key) })).sort((a, b) => (a.f ? pushRank(a.f) : 9) - (b.f ? pushRank(b.f) : 9) || a.i - b.i);
  for (const { key, f } of order) {
    const w = want.get(key)!;
    const base: PlannedNode = { key, title: f?.title ?? key, companyName: f?.companyName ?? '', op: f?.apply.op ?? '', requires: f?.requires ?? [], draftId: null, state: 'queued', detail: null, externalId: null, slug: null, at: null, dest: null, reuse: false, required: !w.ticked };
    const refuse = (detail: string) => nodes.push(byKey.set(key, { ...base, state: 'failed', detail }).get(key)!);
    if (!f) {
      refuse('Not open any more: the VDP view has the latest');
      continue;
    }
    if (gate) {
      refuse(gate);
      continue;
    }
    // VD-27: VDP generates at most 20 use cases per 10 minutes; the run paces to it (runVdpPush), never refuses
    if (f.state === 'waiting') {
      refuse('Applied already: the next VDP read confirms it');
      continue;
    }
    if (f.disabled) {
      refuse(f.disabled);
      continue;
    }
    const parentFailed = f.requires.map((r) => byKey.get(r)).find((p) => p && (p.state === 'failed' || p.state === 'skipped'));
    if (parentFailed) {
      nodes.push(byKey.set(key, { ...base, state: 'skipped', detail: `Not pushed: ${parentFailed.title} can't be pushed (${parentFailed.detail ?? 'see it'})` }).get(key)!);
      continue;
    }
    // a staged item is pushed as staged (its own values), unless it waits for parents this push will not create; VD-26:
    // when what it would send now differs (typed again, or VDP's value moved since it was staged) it is staged again
    const staged = f.state === 'staged' && f.draftId ? st.drafts.get(f.draftId) : undefined;
    const values = w.useSuggestion ? { ...(f.suggestion ?? {}), ...w.values } : w.values;
    let fresh: ActionDestination | null = null;
    let freshError: string | null = null;
    try {
      fresh = vdpActionForItem(cov, st.snapshots, { itemKey: key, values }, st.candidates ?? [], { resolved: applied, restage: true, ...(st.duplicateOf ? { duplicateOf: st.duplicateOf } : {}) });
    } catch (err) {
      freshError = ((err as Error).message || 'Could not stage it').slice(0, 300);
    }
    if (staged && (staged.status === 'ready' || staged.status === 'failed')) {
      const old = staged.destination.kind === 'action' ? staged.destination : null;
      // typed in this push: those values; else the staged values, rebuilt on the mirror now (did VDP's value move?)
      let next: ActionDestination | null = Object.keys(w.values).length ? fresh : null;
      if (!next && old) {
        try {
          next = vdpActionForItem(cov, st.snapshots, { itemKey: key, values: valuesOf(old) }, st.candidates ?? [], { resolved: applied, restage: true, ...(st.duplicateOf ? { duplicateOf: st.duplicateOf } : {}) });
        } catch {
          next = null;
        }
      }
      if (next && old && callOf(next) !== callOf(old) && !(old.input as { pending?: unknown } | null)?.pending) {
        nodes.push(byKey.set(key, { ...base, dest: next, replaces: staged.id }).get(key)!);
        continue;
      }
      nodes.push(byKey.set(key, { ...base, draftId: staged.id, dest: old, reuse: true }).get(key)!);
      continue;
    }
    if (!fresh) {
      refuse(freshError ?? 'Could not stage it');
      continue;
    }
    nodes.push(byKey.set(key, { ...base, dest: fresh }).get(key)!);
  }
  const run: VdpPushRun = { id: o.id, at: o.at, dryRun: o.dryRun, state: 'queued', nodes: nodes.map(strip), finishedAt: null };
  return { run, nodes };
}

const strip = (n: PlannedNode): VdpPushNode => ({ key: n.key, title: n.title, companyName: n.companyName, op: n.op, requires: n.requires, draftId: n.draftId, state: n.state, detail: n.detail, externalId: n.externalId, slug: n.slug, at: n.at });

/** How one delivery ended. */
export interface PushDelivery {
  outcome: 'applied' | 'dry_run' | 'failed';
  externalId: string | null;
  link: string | null;
  detail: string | null;
}

export interface VdpPushPort {
  now(): Date;
  /** The coverage, the mirror and the drafts, read now (before each create: a re-push never creates twice). */
  state(): Promise<PushState>;
  draft(id: string): Promise<Draft | null>;
  /** Stage one Outbox item for this call (as a single Apply would). */
  /** Stage one item as an Outbox item. `id`: a fixed id (the worker's: staging the same item again returns that one). */
  stage(dest: ActionDestination, o?: { id?: string }): Promise<Draft>;
  /** Withdraw a staged item (its placeholder one, once the real id is known; one a re-push found applied). */
  discard(draftId: string, reason: string): Promise<void>;
  /** Apply it, approved by the push click: a dry run records, live writes and reads back. */
  deliver(draft: Draft, o: { run: VdpPushRun }): Promise<PushDelivery>;
  /**
   * D-69 (VD-23, VD-25): read VDP live right before a create: what it holds for this item now (the company, the VDP or
   * the use case it would make), with its id; null = not there, go. Throws when VDP can't be read (not sent).
   * Absent (the mock without a simulated VDP): only the mirror and the drafts are checked.
   */
  liveMade?(node: Pick<VdpPushNode, 'key' | 'op'>, draft: Draft): Promise<ResolvedParent | null>;
  /** The run after each item (kept, and a live event for the Changes tab). */
  progress(run: VdpPushRun): Promise<void>;
  /** Wait (VD-27 pacing: VDP generates 20 use cases per 10 minutes). Absent: a real timer. */
  sleep?(ms: number): Promise<void>;
}

/** VD-27: VDP's own Generate limit, 20 per 10 minutes. A push paces to it instead of refusing the 21st. */
export const VDP_GENERATE_WINDOW_MS = 10 * 60_000;

/**
 * How long the next Generate must wait so that at most `max` run in any `windowMs` (0 = go now). `starts` are the
 * earlier Generates' start times in this push, oldest first.
 */
export function generateWaitMs(starts: readonly number[], nowMs: number, max = VDP_MAX_GENERATES_PER_PUSH, windowMs = VDP_GENERATE_WINDOW_MS): number {
  const recent = starts.filter((t) => nowMs - t < windowMs);
  if (recent.length < max) return 0;
  return recent[recent.length - max]! + windowMs - nowMs;
}

/** The worker's time limit for a push: room for VDP's 60 calls a minute on every item, and for paced Generates. */
export function pushTimeoutSeconds(nodes: ReadonlyArray<Pick<VdpPushNode, 'op'>>): number {
  const generates = nodes.filter((n) => n.op === 'generate_use_case').length;
  const windows = Math.floor(Math.max(0, generates - 1) / VDP_MAX_GENERATES_PER_PUSH);
  return 1800 + nodes.length * 10 + windows * (VDP_GENERATE_WINDOW_MS / 1000) + generates * 120;
}

const APPLIED = new Set<Draft['status']>(['sending', 'sent', 'verified']);

/**
 * What a create item already made in VDP: another Outbox item for it was applied (an earlier push, a single Apply,
 * autopilot), or VDP's read shows the company or VDP now. `id: null` = applied, its id not returned (yet).
 */
export function alreadyMade(st: PushState, key: string, selfId: string | null = null): ResolvedParent | null {
  for (const d of st.drafts.values()) {
    if (d.id === selfId || !APPLIED.has(d.status) || d.destination.kind !== 'action') continue;
    if (vdpItemKeyOf(d.destination.action, d.destination.input) !== key) continue;
    return { id: d.externalId ?? null, slug: slugOfLink(d.resultUrl), url: originOf(d.resultUrl) };
  }
  const f = findVdpItem(st.coverage, key);
  if (f) return null;
  const accountId = /^account:([^:]+):create_(vdp|company)$/.exec(key)?.[1];
  if (!accountId) return null;
  if (key.endsWith(':create_vdp')) {
    const v = st.coverage.vdps.filter((r) => r.accountId === accountId && r.scope === 'current').sort((a, b) => (b.fiscalYear ?? 0) * 10 + (b.fiscalQuarter ?? 0) - ((a.fiscalYear ?? 0) * 10 + (a.fiscalQuarter ?? 0)))[0];
    return v?.vdpId ? { id: v.vdpId, slug: v.vdpSlug, url: v.url } : null;
  }
  // the company: VDP now knows it, so the VDP to create names it
  const vdp = findVdpItem(st.coverage, `account:${accountId}:create_vdp`);
  const id = vdp?.apply.fields.find((x) => x.field === 'company_id')?.suggested;
  return typeof id === 'string' && id ? { id } : null;
}

/** The live reads a create's check makes (D-69, VD-23 / VD-25): the read client's, never a write tool. */
export interface VdpLiveReads {
  findCompany(q: string): Promise<VdpCompanyLookup>;
  /** My VDPs of one company (`search_vdps company_id`). */
  vdpsOfCompany(companyId: string): Promise<Array<{ id: string; slug: string; fiscalYear: number | null; fiscalQuarter: number | null }>>;
  getVdp(slug: string): Promise<VdpSnapshot | null>;
}

/**
 * What VDP holds now for a create: the company by VDP's name rule (aliases too), my VDP of that company for the same
 * period, the use case by its title (VD-34: a number tells two apart). Null = not there.
 */
export async function liveMadeVia(r: VdpLiveReads, node: Pick<VdpPushNode, 'op'>, draft: Pick<Draft, 'destination'>): Promise<ResolvedParent | null> {
  const p = VdpActionInput.safeParse(draft.destination.kind === 'action' ? draft.destination.input : null);
  if (!p.success) return null;
  const input = p.data;
  const val = (f: string) => input.changes.find((c) => c.field === f)?.value ?? (input.field === f ? input.value : null);
  switch (node.op) {
    case 'create_company': {
      const name = String(val('name') ?? '').trim();
      if (!name) return null;
      const aliases = Array.isArray(val('aliases')) ? (val('aliases') as string[]) : [];
      const look = await r.findCompany(companyQuery(name));
      const m = look.matches.find((x) => [name, ...aliases].some((n) => companyMatchesName(x, n)));
      return m ? { id: m.id } : null;
    }
    case 'create_vdp': {
      const company = val('company_id');
      if (typeof company !== 'string' || !company || input.pending?.companyId) return null;
      const fy = val('fiscal_year');
      const fq = val('fiscal_quarter');
      const twin = (await r.vdpsOfCompany(company)).find((v) => (fy === null || v.fiscalYear === Number(fy)) && (fq === null || v.fiscalQuarter === Number(fq)));
      return twin ? { id: twin.id, slug: twin.slug } : null;
    }
    case 'create_use_case': {
      const slug = input.vdpSlug;
      if (!slug || slug.startsWith('account:') || input.pending?.vdpId) return null;
      const title = String(val('title') ?? '');
      const u = (await r.getVdp(slug))?.useCases.find((x) => sameUseCaseTitle(x.title, title));
      return u ? { id: u.id } : null;
    }
    default:
      return null;
  }
}

/** Run a planned push in order (see the file comment). Returns the run as it ended. */
export async function runVdpPush(port: VdpPushPort, run0: VdpPushRun): Promise<VdpPushRun> {
  let run: VdpPushRun = { ...run0, state: 'running', nodes: run0.nodes.map((n) => ({ ...n })) };
  const byKey = new Map(run.nodes.map((n) => [n.key, n]));
  const resolved = new Map<string, ResolvedParent>();
  // VD-27: this push's Generate start times, so the 21st waits for VDP's 10-minute window instead of being refused
  const generateStarts: number[] = [];
  const sleep = port.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let st = await port.state();
  for (const [k, v] of appliedParents(st)) resolved.set(k, v);
  // 2026-11-16: the route hands the worker what to stage; each item is staged right before it is pushed
  const toStage = new Map((run0.stage ?? []).map((s) => [s.key, s] as const));
  let savedAt = 0;
  const save = async () => {
    run = { ...run, nodes: run.nodes.map((n) => byKey.get(n.key) ?? n) };
    savedAt = port.now().getTime();
    await port.progress(run);
  };
  await save();
  for (const node of run.nodes) {
    const n = byKey.get(node.key)!;
    if (n.state !== 'queued') continue;
    // each item's own Outbox item shows it staged, on its way, applied; the run is saved when one stops a branch, at
    // the start and the end, and at most every PUSH_PROGRESS_SAVE_MS as items land (Push runs shows it moving), so
    // History holds a few entries per push, not one per item
    const set = async (p: Partial<VdpPushNode>) => {
      byKey.set(n.key, { ...byKey.get(n.key)!, ...p, at: port.now().toISOString() });
      if (p.state === 'failed' || p.state === 'skipped') await save();
      else if ((p.state === 'applied' || p.state === 'dry_run') && port.now().getTime() - savedAt >= PUSH_PROGRESS_SAVE_MS) await save();
    };
    const parent = n.requires.map((r) => byKey.get(r)).find((p) => p && (p.state === 'failed' || p.state === 'skipped'));
    if (parent) {
      await set({ state: 'skipped', detail: `Not pushed: ${parent.title} ${parent.state === 'failed' ? 'failed' : 'was not pushed'}` });
      continue;
    }
    await set({ state: 'running' });
    const pending = toStage.get(n.key);
    if (!n.draftId && pending) {
      try {
        const staged = await port.stage(pending.dest, { id: stageIdFor(run.id, n.key) });
        if (pending.replaces) await port.discard(pending.replaces, 'Replaced: staged again with the values you pushed');
        await set({ draftId: staged.id });
      } catch (err) {
        await set({ state: 'failed', detail: ((err as Error).message || 'Could not stage it').slice(0, 300) });
        continue;
      }
    }
    try {
      const draftId = byKey.get(n.key)!.draftId;
      let draft = draftId ? await port.draft(draftId) : null;
      if (!draft) throw new Error('The staged item is gone: push it again');
      // a push resumed after the worker restarted: an item it applied before is applied, never sent again
      if (!run.dryRun && APPLIED.has(draft.status)) {
        if (draft.externalId) resolved.set(n.key, { id: draft.externalId, slug: slugOfLink(draft.resultUrl), url: originOf(draft.resultUrl) });
        await set({ state: 'applied', externalId: draft.externalId ?? null, slug: slugOfLink(draft.resultUrl), detail: 'Applied (before the worker restarted): not sent again' });
        continue;
      }
      // idempotent creates: right before one, look again; what was made already passes its id down
      if (n.op === 'create_company' || n.op === 'create_vdp') {
        st = await port.state();
        const made = alreadyMade(st, n.key, draft.id);
        if (made) {
          if (made.id) resolved.set(n.key, made);
          if (draft.status === 'ready' || draft.status === 'failed') await port.discard(draft.id, 'Withdrawn: VDP already has this');
          await set({ state: 'applied', externalId: made.id, slug: made.slug ?? null, detail: made.id ? 'Already in VDP: not created again' : 'Already applied: not created again (the next VDP read brings its id)' });
          continue;
        }
      }
      // a waiting item takes its parents' new ids now (the same call, the same values; the placeholder one is withdrawn)
      if (!run.dryRun && draft.destination.kind === 'action') {
        const src = idSources({ op: n.op, requires: n.requires });
        const missing = (['companyId', 'vdpId', 'useCaseId'] as const).filter((k) => src[k] && !resolved.get(src[k]!)?.id && (draft!.destination as { input?: { pending?: Record<string, unknown> | null } }).input?.pending?.[k]);
        if (missing.length) throw new Error(`Its parent's new ${missing.map((k) => k.replace(/Id$/, '')).join(' and ')} id is not known: push them together`);
        const rebased = rebaseVdpAction(draft.destination, resolved);
        if (rebased) {
          const next = await port.stage(rebased);
          await port.discard(draft.id, 'Replaced: staged again with the new id from VDP');
          draft = next;
          await set({ draftId: next.id });
        }
      }
      // D-69 (VD-23, VD-25): a live create looks in VDP itself first (made by hand mid-push, or a "maybe made" one that
      // did arrive): found → its id goes down, nothing sent; VDP unreadable → not sent (never blind)
      if (!run.dryRun && VDP_CREATE_OPS.has(n.op) && port.liveMade) {
        let live: ResolvedParent | null;
        try {
          live = await port.liveMade(n, draft);
        } catch (err) {
          await set({ state: 'failed', detail: `Could not look in VDP first (${((err as Error).message || 'unreadable').slice(0, 120)}): not sent, so nothing is made twice` });
          continue;
        }
        if (live) {
          if (live.id) resolved.set(n.key, live);
          if (draft.status === 'ready' || draft.status === 'failed') await port.discard(draft.id, 'Withdrawn: VDP already has this');
          await set({ state: 'applied', externalId: live.id, slug: live.slug ?? null, detail: 'Already in VDP (read just now): not created again' });
          continue;
        }
      }
      if (n.op === 'generate_use_case' && !run.dryRun) {
        const wait = generateWaitMs(generateStarts, port.now().getTime());
        if (wait > 0) {
          await set({ detail: `Waiting ${Math.ceil(wait / 60_000)} min: VDP generates ${VDP_MAX_GENERATES_PER_PUSH} use cases per 10 minutes` });
          await save(); // the Changes tab shows the wait
          await sleep(wait);
          await set({ detail: null });
        }
        generateStarts.push(port.now().getTime());
      }
      const r = await port.deliver(draft, { run });
      if (r.outcome === 'failed') {
        await set({ state: 'failed', detail: (r.detail ?? 'Not applied').slice(0, 300) });
        continue;
      }
      if (r.externalId) resolved.set(n.key, { id: r.externalId, slug: slugOfLink(r.link), url: originOf(r.link) });
      await set({ state: r.outcome, externalId: r.externalId, slug: slugOfLink(r.link), detail: r.detail });
    } catch (err) {
      await set({ state: 'failed', detail: ((err as Error).message || 'Could not push it').slice(0, 300) });
    }
  }
  run = { ...publicPushRun(run), state: 'done', finishedAt: port.now().toISOString() };
  await save();
  return run;
}

/** The fixed Outbox item id the worker stages one push's item under (a resumed push finds it instead of staging again). */
export function stageIdFor(pushId: string, key: string): string {
  const h = createHash('sha256').update(`vdp.push|${pushId}|${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** How often a running push saves its progress as items land (Push runs and the Changes header follow it). */
export const PUSH_PROGRESS_SAVE_MS = 20_000;

/** A job that will not run (again): its push, if still open, stopped with it. */
const JOB_ENDED = new Set(['succeeded', 'failed', 'cancelled', 'dead', 'timed_out', 'skipped']);
/** A push with no job row after this long was never queued (or its row is gone): it reads as stopped. */
const NO_JOB_GRACE_MS = 2 * 60_000;

/**
 * The pushes as they really stand (2026-11-16): one still "queued" or "running" whose worker job ended (a restart or a
 * deploy mid-push, its time limit; the job is never retried) is stopped, and what it had not done reads as not pushed,
 * so the page and the one-push-at-a-time guard never wait on it (before, the page gave up after 30 minutes).
 * `jobs`: the push id → its `vdp.push` job's status (absent: no job row).
 */
export function settlePushRuns(runs: readonly VdpPushRun[], jobs: ReadonlyMap<string, string>, nowMs: number): VdpPushRun[] {
  return runs.map((r) => {
    if (r.state === 'done' || r.state === 'stopped') return r;
    const job = jobs.get(r.id);
    const ended = job ? JOB_ENDED.has(job) : nowMs - Date.parse(r.at) > NO_JOB_GRACE_MS;
    if (!ended) return r;
    return {
      ...publicPushRun(r),
      state: 'stopped' as const,
      nodes: r.nodes.map((n) => (n.state === 'queued' || n.state === 'running' ? { ...n, state: 'skipped' as const, detail: 'Not pushed: the push stopped before it (the worker restarted or ran out of time). Push it again: what landed is not made twice.' } : n)),
    };
  });
}

/** The push still going (queued or running), if any: VDP takes one push at a time. */
export const activePushOf = (runs: readonly VdpPushRun[]): VdpPushRun | null => runs.find((r) => r.state === 'queued' || r.state === 'running') ?? null;

/** "23 of 133 done": an item counts once it ended. */
export function pushDoneCount(r: Pick<VdpPushRun, 'nodes'>): number {
  return r.nodes.filter((n) => n.state === 'applied' || n.state === 'dry_run' || n.state === 'failed' || n.state === 'skipped').length;
}

/** A push as the pages see it: never the worker's staging list. */
export const publicPushRun = (r: VdpPushRun): VdpPushRun => {
  const { stage: _stage, ...pub } = r;
  return pub;
};

/** The route's answer for a run (the items in order; `queued` while the worker has it). */
export function pushResult(run: VdpPushRun, nodes: readonly Pick<PlannedNode, 'key' | 'required'>[]): PushVdpChangesResult {
  const req = new Map(nodes.map((n) => [n.key, n.required]));
  return {
    dryRun: run.dryRun,
    pushId: run.id,
    results: run.nodes.map((n) => ({ itemKey: n.key, draftId: n.draftId, state: n.state === 'running' ? 'queued' : n.state, error: n.state === 'failed' || n.state === 'skipped' ? n.detail : null, required: req.get(n.key) ?? false })),
  };
}

/** The DataSource side of the route: plan, stage each item, then run now (dry run, mock) or hand it to the worker. */
export interface PushRoutePort extends VdpPushPort {
  dryRunNow(): Promise<boolean>;
  newId(): string;
  /** Live, with a worker: queue `vdp.push` for this run (the db). Absent: run it here (the mock). */
  enqueue?(run: VdpPushRun): Promise<void>;
  /** The push still going (settled against its worker job), if any: a new one is refused while it runs. */
  activePush?(): Promise<VdpPushRun | null>;
}

export async function startVdpPush(port: PushRoutePort, body: PushVdpChangesRequest): Promise<PushVdpChangesResult> {
  // one push at a time (2026-11-16): a push planned while another runs cannot know the ids that one is making (a new
  // company's, a new VDP's, a use case's), so its items would wait on parents or redo them. A single Apply is a push.
  const active = port.activePush ? await port.activePush() : null;
  if (active) throw new AppError('conflict', `A push to VDP is running (${pushDoneCount(active)} of ${active.nodes.length} done). Push these once it ends: VDP ▸ Changes ▸ Push runs follows it.`, { pushId: active.id }, false);
  const dryRun = await port.dryRunNow();
  const st = await port.state();
  const at = port.now().toISOString();
  const { run, nodes } = planVdpPush(st, body.items, { id: port.newId(), at, dryRun });
  // 2026-11-16: with a worker the click returns at once. Staging 133 items here held the confirm dialog for 4½
  // minutes; the worker stages each right before it pushes it (Push runs shows it all the while). Dry runs too: the
  // worker records a dry-run push, it never sends one (the DataSource's delivery reads the run's dryRun).
  if (port.enqueue) {
    const queued: VdpPushRun = {
      ...run,
      nodes: nodes.map(strip),
      stage: nodes.filter((n) => n.state === 'queued' && !n.reuse && n.dest).map((n) => ({ key: n.key, dest: n.dest!, replaces: n.replaces ?? null })),
    };
    await port.progress(queued);
    await port.enqueue(queued);
    return pushResult(queued, nodes);
  }
  // no worker (the mock): stage every item now (a single Apply's draft); a reused one keeps its own; VD-26: one
  // staged again replaces the old
  for (const n of nodes) {
    if (n.state !== 'queued' || n.reuse || !n.dest) continue;
    try {
      n.draftId = (await port.stage(n.dest)).id;
      if (n.replaces) await port.discard(n.replaces, 'Replaced: staged again with the values you pushed');
    } catch (err) {
      n.state = 'failed';
      n.detail = ((err as Error).message || 'Could not stage it').slice(0, 300);
    }
  }
  const staged: VdpPushRun = { ...run, nodes: nodes.map(strip) };
  return pushResult(await runVdpPush(port, staged), nodes);
}
