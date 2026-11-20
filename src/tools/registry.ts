/** Loads tools-registry/*.json manifests and builds adapters. Read-only. */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Afd360EstimatorAdapter } from './adapters/afd360-estimator';
import { expandHome, type ToolAdapter } from './adapters/base';
import { PulseFootprintAdapter } from './adapters/pulse-footprint';
import { TalkTrackAdapter } from './adapters/talk-track';
import { parseManifest, type ToolManifest } from './manifest';

export const DEFAULT_REGISTRY_DIR = path.join(process.cwd(), 'tools-registry');

export interface LoadManifestsOptions {
  /** Leave out tools whose local folder (`cwd` / `repoPath`) is not on this machine (a teammate without the sibling repos). */
  onlyAvailable?: boolean;
  /** Injectable for tests. */
  exists?: (p: string) => boolean;
}

export async function loadManifests(dir: string = DEFAULT_REGISTRY_DIR, opts: LoadManifestsOptions = {}): Promise<ToolManifest[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; // no registry folder: no tools
    throw e;
  }
  const files = names.filter((f) => f.endsWith('.json')).sort();
  const out: ToolManifest[] = [];
  const ids = new Set<string>();
  for (const f of files) {
    const m = parseManifest(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
    if (ids.has(m.id)) throw new Error(`duplicate manifest id ${m.id} (${f})`);
    ids.add(m.id);
    if (opts.onlyAvailable && !manifestAvailability(m, opts.exists).available) continue;
    out.push(m);
  }
  return out;
}

/** The local folders a tool runs in: `lifecycle.cwd`, a cli `launch.cwd`, a session/skill `launch.repoPath` (as written, `~` kept). */
export function manifestDirs(m: ToolManifest): string[] {
  const l = m.launch;
  const dirs = [m.lifecycle?.cwd, l.kind === 'cli' ? l.cwd : l.kind === 'claude_session' || l.kind === 'skill' ? l.repoPath : undefined];
  return [...new Set(dirs.filter((d): d is string => !!d))];
}

/** Whether every folder the tool needs exists here. `missing` lists the absent ones as written in the manifest. */
export function manifestAvailability(m: ToolManifest, exists: (p: string) => boolean = existsSync): { available: boolean; missing: string[] } {
  const missing = manifestDirs(m).filter((d) => !exists(expandHome(d)));
  return { available: missing.length === 0, missing };
}

/** Adapter for manifests that run in-app. `claude_session` / `skill` kinds go through claude-launch instead (returns undefined). */
export function createAdapter(m: ToolManifest): ToolAdapter | undefined {
  switch (m.id) {
    case 'talk-track': return new TalkTrackAdapter(m);
    case 'pulse-footprint': return new PulseFootprintAdapter(m);
    case 'afd360-estimator': return new Afd360EstimatorAdapter(m);
    default: return undefined;
  }
}
