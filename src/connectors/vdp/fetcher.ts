/**
 * `scan.vdp`: the read-only VDP mirror as a deterministic fetcher (scope `mine`). VDP is current state, not a feed
 * (like Org62's `book`), so:
 *  - a window that ends before "now" (backfill, first-scan history) makes no VDP call: it records its coverage;
 *  - the live window reads my VDPs (`search_vdps`, paged), each VDP (`get_vdp`: header, owners, use-case index,
 *    assets, stakeholders) and the full use cases (`get_use_case`) of VDPs whose last activity changed since the
 *    stored mirror (unchanged VDPs reuse the stored detail), hands the batch to the mirror sink (vdp_records), and
 *    records one `record_snapshot` source item per VDP for provenance. The result is record-only: no skill agent.
 *
 * Mine = I am the creator, an AE, a TA or a collaborator (by my emails). VDP already scopes a per-user PAT to related
 * VDPs; the email check also holds when the PAT sees the whole corpus (admin). Reads only (`VdpClient`).
 *
 * The same live read records what the server can do (D-59 feature detection): its tool list (`tools/list`), the
 * asset and Deliverable types when it has `list_asset_types`, and `list_companies` lookups (D-69: one per name up the Org62 chain
 * of each engaged account with no VDP, the cleaned name searched). At most `maxCompanyLookups` calls per read (the
 * lookups and the `get_company` VDP counts of the companies that match by VDP's rule); a match is reused for 12 h and
 * a miss for 6 h (VD-02), and the rest are asked oldest first, so every name gets its turn instead of the same ten
 * every read. A name not looked up yet keeps its company node disabled ("Not looked up yet"). A failure there never
 * fails the read: the server info keeps what was stored.
 */
import type { ConnectorHealthProbe, Cursor, DeterministicFetcher, FetchResult, NormalizedSourceItem, TimeWindow } from '@/scanner/types';

import { redactExcerpt } from '../redact';
import { h16, systemClock, throwIfAborted, type Clock } from '../util';
import type { VdpClient } from './client';
import { normalizeCompanyName } from '@/lib/vdp/company-name';

import { isMine, withUseCaseDetail } from './parse';
import { oppIdsOf } from './types';
import type { VdpCompanyLookup, VdpMirrorSink, VdpServerInfo, VdpSnapshot, VdpUseCase } from './types';

export interface VdpFetcherOptions {
  client: VdpClient;
  sink: VdpMirrorSink;
  /** My emails in VDP (users row email + aliases). Empty: trust VDP's own scoping. */
  myEmails: string[];
  clock?: Clock;
  /** A window ending more than this before now is history (no call). Default 15 min. */
  liveSlackMs?: number;
  /** Cap on `get_use_case` reads per run (the rest stay index-only until the next poll). Default 150. */
  maxDetailReads?: number;
  /** Cap on `list_companies` lookups per run. Default 10. */
  maxCompanyLookups?: number;
}

/** A company lookup that found companies is reused this long before the read asks again. */
export const COMPANY_LOOKUP_TTL_MS = 12 * 60 * 60_000;
/** D-69 (VD-02): a lookup that found nothing is reused this long (a company created by hand shows up within it). */
export const COMPANY_MISS_TTL_MS = 6 * 60 * 60_000;

export const VDP_SCOPE = 'mine';

/** Comparable content of a snapshot (no read-time fields), for the source item's content hash. */
export function snapshotHash(s: VdpSnapshot): string {
  return h16(JSON.stringify({ ...s, useCases: s.useCases.map((u) => ({ ...u, detailLoaded: undefined })) }));
}

