/**
 * REC-2 (ORG-5): record every Org62 row a windowed scan reads (`opps`, `events`, `dcs`), from the SOQL tool result
 * itself, the way REC-1 records Slack messages.
 *
 * The agent used to transcribe each row into `cc_record_source_items` (scan-org62 §4). That was slow (about 3.6 s per
 * Event, ORG-2), lossy (one continuation stored 156 of 207, MIN-7), and on the first ramp stage it failed outright: with
 * two full 50-row pages back, the agent recorded nothing, reported zero-width coverage and finished incomplete at the
 * window start, on every retry (ORG-5). The runner now maps each returned row to its record snapshot (§4: the same
 * externalId, excerpt and payload keys) before the model sees the result. The agent cites rows by externalId
 * (`Opportunity:<Id>@<SystemModstamp>`); its own `cc_record_source_items` for the same row returns the same id.
 *
 * It also keeps, per query, the last row it saw in the query's ORDER BY and whether the page was full, so the runner
 * can place an incomplete run's cursor on the rows really read (`resumePoint`).
 */
import { ccKeyOf } from '../engines/activity/org62-check';
import type { NormalizedSourceItem, ScannerStore } from '../scanner/types';
import { normalizeItem, type CcRunState } from './cc-tools';
import { bareToolName } from './slack-rec';
import { toolResponseText } from './org62-pages';
import { trace } from '../scanner/trace';

type Row = Record<string, unknown>;
type Raw = Parameters<typeof normalizeItem>[1];

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const sub = (r: Row, k: string): Row | null => (r[k] && typeof r[k] === 'object' ? (r[k] as Row) : null);
const kv = (pairs: Array<[string, unknown]>) =>
  pairs
    .map(([k, v]) => `${k}=${v === null || v === undefined ? '' : String(v)}`)
    .join('; ')
    .slice(0, 300);

/** The SOQL result's rows (`records`), or null when the text is not a result (an error, an overflow notice). */
export function soqlRecords(text: string): Row[] | null {
  try {
    const j = JSON.parse(text) as { records?: unknown };
    return Array.isArray(j.records) ? (j.records as Row[]) : null;
  } catch {
    return null;
  }
}

const sobjectOf = (r: Row): string | null => str(sub(r, 'attributes')?.type);

