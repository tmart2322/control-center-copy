/**
 * Activity logging as the persona configures it (D-55): which Org62 Event record type rows are logged with, whether
 * a row needs an SE task type, the quarter's hours target and how overlapping meetings log. Pure; the SE's profile is
 * what the engine did before personas (Solutions Event, task type required, 250 h), with the D-18 amendment's default
 * (every accepted meeting logs). No hour caps since 2026-11-14 (the owner's direction: "grounded in truth").
 */
import type { PersonaLogging, ResolvedPersona } from '@/personas/types';
import { SE_PERSONA } from '@/personas/se';

/**
 * Org62 Event record types by DeveloperName → Name (read-only RecordType query, 2026-11-11). The mirror stores the
 * Name (`org62_events.record_type_name`), so a persona that names its type by DeveloperName is matched through this.
 */
export const RECORD_TYPE_NAMES: Readonly<Record<string, string>> = { SalesEvents: 'Sales Events', EBU_Sales_Engineer_Events: 'Solutions Event' };

export interface LoggingProfile {
  /** How the record type is looked up in Org62 (`RecordType.<field> = '<value>'`). */
  recordType: PersonaLogging['recordType'];
  /** The record type's Name, as the Org62 mirror stores it ("Solutions Event", "Sales Events"). */
  recordTypeName: string;
  taskTypeRequired: boolean;
  hoursTargetH: number | null;
  /** How overlapping meetings log when Settings ▸ Time has no saved choice (D-18 amended). */
  overlaps: PersonaLogging['overlaps'];
  /** The task types the type pickers offer (empty: the persona logs none). */
  taskTypes: string[];
  /** D-64: work for no customer is proposed as internal-only activity. */
  internalActivity: boolean;
}

export function loggingProfile(p?: Pick<ResolvedPersona, 'logging'> | null): LoggingProfile {
  const l = p?.logging ?? SE_PERSONA.logging;
  const recordTypeName = l.recordType.field === 'Name' ? l.recordType.value : (RECORD_TYPE_NAMES[l.recordType.value] ?? l.recordType.value);
  return {
    recordType: { ...l.recordType },
    recordTypeName,
    taskTypeRequired: l.taskTypeRequired,
    hoursTargetH: l.hoursTargetH,
    overlaps: l.overlaps ?? 'log_all_accepted',
    taskTypes: [...(l.taskTypes ?? [])],
    internalActivity: l.internalActivity === true,
  };
}

/** The SE's logging profile: the default wherever no persona is passed (as before personas). */
export const SE_LOGGING: LoggingProfile = loggingProfile(null);

/** The quarter's hours target as the persona has it: a persona with no target (the AE) shows none (0 = no target). */
export function personaTargetH(p: Pick<ResolvedPersona, 'logging'> | null | undefined, storedH: number): number {
  return p && p.logging.hoursTargetH === null ? 0 : storedH;
}

/** `cc.meta` with the quarter target the persona has (for payloads that read the target from the meta). */
export function withPersonaTarget<M extends { quarter?: { targetH: number } }>(meta: M, p: Pick<ResolvedPersona, 'logging'> | null | undefined): M {
  return meta.quarter && p && p.logging.hoursTargetH === null ? { ...meta, quarter: { ...meta.quarter, targetH: 0 } } : meta;
}
