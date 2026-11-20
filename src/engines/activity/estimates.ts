/**
 * Curated build estimates (format of estimates/builds.json; the data is NOT copied here).
 * Rules (memory, binding): generous but realistic hours, grounded in the evidence (no hour caps since 2026-11-14);
 * nothing before go-live (mid-Sep 2026); demo-asset/tooling builds are Asset Creation with no WhatId.
 */
import { z } from 'zod';
import { accountByKey } from './classify';
import { newEntry, stripWhatIfNeither } from './entry';
import { placeInFreeGap } from './placement';
import { defaultMeetingType, isNeither, roundQuarter } from './taxonomy';
import { HOUR, type Interval, toIsoSec, zonedToMs } from './time';
import type { ActivityConfig, ActivityEntry, ActivityMappings, RejectedProposal } from './types';

export const BuildEstimateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slug: z.string().min(1),
  subject: z.string().min(1),
  type: z.string().min(1),
  hours: z.number().positive(),
  /** early | morning | afternoon | evening | "HH:MM" preferred start (placement hint). */
  pref: z.string().optional(),
  /** Fixed local start "HH:MM". Wins over `pref`. */
  start: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  evidence: z.string().default(''),
  account: z.string().optional(),
  what_id: z.string().optional(),
  what_name: z.string().optional(),
  meeting_type: z.string().optional(),
});
export type BuildEstimate = z.infer<typeof BuildEstimateSchema>;

export const parseBuildEstimates = (raw: unknown): BuildEstimate[] => z.array(BuildEstimateSchema).parse(raw);

export interface BuildContext {
  cfg: ActivityConfig;
  mappings: ActivityMappings;
  /** Busy intervals per local day (Org62 Solutions Events, meeting entries, OOO). */
  busyByDay: ReadonlyMap<string, readonly Interval[]>;
}

export interface BuildResult {
  entries: ActivityEntry[];
  rejected: RejectedProposal[];
}

/**
 * Estimates -> entries. Estimates dated before `cfg.liveFrom` are rejected (`before_go_live`), so
 * earlier weeks are never inflated. Placement fills the first free gap, never double-booking.
 */
export function buildEstimateEntries(estimates: readonly BuildEstimate[], ctx: BuildContext): BuildResult {
  const { cfg, mappings } = ctx;
  const entries: ActivityEntry[] = [];
  const rejected: RejectedProposal[] = [];
  const placed = new Map<string, Interval[]>();
  for (const b of estimates) {
    const hours = roundQuarter(b.hours);
    const key = `build|${b.date}|${b.slug}`;
    if (b.date < cfg.liveFrom) {
      rejected.push({ dedupeKey: key, subject: b.subject, startsAt: b.date, hours, reason: 'before_go_live', note: `before go-live ${cfg.liveFrom}` });
      continue;
    }
    if (hours <= 0) {
      rejected.push({ dedupeKey: key, subject: b.subject, startsAt: b.date, hours, reason: 'below_minimum', note: 'rounds to 0 h' });
      continue;
    }
    const acct = b.account ? accountByKey(mappings, b.account) : null;
    const neither = isNeither(b.type);
    const whatId = neither ? '' : (b.what_id ?? acct?.whatId ?? '');
    const whatName = neither ? '' : (b.what_name ?? acct?.whatName ?? '');
    const busy = [...(ctx.busyByDay.get(b.date) ?? []), ...(placed.get(b.date) ?? [])];
    const startMs = b.start ? zonedToMs(b.date, b.start, cfg.timezone) : placeInFreeGap(b.date, hours, b.pref ?? 'afternoon', busy, cfg.timezone);
    const endMs = startMs + hours * HOUR;
    placed.set(b.date, [...(placed.get(b.date) ?? []), { start: startMs, end: endMs }]);
    let e = newEntry({
      dedupeKey: key,
      origin: 'build_estimate',
      subject: b.subject,
      startsAt: toIsoSec(startMs),
      endsAt: toIsoSec(endMs),
      durationHours: hours,
      seTaskType: b.type,
      meetingType: defaultMeetingType(b.type, b.meeting_type),
      whatKind: whatId ? (whatId.startsWith('006') ? 'opportunity' : 'account') : 'none',
      whatOrg62Id: whatId || null,
      whatName: whatName || null,
      accountKey: acct?.key ?? null,
      confidence: 'Estimate',
      reason: 'curated estimate from git/Slack/Drive/Claude evidence',
      evidence: b.evidence,
      flags: ['GUESS: hours estimated from evidence'],
    });
    e = stripWhatIfNeither(e);
    entries.push(e);
  }
  return { entries, rejected };
}
