import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseManifest } from '@/tools/manifest';
import { loadManifests, manifestAvailability, manifestDirs } from '@/tools/registry';
import { resolveRepos } from '@/tools/repo-resolver';
import { readManifestFile } from './helpers/mock-servers';

// A teammate's Mac has no ~/Projects siblings: registry entries whose folder is missing are left out (or reported as
// such), and the repo resolver returns no candidates instead of throwing.
const REG = path.resolve(__dirname, '../../tools-registry');
const home = os.homedir();
let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'cc-registry-local-'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('tool registry on a machine without the sibling repos', () => {
  it('manifestDirs lists lifecycle.cwd, cli cwd and session repoPath', () => {
    expect(manifestDirs(parseManifest(readManifestFile('talk-track')))).toEqual(['~/Projects/talk-track']);
    expect(manifestDirs(parseManifest(readManifestFile('afd360-estimator')))).toEqual(['~/.claude/skills/afd360-estimator']);
    expect(manifestDirs(parseManifest(readManifestFile('afd360-estimate-new')))).toEqual(['~/Projects/afd360-estimates']);
  });

  it('manifestAvailability expands ~ and names the missing folders', () => {
    const m = parseManifest(readManifestFile('pulse-footprint'));
    expect(manifestAvailability(m, () => false)).toEqual({ available: false, missing: ['~/Projects/greg-playground'] });
    expect(manifestAvailability(m, (p) => p === path.join(home, 'Projects', 'greg-playground'))).toEqual({ available: true, missing: [] });
  });

  it('loadManifests({ onlyAvailable }) skips entries whose folder is missing; the default still loads all', async () => {
    expect(await loadManifests(REG, { onlyAvailable: true, exists: () => false })).toEqual([]);
    const some = await loadManifests(REG, { onlyAvailable: true, exists: (p) => p === path.join(home, 'Projects', 'talk-track') });
    expect(some.map((m) => m.id)).toEqual(['talk-track']);
    expect((await loadManifests(REG, { exists: () => false })).length).toBe(4);
  });

  it('a missing registry folder is no tools, not an error', async () => {
    await expect(loadManifests(path.join(tmp, 'no-registry'))).resolves.toEqual([]);
  });
});

describe('repo resolver without ~/Projects or PORTS.md', () => {
  it('missing projects dir: no candidates', async () => {
    const r = await resolveRepos({ text: 'package Pulse footprint', toolName: 'pulse-footprint' }, { projectsDir: path.join(tmp, 'no-projects') });
    expect(r).toEqual([]);
  });

  it('projects dir present but no PORTS.md: still ranks by name, no throw', async () => {
    const projects = path.join(tmp, 'Projects');
    for (const d of ['talk-track', 'greg-playground']) mkdirSync(path.join(projects, d), { recursive: true });
    writeFileSync(path.join(projects, 'talk-track', 'README.md'), '# talk-track\nDemo talk-track generator.');
    const r = await resolveRepos({ toolName: 'talk-track' }, { projectsDir: projects });
    expect(r[0]?.name).toBe('talk-track');
    expect(r.flatMap((c) => c.reasons).some((x) => x.includes('PORTS.md'))).toBe(false);
  });

  it('a projects path that is a file, and a PORTS.md path that is a folder, are tolerated', async () => {
    const file = path.join(tmp, 'not-a-dir');
    writeFileSync(file, 'x');
    await expect(resolveRepos({ text: 'talk track' }, { projectsDir: file })).resolves.toEqual([]);
    await expect(resolveRepos({ text: 'talk track' }, { projectsDir: path.join(tmp, 'Projects'), portsMdPath: tmp })).resolves.toEqual(expect.any(Array));
  });
});
