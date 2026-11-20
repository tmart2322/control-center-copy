/**
 * The scenario user's profile (private file `<stress>/profile/profile.json`, never in git): who "me" is, my
 * accounts (with Org62 ids), my channels (customer channels mapped to accounts, watched channels) and settings.
 * Loaded into a fresh scenario DB with plain inserts. Tests use a placeholder profile.
 */
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { actors, withChangeSet } from '../../../src/db/changeset';
import type { Db, DbOrTx } from '../../../src/db/client';

import { privDir, readJson } from './paths';

export interface StressProfile {
  me: { email: string; name: string; slackId: string; org62UserId: string; aliases?: string[] };
  timezone: string;
  workingHours: { start: string; end: string; days: number[] };
  accounts: Array<{ name: string; org62Id?: string; aliases?: string[] }>;
  channels: Array<{ id: string; name: string; kind?: 'public' | 'private'; account?: string; watch?: boolean }>;
  budgets?: { softUsd: number; hardUsd: number; alertPct?: number };
}

export function profileFile(): string {
  return path.join(privDir('profile'), 'profile.json');
}

export function loadProfile(file = profileFile()): StressProfile {
  return readJson<StressProfile>(file);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Insert the profile; returns the user id. Channels can be limited (scenarios use a subset). */
export async function loadProfileIntoDb(db: Db, p: StressProfile, opts: { channels?: string[] } = {}): Promise<string> {
  const u = await db.execute<{ id: string }>(sql`
    insert into users (email, display_name, timezone) values (${p.me.email.toLowerCase()}, ${p.me.name}, ${p.timezone})
    on conflict (email) do update set display_name = excluded.display_name returning id`);
  const userId = u.rows[0]!.id;
  await withChangeSet({ db, userId, actor: actors.system('stress-profile'), reason: 'stress profile load' }, async (tx) => loadRest(tx, p, userId, opts));
  return userId;
}

async function loadRest(db: DbOrTx, p: StressProfile, userId: string, opts: { channels?: string[] }): Promise<void> {
  const person = await db.execute<{ id: string }>(sql`insert into people (owner_user_id, display_name, primary_email, is_me) values (${userId}, ${p.me.name}, ${p.me.email.toLowerCase()}, true) returning id`);
  const personId = person.rows[0]!.id;
  await db.execute(sql`update users set person_id = ${personId} where id = ${userId}`);
  for (const [system, ext] of [
    ['slack', p.me.slackId],
    ['org62_user', p.me.org62UserId],
    ['email', p.me.email.toLowerCase()],
  ] as const) {
    if (!ext) continue;
    await db.execute(sql`insert into person_identities (owner_user_id, person_id, system, external_id, method, is_primary)
                         values (${userId}, ${personId}, ${system}, ${ext}, 'user', true)`);
  }
  const accountIds = new Map<string, string>();
  for (const a of p.accounts) {
    const r = await db.execute<{ id: string }>(sql`insert into accounts (owner_user_id, name, org62_account_id, is_my_book) values (${userId}, ${a.name}, ${a.org62Id ?? null}, true) returning id`);
    const id = r.rows[0]!.id;
    accountIds.set(a.name, id);
    for (const al of a.aliases ?? []) {
      await db.execute(sql`insert into account_aliases (account_id, kind, value, normalized_value, source) values (${id}, 'short_name', ${al}, ${norm(al)}, 'seed') on conflict do nothing`);
    }
  }
  const want = opts.channels ? new Set(opts.channels) : undefined;
  for (const c of p.channels) {
    if (want && !want.has(c.id)) continue;
    const r = await db.execute<{ id: string }>(sql`
      insert into channels (owner_user_id, system, external_id, name, kind, watch_mode, is_customer_channel, is_member)
      values (${userId}, 'slack', ${c.id}, ${c.name}, ${c.kind ?? 'public'}, ${c.watch ? 'digest' : 'items'}, ${!!c.account}, true) returning id`);
    const chId = r.rows[0]!.id;
    const acct = c.account ? accountIds.get(c.account) : undefined;
    if (acct) await db.execute(sql`insert into channel_account_maps (channel_id, account_id, method, confidence) values (${chId}, ${acct}, 'user', 1)`);
    if (c.watch) await db.execute(sql`insert into watch_subscriptions (owner_user_id, scope_kind, channel_id, label) values (${userId}, 'channel', ${chId}, ${c.name})`);
  }
  await db.execute(sql`insert into user_settings (owner_user_id, key, value) values
    (${userId}, 'settings.profile', ${JSON.stringify({ version: 1, name: p.me.name, email: p.me.email, timezone: p.timezone, workingHours: p.workingHours })}::jsonb),
    (${userId}, 'settings.budgets', ${JSON.stringify({ version: 1, softUsd: p.budgets?.softUsd ?? 5, hardUsd: p.budgets?.hardUsd ?? 15, alertPct: p.budgets?.alertPct ?? 80 })}::jsonb)
    on conflict do nothing`);
}

/** Placeholder profile for tests (no real data). */
export const PLACEHOLDER_PROFILE: StressProfile = {
  me: { email: 'me@example.com', name: 'ME', slackId: 'U0ME00001', org62UserId: '005XX000000ME01AAA' },
  timezone: 'America/Denver',
  workingHours: { start: '07:30', end: '17:30', days: [1, 2, 3, 4, 5] },
  accounts: [{ name: 'ACME', org62Id: '001XX0000000ACMEAA', aliases: ['ACME Corp'] }],
  channels: [
    { id: 'C0ACME001', name: '#acme-account', account: 'ACME' },
    { id: 'C0WATCH01', name: '#team-watch', watch: true },
  ],
};
