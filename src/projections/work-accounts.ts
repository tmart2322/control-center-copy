/**
 * Work items → accounts (ACC-1). The scan skills propose items without an account, and the live database's accounts
 * are Org62 legal entities ("Initech Corporation", three "Globex Health - …" rows), so not one of the first live
 * scan's work items had an account: Deals, the account rollups and the customer-facing priority signal never saw them.
 *
 * Each projection pass gives an item with no account the one its title and purpose name, through the same Matcher as
 * calendar events and sessions (legal names, derived short names, aliases; ties go to the account with my open opps,
 * and a tie that remains matches nothing). It fills the opportunity too when the text points at exactly one of the
 * account's open opps and the item has none. It never overwrites: an item that has an account, or whose account the
 * user set or cleared (user-locked), is left alone. Writes run in the projections change set (actor engine).
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/db/client';

import type { Matcher } from './matching';

export async function matchWorkItemAccounts(tx: Tx, userId: string, matcher: Matcher, opts: { since: Date | null }): Promise<number> {
  const rows = await tx.execute<{ id: string; title: string; purpose: string | null; opportunity_id: string | null; locked: string[] | null }>(sql`
    select w.id, w.title, w.purpose, w.opportunity_id, w.user_locked_fields as locked
      from work_items w
     where w.owner_user_id = ${userId} and w.account_id is null and w.merged_into_id is null
       and not ('account_id' = any(coalesce(w.user_locked_fields, '{}')))
       ${opts.since ? sql`and w.updated_at > ${opts.since.toISOString()}::timestamptz` : sql``}
     order by w.created_at
     limit 2000`);
  let n = 0;
  for (const r of rows.rows) {
    const m = matcher.resolve([r.title, r.purpose].filter(Boolean).join(' '));
    if (!m) continue;
    const opp = !r.opportunity_id && m.oppId && !(r.locked ?? []).includes('opportunity_id') ? m.oppId : null;
    const res = await tx.execute(sql`
      update work_items set account_id = ${m.accountId}::uuid,
             opportunity_id = coalesce(opportunity_id, ${opp}::uuid),
             version = version + 1, updated_at = now()
       where id = ${r.id}::uuid and account_id is null`);
    n += res.rowCount ?? 0;
  }
  return n;
}
