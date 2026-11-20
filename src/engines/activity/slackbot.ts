/**
 * The Slackbot work order: a canvas Slackbot executes in Org62 as written ("Execute this canvas"). A port of the
 * activity autopilot's `render_slackbot` / `sf_row` / `split_parts` (tools/activity-autopilot/ap/autoplan.py,
 * ap/handoff.py), the format Slackbot has already run. Pure: no I/O; the owner's Org62 user id and the Solutions Event
 * record type id come in as inputs (never constants in the repo).
 *
 *   ADD     one row per Org62 Event: Subject, UTC start/end, SE_Task_Type__c, Duration__c, WhatId, Meeting_Type__c
 *           (Workshop / POC only), Description: the row's note (D-66, a teammate's note: what was done, with whom,
 *           the use case, the next step), then the CC# key that ties it back to the app's row, at the end
 *   UPDATE  field fixes on existing Events (Duration__c backfills)
 *
 * The app never writes to Org62 itself: the user hands this canvas to Slackbot, and the Org62 read-back confirms it.
 */

import { CANVAS_MAX_BYTES, utf8Bytes } from '@/lib/canvas/payload';

import { isInternalTaskType } from './internal';
import { cleanNote, templateNote, withCcKey, type NoteFacts } from './note';

/** One Event to create. */
export interface WorkOrderEvent {
  /** The app's activity row id: the CC# key in the Description (how the read-back finds it again). */
  ccId: string;
  subject: string;
  /** ISO UTC instants. */
  startUtc: string;
  endUtc: string;
  taskType: string;
  durationH: number;
  /** Org62 id of the opportunity, or of the account when no single opp fits; empty: internal work (D-64), Related To empty. */
  whatId: string;
  /** Org62 Meeting_Type__c: only for Workshop / POC rows, else empty. */
  meetingType: string;
  /** D-66: the row's note, then ` · CC#<id>` (src/engines/activity/note.ts withCcKey). */
  description: string;
}

/** One field fix on an existing Event. */
export interface WorkOrderUpdate {
  recordId: string;
  field: string;
  newValue: string;
  currentValue: string;
  why: string;
}

export interface WorkOrderInput {
  ownerName: string;
  ownerOrg62Id: string;
  recordTypeId: string;
  generatedAt: string;
  events: WorkOrderEvent[];
  updates: WorkOrderUpdate[];
  /** "Control Center" plus the batch label, shown in the footnote. */
  sourceLabel: string;
  /**
   * D-55: the persona's record type and whether rows carry an SE task type. Absent: the SE's (Solutions Event, task
   * type required), and the work order is exactly the one Slackbot has always run.
   */
  logging?: { recordTypeName: string; taskTypeRequired: boolean };
}

/** Canvas cell: no pipes or newlines (they would break the table). */
export function cell(s: unknown): string {
  return String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, ' ⏎ ')
    .trim();
}

