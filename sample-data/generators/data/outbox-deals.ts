/** Logging canvases, canvas sync runs and lines, deal contributions, missed-opportunity sweeps and findings, landings (D-47, D-67, D-68, D-70, D-75). */
import { OWNER, readTable, sha, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import type { DSpec } from './outbox-build';
import { T, acctSf, mtLabel, oppSf, plusMin } from './outbox-lib';

const fmtDay = (iso: string) => new Date(new Date(iso).getTime() - 7 * 3600_000).toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).replace(',', '');
const fmtClock = (iso: string) => new Date(new Date(iso).getTime() - 7 * 3600_000).toISOString().slice(11, 16);
const oppNames = () => new Map(readTable('opportunities').map((r) => [r.id as string, String(r.name)]));
const ttNames = () => new Map(readTable('se_task_types').map((r) => [r.id as string, String(r.name)]));
const mtNames = () => new Map(readTable('org62_picklist_values').map((r) => [r.id as string, String(r.value)]));

export const CANVAS_URL = (id: string) => `https://example.com/slack/canvas/${id}`;
type Ent = Record<string, Row>; // entries by key

const row = (e: Row, on: Map<string, string>, tt: Map<string, string>, mt: Map<string, string>) =>
  `| ${fmtDay(e.starts_at as string)} | ${fmtClock(e.starts_at as string)}-${fmtClock(e.ends_at as string)} | ${e.subject} | ${tt.get(e.se_task_type_id as string) ?? ''}${e.meeting_type_id ? ` (${mt.get(e.meeting_type_id as string)})` : ''} | ${e.opportunity_id ? on.get(e.opportunity_id as string) : '-'} | ${Number(e.duration_hours).toFixed(2)} |`;
const HEAD = '| Date | Time | Subject | Task type | Related to | Hours |\n|---|---|---|---|---|---|';

export type CanvasPlan = {
  /** canvas drafts (specs), keyed so landings can point at them */
  drafts: DSpec[];
  canvases: Row[]; runs: Row[]; lines: Row[];
  markdown: Record<string, string>;
  keys: { batch1113: string[]; dc1114: string[]; week1116: string[] };
  ids: Record<string, string>;
};

const BATCH1113 = ['act-o62-32', 'act-o62-33', 'act-o62-34', 'act-o62-35', 'act-o62-36', 'act-o62-37', 'act-o62-38', 'act-o62-39', 'act-o62-40', 'act-o62-41', 'act-o62-42', 'act-o62-43', 'act-o62-45'];
const WEEK1116 = ['nba-wi003-focus-log', 'act-w-aw-arch-m2', 'act-w-pc-sync-m2', 'act-w-hv-sync-m1', 'act-w-hv-debrief-m1', 'act-w-to-demo-build', 'nba-wi090-week-1116', 'act-w-se-sync-p0', 'act-w-qp-dry', 'act-w-pc-order', 'act-w-qp-sync-p0', 'act-w-to-demoprep'];

