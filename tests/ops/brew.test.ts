import { describe, expect, it } from 'vitest';
import * as mjs from '../../scripts/ops/lib/brew.mjs';
import { defaultPath } from '../../scripts/ops/lib/plist.mjs';
import { scannerEnv } from '../../src/llm/claude-env';
import * as ts from '../../src/ops/brew';
import { PG17_BIN } from '../../src/ops/paths';
import { PYTHON_CANDIDATES } from '../../src/reauth/handlers';

const noBrew = () => {
  throw Object.assign(new Error('spawn brew ENOENT'), { code: 'ENOENT' });
};
const only = (...paths: string[]) => (p: string) => paths.includes(p);

// The app (TS) and the ops scripts (.mjs) carry twin resolvers; both must behave the same.
describe.each([
  ['src/ops/brew.ts', ts],
  ['scripts/ops/lib/brew.mjs', mjs],
] as const)('%s resolveBrewPrefix', (_name, m) => {
  it('HOMEBREW_PREFIX wins over brew and the filesystem', () => {
    let ran = false;
    const prefix = m.resolveBrewPrefix({ env: { HOMEBREW_PREFIX: '/custom/brew/' }, run: () => ((ran = true), '/opt/homebrew\n'), exists: () => true });
    expect(prefix).toBe('/custom/brew');
    expect(ran).toBe(false);
  });

  it('uses `brew --prefix` output when the env is unset', () => {
    expect(m.resolveBrewPrefix({ env: {}, run: () => '/usr/local\n', exists: only('/opt/homebrew/bin/brew') })).toBe('/usr/local');
    expect(m.resolveBrewPrefix({ env: { HOMEBREW_PREFIX: '  ' }, run: () => '/opt/homebrew\n', exists: () => false })).toBe('/opt/homebrew');
  });

  it('brew missing or odd output: the first well-known prefix that has bin/brew (Intel /usr/local)', () => {
    expect(m.resolveBrewPrefix({ env: {}, run: noBrew, exists: only('/usr/local/bin/brew') })).toBe('/usr/local');
    expect(m.resolveBrewPrefix({ env: {}, run: () => 'Error: not a prefix', exists: only('/usr/local/bin/brew') })).toBe('/usr/local');
    expect(m.resolveBrewPrefix({ env: {}, run: noBrew, exists: only('/opt/homebrew/bin/brew', '/usr/local/bin/brew') })).toBe('/opt/homebrew');
  });

  it('nothing found: /opt/homebrew', () => {
    expect(m.resolveBrewPrefix({ env: {}, run: noBrew, exists: () => false })).toBe('/opt/homebrew');
  });

  it('the Postgres 17 bin derives from the prefix', () => {
    expect(m.pg17BinFor('/usr/local')).toBe('/usr/local/opt/postgresql@17/bin');
    expect(m.pg17BinFor('/opt/homebrew')).toBe('/opt/homebrew/opt/postgresql@17/bin');
    expect(m.pg17Bin()).toBe(m.pg17BinFor(m.brewPrefix()));
  });
});

describe('callers use the detected prefix', () => {
  it('PG17_BIN and the python candidates follow brewPrefix()', () => {
    expect(PG17_BIN).toBe(ts.pg17BinFor(ts.brewPrefix()));
    expect(PYTHON_CANDIDATES).toContain(`${ts.brewPrefix()}/bin/python3`);
    expect(PYTHON_CANDIDATES).toContain('/usr/local/bin/python3');
    expect(new Set(PYTHON_CANDIDATES).size).toBe(PYTHON_CANDIDATES.length);
  });

  it('the scanner PATH has the prefix bin, keeps /usr/local/bin and has no duplicates', () => {
    const path = scannerEnv({}, { HOME: '/Users/someone' } as unknown as NodeJS.ProcessEnv).PATH!.split(':');
    expect(path).toEqual(expect.arrayContaining([`${ts.brewPrefix()}/bin`, '/usr/local/bin', '/Users/someone/.local/bin']));
    expect(new Set(path).size).toBe(path.length);
  });

  it('the LaunchAgent PATH has the prefix bin and its Postgres, keeps /usr/local/bin and dedupes', () => {
    const intel = defaultPath({ home: '/Users/me', nodeDir: '/usr/local/bin', prefix: '/usr/local' }).split(':');
    expect(intel.slice(0, 2)).toEqual(['/usr/local/bin', '/usr/local/opt/postgresql@17/bin']);
    expect(intel.filter((p) => p === '/usr/local/bin')).toHaveLength(1);
    const arm = defaultPath({ home: '/Users/me', nodeDir: '/opt/homebrew/bin', prefix: '/opt/homebrew' }).split(':');
    expect(arm).toEqual(expect.arrayContaining(['/opt/homebrew/bin', '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/bin', '/Users/me/.local/bin']));
    expect(new Set(arm).size).toBe(arm.length);
  });
});