export function snapshotItem(s: VdpSnapshot, readAt: string): NormalizedSourceItem {
  const fy = s.fiscalYear !== null ? ` FY${String(s.fiscalYear).padStart(2, '0')}${s.fiscalQuarter ? ` Q${s.fiscalQuarter}` : ''}` : '';
  const ai = s.useCases.filter((u) => u.hasAi).length;
  const facts = [`use cases ${s.useCases.length} (${ai} with AI)`, `assets ${s.assets.length}`, `AE ${s.aes.length ? 'yes' : 'no'}`, `TA ${s.tas.length ? 'yes' : 'no'}`, `opp ${oppIdsOf(s).length ? 'linked' : 'not linked'}${oppIdsOf(s).length > 1 ? ` (${oppIdsOf(s).length})` : ''}`];
  const ex = redactExcerpt(`VDP ${s.company.name}${fy}: ${facts.join('; ')}`);
  return {
    connector: 'vdp',
    kind: 'record_snapshot',
    externalId: `vdp:${s.id}@${s.lastActivityAt ?? s.updatedAt ?? readAt}`,
    dedupeKey: `vdp:${s.id}`,
    contentHash: snapshotHash(s),
    occurredAt: s.lastActivityAt ?? s.updatedAt ?? readAt,
    ...(s.url ? { permalink: s.url } : {}),
    title: `VDP · ${s.company.name}${fy}`,
    excerpt: ex.text,
    redacted: ex.redacted,
    threadRef: `vdp:${s.slug}`,
    accountHints: [s.salesforceAccountId, s.company.name].filter((x): x is string => !!x),
    oppHints: oppIdsOf(s),
    payload: {
      vdpId: s.id,
      slug: s.slug,
      fiscalYear: s.fiscalYear,
      fiscalQuarter: s.fiscalQuarter,
      salesforceAccountId: s.salesforceAccountId,
      salesforceOpportunityId: s.salesforceOpportunityId,
      salesforceOpportunityIds: oppIdsOf(s),
      useCaseCount: s.useCases.length,
      useCaseWithAiCount: ai,
      assetCount: s.assets.length,
      hasAe: s.aes.length > 0,
      hasTa: s.tas.length > 0,
      archived: !!s.archivedAt,
    },
  };
}

export class VdpFetcher implements DeterministicFetcher {
  readonly connector = 'vdp' as const;
  private readonly clock: Clock;

  constructor(private readonly o: VdpFetcherOptions) {
    this.clock = o.clock ?? systemClock;
  }

  async scopes(): Promise<string[]> {
    return [VDP_SCOPE];
  }

  async health(): Promise<ConnectorHealthProbe> {
    return this.o.client.health();
  }

  /** E3: the gateway cookie's issue time (a restart lifts a stored auth pause when it is newer than the refusal). */
  credentialsIssuedAt(): number | null {
    return this.o.client.cookieIssuedAt?.() ?? null;
  }

  async fetch(scope: string, cursor: Cursor | null, window: TimeWindow, opts: { signal: AbortSignal }): Promise<FetchResult> {
    const now = this.clock();
    const windowCov = { kind: 'query_window' as const, ref: `vdp:${scope}`, from: window.from, to: window.to };
    if (Date.parse(window.to) < now.getTime() - (this.o.liveSlackMs ?? 15 * 60_000)) {
      // History: VDP has no change feed, and the live window reads the current state.
      return { items: [], coverage: [{ ...windowCov, meta: { history: true } }], nextCursor: { value: cursor?.value ?? 'vdp:history', at: window.to }, complete: true, recordOnly: true };
    }
    const readAt = now.toISOString();
    const list = await this.o.client.listMine({ signal: opts.signal });
    const known = await this.o.sink.known();
    const snaps: VdpSnapshot[] = [];
    let detailReads = 0;
    let detailComplete = true;
    for (const row of list.rows) {
      throwIfAborted(opts.signal);
      const snap = await this.o.client.getVdp(row.slug, { companyName: row.companyName }, opts);
      if (!snap) continue;
      if (this.o.myEmails.length && !isMine({ ...snap, aes: snap.aes.length ? snap.aes : row.aes, tas: snap.tas.length ? snap.tas : row.tas }, this.o.myEmails)) continue;
      const prev = known.get(snap.id);
      const details = new Map<string, VdpUseCase>();
      const reuse = prev?.snapshot && prev.lastActivityAt && prev.lastActivityAt === snap.lastActivityAt;
      for (const u of snap.useCases) {
        const stored = reuse ? prev!.snapshot!.useCases.find((x) => x.id === u.id && x.detailLoaded) : undefined;
        if (stored) {
          details.set(u.id, stored);
          continue;
        }
        if (detailReads >= (this.o.maxDetailReads ?? 150)) {
          detailComplete = false;
          continue;
        }
        detailReads += 1;
        const full = await this.o.client.getUseCase(u.id, opts);
        if (full) details.set(u.id, full);
      }
      snaps.push(withUseCaseDetail(snap, details));
    }
    // A capped detail read leaves the VDP's stamp unmatched next time only if we drop it: store a partial detail
    // with lastActivityAt cleared so the next poll re-reads the missing use cases.
    const stored = detailComplete ? snaps : snaps.map((s) => (s.useCases.every((u) => u.detailLoaded) ? s : { ...s, lastActivityAt: null }));
    const server = await this.serverInfo(readAt, opts.signal);
    await this.o.sink.save({ snapshots: stored, complete: list.complete, readAt, ...(server ? { server } : {}) });
    return {
      items: snaps.map((s) => snapshotItem(s, readAt)),
      coverage: [windowCov, ...snaps.map((s) => ({ kind: 'record' as const, ref: `vdp:${s.id}`, meta: { useCases: s.useCases.length, assets: s.assets.length } }))],
      nextCursor: { value: `vdp:${readAt}`, at: window.to },
      complete: true,
      recordOnly: true,
    };
  }

