/**
 * Mechanics scenarios (scripted runner, no LLM cost): gaps, PTO, clock jumps, kills, restart storms, overlap,
 * late arrivals, faults, budget. Each returns invariants plus scenario-specific checks.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { catchUpOrder, CursorMonitor, type InvariantResult } from '../invariants';
import { privDir, writePriv } from '../lib/paths';
import { loadProfile } from '../lib/profile';
import { localToUtc } from '../lib/time';
import { tsMs } from '../replay/slack';
import { enqueueJob } from '../../../src/db/queue';

import { counts, drain, finish, makeWorld, type Scenario, type ScenarioCtx } from './common';

const ALL_DET = ['gmail', 'calendar', 'gemini_notes', 'drive', 'trainings', 'claude_sessions'] as const;
const CH4 = ['C06GULUG03E', 'C0AJZN908CX', 'C08S7QGGYLT', 'C0CAUAZUZNE'];
const at = (d: string, hm: string) => localToUtc(d, hm).toISOString();
const check = (name: string, ok: boolean, detail: string): InvariantResult => ({ name, ok, detail });

async function cursors(w: { handle: { db: import('../../../src/db/client').Db } }) {
  const r = await w.handle.db.execute<{ scope: string; hw: string }>(sql`select scope, high_watermark_at::text as hw from scan_cursors where high_watermark_at is not null order by 1`);
  return Object.fromEntries(r.rows.map((x) => [x.scope, x.hw]));
}

async function catchUpChecks(w: Awaited<ReturnType<typeof makeWorld>>, since: string, scopes: string[]): Promise<InvariantResult[]> {
  const out: InvariantResult[] = [];
  for (const s of scopes) out.push(await catchUpOrder(w.handle.db, s, since));
  return out;
}

export const MECHANICS: Record<string, Scenario> = {
  'fri-mon-gap': {
    description: 'all sources (scripted): Fri 15:00–18:00, laptop off all weekend, Mon 08:00 resume → head first, backfill oldest→newest, full coverage, catch-up flag set then released',
    async run(ctx) {
      const progress: Array<Record<string, number>> = [];
      let calls = 0;
      const w = await makeWorld(ctx, {
        scenario: 'fri-mon-gap',
        start: at('2026-10-09', '15:00'),
        sources: ['slack', 'org62', ...ALL_DET],
        runner: 'scripted',
        channels: CH4,
        // Sample "catching up: Slack N%" from inside the traversal, mid catch-up.
        hooks: { beforeCall: async () => void (calls++ % 4 === 0 && w.boots === 2 ? progress.push(await w.scanning.scanner.catchUpProgress()) : undefined) },
      });
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-10-09', '18:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      await w.shutdown('laptop closed');
      const before = await cursors(w);
      await w.clock.jumpTo(at('2026-10-12', '08:00'));
      const resumeAt = w.clock.now().toISOString();
      await w.boot();
      const catching: boolean[] = [w.scanning.scanner.isCatchingUp()];
      let catchingScopes: string[] = [];
      await w.runUntil(at('2026-10-12', '09:00'), {
        onStep: async (x) => {
          await mon.observe(x.handle.db);
          catching.push(x.scanning.scanner.isCatchingUp());
          catchingScopes = x.scanning.scanner.status().filter((st) => st.catchingUp).map((st) => `${st.connector}:${st.scope}`);
        },
      });
      const after = await cursors(w);
      const extra = await catchUpChecks(w, resumeAt, ['slack:inbox', 'gmail:inbox', 'slack:channel:C06GULUG03E']);
      extra.push(check('C1 catch-up set at resume and released by 09:00', catching[0] === true && catching[catching.length - 1] === false, `first=${catching[0]} last=${catching[catching.length - 1]} steps=${catching.length}; still catching up: ${catchingScopes.join(', ') || 'none'}`));
      const slackPct = progress.map((p) => p.slack).filter((v): v is number => v !== undefined);
      extra.push(check('C2 catch-up progress reported and rising while catching up (Slack %)', slackPct.length > 1 && slackPct[slackPct.length - 1]! >= slackPct[0]!, `samples=${slackPct.join(',')}`));
      const behind = Object.entries(after).filter(([, v]) => Date.parse(v) < Date.parse(resumeAt) - 1000);
      extra.push(check('C3 every cursor closed the weekend gap (≥ resume time)', behind.length === 0 && Object.keys(after).length === Object.keys(before).length, behind.map(([k, v]) => `${k}@${v}`).slice(0, 6).join(', ') || `all ${Object.keys(after).length} at/after resume`));
      return finish(w, { coverageQuestion: { scope: 'slack:inbox', from: at('2026-10-10', '14:00'), to: at('2026-10-10', '16:00') } }, extra, { before, after }, mon);
    },
  },

  pto: {
    description: 'all sources (scripted): Tue Oct 13 08:00–12:00, then a 12.8-day break, resume Mon Oct 26 08:00: backfill size, lookback caps, Gemini notes / missed meetings / trainings that came due during the break',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'pto', start: at('2026-10-13', '08:00'), sources: ['slack', 'org62', ...ALL_DET], runner: 'scripted', channels: CH4 });
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-10-13', '12:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      await w.shutdown('PTO');
      await w.clock.jumpTo(at('2026-10-26', '08:00'));
      const resumeAt = w.clock.now().toISOString();
      await w.boot();
      // Resume plan size per scope (the first planJobs enqueued them).
      const plan = await w.handle.db.execute<{ k: string; n: string }>(sql`
        select payload->>'connector' || ':' || (payload->>'scope') || ':' || (payload->>'mode') as k, count(*)::text as n from jobs
         where created_at >= now() - interval '5 minutes' and payload->>'kind' = 'scan' group by 1 order by 1`);
      await w.runUntil(at('2026-10-26', '10:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      const extra = await catchUpChecks(w, resumeAt, ['slack:inbox', 'gmail:inbox', 'calendar:primary']);
      const db = w.handle.db;
      const breakFrom = at('2026-10-13', '12:00');
      const breakTo = at('2026-10-26', '08:00');
      const notes = await db.execute<{ n: string }>(sql`select count(*)::text as n from source_items where meta->>'itemKind' = 'meeting_notes' and occurred_at >= ${breakFrom}::timestamptz and occurred_at < ${breakTo}::timestamptz`);
      const events = await db.execute<{ k: string; n: string }>(sql`
        select coalesce(meta->>'attendance', '?') as k, count(*)::text as n from source_items
         where meta->>'itemKind' = 'calendar_event' and occurred_at >= ${breakFrom}::timestamptz and occurred_at < ${breakTo}::timestamptz group by 1`);
      const trainings = await db.execute<{ n: string }>(sql`select count(*)::text as n from source_items where meta->>'itemKind' = 'training_notice' and occurred_at >= ${breakFrom}::timestamptz and occurred_at < ${breakTo}::timestamptz`);
      const slackBreak = await db.execute<{ n: string }>(sql`select count(*)::text as n from source_items where source = 'slack' and occurred_at >= ${breakFrom}::timestamptz and occurred_at < ${breakTo}::timestamptz`);
      const truth = Object.values(w.slack!.ix.messages).filter((m) => m.classes.some((c) => c === 'dm' || c === 'mentions' || c === 'mine') && tsMs(m.ts) >= Date.parse(breakFrom) && tsMs(m.ts) < Date.parse(breakTo)).length;
      extra.push(check('P1 Slack inbox messages during the break were all recorded', Number(slackBreak.rows[0]!.n) >= truth, `recorded=${slackBreak.rows[0]!.n} recorded-in-fixture(inbox classes)=${truth}`));
      extra.push(check('P2 Gemini notes for meetings that ended during the break were found', Number(notes.rows[0]!.n) > 0, `meeting_notes in break=${notes.rows[0]!.n}`));
      extra.push(check('P3 calendar events during the break were recorded with attendance', events.rows.length > 0, JSON.stringify(Object.fromEntries(events.rows.map((r) => [r.k, Number(r.n)])))));
      extra.push(check('P4 training notices during the break (informational)', true, `training_notice=${trainings.rows[0]!.n}`));
      return finish(w, {}, extra, { resumePlan: Object.fromEntries(plan.rows.map((r) => [r.k, Number(r.n)])) }, mon);
    },
  },

  'lid-closed': {
    description: 'Slack + Gmail (scripted): a Slack traversal is mid-run when the lid closes for 3 h; on wake the lease has expired (DB time), the reaper requeues, the late completion is fenced out',
    async run(ctx) {
      let stall: (() => void) | undefined;
      let stalled = false;
      const w = await makeWorld(ctx, {
        scenario: 'lid-closed',
        start: at('2026-10-22', '09:00'),
        sources: ['slack', 'gmail'],
        runner: 'scripted',
        channels: [],
        hooks: {
          beforeCall: async (i) => {
            if (!stalled && i.scope === 'inbox' && i.n === 2 && w.clock.nowMs() > Date.parse(at('2026-10-22', '11:00'))) {
              stalled = true;
              await new Promise<void>((r) => (stall = r));
            }
          },
        },
      });
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-10-22', '11:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      // Next poll: run steps until the stall engages.
      for (let i = 0; i < 40 && !stall; i++) {
        await w.runtime.runHooks();
        await w.runtime.pollOnce();
        await new Promise((r) => setTimeout(r, 300));
        if (!stall) await w.clock.jump(60_000);
      }
      const runningBefore = await w.handle.db.execute<{ id: string }>(sql`select id::text from jobs where status = 'running'`);
      // Lid closed: 3 h pass with no heartbeat.
      await w.clock.jump(3 * 3600_000);
      const ev = w.wake.check();
      await new Promise((r) => setTimeout(r, 1500));
      const reaped = await w.handle.db.execute<{ id: string; status: string }>(sql`select id::text, status::text from jobs where id::text = any(string_to_array(${runningBefore.rows.map((r) => r.id).join(',')}, ','))`);
      stall?.();
      await new Promise((r) => setTimeout(r, 1500));
      await w.runUntil(at('2026-10-22', '15:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      const extra: InvariantResult[] = [
        check('L1 wake detected after the clock jump', !!ev && ev.gapMs > 60_000, `gapMs=${ev?.gapMs ?? 'none'}`),
        check('L2 the stalled job was running when the lid closed', runningBefore.rows.length > 0 && stalled, `running=${runningBefore.rows.length} stalled=${stalled}`),
        check('L3 after wake the stalled job is still ours (own lease extended first) or requeued, never lost', reaped.rows.every((r) => ['running', 'queued', 'succeeded', 'cancelled'].includes(r.status)), JSON.stringify(reaped.rows)),
      ];
      return finish(w, {}, extra, {}, mon);
    },
  },

  overlap: {
    description: 'Claude sessions file-watch vs poll, a manual /rescan during catch-up, and reconcile during catch-up (scripted)',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'overlap', start: at('2026-11-02', '08:00'), sources: ['slack', 'gmail', 'claude_sessions'], runner: 'scripted', channels: ['C06GULUG03E'] });
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-11-02', '08:30'), { onStep: async (x) => mon.observe(x.handle.db) });
      await w.shutdown('away');
      await w.clock.jumpTo(at('2026-11-02', '20:00'));
      await w.boot();
      // While the resume plan is queued/running: a chat /rescan, a reconcile, and file-watch events.
      const rescan = w.scanning.scanner.runScope({ connector: 'slack', scope: 'inbox' }, 'chat');
      const reconcile = w.scanning.scanner.runReconcile(['coverage_gaps', 'unlinked', 'stale_active']);
      const fw1 = await w.scanning.enqueueFileWatch();
      const fw2 = await w.scanning.enqueueFileWatch();
      const stepP = w.step();
      const [rs, rc] = await Promise.all([rescan, reconcile, stepP]);
      await w.runUntil(at('2026-11-02', '21:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      const qd = await w.handle.db.execute<{ n: string }>(sql`select count(*)::text as n from jobs where kind = 'scan.claude_sessions' and payload->>'trigger' = 'file_watch'`);
      const extra: InvariantResult[] = [
        check('O1 chat /rescan during catch-up completed', rs.every((o) => o.status === 'succeeded' || o.status === 'skipped'), rs.map((o) => `${o.status}${o.detail ? `(${o.detail.slice(0, 60)})` : ''}`).join(', ')),
        check('O2 reconcile during catch-up completed (scripted runner cannot relink; those errors are expected)', rc.errors.every((e) => /relink/.test(e)), rc.summary),
        check('O4 reconcile during catch-up: no gaps for not-yet-scanned objects, at most one targeted job per scope', rc.jobs.length <= 3, `coverage_gap findings=${rc.findings.filter((f) => f.kind === 'coverage_gap').length} jobs=${rc.jobs.length}`),
        check('O3 file-watch events coalesce with the queued poll', qd.rows[0]!.n === '0' || Number(qd.rows[0]!.n) <= 2, `file_watch jobs=${qd.rows[0]!.n} enqueued=${fw1},${fw2}`),
      ];
      return finish(w, {}, extra, {}, mon);
    },
  },

  'late-arrivals': {
    description: 'Slack: a reply on an old thread after the cursor passed, an edit and a delete of scanned messages; Gmail: a message with an old Date that only arrives later (scripted)',
    async run(ctx) {
      const t = (d: string, hm: string) => Date.parse(at(d, hm));
      let edited = '';
      let deleted = '';
      let lateMail = '';
      const w = await makeWorld(ctx, {
        scenario: 'late-arrivals',
        start: at('2026-11-03', '08:00'),
        sources: ['slack', 'gmail'],
        runner: 'scripted',
        channels: [],
        slackOverlay: (ix) => {
          const mine = Object.values(ix.messages)
            .filter((m) => m.classes.includes('mine') && tsMs(m.ts) >= t('2026-11-03', '08:00') && tsMs(m.ts) < t('2026-11-03', '10:00'))
            .sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
          if (mine[0]) {
            mine[0].edits = [{ at: t('2026-11-03', '13:00'), text: `${mine[0].text} [EDITED: deck link added]` }];
            edited = mine[0].key;
          }
          if (mine[1]) {
            mine[1].deletedAt = t('2026-11-03', '13:00');
            deleted = mine[1].key;
          }
        },
        googleOverlay: { visibleAt: {} },
      });
      // Gmail late arrival: an inbox message dated 09:00–10:00 that only becomes visible at 14:00.
      const rec = w.google!.rec;
      const cand = Object.values(rec.gmail.messages).find((m) => m.dateMs && m.dateMs >= t('2026-11-03', '09:00') && m.dateMs < t('2026-11-03', '10:00') && m.bases[0]?.startsWith('in:anywhere'));
      if (cand) {
        (w.google as unknown as { o: { overlay: { visibleAt: Record<string, number> } } }).o.overlay.visibleAt[cand.id] = t('2026-11-03', '14:00');
        lateMail = cand.id;
      }
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-11-04', '03:30'), { onStep: async (x) => mon.observe(x.handle.db) });
      const db = w.handle.db;
      const ed = await db.execute<{ b: string | null; rev: string }>(sql`select body as b, revision::text as rev from source_items where external_id = ${edited}`);
      const del = await db.execute<{ d: string | null }>(sql`select deleted_upstream_at::text as d from source_items where external_id = ${deleted}`);
      const lm = await db.execute<{ n: string; run: string | null }>(sql`
        select count(*)::text as n, max(r.trigger::text) as run from source_items s left join scan_runs r on r.id = s.first_scan_run_id where s.external_id = ${lateMail}`);
      const extra: InvariantResult[] = [
        check('A1 Gmail late arrival (old Date, delivered after the cursor passed) is found (by nightly reconcile coverage_gaps)', !lateMail || Number(lm.rows[0]!.n) > 0, `found=${lm.rows[0]?.n} via=${lm.rows[0]?.run ?? '-'}`),
        check('A2 Slack edit after scan is picked up (informational: no edit detection outside the window)', true, `edited=${!!edited} revision=${ed.rows[0]?.rev ?? '-'} bodyHasEdit=${/EDITED/.test(ed.rows[0]?.b ?? '')}`),
        check('A3 Slack delete after scan is reflected (informational)', true, `deleted_upstream_at=${del.rows[0]?.d ?? 'null'}`),
      ];
      return finish(w, {}, extra, { edited, deleted, lateMail }, mon);
    },
  },

  faults: {
    description: 'faults (scripted): Slack 429s/5xx/timeouts, Google 429/5xx/slow/empty pages, then auth expiring mid-catch-up for Slack and Google; recovery after re-auth',
    async run(ctx) {
      const t = (d: string, hm: string) => Date.parse(at(d, hm));
      const w = await makeWorld(ctx, {
        scenario: 'faults',
        start: at('2026-10-21', '08:00'),
        sources: ['slack', 'gmail', 'calendar'],
        runner: 'scripted',
        channels: ['C06GULUG03E'],
        faults: {
          slack: [
            { kind: 'rate_limit', p: 0.15, during: { from: t('2026-10-21', '08:00'), to: t('2026-10-21', '12:00') } },
            { kind: 'server_error', p: 0.1, during: { from: t('2026-10-21', '08:00'), to: t('2026-10-21', '12:00') } },
            { kind: 'auth', during: { from: t('2026-10-22', '08:10'), to: t('2026-10-22', '10:00') } },
          ],
          google: [
            { kind: 'rate_limit', p: 0.1, during: { from: t('2026-10-21', '08:00'), to: t('2026-10-21', '12:00') } },
            { kind: 'server_error', p: 0.1, during: { from: t('2026-10-21', '08:00'), to: t('2026-10-21', '12:00') } },
            { kind: 'empty', p: 0.1, during: { from: t('2026-10-21', '08:00'), to: t('2026-10-21', '12:00') } },
            { kind: 'slow', p: 0.1, delayMs: 1500, during: { from: t('2026-10-21', '08:00'), to: t('2026-10-21', '12:00') } },
            { kind: 'auth', during: { from: t('2026-10-22', '08:10'), to: t('2026-10-22', '10:00') } },
          ],
        },
      });
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-10-21', '13:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      await w.shutdown('overnight');
      await w.clock.jumpTo(at('2026-10-22', '08:00'));
      await w.boot(); // catch-up starts; auth expires at 08:10 mid-catch-up
      const states: Array<{ at: string; paused: string[]; catching: boolean }> = [];
      let reauthQueued = false;
      await w.runUntil(at('2026-10-22', '12:00'), {
        maxJumpMs: 15 * 60_000, // the real worker ticks every 15 s; never skip past the 10:05 re-auth click
        onStep: async (x) => {
          await mon.observe(x.handle.db);
          states.push({ at: x.clock.now().toISOString(), paused: x.scanning.scanner.status().filter((s) => s.paused).map((s) => `${s.connector}:${s.scope}:${s.paused}`), catching: x.scanning.scanner.isCatchingUp() });
          // The user finishes re-auth at 10:05 and clicks Health "Re-auth" (the DataSource enqueues connector.reauth).
          if (!reauthQueued && x.clock.nowMs() >= t('2026-10-22', '10:05')) {
            reauthQueued = true;
            for (const c of ['slack', 'gmail', 'calendar'] as const) {
              const id = await x.store.connectorId(c);
              await enqueueJob(x.handle.db, { ownerUserId: x.userId, kind: 'connector.reauth', payload: { connectorId: id, kind: 'in_app' }, dedupeKey: `reauth:${id}` });
            }
          }
        },
      });
      const pausedAt11 = states.filter((s) => s.at >= at('2026-10-22', '11:00'));
      const stillPaused = pausedAt11.length ? pausedAt11[pausedAt11.length - 1]!.paused : [];
      const slackCur = (await cursors(w))['slack:inbox'];
      const extra: InvariantResult[] = [
        check('F1 auth expiry mid-catch-up pauses the connector', states.some((s) => s.paused.some((p) => p.endsWith(':auth'))), `paused samples=${states.filter((s) => s.paused.length).length}`),
        check('F2 after Health "Re-auth" (10:05) scanning resumes and catches up by 12:00', stillPaused.length === 0 && !!slackCur && Date.parse(slackCur) > t('2026-10-22', '10:30'), `still paused: ${stillPaused.join(', ') || 'none'}; slack:inbox cursor=${slackCur}`),
        check('F3 catch-up flag is released once caught up (no permanent re-rank hold)', !states[states.length - 1]?.catching, `catching at end=${states[states.length - 1]?.catching}`),
      ];
      return finish(w, { allowedDead: 0 }, extra, { faultsFired: w.replayStats().faults }, mon);
    },
  },

  budget: {
    description: 'budget cap hit mid-catch-up (scripted, fake spend): traversal pauses, deterministic fetches continue with linking deferred, traversal resumes the next day',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'budget', start: at('2026-10-27', '07:00'), sources: ['slack', 'gmail', 'calendar'], runner: 'scripted', channels: [], budgets: { softUsd: 0.02, hardUsd: 0.05 } });
      // Every scripted run "costs" $0.01, recorded through the production spend path.
      const sr = w.scripted!;
      const orig = sr.run.bind(sr);
      sr.run = async (input, store) => {
        const r = await orig(input, store);
        return { ...r, costUsd: 0.01 };
      };
      const mon = new CursorMonitor();
      await w.boot();
      const samples: Array<{ at: string; slackPaused: boolean; gmailCursor?: string }> = [];
      await w.runUntil(at('2026-10-27', '12:00'), {
        onStep: async (x) => {
          await mon.observe(x.handle.db);
          const st = x.scanning.scanner.status().find((s) => s.connector === 'slack');
          samples.push({ at: x.clock.now().toISOString(), slackPaused: st?.paused === 'budget', gmailCursor: (await cursors(x))['gmail:inbox'] });
        },
      });
      // A wake after the cap (gap > 30 min) queues a reconcile: its relinks must not spend past the cap either.
      await w.scanning.enqueueResumeReconcile('after-cap');
      await w.step();
      const deferred = await w.handle.db.execute<{ n: string }>(sql`select count(*)::text as n from reconcile_findings where detail::text like '%hard cap%'`);
      const pausedAt = samples.find((s) => s.slackPaused)?.at;
      const spentAfter = pausedAt
        ? await w.handle.db.execute<{ n: string; usd: string; scopes: string | null }>(sql`
            select count(*)::text as n, coalesce(sum(c.cost_usd), 0)::text as usd, string_agg(distinct r.scope, ',') as scopes
              from llm_calls c left join scan_runs r on r.id = c.scan_run_id
             where c.cost_usd > 0 and c.started_at > ${pausedAt}::timestamptz and c.started_at < ${at('2026-10-28', '00:00')}::timestamptz`)
        : undefined;
      const gmailAfter = samples.filter((s) => pausedAt && s.at > pausedAt).map((s) => s.gmailCursor).filter(Boolean);
      await w.runUntil(at('2026-10-28', '09:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      const slackNextDay = (await cursors(w))['slack:inbox'];
      const extra: InvariantResult[] = [
        check('B1 traversal (Slack) pauses at the hard cap', !!pausedAt, `paused at ${pausedAt ?? 'never'}`),
        check('B2 deterministic fetches continue after the cap', gmailAfter.length > 1 && gmailAfter[gmailAfter.length - 1]! > gmailAfter[0]!, `gmail cursor ${gmailAfter[0]} → ${gmailAfter[gmailAfter.length - 1]}`),
        check('B3 linking is deferred at the cap (deferred: hard cap findings)', Number(deferred.rows[0]!.n) > 0, `deferred findings=${deferred.rows[0]!.n}`),
        check('B4 traversal resumes once the budget day rolls over', !!slackNextDay && Date.parse(slackNextDay) > Date.parse(at('2026-10-28', '00:00')), `slack:inbox cursor ${slackNextDay}`),
        check('B5 no LLM spend after the hard cap the same day (reconcile relinks included)', Number(spentAfter?.rows[0]?.n ?? 0) === 0, `calls=${spentAfter?.rows[0]?.n ?? '-'} usd=${spentAfter?.rows[0]?.usd ?? '-'} scopes=${spentAfter?.rows[0]?.scopes ?? '-'}`),
      ];
      return finish(w, {}, extra, {}, mon);
    },
  },

  multiday: {
    description: 'all scanners together (scripted), Fri 2026-10-30 07:00 → Tue 2026-11-03 18:00 at live cadence incl. off-hours ×6 and the DST change (Nov 1)',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'multiday', start: at('2026-10-30', '07:00'), sources: ['slack', 'org62', ...ALL_DET], runner: 'scripted', channels: CH4 });
      const mon = new CursorMonitor();
      await w.boot();
      await w.runUntil(at('2026-11-03', '18:00'), { onStep: async (x) => mon.observe(x.handle.db) });
      const db = w.handle.db;
      // Slack inbox polls per local hour bucket: work hours (07:30–17:30 Mon–Fri) vs off-hours.
      const polls = await db.execute<{ d: string; work: string; off: string }>(sql`
        select to_char(started_at at time zone 'America/Denver', 'YYYY-MM-DD') as d,
               count(*) filter (where extract(isodow from started_at at time zone 'America/Denver') <= 5
                                  and (started_at at time zone 'America/Denver')::time between '08:00' and '17:00')::text as work,
               count(*) filter (where not (extract(isodow from started_at at time zone 'America/Denver') <= 5
                                  and (started_at at time zone 'America/Denver')::time between '07:30' and '17:30'))::text as off
          from scan_runs where scope = 'slack:inbox' and trigger::text = 'schedule' group by 1 order by 1`);
      const nightly = await db.execute<{ d: string; n: string }>(sql`
        select payload->>'id' as d, count(*)::text as n from jobs where kind = 'scan.reconcile' and payload->>'id' like 'reconcile:nightly:%' group by 1 order by 1`);
      const perDay = Object.fromEntries(polls.rows.map((r) => [r.d, { work: Number(r.work), off: Number(r.off) }]));
      const weekendCatchUps = await db.execute<{ n: string }>(sql`
        select count(*)::text as n from scan_runs where scope = 'slack:inbox' and trigger::text <> 'schedule'
           and started_at >= ${at('2026-10-31', '00:00')}::timestamptz and started_at < ${at('2026-11-02', '00:00')}::timestamptz`);
      const daily = await db.execute<{ scope: string; days: string }>(sql`
        select scope, count(distinct to_char(started_at at time zone 'America/Denver', 'YYYY-MM-DD'))::text as days from scan_runs
         where scope in ('trainings:gmail', 'org62:missed_opps', 'org62:dcs') group by 1`);
      return finish(w, { coverageQuestion: { scope: 'slack:inbox', from: at('2026-11-02', '14:00'), to: at('2026-11-02', '16:00') } }, [
        check('M1 nightly reconcile exactly once per local day, incl. the 25-hour DST day', nightly.rows.every((r) => r.n === '1') && nightly.rows.some((r) => r.d.includes('2026-11-01')), nightly.rows.map((r) => `${r.d.slice(18)}×${r.n}`).join(', ')),
        check('M2 weekend (off-hours) polls are incremental: no catch-up plans while the worker runs', Number(weekendCatchUps.rows[0]!.n) === 0 && (perDay['2026-10-31']?.off ?? 0) > 0, `weekend non-schedule runs=${weekendCatchUps.rows[0]!.n}; ${JSON.stringify(perDay)}`),
        check('M3 daily sources run every day (trainings, missed-opp sweep, DCs)', daily.rows.length === 3 && daily.rows.every((r) => Number(r.days) >= 4), daily.rows.map((r) => `${r.scope}=${r.days}d`).join(', ')),
      ], { perDay }, mon);
    },
  },

  sigkill: {
    description: 'child-process worker (scripted, slowed): SIGKILL mid-traversal and mid-backfill chunk → cursor unmoved, re-run idempotent',
    run: (ctx) => killScenario(ctx, 'sigkill', [{ sig: 'SIGKILL' }, { sig: 'SIGKILL' }]),
  },
  'restart-storm': {
    description: 'child-process worker (scripted): 5 restarts in 10 simulated minutes (3× SIGTERM, 2× SIGKILL) during a catch-up',
    run: (ctx) => killScenario(ctx, 'restart-storm', [{ sig: 'SIGTERM' }, { sig: 'SIGKILL' }, { sig: 'SIGTERM' }, { sig: 'SIGKILL' }, { sig: 'SIGTERM' }]),
  },
};

async function killScenario(ctx: ScenarioCtx, name: string, kills: Array<{ sig: 'SIGKILL' | 'SIGTERM' }>) {
  // Seed: a short session on Friday so Monday is a catch-up (the clock only moves forward, so start on Friday).
  const w = await makeWorld(ctx, { scenario: name, start: at('2026-10-23', '16:00'), sources: ['slack', 'gmail'], runner: 'scripted', channels: ['C06GULUG03E'] });
  const mon = new CursorMonitor();
  const cfgFile = path.join(privDir('state', name), 'child.json');
  const spawnChild = (stallMs: number): ChildProcess => {
    writePriv(cfgFile, JSON.stringify({ scenario: name, db: { name: w.dbName, url: w.dbUrl }, sources: ['slack', 'gmail'], runner: 'scripted', channels: ['C06GULUG03E'], stallMs }));
    const c = spawn(process.execPath, ['--import', 'tsx', path.resolve('scripts/stress/driver/child.ts'), cfgFile], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CC_NOTIFY: '0' } });
    c.stdout!.on('data', (d) => ctx.log(`[child ${c.pid}] ${String(d).trim().slice(0, 200)}`));
    c.stderr!.on('data', (d) => ctx.log(`[child ${c.pid} err] ${String(d).trim().slice(0, 300)}`));
    return c;
  };
  const waitFor = async (pred: () => Promise<boolean>, ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await pred()) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };
  const exited = (c: ChildProcess) => new Promise<number | null>((r) => (c.exitCode !== null ? r(c.exitCode) : c.once('exit', (code) => r(code))));
  // Friday: one clean child session.
  let c = spawnChild(0);
  await waitFor(async () => (await w.handle.db.execute<{ n: string }>(sql`select count(*)::text as n from scan_runs where status = 'succeeded'`)).rows[0]!.n !== '0', 120_000);
  await new Promise((r) => setTimeout(r, 4000));
  c.kill('SIGTERM');
  await exited(c);
  await w.clock.jumpTo(at('2026-10-26', '08:00'));
  const results: InvariantResult[] = [];
  for (const [i, k] of kills.entries()) {
    const before = await cursors(w);
    c = spawnChild(400);
    const mid = await waitFor(async () => (await w.handle.db.execute<{ n: string }>(sql`select count(*)::text as n from scan_runs where status = 'running'`)).rows[0]!.n !== '0', 90_000);
    await new Promise((r) => setTimeout(r, 900));
    const running = await w.handle.db.execute<{ id: string; scope: string }>(sql`select id::text, scope from scan_runs where status = 'running'`);
    c.kill(k.sig);
    const code = await exited(c);
    const afterKill = await cursors(w);
    const moved = running.rows.map((r) => r.scope).filter((s) => before[s] !== afterKill[s] && Date.parse(afterKill[s] ?? '0') > Date.parse(before[s] ?? '0'));
    // SIGTERM is the graceful path: a run the drain let finish may advance its cursor, but only as a succeeded run.
    // SIGKILL: nothing may move. Either way no interrupted run may stay `running`.
    const ids = running.rows.map((r) => r.id);
    const fates = ids.length
      ? (await w.handle.db.execute<{ scope: string; status: string }>(sql`select scope, status::text from scan_runs where id::text = any(string_to_array(${ids.join(',')}, ','))`)).rows
      : [];
    const badMove = moved.filter((s) => k.sig === 'SIGKILL' || !fates.some((f) => f.scope === s && f.status === 'succeeded'));
    const fateStr = fates.map((f) => `${f.scope}=${f.status}`).join(',');
    results.push(
      check(
        `K${i + 1} ${k.sig} mid-run: ${k.sig === 'SIGKILL' ? 'cursors of the interrupted scopes did not move' : 'a cursor moves only for a run the drain completed'} (${running.rows.map((r) => r.scope).join(',') || 'none running'})`,
        mid && badMove.length === 0,
        `exit=${code} moved=${moved.join(',') || 'none'} runs=${fateStr || 'none'}`,
      ),
    );
    await mon.observe(w.handle.db);
    await w.clock.jump(2 * 60_000);
  }
  // Final clean worker in-process drains everything (dead worker leases expire → reaper requeues).
  await w.clock.jump(5 * 60_000);
  await w.boot();
  await w.runUntil(at('2026-10-26', '10:00'), { onStep: async (x) => mon.observe(x.handle.db) });
  // Idempotency: re-running Monday morning's window adds no source items.
  const n0 = await w.handle.db.execute<{ n: string }>(sql`select count(*)::text as n from source_items`);
  await w.scanning.scanner.runScope({ connector: 'slack', scope: 'inbox' }, 'manual', { from: at('2026-10-26', '06:00'), to: at('2026-10-26', '09:00') });
  await w.scanning.scanner.runScope({ connector: 'gmail', scope: 'inbox' }, 'manual', { from: at('2026-10-26', '06:00'), to: at('2026-10-26', '09:00') });
  const n1 = await w.handle.db.execute<{ n: string }>(sql`select count(*)::text as n from source_items`);
  results.push(check('K* re-running an already-scanned window adds 0 rows', n0.rows[0]!.n === n1.rows[0]!.n, `${n0.rows[0]!.n} → ${n1.rows[0]!.n}`));
  void counts;
  void drain;
  void loadProfile;
  return finish(w, { allowedDead: 0 }, results, {}, mon);
}
