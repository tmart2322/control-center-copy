/**
 * Contract ids ↔ database keys.
 *
 * Contract ids are opaque strings. Seeds use readable ids ("w_acme_build"); Postgres uses uuid keys (and
 * bigserial for append-only logs). The mapping is deterministic so a seed loads idempotently and the
 * parity tests can translate mock ids into db ids:
 *   - uuid tables:      uuidFor('w_acme_build')  → a name-based (v5-style, SHA-1) uuid; real uuids pass through
 *   - bigserial tables: bigintFor('job_1')       → a stable positive integer below 2^47 (far above any sequence)
 *   - stable keys:      policy rule ids stay text (priority_policy_rules.rule_key)
 */
import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Namespace for seed ids (a fixed random uuid, bytes only matter for collisions with other namespaces). */
const NAMESPACE = Buffer.from('6f1c2a4e9b7d4c1a8e3f5b2d7a9c0e14', 'hex');

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** RFC 4122 name-based uuid (version 5) for a seed id; real uuids pass through unchanged. */
export function uuidFor(id: string): string {
  if (isUuid(id)) return id.toLowerCase();
  const h = createHash('sha1').update(NAMESPACE).update(id, 'utf8').digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuidOrNull(id: string | null | undefined): string | null {
  return id ? uuidFor(id) : null;
}

/** Stable bigserial key for a seed id (numeric strings pass through). 2^40 .. 2^47 keeps clear of sequences. */
export function bigintFor(id: string): number {
  if (/^\d+$/.test(id)) return Number(id);
  const h = createHash('sha1').update(NAMESPACE).update(id, 'utf8').digest();
  return 2 ** 40 + (h.readUIntBE(0, 6) % (2 ** 47 - 2 ** 40));
}

/** Deterministic text key (dedupe keys, idempotency keys). */
export function hashKey(...parts: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}
