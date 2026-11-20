/**
 * What the wired BE-3 behaviour WOULD be (BE-3 is not built): replay every scanner-produced evidence signal of a
 * scenario DB through the pure closure engine (src/engines/closure, read-only use) in time order, per work item,
 * and tally the outcomes (auto-closed, likely done, reopened vs new sibling, looped back in, context only).
 * Optionally scores auto-closures against the answer key (an item with a key `completion`).
 *   npx tsx scripts/stress/closure-sim.ts <scenarioDb> [block]
 */
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { applyDecision, applySignal } from '../../src/engines/closure';
import type { ClosureItem, Signal } from '../../src/engines/types';

import { openStressDb, urlOf } from './lib/db';
import { privDir, readJson, writePriv } from './lib/paths';
import type { AnswerKey } from './answer-key';
import { dbRef, normRef } from './score';

type Row = {
  wid: string;
  kind: string;
  status: string;
  title: string;
  resolution: string | null;
  involvement: string | null;
  role: string;
  confidence: string | null;
  reason: string | null;
  at: string;
  src: string;
  ext: string;
  dk: string;
  from_me: boolean | null;
  evid: string;
};

export async function simulate(dbName: string, block?: string) {
  const h = openStressDb(urlOf(dbName), 'stress-closure');
  try {
    const r = await h.db.execute<Row>(sql`
      select w.id as wid, w.kind::text, w.status::text, w.title, w.resolution::text, w.involvement::text,
             ev.role::text, ev.confidence::text, ev.rationale as reason, coalesce(s.occurred_at, ev.created_at)::text as at,
             s.source::text as src, s.external_id as ext, s.dedupe_key as dk, s.from_me, ev.id as evid
        from work_items w join work_item_evidence ev on ev.work_item_id = w.id join source_items s on s.id = ev.source_item_id
       where w.title not like 'Where does this belong?%'
       order by w.id, coalesce(s.occurred_at, ev.created_at), ev.created_at`);
    const byItem = new Map<string, Row[]>();
    for (const x of r.rows) byItem.set(x.wid, [...(byItem.get(x.wid) ?? []), x]);
    const tally: Record<string, number> = {};
    const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
    const closedRefs = new Map<string, string>(); // workItemId → final status
    for (const [wid, rows] of byItem) {
      const f = rows[0]!;
      let item: ClosureItem = {
        id: wid,
        version: 1,
        kind: f.kind as ClosureItem['kind'],
        status: (f.status === 'suggested' ? 'suggested' : 'open') as ClosureItem['status'],
        title: f.title,
        resolution: (f.resolution as ClosureItem['resolution']) ?? null,
        involvement: (f.involvement as ClosureItem['involvement']) ?? 'owner',
      };
      for (const e of rows) {
        if (e.role === 'origin' && !(e.reason ?? '').startsWith('loop_back:')) continue; // the proposal itself
        const signal: Signal = {
          type: 'evidence',
          role: e.role as never,
          confidence: (e.confidence ?? 'likely') as never,
          evidenceId: e.evid,
          at: new Date(e.at).toISOString(),
          actor: { name: e.from_me ? 'me' : 'someone', isMe: !!e.from_me },
          reason: e.reason ?? undefined,
        };
        const d = applySignal(item, signal);
        bump(`decision:${d.kind}`);
        for (const l of d.labels) bump(`label:${l.kind}`);
        if (d.reopenDecision) bump(`reopen:${d.reopenDecision.outcome}`);
        if (d.transition) bump(`transition:${d.transition.from}→${d.transition.to}`);
        item = applyDecision(item, d).item;
      }
      bump(`final:${item.status}`);
      closedRefs.set(wid, item.status);
    }
    let vsKey: Record<string, number> | undefined;
    if (block) {
      const key = readJson<AnswerKey>(path.join(privDir('answer-key'), `${block}.json`));
      const completedRefs = new Set(key.items.filter((it) => it.refs.some((x) => x.role === 'completion')).flatMap((it) => it.refs.map((x) => normRef(x.ref))));
      const openRefs = new Set(key.items.filter((it) => !it.refs.some((x) => x.role === 'completion')).flatMap((it) => it.refs.map((x) => normRef(x.ref))));
      vsKey = { closedAndKeyDone: 0, closedButKeyOpen: 0, openButKeyDone: 0, openAndKeyOpen: 0 };
      for (const [wid, rows] of byItem) {
        const refs = rows.map((x) => dbRef(x.src, x.ext, x.dk));
        const done = refs.some((x) => completedRefs.has(x));
        const open = refs.some((x) => openRefs.has(x));
        if (!done && !open) continue;
        const closed = ['done', 'likely_done'].includes(closedRefs.get(wid) ?? '');
        vsKey[closed ? (done ? 'closedAndKeyDone' : 'closedButKeyOpen') : done ? 'openButKeyDone' : 'openAndKeyOpen'] += 1;
      }
    }
    const out = { db: dbName, items: byItem.size, tally, vsKey };
    writePriv(path.join(privDir('reports'), `closure-${dbName}.json`), JSON.stringify(out, null, 1));
    return out;
  } finally {
    await h.close();
  }
}

const invoked = /closure-sim\.ts$/.test(process.argv[1] ?? '');
if (invoked) {
  const [db, block] = process.argv.slice(2);
  simulate(db!, block)
    .then((o) => console.log(JSON.stringify(o, null, 1)))
    .catch((e) => {
      console.error((e as Error).message);
      process.exit(1);
    });
}
