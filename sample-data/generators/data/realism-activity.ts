/**
 * Item 2 (and the landing_writes part of item 7): the Time page in real data is about half `logged`, half manual.
 *  - the 11-13 canvas batch and the older hand-logged weeks flip from `verified` to `logged` (the read-back that stamps
 *    verified_at has not matched them; the landing keeps its own verified state, as in real data where landings are verified)
 *  - older weeks gain hand-added (`manual`) and Claude/Drive-evidence entries that were logged to Org62, each with a landing
 *  - two entries have a failed / rejected Org62 write (landing_writes.state failed / rejected)
 */
import { rng } from '../../lib/kit';
import { OWNER, MIN, DAY, HOUR, ms, iso, plus, maxIso, mt, readTable, writeTable, uid, sha, type Row } from './realism-lib';

export function activity() {
  const R = rng('realism-activity');
  const act = readTable('activity_entries');
  const landings = readTable('record_landings');
  const writes = readTable('landing_writes');
  const tasks = readTable('se_task_types'); const picks = readTable('org62_picklist_values'); const fps = readTable('fiscal_periods');
  const opps = new Map(readTable('opportunities').map((o) => [String(o.id), o]));

  // ── 1. flip verified → logged ──
  const ver = act.filter((r) => r.status === 'verified').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const batch = ver.filter((r) => r.approved_at);
  const olds = ver.filter((r) => !r.approved_at && r.origin === 'calendar' && String(r.starts_at) >= '2026-10-26' && String(r.starts_at) < '2026-11-07');
  const keepVerified = new Set([1, 5, 9, 13].map((i) => olds[i]?.id));
  const toLogged = (r: Row, manual: boolean) => {
    r.status = 'logged'; r.verified_at = null;
    r.updated_at = maxIso(r.created_at, r.approved_at, r.synced_to_canvas_at, r.logged_at);
    if (manual) {
      r.origin = 'manual';
      r.dedupe_key = `manual|${sha(String(r.subject) + r.starts_at).slice(0, 12)}|${r.starts_at}`;
      r.reason = 'Logged by hand in Org62; the scan found the event and the app matched it to the calendar';
      r.confidence = 1;
    }
  };
  for (const r of batch) toLogged(r, false);
  for (const r of olds) if (!keepVerified.has(r.id)) toLogged(r, true);

  // ── 2. new hand-added / evidence entries in the older weeks ──
  const used = new Set(act.map((r) => String(r.opportunity_id)).filter((x) => x !== 'null'));
  const pool = [...used].map((id) => opps.get(id)!).filter(Boolean);
  const fpOf = (day: string) => fps.find((f) => day >= String(f.starts_on) && day <= String(f.ends_on))!.id;
  const task = (n: string) => tasks.find((x) => x.name === n)!;
  const mtype = (v: string | null) => (v ? picks.find((p) => String(p.value) === v && String(p.field).includes('Meeting'))?.id ?? null : null);
  const T: Array<{ task: string; mt: string | null; subj: (a: string) => string; desc: string; hrs: number[]; evid?: boolean }> = [
    { task: 'Solution Creation', mt: null, subj: (a) => `${a} - demo environment setup`, desc: 'Set up the demo org and loaded the sample records for the next walkthrough.', hrs: [1, 1.5, 2, 2.5] },
    { task: 'Solution Creation', mt: null, subj: (a) => `${a} - solution sketch`, desc: 'Sketched the target architecture and the data flow for the scenario.', hrs: [0.75, 1, 1.5] },
    { task: 'Customer Discovery', mt: 'CF', subj: (a) => `${a} - quick call with the sponsor`, desc: 'Short call to settle open questions on scope and the next meeting.', hrs: [0.25, 0.5] },
    { task: 'Account Planning', mt: null, subj: (a) => `${a} - account plan with the AE`, desc: 'Account planning with the AE: whitespace, stakeholders and next two weeks.', hrs: [0.5, 0.75, 1] },
    { task: 'Dry Run', mt: null, subj: (a) => `${a} - dry run`, desc: 'Rehearsed the walkthrough and timed the handoffs.', hrs: [0.5, 1] },
    { task: 'Consumption Estimation', mt: null, subj: (a) => `${a} - consumption estimate`, desc: 'Built the credits estimate from the volumes the customer shared.', hrs: [0.75, 1, 1.5] },
    { task: 'Asset Creation', mt: null, subj: (a) => `${a} - reusable demo asset`, desc: 'Packaged the demo script and sample data so a peer can reuse it.', hrs: [1, 1.5] },
    { task: 'Customer Presentation', mt: 'CF', subj: (a) => `${a} - follow-up readout`, desc: 'Walked the customer team through the follow-up findings.', hrs: [0.5, 0.75, 1] },
  ];
  const INTERNAL: Array<{ task: string; subj: string; desc: string; hrs: number[] }> = [
    { task: 'Admin', subj: 'Expense report and time admin', desc: 'Weekly admin: expenses and CRM hygiene.', hrs: [0.25, 0.5] },
    { task: 'Sales Enablement', subj: 'Enablement: product release walkthrough', desc: 'Watched the release walkthrough and took notes for the team.', hrs: [0.5, 1] },
    { task: 'Mentorship', subj: 'Mentoring a new SE on demo flow', desc: 'Mentored a newer SE on how to run the demo.', hrs: [0.5] },
  ];
  const days: string[] = [];
  for (let d = new Date(Date.UTC(2026, 9, 19)); d <= new Date(Date.UTC(2026, 10, 12)); d = new Date(+d + DAY)) if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) days.push(d.toISOString().slice(0, 10));
  const fresh: Row[] = []; const nl: Row[] = []; const nw: Row[] = [];
  const mk = (i: number, kind: 'manual' | 'evidence') => {
    const day = days[(i * 7 + (i % 3)) % days.length]!;
    const internal = R.chance(0.2);
    const tpl = internal ? R.pick(INTERNAL) : R.pick(T);
    const opp = internal ? null : R.pick(pool);
    const acctName = opp ? String(opp.name).split(' - ')[0]! : '';
    const hours = R.pick(tpl.hrs);
    const hh = R.int(8, 15); const start = new Date(`${day}T${String(hh + 7).padStart(2, '0')}:${R.pick(['00', '15', '30', '45'])}:00.000Z`).toISOString();
    const end = plus(start, hours * 60);
    const tk = task(tpl.task);
    const cf = !!tk.counts_customer_facing && !!opp; const cr = cf || (!!tk.counts_customer_related && !!opp);
    const subject = 'subj' in tpl && typeof tpl.subj === 'function' ? tpl.subj(acctName) : String(tpl.subj);
    const verified = i % 7 === 0;
    const created = plus(end, R.int(20, 240));
    const gap = new Date(start).getUTCDay() === 5 ? 3 : 1; const loggedAt = iso(Math.floor(ms(start) / DAY) * DAY + gap * DAY + R.int(15, 22) * HOUR); // the next working day, mid-morning MT
    const verifiedAt = verified ? plus(loggedAt, R.int(60, 3000)) : null;
    const viaCanvas = i % 3 === 0;
    const approved = viaCanvas ? plus(created, 60 * 20) : null;
    const id = uid('activity_entries', `real-${kind}-${i}`);
    const row: Row = {
      id, owner_user_id: OWNER, dedupe_key: `${kind}|${sha(`real-${kind}-${i}`).slice(0, 12)}|${start}`, origin: kind, operation: 'create', target_org62_event_id: null,
      subject, starts_at: start, ends_at: end, duration_hours: hours, se_task_type_id: tk.id, meeting_type_id: mtype(tpl.mt),
      what_kind: opp ? 'opportunity' : 'none', opportunity_id: opp ? opp.id : null, account_id: opp ? opp.account_id : null,
      what_org62_id: opp ? opp.org62_opportunity_id : null, what_name: opp ? opp.name : null,
      customer_facing: cf, customer_related: cr, remote: true, description: tpl.desc, confidence: kind === 'manual' ? 1 : 0.78,
      reason: kind === 'manual' ? 'Added by hand on the Time page' : 'Claude session and Drive edits on the same account; engaged time only',
      flags: [], status: verified ? 'verified' : 'logged', excluded_reason: null, approved_at: approved, approval_method: approved ? 'click' : null,
      synced_to_canvas_at: approved ? plus(approved, 6) : null, org62_event_row_id: null, logged_at: loggedAt, verified_at: verifiedAt, verify_issue: null,
      fiscal_period_id: fpOf(day), user_locked_fields: kind === 'manual' ? ['duration_hours'] : [], version: approved ? 2 : 1,
      created_at: created, updated_at: maxIso(created, approved, loggedAt, verifiedAt),
    };
    fresh.push(row);
    const ext = `00USMPL${String(200 + fresh.length).padStart(8, '0')}AAA`;
    const rv = { Subject: subject, StartDateTime: start, EndDateTime: end, Duration__c: hours.toFixed(1), SE_Task_Type__c: tpl.task, ...(tpl.mt ? { Meeting_Type__c: tpl.mt } : {}), ...(opp ? { Opportunity__c: opp.org62_opportunity_id } : {}) };
    const lid = uid('record_landings', `real-${kind}-${i}`);
    nl.push({ id: lid, owner_user_id: OWNER, record_kind: 'activity_event', record_id: id, destination: 'org62', external_id: ext, state: 'verified', remote_values: rv, verified_at: verifiedAt ?? plus(loggedAt, 90), last_read_at: mt('11-17', '07:03'), created_at: created, updated_at: mt('11-17', '07:03') });
    nw.push({ id: uid('landing_writes', `real-${kind}-${i}`), owner_user_id: OWNER, landing_id: lid, draft_id: null, row_key: `event:${id}`, op: 'create', before: null, after: { ...rv, ...(opp ? { Account__c: String(opp.org62_opportunity_id).replace('006', '001') } : {}), Description: tpl.desc }, state: 'verified', origin: viaCanvas ? 'canvas' : 'backfill', reason: '', sent_at: loggedAt, verified_at: verifiedAt ?? plus(loggedAt, 90), created_at: loggedAt, updated_at: mt('11-17', '07:03') });
  };
  for (let i = 0; i < 48; i++) mk(i, 'manual');
  for (let i = 0; i < 14; i++) mk(100 + i, 'evidence');

  // ── 3. item 7: a failed and a rejected Org62 write (the entries wait approved) ──
  const bad = (key: string, subj: string, day: string, hh: string, state: 'failed' | 'rejected', reason: string, hours: number) => {
    const opp = pool[state === 'failed' ? 3 : 7]!; const tk = task('Customer Discovery');
    const start = mt(day, hh); const end = plus(start, hours * 60); const approved = mt('11-17', state === 'failed' ? '15:20' : '15:21'); const sent = plus(approved, 1);
    const id = uid('activity_entries', key); const rv = { Subject: subj, StartDateTime: start, EndDateTime: end, Duration__c: hours.toFixed(1), SE_Task_Type__c: 'Customer Discovery', Opportunity__c: opp.org62_opportunity_id };
    fresh.push({ id, owner_user_id: OWNER, dedupe_key: `manual|${sha(key).slice(0, 12)}|${start}`, origin: 'manual', operation: 'create', target_org62_event_id: null, subject: subj, starts_at: start, ends_at: end, duration_hours: hours, se_task_type_id: tk.id, meeting_type_id: null,
      what_kind: 'opportunity', opportunity_id: opp.id, account_id: opp.account_id, what_org62_id: opp.org62_opportunity_id, what_name: opp.name, customer_facing: true, customer_related: true, remote: true, description: 'Call with the sponsor to settle open questions before the next meeting.', confidence: 1,
      reason: 'Added by hand on the Time page', flags: [], status: 'approved', excluded_reason: null, approved_at: approved, approval_method: 'click', synced_to_canvas_at: null, org62_event_row_id: null, logged_at: null, verified_at: null, verify_issue: null,
      fiscal_period_id: fpOf(`2026-${day}`), user_locked_fields: [], version: 2, created_at: plus(end, 30), updated_at: sent });
    const lid = uid('record_landings', key);
    nl.push({ id: lid, owner_user_id: OWNER, record_kind: 'activity_event', record_id: id, destination: 'org62', external_id: null, state: 'not_sent', remote_values: null, verified_at: null, last_read_at: null, created_at: approved, updated_at: sent });
    nw.push({ id: uid('landing_writes', key), owner_user_id: OWNER, landing_id: lid, draft_id: null, row_key: `event:${id}`, op: 'create', before: null, after: rv, state, origin: 'canvas', reason, sent_at: state === 'failed' ? null : sent, verified_at: null, created_at: approved, updated_at: sent });
  };
  bad('real-write-failed', 'Oakhallow - sponsor check-in', '11-16', '10:00', 'failed', 'Org62 write timed out after 30s (transient); it will be retried on the next logging pass', 0.5);
  bad('real-write-rejected', 'Elderglen - renewal scope check', '11-16', '13:30', 'rejected', 'Org62 rejected the event: Meeting_Type__c is required when SE_Task_Type__c is Customer Discovery', 0.5);

  writeTable('activity_entries', [...act, ...fresh]);
  writeTable('record_landings', [...landings, ...nl]);
  writeTable('landing_writes', [...writes, ...nw]);
  void MIN;
}
