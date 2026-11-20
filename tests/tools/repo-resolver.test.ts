import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePortsMd, resolveRepos, tokenize } from '@/tools/repo-resolver';

let root: string;
const P = (...s: string[]) => path.join(root, ...s);

function dir(rel: string, readme?: string) {
  mkdirSync(P(rel), { recursive: true });
  if (readme) writeFileSync(P(rel, 'README.md'), readme);
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'cc-repos-'));
  dir('greg-playground', '# Pulse UI\nReconstructs a customer data footprint from Pulse.');
  dir('talk-track', '# talk-track\nDemo talk-track generator.');
  dir('afd360-estimates', 'estimate data');
  dir('hc-apps', '# hc-apps\nHealthcare headless demos.');
  dir('hc-apps-worktrees/headless-pega-globex/headless/payer');
  dir('hc-apps-worktrees/headless-pega/headless/payer');
  dir('ls-apps', '# ls-apps\nLife sciences demos with headless HCP app.');
  dir('vdp-app', '# VDP\nVDP studio');
  dir('claude-usage-metrics', 'usage dashboard');
  dir('.hidden');
  writeFileSync(
    P('PORTS.md'),
    [
      '| Port | App | Path | Bookmark | Notes |',
      '|------|-----|------|----------|-------|',
      `| 4318 | pulse-footprint (greg-playground) | \`${P('greg-playground')}\` | http://localhost:4318 | Next.js |`,
      `| 4320 | talk-track | \`${P('talk-track')}\` | http://localhost:4320 | Local demo talk-track generator |`,
      `| 4323 | headless-payer-hc (Healthcare Payer) | \`${P('hc-apps/headless/payer')}\` | http://localhost:4323 | Next.js Headless 360 Payer demo |`,
      `| 4344 | headless-payer Pega skin, Globex brand | \`${P('hc-apps-worktrees/headless-pega-globex/headless/payer')}\` | http://localhost:4344 | Branch me/headless-pega-globex |`,
      `| 4322 | hcp-360-app | \`${P('ls-apps/hcp-360-app')}\` | http://localhost:4322 | Headless 360 field-sales portal |`,
    ].join('\n'),
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const opts = () => ({ projectsDir: root });

describe('tokenize', () => {
  it('drops stop words and short tokens', () => {
    expect(tokenize('Package the Beacon footprint for AB')).toEqual(['beacon', 'footprint']);
  });
});

describe('parsePortsMd', () => {
  it('reads rows with ~ expansion', () => {
    const rows = parsePortsMd('| 4320 | talk-track | `~/Projects/talk-track` | x | note |', '/home/u');
    expect(rows).toEqual([{ app: 'talk-track', path: '/home/u/Projects/talk-track', notes: 'note' }]);
  });
});

describe('resolveRepos', () => {
  it('"package Pulse footprint" -> greg-playground first', async () => {
    const r = await resolveRepos({ text: 'package Pulse footprint' }, opts());
    expect(r[0]?.path).toBe(P('greg-playground'));
    expect(r[0]?.reasons.join(' ')).toMatch(/PORTS\.md|README/);
  });

  it('tool name alias wins even with vague text', async () => {
    const r = await resolveRepos({ toolName: 'pulse-footprint', text: 'ship it' }, opts());
    expect(r[0]?.path).toBe(P('greg-playground'));
    expect(r[0]?.reasons[0]).toMatch(/maps to greg-playground/);
  });

  it('"<customer> headless demo" -> the customer worktree, then hc-apps', async () => {
    const r = await resolveRepos({ account: 'Globex', text: 'headless demo' }, opts());
    expect(r[0]?.path).toBe(P('hc-apps-worktrees', 'headless-pega-globex'));
    expect(r[0]?.kind).toBe('worktree');
    expect(r[0]?.parent).toBe('hc-apps');
    expect(r.map((c) => c.name)).toContain('hc-apps');
    expect(r[0]!.score).toBeGreaterThan(r.find((c) => c.name === 'headless-pega')!.score);
  });

  it('a customer with no worktree falls back to a headless repo, not the globex worktree', async () => {
    const r = await resolveRepos({ account: 'Acme', text: 'headless demo' }, opts());
    expect(r[0]?.name).not.toBe('headless-pega-globex');
    expect(r.length).toBeGreaterThan(0);
  });

  it('talk track keywords -> talk-track', async () => {
    const r = await resolveRepos({ keywords: ['talk', 'track'], account: 'Olivewood' }, opts());
    expect(r[0]?.path).toBe(P('talk-track'));
  });

  it('estimate tool -> afd360-estimates', async () => {
    expect((await resolveRepos({ toolName: 'afd360-estimate-new' }, opts()))[0]?.name).toBe('afd360-estimates');
  });

  it('returns nothing for empty or unmatched hints, ignores hidden dirs', async () => {
    expect(await resolveRepos({}, opts())).toEqual([]);
    expect(await resolveRepos({ text: 'zzzqqq nothing' }, opts())).toEqual([]);
    expect((await resolveRepos({ text: 'hidden' }, opts())).some((c) => c.name === '.hidden')).toBe(false);
  });

  it('is deterministic and respects limit', async () => {
    const a = await resolveRepos({ text: 'headless demo' }, { ...opts(), limit: 2 });
    const b = await resolveRepos({ text: 'headless demo' }, { ...opts(), limit: 2 });
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(2);
  });

  it('works without PORTS.md', async () => {
    const r = await resolveRepos({ toolName: 'talk-track' }, { projectsDir: root, portsMdPath: P('missing.md') });
    expect(r[0]?.name).toBe('talk-track');
  });
});
