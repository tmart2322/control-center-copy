/**
 * Projections: what the scanner stored (source items) → the domain rows the pages read. See run.ts for the tick
 * and the per-source mappers (calendar.ts, org62.ts, sessions.ts, assets.ts, activity.ts) for the rules.
 */
import type { Db } from '@/db/client';

import { runProjections } from './run';

export { runProjections, PROJECTIONS_VERSION, STATE_KEY, type ProjectionResult } from './run';
export { projectCalendarEvent, resolveCalendarItems } from './calendar';
export { projectOrg62, oppsInBook } from './org62';
export { projectClaudeSession } from './sessions';
export { planWeek } from './activity';
export { Matcher } from './matching';

/** The worker's tick hook (src/worker/index.ts): one projection pass per minute; a pass with nothing new is a read. */
export function projectionsHook(db: Db, userId: string, log: (msg: string, detail?: Record<string, unknown>) => void, everyMs = 60_000) {
  return { name: 'projections', everyMs, run: async (now: Date) => void (await runProjections({ db, userId, now, log })) };
}
