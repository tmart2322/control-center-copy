/**
 * "Find assets" planning, shared by the mock and db DataSources: which details keys a request runs over (one key, or
 * every VDP and engaged account without one), in what order, and where the total cap stops it. Each run is capped at
 * the research budget per run (Settings ▸ Budgets ▸ Assistant limits ▸ research); the plan counts what a run really
 * costs (`expectedRunUsd`), and the default total cap is what is left on the assistant's day line. A run checks the
 * budget again when it starts, so a plan that guessed low still never spends past the day line.
 */
import { accountOfVdpKey, type Account, type FindVdpAssetsRequest, type FindVdpAssetsResult, type VdpAssetCandidate, type VdpBackfillRun, type VdpCoveragePayload } from '@/contract';
import { vdpLabel } from '@/engines/vdp/gaps';
import type { VdpSnapshot } from '@/lib/vdp/types';
import { invalid, notFound } from '@/server/errors';

import { assetTargets, candidateView, effectiveSlug, slugByAccount, type CandidateRecord, type CoverageRows, type DetailTarget } from './detail';

/** Below this, a run would stop before it searched anything. */
export const MIN_RUN_USD = 0.05;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A run's expected cost before there is history (measured: about $0.14, at most $0.23 over 17 live runs, 2026-11-14). */
export const DEFAULT_RUN_USD = 0.2;

/**
 * What one run is expected to cost: the 75th percentile of the finished runs' real cost (3 or more), else
 * DEFAULT_RUN_USD, never above the per-run cap. The per-run cap stays each run's ceiling. Planning by the ceiling
 * reserved $0.50 for runs that cost about $0.14, so "Find assets for all" fit 8 of 46 targets into $4.44.
 */
export function expectedRunUsd(runs: ReadonlyMap<string, VdpBackfillRun>, perRunUsd: number): number {
  const costs = [...runs.values()].filter((r) => r.status === 'done' && (r.costUsd ?? 0) > 0).map((r) => r.costUsd!).sort((a, b) => a - b);
  const p75 = costs.length >= 3 ? costs[Math.min(costs.length - 1, Math.ceil(costs.length * 0.75) - 1)]! : DEFAULT_RUN_USD;
  return Math.max(0.01, Math.min(perRunUsd, Math.ceil(p75 * 100) / 100));
}

/** When a key was last searched to the end (a done run); '' = never, or its last run was skipped or failed. */
const searchedAt = (r: VdpBackfillRun | undefined): string => (r && r.status === 'done' ? (r.finishedAt ?? r.startedAt) : '');

/** The research target of one details key (a VDP keeps its own slug, even an older one of its account). */
export function targetForKey(key: string, cov: CoverageRows, snaps: readonly VdpSnapshot[], accounts: ReadonlyArray<Pick<Account, 'id' | 'name'>>): DetailTarget | null {
  const accountId = accountOfVdpKey(key);
  const all = assetTargets(cov, snaps, accounts);
  if (accountId) {
    const t = all.find((x) => x.detailKey === key);
    if (t) return t;
    const acc = accounts.find((a) => a.id === accountId);
    const gap = cov.unlinked.find((g) => g.accountId === accountId);
    if (!acc && !gap) return null;
    const name = acc?.name ?? gap!.title.replace(/ (has no VDP|is not linked to a VDP)$/, '');
    return { key: accountId, detailKey: key, accountId, vdpSlug: null, companyName: name, inVdp: [], names: [name] };
  }
  const row = cov.vdps.find((v) => v.vdpSlug === key);
  if (!row) return null;
  const snap = snaps.find((s) => s.slug === key);
  const acc = row.accountId ? accounts.find((a) => a.id === row.accountId) : undefined;
  return {
    key: row.accountId ?? `vdp:${row.vdpSlug}`,
    detailKey: key,
    accountId: row.accountId,
    vdpSlug: row.vdpSlug,
    companyName: row.companyName,
    inVdp: (snap?.assets ?? []).map((a) => ({ url: a.url, title: a.title })),
    names: [...new Set([row.companyName, acc?.name].filter((x): x is string => !!x))],
  };
}

