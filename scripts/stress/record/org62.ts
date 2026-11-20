/**
 * Record Org62 once, read-only (soqlQuery only), as per-object supersets the replay SOQL engine filters:
 * every field the scan-org62 skill selects or filters on, for my opp teams, my accounts' opps, my Events, my
 * DCs, and (for the missed-opp sweep) line items and DCs on candidate opps. Field values exist only as of
 * today (Org62 cannot be time-travelled); replay hides rows whose current SystemModstamp is after the
 * simulated now.
 *   CC_STRESS_ME_ORG62=005… npx tsx scripts/stress/record/org62.ts
 */
import path from 'node:path';

import { responseText } from '../lib/agent';
import { callKey, execReadCalls } from '../lib/exec-calls';
import { privDir, writePriv } from '../lib/paths';
import type { Row, SoqlTable } from '../replay/soql';

const ME = process.env.CC_STRESS_ME_ORG62 ?? '';
const TOOL = 'mcp__Org62-Sobject-Read__soqlQuery';
const log = (m: string) => console.log(`[record:org62] ${m}`);

export const ORG62_FIELDS: Record<string, string[]> = {
  OpportunityTeamMember: ['Id', 'OpportunityId', 'TeamMemberRole', 'SystemModstamp', 'CreatedDate', 'UserId', 'Opportunity.Name', 'Opportunity.AccountId', 'Opportunity.Account.Name', 'Opportunity.StageName', 'Opportunity.CloseDate', 'Opportunity.Amount', 'Opportunity.ForecastCategoryName', 'Opportunity.NextStep', 'Opportunity.IsClosed', 'Opportunity.IsWon', 'Opportunity.SystemModstamp'],
  Opportunity: ['Id', 'Name', 'AccountId', 'Account.Name', 'StageName', 'CloseDate', 'Amount', 'ForecastCategoryName', 'NextStep', 'Type', 'IsClosed', 'IsWon', 'OwnerId', 'Owner.Name', 'SystemModstamp', 'CreatedDate'],
  Event: ['Id', 'Subject', 'StartDateTime', 'EndDateTime', 'DurationInMinutes', 'Duration__c', 'SE_Task_Type__c', 'RecordType.Name', 'WhatId', 'What.Name', 'What.Type', 'AccountId', 'IsChild', 'SystemModstamp', 'OwnerId', 'CreatedDate'],
  Deal_Contribution__c: ['Id', 'Opportunity__c', 'Opportunity__r.Name', 'Opportunity__r.AccountId', 'Opportunity__r.StageName', 'Opportunity__r.CloseDate', 'Opportunity__r.IsClosed', 'Opportunity__r.IsWon', 'SE_Name__c', 'SE_Name__r.Name', 'Opportunity_Role__c', 'Split_Percentage__c', 'SystemModstamp', 'CreatedDate'],
  OpportunityLineItem: ['Id', 'OpportunityId', 'Product2.Name', 'TotalPrice', 'SystemModstamp'],
};

export const ORG62_TIME_FIELDS: Record<string, string[]> = {
  OpportunityTeamMember: ['SystemModstamp', 'Opportunity.SystemModstamp'],
  Opportunity: ['SystemModstamp'],
  Event: ['SystemModstamp'],
  Deal_Contribution__c: ['SystemModstamp'],
  OpportunityLineItem: ['SystemModstamp'],
};

