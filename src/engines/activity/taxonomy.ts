/**
 * SE Task Type taxonomy and CF/CR rules (from the team's task-type canvas; port of ap/engine.py).
 * Pure data and functions. No I/O.
 */

/** [CR, CF]: 1 counts. [0,0] is "Neither": not counted. */
export const TAXONOMY: Readonly<Record<string, readonly [0 | 1, 0 | 1]>> = {
  'Account Planning': [1, 0],
  'Customer Discovery': [1, 1],
  'Marketing Support': [1, 1],
  RFx: [1, 0],
  Workshop: [1, 1],
  'Consumption Estimation': [1, 1],
  'Customer Presentation': [1, 1],
  'Dry Run': [1, 0],
  'Solution Creation': [1, 0],
  Travel: [1, 0],
  POC: [1, 1],
  'Partner Support': [1, 1],
  'Post Sale Consumption Activation': [1, 1],
  'Post Sale Adoption Support': [1, 1],
  'Red Account Support': [1, 1],
  'Post Sale Technical Product Support': [1, 1],
  'BVS - Business Case': [1, 1],
  'BVS - Proposal': [1, 1],
  'BVS - Value Hypothesis': [1, 0],
  'Business Value Assessment': [1, 1],
  Admin: [0, 0],
  'Asset Creation': [0, 0],
  Mentorship: [0, 0],
  'Personal Development': [0, 0],
  'Sales Enablement': [0, 0],
  'V2MOM Initiatives': [0, 0],
  Wellness: [0, 0],
  Localization: [0, 0],
};

/**
 * The SE Task Type picklist as the type pickers offer it (Settings-free; the SE persona's `logging.taskTypes`): the
 * customer types first (customer-facing, then customer-related), then the internal ones (Neither: Asset Creation,
 * Personal Development, …, which log with no WhatId), each group in the canvas's order.
 */
export const SE_TASK_TYPES: readonly string[] = [
  ...Object.keys(TAXONOMY).filter((t) => TAXONOMY[t]![1] === 1),
  ...Object.keys(TAXONOMY).filter((t) => TAXONOMY[t]![1] === 0 && TAXONOMY[t]![0] === 1),
  ...Object.keys(TAXONOMY).filter((t) => TAXONOMY[t]![0] === 0 && TAXONOMY[t]![1] === 0),
];

/** External attendee present: these swaps force a customer-facing type. */
export const CF_SWAP: Readonly<Record<string, string>> = {
  'Account Planning': 'Customer Discovery',
  RFx: 'Customer Presentation',
  'Dry Run': 'Customer Presentation',
  'Solution Creation': 'Workshop',
  'BVS - Value Hypothesis': 'Business Value Assessment',
  Travel: 'Customer Presentation',
};

/** Internal-only meetings never carry a CF type. */
export const INTERNAL_DOWNGRADE: Readonly<Record<string, string>> = {
  'Customer Presentation': 'Dry Run',
  'Customer Discovery': 'Account Planning',
  Workshop: 'Solution Creation',
  POC: 'Solution Creation',
};

export const MEETING_TYPE: Readonly<Record<string, string>> = {
  Workshop: 'Data Cloud Workshop',
  POC: 'Proof of Concept',
};

export const isKnownType = (t: string): boolean => Object.hasOwn(TAXONOMY, t);
export const isCR = (t: string): boolean => TAXONOMY[t]?.[0] === 1;
export const isCF = (t: string): boolean => TAXONOMY[t]?.[1] === 1;
/** Neither CF nor CR (not counted toward the 250 h). */
export const isNeither = (t: string): boolean => {
  const x = TAXONOMY[t];
  return !x || (x[0] === 0 && x[1] === 0);
};

/** Types are matched case-insensitively when read back from a canvas. */
export const TYPES_LOWER: ReadonlyMap<string, string> = new Map(Object.keys(TAXONOMY).map((t) => [t.toLowerCase(), t]));

/** D-40: Duration__c is rounded to 0.25 h. Port of `round_q` (half rounds up). */
export function roundQuarter(hours: number): number {
  return Math.floor(hours * 4 + 0.5 + 1e-9) / 4;
}

/** Workshop and POC require a Meeting_Type__c (validation rule Meeting_Type_Requirement). */
export function defaultMeetingType(type: string, given?: string | null): string {
  if (type !== 'Workshop' && type !== 'POC') return '';
  return given || MEETING_TYPE[type] || '';
}
