import { fitToBudget, hashInputs, type BudgetReport, type Section, type Unit } from '../../nba/prompt/budget';
import { extractJsonObject, zodIssues, type Issue } from '../../nba/prompt/json';
import { containsSecret } from '../../nba/prompt/redact';
import { clean, localStamp } from '../../nba/prompt/render';
import { loadSkill } from '../../nba/prompt/skills';
import { MODELS, type ModelTier } from '../../nba/prompt/verbs';
import { briefOutputSchema, type BriefOutput } from './schema';
import type { BriefInput, BriefKind } from './types';

const SKILL_FOR: Record<BriefKind, string[]> = {
  channel: ['brief-channel', 'brief-relevance'],
  opportunity: ['brief-opportunity', 'brief-relevance'],
  relevance: ['brief-relevance'],
};

const TIER_FOR: Record<BriefKind, ModelTier> = { channel: 'haiku', opportunity: 'sonnet', relevance: 'haiku' };

export interface BuiltBriefPrompt {
  system: string;
  user: string;
  model: string;
  maxOutputTokens: number;
  promptVersion: string;
  inputsHash: string;
  budget: BudgetReport;
}

function contextSection(input: BriefInput): Section {
  const c = input.myContext;
  const units: Unit[] = [];
  if (c.accounts.length) units.push({ priority: 0, text: `accounts: ${c.accounts.map((a) => `${a.name} [${a.id}]${a.aliases?.length ? ` aka ${a.aliases.join('/')}` : ''}`).join('; ')}` });
  if (c.opportunities.length) units.push({ priority: 0, text: `open opportunities: ${c.opportunities.map((o) => `${o.name} [${o.id}]${o.stage ? ` (${o.stage})` : ''}`).join('; ')}` });
  if (c.initiatives.length) units.push({ priority: 0, text: `initiatives: ${c.initiatives.map((i) => `${i.title} [${i.id}]${i.keywords?.length ? ` keywords: ${i.keywords.join(', ')}` : ''}`).join('; ')}` });
  // Rendered as the featureKey the rubric expects (`interest:<value>`), with the kind in parentheses.
  if (c.interests.length) units.push({ priority: 1, text: `interests: ${c.interests.map((i) => `[interest:${i.value}] (${i.kind})`).join('; ')}` });
  if (c.people.length) units.push({ priority: 1, text: `people: ${c.people.map((p) => `${p.name}${p.relation ? ` (${p.relation})` : ''}${p.slackId ? ` slack:${p.slackId}` : ''}`).join('; ')}` });
  if (c.policyRules.length) units.push({ priority: 1, text: `policy rules: ${c.policyRules.map((r) => `[rule:${r.key}] ${clean(r.text, 140)}`).join('; ')}` });
  return { key: 'context', tag: 'my_context', units };
}

function itemUnits(input: BriefInput): Unit[] {
  const tz = input.user.tz;
  const sorted = [...input.items].sort((a, b) => a.at.localeCompare(b.at));
  const meId = input.user.slackId;
  return sorted.map((it, i) => {
    const mentionsMe = !!meId && it.text.includes(meId);
    const engagement = (it.replyCount ?? 0) + (it.reactions ?? 0);
    const priority: Unit['priority'] = mentionsMe ? 1 : engagement >= 3 ? 2 : it.source === 'org62' ? 1 : 3;
    const who = it.author ? `${it.author.name}${it.author.relation ? ` (${it.author.relation})` : ''}${it.author.isMe ? ' (me)' : ''}${it.author.isExternal ? ' (external)' : ''}` : 'unknown';
    const meta = [it.where && clean(it.where, 60), it.threadRef && `thread ${it.threadRef}`, it.replyCount ? `${it.replyCount} replies` : '', it.reactions ? `${it.reactions} reactions` : '', it.attended === false ? 'MISSED' : '']
      .filter(Boolean)
      .join(' · ');
    return {
      label: it.id,
      priority,
      order: i,
      trimTo: priority <= 1 ? 900 : 320,
      text: `[${it.id}] ${localStamp(it.at, tz)} · ${it.source}${meta ? ` · ${meta}` : ''} · ${who}: ${clean(it.text, 1800)}`,
    } satisfies Unit;
  });
}

