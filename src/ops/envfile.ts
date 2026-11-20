/** KEY=VALUE env file reader. Values are returned to callers but never logged here. */
import { readFileSync, statSync } from 'node:fs';

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

export function readEnvFile(path: string): Record<string, string> | null {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Octal permission bits (e.g. 0o600) or null when the file is missing. */
export function fileMode(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}
