/**
 * "Why wasn't this picked up?" for one source item: was it fetched, recorded, triaged (verdict and why), linked?
 *
 *   npm run scan:explain -- --source-item <uuid> [--json]
 *   npm run scan:explain -- --url <permalink> [--json]     a Slack permalink, Lightning record URL, Drive/Docs link, …
 *
 * For a Slack permalink that was never recorded it says whether any run covered that moment (a coverage hole, or a
 * search that did not return it). Prints ids, codes, links and short reasons; never the message text.
 */
import { explainSourceItem } from '../../src/scanner/trace/queries';

import { arg, has, hhmmss, main, open } from './lib';

void main(async (argv) => {
  const sourceItemId = arg(argv, '--source-item');
  const url = arg(argv, '--url');
  if (!sourceItemId && !url) {
    console.error('usage: npm run scan:explain -- --source-item <id> | --url <permalink> [--json]');
    return 2;
  }
  const { handle, db, userId, dbName } = await open();
  try {
    const x = await explainSourceItem(db, userId, { ...(sourceItemId ? { sourceItemId } : {}), ...(url ? { url } : {}) });
    if (has(argv, '--json')) {
      console.log(JSON.stringify(x, null, 2));
      return x.found ? 0 : 1;
    }
    console.log(`explain ${sourceItemId ?? url} · ${dbName}`);
    if (x.item) {
      const i = x.item;
      console.log(`  item ${i.id} · ${i.source}/${i.kind} · ${i.externalId}`);
      console.log(`  at ${i.occurredAt} · from me ${i.fromMe} · to me ${i.addressedToMe} · first seen ${i.firstSeenAt} · revision ${i.revision}`);
      console.log(`  link ${i.url ?? '(none)'}`);
    }
    console.log(`  fetched: ${x.fetched.length ? '' : x.found ? '(no run listed)' : 'no'}`);
    for (const f of x.fetched) console.log(`    ${f.at?.slice(0, 19) ?? '-'} run ${f.runId} ${f.scope ?? ''} ${f.status}${f.isNew ? ' · new' : ''} (${f.via})`);
    if (x.coverage.length) {
      console.log('  coverage of that moment:');
      for (const c of x.coverage.slice(0, 8)) console.log(`    run ${c.runId} ${c.scope} ${c.kind} ${c.ref ?? ''} ${c.from ?? ''} → ${c.to ?? ''} (${c.outcome})`);
    }
    console.log(`  triage: ${x.triage.length ? '' : 'none'}`);
    for (const t of x.triage) console.log(`    ${hhmmss(t.at)} run ${t.runId} ${t.pass}: ${t.decision}${t.why ? ` · ${t.why}` : ''}`);
    console.log(`  outcomes: ${x.outcomes.length ? '' : 'none'}`);
    for (const o of x.outcomes) console.log(`    ${hhmmss(o.at)} ${o.kind}${o.role ? ` ${o.role}` : ''}${o.confidence ? ` (${o.confidence})` : ''}${o.workItemId ? ` → wi ${o.workItemId}` : ''}${o.reason ? ` · ${o.reason}` : ''}${o.runId ? ` · run ${o.runId}` : ''}`);
    if (x.evidence.length) {
      console.log('  evidence:');
      for (const e of x.evidence) console.log(`    ${e.role} of wi ${e.workItemId} (${e.itemStatus ?? '?'}) conf ${e.confidence}`);
    }
    console.log(`  → ${x.verdict}`);
    return x.found ? 0 : 1;
  } finally {
    await handle.close();
  }
});
