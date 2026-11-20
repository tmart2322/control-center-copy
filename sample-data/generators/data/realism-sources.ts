/**
 * Item 5: Org62 record snapshots are about half of the real source_items (a snapshot row per observed revision of a
 * record); the sample had 14%. Appends si-752.. : intermediate Opportunity revisions (ending in the state the
 * opportunities table holds), Use_Case__c revisions (ending in org62_use_cases), and Account revisions.
 * Existing keys are not renumbered. Audit rows (connector_sync inserts) are added for them in realism-audit.
 */
import { rng } from '../../lib/kit';
import { OWNER, ms, iso, plus, DAY, readTable, writeTable, uid, sha, type Row } from './realism-lib';

export const NEW_SI_FROM = 752;
export function sources() {
  const R = rng('realism-sources');
  const items = readTable('source_items'); const runs = readTable('scan_runs'); const conns = readTable('connectors');
  const org62 = String(conns.find((c) => c.kind === 'org62')!.id);
  const o62runs = runs.filter((r) => r.connector_id === org62 && r.status === 'succeeded' && ['org62:opps', 'org62:book', 'org62:dcs'].includes(String(r.scope))).sort((a, b) => String(a.finished_at).localeCompare(String(b.finished_at)));
  const lastRun = o62runs[o62runs.length - 1]!;
  const firstRunAfter = (t: number) => o62runs.find((r) => ms(r.finished_at) > t) ?? lastRun;
  const opps = readTable('opportunities'); const oppByOrg = new Map(opps.map((o) => [String(o.org62_opportunity_id), o]));
  const accts = readTable('accounts'); const ucs = readTable('org62_use_cases');
  const base = items.filter((s) => s.kind === 'org62_record_snapshot' && s.external_container_id === 'Opportunity');
  const NEXT = ['Agree the success criteria owners.', 'Send the draft proposal to the AE for review.', 'Confirm the demo date with the sponsor.', 'Align pricing with deal desk.', 'Schedule the technical deep dive.', 'Collect the security questionnaire answers.', 'Get legal on the order form.', 'Walk the executive sponsor through the readout.'];
  const out: Row[] = []; const links: Row[] = []; const seen = new Set(items.map((s) => String(s.external_id)));
  let n = NEW_SI_FROM;
  const add = (container: string, parent: string, ext: string, title: string, body: string, occurred: string, meta: Row, accountId: unknown, urlId: string) => {
    if (occurred > '2026-11-18T15:30:00.000Z') { ext = ext.replace(/@.*$/, `@2026-11-18T15:30:00.000Z`); occurred = '2026-11-18T15:30:00.000Z'; }
    if (seen.has(ext)) return; seen.add(ext);
    const run = firstRunAfter(ms(occurred)); const firstSeen = plus(String(run.finished_at), -R.int(1, 2)); const id = uid('source_items', `si-${n}`); n++;
    out.push({
      id, owner_user_id: OWNER, connector_id: org62, source: 'org62', kind: 'org62_record_snapshot', external_id: ext, external_parent_id: parent, external_container_id: container, dedupe_key: `org62:${ext}`, content_hash: sha(body), revision: 1, occurred_at: occurred, source_updated_at: occurred,
      first_seen_at: firstSeen, last_seen_at: String(lastRun.finished_at), content_changed_at: null, first_scan_run_id: run.id, last_scan_run_id: lastRun.id, actor_person_id: null, actor_external_id: null, from_me: false, addressed_to_me: false, channel_id: null, asset_id: null, repo_id: null,
      title, url: `https://org62.example.com/lightning/r/${container}/${urlId}/view`, body, body_format: 'plain', body_expires_at: plus(occurred, 90 * 24 * 60), body_purged_at: null, redacted: false, redaction_count: 0, redaction_kinds: [],
      meta: { connector: 'org62', itemKind: 'record_snapshot', rec: 'auto', ...meta }, deleted_upstream_at: null, created_at: firstSeen, updated_at: String(lastRun.finished_at),
    });
    if (accountId) links.push({ id: uid('source_item_links', `real-si-${n - 1}`), source_item_id: id, account_id: accountId, opportunity_id: null, person_id: null, asset_id: null, calendar_event_id: null, role: 'about', method: 'connector', confidence: 1, extractor_id: null, mapping_rule_id: null, user_verdict: null, created_at: firstSeen, updated_at: firstSeen });
  };

  // Opportunity revisions between the first snapshot and the modification the opportunities table holds
  for (const b of base) {
    const o = oppByOrg.get(String(b.external_parent_id)); if (!o) continue;
    const t0 = ms(b.occurred_at); const t1 = ms(o.org62_modified_at); const gap = (t1 - t0) / DAY; if (gap < 1.5) continue;
    const K = Math.min(6, Math.round(gap / 3) + 1); const bm = b.meta as Row;
    for (let k = 1; k <= K; k++) {
      const last = k === K; const occ = last ? String(o.org62_modified_at) : iso(t0 + Math.round(((t1 - t0) * k) / (K + 1) / 3600_000) * 3600_000);
      const stage = last ? o.stage : bm.StageName; const amount = last ? o.amount : bm.Amount; const close = last ? o.close_date : bm.CloseDate; const fc = last ? o.forecast_category : bm.ForecastCategoryName;
      const next = last ? String(String(b.body).match(/next=(.*)$/)?.[1] ?? R.pick(NEXT)) : R.pick(NEXT);
      const body = `stage=${stage}; close=${close}; amount=${amount}; forecast=${fc}; closed=${o.is_closed}; won=${o.is_won}; next=${next}`;
      add('Opportunity', String(b.external_parent_id), `Opportunity:${b.external_parent_id}@${occ}`, String(b.title), body, occ, { ...bm, StageName: stage, CloseDate: close, Amount: amount, ForecastCategoryName: fc }, o.account_id, String(b.external_parent_id));
    }
  }
  // Use_Case__c revisions (stage moves forward, a go-live date appears)
  const STG = ['U01 - Not Started', 'U02 - Scoped', 'U03 - In Development', 'U04 - Deployed'];
  for (const u of ucs) {
    const t0 = ms(u.org62_created_at); const t1 = ms(u.org62_modified_at); const end = STG.indexOf(String(u.stage)); const K = 4;
    for (let k = 1; k <= K; k++) {
      const last = k === K; const occ = last ? String(u.org62_modified_at) : iso(t0 + Math.round(((t1 - t0) * k) / (K + 1) / 3600_000) * 3600_000);
      const stage = last ? String(u.stage) : STG[Math.min(Math.max(end, 0), Math.floor((k / K) * (Math.max(end, 0) + 1)))]!; const gl = last || k >= 3 ? u.go_live_date : null;
      const body = `name=${u.name}; stage=${stage}; product=${u.product}; go_live=${gl ?? ''}; opp=${u.org62_opportunity_id}`;
      const opp = oppByOrg.get(String(u.org62_opportunity_id));
      add('Use_Case__c', String(u.org62_use_case_id), `Use_Case__c:${u.org62_use_case_id}@${occ}`, String(u.name), body, occ, { Id: u.org62_use_case_id, Name: u.name, Stage__c: stage, Go_Live_Date__c: gl, Product__c: u.product, Opportunity__c: u.org62_opportunity_id, AccountId: u.org62_account_id, oppHints: [u.org62_opportunity_id], accountHints: [u.org62_account_id] }, opp?.account_id ?? null, String(u.org62_use_case_id));
    }
  }
  // Account revisions (owner and notes edits)
  for (const a of accts) {
    const bm = (base.find((b) => (b.meta as Row).AccountId === a.org62_account_id)?.meta as Row | undefined) ?? {};
    const t0 = ms('2026-10-20T15:00:00.000Z'); const t1 = ms(a.updated_at); const K = 3;
    for (let k = 1; k <= K; k++) {
      const occ = iso(t0 + Math.round(((Math.max(t1, t0 + 5 * DAY) - t0) * k) / K / 3600_000) * 3600_000);
      const body = `name=${a.name}; industry=${a.industry ?? ''}; type=Customer; owner=${bm.OwnerName ?? 'unassigned'}; revision=${k}`;
      add('Account', String(a.org62_account_id), `Account:${a.org62_account_id}@${occ}`, String(a.name), body, occ, { Id: a.org62_account_id, Name: a.name, Industry: a.industry, OwnerName: bm.OwnerName ?? null, accountHints: [a.org62_account_id, a.name] }, a.id, String(a.org62_account_id));
    }
  }
  writeTable('source_items', [...items, ...out]);
  const l = readTable('source_item_links'); writeTable('source_item_links', [...l, ...links]);
  console.log(`  org62 snapshots appended: ${out.length} (si-${NEW_SI_FROM}..si-${n - 1})`);
  return out;
}