export function buildBriefPrompt(input: BriefInput, opts: { skillsDir?: string; tier?: ModelTier; budgetTokens?: number } = {}): BuiltBriefPrompt {
  const skills = SKILL_FOR[input.kind].map((n) => loadSkill(n, opts.skillsDir));
  const tz = input.user.tz;
  const s = input.subscription;
  const sections: Section[] = [
    { key: 'now', tag: 'now', units: [{ priority: 0, text: `${localStamp(input.now, tz)} (${input.now})` }] },
    { key: 'user', tag: 'user', units: [{ priority: 0, text: `${input.user.name}, ${input.user.role}${input.user.slackId ? `; slack ${input.user.slackId}` : ''}` }] },
    {
      key: 'subscription',
      tag: 'subscription',
      units: [
        {
          priority: 0,
          text: `${s.label} (${s.scopeKind}) · style ${s.style ?? 'digest'} · detailLevel ${s.detailLevel ?? 2} · maxHighlights ${s.maxHighlights}\nperiod: ${localStamp(input.period.from, tz)} → ${localStamp(input.period.to, tz)}`,
        },
      ],
    },
    contextSection(input),
  ];
  if (input.opportunity) {
    const o = input.opportunity;
    sections.push({
      key: 'opportunity',
      tag: 'opportunity',
      units: [
        {
          priority: 0,
          text: [
            `${o.name} [${o.id}] · account ${o.accountName}`,
            `now: stage ${o.stage ?? '?'} · close ${o.closeDate ?? '?'} · amount ${o.amount ?? '?'}${o.team?.length ? ` · team ${o.team.join(', ')}` : ''}`,
            o.nextSteps ? `next steps: ${clean(o.nextSteps, 300)}` : '',
            o.fieldChanges.length
              ? `fieldChanges:\n${o.fieldChanges.map((f) => `  - ${f.field}: ${f.before ?? '∅'} → ${f.after ?? '∅'} @ ${localStamp(f.at, tz)}`).join('\n')}`
              : 'fieldChanges: none',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });
  }
  sections.push({ key: 'items', tag: 'items', header: input.items.length ? 'Oldest first. Cite by [id].' : '(no items in this period)', units: itemUnits(input), optional: false });
  const fb = input.feedback;
  const fbUnits: Unit[] = [
    ...(fb?.negatives ?? []).slice(-12).map((n, i) => ({
      priority: 1 as const,
      order: i,
      text: `NOT RELEVANT (dismissed ${localStamp(n.at, tz)}): "${clean(n.title, 120)}"${n.topicKey ? ` topic ${n.topicKey}` : ''} · features ${n.featureKeys.join(', ')}${n.reason ? ` · reason: ${clean(n.reason, 120)}` : ''}`,
    })),
    ...(fb?.positives ?? []).slice(-6).map((p, i) => ({ priority: 2 as const, order: i, text: `PROMOTED: "${clean(p.title, 120)}" · features ${p.featureKeys.join(', ')}` })),
  ];
  sections.push({ key: 'feedback', tag: 'feedback', units: fbUnits });
  if (input.coverage && !input.coverage.complete)
    sections.push({ key: 'coverage', tag: 'coverage', units: [{ priority: 0, text: `incomplete: ${input.coverage.note ?? 'a connector was degraded in this window'}` }] });
  sections.push({
    key: 'task',
    tag: 'task',
    units: [{ priority: 0, text: `Write the ${input.kind} brief. At most ${s.maxHighlights} highlights; summary ≤ 150 words. Return ONLY the JSON object.` }],
  });

  const { text, report } = fitToBudget(sections, opts.budgetTokens ?? (input.kind === 'opportunity' ? 7000 : 9000));
  const model = MODELS[opts.tier ?? TIER_FOR[input.kind]];
  const promptVersion = skills.map((k) => `${k.name}@${k.version}`).join('+');
  const { now, ...rest } = input;
  return {
    system: skills.map((k) => `<!-- skill ${k.name}@${k.version} -->\n${k.body}`).join('\n\n---\n\n'),
    user: text,
    model,
    maxOutputTokens: 3000,
    promptVersion,
    inputsHash: hashInputs(rest, now.slice(0, 10), model, promptVersion),
    budget: report,
  };
}

export interface BriefValidation {
  ok: boolean;
  output?: BriefOutput;
  errors: Issue[];
  warnings: Issue[];
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const FEATURE_RE = /^(account|opportunity|initiative|interest|rule|person|keyword|mention|org62|similar):(.+)$/;

export function validateBriefOutput(value: unknown, input: BriefInput): BriefValidation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const r = briefOutputSchema.safeParse(value);
  if (!r.success) return { ok: false, errors: zodIssues(r.error), warnings };
  const o = r.data;
  const err = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });
  const c = input.myContext;
  const itemIds = new Set(input.items.map((i) => i.id));

  const words = wordCount(o.summary);
  if (words > 150) err('summary_too_long', `summary is ${words} words (max 150)`);
  if (/^\s*([-•*]|\d+\.)\s/m.test(o.summary)) err('summary_not_prose', 'summary must be prose, not a list');
  if (o.highlights.length > input.subscription.maxHighlights) err('too_many_highlights', `${o.highlights.length} highlights > max ${input.subscription.maxHighlights}`);
  if (input.items.length === 0 && !(input.opportunity?.fieldChanges.length) && !o.nothingNew) err('nothing_new_flag', 'no items and no field changes: nothingNew must be true');
  if (o.nothingNew && o.highlights.length) err('nothing_new_with_highlights', 'nothingNew but highlights present');
  if (containsSecret(o.summary) || o.highlights.some((h) => containsSecret(`${h.title} ${h.body}`))) err('secret_in_brief', 'brief contains credential-like text');

  const known = {
    account: new Set(c.accounts.map((a) => a.id)),
    opportunity: new Set([...c.opportunities.map((x) => x.id), ...(input.opportunity ? [input.opportunity.id] : [])]),
    initiative: new Set(c.initiatives.map((i) => i.id)),
    rule: new Set(c.policyRules.map((p) => p.key)),
  };
  const topicKeys = new Set<string>();
  for (const h of o.highlights) {
    for (const e of h.evidenceIds) if (!itemIds.has(e) && !(input.opportunity && e === input.opportunity.id)) err('unknown_evidence', `highlight "${h.title}" cites unknown id ${e}`);
    for (const reason of h.reasons) {
      const m = FEATURE_RE.exec(reason.featureKey);
      if (!m) {
        err('bad_feature_key', `featureKey ${reason.featureKey} is not in a known form`);
        continue;
      }
      const [, kind, id] = m;
      if ((kind === 'account' || kind === 'opportunity' || kind === 'initiative' || kind === 'rule') && id && !known[kind].has(id))
        err('unknown_feature', `featureKey ${reason.featureKey} is not in my_context`);
    }
    const strong = h.reasons.some((x) => ['mentions_me', 'my_opportunity', 'my_account', 'org62_change', 'stakeholder', 'my_initiative', 'policy_rule'].includes(x.kind));
    if (h.level === 'high' && !strong) err('weak_high', `"${h.title}" is high with only weak reasons`);
    if (h.entity.accountId && !known.account.has(h.entity.accountId)) err('unknown_entity', `entity account ${h.entity.accountId} unknown`);
    if (h.entity.opportunityId && !known.opportunity.has(h.entity.opportunityId)) err('unknown_entity', `entity opportunity ${h.entity.opportunityId} unknown`);
    if (h.entity.initiativeId && !known.initiative.has(h.entity.initiativeId)) err('unknown_entity', `entity initiative ${h.entity.initiativeId} unknown`);
    if (topicKeys.has(h.topicKey)) warn('duplicate_topic', `topicKey ${h.topicKey} highlighted twice`);
    topicKeys.add(h.topicKey);
    // Few-shot negatives: same topic, or the same feature set he dismissed.
    for (const n of input.feedback?.negatives ?? []) {
      const keys = new Set(h.reasons.map((x) => x.featureKey));
      const subset = n.featureKeys.length > 0 && [...keys].every((k) => n.featureKeys.includes(k));
      if ((n.topicKey && n.topicKey === h.topicKey) || subset)
        warn('similar_to_dismissed', `"${h.title}" resembles dismissed "${n.title}"`);
    }
  }
  const order = o.highlights.map((h) => (h.level === 'high' ? 0 : 1));
  if (order.some((v, i) => i > 0 && v < (order[i - 1] ?? 0))) warn('order', 'highlights should list high before medium');

  if (input.kind === 'opportunity' && input.opportunity?.fieldChanges.length) {
    const s = o.summary.toLowerCase();
    const mentioned = input.opportunity.fieldChanges.some((f) => {
      const label = f.field.replace(/__c$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return s.includes(label) || s.includes(f.field.toLowerCase()) || (label.includes('stage') && s.includes('stage')) || (label.includes('close') && s.includes('close'));
    });
    if (!mentioned && !o.highlights.some((h) => h.reasons.some((x) => x.kind === 'org62_change'))) err('field_changes_missing', 'opportunity brief must report the Org62 field changes');
  }
  if (input.coverage && !input.coverage.complete && !o.coverageNote) warn('coverage_note_missing', 'coverage was incomplete; coverageNote should say so');

  return { ok: errors.length === 0, output: o, errors, warnings };
}

export function parseBriefReply(raw: string, input: BriefInput): BriefValidation {
  const j = extractJsonObject(raw);
  if (j.error) return { ok: false, errors: [{ code: 'json', message: j.error }], warnings: [] };
  return validateBriefOutput(j.value, input);
}
