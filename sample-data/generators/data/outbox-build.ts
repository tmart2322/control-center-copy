/** Turns a compact draft spec into the drafts / recipients / renditions / send attempts / verifications rows (domain 05). */
import { OWNER, readTable, sha, slackChannel, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import { T, doc, docText, html, plusMin, slackOf } from './outbox-lib';

export type Att = { at: string; job?: number | null; dry?: boolean; status: 'succeeded' | 'failed' | 'unknown' | 'started'; ext?: string | null; code?: string; msg?: string; sec?: number; adapter?: string };
export type Ver = { at: string; method: 'slack_read' | 'gmail_read' | 'org62_soql' | 'vdp_read' | 'canvas_read' | 'calendar_read' | 'user_confirmed'; status: 'pending' | 'matched' | 'mismatch' | 'not_found' | 'error'; ext?: string | null; si?: string | null; diff?: string; next?: string; att?: number };
export type DSpec = {
  key: string;
  kind: 'slack_message' | 'slack_reply' | 'email_message' | 'email_reply' | 'vdp_update' | 'org62_activity_batch' | 'org62_deal_contribution' | 'calendar_hold' | 'canvas_rewrite' | 'handoff';
  status: string;
  created: string;
  wi?: number; nba?: string; by?: 'engine' | 'user' | 'chat' | 'system'; model?: string | null; llm?: number | null;
  title?: string; paras?: string[]; subject?: string;
  mode?: 'send' | 'stage' | 'handoff';
  to?: string[]; cc?: string[]; addr?: Array<[string, string, 'to' | 'cc'] | [string, string, 'to' | 'cc', string]>;
  slack?: { id: string; label: string; mention?: string };
  threadTs?: string; replyToSi?: string; replyToExt?: string;
  edits?: string[]; lockedFields?: string[];
  ap?: string; apm?: 'click' | 'keyboard' | 'chat_confirm' | 'autonomy_policy';
  st?: string; se?: string; vf?: string; rj?: string; reason?: string; sched?: string; upd?: string; handoff?: string; handoffUrl?: string;
  atts?: Att[]; vers?: Ver[]; si?: string;
  payload?: Record<string, unknown>; docJson?: Record<string, unknown> | null; text?: string; docVersion?: number;
  policy?: string | null; level?: 'L0_suggest' | 'L1_draft' | 'L2_stage' | 'L3_one_click';
  resultUrl?: string; targetId?: string; sentExt?: string; stagedExt?: string; renderers?: string[]; adapter?: string; job?: number | null; lossy?: string[];
  voice?: boolean; extraRendition?: Array<{ format: string; body: string }>; revDocs?: Array<Record<string, unknown>>;
};
export type Built = { draft: Row; recipients: Row[]; renditions: Row[]; attempts: Row[]; verifications: Row[] };

const APPROVED_SET = new Set(['approved', 'scheduled', 'sending', 'unconfirmed', 'sent', 'staged', 'handed_off', 'verified', 'verify_failed']);
const CHANNEL: Record<string, string> = { slack_message: 'slack', slack_reply: 'slack', email_message: 'email', email_reply: 'email', vdp_update: 'vdp', org62_activity_batch: 'org62', org62_deal_contribution: 'org62', calendar_hold: 'calendar', canvas_rewrite: 'slack_canvas', handoff: 'org62' };
const DEFAULT_ADAPTER: Record<string, string> = { slack: 'slack.send_message_draft', email: 'gmail.create_draft', vdp: 'vdp.update', slack_canvas: 'slack.canvas_create', org62: 'org62.handoff', calendar: 'calendar.create_hold' };

let peopleRows: Map<string, Row> | null = null;
const person = (k: string) => {
  peopleRows ??= new Map(readTable('people').map((r) => [r.id as string, r]));
  const r = peopleRows.get(uid('people', k));
  if (!r) throw new Error(`unknown person ${k}`);
  return r;
};
let siRows: Map<string, Row> | null = null; let siByExt: Map<string, Row> | null = null; let siKeyIds: Map<string, string> | null = null;
const loadSi = () => {
  if (siRows) return;
  const all = readTable('source_items'); siRows = new Map(all.map((r) => [r.id as string, r])); siByExt = new Map(all.map((r) => [`${r.source}:${r.external_id}`, r])); siKeyIds = new Map();
  for (let i = 1; i <= 751; i++) siKeyIds.set(`si-${String(i).padStart(3, '0')}`, uid('source_items', `si-${String(i).padStart(3, '0')}`));
};
export const siId = (k: string) => { loadSi(); const id = siKeyIds!.get(k); if (!id || !siRows!.has(id)) throw new Error(`unknown source item ${k}`); return id; };
export const siRow = (k: string) => { loadSi(); return siRows!.get(siId(k))!; };
export const siByExternal = (source: string, ext: string) => { loadSi(); return siByExt!.get(`${source}:${ext}`); };

export function buildDraft(s: DSpec, seqNo: { att: number }): Built {
  const channel = CHANNEL[s.kind]!;
  const created = T(s.created);
  const isMsg = s.kind.startsWith('slack_') && s.kind !== 'canvas_rewrite' || s.kind.startsWith('email_');
  const mode = s.mode ?? (isMsg ? 'stage' : s.kind === 'org62_activity_batch' || s.kind === 'org62_deal_contribution' || s.kind === 'handoff' ? 'handoff' : 'send');
  const dj = s.docJson !== undefined ? s.docJson : s.paras ? doc(s.paras) : null;
  const text = s.text ?? (s.paras && s.paras.length ? s.paras.join('\n\n') : dj ? docText(dj as never) : null);
  const contentHash = sha(JSON.stringify(dj ?? s.payload));
  const id = uid('drafts', s.key);
  const status = s.status;
  const ap = s.ap ? T(s.ap) : null;
  const st = s.st ? T(s.st) : null; const se0 = s.se ? T(s.se) : s.si ? (siRow(s.si).occurred_at as string) : null; const vf = s.vf ? T(s.vf) : null; const rj = s.rj ? T(s.rj) : null;
  const se = se0 ?? (['verified', 'sent', 'verify_failed'].includes(status) && vf && ap && channel !== 'vdp' && channel !== 'slack_canvas' ? (() => { const a = plusMin(vf, -15); const b = plusMin(st ?? ap, 2); return a > b ? a : b; })() : null);
  const needsApproval = APPROVED_SET.has(status);
  if (needsApproval && !ap) throw new Error(`draft ${s.key} (${status}) needs ap`);
  const edits = (s.edits ?? []).map(T);
  const stamps = [created, ap, st, se, vf, rj, s.sched ? T(s.sched) : null, s.upd ? T(s.upd) : null, s.handoff ? T(s.handoff) : null, ...edits].filter(Boolean) as string[];

  // target
  let target: string | null = null; let thread: string | null = null; let replySi: string | null = null; let subject: string | null = s.subject ?? null;
  if (s.slack) { target = s.targetId ?? s.slack.id; thread = s.threadTs ?? null; }
  if (s.kind.startsWith('email_')) { target = s.targetId ?? (s.to?.[0] ? person(s.to[0]).primary_email as string : s.addr?.[0]?.[0] ?? null); }
  if (s.kind === 'vdp_update' || s.kind === 'canvas_rewrite') target = s.targetId ?? null;
  if (s.replyToSi) { replySi = siId(s.replyToSi); }
  else if (s.replyToExt) { const [src, ...rest] = s.replyToExt.split('|'); const r = siByExternal(src!, rest.join('|')); if (r) replySi = r.id as string; }

  // recipients
  const recipients: Row[] = [];
  const addRecipient = (role: string, address: string, name: string | null, personKey: string | null) => recipients.push({ id: uid('draft_recipients', `${s.key}|${role}|${address}`), draft_id: id, role, person_id: personKey ? uid('people', personKey) : null, address, display_name: name });
  if (s.kind.startsWith('email_')) {
    for (const p of s.to ?? []) addRecipient('to', person(p).primary_email as string, person(p).display_name as string, p);
    for (const p of s.cc ?? []) addRecipient('cc', person(p).primary_email as string, person(p).display_name as string, p);
    for (const [a, n, r, pk] of s.addr ?? []) addRecipient(r, a, n, pk ?? null);
  } else if (s.slack) {
    addRecipient('channel', s.slack.id, s.slack.label, null);
    if (s.slack.mention) addRecipient('mention', slackOf(s.slack.mention), person(s.slack.mention).display_name as string, s.slack.mention);
  }

  // renditions (one per doc version; earlier versions for edited drafts)
  const renditions: Row[] = [];
  const docVersion = s.docVersion ?? 1 + edits.length;
  const mkRend = (ver: number, fmt: string, body: string, at: string, lossy = false, warnings: string[] = []) => renditions.push({ id: uid('draft_renditions', `${s.key}|${ver}|${fmt}`), draft_id: id, doc_version: ver, format: fmt, body, renderer_version: fmt.startsWith('email') ? 'email-renderer@2.3.1' : fmt === 'canvas_markdown' ? 'canvas-renderer@1.4.0' : fmt === 'slack_mrkdwn' ? 'slack-renderer@2.1.0' : 'plain-renderer@1.0.2', content_hash: sha(body), lossy, warnings, created_at: at });
  if (text !== null && dj) {
    const verTimes = [created, ...edits];
    const versions = s.revDocs ? s.revDocs.map((_, i) => i + 1) : [docVersion];
    for (const v of versions) {
      const body = s.revDocs ? docText(s.revDocs[v - 1] as never) : text;
      const at = verTimes[Math.min(v - 1, verTimes.length - 1)]!;
      if (channel === 'slack') mkRend(v, 'slack_mrkdwn', body, at);
      else if (channel === 'email') { mkRend(v, 'email_text', body, at); mkRend(v, 'email_html', html(body.split('\n\n')), at); }
      else mkRend(v, 'plain_text', body, at);
    }
  } else if (s.kind === 'canvas_rewrite' && s.payload) {
    const md = String((s.payload.input as Record<string, unknown>)?.markdown ?? '');
    mkRend(1, 'canvas_markdown', md, created, false, s.lossy ?? []);
    mkRend(1, 'plain_text', s.text ?? md.replace(/[#*|_`-]/g, '').replace(/\n+/g, '\n'), created);
  } else if (s.payload) {
    mkRend(1, 'plain_text', s.text ?? s.title, created);
  }
  const rendOf = (fmtPrefix: string[]) => renditions.filter((r) => r.doc_version === docVersion && fmtPrefix.includes(r.format as string)).pop() ?? null;
  const mainRend = channel === 'slack' ? rendOf(['slack_mrkdwn']) : channel === 'email' ? rendOf(['email_html']) : channel === 'slack_canvas' ? rendOf(['canvas_markdown']) : rendOf(['plain_text']);

  const sentExtId = s.sentExt ?? (s.si ? String(siRow(s.si).external_id).split(':').pop()! : defaultExt(s, channel, 'send', se ?? ap ?? created));
  // attempts
  const adapter = s.adapter ?? DEFAULT_ADAPTER[channel]!;
  const attempts: Row[] = [];
  let atts = s.atts;
  if (!atts && ap && ['sent', 'staged', 'handed_off', 'verified', 'verify_failed'].includes(status) && mode !== 'handoff') atts = [{ at: plusMin(ap, 0.1).toString(), status: 'succeeded', job: s.job ?? null, ext: mode === 'send' ? sentExtId : (s.stagedExt ?? null) }];
  (atts ?? []).forEach((a, i) => {
    const startedAt = a.at.includes('T') ? a.at : T(a.at);
    const sec = a.sec ?? (a.status === 'started' ? 0 : a.status === 'failed' ? 2 : 3);
    const ext = a.status === 'succeeded' ? (a.ext ?? s.stagedExt ?? defaultExt(s, channel, mode)) : a.ext ?? null;
    attempts.push({
      id: ++seqNo.att, draft_id: id, attempt_no: i + 1, dry_run: a.dry ?? false, rendition_id: mainRend ? mainRend.id : null, adapter: a.adapter ?? adapter, job_id: a.job ?? null,
      request_hash: sha(`${contentHash}|${target}|${i + 1}`), status: a.status, external_id: ext, error_code: a.code ?? null, error_message: a.msg ?? null,
      started_at: startedAt, finished_at: a.status === 'started' ? null : plusMin(startedAt, sec / 60),
    });
    stamps.push(startedAt);
  });
  const attemptIds = attempts.map((a) => a.id as number);

  // verifications
  const verifications: Row[] = [];
  const defaultMethod = channel === 'slack' ? 'slack_read' : channel === 'email' ? 'gmail_read' : channel === 'vdp' ? 'vdp_read' : channel === 'slack_canvas' ? 'canvas_read' : channel === 'calendar' ? 'calendar_read' : 'org62_soql';
  let vers = s.vers;
  if (!vers && status === 'verified' && vf) vers = [{ at: s.vf!, method: defaultMethod as never, status: 'matched', si: s.si ?? null, ext: sentExtId }];
  if (!vers && (status === 'staged' || status === 'sent') && ap) vers = [{ at: s.vf ?? s.st ?? s.ap!, method: defaultMethod as never, status: 'pending', next: plusMin(T(s.vf ?? s.st ?? s.ap!), 90) }];
  for (const v of vers ?? []) {
    const at = v.at.includes('T') ? v.at : T(v.at);
    const sourceRow = v.si ? siRow(v.si) : null;
    const ext = v.ext ?? (sourceRow ? String(sourceRow.external_id).split(':').pop()! : null);
    verifications.push({
      id: ++seqNo.att + 100000, draft_id: id, send_attempt_id: attemptIds[v.att ?? attemptIds.length - 1] ?? null, method: v.method, status: v.status,
      matched_external_id: v.status === 'matched' || v.status === 'mismatch' ? (ext ?? sentExtId) : null, matched_source_item_id: sourceRow ? sourceRow.id : null, diff_summary: v.diff ?? null,
      checked_at: v.status === 'pending' ? null : at, next_check_at: v.next ? (v.next.includes('T') ? v.next : T(v.next)) : null, created_at: v.status === 'pending' ? at : plusMin(at, -1),
    });
    stamps.push(at);
  }
  // verification ids are renumbered later (sorted by time); keep placeholder offset

  const last = stamps.reduce((a, b) => (a > b ? a : b));
  const policyKey = s.policy === undefined ? `${s.kind}:all` : s.policy;
  const approvedAt = ap && (needsApproval || status === 'failed' || status === 'discarded') ? ap : null;
  const draft: Row = {
    id, owner_user_id: OWNER, work_item_id: s.wi ? uid('work_items', `wi-${String(s.wi).padStart(3, '0')}`) : null, nba_id: s.nba ? uid('next_best_actions', s.nba) : null,
    action_type: s.kind, channel, delivery_mode: mode, autonomy_level: s.level ?? (s.kind === 'vdp_update' || s.kind === 'org62_activity_batch' ? 'L2_stage' : s.kind === 'handoff' ? 'L0_suggest' : 'L1_draft'), status, title: s.title ?? s.key,
    doc_json: dj, doc_version: docVersion, plain_text: text, payload: s.payload ?? null, content_hash: contentHash,
    target_external_id: target, target_thread_external_id: thread, in_reply_to_source_item_id: replySi, subject, scheduled_for: s.sched ? T(s.sched) : null,
    approved_at: approvedAt, approved_by_user_id: approvedAt ? OWNER : null, approval_method: approvedAt ? (s.apm ?? 'click') : null, approved_content_hash: needsApproval ? contentHash : null,
    autonomy_policy_id: policyKey ? uid('autonomy_policies', policyKey) : null,
    rejected_at: rj, reject_reason: s.reason ?? null,
    sent_external_id: mode === 'handoff' ? null : se || (['sent', 'verified', 'verify_failed'].includes(status)) ? sentExtId : null,
    sent_at: se, staged_at: st, handed_off_at: s.handoff ? T(s.handoff) : null, handoff_url: s.handoffUrl ?? null, result_url: s.resultUrl ?? null, verified_at: status === 'verified' && vf ? vf : null,
    idempotency_key: `cc-${s.key}-v${docVersion}`, created_by: s.by ?? 'engine', model: s.model === undefined ? 'claude-sonnet-5-5' : s.model, llm_call_id: s.llm ?? null,
    voice_profile_id: isMsg && s.voice !== false ? uid('voice_profiles', 'v3') : null, edited_by_user: edits.length > 0, user_locked_fields: s.lockedFields ?? (edits.length ? ['doc_json'] : []),
    version: 1 + edits.length + (approvedAt ? 1 : 0), created_at: created, updated_at: s.upd ? T(s.upd) : last,
  };
  return { draft, recipients, renditions, attempts, verifications };
}

function defaultExt(s: DSpec, channel: string, mode: string, iso?: string): string {
  const h = sha(s.key).slice(0, 10);
  if (channel === 'slack') return mode === 'stage' ? `Dr0SMPL${h}` : `${iso ? Math.floor(new Date(iso).getTime() / 1000) : 1793000000 + parseInt(h.slice(0, 6), 16) % 2000000}.${String(100 + parseInt(h.slice(6, 8), 16)).padStart(6, '0')}`;
  if (channel === 'email') return mode === 'stage' ? `r-smpldr${h}` : `smplm${h}`;
  if (channel === 'slack_canvas') return `F0SMPL${h.slice(0, 6).toUpperCase()}`;
  if (channel === 'vdp') return `vdp-chg-smpl-${h.slice(0, 6)}`;
  return `smpl-${h}`;
}
export const slackCh = (n: number) => slackChannel(n);
