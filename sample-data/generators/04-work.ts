/** Domain 04 (work engine): work items, evidence, transitions, deliverables, extraction, proposals, initiatives, priority runs and next best actions.
 *  Run: npx tsx sample-data/generators/04-work.ts (after 01-03). Writes sample-data/tables/*.json and sample-data/CAST-work.md. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAMPLE_DIR, flushRefs, readTable, writeTable, uid } from '../lib/kit';
import type { Row } from '../lib/kit';
import { buildCore, iniOf } from './data/work-core';
import { buildDeliverables } from './data/work-deliv';
import { buildCandidates, buildExtractors, buildProposals, buildReopens } from './data/work-meta';
import { buildInitiatives, buildLinks, buildRelations } from './data/work-ini';
import { buildPlan, buildPriority } from './data/work-prio';
import { buildNbas } from './data/work-nba';
import { mt, mtLabel, ms, wiKey } from './data/work-lib';
import { writeCast } from './data/work-cast';

const core = buildCore();
if (core.warnings.length) { console.log('WARNINGS\n' + core.warnings.join('\n')); }
const { built, evidence, trans } = core;
const byN = (n: number) => built.find((b) => b.spec.n === n)!;

// deliverables first: evidence rows on asset diffs point at the judgment made on that diff
const deliv = buildDeliverables((n) => byN(n).created);
const evById = new Map(evidence.map((e) => [e.id as string, e]));
for (const b of built) {
  b.evRefs.forEach((r, i) => {
    if (!r.startsWith('d:')) return;
    const [, tag, ab] = r.split(':');
    const j = deliv.judgmentOfDiff.get(`${b.spec.n}:${tag}:${ab}`);
    if (j) evById.get(b.evIds[i]!)!.deliverable_judgment_id = j;
  });
}
// a few verdicts: the user rejected the evidence behind dismissed items and confirmed one completion
for (const n of [45, 81, 82]) evById.get(byN(n).evIds[0]!)!.user_verdict = 'rejected';
for (const [n, i] of [[54, 4], [33, 1], [75, 2], [13, 0]] as Array<[number, number]>) evById.get(byN(n).evIds[i]!)!.user_verdict = 'confirmed';

const nba = buildNbas(built);
const prio = buildPriority(built);
const last = prio.runs[prio.runs.length - 1]!;
for (const b of built) {
  const ls = prio.lastScore.get(b.spec.n);
  if (ls && ls.at === last.finished_at) { b.row.priority_score = ls.total; b.row.priority_lane = ls.lane; b.row.priority_rank = ls.rank; b.row.priority_score_id = ls.id; b.row.priority_computed_at = ls.at; }
}
const plan = buildPlan(prio.runs, built);

const extractors = buildExtractors();
const cands = buildCandidates(built);
const proposals = buildProposals(byN);
const reopens = buildReopens(byN);
const ini = buildInitiatives(built);
const links = buildLinks(built);
const relations = buildRelations(built);

// tool runs referenced by next best actions also appear as links
for (const [n, keys] of nba.toolRuns) {
  const b = byN(n);
  for (const k of keys) links.push({ id: uid('work_item_links', `${wiKey(n)}|tool_run|${k}`), work_item_id: b.id, person_id: null, asset_id: null, claude_session_id: null, calendar_event_id: null, repo_id: null, tool_run_id: uid('tool_runs', k), role: 'related', confidence: 0.9, extractor_id: uid('extractors', 'user-manual:1'), user_verdict: null, created_at: b.created });
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────
const itemRows = built.map((b) => b.row);
writeTable('extractors', extractors);
writeTable('initiatives', ini.initiatives);
writeTable('initiative_links', ini.links);
writeTable('work_item_evidence', evidence);
writeTable('work_item_transitions', trans);
writeTable('work_item_relations', relations);
writeTable('work_item_links', links);
writeTable('work_item_deliverables', deliv.deliverables);
writeTable('deliverable_requirements', deliv.requirements);
writeTable('deliverable_judgments', deliv.judgments);
writeTable('extraction_candidates', cands.rows);
writeTable('change_proposals', proposals);
writeTable('reopen_decisions', reopens);
writeTable('priority_runs', prio.runs);
writeTable('priority_plan_steps', plan);
writeTable('priority_scores', prio.scores);
writeTable('priority_score_rule_hits', prio.hits);
writeTable('next_best_actions', nba.rows);

// description revisions kept by ops (content_revisions): the last text is the current description
const revs = (readTable('content_revisions') as Row[]).filter((r) => r.entity_type === 'work_items' && r.field === 'description');
for (const b of built) {
  const mine = revs.filter((r) => r.entity_id === b.id).sort((a, c) => (a.revision as number) - (c.revision as number));
  if (mine.length) b.row.description = mine[mine.length - 1]!.text as string;
}
// training and travel detail rows (storyline 6)
const training: Row[] = [];
const travel: Row[] = [];
const t21 = byN(21); const t59 = byN(59);
training.push({ work_item_id: t21.id, provider: 'internal_lms', course_title: 'Data Handling and Privacy Refresh', course_url: 'https://learning.example/courses/data-handling-privacy-refresh', external_course_id: 'smpl-lms-dhpr-2026', mandatory: true, required_by: mt('11-21 23:59'), estimated_minutes: 45, progress_pct: 40, completed_at: null, completion_source_item_id: null });
training.push({ work_item_id: t59.id, provider: 'workday_learning', course_title: 'Agentforce testing center workshop (recording)', course_url: null, external_course_id: null, mandatory: false, required_by: null, estimated_minutes: 90, progress_pct: 0, completed_at: null, completion_source_item_id: null });
travel.push({ work_item_id: byN(51).id, destination: 'Cascadia County Services (Larkspur Suites)', departs_at: mt('11-22 14:35'), returns_at: mt('11-24 18:50'), purpose_event_id: uid('calendar_events', 'cc-onsite1'), approval_status: 'approved', approval_ref: 'TA-SMPL-2026-1141', booking_status: 'done', expense_status: 'not_started', expense_due_at: mt('12-04 17:00') });
writeTable('work_items', itemRows);
writeTable('work_item_training_details', training);
writeTable('work_item_travel_details', travel);

flushRefs('work');
writeCast({ built, evidence, trans, nba, prio, plan, deliv, ini, cands, proposals, reopens, relations, links, extractors });
void SAMPLE_DIR; void path; void writeFileSync; void iniOf; void mtLabel; void ms;
