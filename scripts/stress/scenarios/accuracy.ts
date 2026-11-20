/**
 * Accuracy runs (live Haiku): all scanners over a block of days, the worker opened once a day (00:15) and
 * catching up the previous day (head + backfill), with state carried across days in one DB, so promises
 * made one day and completed later link across days. Scored against the Opus answer key (score.ts).
 * Variant `before` runs the skills as they were at bf44b70; `after` runs the current skills.
 */
import { CursorMonitor } from '../invariants';
import { assertStressDb, dbExists, scenarioDbName, urlOf } from '../lib/db';
import { privDir } from '../lib/paths';
import { addDays, daysBetween, localToUtc } from '../lib/time';

import { DEFAULT_TRIAGE } from '../../../src/scanner/triage/slack-triage';
import { ESCALATION_MODEL, SCANNER_MODEL } from '../../../src/llm/models';
import type { WorldOptions } from '../driver/world';

import { drain, finish, makeWorld, type Scenario } from './common';

/** STRESS-2 Slack recall variants: REC-1 alone, + triage, + triage and Sonnet escalation. */
export function slackRecallVariant(v: 'rec' | 'tri' | 'esc'): NonNullable<WorldOptions['slackRecall']> {
  if (v === 'rec') return { autoRecord: 'slack', triage: undefined };
  return { autoRecord: 'slack', triage: () => ({ ...DEFAULT_TRIAGE, model: SCANNER_MODEL, ...(v === 'esc' ? { escalateModel: ESCALATION_MODEL } : {}) }) };
}

const ALL = ['slack', 'org62', 'gmail', 'calendar', 'gemini_notes', 'drive', 'trainings', 'claude_sessions'] as const;

export function accuracyScenario(
  name: string,
  fromDay: string,
  toDay: string,
  variant: 'before' | 'after',
  sources: readonly (typeof ALL)[number][] = ALL,
  opts: { repoRoot?: string; slackInboxChunkH?: number; note?: string; slackRecall?: WorldOptions['slackRecall']; completion?: boolean } = {},
): Scenario {
  return {
    description: `live Haiku, ${sources.join('+')} over ${fromDay}…${toDay}, daily 00:15 catch-up, skills ${variant === 'before' ? 'v1.0.0 (bf44b70)' : 'current'}${opts.completion ? ', completion pass + reevaluate on (CMP-1)' : ''}`,
    async run(ctx) {
      // CC_STRESS_RESUME_AT=<boot index>: continue a run whose process died mid-boot (a machine restart) on its own
      // DB and state dir. Earlier boots are skipped; the interrupted one restarts like a worker after a crash (reaper,
      // stale plans dropped, queued windows kept) at the current simulated time; later boots run as usual.
      const resumeAt = process.env.CC_STRESS_RESUME_AT ? Number(process.env.CC_STRESS_RESUME_AT) : undefined;
      const reuse = resumeAt !== undefined ? { name: scenarioDbName(name), url: urlOf(scenarioDbName(name)) } : undefined;
      if (reuse) {
        assertStressDb(reuse.name);
        if (!dbExists(reuse.name)) throw new Error(`cannot resume ${name}: ${reuse.name} does not exist`);
      }
      const w = await makeWorld(ctx, {
        ...(reuse ? { reuseDb: reuse, ownClock: true } : {}),
        scenario: name,
        start: localToUtc(fromDay, '00:15').toISOString(),
        sources: [...sources],
        runner: 'live',
        repoRoot: opts.repoRoot ?? (variant === 'before' ? privDir('skills-v1.0.0') : undefined),
        slackInboxChunkH: opts.slackInboxChunkH,
        slackRecall: opts.slackRecall,
        liveRunEstimateUsd: 0.2,
        completion: opts.completion,
      });
      const mon = new CursorMonitor();
      const days = daysBetween(fromDay, addDays(toDay, 1));
      for (const [i, d] of days.entries()) {
        if (resumeAt !== undefined && i < resumeAt) continue;
        await w.clock.jumpTo(localToUtc(d, '00:15')); // a no-op for the interrupted boot (already past its 00:15)
        await w.boot();
        await drain(w, 600);
        await mon.observe(w.handle.db);
        ctx.log(`[${name}] day ${d} caught up (boot ${i + 1}/${days.length}); spend so far $${w.costUsd.toFixed(3)}`);
      }
      // finish() drains again (no-op) and checks invariants.
      return finish(w, {}, [], { days }, mon);
    },
  };
}

export const ACCURACY: Record<string, Scenario> = {
  'acc-A-after': accuracyScenario('acc-A-after', '2026-10-21', '2026-10-22', 'after'),
  'acc-A-before': accuracyScenario('acc-A-before', '2026-10-21', '2026-10-22', 'before'),
  'acc-B-before': accuracyScenario('acc-B-before', '2026-10-29', '2026-11-04', 'before'),
  'acc-B-after': accuracyScenario('acc-B-after', '2026-10-29', '2026-11-04', 'after'),
  'acc-B2-after': accuracyScenario('acc-B2-after', '2026-11-02', '2026-11-04', 'after'),
  // CMP-1: the same blocks with the completion pass and the real reevaluate job on (score with completion-score.ts).
  'acc-A-done': accuracyScenario('acc-A-done', '2026-10-21', '2026-10-22', 'after', ALL, { completion: true }),
  'acc-B2-done': accuracyScenario('acc-B2-done', '2026-11-02', '2026-11-04', 'after', ALL, { completion: true }),
  // SLK-1 A/B on block A, Slack only, 2 replicates each: scan-slack 1.1.0 with 6 h inbox chunks vs 1.2.0 with 2 h.
  ...Object.fromEntries(
    [1, 2].flatMap((i) => [
      [`acc-A-slack-base-${i}`, accuracyScenario(`acc-A-slack-base-${i}`, '2026-10-21', '2026-10-22', 'after', ['slack'], { repoRoot: privDir('skills-v1.1.0'), slackInboxChunkH: 6 })],
      [`acc-A-slack-new-${i}`, accuracyScenario(`acc-A-slack-new-${i}`, '2026-10-21', '2026-10-22', 'after', ['slack'])],
    ]),
  ),
  // STRESS-2 confirmation: Slack-only blocks A and B2 with a recall variant, 2 replicates each.
  ...Object.fromEntries(
    [1, 2].flatMap((i) =>
      (['rec', 'tri', 'esc'] as const).flatMap((v) => [
        [`acc-A-slack-${v}-${i}`, accuracyScenario(`acc-A-slack-${v}-${i}`, '2026-10-21', '2026-10-22', 'after', ['slack'], { slackRecall: slackRecallVariant(v) })],
        [`acc-B2-slack-${v}-${i}`, accuracyScenario(`acc-B2-slack-${v}-${i}`, '2026-11-02', '2026-11-04', 'after', ['slack'], { slackRecall: slackRecallVariant(v) })],
      ]),
    ),
  ),
};
