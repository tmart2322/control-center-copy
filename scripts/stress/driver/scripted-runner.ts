/**
 * A free, deterministic stand-in for the Haiku agent, used by the mechanics scenarios (restarts, kills,
 * faults, clock jumps, budget). It follows the skill's PROCEDURE exactly (S1/S2/S3 or C1 with the documented
 * paging, coverage refs and finish cursor) by calling the same replayed tools, and writes through the same
 * validated `cc` tool handlers the agent uses. It never links or proposes: new items are flagged `deferred:`
 * like the production DeferredSkillRunner, so reconcile accounting stays realistic.
 * Optional hooks let a scenario stall or crash mid-traversal.
 */
import { createCcHandlers, createRunState, callCcTool } from '../../../src/llm/cc-tools';
import type { ScanSkillRunInput } from '../../../src/llm/skill-runner';
import type { ScanSkillRunResult } from '../../../src/scanner/runtime/contract-ext';
import type { ScannerStore, SkillRunner } from '../../../src/scanner/types';
import { parseSearchResults, unwrap, type SlackReplay } from '../replay/slack';
import { runSoql, type SoqlTable } from '../replay/soql';
import type { FaultInjector } from '../replay/faults';
import { FAULT_TEXT } from '../replay/faults';

export interface ScriptedHooks {
  /** Called before each source call; throw or await to stall/crash mid-traversal. */
  beforeCall?: (info: { runId: string; scope: string; n: number }) => Promise<void>;
  faults?: FaultInjector;
  /** Channel query form: the fixed `in:#name` (default) or the skill v1.0.0 `in:<#ID>`. */
  channelQuery?: 'name' | 'id';
  channelNames?: Record<string, string>;
}