export function planFindAssets(i: {
  body: FindVdpAssetsRequest;
  coverage: CoverageRows;
  snapshots: readonly VdpSnapshot[];
  accounts: ReadonlyArray<Pick<Account, 'id' | 'name'>>;
  runs: ReadonlyMap<string, VdpBackfillRun>;
  perRunUsd: number;
  dayLeftUsd: number;
}): Omit<FindVdpAssetsResult, 'started'> {
  if (!i.body.key && !i.body.all) throw invalid('Say which VDP (key) or all');
  const perRunUsd = r2(i.perRunUsd);
  const runUsd = expectedRunUsd(i.runs, perRunUsd);
  const dayLeft = r2(i.dayLeftUsd);
  const capUsd = r2(Math.min(i.body.capUsd ?? dayLeft, dayLeft));
  let targets: DetailTarget[];
  if (i.body.key) {
    const t = targetForKey(i.body.key, i.coverage, i.snapshots, i.accounts);
    if (!t) throw notFound('VDP', i.body.key);
    targets = [t];
  } else {
    // Never searched (or the last run was skipped or failed) first, then the longest ago, so a cap never starves the
    // same keys again (it re-ran the first 8 of 46 on every click); within that, VDPs with no assets, then accounts
    // without a VDP, then the rest.
    const rows = new Map(i.coverage.vdps.map((v) => [v.vdpSlug, v]));
    const rank = (t: DetailTarget) => (t.vdpSlug ? ((rows.get(t.vdpSlug)?.assetCount ?? 0) === 0 ? 0 : 2) : 1);
    const at = (t: DetailTarget) => searchedAt(i.runs.get(t.detailKey));
    targets = assetTargets(i.coverage, i.snapshots, i.accounts).sort((a, b) => at(a).localeCompare(at(b)) || rank(a) - rank(b) || a.companyName.localeCompare(b.companyName));
  }
  const queued: FindVdpAssetsResult['queued'] = [];
  const skipped: FindVdpAssetsResult['skipped'] = [];
  let spent = 0;
  let open = 0;
  for (const t of targets) {
    const cur = i.runs.get(t.detailKey);
    if (cur && (cur.status === 'queued' || cur.status === 'running')) {
      skipped.push({ key: t.detailKey, companyName: t.companyName, why: 'already looking' });
      continue;
    }
    open += 1;
    if (capUsd - spent < MIN_RUN_USD || (i.body.all && spent + runUsd > capUsd + 1e-9)) {
      skipped.push({ key: t.detailKey, companyName: t.companyName, why: dayLeft < MIN_RUN_USD ? "the assistant's daily limit is used up" : `over the $${capUsd.toFixed(2)} cap` });
      continue;
    }
    queued.push({ key: t.detailKey, companyName: t.companyName });
    spent += runUsd;
  }
  const allUsd = r2(open * runUsd);
  // what today's line lacks to run every open target (only when the cap is the day line, not a lower one the caller set)
  const shortUsd = i.body.capUsd == null ? r2(Math.max(0, allUsd - dayLeft)) : 0;
  const over = skipped.filter((s) => s.why.startsWith('over')).length;
  const note = !queued.length && skipped.length ? `Nothing started: ${skipped[0]!.why}${dayLeft < MIN_RUN_USD ? ' (Settings ▸ Budgets ▸ Assistant limits, or allow more today)' : ''}` : over ? `${over} left out by the $${capUsd.toFixed(2)} cap${shortUsd > 0 ? `: allow $${shortUsd.toFixed(2)} more today to run them all` : ''}` : null;
  return { queued, skipped, perRunUsd, runUsd, estimateUsd: r2(queued.length * runUsd), ceilingUsd: r2(queued.length * perRunUsd), allUsd, shortUsd, open, capUsd, note };
}

/** One candidate as the routes return it (its VDP, the Assets-tab handoff). */
export function vdpDetailCandidate(st: { coverage: Pick<VdpCoveragePayload, 'vdps' | 'vdpBaseUrl'>; snapshots: readonly VdpSnapshot[] }, c: CandidateRecord): VdpAssetCandidate {
  const slug = effectiveSlug(c, slugByAccount(st.coverage.vdps));
  const row = slug ? st.coverage.vdps.find((v) => v.vdpSlug === slug) : undefined;
  const snap = slug ? st.snapshots.find((s) => s.slug === slug) : undefined;
  return candidateView(c, { slug: row ? slug : null, vdpUrl: row?.url ?? null, vdpLabel: snap ? vdpLabel(snap) : null, vdpBaseUrl: st.coverage.vdpBaseUrl });
}
