/**
 * Switching persona (D-55), shared by the db and mock DataSources' `patchSettings('persona')` so both do exactly the
 * same thing, in the one change set Undo reverts:
 *   - the starter priority policy of the new role (`ROLE_POLICIES[priorityTemplate]` through `rolePolicy`) becomes a
 *     NEW policy version; the previous one stays in the history and Undo puts it back;
 *   - the Org62 record-type cache is cleared (Settings ▸ Time ▸ Logging `org62RecordTypeId`, and every
 *     `cc.logging/org62_record_type` kv key): the next batch looks up the new role's record type.
 * A level change or any other edit keeps the policy as it is. Nothing is deleted.
 */
import type { PriorityPolicy, Settings, TimeSettings } from '@/contract';
import { personaOf, type ResolvedPersona } from '@/personas';
import { rolePolicy } from '@/server/datasource/db/bootstrap';

export function personaSwitched(prev: Pick<Settings, 'persona'>, next: Pick<Settings, 'persona'>): boolean {
  return (prev.persona?.id ?? 'se') !== (next.persona?.id ?? 'se');
}

/** The new role's starter policy as the next version of the current one (same policy id, version + 1). */
export function reseededPolicy(prev: PriorityPolicy, persona: ResolvedPersona, at: string): { policy: PriorityPolicy; obligation: number } {
  const { policy, obligation } = rolePolicy(persona.priorityTemplate, at, prev.id);
  return { policy: { ...policy, version: prev.version + 1, note: `Role pack: ${policy.name} (switched to ${persona.label})` }, obligation };
}

/** Time settings with the record type override cleared, or null when there is none to clear. */
export function timeWithoutRecordType(time: TimeSettings): TimeSettings | null {
  if (!time.logging?.org62RecordTypeId) return null;
  return { ...time, version: time.version + 1, logging: { ...time.logging, org62RecordTypeId: null } };
}

/** The persona the next settings resolve to (what the reseed reads). */
export const nextPersona = (next: Settings): ResolvedPersona => personaOf(next);
