/**
 * Load sample-data/tables/*.json into a SCRATCH Postgres database (schema already migrated).
 *
 *   createdb control_center_sample && DATABASE_URL=postgres://localhost:5432/control_center_sample npm run db:migrate
 *   npm run sample:load -- --db control_center_sample [--only a,b,c]
 *
 * Safety: the database name must contain "sample". It empties the app tables it loads (all of them without --only).
 * Foreign keys are not enforced while loading (session_replication_role=replica, needs a superuser), because the schema
 * has cycles; `npm run sample:validate` then proves every reference resolves.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { TABLES_DIR } from '../../sample-data/lib/kit';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbArg = opt('--db') ?? process.env.SAMPLE_DB ?? 'control_center_sample';
const url = dbArg.includes('://') ? dbArg : `postgres://localhost:5432/${dbArg}`;
const dbName = new URL(url).pathname.slice(1);
if (!/sample/.test(dbName)) throw new Error(`refusing to load into "${dbName}": the database name must contain "sample"`);
const only = opt('--only')?.split(',').filter(Boolean);

const client = new pg.Client({ connectionString: url });
await client.connect();
const colMeta = new Map<string, Map<string, { data_type: string; udt_name: string }>>();
for (const r of (await client.query(`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema='public' and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE')`)).rows) {
  if (!colMeta.has(r.table_name)) colMeta.set(r.table_name, new Map());
  colMeta.get(r.table_name)!.set(r.column_name, r);
}
const files = readdirSync(TABLES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((t) => !only || only.includes(t))
  .sort();
for (const t of files) if (!colMeta.has(t)) throw new Error(`sample-data/tables/${t}.json: no such table`);

const allTables = [...colMeta.keys()].filter((t) => !t.startsWith('__drizzle'));
const toEmpty = only ? files : allTables;
let loaded = 0;
await client.query('begin');
try {
  await client.query(`set local session_replication_role = replica`);
  if (toEmpty.length) await client.query(`truncate ${toEmpty.map((t) => `"${t}"`).join(', ')} restart identity cascade`);
  for (const t of files) {
    const rows = JSON.parse(readFileSync(path.join(TABLES_DIR, `${t}.json`), 'utf8')) as Array<Record<string, unknown>>;
    const meta = colMeta.get(t)!;
    for (const [i, row] of rows.entries()) {
      const keys = Object.keys(row);
      const unknown = keys.filter((k) => !meta.has(k));
      if (unknown.length) throw new Error(`${t}[${i}]: unknown column(s) ${unknown.join(', ')}`);
      const values = keys.map((k) => {
        const v = row[k];
        if (v === null || v === undefined) return null;
        const udt = meta.get(k)!.udt_name;
        return udt === 'jsonb' || udt === 'json' ? JSON.stringify(v) : v;
      });
      try {
        await client.query(`insert into "${t}" (${keys.map((k) => `"${k}"`).join(',')}) values (${keys.map((_, j) => `$${j + 1}`).join(',')})`, values as unknown[]);
      } catch (e) {
        throw new Error(`${t}[${i}] (${String(row.id ?? '')}): ${(e as Error).message}`);
      }
    }
    loaded += rows.length;
    console.log(`  ${t}: ${rows.length}`);
  }
  // keep serial / identity sequences ahead of the explicit ids
  for (const t of files) {
    for (const col of colMeta.get(t)!.keys()) {
      const seq = (await client.query(`select pg_get_serial_sequence($1, $2) as s`, [`"${t}"`, col])).rows[0]?.s as string | null;
      if (seq) await client.query(`select setval($1, greatest((select coalesce(max("${col}"), 0) from "${t}"), 1), (select count(*) > 0 from "${t}"))`, [seq]);
    }
  }
  await client.query('commit');
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  await client.end();
}
console.log(`loaded ${loaded} rows into ${files.length} tables of ${dbName}`);
