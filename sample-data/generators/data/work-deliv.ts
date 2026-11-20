/** Domain 04: deliverables, their requirements and the judgments made on asset diffs. */
import { uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import { diffRow, exId, llmNear, plus, siId, snapRow, wiId, wiKey, assetId, ms, mt } from './work-lib';

type RStatus = 'pending' | 'addressed' | 'partially_addressed' | 'not_addressed' | 'unclear' | 'waived';
type Verdict = 'complete' | 'partial' | 'no_change' | 'regressed' | 'unclear';
interface Req { text: string; hint?: string; si?: string; st: RStatus; conf: number; keys: string[]; note?: string }
interface Judg { diff?: [number, number]; snap?: number; at?: string; verdict: Verdict; conf: number; why: string; per: Array<[number, RStatus, number, string[], string]> }
interface Deliv { n: number; tag?: string; hint?: string; kind: 'slides' | 'doc' | 'whitepaper' | 'sheet' | 'other'; st: 'file_unresolved' | 'not_started' | 'in_progress' | 'likely_complete' | 'complete' | 'abandoned'; base?: number; baseAt?: string; reqs: Req[]; js: Judg[] }

export const DELIVS: Deliv[] = [
  { n: 3, tag: 'hv-blueprint', kind: 'doc', st: 'in_progress', base: 1, reqs: [
    { text: 'Target architecture for the claims status journey (ingest, unified profile, agent topics)', hint: '4. Target architecture', si: 'si-575', st: 'addressed', conf: 0.86, keys: ['architecture#1'] },
    { text: 'Identity and access: SSO, IdP groups mapped to Agentforce permission sets, test members', hint: '5. Identity and access', si: 'si-646', st: 'partially_addressed', conf: 0.7, keys: ['identity#1'], note: 'Test members and SSO are covered; the IdP group mapping is not in writing yet.' },
    { text: 'Data residency assumption stated as its own subsection', hint: '2. Scope and success criteria', si: 'si-159', st: 'partially_addressed', conf: 0.62, keys: ['risks#1'], note: 'Mentioned under risks, no own subsection.' },
    { text: 'Consumption model for a 12 month ramp', hint: '8. Consumption model', si: 'si-056', st: 'addressed', conf: 0.84, keys: ['consumption#1'] },
    { text: 'Rollout plan with the six-week phases', hint: '7. Rollout plan', si: 'si-472', st: 'partially_addressed', conf: 0.72, keys: ['rollout#1'], note: 'Weeks 1-4 written, pilot weeks still draft.' },
    { text: 'Architecture diagram of the data flow', hint: '4. Target architecture', si: 'si-708', st: 'not_addressed', conf: 0.8, keys: [], note: 'Still open per the status message.' },
    { text: 'Risks and assumptions (warehouse ingest schedule, SSO sign-off, export availability)', hint: '9. Risks and assumptions', si: 'si-575', st: 'addressed', conf: 0.82, keys: ['risks#1'] },
    { text: 'Current-state landscape reviewed by the customer architects', hint: '3. Current-state landscape', si: 'si-575', st: 'addressed', conf: 0.78, keys: ['landscape#1'] },
  ], js: [
    { diff: [1, 2], verdict: 'partial', conf: 0.5, why: 'Overview, scope and landscape were rewritten; architecture, identity and rollout are still placeholders.', per: [[1, 'not_addressed', 0.6, [], 'Section 4 is a stub.'], [2, 'not_addressed', 0.6, [], ''], [4, 'not_addressed', 0.7, [], 'Waiting on the specialist model.'], [8, 'partially_addressed', 0.5, ['landscape#1'], 'Draft landscape.']] },
    { diff: [2, 3], verdict: 'partial', conf: 0.58, why: 'Gustavo added the consumption model and the architecture section took shape.', per: [[1, 'partially_addressed', 0.62, ['architecture#1'], ''], [4, 'addressed', 0.8, ['consumption#1'], 'Twelve month ramp table present.'], [8, 'partially_addressed', 0.5, ['landscape#1'], '']] },
    { diff: [3, 4], verdict: 'partial', conf: 0.6, why: 'Soo-jin corrected the current-state landscape; nothing new on the open items.', per: [[8, 'addressed', 0.78, ['landscape#1'], 'Reviewed by the customer architect.']] },
    { diff: [4, 5], verdict: 'partial', conf: 0.7, why: 'Risks section added and identity and data model drafted; rollout and diagram still open.', per: [[2, 'partially_addressed', 0.7, ['identity#1'], 'IdP mapping missing.'], [7, 'addressed', 0.82, ['risks#1'], ''], [3, 'partially_addressed', 0.55, ['risks#1'], '']] },
    { diff: [5, 6], verdict: 'partial', conf: 0.78, why: 'Rollout plan and consumption model edited this morning; the architecture diagram and the IdP group mapping are the two gaps.', per: [[5, 'partially_addressed', 0.72, ['rollout#1'], 'Pilot weeks still draft.'], [4, 'addressed', 0.84, ['consumption#1'], ''], [6, 'not_addressed', 0.8, [], 'No diagram in the document.']] },
  ] },
  { n: 15, tag: 'hv-blueprint', kind: 'doc', st: 'in_progress', base: 3, reqs: [
    { text: 'Section 6: data model with the core DMOs', hint: '6. Data model', si: 'si-708', st: 'addressed', conf: 0.8, keys: ['datamodel#1'] },
    { text: 'Section 7: rollout plan with pilot weeks 5-6 and exit criteria', hint: '7. Rollout plan', si: 'si-708', st: 'partially_addressed', conf: 0.7, keys: ['rollout#1'] },
  ], js: [{ diff: [5, 6], verdict: 'partial', conf: 0.74, why: 'Data model is in; the rollout plan still has a draft marker on weeks 5-6.', per: [[1, 'addressed', 0.8, ['datamodel#1'], ''], [2, 'partially_addressed', 0.7, ['rollout#1'], 'Weeks 5-6 draft.']] }] },
  { n: 1, tag: 'hv-success', kind: 'doc', st: 'complete', base: 1, reqs: [
    { text: 'Goals and the four KPIs the customer agreed (containment, deflection, handle time, satisfaction)', hint: 'KPIs', si: 'si-193', st: 'addressed', conf: 0.88, keys: ['kpis#1'] },
    { text: 'Baseline from the 90-day contact-center export', hint: 'Baseline', si: 'si-349', st: 'addressed', conf: 0.8, keys: ['baseline#1'] },
  ], js: [
    { diff: [1, 2], verdict: 'partial', conf: 0.66, why: 'KPIs section reworked after Marisol\'s list; baseline still a placeholder.', per: [[1, 'addressed', 0.85, ['kpis#1'], ''], [2, 'not_addressed', 0.7, [], 'Waiting on the export.']] },
    { diff: [2, 3], verdict: 'complete', conf: 0.84, why: 'Baseline section now has the export-derived figures.', per: [[1, 'addressed', 0.88, ['kpis#1'], ''], [2, 'addressed', 0.8, ['baseline#1'], '']] },
  ] },
  { n: 16, tag: 'hv-demo-script', kind: 'doc', st: 'likely_complete', base: 1, reqs: [
    { text: 'A denied-claim scene with the handoff to a human rep', hint: 'Scene 2', si: 'si-693', st: 'addressed', conf: 0.82, keys: ['scene2#1'] },
    { text: 'The handoff carries the full conversation and the case summary', hint: 'Scene 2', si: 'si-673', st: 'partially_addressed', conf: 0.6, keys: ['scene2#1'], note: 'Case summary content not spelled out.' },
  ], js: [{ diff: [1, 2], verdict: 'partial', conf: 0.76, why: 'Scene 2 was added with the denied-claim handoff; the case summary content is not described.', per: [[1, 'addressed', 0.82, ['scene2#1'], ''], [2, 'partially_addressed', 0.6, ['scene2#1'], '']] }] },
  { n: 32, tag: 'to-demo', kind: 'slides', st: 'in_progress', base: 1, reqs: [
    { text: 'Tracking a split shipment end to end', hint: 'Split shipments', si: 'si-643', st: 'addressed', conf: 0.86, keys: ['s_split'] },
    { text: 'Partial refunds handled with a human handoff in the first release', hint: 'Partial refunds', si: 'si-141', st: 'addressed', conf: 0.8, keys: ['s_refund'] },
    { text: 'Runs against the OMS sandbox endpoints (orders, shipments, returns)', hint: 'OMS integration', si: 'si-694', st: 'partially_addressed', conf: 0.7, keys: ['s_oms'], note: 'Integration slide exists; the connection is not wired yet.' },
    { text: 'A 20 minute agenda Brendan and Mei-Ling can follow', hint: 'Next steps', si: 'si-643', st: 'unclear', conf: 0.4, keys: ['s_next'] },
  ], js: [
    { diff: [1, 2], verdict: 'partial', conf: 0.6, why: 'Split shipments and the partial-refund slide were added.', per: [[1, 'addressed', 0.8, ['s_split'], ''], [2, 'addressed', 0.75, ['s_refund'], '']] },
    { diff: [2, 3], verdict: 'partial', conf: 0.72, why: 'OMS integration slide added and expected results updated; connection and agenda still open.', per: [[3, 'partially_addressed', 0.7, ['s_oms'], ''], [4, 'unclear', 0.4, ['s_next'], '']] },
  ] },
  { n: 53, tag: 'cc-agenda', kind: 'doc', st: 'in_progress', base: 1, reqs: [
    { text: 'Day 1: discovery on service channels and the data inventory', hint: 'Day 1', si: 'si-448', st: 'addressed', conf: 0.88, keys: ['d1am#1', 'd1pm#1'] },
    { text: '30-minute accessibility requirements session (Monday)', hint: 'Day 1 afternoon', si: 'si-464', st: 'addressed', conf: 0.86, keys: ['access#1'] },
    { text: '30 minutes for the county CIO on Tuesday', hint: 'Day 2', si: 'si-623', st: 'not_addressed', conf: 0.78, keys: [] },
    { text: 'Gustavo\'s data section on Monday', hint: 'Day 1', si: 'si-675', st: 'partially_addressed', conf: 0.55, keys: ['d1pm#1'] },
    { text: 'Logistics: room, badges and network access', hint: 'Logistics', si: 'si-304', st: 'addressed', conf: 0.8, keys: ['logistics#1'] },
  ], js: [
    { diff: [1, 2], verdict: 'partial', conf: 0.6, why: 'Accessibility block added to Day 1.', per: [[1, 'addressed', 0.85, ['d1am#1', 'd1pm#1'], ''], [2, 'addressed', 0.86, ['access#1'], '']] },
    { diff: [2, 3], verdict: 'partial', conf: 0.7, why: 'Logistics updated; the county CIO slot and Gustavo\'s section are not in the agenda yet.', per: [[5, 'addressed', 0.8, ['logistics#1'], ''], [3, 'not_addressed', 0.78, [], 'No Tuesday CIO slot.'], [4, 'partially_addressed', 0.5, ['d1pm#1'], '']] },
  ] },
  { n: 60, tag: 'pc-order-form', kind: 'doc', st: 'in_progress', base: 1, reqs: [
    { text: 'Support hours and severity 1 coverage in section 3', hint: '3. Support and service levels', si: 'si-652', st: 'addressed', conf: 0.86, keys: ['sla#1'] },
    { text: 'Severity 2 response times written into the addendum body, not only Schedule B', hint: '3. Support and service levels', si: 'si-695', st: 'not_addressed', conf: 0.82, keys: [], note: 'Requested by legal after the redline.' },
  ], js: [
    { diff: [1, 2], verdict: 'complete', conf: 0.82, why: 'Section 3 was rewritten with support hours and Sev 1 coverage.', per: [[1, 'addressed', 0.86, ['sla#1'], '']] },
    { snap: 2, at: '11-18 08:54', verdict: 'partial', conf: 0.8, why: 'Valentina\'s reply adds a requirement the current text does not meet: Sev 2 response times in the body.', per: [[1, 'addressed', 0.86, ['sla#1'], ''], [2, 'not_addressed', 0.82, [], '']] },
  ] },
  { n: 88, tag: 'aw-proposal', kind: 'slides', st: 'complete', base: 1, reqs: [
    { text: 'Behavioral Health as a separate trust domain', hint: 'Behavioral Health trust domain', si: 'si-238', st: 'addressed', conf: 0.9, keys: ['s_bh'] },
  ], js: [{ diff: [2, 3], verdict: 'complete', conf: 0.88, why: 'The proposal gained the Behavioral Health trust domain section.', per: [[1, 'addressed', 0.9, ['s_bh'], '']] }] },
  { n: 42, tag: 'ns-recap', kind: 'doc', st: 'in_progress', reqs: [
    { text: 'One page: what was agreed and what the agent would deliver', si: 'si-563', st: 'pending', conf: 0.5, keys: [] },
    { text: 'An open question about the outcome of their ops summit', si: 'si-563', st: 'pending', conf: 0.5, keys: [] },
  ], js: [] },
  { n: 18, tag: 'hv-sec-q', kind: 'sheet', st: 'not_started', base: 1, reqs: [
    { text: 'SOC summary', hint: 'Security', si: 'si-679', st: 'pending', conf: 0.5, keys: [] },
    { text: 'POC data isolation answers (data residency addendum)', hint: 'Residency addendum', si: 'si-679', st: 'pending', conf: 0.5, keys: [] },
  ], js: [] },
  { n: 38, tag: 'th-persona', kind: 'doc', st: 'complete', reqs: [{ text: 'Technical validation plan with entry and exit criteria', si: 'si-376', st: 'addressed', conf: 0.7, keys: [] }], js: [] },
  { n: 67, tag: 'qp-schema', kind: 'doc', st: 'complete', reqs: [{ text: 'Merchant hierarchy and refunds modeled in the transaction mapping', si: 'si-305', st: 'addressed', conf: 0.75, keys: [] }], js: [] },
  { n: 69, hint: 'Ferrowpay deck (which one: architecture or demo walkthrough?)', kind: 'slides', st: 'file_unresolved', reqs: [], js: [] },
  { n: 92, tag: 'se-template', kind: 'doc', st: 'not_started', reqs: [{ text: 'Section 4.2 (SSO groups) cleaned up and linkable', hint: '4.2', si: 'si-621', st: 'pending', conf: 0.5, keys: [] }], js: [] },
];

export interface DelivOut { deliverables: Row[]; requirements: Row[]; judgments: Row[]; judgmentOfDiff: Map<string, string> }
export function buildDeliverables(createdOf: (n: number) => string): DelivOut {
  const deliverables: Row[] = []; const requirements: Row[] = []; const judgments: Row[] = []; const judgmentOfDiff = new Map<string, string>();
  for (const d of DELIVS) {
    const key = wiKey(d.n);
    const did = uid('work_item_deliverables', key);
    const created = createdOf(d.n);
    const baseSnap = d.tag && d.base ? snapRow(d.tag, d.base) : null;
    const baseAt = baseSnap ? (baseSnap.sampled_at as string) : created;
    let latest: string | null = null; let lastAt: string | null = null;
    d.js.forEach((j, i) => {
      const jid = uid('deliverable_judgments', `${key}:${i + 1}`);
      let at: string; let diffId: string | null = null; let snapId: string | null = null;
      if (j.diff) { const dr = diffRow(d.tag!, j.diff[0], j.diff[1]); diffId = dr.id as string; snapId = dr.to_snapshot_id as string; at = plus(dr.computed_at as string, 1, 20 + i * 7); judgmentOfDiff.set(`${d.n}:${d.tag}:${j.diff[0]}-${j.diff[1]}`, jid); }
      else { snapId = snapRow(d.tag!, j.snap!).id as string; at = plus(mt(j.at!), 0, 25); }
      if (ms(at) < ms(created)) at = plus(created, 3, 10 + i);
      latest = jid; lastAt = at;
      judgments.push({
        id: jid, deliverable_id: did, diff_id: diffId, snapshot_id: snapId, verdict: j.verdict, confidence: j.conf, rationale: j.why,
        requirement_verdicts: j.per.map(([ord, status, conf, keys, note]) => ({ ordinal: ord, status, confidence: conf, matchedSectionKeys: keys, note: note || null })),
        model: 'claude-haiku-5-5', llm_call_id: llmNear('nba_generate', 'nba-review-deliverable', at, 24 * 60) ?? llmNear('done_match', 'check-completion', at, 360), judged_at: at,
      });
    });
    deliverables.push({
      id: did, work_item_id: wiId(d.n), asset_id: d.tag ? assetId(d.tag) : null, asset_hint: d.hint ?? null, kind: d.kind, baseline_snapshot_id: baseSnap ? (baseSnap.id as string) : null, baseline_at: baseAt,
      status: d.st, latest_judgment_id: latest, last_judged_at: lastAt, created_at: created, updated_at: lastAt ?? created,
    });
    d.reqs.forEach((r, i) => {
      const lastVerdict = [...d.js].reverse().find((j) => j.per.some((p) => p[0] === i + 1));
      const lastJudged = lastVerdict ? judgments.find((x) => x.id === uid('deliverable_judgments', `${key}:${d.js.indexOf(lastVerdict) + 1}`))!.judged_at as string : null;
      requirements.push({
        id: uid('deliverable_requirements', `${key}:${i + 1}`), deliverable_id: did, ordinal: i + 1, description: r.text, section_hint: r.hint ?? null, requested_by_source_item_id: r.si ? siId(r.si) : null,
        extractor_id: exId('deliverable-requirements:1'), status: r.st, confidence: r.conf, matched_section_keys: r.keys, last_judged_at: lastJudged, created_at: plus(created, 1, 30 + i), updated_at: lastJudged ?? plus(created, 1, 30 + i),
      });
    });
  }
  return { deliverables, requirements, judgments, judgmentOfDiff };
}
