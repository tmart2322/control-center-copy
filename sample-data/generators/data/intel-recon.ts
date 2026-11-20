/**
 * Domain 06: reconcile findings (the engine's coverage and missed-item checks, SCANNER.md section 6) built from the real
 * scan runs, connectors, source items and work items of domains 02 to 04. Statuses follow the real mix (mostly
 * ignored, open and resolved unlinked items; coverage gaps resolved by a rescan; one gap queued today).
 */
import { uid, type Row } from '../../lib/kit';
import { T, must, siId, si, wiId, wi, evidenceOf, keyOfSi, runId, runRow, runNumber, job, connector, connectorByName, mt, iso } from './intel-lib';

type Kind = 'coverage_gap' | 'unlinked_item' | 'missed_item' | 'stale_cursor' | 'count_mismatch' | 'deleted_upstream' | 'duplicate_suspect' | 'orphan_evidence';
type Status = 'open' | 'rescan_queued' | 'resolved' | 'ignored';

const plus = (isoTs: unknown, min: number) => new Date(new Date(String(isoTs)).getTime() + min * 60_000).toISOString();
const connOf = (kind: string) => connector(kind);

export function buildReconcile(owner: string): Row[] {
  const rows: Row[] = [];
  const add = (key: string, r: { kind: Kind; connector?: string | null; run?: number | null; scope?: string | null; gap?: [string, string] | null; si?: string | null; wi?: number | null; detail: string; status: Status; created: string; resolved?: string | null; job?: number | null; note?: string | null; updated?: string }) => {
    rows.push({
      id: uid('reconcile_findings', key), owner_user_id: owner, connector_id: r.connector ?? null,
      scan_run_id: r.run ? runId(r.run) : null, kind: r.kind, scope: r.scope ?? null,
      gap_from: r.gap?.[0] ?? null, gap_to: r.gap?.[1] ?? null,
      source_item_id: r.si ? siId(r.si) : null, work_item_id: r.wi ? wiId(r.wi) : null, chat_message_id: null,
      detail: r.detail, status: r.status, resolution_job_id: r.job ?? null,
      resolved_at: r.status === 'resolved' || r.status === 'ignored' ? r.resolved ?? plus(r.created, 30) : null,
      resolution_note: r.note ?? null, created_at: r.created, updated_at: r.updated ?? r.resolved ?? r.created,
    });
  };
  const runStart = (n: number) => String(runRow(n).started_at);
  const runEnd = (n: number) => String(runRow(n).finished_at ?? runRow(n).started_at);
  const jobOf = (n: number) => (runRow(n).job_id as number | null) ?? null;

  // ── coverage gaps (storyline 8) ────────────────────────────────────────────────────────────────
  add('cg-slack-1021', { kind: 'coverage_gap', connector: connOf('slack'), run: 35, scope: 'inbox', gap: ['2026-10-21T20:10:00.000Z', '2026-10-21T21:10:00.000Z'], detail: 'uncovered window behind the cursor', status: 'resolved', created: runEnd(35), resolved: plus(runEnd(35), 6), job: jobOf(35), note: 'Targeted backfill covered the hour; 2 new items recorded.' });
  add('cg-slack-1112', { kind: 'coverage_gap', connector: connOf('slack'), run: 121, scope: 'inbox', gap: ['2026-11-12T15:05:00.000Z', '2026-11-12T17:12:00.000Z'], detail: 'uncovered window behind the cursor (rate-limited runs 113 to 116, 08:20 to 09:05 MT)', status: 'resolved', created: runEnd(121), resolved: plus(runEnd(121), 14), job: jobOf(121), note: 'Run 117 recovered the cursor at 10:12; the reconcile rescan found 3 items posted during the gap.' });
  add('cg-drive-1114', { kind: 'coverage_gap', connector: connOf('drive'), run: 135, scope: 'tracked', gap: [runStart(134), runEnd(135)], detail: 'uncovered window behind the cursor (Drive authorization expired 14:10 MT, reconnected 14:54)', status: 'resolved', created: runEnd(135), resolved: plus(runEnd(135), 25), job: jobOf(135), note: 'Reconnected by hand; the next tracked scan read every revision since 14:10.' });
  add('cg-vdp-1104', { kind: 'coverage_gap', connector: connOf('vdp'), run: 70, scope: 'mine', gap: [runStart(69), runEnd(70)], detail: 'uncovered window behind the cursor (VDP cookie lapse, re-auth succeeded 11:34)', status: 'resolved', created: runEnd(70), resolved: plus(runEnd(70), 20), job: jobOf(70), note: 'Mirror re-read after the cookie refresh; nothing changed in the window.' });
  add('cg-org62-1105', { kind: 'coverage_gap', connector: connOf('org62'), run: 72, scope: 'events', gap: [runStart(71), runEnd(72)], detail: 'uncovered window behind the cursor (Org62 REQUEST_LIMIT_EXCEEDED)', status: 'resolved', created: runEnd(72), resolved: plus(runEnd(72), 90), job: jobOf(72), note: 'Events re-read after the daily limit reset.' });
  add('cg-gemini-1104', { kind: 'coverage_gap', connector: connOf('gemini_notes'), run: 66, scope: 'poll', gap: [plus(runStart(66), -240), runEnd(66)], detail: 'uncovered window behind the cursor (poll timed out)', status: 'resolved', created: runEnd(66), resolved: plus(runEnd(66), 40), job: jobOf(66), note: 'The next poll read the notes folder and found the meeting notes.' });
  add('cg-vdp-1118', { kind: 'coverage_gap', connector: connOf('vdp'), run: 149, scope: 'mine', gap: [runStart(149), runStart(151)], detail: 'uncovered window behind the cursor (VDP auth failure 08:11, re-auth 08:29 after one dead job)', status: 'ignored', created: runEnd(149), resolved: plus(runStart(151), 2), job: null, note: 'Run 151 read the mirror right after re-auth; nothing to backfill.' });
  add('cg-slack-1118', { kind: 'coverage_gap', connector: connOf('slack'), run: 153, scope: 'inbox', gap: [runStart(152), plus(runEnd(153), 1)], detail: 'uncovered window behind the cursor (two rate-limited runs this morning, degraded since 08:41)', status: 'rescan_queued', created: runEnd(153), job: 485, note: null, updated: '2026-11-18T15:41:01.000Z' });

  // ── missed items: open items whose source thread moved after the last evidence (stale_active) ───
  const missed: Array<[number, number, string, Status, string?]> = [
    // [work item n, reconcile run n, detail suffix, status, note]
    [8, 79, 'thread may have moved', 'resolved', 'Targeted thread read found no new reply; the item stays waiting on Anjali.'],
    [7, 79, 'thread may have moved', 'resolved', 'Targeted thread read linked a new message from Marisol as evidence.'],
    [17, 79, 'thread may have moved', 'open'],
    [54, 121, 'thread may have moved', 'resolved', 'Re-evaluated with the revised KPI list; the item stayed open until Marisol\'s baseline arrived.'],
    [40, 137, 'thread may have moved', 'open'],
    [75, 137, 'thread may have moved', 'resolved', 'Linked the sent email to Lars; the item was closed in chat on Nov 17.'],
  ];
  for (const [n, run, why, st, note] of missed) {
    const w = wi(n);
    const origin = evidenceOf(n)[0];
    const rEnd = runEnd(run);
    const created = rEnd > String(w.created_at) ? rEnd : plus(w.created_at, 5);
    const m = origin ? (si(keyOfSi(origin)).meta as any) : null;
    const scope = m?.channelId ? `thread:${m.channelId}:${m.ts}` : origin ? `${String(si(keyOfSi(origin)).source)}:${String(si(keyOfSi(origin)).external_id)}` : null;
    add(`mi-wi${n}-r${run}`, { kind: 'missed_item', connector: String(runRow(run).connector_id), run, scope, si: origin ? keyOfSi(origin) : null, wi: n, detail: `stale_active: open item, ${why}`, status: st, created, resolved: st === 'resolved' ? plus(created, 12) : null, job: st === 'resolved' ? jobOf(run) : null, note: note ?? null });
  }

  // ── unlinked items (the biggest bucket in real data) ───────────────────────────────────────────
  type U = [string, Status, string, number | null, string?];
  const unlinked: U[] = [
    ['si-146', 'ignored', 'recorded only: not actionable for me', null],
    ['si-384', 'ignored', 'recorded only: not actionable for me', null],
    ['si-609', 'ignored', 'recorded only: not actionable for me', null],
    ['si-234', 'ignored', 'no mapping question: not an ask or commitment of mine', null],
    ['si-164', 'ignored', 'recorded only: not actionable for me', null],
    ['si-284', 'ignored', 'recorded only: not actionable for me', null],
    ['si-149', 'ignored', 'no mapping question: not an ask or commitment of mine', null],
    ['si-073', 'ignored', 'recorded only: not actionable for me', null],
    ['si-352', 'ignored', 'recorded only: not actionable for me', null],
    ['si-460', 'open', 'mapping-question: still unlinked (attempt 2)', null],
    ['si-602', 'open', 'mapping-question: still unlinked (attempt 1)', null],
    ['si-406', 'open', 'recorded only: no capture rule matches an expense reminder', null],
    ['si-258', 'open', 'mapping-question: still unlinked (attempt 1)', null],
    ['si-624', 'open', 'recorded only: not actionable for me', null],
    ['si-626', 'open', 'triage question (suggested): a question you asked in #data-ai-specialists', null],
    ['si-591', 'resolved', 'triage question (suggested)', 65, 'Linked to "Pick Thursday or Friday for the Ferrowpay architecture session" on the next scan.'],
    ['si-574', 'resolved', 'still unlinked (attempt 1)', 29, 'Linked to the Friday dry-run item once the calendar event arrived.'],
    ['si-707', 'resolved', 'still unlinked (attempt 1)', 32, 'Linked to the order-status demo item once the calendar hold arrived.'],
    ['si-655', 'resolved', 'still unlinked (attempt 1)', 66, 'Linked to the Ferrowpay architecture session prep item.'],
  ];
  for (const [k, st, detail, wn, note] of unlinked) {
    const r = si(k);
    const first = String(r.first_seen_at);
    const recRun = first < runEnd(50) ? 50 : first < runEnd(137) ? 137 : null;
    const retried = st !== 'open' && recRun && String(r.source) === 'gmail';
    const created = plus(first, 3);
    const runN = retried ? recRun! : runNumber(String(r.first_scan_run_id));
    const r1 = retried ? plus(runEnd(recRun!), 1) : plus(created, 25);
    const resolved = r1 > plus(created, 5) ? r1 : plus(created, 5);
    add(`ul-${k}`, { kind: 'unlinked_item', connector: String(r.connector_id), run: runN || null, si: k, wi: wn ?? null, detail, status: st, created, resolved: st === 'open' ? null : resolved, note: note ?? (st === 'ignored' ? 'Not actionable; recorded only.' : null) });
  }

  // ── stale cursors, count mismatches, deleted upstream, duplicates, orphan evidence ─────────────
  const cursors: Array<[string, string, string]> = [
    ['slack:channel:C0SMPL003', 'open', 'cursor at 2026-10-18 18:30 UTC; #elderglen-outdoors-deal has newer messages that only the inbox scan recorded'],
    ['slack:channel:C0SMPL005', 'ignored', 'cursor at 2026-10-20 14:55 UTC; channel is quiet (pursuit retired)'],
    ['gmail:sent', 'open', 'cursor at 2026-11-07 20:42 UTC; sent mail since then is only reached through threads'],
  ];
  for (const [scope, st, detail] of cursors) {
    const sc = T('scan_cursors').find((c) => c.scope === scope)!;
    add(`sc-${scope}`, { kind: 'stale_cursor', connector: String(sc.connector_id), run: null, scope, gap: [String(sc.high_watermark_at), '2026-11-18T14:00:00.000Z'], detail, status: st as Status, created: '2026-11-17T14:02:00.000Z', resolved: st === 'ignored' ? '2026-11-17T14:20:00.000Z' : null, note: st === 'ignored' ? 'Expected: the channel is retired.' : null });
  }
  add('cm-gmail-1116', { kind: 'count_mismatch', connector: connOf('gmail'), run: 137, scope: 'gmail:inbox', gap: ['2026-11-13T13:58:00.000Z', '2026-11-16T13:58:00.000Z'], detail: 'Gmail lists 36 messages in the window; the ledger covers 34', status: 'resolved', created: runEnd(137), resolved: plus(runEnd(137), 8), job: jobOf(137), note: 'The 2 missing messages were calendar notices dedupe had folded into their events.' });
  add('cm-org62-1117', { kind: 'count_mismatch', connector: connOf('org62'), run: 143, scope: 'org62:opps', gap: ['2026-11-14T14:02:00.000Z', '2026-11-17T14:02:00.000Z'], detail: 'Org62 lists 25 open opportunities; the app tracks 25 with 1 refreshed after the window', status: 'ignored', created: runEnd(143), resolved: plus(runEnd(143), 5), note: 'Counts agree once the snapshot of Nov 17 is included.' });
  const dels: Array<[string, string, string]> = [
    ['si-357', 'org62', 'Org62 Event 00USMPL00000022AAA (Elderglen Home POC, Nov 3) was deleted upstream; the logged entry no longer has a remote record'],
    ['si-369', 'slack', 'Slack message in #elderglen-outdoors-deal ("Pricing sheet for the wrong deal, ignore") was deleted upstream'],
    ['si-465', 'calendar', 'Calendar event "Saltmere prep" (Nov 10, 10:30) was cancelled upstream'],
  ];
  for (const [k, , detail] of dels) {
    const r = si(k);
    const del = String(r.deleted_upstream_at);
    add(`du-${k}`, { kind: 'deleted_upstream', connector: String(r.connector_id), run: runNumber(String(r.last_scan_run_id)) || null, si: k, detail, status: 'resolved', created: del, resolved: plus(del, 6), note: k === 'si-357' ? 'Surfaced in Time: the entry is marked "deleted in Org62" and needs a decision.' : 'Marked deleted; derived items re-evaluated.' });
  }
  add('dup-si-051', { kind: 'duplicate_suspect', connector: connOf('gmail'), run: null, si: 'si-051', detail: 'Same meeting as the Gemini note si-050 (notification email and the note itself)', status: 'ignored', created: plus(si('si-051').first_seen_at, 4), resolved: plus(si('si-051').first_seen_at, 20), note: 'Expected: a notification about a note that was already read.' });
  add('dup-si-195', { kind: 'duplicate_suspect', connector: connOf('gmail'), run: null, si: 'si-195', detail: 'Notification email for the Saltmere weekly sync of Oct 29; the note is a separate source item', status: 'ignored', created: plus(si('si-195').first_seen_at, 4), resolved: plus(si('si-195').first_seen_at, 18), note: 'Expected duplicate; no action.' });
  add('oe-wi012', { kind: 'orphan_evidence', connector: null, run: null, wi: 12, detail: '"Blueprint draft" has no evidence rows after its merge into the Saltmere blueprint item', status: 'ignored', created: '2026-11-14T19:30:00.000Z', resolved: '2026-11-14T19:45:00.000Z', note: 'Merged items keep the relation, not the evidence.' });
  return rows;
}