async function pagedQuery(object: string, where: string, scenario: string): Promise<Row[]> {
  const rows: Row[] = [];
  let lastId = '';
  for (let page = 0; page < 80; page++) {
    if (page === 79) log(`${object}: page cap hit, superset may be truncated`);
    const q = `SELECT ${ORG62_FIELDS[object]!.join(', ')} FROM ${object} WHERE ${where}${lastId ? ` AND Id > '${lastId}'` : ''} ORDER BY Id LIMIT 50`;
    const res = await execReadCalls('org62', [{ tool: TOOL, args: { q } }], { scenario, batch: 1, log });
    const c = res.get(callKey(TOOL, { q }));
    if (!c) throw new Error(`org62 query not executed (${object} page ${page})`);
    const text = responseText(c.response);
    let body: { records?: Row[]; done?: boolean };
    try {
      body = JSON.parse(text) as { records?: Row[] };
    } catch {
      throw new Error(`org62 ${object}: non-JSON response (${text.slice(0, 120)})`);
    }
    const recs = body.records ?? [];
    for (const r of recs) delete (r as { attributes?: unknown }).attributes;
    rows.push(...recs);
    log(`${object} page ${page}: ${recs.length}`);
    if (recs.length < 50) break;
    lastId = String(recs[recs.length - 1]!.Id);
  }
  return rows;
}

async function main() {
  if (!ME) throw new Error('set CC_STRESS_ME_ORG62');
  const scenario = 'record';
  const tables: Record<string, SoqlTable> = {};
  const put = (object: string, rows: Row[]) => {
    const prev = tables[object]?.rows ?? [];
    const byId = new Map<string, Row>([...prev, ...rows].map((r) => [String(r.Id), r]));
    tables[object] = { object, rows: [...byId.values()], fields: ORG62_FIELDS[object]!, timeFields: ORG62_TIME_FIELDS[object]! };
  };
  const otm = await pagedQuery('OpportunityTeamMember', `UserId = '${ME}'`, scenario);
  put('OpportunityTeamMember', otm);
  const events = await pagedQuery('Event', `OwnerId = '${ME}' AND IsChild = false AND (StartDateTime >= 2026-03-01T00:00:00Z OR SystemModstamp >= 2026-08-01T00:00:00Z)`, scenario);
  put('Event', events);
  const dcs = await pagedQuery('Deal_Contribution__c', `SE_Name__c = '${ME}'`, scenario);
  put('Deal_Contribution__c', dcs);
  const accounts = new Map<string, string>();
  for (const r of otm) {
    const o = r.Opportunity as Row | null;
    if (o?.AccountId) accounts.set(String(o.AccountId), String((o.Account as Row | null)?.Name ?? ''));
  }
  for (const e of events) if (e.AccountId) accounts.set(String(e.AccountId), accounts.get(String(e.AccountId)) ?? '');
  const ids = [...accounts.keys()].sort();
  log(`${ids.length} accounts`);
  for (let i = 0; i < ids.length; i += 40) {
    const list = ids.slice(i, i + 40).map((x) => `'${x}'`).join(',');
    put('Opportunity', await pagedQuery('Opportunity', `AccountId IN (${list}) AND (SystemModstamp >= 2026-09-15T00:00:00Z OR (IsClosed = false AND Amount > 10000) OR (IsWon = true AND CloseDate >= 2026-07-01))`, scenario));
  }
  const cand = (tables.Opportunity?.rows ?? []).filter((o) => Number(o.Amount ?? 0) > 10000).map((o) => String(o.Id));
  for (let i = 0; i < cand.length; i += 60) {
    const list = cand.slice(i, i + 60).map((x) => `'${x}'`).join(',');
    put('OpportunityLineItem', await pagedQuery('OpportunityLineItem', `OpportunityId IN (${list}) AND TotalPrice > 0`, scenario));
    put('Deal_Contribution__c', await pagedQuery('Deal_Contribution__c', `Opportunity__c IN (${list})`, scenario));
  }
  const dir = privDir('recordings', 'org62');
  writePriv(path.join(dir, 'tables.json'), JSON.stringify(tables));
  writePriv(path.join(dir, 'accounts.json'), JSON.stringify([...accounts.entries()].map(([id, name]) => ({ id, name }))));
  log(`tables: ${Object.values(tables).map((t) => `${t.object}=${t.rows.length}`).join(' ')}`);
}

main().catch((e) => {
  console.error('[record:org62] failed', (e as Error).message);
  process.exit(1);
});