  /**
   * Feature detection (D-59): the tool list, the asset and Deliverable lookups when listed, and company lookups for my engaged
   * accounts with no VDP. Best effort: a failed step keeps what was stored; null = nothing new to store.
   */
  private async serverInfo(readAt: string, signal: AbortSignal): Promise<VdpServerInfo | null> {
    const prev = (await this.o.sink.server?.().catch(() => null)) ?? null;
    let tools = prev?.tools ?? null;
    try {
      tools = await this.o.client.listTools({ signal });
    } catch (err) {
      if (signal.aborted) throw err;
    }
    const listed = new Set((tools ?? []).map((t) => t.name));
    let deliverableTypes = prev?.deliverableTypes ?? null;
    let assetTypes = prev?.assetTypes ?? null;
    if (listed.has('list_asset_types')) {
      try {
        // one read: the asset types (an asset's Type picks from them) and the Deliverable types
        ({ assetTypes, deliverableTypes } = await this.o.client.assetLookups({ signal }));
      } catch (err) {
        if (signal.aborted) throw err;
      }
    } else if (tools) {
      deliverableTypes = null;
      assetTypes = null;
    }
    const names = (await this.o.sink.companyQueries?.().catch(() => [] as string[])) ?? [];
    const now = Date.parse(readAt);
    // VD-02: fresh lookups are kept; the stale and the never-asked ones are asked oldest first, within the per-read cap
    const stored = new Map((prev?.companies ?? []).filter((c) => names.includes(c.query)).map((c) => [c.query, c] as const));
    const fresh = (c: VdpCompanyLookup) => now - Date.parse(c.at) < (c.matches.length ? COMPANY_LOOKUP_TTL_MS : COMPANY_MISS_TTL_MS);
    const due = names.filter((n) => !stored.has(n) || !fresh(stored.get(n)!)).sort((x, y) => (stored.get(x)?.at ?? '').localeCompare(stored.get(y)?.at ?? '') || x.localeCompare(y));
    const cap = this.o.maxCompanyLookups ?? 10;
    const canLook = listed.has('list_companies') || !tools;
    const companies = new Map<string, VdpCompanyLookup>();
    for (const n of names) if (stored.has(n)) companies.set(n, stored.get(n)!);
    let calls = 0;
    for (const name of due) {
      if (!canLook || calls >= cap) break;
      calls += 1;
      try {
        const look = await this.o.client.findCompany(name, { signal });
        // VD-07: how many VDPs VDP holds for each company that matches by its own rule (also the ones I am not on)
        const key = normalizeCompanyName(name);
        const matches = [];
        for (const m of look.matches) {
          const same = !!key && [m.name, ...(m.aliases ?? [])].some((x) => normalizeCompanyName(x).startsWith(key));
          if (same && m.slug && (listed.has('get_company') || !tools) && calls < cap) {
            calls += 1;
            try {
              const c = await this.o.client.companyVdps(m.slug, { signal });
              matches.push(c ? { ...m, vdpCount: c.vdpCount, vdpSlugs: c.vdpSlugs } : m);
              continue;
            } catch (err) {
              if (signal.aborted) throw err;
            }
          }
          matches.push(m);
        }
        companies.set(name, { ...look, matches });
      } catch (err) {
        if (signal.aborted) throw err;
      }
    }
    // D-60: the industry taxonomy, for a company the app may create (only when a lookup found no match)
    let industries = prev?.industries ?? null;
    if (listed.has('list_industries') && listed.has('create_company') && [...companies.values()].some((c) => !c.matches.length)) {
      try {
        industries = await this.o.client.industries({ signal });
      } catch (err) {
        if (signal.aborted) throw err;
      }
    } else if (tools && !listed.has('list_industries')) industries = null;
    // D-63: the sales segments, for a company the app may create (only once VDP lists the read and the argument)
    let salesSegments = prev?.salesSegments ?? null;
    const createsCompany = tools?.find((t) => t.name === 'create_company')?.args.includes('sales_segment_id') ?? false;
    // D-69: vdp-app #11 shipped it: read while the tool list is unknown too (a stored list still governs)
    if ((tools ? listed.has('list_sales_segments') && createsCompany : true) && [...companies.values()].some((c) => !c.matches.length)) {
      try {
        salesSegments = await this.o.client.salesSegments({ signal });
      } catch (err) {
        if (signal.aborted) throw err;
      }
    } else if (tools && !listed.has('list_sales_segments')) salesSegments = null;
    return { tools, deliverableTypes, assetTypes, companies: [...companies.values()], industries, salesSegments, readAt };
  }
}