const unixOf = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export class ScriptedSkillRunner implements SkillRunner {
  readonly runs: Array<{ runId: string; scope: string; mode?: string; calls: number; ok: boolean; error?: string }> = [];
  constructor(
    private readonly deps: { slack?: SlackReplay; org62?: Record<string, SoqlTable>; now: () => number; hooks?: ScriptedHooks },
  ) {}

  async run(input: ScanSkillRunInput, store: ScannerStore): Promise<ScanSkillRunResult> {
    const connector = input.context.scope.connector;
    const scope = input.context.scope.scope;
    const window = input.window ?? { from: new Date(this.deps.now() - 3600_000).toISOString(), to: new Date(this.deps.now()).toISOString() };
    const state = createRunState({ runId: input.runId, connector, window, context: input.context, prefetched: input.prefetched });
    const h = createCcHandlers(store, state);
    const base: ScanSkillRunResult = { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 };
    const rec = { runId: input.runId, scope: `${connector}:${scope}`, mode: input.mode, calls: 0, ok: false as boolean, error: undefined as string | undefined };
    this.runs.push(rec);
    const cc = async (name: string, args: unknown) => {
      const r = await callCcTool(h, state, name, args);
      if (r.isError) throw new Error(`${name}: ${r.text}`);
      return JSON.parse(r.text) as Record<string, unknown>;
    };
    try {
      if (input.mode === 'relink' || input.mode === 'relink_escalated') {
        // Like DeferredSkillRunner with the LLM off: not a linking failure, attempts unchanged.
        return { ...base, error: { message: 'scripted runner does not relink', errorClass: 'config' } };
      }
      if (input.prefetched) {
        // Deterministic source: record, echo coverage, flag new/changed as deferred, finish with the header cursor.
        if (input.prefetched.length) {
          const res = await store.recordSourceItems(input.runId, input.prefetched);
          for (const r of res) {
            state.counts.recorded += 1;
            if (r.isNew) state.counts.new += 1;
            if (r.changed) state.counts.changed += 1;
            if (r.isNew || r.changed) {
              await store.flagUnlinked(input.runId, { sourceItemId: r.sourceItemId, reason: 'deferred: scripted runner (stress mechanics)' });
              state.counts.unlinked += 1;
            }
          }
        }
        if (input.preReportedCoverage?.length) {
          await store.reportCoverage(input.runId, input.preReportedCoverage);
          state.coverage.push(...input.preReportedCoverage);
        }
        const v = input.vars ?? {};
        state.finished = { cursor: { value: String(v['header.cursor.value'] ?? ''), at: String(v['header.cursor.at'] ?? window.to) }, complete: String(v['header.complete'] ?? 'true') === 'true' };
      } else if (connector === 'slack') {
        await this.slack(input, scope, window, cc, rec);
      } else if (connector === 'org62') {
        await this.org62(input, scope, window, cc, rec);
      } else {
        throw new Error(`scripted runner: no procedure for ${connector}`);
      }
      rec.ok = true;
      return {
        ...base,
        ok: true,
        counts: { ...state.counts },
        proposedCursor: state.finished?.cursor,
        complete: state.finished?.complete,
        summary: 'scripted',
      };
    } catch (e) {
      rec.error = (e as Error).message.slice(0, 200);
      const msg = (e as Error).message;
      const cls = /invalid_auth|INVALID_SESSION|invalid_grant/.test(msg) ? 'auth' : /ratelimited|REQUEST_LIMIT|429/.test(msg) ? 'rate_limited' : /ETIMEDOUT|503|timed out/.test(msg) ? 'transient' : 'unknown';
      return { ...base, counts: { ...state.counts }, error: { message: msg.slice(0, 300), errorClass: cls } };
    }
  }

  private async source(input: ScanSkillRunInput, tool: string, rec: { calls: number }, fn: () => string): Promise<string> {
    rec.calls += 1;
    await this.deps.hooks?.beforeCall?.({ runId: input.runId, scope: input.context.scope.scope, n: rec.calls });
    if (input.signal.aborted) throw new Error('aborted by caller');
    const f = this.deps.hooks?.faults?.decide(tool);
    if (f && (f.kind === 'rate_limit' || f.kind === 'server_error' || f.kind === 'auth' || f.kind === 'timeout')) {
      throw new Error(FAULT_TEXT[input.context.scope.connector === 'org62' ? 'org62' : 'slack'][f.kind]);
    }
    return fn();
  }

  private async slack(input: ScanSkillRunInput, scope: string, window: { from: string; to: string }, cc: (n: string, a: unknown) => Promise<Record<string, unknown>>, rec: { calls: number }) {
    const sl = this.deps.slack;
    if (!sl) throw new Error('no slack replay');
    const me = input.context.me.slackId ?? sl.ix.me;
    const after = String(unixOf(window.from) - 120);
    const before = String(unixOf(window.to));
    const base = { sort: 'timestamp', sort_dir: 'asc', limit: 20, include_context: false, response_format: 'detailed', after, before };
    let queries: Array<{ ref: string; kind: string; args: Record<string, unknown>; q: string }>;
    if (scope === 'inbox') {
      queries = [
        { ref: 'search:dm', kind: 'query_window', q: 'dm', args: { ...base, query: `-from:<@${me}>`, channel_types: 'im,mpim' } },
        { ref: 'search:mentions', kind: 'query_window', q: 'mentions', args: { ...base, query: `<@${me}>`, channel_types: 'public_channel,private_channel' } },
        { ref: 'search:mine', kind: 'query_window', q: 'mine', args: { ...base, query: `from:<@${me}>`, channel_types: 'public_channel,private_channel,mpim,im' } },
      ];
    } else if (scope.startsWith('channel:')) {
      const id = scope.slice(8);
      const name = this.deps.hooks?.channelNames?.[id];
      const query = this.deps.hooks?.channelQuery === 'id' || !name ? `in:<#${id}>` : `in:#${name.replace(/^#/, '')}`;
      queries = [{ ref: `search:channel:${id}`, kind: 'channel_range', q: 'channel', args: { ...base, query, channel_types: 'public_channel,private_channel' } }];
    } else if (scope.startsWith('thread:')) {
      const [, ch, ts] = scope.split(':');
      const text = await this.source(input, 'slack_read_thread', rec, () => sl.readThread({ channel_id: ch, message_ts: ts, limit: 100, response_format: 'concise' }));
      void unwrap(text);
      await cc('cc_report_coverage', { objects: [{ kind: 'thread', ref: `slack:${ch}:${ts}`, from: window.from, to: window.to }] });
      await cc('cc_finish', { cursor: { value: `${before}.000000`, at: window.to }, complete: true });
      return;
    } else throw new Error(`unknown slack scope ${scope}`);

    let pagedOut: { ts: string; at: string } | undefined;
    const windows: Array<{ kind: string; ref: string; from: string; to: string }> = [];
    for (const q of queries) {
      let cursor: string | undefined;
      let last: { ts: string; at: string } | undefined;
      let pages = 0;
      let more = false;
      do {
        const text = await this.source(input, 'slack_search_public_and_private', rec, () => sl.search({ ...q.args, ...(cursor ? { cursor } : {}) }));
        if (/^\{"results":"Error|"isError"/.test(text)) throw new Error(text.slice(0, 200));
        const page = parseSearchResults(text);
        pages += 1;
        const items = page.msgs.map((m) => ({
          kind: 'message' as const,
          externalId: `${m.channelId}:${m.ts}`,
          occurredAt: m.ts,
          author: { name: m.authorName, email: m.authorEmail, externalId: m.authorId, isMe: m.authorId === me },
          permalink: m.permalink,
          excerpt: m.text.slice(0, 1000),
          threadRef: `slack:${m.channelId}:${m.threadTs ?? m.ts}`,
          payload: { channelId: m.channelId, ts: m.ts, threadTs: m.threadTs, isReply: !!m.threadTs, query: q.q },
        }));
        for (let i = 0; i < items.length; i += 50) {
          const r = (await cc('cc_record_source_items', { items: items.slice(i, i + 50) })) as { items?: Array<{ id: string; new: boolean; chg: boolean }> };
          for (const it of r.items ?? []) if (it.new || it.chg) await cc('cc_flag_unlinked', { sourceItemId: it.id, reason: 'deferred: scripted runner (stress mechanics)' });
        }
        const lm = page.msgs[page.msgs.length - 1];
        if (lm) last = { ts: lm.ts, at: new Date(Number(lm.ts) * 1000).toISOString() };
        cursor = page.cursor;
        more = !!cursor;
      } while (more && pages < 3);
      if (more && last) {
        windows.push({ kind: q.kind, ref: q.ref, from: window.from, to: last.at });
        if (!pagedOut || last.at < pagedOut.at) pagedOut = last;
      } else windows.push({ kind: q.kind, ref: q.ref, from: window.from, to: window.to });
    }
    await cc('cc_report_coverage', { windows });
    if (pagedOut) await cc('cc_finish', { cursor: { value: pagedOut.ts, at: pagedOut.at }, complete: false });
    else await cc('cc_finish', { cursor: { value: `${before}.000000`, at: window.to }, complete: true });
  }

  private async org62(input: ScanSkillRunInput, scope: string, window: { from: string; to: string }, cc: (n: string, a: unknown) => Promise<Record<string, unknown>>, rec: { calls: number }) {
    const tables = this.deps.org62;
    if (!tables) throw new Error('no org62 replay');
    const me = input.context.me.org62UserId ?? '';
    const f = window.from.replace(/\.\d{3}Z$/, 'Z');
    const t = window.to.replace(/\.\d{3}Z$/, 'Z');
    const qs: Record<string, Array<{ ref: string; q: string; obj: string }>> = {
      events: [{ ref: 'soql:Event', obj: 'Event', q: `SELECT Id, Subject, StartDateTime, SystemModstamp FROM Event WHERE OwnerId = '${me}' AND IsChild = false AND SystemModstamp >= ${f} AND SystemModstamp < ${t} ORDER BY SystemModstamp, Id LIMIT 200` }],
      dcs: [{ ref: 'soql:Deal_Contribution__c', obj: 'Deal_Contribution__c', q: `SELECT Id, Opportunity__c, SystemModstamp FROM Deal_Contribution__c WHERE SE_Name__c = '${me}' AND SystemModstamp >= ${f} AND SystemModstamp < ${t} ORDER BY SystemModstamp, Id LIMIT 200` }],
      opps: [{ ref: 'soql:OpportunityTeamMember', obj: 'Opportunity', q: `SELECT Id, OpportunityId, SystemModstamp, Opportunity.Name, Opportunity.SystemModstamp FROM OpportunityTeamMember WHERE UserId = '${me}' AND ((SystemModstamp >= ${f} AND SystemModstamp < ${t}) OR (Opportunity.SystemModstamp >= ${f} AND Opportunity.SystemModstamp < ${t})) ORDER BY Opportunity.SystemModstamp, OpportunityId LIMIT 200` }],
      missed_opps: [{ ref: 'soql:missed:accounts', obj: 'Opportunity', q: `SELECT Opportunity.AccountId, Opportunity.Account.Name FROM OpportunityTeamMember WHERE UserId = '${me}' LIMIT 500` }],
    };
    const windows: Array<{ kind: string; ref: string; from: string; to: string }> = [];
    for (const q of qs[scope] ?? []) {
      const text = await this.source(input, 'soqlQuery', rec, () => JSON.stringify(runSoql(tables, q.q, new Date(this.deps.now()))));
      const body = JSON.parse(text) as { records: Array<Record<string, unknown>> };
      const items = body.records
        .filter((r) => r.Id || (r.Opportunity as Record<string, unknown> | undefined)?.SystemModstamp)
        .map((r) => {
          const opp = r.Opportunity as Record<string, unknown> | undefined;
          const modstamp = String(opp?.SystemModstamp ?? r.SystemModstamp ?? window.to);
          const id = String(r.OpportunityId ?? r.Id ?? 'x');
          return { kind: 'record_snapshot' as const, externalId: `${q.obj}:${id}@${modstamp}`, occurredAt: modstamp.replace(/\+0000$/, 'Z'), title: String(opp?.Name ?? r.Subject ?? id).slice(0, 200), excerpt: 'scripted' };
        });
      for (let i = 0; i < items.length; i += 50) await cc('cc_record_source_items', { items: items.slice(i, i + 50) });
      windows.push({ kind: 'query_window', ref: q.ref, from: window.from, to: window.to });
    }
    await cc('cc_report_coverage', { windows });
    await cc('cc_finish', { cursor: { value: t, at: window.to }, complete: true });
  }
}
