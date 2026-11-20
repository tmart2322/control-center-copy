import { supportKeysForIso, supportKeysForText, unsupportedDatePhrases } from './dates';
import { extractJsonObject, zodIssues, type Issue } from './json';
import { containsSecret } from './redact';
import { nbaOutputSchema, type NbaOutput } from './schema';
import { checkDocForDestination, docLinks, docMentions, docToPlainText } from './tiptap';
import type { NbaInput } from './types';
import { VERB_SPECS } from './verbs';

export interface NbaValidation {
  ok: boolean;
  output?: NbaOutput;
  errors: Issue[];
  warnings: Issue[];
}

/** Every id the model may cite. */
export function knownIds(input: NbaInput): Set<string> {
  const ids = new Set<string>();
  for (const e of input.evidence) ids.add(e.id);
  for (const m of input.thread ?? []) ids.add(m.id);
  for (const e of input.calendar?.upcoming ?? []) ids.add(e.id);
  for (const b of input.verbContext?.activity?.blocks ?? []) ids.add(b.id);
  if (input.verbContext?.deliverable) ids.add(input.verbContext.deliverable.file.id);
  for (const s of input.verbContext?.session?.relatedSessions ?? []) ids.add(s.id);
  ids.add(input.workItem.id);
  return ids;
}

/** All free text of the inputs: used to check links and dates were not invented. */
export function inputCorpus(input: NbaInput): string {
  return JSON.stringify({ ...input, voice: undefined });
}

function supportedDateKeys(input: NbaInput): Set<string> {
  const tz = input.user.tz;
  const keys = supportKeysForText(
    [
      ...input.evidence.map((e) => `${e.title ?? ''} ${e.excerpt}`),
      ...(input.thread ?? []).map((m) => m.text),
      input.workItem.title,
      input.workItem.purpose ?? '',
      ...(input.calendar?.upcoming ?? []).map((e) => e.title),
      ...(input.feedback ?? []).map((f) => f.reason ?? ''),
    ].join('\n'),
  );
  const isos = [
    input.workItem.due,
    input.workItem.opportunity?.closeDate,
    ...(input.calendar?.upcoming ?? []).flatMap((e) => [e.start]),
    ...(input.calendar?.gaps ?? []).map((g) => g.start),
    input.verbContext?.schedule?.windowEnd,
  ].filter((x): x is string => !!x);
  for (const iso of isos) for (const k of supportKeysForIso(iso, tz, input.now)) keys.add(k);
  return keys;
}

function knownSlackIds(input: NbaInput): Set<string> {
  const ids = new Set<string>();
  const add = (p?: { slackId?: string; email?: string }) => {
    if (p?.slackId) ids.add(p.slackId);
    if (p?.email) ids.add(p.email);
  };
  add(input.workItem.askedBy);
  add(input.workItem.promisedTo);
  input.workItem.people?.forEach(add);
  input.evidence.forEach((e) => add(e.author));
  input.thread?.forEach((m) => add(m.author));
  input.verbContext?.schedule?.attendees?.forEach(add);
  return ids;
}

