/**
 * The user's resolved persona (D-55) for server code outside the read model (the worker, scanners, jobs): the
 * persona and profile sections, through `personaOf`. No section → the SE persona, level from `profile.role`.
 */
import { sql } from 'drizzle-orm';

import { PersonaSettings } from '@/contract';
import type { DbOrTx } from '@/db/client';
import { personaOf, type ResolvedPersona } from '@/personas';

export async function loadPersona(db: DbOrTx, userId: string): Promise<ResolvedPersona> {
  const r = await db.execute(sql`select key, value from user_settings where owner_user_id = ${userId} and key in ('settings.persona', 'settings.profile')`);
  const by = new Map((r.rows as Array<{ key: string; value: unknown }>).map((x) => [x.key, x.value]));
  const parsed = PersonaSettings.safeParse(by.get('settings.persona') ?? { version: 1 });
  const profile = (by.get('settings.profile') ?? null) as { role?: string } | null;
  return personaOf({ persona: parsed.success ? parsed.data : null, profile });
}
