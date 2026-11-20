/** D-57: `npm run release` bumps package.json, writes the CHANGELOG section, commits and tags, never pushes. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bumpVersion, classifySubject, foldChangelog, groupSubjects, sectionsBetween, splitChangelog } from '../../scripts/lib/release.mjs';

const root = path.resolve(__dirname, '../..');
const script = path.join(root, 'scripts/release.mjs');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A temp repo with a copy of the real CHANGELOG and a package.json at 0.1.0. */
function tempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-release-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'release@example.com');
  git(dir, 'config', 'user.name', 'Release Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'cc', version: '0.1.0', private: true }, null, 2)}\n`);
  writeFileSync(path.join(dir, 'package-lock.json'), `${JSON.stringify({ name: 'cc', version: '0.1.0', lockfileVersion: 3, packages: { '': { name: 'cc', version: '0.1.0' } } }, null, 2)}\n`);
  // a fixed changelog, not the repo's: the repo's Unreleased section is empty right after a release
  writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Added\n- A hand-written note\n\n### Fixed\n- A hand-written fix\n\n## [0.1.0] - 2026-10-01\n\n### Added\n- First\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: start');
  return dir;
}

function commit(dir: string, subject: string) {
  writeFileSync(path.join(dir, `f-${Math.random().toString(36).slice(2)}.txt`), subject);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', subject);
}

const release = (dir: string, ...args: string[]) => execFileSync(process.execPath, [script, ...args, '--cwd', dir, '--date', '2026-11-11'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('release helpers', () => {
  it('bumps semver', () => {
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpVersion('v1.4.2', 'major')).toBe('2.0.0');
    expect(() => bumpVersion('1.0.0', 'huge')).toThrow();
  });

  it('maps conventional commits onto Keep a Changelog headings and skips housekeeping', () => {
    expect(classifySubject('feat(time): onsite days')).toEqual({ heading: 'Added', line: '**time**: Onsite days' });
    expect(classifySubject('fix: a crash')).toEqual({ heading: 'Fixed', line: 'A crash' });
    expect(classifySubject('feat(api)!: drop v0 routes')).toEqual({ heading: 'Changed', line: '**api**: Drop v0 routes (breaking)' });
    expect(classifySubject('Merge claude/lane-a')).toBeNull();
    expect(classifySubject('chore(release): v1.0.0')).toBeNull();
    expect(classifySubject('test: more cases')).toBeNull();
    expect(groupSubjects(['fix: a', 'fix: a', 'feat: b'])).toEqual({ Fixed: ['A'], Added: ['B'] });
  });

  it('folds the Unreleased section into the release and leaves an empty Unreleased', () => {
    const text = '# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Added\n- Hand note\n\n## [0.1.0] - 2026-10-01\n\n### Added\n- First\n';
    const out = foldChangelog(text, { version: '0.2.0', date: '2026-11-11', subjects: ['feat: from git', 'fix: a bug'] });
    expect(out).toBe('# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [0.2.0] - 2026-11-11\n\n### Added\n- Hand note\n- From git\n\n### Fixed\n- A bug\n\n## [0.1.0] - 2026-10-01\n\n### Added\n- First\n');
    expect(splitChangelog(out).unreleased).toBe('');
    expect(sectionsBetween(out, '0.1.0', '0.2.0')).toHaveLength(1);
    expect(sectionsBetween(out, '0.0.1', '0.2.0')).toHaveLength(2);
  });
});

describe('npm run release (on a temp copy)', { timeout: 60_000 }, () => {
  it('bumps the version, writes the changelog, commits and tags locally', () => {
    const dir = tempRepo();
    const unreleased = splitChangelog(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')).unreleased as string;
    const out = release(dir, 'major');
    expect(out).toContain('0.1.0 → 1.0.0');
    expect(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version).toBe('1.0.0');
    const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    expect([lock.version, lock.packages[''].version]).toEqual(['1.0.0', '1.0.0']);
    const cl = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    expect(cl).toMatch(/## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-11-11\n/);
    // the hand-written Unreleased entries moved into 1.0.0
    const firstEntry = unreleased.split('\n').find((l) => l.startsWith('- '))!;
    expect(sectionsBetween(cl, '0.1.0', '1.0.0')[0]).toContain(firstEntry);
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('chore(release): v1.0.0');
    expect(git(dir, 'tag', '--list')).toBe('v1.0.0');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(git(dir, 'remote')).toBe(''); // nothing to push to, and nothing was pushed
  });

  it('the next release takes the commit subjects since the last tag', () => {
    const dir = tempRepo();
    release(dir, 'major');
    commit(dir, 'feat(home): a new card');
    commit(dir, 'fix(time): the totals');
    commit(dir, 'chore: tidy');
    release(dir, 'minor');
    const cl = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    const section = sectionsBetween(cl, '1.0.0', '1.1.0')[0]!;
    expect(section).toContain('### Added\n- **home**: A new card');
    expect(section).toContain('### Fixed\n- **time**: The totals');
    expect(section).not.toContain('tidy');
    expect(git(dir, 'tag', '--list').split('\n')).toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('refuses a dirty tree, and --dry changes nothing', () => {
    const dir = tempRepo();
    const before = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    expect(release(dir, 'patch', '--dry')).toContain('## [0.1.1] - 2026-11-11');
    expect(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')).toBe(before);
    writeFileSync(path.join(dir, 'dirty.txt'), 'x');
    expect(() => release(dir, 'patch')).toThrow(/uncommitted/);
    expect(git(dir, 'tag', '--list')).toBe('');
  });
});
