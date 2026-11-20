/**
 * The ordered decision trail of one scan run.
 *
 *   npm run scan:trace -- <runId> [--json] [--kinds tool_call,verdict]
 *   npm run scan:trace -- --last [slack] [--failed]          the newest (failed) run, optionally of one connector
 *
 * Prints the run (scope, window, status, skill version, cost), then one line per event: time, kind and its fields.
 */
import { sql } from 'drizzle-orm';

import { loadRunTrace } from '../../src/scanner/trace/queries';

import { arg, has, hhmmss, kv, main, open, usd } from './lib';

void main(async (argv) => {
  const { handle, db, userId, dbName } = await open();
  try {
    let runId = argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));
    if (!runId && has(argv, '--last')) {
      const connector = argv[argv.indexOf('--last') + 1];
      const conn = connector && !connector.startsWith('--') ? connector : undefined;
      const r = await db.execute<{ id: string }>(sql`
        select r.id from scan_runs r join connectors c on c.id = r.connector_id
         where r.owner_user_id = ${userId} ${conn ? sql`and c.name = ${conn}` : sql``} ${has(argv, '--failed') ? sql`and r.status = 'failed'` : sql``}
           and exists (select 1 from scan_run_events e where e.run_id = r.id)
         order by r.started_at desc nulls last limit 1`);
      runId = r.rows[0]?.id;
    }
    if (!runId) {
      console.error('usage: npm run scan:trace -- <runId> [--json] [--kinds a,b]   |   npm run scan:trace -- --last [connector] [--failed]');
      return 2;
    }
    const t = await loadRunTrace(db, runId, userId);
    if (!t.run) {
      console.error(`no run ${runId} in ${dbName}`);
      return 1;
    }
    const kinds = arg(argv, '--kinds')?.split(',').map((s) => s.trim());
    const events = kinds ? t.events.filter((e) => kinds.includes(e.kind)) : t.events;
    if (has(argv, '--json')) {
      console.log(JSON.stringify({ ...t, events }, null, 2));
      return 0;
    }
    const r = t.run;
    console.log(`run ${r.id} · ${dbName}`);
    console.log(`  ${r.connector} ${r.scope ?? ''} · ${r.trigger}/${r.mode} · ${r.status}${r.errorCode ? ` (${r.errorCode})` : ''}`);
    console.log(`  window ${r.windowStart} → ${r.windowEnd}`);
    console.log(`  started ${r.startedAt} · finished ${r.finishedAt ?? '-'} · job ${r.jobId ?? '-'} · skill ${r.skillVersion ?? '-'} · model ${r.model ?? '-'}`);
    console.log(`  seen ${r.itemsSeen} · new ${r.itemsNew} · links ${r.links} · proposals ${r.proposals} · cost ${usd(r.costUsd)} (${t.spend.calls} llm_calls row(s), budget ${t.spend.budgets.join('+') || '-'})`);
    if (r.errorMessage) console.log(`  error: ${r.errorMessage}`);
    if (!t.events.length) {
      console.log('  (no trace: the run predates the trace, or the worker ran without the trace sink)');
      return 0;
    }
    console.log(`  ${t.events.length} event(s)${kinds ? `, ${events.length} shown` : ''}`);
    for (const e of events) {
      const refs = [e.sourceItemId ? `src=${e.sourceItemId}` : '', e.workItemId ? `wi=${e.workItemId}` : ''].filter(Boolean).join(' ');
      console.log(`  ${String(e.seq).padStart(4)} ${hhmmss(e.ts)} ${e.kind.padEnd(13)} ${kv(e.payload)}${refs ? ` ${refs}` : ''}`);
    }
    return 0;
  } finally {
    await handle.close();
  }
});