/** ISO instant → `2026-11-10T16:00:00.000Z` (Org62's StartDateTime format, exactly as Slackbot expects). */
export function sfInstant(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error(`not an instant: ${iso}`);
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

/** Org62 Meeting_Type__c for an SE task type: only workshops and proofs of concept carry one. */
export function meetingTypeFor(taskType: string | null | undefined): string {
  if (taskType === 'Workshop') return 'Data Cloud Workshop';
  if (taskType === 'POC') return 'Proof of Concept';
  return '';
}

/** Hours in Org62's 0.25 steps. */
export const quarterHours = (h: number) => Math.round(h * 4) / 4;

/** What kind of row a note describes, from its origin, task type and subject. */
function noteKind(origin: string, taskType: string, subject: string): NoteFacts['kind'] {
  if (origin === 'evidence' || origin === 'build_estimate') return 'work';
  if (taskType === 'Travel') return 'travel';
  if (/^onsite\b/i.test(subject)) return 'onsite';
  return 'meeting';
}

/**
 * The Event row for one approved activity row (the autopilot's `sf_row`). Description (D-66): the row's own note
 * (drafted by the projection, or yours), else a note made here from the row's fields; then the CC# key, last.
 */
export function eventRow(r: {
  id: string;
  subject: string;
  start: string;
  end: string;
  durationH: number;
  taskType: string;
  whatOrg62Id: string;
  origin: string;
  /** The row's note (activity row `logNote`); null: one is made from the fields below; '' (you emptied it): the key alone. */
  note?: string | null;
  /** The customer's short name, for a note made here. */
  customer?: string | null;
  externalDomains?: string[];
}): WorkOrderEvent {
  const ext = (r.externalDomains ?? []).filter(Boolean);
  const internal = !r.whatOrg62Id && isInternalTaskType(r.taskType);
  const made = () => templateNote({ kind: noteKind(r.origin, r.taskType, r.subject), subject: r.subject, taskType: r.taskType || null, internal, customer: internal ? null : (r.customer ?? null), externalDomains: ext });
  const note = r.note === '' ? '' : cleanNote(r.note ?? '', 1000) || made();
  const description = withCcKey(note, r.id);
  const startUtc = sfInstant(r.start);
  const hours = quarterHours(r.durationH);
  // D-40: exact Start/End, Duration__c in 0.25 h. Only when the hours were changed (they no longer match the row's
  // own span) does the end move to Start + hours, as the autopilot does for an edited row.
  const spanH = (Date.parse(r.end) - Date.parse(r.start)) / 3_600_000;
  const endUtc = Math.abs(spanH - r.durationH) > 0.25 ? sfInstant(new Date(Date.parse(r.start) + Math.round(hours * 60) * 60_000).toISOString()) : sfInstant(r.end);
  return { ccId: r.id, subject: r.subject, startUtc, endUtc, taskType: r.taskType, durationH: hours, whatId: r.whatOrg62Id, meetingType: meetingTypeFor(r.taskType), description };
}

const EVENT_HEADER = '|#|Object|Subject / Opportunity|StartDateTime (UTC)|EndDateTime (UTC)|SE_Task_Type__c / Role|Duration__c / Split %|WhatId / Opportunity__c|Meeting_Type__c|Description / Comments__c|';
const UPDATE_HEADER = '|#|Object|Record Id|Action / Field|New value|Current value|Why|';

/** One ADD-table Event row (numbered `n`): what Slackbot creates. */
export const eventLine = (n: number, e: WorkOrderEvent) => `|${n}|Event|${cell(e.subject)}|${e.startUtc}|${e.endUtc}|${cell(e.taskType)}|${e.durationH}|${cell(e.whatId)}|${cell(e.meetingType)}|${cell(e.description)}|`;

/** One UPDATE-table row on an Event (a Duration__c backfill). */
export const updateLine = (n: number, u: WorkOrderUpdate) => `|${n}|Event|${cell(u.recordId)}|${cell(u.field)}|${cell(u.newValue)}|${cell(u.currentValue)}|${cell(u.why)}|`;

/** The whole work order as canvas markdown. */
export function renderWorkOrder(i: WorkOrderInput): string {
  const { ownerName: who, ownerOrg62Id: owner, recordTypeId: rt } = i;
  const hours = i.events.reduce((s, e) => s + e.durationH, 0);
  const se = !i.logging || (i.logging.recordTypeName === 'Solutions Event' && i.logging.taskTypeRequired);
  const rtName = i.logging?.recordTypeName ?? 'Solutions Event';
  const out: string[] = [];
  out.push('::: {.callout}');
  out.push(`**Slackbot: this canvas is a complete work order. Execute it in Org62 for ${who} (User Id ${owner}) without asking for more context.** Rules:`);
  out.push(':::');
  out.push('');
  if (se) {
    out.push(
      `1. **ADD table, rows with Object = Event:** create an Event with RecordTypeId \`${rt}\` (Solutions Event), OwnerId \`${owner}\`, and Subject, StartDateTime, EndDateTime (UTC, exactly as given), SE_Task_Type__c, Duration__c, WhatId, Meeting_Type__c (only when given) and Description. Do not set DurationInMinutes or Remote__c.`,
    );
    out.push(
      `2. **Duplicates:** skip an Event row ONLY if ${who} already owns an Event with RecordTypeId \`${rt}\` (Solutions Event) and the same Subject and StartDateTime. "Sales Events" records (Type = AE meeting, IsChild = true) are copies of AE calendar invites, not SE time, so they are NOT duplicates. Create the row anyway.`,
    );
  } else {
    // D-55: another persona's record type (the AE's Sales Events), with or without a task type
    const task = i.logging!.taskTypeRequired ? 'SE_Task_Type__c, ' : '';
    out.push(
      `1. **ADD table, rows with Object = Event:** create an Event with RecordTypeId \`${rt}\` (${rtName}), OwnerId \`${owner}\`, and Subject, StartDateTime, EndDateTime (UTC, exactly as given), ${task}Duration__c, WhatId, Meeting_Type__c (only when given) and Description.${task ? '' : ' Leave SE_Task_Type__c empty.'} Do not set DurationInMinutes or Remote__c.`,
    );
    out.push(`2. **Duplicates:** skip an Event row ONLY if ${who} already owns an Event with RecordTypeId \`${rt}\` (${rtName}) and the same Subject and StartDateTime. Otherwise create the row.`);
  }
  // D-64: internal rows (no opportunity) carry an empty WhatId: say so, so Slackbot neither stops nor guesses one
  const internal = i.events.some((e) => !e.whatId);
  if (internal) out.push(`3. **Internal rows:** a row whose WhatId cell is empty is internal work with no opportunity: create it with WhatId (Related To) left empty. Do not look up or guess an opportunity or account for it.`);
  out.push(`${internal ? 4 : 3}. **UPDATE table:** set Field = New value on the given Record Id.`);
  out.push(`${internal ? 5 : 4}. Work through everything in batches of 25. Don't stop on an individual failure. At the end, reply with counts: created / updated / skipped as duplicate / failed (with the error for each failure).`);
  out.push('');
  out.push(`_Generated ${i.generatedAt.slice(0, 16).replace('T', ' ')} UTC by ${cell(i.sourceLabel)}. Control Center checks Org62 afterwards and flags any row that didn't land._`);
  out.push('');
  out.push(`# ADD (${i.events.length} rows · ${hours.toFixed(2)} h of activities)`);
  out.push('');
  out.push(EVENT_HEADER);
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  i.events.forEach((e, n) => out.push(eventLine(n + 1, e)));
  out.push('');
  out.push(`# UPDATE (${i.updates.length} rows)`);
  out.push('');
  out.push(UPDATE_HEADER);
  out.push('|---|---|---|---|---|---|---|');
  i.updates.forEach((u, n) => out.push(updateLine(n + 1, u)));
  return out.join('\n');
}

/**
 * Split a work order into canvas-sized parts (`limit` in UTF-8 bytes, Slack's measure) at row boundaries; a table
 * continued in the next part repeats its title (marked "continued") and header, so each part reads on its own (the
 * autopilot's `split_parts`). The logging batch splits its structured rows instead (src/server/time/batch-canvases.ts),
 * so every part keeps the rules.
 */
export function splitWorkOrder(md: string, limit = CANVAS_MAX_BYTES): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let size = 0;
  let title: string | null = null;
  let header: string[] | null = null;
  for (const ln of md.split('\n')) {
    if (ln.startsWith('# ')) {
      title = ln;
      header = null;
    }
    if (ln.startsWith('|#|')) {
      header = [ln];
      cur.push(ln);
      size += utf8Bytes(ln) + 1;
      continue;
    }
    if (header && header.length === 1 && ln.startsWith('|---')) header.push(ln);
    if (size + utf8Bytes(ln) + 1 > limit && ln.startsWith('|') && header && header.length === 2 && !ln.startsWith('|---')) {
      parts.push(cur.join('\n'));
      cur = [`${title ?? ''} (continued)`, '', ...header];
      size = cur.reduce((s, x) => s + utf8Bytes(x) + 1, 0);
    }
    cur.push(ln);
    size += utf8Bytes(ln) + 1;
  }
  if (cur.length) parts.push(cur.join('\n'));
  return parts;
}
