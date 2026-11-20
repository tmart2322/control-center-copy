/** Entry helpers: construction, effective fields, Org62 row shape, Description provenance. Pure. */
import { defaultMeetingType, isNeither } from './taxonomy';
import { localDay, toIsoMs, toMs } from './time';
import type { ActivityConfig, ActivityEntry, ActivityOrigin, ActivityStatus } from './types';

/** Stable short line key (FNV-1a, base36). The data layer may assign its own `ref`. */
export function shortRef(dedupeKey: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < dedupeKey.length; i++) {
    h ^= dedupeKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, '0').slice(0, 6);
}

export const refOf = (e: Pick<ActivityEntry, 'dedupeKey' | 'ref'>): string => e.ref ?? shortRef(e.dedupeKey);

export function newEntry(p: Partial<ActivityEntry> & Pick<ActivityEntry, 'dedupeKey' | 'origin' | 'subject' | 'startsAt' | 'endsAt' | 'durationHours'>): ActivityEntry {
  return {
    operation: 'create',
    seTaskType: null,
    meetingType: '',
    whatKind: 'none',
    whatOrg62Id: null,
    whatName: null,
    customerFacing: false,
    customerRelated: false,
    description: '',
    confidence: 'Low',
    reason: '',
    flags: [],
    evidenceIds: [],
    evidence: '',
    status: 'proposed',
    excludedReason: null,
    userLockedFields: [],
    ...p,
  };
}

const ORIGIN_LABEL: Record<ActivityOrigin, string> = {
  calendar: 'calendar',
  evidence: 'evidence',
  build_estimate: 'build',
  manual: 'manual',
  chat: 'chat',
  legacy_recreate: 'legacy_fix',
  duration_backfill: 'backfill',
};

/** Matches `handoff.sf_row` Description: `CC#<id> | <source> <local date> [| CF: …] [| evidence: …]`. */
export function buildDescription(e: ActivityEntry, cfg: Pick<ActivityConfig, 'timezone'>): string {
  let d = `CC#${refOf(e)} | ${ORIGIN_LABEL[e.origin]} ${localDay(toMs(e.startsAt), cfg.timezone)}`;
  if (e.extDomains && e.extDomains.length) d += ` | CF: external attendees (${e.extDomains.join(', ')})`;
  if ((e.origin === 'evidence' || e.origin === 'build_estimate') && e.evidence) d += ` | evidence: ${e.evidence.slice(0, 200)}`;
  if (e.description) d += ` | ${e.description}`;
  return d;
}

/** The Org62 Event row for an entry (Solutions Event create payload). */
export interface Org62EventPayload {
  RecordTypeId: string;
  OwnerId: string;
  Subject: string;
  StartDateTime: string;
  EndDateTime: string;
  SE_Task_Type__c: string;
  Duration__c: number;
  WhatId: string;
  Meeting_Type__c: string;
  Description: string;
}

export function toOrg62Event(e: ActivityEntry, cfg: ActivityConfig): Org62EventPayload {
  const type = e.seTaskType ?? '';
  return {
    RecordTypeId: cfg.recordTypeId,
    OwnerId: cfg.ownerId,
    Subject: e.subject,
    StartDateTime: toIsoMs(toMs(e.startsAt)),
    EndDateTime: toIsoMs(toMs(e.endsAt)),
    SE_Task_Type__c: type,
    Duration__c: e.durationHours,
    WhatId: e.whatOrg62Id ?? '',
    Meeting_Type__c: defaultMeetingType(type, e.meetingType),
    Description: buildDescription(e, cfg),
  };
}

/** Counted entries: create operations that are not excluded, dismissed or dropped. */
export const isCounted = (e: ActivityEntry): boolean =>
  e.operation === 'create' && e.status !== 'excluded' && e.status !== 'dismissed' && e.status !== 'dropped';

export const COUNTS_AS_PENDING: readonly ActivityStatus[] = ['proposed', 'needs_input', 'approved', 'synced_to_canvas'];

/** Neither-type entries never carry a WhatId (Asset Creation builds log with no WhatId). */
export function stripWhatIfNeither(e: ActivityEntry): ActivityEntry {
  if (e.seTaskType && isNeither(e.seTaskType) && e.whatOrg62Id) {
    return { ...e, whatKind: 'none', whatOrg62Id: null, whatName: null, flags: [...e.flags, 'Neither type: logged with no WhatId'] };
  }
  return e;
}
