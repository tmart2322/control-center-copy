import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Skill files live at `skills/<name>.md` with a small YAML-ish frontmatter block
 * (same convention as SCANNER.md §4: `version` is stored on every NBA/brief row so a skill
 * upgrade can trigger regeneration as `model_or_prompt_upgrade`).
 */

export interface Skill {
  name: string;
  version: string;
  meta: Record<string, string>;
  body: string;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Default: <repo>/skills, resolved from this file; override with CC_SKILLS_DIR or the argument. */
export function skillsDir(override?: string): string {
  return override ?? process.env.CC_SKILLS_DIR ?? resolve(here, '../../../../skills');
}

export function parseSkill(name: string, raw: string): Skill {
  const meta: Record<string, string> = {};
  let body = raw;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of (m[1] ?? '').split('\n')) {
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (kv && kv[1]) meta[kv[1]] = (kv[2] ?? '').replace(/^["']|["']$/g, '').trim();
    }
  }
  const version = meta.version;
  if (!version) throw new Error(`skill ${name} has no version in its frontmatter`);
  if (meta.name && meta.name !== name) throw new Error(`skill file ${name}.md declares name ${meta.name}`);
  return { name, version, meta, body: body.trim() };
}

const cache = new Map<string, Skill>();

export function loadSkill(name: string, dir?: string): Skill {
  const d = skillsDir(dir);
  const key = `${d}::${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = readFileSync(resolve(d, `${name}.md`), 'utf8');
  const skill = parseSkill(name, raw);
  cache.set(key, skill);
  return skill;
}

export function clearSkillCache(): void {
  cache.clear();
}