export function buildCanvases(E: Ent, changeSetOf: (entryKey: string) => string | null): CanvasPlan {
  const on = oppNames(); const tt = ttNames(); const mt = mtNames();
  const sum = (ks: string[]) => ks.reduce((a, k) => a + Number(E[k]!.duration_hours), 0);
  const ids = (ks: string[]) => ks.map((k) => E[k]!.id as string);
  const md: Record<string, string> = {};
  md.batch1113 = `# Logging batch: week of 11/09 (private)\n\nCreated by Control Center on Fri 11/13 09:28 MT. Tick a row or write \`=> skip\`, \`=> 1.5h\` or \`=> 006...\` after it to change it; then tell Slackbot "Execute this canvas".\n\n## ADD EVENTS (${BATCH1113.length} events, ${sum(BATCH1113).toFixed(2)} h)\n${HEAD}\n${BATCH1113.map((k) => row(E[k]!, on, tt, mt)).join('\n')}\n\n## NEEDS INPUT (1)\n- Ferrowpay - transaction schema mapping to DMOs (Thu 11/05, 1.75 h): which opportunity? Fraud Investigation Agent or Data 360 Foundation.\n\n## RECENTLY LOGGED\n- 11/06 Fri: 13 events logged by hand (verified in Org62 on 11/09).`;
  md.work1024 = `# Work order: deal contributions\n\n## ADD DEAL CONTRIBUTIONS (2)\n| Opportunity | Role | Split | Comment |\n|---|---|---|---|\n| Oakhallow Mutual Insurance - Agentforce Pilot | AI + Data Architect | 50% | Built and demoed the pilot topics; retro on 10/23. |\n| Ferrowpay Financial - Risk Scoring Pilot | Solution Architect | 33% | Scoring prototype and the readout deck. |`;
  md.review1106 = `# Team logging review (week of 11/02)\n\n## RECENTLY LOGGED\n${HEAD}\n${['ops-ae-1', 'ops-ae-2'].map((k) => row(E[k]!, on, tt, mt)).join('\n')}\n\n## UPCOMING\n- 11/09: Yarrowdale architecture review, Oakhallow negotiation sync.`;
  md.review1113 = `# Team logging review (week of 11/09)\n\n## RECENTLY LOGGED (13)\n${HEAD}\n${BATCH1113.slice(0, 6).map((k) => row(E[k]!, on, tt, mt)).join('\n')}\n\n## NEEDS INPUT (1)\n- Ferrowpay schema mapping session (11/05): two matching opportunities.\n\n## UPCOMING\n- Fri 11/20: blueprint focus, weekly log.`;
  md.dc1114 = `# Logging batch: deal contribution and corrections (private)\n\n## ADD DEAL CONTRIBUTIONS (1)\n| Opportunity | Role | Split | Comment |\n|---|---|---|---|\n| Harrowgate Manufacturing - Predictive Maintenance Agent | AI + Data Architect | 40% | Two plant-manager demos (10/28, 11/10), demo build and dashboards; evidence in Drive and my Claude sessions. |\n\n## ADD EVENTS (1)\n${HEAD}\n${row(E['dc-harrowgate-maintenance-agent']!, on, tt, mt)}\n\n## UPDATE FIELDS (2)\n- upd:Event:00USMPL00000018AAA:Duration__c => 1.0\n- upd:Event:00USMPL00000030AAA:Duration__c => 1.5\n\n## DELETE EVENTS (1)\n- del:Event:00USMPL00000045AAA (duplicate of 00USMPL00000026AAA)`;
  md.week1116 = `# Logging batch: week of 11/16 (private)\n\n## ADD EVENTS (${WEEK1116.length} events, ${sum(WEEK1116).toFixed(2)} h)\n${HEAD}\n${WEEK1116.map((k) => row(E[k]!, on, tt, mt)).join('\n')}\n\n## ADD EVENTS (re-create)\n${row(E['recreate-th-validation']!, on, tt, mt)}\n\n## USE CASES (1)\n- Claims Triage Agent (Oakhallow): Org62 has stage U03 and go-live 2026-12-15; VDP kept the stage only (see Activity > VDP)`;

  const mkPayload = (title: string, markdown: string, evIds: string[], updIds: string[], hours: number, label: string) => ({
    action: 'canvas.create', kind: 'logging_canvas', target: { label, url: null }, text: markdown,
    changes: [{ label: title, before: null, after: markdown.slice(0, 400) }], input: { eventIds: evIds, hours, markdown, part: 1, parts: 1, title, updateIds: updIds, updates: updIds.length },
  });
  const drafts: DSpec[] = [];
  drafts.push({ key: 'cv-work-1024', kind: 'canvas_rewrite', status: 'verified', created: '10-24 11:40', by: 'engine', model: null, voice: false, title: 'Work-order canvas: add two deal contributions',
    payload: { ...mkPayload('Work order: deal contributions', md.work1024, [], [], 0, 'Slackbot work-order canvas'), action: 'canvas.rewrite' }, targetId: 'F0SMPLWORK1', policy: null, level: 'L1_draft', ap: '10-24 12:02', apm: 'click', se: '10-24 12:02:12', vf: '10-24 13:10', resultUrl: CANVAS_URL('F0SMPLWORK1'), job: null,
    atts: [{ at: '10-24 12:02:05', status: 'succeeded', ext: 'F0SMPLWORK1', sec: 7 }], vers: [{ at: '10-24 13:10', method: 'canvas_read', status: 'matched', ext: 'F0SMPLWORK1' }], docJson: null });
  drafts.push({ key: 'cv-review-1106', kind: 'canvas_rewrite', status: 'verified', created: '11-06 10:30', by: 'engine', model: null, voice: false, title: 'Team review canvas: week of 11/02', payload: { ...mkPayload('Team logging review (week of 11/02)', md.review1106, ids(['ops-ae-1', 'ops-ae-2']), [], 1.5, 'Team logging review (shared)'), action: 'canvas.rewrite' },
    targetId: 'F0SMPL001', level: 'L3_one_click', policy: 'canvas_rewrite:F0SMPL001', ap: '11-06 10:35', apm: 'click', se: '11-06 10:35:09', vf: '11-06 10:50', resultUrl: CANVAS_URL('F0SMPL001'), atts: [{ at: '11-06 10:35:04', status: 'succeeded', ext: 'F0SMPL001', sec: 5 }], vers: [{ at: '11-06 10:50', method: 'canvas_read', status: 'matched', ext: 'F0SMPL001' }], docJson: null });
  drafts.push({ key: 'cv-batch-1113', kind: 'canvas_rewrite', status: 'verified', created: '11-12 16:10:30', nba: 'wi-089:v1', by: 'engine', model: null, voice: false, title: 'Logging canvas: week of 11/09 (13 events)',
    payload: mkPayload('Logging batch: week of 11/09', md.batch1113, ids(BATCH1113), [], sum(BATCH1113), 'Logging batch 11/13 (private canvas)'), targetId: 'F0SMPLB1113', policy: null, level: 'L1_draft', wi: 89, ap: '11-13 09:28', apm: 'click', se: '11-13 09:28:19', vf: '11-13 09:36', resultUrl: CANVAS_URL('F0SMPLB1113'),
    atts: [{ at: '11-13 09:28:05', status: 'succeeded', ext: 'F0SMPLB1113', sec: 14 }], vers: [{ at: '11-13 09:36', method: 'canvas_read', status: 'matched', ext: 'F0SMPLB1113', diff: '13 of 13 rows ticked by Slackbot; no marks' }], docJson: null });
  drafts.push({ key: 'cv-review-1113', kind: 'canvas_rewrite', status: 'verified', created: '11-13 16:50', by: 'engine', model: null, voice: false, title: 'Team review canvas: week of 11/09', payload: { ...mkPayload('Team logging review (week of 11/09)', md.review1113, ids(BATCH1113.slice(0, 6)), [], 0, 'Team logging review (shared)'), action: 'canvas.rewrite' },
    targetId: 'F0SMPL001', level: 'L3_one_click', policy: 'canvas_rewrite:F0SMPL001', ap: '11-13 17:04', apm: 'click', se: '11-13 17:05:31', vf: '11-13 17:30', resultUrl: CANVAS_URL('F0SMPL001'), job: 383, atts: [{ at: '11-13 17:05:08', status: 'succeeded', ext: 'F0SMPL001', sec: 23, job: 383 }], vers: [{ at: '11-13 17:30', method: 'canvas_read', status: 'matched', ext: 'F0SMPL001' }], docJson: null });
  drafts.push({ key: 'cv-dc-1114', kind: 'canvas_rewrite', status: 'verified', created: '11-13 08:10:20', nba: 'wi-049:v1', wi: 49, by: 'engine', model: null, voice: false, title: 'Logging canvas: Harrowgate deal contribution and corrections',
    payload: mkPayload('Logging batch: deal contribution and corrections', md.dc1114, ids(['dc-harrowgate-maintenance-agent']), ids(['bf-o62-18', 'bf-o62-30', 'del-o62-45']), 1.75, 'Logging batch 11/14 (private canvas)'), targetId: 'F0SMPLB1114', policy: null, level: 'L1_draft', ap: '11-14 09:18', apm: 'click', se: '11-14 09:19:02', vf: '11-14 09:20', resultUrl: CANVAS_URL('F0SMPLB1114'),
    atts: [{ at: '11-14 09:18:10', status: 'unknown', code: 'outcome_unknown', msg: 'The canvas create got no answer (relay timeout after 30 s). It may have been created: check before you Apply again.', sec: 30 }],
    vers: [{ at: '11-14 09:20', method: 'canvas_read', status: 'matched', ext: 'F0SMPLB1114', diff: 'Canvas found by title in the owner\'s canvases; 5 rows present, none ticked yet', att: 0 }], docJson: null });
  drafts.push({ key: 'cv-batch-1116', kind: 'canvas_rewrite', status: 'ready', created: '11-16 16:49:30', nba: 'wi-090:v1', wi: 90, by: 'engine', model: null, voice: false, title: 'Logging canvas: week of 11/16 (12 events, 14.25 h)',
    payload: mkPayload('Logging batch: week of 11/16', md.week1116, ids([...WEEK1116, 'recreate-th-validation']), [], sum(WEEK1116), 'Logging batch 11/16 (private canvas)'), policy: null, level: 'L1_draft', docJson: null, upd: '11-18 08:20' });

  // canvases
  const canvases: Row[] = [
    { id: uid('canvases', 'F0SMPL001'), owner_user_id: OWNER, external_id: 'F0SMPL001', purpose: 'review_dashboard', title: 'Team logging review (shared)', url: CANVAS_URL('F0SMPL001'), write_approved_at: T('10-20 09:15'), write_approval_note: 'Rafael approved rewrites of the shared review canvas in chat on 10-20 ("keep it current for the Friday review")', sync_status: 'in_sync', last_rendered_hash: sha(md.review1113), last_written_at: T('11-13 17:05:31'), last_read_at: T('11-18 07:02'), last_error_code: null, created_at: T('10-20 09:15'), updated_at: T('11-18 07:02') },
    { id: uid('canvases', 'F0SMPLWORK1'), owner_user_id: OWNER, external_id: 'F0SMPLWORK1', purpose: 'slackbot_work_order', title: 'Work order (Slackbot)', url: CANVAS_URL('F0SMPLWORK1'), write_approved_at: T('10-19 10:05'), write_approval_note: 'The work-order canvas is the one Slackbot reads; approved by Rafael on first setup', sync_status: 'in_sync', last_rendered_hash: sha(md.work1024), last_written_at: T('10-24 12:02:12'), last_read_at: T('11-17 07:02'), last_error_code: null, created_at: T('10-19 10:05'), updated_at: T('11-17 07:02') },
    { id: uid('canvases', 'F0SMPLB1113'), owner_user_id: OWNER, external_id: 'F0SMPLB1113', purpose: 'slackbot_work_order', title: 'Logging batch 11/13 (private canvas)', url: CANVAS_URL('F0SMPLB1113'), write_approved_at: T('11-13 09:28'), write_approval_note: 'Created by the app for one batch (D-47); no later writes', sync_status: 'in_sync', last_rendered_hash: sha(md.batch1113), last_written_at: T('11-13 09:28:19'), last_read_at: T('11-13 09:36'), last_error_code: null, created_at: T('11-13 09:28:19'), updated_at: T('11-13 09:36') },
    { id: uid('canvases', 'F0SMPLB1114'), owner_user_id: OWNER, external_id: 'F0SMPLB1114', purpose: 'slackbot_work_order', title: 'Logging batch 11/14 (private canvas)', url: CANVAS_URL('F0SMPLB1114'), write_approved_at: T('11-14 09:18'), write_approval_note: 'Created by the app for one batch (D-47); rows wait for "Execute this canvas"', sync_status: 'in_sync', last_rendered_hash: sha(md.dc1114), last_written_at: T('11-14 09:19:02'), last_read_at: T('11-18 07:02'), last_error_code: null, created_at: T('11-14 09:19:02'), updated_at: T('11-18 07:02') },
  ];
  const cid = (k: string) => uid('canvases', k);
  const runs: Row[] = []; const lines: Row[] = [];
  const run = (key: string, canvas: string, draft: string | null, started: string, finished: string | null, o: Partial<Row> = {}) => {
    const id = uid('canvas_sync_runs', key);
    runs.push({ id, canvas_id: cid(canvas), draft_id: draft ? uid('drafts', draft) : null, status: 'succeeded', marks_source_item_id: null, marks_applied: 0, rendered_hash: null, skipped_unchanged: false, line_count: 0, started_at: T(started), finished_at: finished ? T(finished) : null, error_code: null, ...o });
    return id;
  };
  const line = (runId: string, lineKey: string, section: string, rendered: string, o: Partial<Row> = {}) => lines.push({ id: uid('canvas_lines', `${runId}:${lineKey}`), sync_run_id: runId, line_key: lineKey, section, activity_entry_id: null, dc_request_id: null, rendered, checked_on_read: null, mark_text: null, mark_applied_at: null, change_set_id: null, ...o });
  const rendered = (k: string) => row(E[k]!, on, tt, mt);

  // F0SMPLWORK1: 10-24 DC rows, then reads
  const rWork = run('work-1024-write', 'F0SMPLWORK1', 'cv-work-1024', '10-24 12:02:05', '10-24 12:02:12', { rendered_hash: sha(md.work1024), line_count: 2 });
  line(rWork, `dc:${oppSf('oakhallow-agentforce-pilot')}`, 'add_deal_contributions', 'Oakhallow Mutual Insurance - Agentforce Pilot | AI + Data Architect | 50%', { dc_request_id: uid('deal_contribution_requests', 'dcr-oakhallow-pilot'), checked_on_read: true });
  line(rWork, `dc:${oppSf('ferrowpay-risk-score-pilot')}`, 'add_deal_contributions', 'Ferrowpay Financial - Risk Scoring Pilot | Solution Architect | 33%', { dc_request_id: uid('deal_contribution_requests', 'dcr-ferrowpay-pilot'), checked_on_read: true });
  run('work-1025-read', 'F0SMPLWORK1', null, '10-25 13:10', '10-25 13:10:04', { marks_applied: 0 });
  run('work-1117-read', 'F0SMPLWORK1', null, '11-17 07:02', '11-17 07:02:03', { skipped_unchanged: true });

  // F0SMPL001: review canvas (writes on 11-06 and 11-13; reads with marks the user typed on the canvas)
  const rW1 = run('f1-1106-write', 'F0SMPL001', 'cv-review-1106', '11-06 10:35:04', '11-06 10:35:09', { rendered_hash: sha(md.review1106), line_count: 3 });
  line(rW1, `event:${E['ops-ae-1']!.id}`, 'recently_logged', rendered('ops-ae-1'), { activity_entry_id: E['ops-ae-1']!.id, checked_on_read: true, mark_text: '=> Customer Presentation', mark_applied_at: T('11-06 13:20'), change_set_id: changeSetOf('ops-ae-1') });
  line(rW1, `event:${E['ops-ae-2']!.id}`, 'recently_logged', rendered('ops-ae-2'), { activity_entry_id: E['ops-ae-2']!.id, checked_on_read: true, mark_text: '=> 1.5h', mark_applied_at: T('11-08 10:05'), change_set_id: changeSetOf('ops-ae-2') });
  line(rW1, 'upcoming:week-1109', 'upcoming', 'Mon 11/09: Yarrowdale architecture review, Oakhallow negotiation sync');
  run('f1-1106-read', 'F0SMPL001', null, '11-06 13:20', '11-06 13:20:06', { marks_applied: 1 });
  run('f1-1108-read', 'F0SMPL001', null, '11-08 10:05', '11-08 10:05:05', { marks_applied: 1 });
  run('f1-1113-read', 'F0SMPL001', null, '11-13 16:58', '11-13 16:58:04', { marks_applied: 0 });
  const rW2 = run('f1-1113-write', 'F0SMPL001', 'cv-review-1113', '11-13 17:05:08', '11-13 17:05:31', { rendered_hash: sha(md.review1113), line_count: 8 });
  BATCH1113.slice(0, 6).forEach((k) => line(rW2, `event:${E[k]!.id}`, 'recently_logged', rendered(k), { activity_entry_id: E[k]!.id, checked_on_read: true }));
  line(rW2, `event:${E['ev-cs05-mapping']!.id}`, 'needs_input', 'Ferrowpay - transaction schema mapping to DMOs (11/05, 1.75 h): which opportunity?', { activity_entry_id: E['ev-cs05-mapping']!.id });
  line(rW2, 'upcoming:fri-1120', 'upcoming', 'Fri 11/20: blueprint focus 11:00-13:30, weekly Org62 log 16:00');
  run('f1-1118-read', 'F0SMPL001', null, '11-18 07:02', '11-18 07:02:04', { skipped_unchanged: true });

  // per-batch canvases
  const rA = run('b1113-apply', 'F0SMPLB1113', 'cv-batch-1113', '11-13 09:28:05', '11-13 09:28:19', { rendered_hash: sha(md.batch1113), line_count: BATCH1113.length + 1 });
  BATCH1113.forEach((k) => line(rA, `event:${E[k]!.id}`, 'add_events', rendered(k), { activity_entry_id: E[k]!.id, checked_on_read: true }));
  line(rA, `event:${E['ev-cs05-mapping']!.id}`, 'needs_input', 'Ferrowpay - transaction schema mapping to DMOs (11/05, 1.75 h): which opportunity?', { activity_entry_id: E['ev-cs05-mapping']!.id, checked_on_read: false });
  run('b1113-read', 'F0SMPLB1113', null, '11-13 09:36', '11-13 09:36:08', { marks_applied: 0 });
  const rB = run('b1114-apply', 'F0SMPLB1114', 'cv-dc-1114', '11-14 09:18:10', '11-14 09:20:10', { rendered_hash: sha(md.dc1114), line_count: 5 });
  line(rB, `dc:${oppSf('harrowgate-maintenance-agent')}`, 'add_deal_contributions', 'Harrowgate Manufacturing - Predictive Maintenance Agent | AI + Data Architect | 40%', { dc_request_id: uid('deal_contribution_requests', 'dcr-harrowgate'), checked_on_read: false });
  line(rB, `event:${E['dc-harrowgate-maintenance-agent']!.id}`, 'add_events', rendered('dc-harrowgate-maintenance-agent'), { activity_entry_id: E['dc-harrowgate-maintenance-agent']!.id, checked_on_read: false });
  line(rB, 'upd:Event:00USMPL00000018AAA:Duration__c', 'update_fields', 'SE team sync (10/28): Duration__c empty => 1.0', { activity_entry_id: E['bf-o62-18']!.id, checked_on_read: false });
  line(rB, 'upd:Event:00USMPL00000030AAA:Duration__c', 'update_fields', 'Elderglen Home - technical validation kickoff (11/06): Duration__c empty => 1.5', { activity_entry_id: E['bf-o62-30']!.id, checked_on_read: false });
  line(rB, 'del:Event:00USMPL00000045AAA', 'delete_events', 'Saltmere - weekly sync (11/05), duplicate of 00USMPL00000026AAA', { activity_entry_id: E['del-o62-45']!.id, checked_on_read: false });
  run('b1114-read-1116', 'F0SMPLB1114', null, '11-16 07:02', '11-16 07:02:03', { skipped_unchanged: true });
  run('b1114-read-1118', 'F0SMPLB1114', null, '11-18 07:02', '11-18 07:02:03', { skipped_unchanged: true });
  void plusMin; void mtLabel; void acctSf;
  return { drafts, canvases, runs, lines, markdown: md, keys: { batch1113: BATCH1113, dc1114: ['dc-harrowgate-maintenance-agent', 'bf-o62-18', 'bf-o62-30', 'del-o62-45'], week1116: [...WEEK1116, 'recreate-th-validation'] }, ids: {} };
}
