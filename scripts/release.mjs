#!/usr/bin/env node
// npm run release -- patch|minor|major [--dry] [--since <ref>] [--all] [--cwd <dir>] [--date YYYY-MM-DD]
//
// Cuts a release locally (D-57, docs/RELEASING.md):
//   1. refuses a dirty working tree;
//   2. bumps package.json (and package-lock.json) to the next semver version;
//   3. writes the next CHANGELOG.md section: the hand-written [Unreleased] entries folded in, plus the commit
//      subjects since the last v* tag (feat → Added, fix → Fixed, …; merges and chores skipped). With no tag yet
//      (the first release) only the Unreleased entries go in, unless --since <ref> or --all says otherwise;
//   4. commits "chore(release): vX.Y.Z" and tags vX.Y.Z (annotated).
// It never pushes. --dry prints the section and changes nothing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUMPS, bumpVersion, foldChangelog, git, isClean, lastTag, renderSection, splitChangelog, subjectsSince, today } from './lib/release.mjs';

const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const bump = argv.find((a) => BUMPS.includes(a));
const dry = argv.includes('--dry');
const cwd = resolve(val('--cwd', process.cwd()));
const date = val('--date', today());

function fail(msg) {
  console.error(`[release] ${msg}`);
  process.exit(1);
}

if (!bump) fail(`usage: npm run release -- ${BUMPS.join('|')} [--dry]`);
if (!dry && !isClean(cwd)) fail('the working tree has uncommitted changes; commit or set them aside first');

const pkgPath = join(cwd, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const from = pkg.version;
const to = bumpVersion(from, bump);
const tag = `v${to}`;
try {
  git(cwd, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { quiet: true });
  fail(`tag ${tag} already exists`);
} catch {
  /* free */
}

const tagged = lastTag(cwd);
const since = val('--since', tagged);
// the first release: hundreds of build-up commits would bury the Unreleased notes, so they stay out by default
const subjects = since || argv.includes('--all') ? subjectsSince(cwd, since) : [];
const clPath = join(cwd, 'CHANGELOG.md');
const changelog = existsSync(clPath) ? readFileSync(clPath, 'utf8') : '# Changelog\n';

if (dry) {
  console.log(`[release] ${from} → ${to} (${bump}); ${since || argv.includes('--all') ? `${subjects.length} commit(s) since ${since ?? 'the first commit'}` : 'first release: the Unreleased entries only (--all adds every commit)'}\n`);
  console.log(renderSection({ version: to, date, unreleased: splitChangelog(changelog).unreleased, subjects }));
  process.exit(0);
}

writeFileSync(clPath, foldChangelog(changelog, { version: to, date, subjects }));
pkg.version = to;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
const lockPath = join(cwd, 'package-lock.json');
const files = ['package.json', 'CHANGELOG.md'];
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = to;
  if (lock.packages?.['']) lock.packages[''].version = to;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  files.push('package-lock.json');
}
git(cwd, ['add', ...files]);
git(cwd, ['commit', '-q', '-m', `chore(release): ${tag}`]);
git(cwd, ['tag', '-a', tag, '-m', `Control Center ${tag}`]);
console.log(`[release] ${from} → ${to}: committed and tagged ${tag} (${subjects.length} commit subject(s)${since ? ` since ${since}` : ''}).`);
console.log('[release] Nothing was pushed. Review CHANGELOG.md; amend before pushing if needed.');
