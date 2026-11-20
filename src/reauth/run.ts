/**
 * Health ▸ "Run refresh" / "Open Terminal" / "Reconnect", and the Assistant's chat_reauth: the worker's
 * `connector.reauth` job starts the connector's own sign-in here, then re-probes until it works.
 *
 *   vdp             the refresh script, silently (no window); when Okta wants MFA, the same script in Terminal,
 *                   which opens a browser for the MFA
 *   slack, org62    `claude mcp login …` typed into Terminal (a browser opens for the OAuth)
 *   gmail, calendar, drive, gemini_notes
 *                   devbar reconnects Google (a browser opens)
 *
 * The user's click is the confirm. Credentials never pass through here: every sign-in happens in their own Terminal or
 * browser, and the scripts write their own config.
 */
import { sql } from 'drizzle-orm';

import { VDP_PYTHON_RE, VDP_REFRESH_SCRIPT_RE } from '../contract/settings';
import type { JobContext } from '../jobs/types';
import type { VdpReauthOptions } from './handlers';
import type { ReauthHandler, ReauthKind, ReauthResult } from './types';

/** Scanner connector id → the handler that signs it in. Anything else has nothing to start (the probe runs alone). */
export const REAUTH_KIND_OF: Readonly<Record<string, ReauthKind>> = {
  vdp: 'vdp',
  slack: 'slack',
  org62: 'org62',
  gmail: 'google',
  calendar: 'google',
  drive: 'google',
  gemini_notes: 'google',
};

/** Start the connector's sign-in. Null when it has none (the caller just re-probes). */
export async function runConnectorReauth(handlers: Record<ReauthKind, ReauthHandler>, connector: string): Promise<ReauthResult | null> {
  const kind = REAUTH_KIND_OF[connector];
  if (!kind) return null;
  const first = await handlers[kind].act({ confirm: true });
  // VDP: the silent refresh works while the Okta session is live; past that, MFA needs a window
  if (kind === 'vdp' && first.status === 'needs_user' && /MFA/i.test(first.message)) return handlers.vdp.act({ confirm: true, window: true });
  return first;
}

/** What the worker needs from a job context to read the user's settings. */
export type ReauthSettingsCtx = Pick<JobContext, 'db' | 'userId'>;

/**
 * The worker's starter: reads Settings ▸ Sources (the VDP refresh script and its Python) at run time, so a change
 * applies to the next click without a restart, then starts the connector's sign-in.
 */
export function reauthStarter(handlersFor: (vdp: VdpReauthOptions) => Record<ReauthKind, ReauthHandler>) {
  return async (connector: string, ctx: ReauthSettingsCtx): Promise<ReauthResult | null> => {
    const r = await ctx.db.execute<{ v: { vdpRefreshScript?: unknown; vdpPython?: unknown } | null }>(
      sql`select value as v from user_settings where owner_user_id = ${ctx.userId} and key = 'settings.scanning'`,
    );
    const v = r.rows[0]?.v ?? null;
    const script = typeof v?.vdpRefreshScript === 'string' && VDP_REFRESH_SCRIPT_RE.test(v.vdpRefreshScript) ? v.vdpRefreshScript : undefined;
    const python = typeof v?.vdpPython === 'string' && v.vdpPython && VDP_PYTHON_RE.test(v.vdpPython) ? v.vdpPython : undefined;
    return runConnectorReauth(handlersFor({ ...(script ? { script } : {}), ...(python ? { python } : {}) }), connector);
  };
}
