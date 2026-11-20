/** Canonical JSON (sorted keys) and its sha256: the payload hash in every delivery record and audit line. */
import { createHash } from 'node:crypto';

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

/** Short form for log-safe detail strings ("sha256:1a2b3c4d5e6f"). */
export const shortHash = (h: string) => h.slice(0, 'sha256:'.length + 12);
