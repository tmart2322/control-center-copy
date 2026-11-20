/**
 * Items 3, 7 (draft_verifications error) and 8 (draft_renditions lossy / warnings).
 * VDP proposals dominate the real Outbox (about half of all drafts, mostly discarded or verified); the sample had 13 of 99.
 * Adds ~42 VDP drafts with send attempts and vdp_read verifications (matched, pending, error), then re-numbers the bigint ids by time.
 */
import { rng } from '../../lib/kit';
import { OWNER, ms, plus, maxIso, mt, readTable, writeTable, uid, sha, type Row } from './realism-lib';

const CO: Record<string, string> = {};
export function drafts() {
  const R = rng('realism-drafts');
  const drafts = readTable('drafts'); const rends = readTable('draft_renditions'); let attempts = readTable('draft_send_attempts'); let vers = readTable('draft_verifications');
  const recs = readTable('vdp_records');
  const policy = String(drafts.find((d) => d.channel === 'vdp')!.autonomy_policy_id);
  void CO;
  const STATUS: string[] = [...Array(14).fill('verified'), ...Array(3).fill('sent'), ...Array(16).fill('discarded'), ...Array(4).fill('superseded'), ...Array(3).fill('rejected'), ...Array(2).fill('failed')];
  const order = R.shuffle(STATUS);
  const DATES = ['12-15', '01-15', '02-01', '02-28', '03-15', '03-31', '04-30', '05-15'];
  const STAGES = ['U02 - Scoped', 'U03 - In Development', 'U04 - Deployed'];
  const ASSETS = [['Architecture overview', 'deck'], ['Solution blueprint', 'doc'], ['Success criteria', 'doc'], ['Demo script', 'doc'], ['Consumption model', 'sheet'], ['Executive readout', 'deck'], ['Workshop readout', 'doc']];
  const REASONS_DISCARD = ['Not needed: the read-back showed the value already set', 'Superseded by a newer proposal for the same item', 'The AE edited the VDP directly first', 'Not needed: the Org62 use case changed again before I looked'];
  const kinds = ['go_live', 'stage', 'asset', 'asset', 'fiscal', 'owners', 'summary', 'create_uc', 'rename'] as const;
  const dayPlan: string[] = [];
  for (let d = new Date(Date.UTC(2026, 10, 2)); d <= new Date(Date.UTC(2026, 10, 17)); d = new Date(+d + 86_400_000)) if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) dayPlan.push(d.toISOString().slice(0, 10));
  // the 11-04 VDP sign-in expiry: one draft sent at 10:55 MT is first read back during the outage
  const AUTH_I = 5;
  const nd: Row[] = []; const nr: Row[] = []; const na: Row[] = []; const nv: Row[] = [];
  order.forEach((status, i) => {
    const rec = recs[i % recs.length]!; const det = rec.detail as any; const uc = det.useCases[i % Math.max(1, det.useCases.length)] ?? null;
    let kind = R.pick(kinds); if (!uc && ['go_live', 'stage', 'rename'].includes(kind)) kind = 'asset';
    const company = String(rec.company_name); const target = { label: `${company}: ${String(rec.vdp_slug).replace(/-/g, ' ')} (VDP)`.replace(/\b\w/g, (c) => c.toUpperCase()), url: `https://vdp.example.com/vdp/${rec.vdp_slug}` };
    let title = ''; let k = ''; let field = ''; let value: unknown = null; let before: unknown = null; let changes: Array<{ label: string; before: unknown; after: unknown }> = [];
    const date = `${R.pick(['2026', '2027'])}-${R.pick(DATES)}`.replace('2026-01', '2027-01').replace('2026-02', '2027-02').replace('2026-03', '2027-03').replace('2026-04', '2027-04').replace('2026-05', '2027-05');
    if (kind === 'go_live') { k = 'update_use_case'; field = 'go_live_date'; value = date; title = `Set go-live ${date} on "${uc.name}"`; changes = [{ label: 'Go-live date', before: uc.goLiveDate ?? null, after: date }]; before = uc.goLiveDate ?? null; }
    else if (kind === 'stage') { k = 'update_use_case'; field = 'stage'; value = R.pick(STAGES); before = 'U01 - Not Started'; title = `Set stage ${value} on "${uc.name}"`; changes = [{ label: 'Stage', before, after: value }]; }
    else if (kind === 'asset') { const [a, ty] = R.pick(ASSETS); k = 'add_vdp_asset'; field = 'asset'; value = `${a} (${ty})`; title = `Add the ${String(a).toLowerCase()} ${ty} to the ${company} VDP`; changes = [{ label: 'Asset', before: null, after: value }]; }
    else if (kind === 'fiscal') { k = 'set_fiscal_period'; field = 'fiscal_period'; value = 'FY27 Q4'; title = 'Set the fiscal period to FY27 Q4'; changes = [{ label: 'Fiscal period', before: null, after: value }]; }
    else if (kind === 'owners') { k = 'set_vdp_owners'; field = 'ae'; value = 'Theo Brandt'; before = '(none)'; title = `Add the AE to the ${company} VDP`; changes = [{ label: 'AE', before, after: value }]; }
    else if (kind === 'summary') { k = 'set_executive_summary'; field = 'executive_summary'; value = 'Short summary of the pursuit, the use cases and the target go-live.'; title = `Add the executive summary to the ${company} VDP`; changes = [{ label: 'Executive summary', before: null, after: 'Short summary of the pursuit...' }]; }
    else if (kind === 'create_uc') { k = 'create_use_case'; field = 'title'; value = R.pick(['Agent Assist', 'Knowledge Search', 'Profile Unification', 'Case Summaries']); title = `Create the use case "${value}"`; changes = [{ label: 'Use case', before: null, after: value }]; }
    else { k = 'update_use_case'; field = 'title'; value = `${uc.name} (v2)`; before = uc.name; title = `Rename the use case "${uc.name}"`; changes = [{ label: 'Title', before, after: value }]; }
    const day = i === AUTH_I ? '2026-11-04' : dayPlan[Math.min(dayPlan.length - 1, Math.floor((i / order.length) * dayPlan.length))]!;
    const created = i === AUTH_I ? mt('11-04', '10:30') : new Date(`${day}T${String(R.int(8, 16) + 7).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}.000Z`).toISOString();
    const stI = i === AUTH_I ? 'verified' : status;
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] };
    const hash = sha(JSON.stringify(doc)); const id = uid('drafts', `real-vdp-${i}`);
    const approvedStates = ['verified', 'sent'];
    const approved = approvedStates.includes(stI) || stI === 'failed' ? plus(created, i === AUTH_I ? 12 : R.int(4, 40)) : null;
    const sentAt = approved && stI !== 'failed' ? plus(approved, 1) : approved ? plus(approved, 1) : null;
    const verifiedAt = stI === 'verified' ? plus(sentAt!, R.int(8, 25)) : null;
    let createdIso = created; let approvedIso = approved; let sentIso = sentAt; let verifiedIso = verifiedAt;
    if (stI === 'sent') { createdIso = mt('11-17', `${R.int(13, 15)}:${R.int(10, 50)}`); approvedIso = plus(createdIso, 9); sentIso = plus(approvedIso, 1); verifiedIso = null; }
    const rejected = stI === 'rejected' ? plus(createdIso, R.int(30, 600)) : null;
    const reason = stI === 'discarded' ? R.pick(REASONS_DISCARD) : stI === 'superseded' ? 'Superseded: a newer proposal covers this item with fresher values' : stI === 'rejected' ? R.pick(['Wrong use case: this one belongs to the second opportunity', 'Not now: the AE wants to review the VDP wording first', 'The date is not confirmed with the customer yet']) : null;
    const updated = maxIso(createdIso, approvedIso, sentIso, verifiedIso, rejected, stI === 'discarded' || stI === 'superseded' ? plus(createdIso, R.int(60, 2400)) : null);
    const input = { vdpId: rec.vdp_id, vdpSlug: rec.vdp_slug, itemKey: `${k}:${uc && ['update_use_case'].includes(k) ? uc.id : rec.vdp_id}`, field, value, before, candidateId: null, pending: null, track: null, useCaseId: uc && k === 'update_use_case' ? uc.id : null, useCaseTitle: uc && k === 'update_use_case' ? uc.name : null, changes: changes.map((c) => ({ field, value: c.after, before: c.before })) };
    nd.push({
      id, owner_user_id: OWNER, work_item_id: null, nba_id: null, action_type: 'vdp_update', channel: 'vdp', delivery_mode: 'send', autonomy_level: 'L2_stage', status: stI, title, doc_json: doc, doc_version: 1, plain_text: title,
      payload: { action: k === 'create_use_case' ? 'vdp.create' : 'vdp.update', kind: k, target, text: null, changes, input }, content_hash: hash, target_external_id: null, target_thread_external_id: null, in_reply_to_source_item_id: null, subject: null, scheduled_for: null,
      approved_at: approvedIso, approved_by_user_id: approvedIso ? OWNER : null, approval_method: approvedIso ? 'click' : null, approved_content_hash: approvedIso ? hash : null, autonomy_policy_id: policy,
      rejected_at: rejected, reject_reason: reason, sent_external_id: sentIso && stI !== 'failed' ? `vdp-chg-smpl-${sha(id).slice(0, 6)}` : null, sent_at: stI === 'failed' ? null : sentIso, staged_at: null, handed_off_at: null, handoff_url: null,
      result_url: sentIso && stI !== 'failed' ? target.url : null, verified_at: verifiedIso, idempotency_key: `cc-v-real-${i}-v1`, created_by: 'engine', model: null, llm_call_id: null, voice_profile_id: null, edited_by_user: false, user_locked_fields: [],
      version: 1 + (approvedIso ? 1 : 0) + (verifiedIso ? 1 : 0), created_at: createdIso, updated_at: updated,
    });
    const rid = uid('draft_renditions', `real-vdp-${i}`);
    const rich = kind === 'summary' || kind === 'asset' && i % 4 === 0;
    nr.push({ id: rid, draft_id: id, doc_version: 1, format: 'plain_text', body: title, renderer_version: 'plain-renderer@1.0.2', content_hash: sha(title), lossy: rich, warnings: rich ? [kind === 'summary' ? 'Formatting and links in the summary are dropped: VDP stores plain text' : 'Link text dropped: VDP keeps only the asset URL'] : [], created_at: createdIso });
    if (approvedIso && (stI === 'verified' || stI === 'sent' || stI === 'failed')) {
      const base = { draft_id: id, rendition_id: rid };
      const dry = { ...base, attempt_no: 1, dry_run: true, adapter: `vdp.${k} (dry run)`, job_id: null, request_hash: sha(`dry|${id}`), status: 'succeeded', external_id: `vdp-chg-smpl-${sha(id).slice(0, 6)}`, error_code: null, error_message: null, started_at: plus(approvedIso, 0.1), finished_at: plus(approvedIso, 0.2), _t: approvedIso };
      const real = stI === 'failed'
        ? { ...base, attempt_no: 2, dry_run: false, adapter: `vdp.${k}`, job_id: null, request_hash: sha(`real|${id}`), status: 'failed', external_id: null, error_code: i % 2 ? 'conflict' : 'timeout', error_message: i % 2 ? 'VDP: the use case was changed by someone else (409); refresh and push again' : 'VDP did not answer within 30 s; nothing was written', started_at: plus(approvedIso, 0.5), finished_at: plus(approvedIso, 1), _t: approvedIso }
        : { ...base, attempt_no: 2, dry_run: false, adapter: `vdp.${k}`, job_id: null, request_hash: sha(`real|${id}`), status: 'succeeded', external_id: sentIso ? `vdp-uc-smpl-${100 + i}` : null, error_code: null, error_message: null, started_at: plus(approvedIso, 0.5), finished_at: sentIso, _t: approvedIso };
      na.push(dry, real);
      if (stI === 'failed') { const d = nd[nd.length - 1]!; d.sent_at = null; d.updated_at = maxIso(d.updated_at, real.finished_at); }
      if (stI === 'verified') {
        const authCase = i === AUTH_I;
        if (authCase) { nv.push({ draft_id: id, _a: real, method: 'vdp_read', status: 'error', matched_external_id: null, matched_source_item_id: null, diff_summary: 'VDP read failed: 401 unauthorized (central_proxy_session expired). Retrying after re-auth.', checked_at: mt('11-04', '11:12:30'), next_check_at: mt('11-04', '11:45'), created_at: mt('11-04', '11:12:10') }); }
        const chk = authCase ? mt('11-04', '11:41') : verifiedIso!;
        nv.push({ draft_id: id, _a: real, method: 'vdp_read', status: 'matched', matched_external_id: String(real.external_id), matched_source_item_id: null, diff_summary: `${changes[0]!.label} is now "${String(changes[0]!.after).slice(0, 60)}" in VDP`, checked_at: chk, next_check_at: null, created_at: plus(chk, -1) });
        if (authCase) { const d = nd[nd.length - 1]!; d.verified_at = chk; d.updated_at = chk; d.sent_at = d.sent_at; }
      } else if (stI === 'sent') {
        nv.push({ draft_id: id, _a: real, method: 'vdp_read', status: 'pending', matched_external_id: null, matched_source_item_id: null, diff_summary: null, checked_at: null, next_check_at: mt('11-18', R.pick(['09:15', '09:30', '09:45'])), created_at: plus(sentIso!, 1) });
      }
    }
  });
  // a Gmail read-back that timed out before the matching one (the Gmail connector had a transient streak)
  const gm = vers.filter((v) => v.method === 'gmail_read' && v.status === 'matched' && String(v.checked_at) > '2026-11-09').sort((a, b) => String(a.checked_at).localeCompare(String(b.checked_at)))[0]!;
  vers.push({ id: -1, draft_id: gm.draft_id, send_attempt_id: gm.send_attempt_id, method: 'gmail_read', status: 'error', matched_external_id: null, matched_source_item_id: null, diff_summary: 'Gmail search timed out (transient); the check was retried', checked_at: plus(gm.checked_at, -4), next_check_at: gm.checked_at, created_at: plus(gm.checked_at, -5) });

  // ── renditions of existing drafts: a few are lossy (item 8) ──
  let lossyN = 0;
  for (const r of rends) {
    const body = String(r.body); let warn: string | null = null;
    if (r.format === 'slack_mrkdwn' && /https?:\/\//.test(body) && lossyN < 6) warn = 'Link text dropped: Slack shows the bare URL';
    else if (r.format === 'slack_mrkdwn' && /\n[-•] /.test(body) && lossyN < 6) warn = 'Nested list levels flattened to one level';
    else if (r.format === 'email_text' && body.length > 420 && lossyN < 9 && lossyN >= 6) warn = 'Inline formatting (bold, links) removed from the plain-text part';
    if (warn) { r.lossy = true; r.warnings = [warn]; lossyN++; }
  }
  // ensure at least a few exist
  if (lossyN < 4) for (const r of rends.filter((x) => x.format === 'slack_mrkdwn').slice(0, 4 - lossyN)) { r.lossy = true; r.warnings = ['Heading rendered as bold: Slack has no headings']; }

  // ── merge, then re-number the bigint ids by time so ids stay in event order ──
  const allAttempts = [...attempts.map((a) => ({ ...a, _old: a.id as number })), ...na.map((a, ix) => ({ ...a, _old: 100000 + ix, id: 100000 + ix }))];
  allAttempts.sort((a, b) => ms(a.started_at) - ms(b.started_at) || Number(a._old) - Number(b._old));
  const remap = new Map<number, number>(); allAttempts.forEach((a, ix) => { remap.set(Number(a._old), ix + 1); a.id = ix + 1; });
  const newByDraftAttempt = new Map<string, number>(); for (const a of allAttempts) if (Number(a._old) >= 100000) newByDraftAttempt.set(`${a.draft_id}|${a.attempt_no}`, Number(a.id));
  const existingV: Row[] = vers.map((v) => ({ ...v, send_attempt_id: v.send_attempt_id == null ? null : remap.get(Number(v.send_attempt_id)) ?? null }));
  const allV: Row[] = [...existingV, ...nv.map((v) => { const a = (v as any)._a as Row; const o: Row = { ...v }; delete (o as any)._a; o.send_attempt_id = newByDraftAttempt.get(`${a.draft_id}|${a.attempt_no}`)!; return o; })];
  allV.sort((a, b) => ms(a.created_at) - ms(b.created_at));
  allV.forEach((v, ix) => { v.id = ix + 1; });
  const cleaned = allAttempts.map((a) => { const o: Row = { ...a }; delete (o as any)._old; delete (o as any)._t; return o; });
  writeTable('drafts', [...drafts, ...nd]);
  writeTable('draft_renditions', [...rends, ...nr]);
  writeTable('draft_send_attempts', cleaned);
  writeTable('draft_verifications', allV);
  void attempts; void vers;
}
