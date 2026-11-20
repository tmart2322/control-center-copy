// KEY=VALUE env file reader (mirror of src/ops/envfile.ts, dependency-free so launchd can use it).
import { readFileSync, statSync } from 'node:fs';

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function readEnvFile(path) {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function fileMode(path) {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

const SECRET_KEY = /(TOKEN|SECRET|PASSWORD|COOKIE|API_?KEY|\bPAT\b|PASS)/i;

/** Values of secret-looking keys (8+ chars), used to scrub child output before it hits a log file. */
export function secretValues(env) {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_KEY.test(k) && v.length >= 8)
    .map(([, v]) => v);
}
