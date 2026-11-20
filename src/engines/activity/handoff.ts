/**
 * Handoff artifacts (port of ap/handoff.py): the Slackbot prompt, the Data Loader CSV and the
 * pre-filled Lightning "New Event" link. These are OUTBOUND DRAFTS only; nothing here writes anywhere.
 */
import type { Org62EventPayload } from './entry';

export const INSERT_COLS = [
  'RecordTypeId',
  'OwnerId',
  'Subject',
  'StartDateTime',
  'EndDateTime',
  'SE_Task_Type__c',
  'Duration__c',
  'WhatId',
  'Meeting_Type__c',
  'Description',
] as const;

export interface HandoffConfig {
  ownerId: string;
  recordTypeId: string;
  lightningHost: string;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function lightningLink(row: Org62EventPayload, cfg: HandoffConfig): string {
  const vals: [string, string][] = [
    ['Subject', row.Subject],
    ['StartDateTime', row.StartDateTime],
    ['EndDateTime', row.EndDateTime],
    ['SE_Task_Type__c', row.SE_Task_Type__c],
    ['Duration__c', String(row.Duration__c)],
  ];
  if (row.WhatId) vals.push(['WhatId', row.WhatId]);
  if (row.Meeting_Type__c) vals.push(['Meeting_Type__c', row.Meeting_Type__c]);
  const dfv = vals.map(([k, v]) => `${k}=${enc(v)}`).join(',');
  return `${cfg.lightningHost}/lightning/o/Event/new?recordTypeId=${cfg.recordTypeId}&defaultFieldValues=${dfv}`;
}

export function slackbotPrompt(rows: readonly Org62EventPayload[], cfg: HandoffConfig): string {
  const head =
    `Create these Org62 Events for me (owner ${cfg.ownerId}), Record Type **Solutions Event** (${cfg.recordTypeId}). ` +
    'For each row set Subject, StartDateTime and EndDateTime (UTC as given), SE_Task_Type__c, Duration__c (Time(Hrs)), WhatId (Related To) and Meeting_Type__c when present. ' +
    'Do not set DurationInMinutes or Remote__c. Before creating anything, check for an existing Event of mine with the same Subject and start, skip duplicates, show me the final list and wait for my "yes".\n\n' +
    '| # | Subject | Start (UTC) | End (UTC) | SE Task Type | Time(Hrs) | WhatId | Meeting Type |\n|---|---|---|---|---|---|---|---|';
  const lines = [head];
  rows.forEach((r, i) =>
    lines.push(
      `| ${i + 1} | ${r.Subject.replace(/\|/g, '/')} | ${r.StartDateTime.slice(0, 16)} | ${r.EndDateTime.slice(0, 16)} | ${r.SE_Task_Type__c} | ${r.Duration__c} | ${r.WhatId || '(none)'} | ${r.Meeting_Type__c} |`,
    ),
  );
  return lines.join('\n');
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function batchCsv(rows: readonly Org62EventPayload[]): string {
  const out = [INSERT_COLS.join(',')];
  for (const r of rows) out.push(INSERT_COLS.map((c) => csvCell(r[c])).join(','));
  return out.join('\n') + '\n';
}

/** Slackbot prompts in chunks of 20 (same as the autopilot). */
export const promptChunks = (rows: readonly Org62EventPayload[], cfg: HandoffConfig, size = 20): string[] => {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += size) out.push(slackbotPrompt(rows.slice(i, i + size), cfg));
  return out;
};
