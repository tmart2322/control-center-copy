/**
 * Static privacy lint for sample-data (no database needed). Flags anything that is not unmistakably synthetic:
 * emails outside example domains, URLs outside example hosts, Salesforce/Slack-shaped ids without the SMPL marker,
 * phone numbers, and credential-shaped strings. Prints file + rule + counts, and with --lines an example of each.
 *   npm run sample:lint [-- --lines]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { SAMPLE_DIR } from '../../sample-data/lib/kit';

const showLines = process.argv.includes('--lines');
const exampleHost = /(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.example|example)$/i;
const rules: Array<{ name: string; re: RegExp; ok?: (m: string, groups: string[]) => boolean }> = [
  { name: 'email-not-example', re: /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, ok: (_m, g) => exampleHost.test(g[0] ?? '') },
  { name: 'url-not-example', re: /https?:\/\/([A-Za-z0-9.-]+)/g, ok: (_m, g) => exampleHost.test(g[0] ?? '') },
  { name: 'sf-id-without-marker', re: /\b(?:001|003|005|006|00Q|00T|00U|0Hn|a0[0-9A-Za-z])[0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?\b/g, ok: (m) => /SMPL/.test(m) || !/\d/.test(m) },
  { name: 'slack-id-without-marker', re: /\b[UCDWG][0-9A-Z]{8,10}\b/g, ok: (m) => /SMPL/.test(m) || !/\d/.test(m) },
  { name: 'phone', re: /(?<![\w.])\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, ok: (m) => /555[-. ]01\d\d/.test(m) },
  { name: 'credential-shape', re: /\b(?:xox[abprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/g },
];
const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(path.join(p, f));
  else if (/\.(json|md)$/.test(p)) files.push(p);
};
walk(SAMPLE_DIR);
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const r of rules) {
    const hits = [...text.matchAll(r.re)].filter((m) => !(r.ok?.(m[0], m.slice(1)) ?? false)).map((m) => m[0]);
    if (!hits.length) continue;
    bad += hits.length;
    console.log(`${path.relative(SAMPLE_DIR, f)}: ${r.name} x${hits.length}${showLines ? '  e.g. ' + [...new Set(hits)].slice(0, 5).join(' | ') : ''}`);
  }
}
console.log(`sample:lint: ${files.length} files, ${bad} finding(s)`);
process.exit(bad ? 1 : 0);
