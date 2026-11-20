/** Run every generator in sample-data/generators in filename order (01-…, 02-…). `npm run sample:build` */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { SAMPLE_DIR } from './lib/kit';

const dir = path.join(SAMPLE_DIR, 'generators');
for (const f of readdirSync(dir).filter((x) => /^\d.*\.ts$/.test(x)).sort()) {
  console.log(`# ${f}`);
  execFileSync('npx', ['tsx', path.join(dir, f)], { stdio: 'inherit' });
}