/** One row → its §4 record snapshot, or null for a row this recorder does not own (aggregates, other objects). */
export function org62RowToRaw(r: Row): Raw | null {
  const type = sobjectOf(r);
  if (type === 'OpportunityTeamMember') {
    const o = sub(r, 'Opportunity');
    const oppId = str(r.OpportunityId);
    const stamp = str(o?.SystemModstamp) ?? str(r.SystemModstamp);
    if (!oppId || !stamp || !o) return null;
    const acct = sub(o, 'Account');
    return {
      kind: 'record_snapshot',
      externalId: `Opportunity:${oppId}@${stamp}`,
      occurredAt: stamp,
      title: str(o.Name) ?? oppId,
      excerpt: kv([
        ['stage', o.StageName],
        ['close', o.CloseDate],
        ['amount', o.Amount],
        ['forecast', o.ForecastCategoryName],
        ['closed', o.IsClosed],
        ['won', o.IsWon],
        ['next', str(o.NextStep)?.slice(0, 120)],
        ['team_role', r.TeamMemberRole],
      ]),
      oppHints: [oppId],
      accountHints: [str(o.AccountId), str(acct?.Name)].filter((x): x is string => !!x),
      payload: {
        Id: oppId,
        AccountId: str(o.AccountId),
        AccountName: str(acct?.Name),
        StageName: str(o.StageName),
        CloseDate: str(o.CloseDate),
        Amount: o.Amount ?? null,
        ForecastCategoryName: str(o.ForecastCategoryName),
        Type: null,
        IsClosed: o.IsClosed ?? null,
        IsWon: o.IsWon ?? null,
        TeamMemberRole: str(r.TeamMemberRole),
        TeamMemberSystemModstamp: str(r.SystemModstamp),
        rec: 'auto',
      },
    };
  }
  if (type === 'Opportunity') {
    const id = str(r.Id);
    const stamp = str(r.SystemModstamp);
    if (!id || !stamp) return null;
    const acct = sub(r, 'Account');
    return {
      kind: 'record_snapshot',
      externalId: `Opportunity:${id}@${stamp}`,
      occurredAt: stamp,
      title: str(r.Name) ?? id,
      excerpt: kv([
        ['stage', r.StageName],
        ['close', r.CloseDate],
        ['amount', r.Amount],
        ['forecast', r.ForecastCategoryName],
        ['closed', r.IsClosed],
        ['won', r.IsWon],
        ['next', str(r.NextStep)?.slice(0, 120)],
      ]),
      oppHints: [id],
      accountHints: [str(r.AccountId), str(acct?.Name)].filter((x): x is string => !!x),
      payload: {
        Id: id,
        AccountId: str(r.AccountId),
        AccountName: str(acct?.Name),
        StageName: str(r.StageName),
        CloseDate: str(r.CloseDate),
        Amount: r.Amount ?? null,
        ForecastCategoryName: str(r.ForecastCategoryName),
        Type: str(r.Type),
        IsClosed: r.IsClosed ?? null,
        IsWon: r.IsWon ?? null,
        OwnerName: str(sub(r, 'Owner')?.Name),
        rec: 'auto',
      },
    };
  }
  if (type === 'Event') {
    const id = str(r.Id);
    const stamp = str(r.SystemModstamp);
    if (!id || !stamp) return null;
    const what = sub(r, 'What');
    const start = str(r.StartDateTime);
    const end = str(r.EndDateTime);
    const hrs = r.Duration__c ?? (start && end ? Math.round(((Date.parse(end) - Date.parse(start)) / 3_600_000) * 100) / 100 : null);
    const whatId = str(r.WhatId);
    return {
      kind: 'record_snapshot',
      externalId: `Event:${id}@${stamp}`,
      occurredAt: stamp,
      title: str(r.Subject) ?? 'Event',
      excerpt: kv([
        ['type', r.SE_Task_Type__c],
        ['meeting_type', r.Meeting_Type__c],
        ['rt', sub(r, 'RecordType')?.Name],
        ['hrs', hrs],
        ['what', what?.Name],
      ]),
      oppHints: whatId?.startsWith('006') ? [whatId] : undefined,
      accountHints: [str(r.AccountId)].filter((x): x is string => !!x),
      payload: {
        StartDateTime: start,
        EndDateTime: end,
        DurationInMinutes: r.DurationInMinutes ?? null,
        Duration__c: r.Duration__c ?? null,
        SE_Task_Type__c: str(r.SE_Task_Type__c),
        Meeting_Type__c: str(r.Meeting_Type__c),
        RecordTypeName: str(sub(r, 'RecordType')?.Name),
        WhatId: whatId,
        WhatName: str(what?.Name),
        WhatType: str(what?.Type),
        AccountId: str(r.AccountId),
        CreatedDate: str(r.CreatedDate),
        // D-65 (TL-23): only the CC# key of the Description (the app row its canvas row came from), never its text
        ccKey: ccKeyOf(str(r.Description)),
        rec: 'auto',
      },
    };
  }
  if (type === 'Deal_Contribution__c') {
    const id = str(r.Id);
    const stamp = str(r.SystemModstamp);
    if (!id || !stamp) return null;
    const o = sub(r, 'Opportunity__r');
    const oppId = str(r.Opportunity__c);
    return {
      kind: 'record_snapshot',
      externalId: `Deal_Contribution__c:${id}@${stamp}`,
      occurredAt: stamp,
      title: `DC on ${str(o?.Name) ?? oppId ?? 'an opp'}`,
      excerpt: kv([
        ['role', r.Opportunity_Role__c],
        ['split', r.Split_Percentage__c],
        ['opp_stage', o?.StageName],
        ['close', o?.CloseDate],
        ...(str(r.SE_Name__c) ? [['se', r.SE_Name__c] as [string, unknown]] : []),
      ]),
      oppHints: oppId ? [oppId] : undefined,
      accountHints: [str(o?.AccountId)].filter((x): x is string => !!x),
      payload: {
        Id: id,
        Opportunity__c: oppId,
        // DC-13: whose DC it is (the read-back reads it by Id whoever holds it now; a reassigned one is not mine)
        SE_Name__c: str(r.SE_Name__c),
        Opportunity_Role__c: str(r.Opportunity_Role__c),
        Split_Percentage__c: r.Split_Percentage__c ?? null,
        IsClosed: o?.IsClosed ?? null,
        IsWon: o?.IsWon ?? null,
        rec: 'auto',
      },
    };
  }
  return null;
}

/** Where one query got to: the last row in its ORDER BY (SystemModstamp, Id), and whether its page was full. */
interface QueryProgress {
  lastStamp: string;
  lastId: string;
  full: boolean;
}

export interface Org62RecStats {
  calls: number;
  parsed: number;
  recorded: number;
  dup: number;
  errors: number;
}

export class Org62AutoRecorder {
  readonly stats: Org62RecStats = { calls: 0, parsed: 0, recorded: 0, dup: 0, errors: 0 };
  /** Per query object (its FROM): where it got to. A later page of the same query moves it on. */
  private readonly progress = new Map<string, QueryProgress>();
  private readonly handled = new Set<string>();

  constructor(
    private readonly store: ScannerStore,
    private readonly state: CcRunState,
  ) {}

