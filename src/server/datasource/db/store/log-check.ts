/**
 * The Org62 check: what the app handed to Slackbot that Org62 doesn't show, and logged rows whose Org62 Event
 * disagrees with the app. Read-only and derived on every read (the Org62 read-back itself runs with the org62 scan),
 * so it holds in both logging modes and never goes stale.
 *
 *   not_in_org62      handed to a canvas more than `graceHours` ago and still no matching Org62 Event
 *   hours_differ      the Org62 Event's Duration__c (or its length) differs from the app's hours by 15 min or more
 *   what_differs      the Org62 Event is on another WhatId than the app's row
 *   deleted_in_org62  the matched Org62 Event was deleted there
 */
import { sql } from 'drizzle-orm';

import type { DbOrTx } from '@/db/client';

import { localDate } from './log-batch';

export type LogDiscrepancyKind = 'not_in_org62' | 'hours_differ' | 'what_differs' | 'deleted_in_org62';

export interface LogDiscrepancy {
  id: string;
  date: string;
  description: string;
  kind: LogDiscrepancyKind;
  detail: string;
  org62EventId?: string;
}

type Row = {
  id: string;
  subject: string | null;
  description: string | null;
  starts_at: Date | string;
  duration_hours: string | number;
  what_org62_id: string | null;
  synced_to_canvas_at: Date | string | null;
  e_id: string | null;
  e_duration: string | number | null;
  e_starts: Date | string | null;
  e_ends: Date | string | null;
  e_what: string | null;
  e_deleted: Date | string | null;
};

const ms = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();
const id15 = (s: string | null) => (s ?? '').slice(0, 15);

export async function logDiscrepancies(db: DbOrTx, userId: string, o: { now: Date; timezone: string; graceHours?: number }): Promise<LogDiscrepancy[]> {
  const grace = (o.graceHours ?? 24) * 3_600_000;
  const rows = (
    await db.execute<Row>(sql`
      select a.id, a.subject, a.description, a.starts_at, a.duration_hours, a.what_org62_id, a.synced_to_canvas_at,
             e.org62_event_id as e_id, e.duration_field as e_duration, e.starts_at as e_starts, e.ends_at as e_ends,
             e.what_org62_id as e_what, e.deleted_upstream_at as e_deleted
        from activity_entries a left join org62_events e on e.id = a.org62_event_row_id
       where a.owner_user_id = ${userId}
         and (a.status = 'synced_to_canvas' or (a.org62_event_row_id is not null and a.origin <> 'manual'))
       order by a.starts_at`)
  ).rows;
  const out: LogDiscrepancy[] = [];
  for (const r of rows) {
    const base = { id: r.id, date: localDate(r.starts_at, o.timezone), description: (r.description ?? r.subject ?? '').slice(0, 120) };
    if (!r.e_id) {
      if (r.synced_to_canvas_at && o.now.getTime() - ms(r.synced_to_canvas_at) > grace) {
        const hours = Math.round((o.now.getTime() - ms(r.synced_to_canvas_at)) / 3_600_000);
        out.push({ ...base, kind: 'not_in_org62', detail: `Handed to a canvas ${hours} h ago and not in Org62 yet: check Slackbot's reply on that canvas` });
      }
      continue;
    }
    if (r.e_deleted) {
      out.push({ ...base, kind: 'deleted_in_org62', detail: 'Its Org62 Event was deleted there', org62EventId: r.e_id });
      continue;
    }
    const org62H = r.e_duration != null ? Number(r.e_duration) : r.e_starts && r.e_ends ? (ms(r.e_ends) - ms(r.e_starts)) / 3_600_000 : null;
    const appH = Number(r.duration_hours);
    if (org62H != null && Math.abs(org62H - appH) >= 0.25) out.push({ ...base, kind: 'hours_differ', detail: `Org62 has ${org62H} h, the app has ${appH} h`, org62EventId: r.e_id });
    if (r.what_org62_id && r.e_what && id15(r.what_org62_id) !== id15(r.e_what)) out.push({ ...base, kind: 'what_differs', detail: 'Org62 has it on another opportunity or account than the app', org62EventId: r.e_id });
  }
  return out;
}
