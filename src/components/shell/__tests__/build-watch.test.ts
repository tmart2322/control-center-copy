import { describe, expect, it } from 'vitest';
import { isNewerBuild } from '../BuildWatch';
import { isStaleBuild, markStaleBuild } from '../router';

describe('BuildWatch', () => {
  it('a different server sha is a newer build; unknown shas never are', () => {
    expect(isNewerBuild('abc1234', 'def5678')).toBe(true);
    expect(isNewerBuild('abc1234', 'abc1234')).toBe(false);
    expect(isNewerBuild(null, 'def5678')).toBe(false);
    expect(isNewerBuild('abc1234', null)).toBe(false);
  });
  it('once marked stale, the router stays stale (every navigation is a full load)', () => {
    expect(isStaleBuild()).toBe(false);
    markStaleBuild();
    expect(isStaleBuild()).toBe(true);
  });
});