  /** Record the rows of one SOQL result. Idempotent per tool-use id. Never throws. */
  async onToolResult(toolName: string, toolInput: unknown, toolResponse: unknown, toolUseId?: string): Promise<number> {
    if (bareToolName(toolName) !== 'soqlQuery') return 0;
    if (toolUseId) {
      if (this.handled.has(toolUseId)) return 0;
      this.handled.add(toolUseId);
    }
    this.stats.calls += 1;
    try {
      const q = String((toolInput as { q?: unknown } | undefined)?.q ?? '');
      const rows = soqlRecords(toolResponseText(toolResponse));
      if (!rows) return 0;
      this.stats.parsed += rows.length;
      const obj = /\bFROM\s+(\w+)/i.exec(q)?.[1] ?? 'unknown';
      // D-55: the AE's Q3 (opps I own) pages on its own, next to Q2 (opps on my accounts): both read Opportunity.
      const from = obj === 'Opportunity' && /\bOwnerId\s*=\s*'/i.test(q) ? 'Opportunity:owned' : obj;
      const limit = Number(/\bLIMIT\s+(\d+)/i.exec(q)?.[1] ?? NaN);
      const items: NormalizedSourceItem[] = [];
      const seen = new Set<string>();
      let last: { stamp: string; id: string } | null = null;
      for (const r of rows) {
        const raw = org62RowToRaw(r);
        if (!raw) continue;
        // The query's own ORDER BY key: a team row pages by its Opportunity's SystemModstamp and OpportunityId.
        const id = sobjectOf(r) === 'OpportunityTeamMember' ? str(r.OpportunityId) : str(r.Id);
        if (id) last = { stamp: raw.occurredAt as string, id };
        const it = normalizeItem(this.state.connector, raw);
        if (seen.has(it.dedupeKey) || this.state.recorded.has(it.dedupeKey)) {
          this.stats.dup += 1;
          continue;
        }
        seen.add(it.dedupeKey);
        items.push(it);
      }
      // Forward only: a later page moves the query on; a re-read of an earlier page does not move it back.
      const prev = this.progress.get(from);
      const full = Number.isFinite(limit) && rows.length >= limit;
      if (last && (!prev || Date.parse(last.stamp) > Date.parse(prev.lastStamp) || (last.stamp === prev.lastStamp && last.id > prev.lastId))) {
        this.progress.set(from, { lastStamp: last.stamp, lastId: last.id, full });
      } else if (prev && !full && (!last || !(Date.parse(last.stamp) < Date.parse(prev.lastStamp)))) {
        // REC-2b: the next page came back short (or empty): the query has read through the window end.
        this.progress.set(from, { ...prev, full: false });
      }
      if (!items.length) {
        trace(this.state.runId, 'rec', { tool: 'soqlQuery', query: from, parsed: rows.length, recorded: 0, new: 0, dup: rows.length });
        return 0;
      }
      let n = 0;
      for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const res = await this.store.recordSourceItems(this.state.runId, chunk);
        res.forEach((r, j) => {
          this.state.recorded.set(r.dedupeKey, r.sourceItemId);
          this.state.items.set(r.dedupeKey, chunk[j]!);
          this.state.auto.add(r.dedupeKey);
          this.state.counts.recorded += 1;
          if (r.isNew) this.state.counts.new += 1;
          if (r.changed) this.state.counts.changed += 1;
        });
        n += res.length;
      }
      this.stats.recorded += n;
      trace(this.state.runId, 'rec', { tool: 'soqlQuery', query: from, parsed: rows.length, recorded: n, dup: rows.length - items.length });
      return n;
    } catch (err) {
      this.stats.errors += 1;
      trace(this.state.runId, 'rec', { tool: 'soqlQuery', error: (err as Error)?.name ?? 'error' });
      return 0;
    }
  }

  /** The skill's coverage refs (scan-org62 §2) of the queries this run read. */
  queriedRefs(): string[] {
    const REF: Record<string, string> = { OpportunityTeamMember: 'soql:OpportunityTeamMember', Opportunity: 'soql:Opportunity:accounts', 'Opportunity:owned': 'soql:Opportunity:owned', Event: 'soql:Event', Deal_Contribution__c: 'soql:Deal_Contribution__c' };
    return [...this.progress.keys()].map((k) => REF[k] ?? `soql:${k}`);
  }

  /**
   * Where an incomplete run really got to: the earliest last row among the queries whose page was full (the others
   * read through the window end). Null when nothing paged out or nothing was read.
   */
  resumePoint(): { stamp: string; id: string } | null {
    let best: QueryProgress | null = null;
    for (const p of this.progress.values()) if (p.full && (!best || Date.parse(p.lastStamp) < Date.parse(best.lastStamp))) best = p;
    return best ? { stamp: best.lastStamp, id: best.lastId } : null;
  }
}
