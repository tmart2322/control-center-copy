/**
 * Print the scanner ↔ answer-key disagreements of one score file compactly, for adjudication (private: prints
 * source snippets to the terminal only; nothing is written to the repo).
 *   npx tsx scripts/stress/disagreements.ts <block> <label> [maxChars]
 */
import fs from 'node:fs';
import path from 'node:path';

import { privDir, readJson } from './lib/paths';
import type { AnswerKey } from './answer-key';

function main() {
  const [block, label, max = '150'] = process.argv.slice(2);
  const n = Number(max);
  const s = readJson<{ falseNegatives: Array<{ key: string; kind: string; title: string; source: string }>; falsePositives: Array<{ originRef: string; title: string; kind: string; connector: string; excerpt: string }> }>(path.join(privDir('reports'), `score-${label}.json`));
  const key = readJson<AnswerKey>(path.join(privDir('answer-key'), `${block}.json`));
  const digest = fs.readFileSync(path.join(privDir('answer-key'), `${block}.digest.txt`), 'utf8').split('\n');
  const lineOf = (ref: string) => digest.find((l) => l.startsWith(`[${ref}]`))?.slice(ref.length + 3, ref.length + 3 + n) ?? '?';
  console.log(`## FN (${s.falseNegatives.length})`);
  for (const f of s.falseNegatives) {
    const it = key.items.find((x) => x.key === f.key)!;
    const o = it.refs.find((r) => r.role === 'origin') ?? it.refs[0]!;
    console.log(`- [${f.key}] ${f.kind}/${it.confidence ?? ''} "${f.title}" origin ${o.ref.split(':')[0]}: ${lineOf(o.ref)}`);
  }
  console.log(`\n## FP (${s.falsePositives.length})`);
  for (const f of s.falsePositives) console.log(`- [${f.originRef}] ${f.kind} "${f.title}" :: ${f.excerpt.replace(/\s+/g, ' ').slice(0, n)}`);
}

main();
