import fs from 'node:fs';
import path from 'node:path';

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { isTable, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate';
import { openTestDb, TEST_URL } from './helpers';

const h = openTestDb(2);
afterAll(() => h.close());

const MIGRATIONS = path.resolve(process.cwd(), 'src/db/migrations');
const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string }[];
};

async function one<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> {
  return (await h.db.execute(q)).rows[0] as T;
}

describe('migrations', () => {
  it('applied every journal entry from empty, in order', async () => {
    expect(journal.entries.map((e) => e.tag)).toEqual([
      '0000_extensions',
      '0001_init',
      '0002_extras',
      '0003_work_item_resolution',
      '0004_nba_type_review_deliverable',
      '0005_audit_row_key',
      '0006_engine_output_cascade',
      '0007_reopen_sibling_cascade',
      '0008_scan_run_events',
      '0009_onsite_location',
      '0010_vdp_mirror',
      '0011_vdp_asset_candidates',
      '0012_specialist_forecasts',
      '0013_draft_result_url',
      '0014_overlapping_meetings',
      '0015_dc_request_kind',
      '0016_vdp_server',
      '0017_org62_use_cases',
      '0020_dc_request_outcome', // 0018 and 0019 are the vdp-roundtrip and time-roundtrip lanes' (the merge puts them in order)
      '0022_org62_rows_never_hidden', // D-65 (time-roundtrip): rows tied to an Org62 Event are never hidden by an overlap
      '0023_llm_audit', // lane D (audit 2026-11-13, D0): llm_calls audit fields + llm_decisions
      '0024_retention_rollups', // lane E (audit 2026-11-13, E4): llm_call_days + llm_decision_days
      '0025_landings', // D-70: record_landings + landing_writes + use_cases
      '0026_live_notify', // D-73: NOTIFY triggers on the unaudited tables the UI used to poll (no writes)
    ]);
    const { n } = await one<{ n: string }>(sql`select count(*) as n from drizzle.__drizzle_migrations`);
    expect(Number(n)).toBe(journal.entries.length);
  });

  it('re-running migrate is a no-op', async () => {
    await runMigrations({ url: TEST_URL, log: () => {} });
    const { n } = await one<{ n: string }>(sql`select count(*) as n from drizzle.__drizzle_migrations`);
    expect(Number(n)).toBe(journal.entries.length);
  });

  it('creates the DATA-MODEL objects (+ R-UI-22)', async () => {
    const c = await one<Record<string, string>>(sql`
      select
        (select count(*) from pg_tables where schemaname = 'public') as tables,
        (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public' and t.typtype = 'e') as enums,
        (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and contype = 'f') as fks,
        (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and contype = 'c') as checks,
        (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and contype = 'x') as exclusions,
        (select count(*) from pg_views where schemaname = 'public') as views,
        (select count(*) from pg_extension where extname in ('pg_trgm', 'btree_gist')) as extensions`);
    expect(Number(c.tables)).toBe(120); // + record_landings, landing_writes, use_cases (D-70, 0025); + llm_call_days, llm_decision_days (E4, 0024); + llm_decisions (D0, 0023); + org62_use_cases, org62_use_case_reads (D-67, 0017); + vdp_server (D-59, 0016); + scan_run_events (AUDIT, 0008), vdp_asset_candidates (0011), specialist_forecasts (0012)
    expect(Number(c.enums)).toBe(137 + 2); // + work_item_resolution, work_item_involvement
    expect(Number(c.fks)).toBe(382 + 4 + 5 + 1 + 2 + 3 + 1 + 2 + 2 + 2); // + llm_call_days / llm_decision_days owner (E4, 0024); + llm_decisions owner + llm_call_id (D0, 0023); + org62_use_cases / org62_use_case_reads owner (D-67, 0017); + vdp_server owner (D-59, 0016); + scan_run_events.run_id, vdp_asset_candidates owner + account, specialist_forecasts owner + opp + account
    expect(Number(c.checks)).toBe(63 + 3 + 2 + 1 + 2 + 1 + 1 + 1 + 1 + 1); // + llm_decision_days_kind_chk (E4, 0024); + llm_decisions_kind_chk (D0, 0023); + llm_calls_budget_chk, vdp_asset_candidates status + origin, specialist_forecasts org62 id, deal_contribution_requests kind (0015), deal_contribution_requests outcome (D-68, 0020)
    expect(Number(c.exclusions)).toBe(2);
    // D-18 amended (0013): accepted meetings and onsite days (calendar rows) may overlap; every other counted row may not
    const { def } = await one<{ def: string }>(sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'activity_entries_no_overlap_excl'`);
    expect(def).toContain("origin <> 'calendar'");
    // D-65 (0022): a row tied to an Org62 Event is never hidden by an overlap (a duplicate is flagged instead)
    expect(def).toContain('org62_event_row_id IS NULL');
    expect(Number(c.views)).toBe(1);
    expect(Number(c.extensions)).toBe(2);
  });

  it('nba_type has review_deliverable (CONTRACT-1, 0004) and the schema enum matches the database', async () => {
    const res = await h.db.execute<{ v: string }>(sql`select unnest(enum_range(null::nba_type))::text as v`);
    const inDb = res.rows.map((r) => r.v);
    expect(inDb).toContain('review_deliverable');
    const { nbaType } = await import('../../src/db/schema/enums');
    expect(inDb).toEqual([...nbaType.enumValues]);
  });

  it('attaches the audit trigger to every curated table', async () => {
    const res = await h.db.execute<{ tbl: string }>(sql`
      select distinct c.relname as tbl from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and p.proname in ('cc_audit', 'cc_audit_kv')`);
    const audited = res.rows.map((r) => r.tbl);
    expect(audited).toHaveLength(48); // 45 + source_items (manual notes) + 2 composite-key tables
    for (const t of ['work_items', 'drafts', 'activity_entries', 'change_proposals', 'user_settings', 'source_items']) {
      expect(audited).toContain(t);
    }
    for (const t of ['jobs', 'scan_cursors', 'scan_ledger_entries', 'scan_run_events', 'audit_events', 'change_sets', 'llm_calls']) {
      expect(audited).not.toContain(t);
    }
  });

  it('no identifier was truncated: every snapshot name exists verbatim and fits in 63 chars', async () => {
    const snapshots = fs.readdirSync(path.join(MIGRATIONS, 'meta')).filter((f) => f.endsWith('_snapshot.json')).sort();
    const latest = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', snapshots.at(-1)!), 'utf8')) as {
      tables: Record<string, Record<string, Record<string, { name: string }>>>;
    };
    const names = new Set<string>();
    for (const t of Object.values(latest.tables)) {
      for (const kind of ['indexes', 'foreignKeys', 'compositePrimaryKeys', 'uniqueConstraints', 'checkConstraints']) {
        for (const obj of Object.values(t[kind] ?? {})) names.add(obj.name);
      }
    }
    const res = await h.db.execute<{ name: string }>(sql`
      select conname as name from pg_constraint where connamespace = 'public'::regnamespace
      union select indexname from pg_indexes where schemaname = 'public'`);
    const inDb = new Set(res.rows.map((r) => r.name));
    const missing = [...names].filter((n) => !inDb.has(n));
    expect(missing).toEqual([]);
    expect([...names].filter((n) => n.length > 63)).toEqual([]);
  });

  it('the split schema loads and every FK resolves (also via a direct domain import)', async () => {
    const work = await import('../../src/db/schema/work');
    expect(getTableConfig(work.workItems).foreignKeys.length).toBeGreaterThan(5);
    const schema = await import('../../src/db/schema');
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => isTable(v));
    expect(tables).toHaveLength(120); // + record_landings, landing_writes, use_cases (D-70); + llm_call_days, llm_decision_days (E4); + llm_decisions (D0); + org62_use_cases, org62_use_case_reads (D-67); + vdp_server (D-59)
    let fks = 0;
    for (const t of tables) {
      for (const fk of getTableConfig(t).foreignKeys) {
        expect(fk.getName().length).toBeLessThanOrEqual(63);
        expect(fk.reference().foreignTable).toBeTruthy();
        fks++;
      }
    }
    expect(fks).toBe(390 + 4 + 3 + 1 + 2 + 2 + 2); // + llm_call_days / llm_decision_days owner (E4); + llm_decisions owner + llm_call_id (D0); + org62_use_cases / org62_use_case_reads owner (D-67); + vdp_server owner (D-59); + specialist_forecasts owner + opp + account (0012)
  });
});
