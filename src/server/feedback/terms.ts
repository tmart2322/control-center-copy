/**
 * The scrub term list from Postgres (D-56): every account (names, short names, domains), opportunity, person and
 * person identity (Slack ids, emails, Org62 user and contact ids) of one user. Read-only; the values stay on the
 * server and only feed `Scrubber` (src/server/feedback/scrub.ts).
 */
import { eq, inArray } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { accountAliases, accounts, opportunities, people, personIdentities } from '@/db/schema';

import type { ScrubTerms } from './scrub';

const NAME_ALIASES = new Set(['name', 'short_name', 'domain']);

export async function loadScrubTerms(db: Db, userId: string): Promise<ScrubTerms> {
  const accs = await db.select({ id: accounts.id, name: accounts.name, org62: accounts.org62AccountId }).from(accounts).where(eq(accounts.ownerUserId, userId));
  const ids = accs.map((a) => a.id);
  const aliases = ids.length ? await db.select({ accountId: accountAliases.accountId, kind: accountAliases.kind, value: accountAliases.value }).from(accountAliases).where(inArray(accountAliases.accountId, ids)) : [];
  const opps = await db.select({ id: opportunities.id, name: opportunities.name, org62: opportunities.org62OpportunityId }).from(opportunities).where(eq(opportunities.ownerUserId, userId));
  const ppl = await db.select({ id: people.id, name: people.displayName, email: people.primaryEmail }).from(people).where(eq(people.ownerUserId, userId));
  const idents = await db.select({ personId: personIdentities.personId, system: personIdentities.system, externalId: personIdentities.externalId, handle: personIdentities.handle }).from(personIdentities).where(eq(personIdentities.ownerUserId, userId));

  const byAccount = new Map<string, string[]>();
  for (const a of aliases) if (NAME_ALIASES.has(a.kind) && a.value.trim().length >= 3) byAccount.set(a.accountId, [...(byAccount.get(a.accountId) ?? []), a.value.trim()]);
  const byPerson = new Map<string, typeof idents>();
  for (const i of idents) byPerson.set(i.personId, [...(byPerson.get(i.personId) ?? []), i]);

  return {
    accounts: accs.map((a) => ({ id: a.id, names: [a.name, ...(byAccount.get(a.id) ?? [])], ids: a.org62 ? [a.org62] : [] })),
    opps: opps.map((o) => ({ id: o.id, names: [o.name], ids: [o.org62] })),
    people: ppl.map((p) => {
      const mine = byPerson.get(p.id) ?? [];
      return {
        id: p.id,
        names: [p.name, ...mine.map((i) => i.handle?.replace(/^@/, '') ?? '').filter((h) => h.length >= 3)],
        ids: mine.filter((i) => i.system !== 'email').map((i) => i.externalId),
        emails: [...(p.email ? [p.email] : []), ...mine.filter((i) => i.system === 'email').map((i) => i.externalId)],
      };
    }),
  };
}
