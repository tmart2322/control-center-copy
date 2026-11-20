/**
 * D-70: the field map, per (record kind × destination): which fields a write carries and a read-back compares, their
 * labels and how a value reads. A new destination or kind is a new entry here (plus its transport), never a table.
 * Pure.
 */
import type { LandingDestination, RecordKind, UseCaseField } from '@/contract';

export interface FieldDef {
  /** The destination's own field name (Org62 API name, VDP wire field). */
  field: string;
  label: string;
  /** How a value reads ("2 h", "50%"); identity when absent. */
  fmt?: (v: string) => string;
}

const hours = (v: string) => (v === '' || v === '(blank)' ? v : /^\d+(\.\d+)?$/.test(v) ? `${Number(v)} h` : v);
const pct = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? `${Number(v)}%` : v);

export const FIELD_MAP: Readonly<Record<`${RecordKind}:${LandingDestination}`, readonly FieldDef[]>> = {
  'activity_event:org62': [
    { field: 'Subject', label: 'Subject' },
    { field: 'StartDateTime', label: 'Start' },
    { field: 'EndDateTime', label: 'End' },
    { field: 'SE_Task_Type__c', label: 'Task type' },
    { field: 'Duration__c', label: 'Duration', fmt: hours },
    { field: 'WhatId', label: 'Related to' },
    { field: 'Meeting_Type__c', label: 'Meeting type' },
    { field: 'Description', label: 'Description' },
  ],
  'activity_event:vdp': [],
  'deal_contribution:org62': [
    { field: 'Opportunity__c', label: 'Opportunity' },
    { field: 'Opportunity_Role__c', label: 'Role' },
    { field: 'Split_Percentage__c', label: 'Split', fmt: pct },
    { field: 'Comments__c', label: 'Comment' },
  ],
  'deal_contribution:vdp': [],
  'use_case:org62': [
    { field: 'Use_Case_Name__c', label: 'Name' },
    { field: 'Opportunity__c', label: 'Opportunity' },
    { field: 'Account__c', label: 'Account' },
    { field: 'Product__c', label: 'Product' },
    { field: 'Use_Case_Agent_Type__c', label: 'Agent type' },
    { field: 'Entitlement_Leveraged__c', label: 'Entitlement' },
    { field: 'Stage__c', label: 'Stage' },
    { field: 'Go_Live_Date__c', label: 'Go-Live' },
    { field: 'Business_Problem_Solved__c', label: 'Business problem' },
    { field: 'Business_Problem_KPIs__c', label: 'KPIs' },
    { field: 'Notes__c', label: 'Notes' },
  ],
  'use_case:vdp': [
    { field: 'title', label: 'Name' },
    { field: 'track', label: 'Track' },
    { field: 'execution_phase', label: 'Phase' },
    { field: 'execution_target_date', label: 'Target date' },
  ],
  'asset:org62': [],
  'asset:vdp': [
    { field: 'title', label: 'Title' },
    { field: 'url', label: 'Link' },
    { field: 'type', label: 'Type' },
  ],
};

/** The definition of one field (a field the map doesn't name reads as itself). */
export function fieldDef(kind: RecordKind, dest: LandingDestination, field: string): FieldDef {
  return FIELD_MAP[`${kind}:${dest}`].find((f) => f.field === field) ?? { field, label: field.replace(/__c$/, '').replace(/_/g, ' ') };
}

/** A value as it reads ("2 h"); null and '' read as "(empty)". */
export function fieldValue(kind: RecordKind, dest: LandingDestination, field: string, v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  const d = fieldDef(kind, dest, field);
  return d.fmt ? d.fmt(v) : v;
}

/**
 * The use-case fields compared across Org62 and VDP, in shared terms (D-67's mapping): each side's wire field. The VDP
 * side is null where VDP's update_use_case can't write it (a use case's track).
 */
export const UC_COMPARED: Readonly<Record<UseCaseField, { label: string; org62: string; vdp: string | null }>> = {
  name: { label: 'Name', org62: 'Use_Case_Name__c', vdp: 'title' },
  product: { label: 'Product', org62: 'Product__c', vdp: null },
  stage: { label: 'Stage', org62: 'Stage__c', vdp: 'execution_phase' },
  goLive: { label: 'Go-Live', org62: 'Go_Live_Date__c', vdp: 'execution_target_date' },
};

/** The shared field of an Org62 Use_Case__c field (null: not compared). */
export function ucFieldOf(org62Field: string): UseCaseField | null {
  for (const [k, v] of Object.entries(UC_COMPARED)) if (v.org62 === org62Field) return k as UseCaseField;
  return null;
}

/**
 * Event update fields, as the re-derive may name them: Org62's API name, or the app's word for it. Null: no canvas
 * UPDATE row writes that field.
 */
const EVENT_FIELD_ALIASES: Readonly<Record<string, string>> = {
  duration__c: 'Duration__c',
  duration: 'Duration__c',
  durationh: 'Duration__c',
  hours: 'Duration__c',
  se_task_type__c: 'SE_Task_Type__c',
  tasktype: 'SE_Task_Type__c',
  task_type: 'SE_Task_Type__c',
  type: 'SE_Task_Type__c',
  whatid: 'WhatId',
  opp: 'WhatId',
  oppid: 'WhatId',
  opportunity: 'WhatId',
  subject: 'Subject',
  description: 'Description',
  startdatetime: 'StartDateTime',
  enddatetime: 'EndDateTime',
  meeting_type__c: 'Meeting_Type__c',
  meetingtype: 'Meeting_Type__c',
};
export function eventUpdateField(f: string): string | null {
  return EVENT_FIELD_ALIASES[f.trim().toLowerCase()] ?? null;
}