function linkSupported(href: string, corpus: string): boolean {
  if (corpus.includes(href)) return true;
  // tolerate a dropped query string or trailing slash
  const base = href.split(/[?#]/)[0]?.replace(/\/$/, '') ?? href;
  return base.length > 12 && corpus.includes(base);
}

export function validateNbaOutput(value: unknown, input: NbaInput): NbaValidation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const parsed = nbaOutputSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: zodIssues(parsed.error), warnings };
  const o = parsed.data;
  const spec = VERB_SPECS[input.verb];
  const err = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  if (o.verb !== input.verb) err('verb_mismatch', `asked for ${input.verb}, got ${o.verb}`);
  if (/[\r\n]/.test(o.why)) err('why_multiline', 'why must be one line');

  // Confidence and alternatives (brief 08 §2.3: N-best only when not sure).
  if (o.confidence === 'sure' && o.alternatives.length > 0) err('alternatives_when_sure', 'alternatives are only for likely/guess');
  if (o.confidence === 'guess' && o.alternatives.length === 0) err('guess_without_alternatives', 'a guess must offer 1-3 alternatives');
  if (o.alternatives.some((a) => a.verb === o.verb && a.title === o.title)) err('alternative_duplicates_primary', 'an alternative repeats the primary');

  // Sources must be real.
  const ids = knownIds(input);
  const unknown = o.sources.filter((s) => !ids.has(s));
  if (unknown.length) err('unknown_source', `sources not in inputs: ${unknown.join(', ')}`);

  // Draft / plan presence per verb.
  const blockingAsk = o.asks.some((a) => a.blocking);
  const touched = !!input.previous?.draftState?.userTouched;
  if (spec.output === 'draft' && !o.draft && !touched && !blockingAsk) err('missing_draft', `${input.verb} needs a draft (or a blocking ask)`);
  if (spec.output !== 'draft' && !o.plan && !blockingAsk) err('missing_plan', `${input.verb} needs a ${spec.planKind} plan (or a blocking ask)`);
  if (o.plan && spec.planKind && o.plan.kind !== spec.planKind) err('wrong_plan_kind', `expected plan ${spec.planKind}, got ${o.plan.kind}`);
  if (spec.output === 'plan' && o.draft) warn('unexpected_draft', `${input.verb} does not normally carry a draft`);
  if (blockingAsk && o.completeness > 80) warn('complete_with_blocking_ask', 'a blocking ask usually means completeness ≤ 80');

  // The update rule (R-UI-20): never overwrite a user-touched draft.
  if (input.previous) {
    if (!o.update) err('missing_update', 'a previous version exists, so update is required');
    if (touched) {
      if (o.draft) err('overwrote_user_draft', 'the draft is user-touched: draft must be null and the change offered as update.proposal');
      if (o.update && !['proposal', 'unchanged', 'no_draft'].includes(o.update.draftPolicy))
        err('bad_draft_policy', `user-touched draft cannot use draftPolicy ${o.update.draftPolicy}`);
      if (o.update?.draftPolicy === 'proposal' && !o.update.proposal) err('proposal_missing', 'draftPolicy proposal needs update.proposal');
    } else if (o.update?.draftPolicy === 'proposal') {
      warn('needless_proposal', 'the draft is untouched; it can be replaced directly');
    }
    const trig = o.update?.triggeredBy.filter((t) => !ids.has(t)) ?? [];
    if (trig.length) err('unknown_trigger', `update.triggeredBy not in inputs: ${trig.join(', ')}`);
  } else if (o.update) {
    err('update_without_previous', 'update must be null when there is no previous version');
  }

  // Draft checks: destination capability, invented links and mentions, secrets, dates.
  const corpus = inputCorpus(input);
  const dateKeys = supportedDateKeys(input);
  const docs = [
    ...(o.draft ? [{ where: 'draft', doc: o.draft.doc, channel: o.draft.destination.channel }] : []),
    ...(o.update?.proposal ? [{ where: 'proposal', doc: o.update.proposal.doc, channel: (input.destination?.channel ?? 'slack') as 'slack' | 'email' }] : []),
  ];
  const slackIds = knownSlackIds(input);
  for (const d of docs) {
    for (const issue of checkDocForDestination(d.doc, d.channel)) err('destination_capability', `${d.where} ${issue.path}: ${issue.issue}`);
    for (const href of docLinks(d.doc)) if (!linkSupported(href, corpus)) err('invented_link', `${d.where} links to ${href}, which is not in the inputs`);
    for (const m of docMentions(d.doc)) if (!slackIds.has(m.id)) err('invented_mention', `${d.where} mentions ${m.label} with id ${m.id}, which is not in the inputs`);
    const text = docToPlainText(d.doc);
    if (containsSecret(text)) err('secret_in_draft', `${d.where} contains credential-like text`);
    if (/\[(redacted|TODO|placeholder)[^\]]*\]/i.test(text)) err('placeholder_in_draft', `${d.where} contains a placeholder; ask instead`);
    for (const p of unsupportedDatePhrases(text, dateKeys)) warn('unsupported_date', `${d.where} says "${p.phrase}", which the inputs don't support`);
  }
  if (o.draft && input.destination && o.draft.destination.channel !== input.destination.channel)
    err('destination_mismatch', `draft targets ${o.draft.destination.channel}, input destination is ${input.destination.channel}`);

  // Plan-specific checks.
  const p = o.plan;
  if (p?.kind === 'claude_session') {
    if (!p.prompt.includes(`[cc:${input.workItem.id}]`)) err('missing_cc_tag', `session prompt must include [cc:${input.workItem.id}]`);
    if (!p.folder && !o.asks.length) err('folder_unknown_without_ask', 'folder is unknown: add an ask');
    if (containsSecret(p.prompt)) err('secret_in_prompt', 'session prompt contains credential-like text');
    for (const ref of p.contextPack.map((c) => c.ref)) if (/^https?:/.test(ref) && !linkSupported(ref, corpus)) err('invented_link', `contextPack links to ${ref}, which is not in the inputs`);
  }
  if (p?.kind === 'tool_run') {
    const tools = input.verbContext?.tools ?? [];
    const tool = tools.find((t) => t.id === p.toolId);
    if (!tool) err('unknown_tool', `tool ${p.toolId} is not in the catalog`);
    else {
      const missing = tool.inputs.filter((i) => i.required && !(i.name in p.inputs) && !p.missingInputs.includes(i.name));
      if (missing.length) err('tool_inputs_incomplete', `required inputs neither filled nor listed missing: ${missing.map((m) => m.name).join(', ')}`);
      if (p.missingInputs.length && !o.asks.length) err('missing_inputs_without_ask', 'missing tool inputs need an ask');
      if (tool.health === 'down') warn('tool_down', `${tool.id} is down; the card should say so`);
    }
  }
  if (p?.kind === 'activity_rows') {
    const blocks = new Map((input.verbContext?.activity?.blocks ?? []).map((b) => [b.id, b]));
    const taxonomy = new Set((input.verbContext?.activity?.taxonomy ?? []).map((t) => t.type));
    let minutes = 0;
    for (const r of p.rows) {
      const b = blocks.get(r.blockId);
      if (!b) {
        err('unknown_block', `row for unknown block ${r.blockId}`);
        continue;
      }
      if (b.alreadyLogged) err('double_log', `block ${r.blockId} is already logged`);
      const rs = new Date(r.start).getTime();
      const re = new Date(r.end).getTime();
      if (rs < new Date(b.start).getTime() - 60_000 || re > new Date(b.end).getTime() + 60_000 || re <= rs)
        err('hours_outside_block', `row ${r.blockId} times fall outside its block (hours are human hours; never stretch them)`);
      minutes += (re - rs) / 60_000;
      if (taxonomy.size && !taxonomy.has(r.seTaskType)) err('unknown_task_type', `${r.seTaskType} is not in the team taxonomy`);
      if (b.externalAttendees && !r.customerFacing) err('cf_rule', `block ${r.blockId} has external attendees, so it is customer-facing`);
    }
    if (Math.abs(minutes / 60 - p.totalHours) > 0.26) warn('total_hours_mismatch', `totalHours ${p.totalHours} vs rows ${(minutes / 60).toFixed(2)}`);
  }
  if (p?.kind === 'vdp_patch') {
    for (const c of p.changes) {
      const bad = c.evidenceIds.filter((e) => !ids.has(e));
      if (bad.length) err('unknown_source', `VDP change ${c.field} cites unknown ids ${bad.join(', ')}`);
    }
  }
  if (p?.kind === 'deliverable_review') {
    const requested = input.verbContext?.deliverable?.requestedChanges ?? input.workItem.expected?.changes ?? [];
    if (requested.length && p.checklist.length < requested.length) err('checklist_incomplete', `${requested.length} requested changes but ${p.checklist.length} checklist rows`);
    const allMade = p.checklist.every((c) => c.status === 'made');
    if (p.verdict === 'likely_done' && !allMade) err('verdict_inconsistent', 'likely_done needs every requested change made');
  }
  if (p?.kind === 'calendar_hold') {
    for (const s of p.candidateSlots) if (new Date(s.start).getTime() < new Date(input.now).getTime()) err('slot_in_past', `slot ${s.start} is in the past`);
  }

  if (o.startBy.at && Number.isNaN(new Date(o.startBy.at).getTime())) err('bad_start_by', 'startBy.at is not a date');

  return { ok: errors.length === 0, output: o, errors, warnings };
}

/** Parse a raw model reply and validate it against the input. */
export function parseNbaReply(raw: string, input: NbaInput): NbaValidation {
  const j = extractJsonObject(raw);
  if (j.error) return { ok: false, errors: [{ code: 'json', message: j.error }], warnings: [] };
  return validateNbaOutput(j.value, input);
}
