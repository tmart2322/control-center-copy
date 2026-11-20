/**
 * DC-33: my Slack involvement as missed-opp evidence (src/projections/missed.ts `SlackChannelEvidence`). Read only:
 * my own messages of the last 180 days, grouped per channel, reduced to the channel's name and a count (never a
 * message body). The account a channel maps to is the projections' matcher's (the channel name), when it names one.
 */
import { sql } from 'drizzle-orm';

import type { Db, Tx } from '@/db/client';

import { nameCore, shortNames } from './matching';
import type { SlackChannelEvidence } from './missed';

/** My messages per named channel (DMs have no name and never count), newest first. */
export async function missedSlackEvidence(tx: Tx | Db, userId: string, now: Date): Promise<SlackChannelEvidence[]> {
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const r = await tx.execute<{ channel: string; name: string | null; at: Date | string; n: number }>(sql`
    select split_part(si.external_id, ':', 1) as channel, max(si.meta->>'channelName') as name, max(si.occurred_at) as at, count(*)::int as n
      from source_items si
     where si.owner_user_id = ${userId} and si.source = 'slack' and si.from_me and si.deleted_upstream_at is null
       and si.occurred_at >= ${since}::timestamptz and si.occurred_at < ${now.toISOString()}::timestamptz
     group by 1
     order by 3 desc`);
  const accounts = await tx.execute<{ id: string; name: string }>(sql`
    select org62_account_id as id, name from accounts where owner_user_id = ${userId} and archived_at is null and org62_account_id ~ '^001'`);
  const pats = accounts.rows.map((a) => ({ id: a.id, pats: [nameCore(a.name), ...shortNames(a.name)].filter((p) => p.length) }));
  return r.rows
    .filter((x) => !!x.name && x.name.trim() !== '')
    .map((x) => ({ id: x.channel, channelName: x.name!, at: new Date(x.at).toISOString(), messages: Number(x.n), accountOrg62Id: channelAccount(x.name!, pats) }));
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The one account a channel name names (its name core or a short name, word for word); several or none: null. */
export function channelAccount(channelName: string, accounts: ReadonlyArray<{ id: string; pats: string[][] }>): string | null {
  const ch = words(channelName);
  const has = (p: string[]) => ch.some((_, i) => p.every((w, j) => ch[i + j] === w));
  const hits = accounts.filter((a) => a.pats.some(has));
  return hits.length === 1 ? hits[0]!.id : null;
}
