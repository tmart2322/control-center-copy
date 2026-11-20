/** `npm run scan:private` finds names and ids, and reports file paths and counts only, never a value. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMatchers, formatHits, isPlaceholderId, scanText, usableNames } from '@/lib/private-scan';

// Every value below is invented for the test. The id- and email-shaped ones are joined at run time, so this file
// itself stays clean in `npm run scan:private`.
const j = (...p: string[]) => p.join('');
const NAMES = { accounts: ['Zephyrine Biotech Inc.'], opportunities: ['Zephyrine - Data Cloud Expansion', 'Renewal'], people: ['Quorra Valdane', 'Quorra'], owner: ['Ignatius Testowner', j('ignatius.testowner', '@salesforce.com')], ids: [j('006Qz', '000017Abc9XYZ'), j('U07Q', 'Z4K2M9P')] };
const REAL_ISH_ORG62 = j('006Hx', '00001AbCdE2FG');
const REAL_ISH_SLACK = j('C07A', 'B12CD3E');

describe('matchers', () => {
  const m = buildMatchers(NAMES, new Set(['acme']));

  it('counts DB names as whole words, a suffix-less account name, and DB ids (15-char form too)', () => {
    const c = scanText(
      ['Met Zephyrine Biotech about Zephyrine - Data Cloud Expansion.', 'Quorra Valdane joined; Quorra alone is not enough.', 'Ignatius Testowner wrote', `opp ${j('006Qz', '000017Abc9')} and ${j('U07Q', 'Z4K2M9P')}`, 'Renewal next year', 'zephyrinebiotech is not a word match'].join('\n'),
      m,
    );
    // accounts: the full name, then its first word again inside the opportunity's name
    expect(c).toMatchObject({ accounts: 2, opportunities: 1, people: 1, owner: 1, knownIds: 2 });
  });

  it('flags id-shaped values and salesforce.com emails, but not placeholders', () => {
    const c = scanText(`${REAL_ISH_ORG62} ${REAL_ISH_SLACK} ${j('someone.real', '@salesforce.com')} user@salesforce.com 006000000000001AAA U0ME00001 C0FALCON F0PLACEHOLD1`, m);
    expect(c).toEqual({ org62Ids: 1, slackIds: 1, emails: 1 });
    expect(isPlaceholderId('F0PLACEHOLD1')).toBe(true);
    expect(isPlaceholderId('006000000000001AAA')).toBe(true);
  });

  it('counts the short forms people write for an account: its core, its d/b/a brand, a letters-into-digits head', () => {
    const accounts = ['Zephyrine Health, Inc.', "Quillfeather Physicians' Service d/b/a Marrowind Shield", 'Vantor42Health Inc.', 'Horizon Health Plans', 'Orbalt Kestrel Systems'];
    const s = buildMatchers({ accounts, opportunities: [], people: [], owner: [] });
    // live shape: a comment named the company by its core only ("X" for "X Health"), which a full-name scan missed
    expect(scanText('VDP knows it as Zephyrine.\nThe brand Marrowind Shield trades for it.\nVantor42 and Orbalt too.', s)).toEqual({ accounts: 4 });
    // a variable or slug in lower case, a word that only contains the name, an ordinary first word and an acronym: none
    expect(scanText('const zephyrine = 1; relevance; Horizon alone; OKS; vantor42', s)).toEqual({});
  });

  it('skips short names, common words, placeholders and one-word people', () => {
    expect(usableNames(['Acme', 'Bob', 'Salesforce', 'Globex Corp'], new Set(['acme']))).toEqual(['Globex Corp']);
    expect(usableNames(['Quorra', 'Quorra Valdane'], new Set(), { minWords: 2 })).toEqual(['Quorra Valdane']);
  });

  it('formats paths and counts only', () => {
    const lines = formatHits([{ path: 'docs/notes.md', counts: { accounts: 2, slackIds: 1 } }, { path: 'src/a.ts', counts: { emails: 1 }, commits: 3 }]);
    expect(lines).toEqual(['  docs/notes.md  account names 2 · Slack-id-shaped 1', '  src/a.ts       3 commits · salesforce.com emails 1']);
  });
});

describe('npm run scan:private (on a temp repo)', { timeout: 120_000 }, () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('reports the file and its counts, never the matched values, and exits 2 on hits at HEAD', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cc-private-'));
    dirs.push(dir);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'scan@example.com');
    git('config', 'user.name', 'Scan Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(dir, 'clean.md'), 'Nothing to see: ACME and U0ME00001 are placeholders.\n');
    writeFileSync(path.join(dir, 'leak.md'), `Org62 ${REAL_ISH_ORG62}, channel ${REAL_ISH_SLACK}, mail ${j('someone.real', '@salesforce.com')}\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'docs: notes');
    const tsx = path.resolve(__dirname, '../../node_modules/.bin/tsx');
    const r = spawnSync(tsx, ['--tsconfig', path.resolve(__dirname, '../../tsconfig.json'), path.resolve(__dirname, '../../scripts/private/scan.ts'), '--no-db'], { cwd: dir, encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).toBe(2);
    expect(out).toMatch(/Tracked files at HEAD: 1 with hits/);
    expect(out).toMatch(/leak\.md\s+Org62-id-shaped 1 · Slack-id-shaped 1 · salesforce\.com emails 1/);
    expect(out).toMatch(/Git history \(1 commits, every branch\): 1 path\(s\) with hits in 1 commit\(s\)/);
    expect(out).not.toContain('clean.md');
    for (const v of [REAL_ISH_ORG62, REAL_ISH_SLACK, 'someone.real']) expect(out).not.toContain(v);
  });
});
