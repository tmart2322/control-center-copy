/**
 * Prove the loaded sample is internally consistent: every foreign key resolves, plus a per-table row-count report.
 * (NOT NULL, enum and check constraints are enforced by the load itself.) Exit 1 on any orphan.
 *   npm run sample:validate -- --db control_center_sample
 */
import pg from 'pg';

const args = process.argv.slice(2);
const i = args.indexOf('--db');
const dbArg = (i >= 0 ? args[i + 1] : undefined) ?? process.env.SAMPLE_DB ?? 'control_center_sample';
const url = dbArg.includes('://') ? dbArg : `postgres://localhost:5432/${dbArg}`;
const client = new pg.Client({ connectionString: url });
await client.connect();
const fks = (
  await client.query(`
  select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
         (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as ccols,
         (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as pcols
  from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`)
).rows;
let orphans = 0;
for (const fk of fks) {
  const cc = fk.ccols as string[];
  const pc = fk.pcols as string[];
  const cond = cc.map((c, k) => `c."${c}" = p."${pc[k]}"`).join(' and ');
  const notNull = cc.map((c) => `c."${c}" is not null`).join(' and ');
  const n = Number((await client.query(`select count(*) n from ${fk.child} c where ${notNull} and not exists (select 1 from ${fk.parent} p where ${cond})`)).rows[0].n);
  if (n) {
    orphans += n;
    console.log(`ORPHAN ${fk.child}(${cc.join(',')}) -> ${fk.parent}: ${n} row(s) [${fk.conname}]`);
  }
}
const tables = (await client.query(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).rows;
const empty: string[] = [];
let total = 0;
for (const { table_name } of tables) {
  if (String(table_name).startsWith('__drizzle')) continue;
  const n = Number((await client.query(`select count(*) n from "${table_name}"`)).rows[0].n);
  total += n;
  if (!n) empty.push(table_name);
}
console.log(`foreign keys checked: ${fks.length}; orphans: ${orphans}; rows: ${total}; empty tables (${empty.length}): ${empty.join(', ') || 'none'}`);
await client.end();
process.exit(orphans ? 1 : 0);
