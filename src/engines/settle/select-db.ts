/**
 * The Settle pass's selection and policy facts on Postgres (read-only):
 *  - which items to judge: every live or suggested item on the first pass; afterwards only items that changed since
 *    the last pass (new evidence, new messages in their conversation, a due date or linked meeting that passed);
 *  - the facts the policy needs (did the user touch or reopen it, is it an external commitment, who and where);
 *  - the user's Closing settings.
 */
import { sql } from 'drizzle-orm';

import { ClosingSettings, DEFAULT_CLOSING_SETTINGS } from '@/contract';
import type { Db, DbOrTx } from '@/db/client';

import type { PolicyItem } from './policy';

type Row = Record<string, unknown>;
const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

export const SETTLE_STATUSES = ['suggested', 'open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done'] as const;
const STATUS_LIST = sql.raw(`(${SETTLE_STATUSES.map((s) => `'${s}'`).join(', ')})`);

export async function loadClosingSettings(db: DbOrTx, userId: string): Promise<ClosingSettings> {
  const r = rows<{ value: unknown }>(await db.execute(sql`select value from user_settings where owner_user_id = ${userId} and key = 'settings.closing'`))[0];
  if (!r) return { ...DEFAULT_CLOSING_SETTINGS };
  const p = ClosingSettings.safeParse(r.value);
  return p.success ? p.data : { ...DEFAULT_CLOSING_SETTINGS };
}

/** Items to judge. `since` null: every live or suggested item; else only those with something new since then. */
export async function selectSettleItems(db: Db, userId: string, since: string | null, now: Date, limit = 600): Promise<Array<{ id: string; status: string }>> {
  if (!since) {
    return rows<{ id: string; status: string }>(
      await db.execute(sql`
        select id::text as id, status::text as status from work_items
         where owner_user_id = ${userId} and status::text in ${STATUS_LIST} and merged_into_id is null
         order by created_at limit ${limit}`),
    );
  }
  const nowIso = now.toISOString();
  return rows<{ id: string; status: string }>(
    await db.execute(sql`
      select wi.id::text as id, wi.status::text as status from work_items wi
       where wi.owner_user_id = ${userId} and wi.status::text in ${STATUS_LIST} and wi.merged_into_id is null
         and (
           wi.created_at > ${since}::timestamptz
           or (wi.due_at is not null and wi.due_at > ${since}::timestamptz and wi.due_at <= ${nowIso}::timestamptz)
           or exists (select 1 from work_item_evidence e where e.work_item_id = wi.id and e.created_at > ${since}::timestamptz and e.created_by <> 'engine')
           or exists (
             select 1 from work_item_evidence e join source_items o on o.id = e.source_item_id
               join source_items n on n.owner_user_id = wi.owner_user_id and n.source = 'slack' and n.meta->>'channelId' = o.meta->>'channelId'
                and coalesce(n.meta->>'threadTs', '') = coalesce(o.meta->>'threadTs', '') and n.first_seen_at > ${since}::timestamptz
              where e.work_item_id = wi.id and e.role = 'origin' and o.source = 'slack')
           or exists (
             select 1 from work_item_evidence e join source_items o on o.id = e.source_item_id
               join source_items n on n.owner_user_id = wi.owner_user_id and n.source = 'gmail' and n.external_parent_id = o.external_parent_id and n.first_seen_at > ${since}::timestamptz
              where e.work_item_id = wi.id and e.role = 'origin' and o.source = 'gmail')
         )
       order by wi.created_at limit ${limit}`),
  );
}

/** Policy facts for the selected items. */
export async function policyFacts(db: Db, userId: string, ids: string[]): Promise<Map<string, PolicyItem>> {
  const out = new Map<string, PolicyItem>();
  if (!ids.length) return out;
  const arr = sql`array[${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )}]`;
  for (const r of rows<Row>(
    await db.execute(sql`
      select wi.id::text as id, wi.kind::text as kind, wi.status::text as status,
             exists (select 1 from work_item_transitions t where t.work_item_id = wi.id and t.actor_kind = 'user') as touched_t,
             exists (select 1 from change_sets c where c.owner_user_id = wi.owner_user_id and c.actor_kind = 'user' and c.entity_type in ('work_item', 'work_items') and c.entity_id = wi.id::text) as touched_c,
             exists (select 1 from work_item_transitions t where t.work_item_id = wi.id and t.actor_kind = 'user'
                       and ((t.from_status::text in ('done', 'dismissed') and t.to_status::text not in ('done', 'dismissed'))
                            or (t.from_status::text = 'likely_done' and t.to_status::text not in ('done', 'dismissed', 'likely_done'))))
             -- An Undo of an engine change (a close for you) reverts it instead of writing a user transition: still a reopen.
             or exists (select 1 from change_sets c join change_sets u on u.id = c.undo_of_change_set_id
                         where c.owner_user_id = wi.owner_user_id and c.actor_kind = 'user' and c.kind = 'undo' and u.actor_kind = 'engine'
                           and c.entity_type in ('work_item', 'work_items') and c.entity_id = wi.id::text) as reopened,
             coalesce(cp.affiliation::text, '') as cp_affiliation,
             (select s.source::text from work_item_evidence e join source_items s on s.id = e.source_item_id where e.work_item_id = wi.id and e.role = 'origin' order by s.occurred_at limit 1) as origin_source,
             (select array_remove(array_agg(distinct coalesce(s.meta->'author'->>'name', '')), '') from work_item_evidence e join source_items s on s.id = e.source_item_id where e.work_item_id = wi.id) as people,
             (select array_remove(array_agg(distinct coalesce(s.meta->>'channelName', '')), '') from work_item_evidence e join source_items s on s.id = e.source_item_id where e.work_item_id = wi.id) as channels
        from work_items wi left join people cp on cp.id = wi.counterparty_person_id
       where wi.owner_user_id = ${userId} and wi.id = any(${arr})`),
  )) {
    out.set(String(r.id), {
      id: String(r.id),
      kind: String(r.kind),
      status: String(r.status),
      userTouched: !!r.touched_t || !!r.touched_c,
      userReopened: !!r.reopened,
      externalCommitment: String(r.kind) === 'commitment' && /external|customer|partner/i.test(String(r.cp_affiliation ?? '')),
      people: (r.people as string[] | null) ?? [],
      channels: (r.channels as string[] | null) ?? [],
      originSource: (r.origin_source as string | null) ?? null,
    });
  }
  return out;
}
