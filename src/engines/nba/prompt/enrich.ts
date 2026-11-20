import { z } from 'zod';
import { fitToBudget, hashInputs, type BudgetReport, type Section, type Unit } from './budget';
import { extractJsonObject, zodIssues, type Issue } from './json';
import { clean, localStamp, person } from './render';
import { nbaOutputSchema, verbSchema, type NbaOutput } from './schema';
import { loadSkill } from './skills';
import type { EvidenceEntry, NbaInput, NbaUser, PersonInput, WorkItemInput } from './types';
import { validateNbaOutput } from './validate';
import { MODELS } from './verbs';

/**
 * Capture enrichment (R-UI-9, UI-SPEC §13). Two calls:
 *   1. intents: turn a one-line capture into search intents over sessions, Drive, Slack, notes, Gmail.
 *      The worker executes them deterministically (FTS, devbar reads, Slack search) — the model
 *      never calls tools here.
 *   2. rank: rank the candidates the searches returned, link the item, and fill its NBA.
 */

export interface CaptureInput {
  now: string;
  user: NbaUser;
  capture: { id: string; text: string; capturedAt: string; meeting?: { id?: string; title: string; at: string } };
  context: {
    accounts: Array<{ id: string; name: string; aliases?: string[] }>;
    opportunities?: Array<{ id: string; name: string; accountId?: string; stage?: string }>;
    initiatives?: Array<{ id: string; title: string; keywords?: string[] }>;
    people?: PersonInput[];
    /** Project alias table: words → local repo (e.g. "beacon" → ~/Projects/beacon-app). */
    projects?: Array<{ aliases: string[]; path: string }>;
  };
}

export const SEARCH_SOURCES = ['claude_sessions', 'drive', 'slack', 'notes', 'gmail', 'calendar'] as const;

export const intentsOutputSchema = z.object({
  parsed: z.object({
    verbGuess: verbSchema,
    counterpart: z.object({ name: z.string().nullable(), role: z.string().nullable() }),
    topic: z.string().min(3).max(160),
    keywords: z.array(z.string().min(2)).min(1).max(12),
    accountId: z.string().nullable(),
    initiativeId: z.string().nullable(),
    due: z.string().nullable(),
  }),
  intents: z
    .array(
      z.object({
        source: z.enum(SEARCH_SOURCES),
        query: z.string().min(2).max(200),
        why: z.string().min(3).max(140),
        after: z.string().nullable().default(null),
      }),
    )
    .min(2)
    .max(8),
});
export type IntentsOutput = z.infer<typeof intentsOutputSchema>;

export interface Candidate {
  id: string;
  source: (typeof SEARCH_SOURCES)[number];
  title: string;
  at: string;
  snippet: string;
  url?: string;
  author?: PersonInput;
}

export const rankOutputSchema = z.object({
  title: z.string().min(3).max(90),
  purpose: z.string().min(3).max(200),
  related: z
    .array(
      z.object({
        candidateId: z.string(),
        // tolerate the obvious synonyms models reach for
        relation: z.preprocess(
          (v) => (v === 'meeting' || v === 'notes' ? 'meeting_notes' : v === 'session' ? 'prior_work' : v === 'doc' || v === 'file' ? 'asset' : v),
          z.enum(['asset', 'prior_work', 'thread', 'meeting_notes', 'person', 'opportunity', 'context']),
        ),
        strength: z.enum(['strong', 'possible']),
        reason: z.string().min(3).max(160),
      }),
    )
    .max(8),
  rejected: z.array(z.object({ candidateId: z.string(), reason: z.string().max(160) })).default([]),
  link: z.object({ accountId: z.string().nullable(), opportunityId: z.string().nullable(), initiativeId: z.string().nullable() }),
  nba: nbaOutputSchema,
});
export type RankOutput = z.infer<typeof rankOutputSchema>;

function contextUnits(input: CaptureInput): Unit[] {
  const c = input.context;
  const units: Unit[] = [];
  if (c.accounts.length) units.push({ priority: 1, text: `my accounts: ${c.accounts.map((a) => `${a.name} [${a.id}]${a.aliases?.length ? ` aka ${a.aliases.join('/')}` : ''}`).join('; ')}` });
  if (c.opportunities?.length) units.push({ priority: 2, text: `my open opportunities: ${c.opportunities.map((o) => `${o.name} [${o.id}]`).join('; ')}` });
  if (c.initiatives?.length) units.push({ priority: 1, text: `initiatives: ${c.initiatives.map((i) => `${i.title} [${i.id}]${i.keywords?.length ? ` (${i.keywords.join(', ')})` : ''}`).join('; ')}` });
  if (c.people?.length) units.push({ priority: 2, text: `people I work with: ${c.people.map(person).join('; ')}` });
  if (c.projects?.length) units.push({ priority: 2, text: `project aliases: ${c.projects.map((p) => `${p.aliases.join('/')} → ${p.path}`).join('; ')}` });
  return units;
}

function baseSections(input: CaptureInput): Section[] {
  const tz = input.user.tz;
  return [
    { key: 'now', tag: 'now', units: [{ priority: 0, text: `${localStamp(input.now, tz)} (${input.now})` }] },
    { key: 'user', tag: 'user', units: [{ priority: 0, text: `${input.user.name}, ${input.user.role}` }] },
    {
      key: 'capture',
      tag: 'capture',
      units: [
        {
          priority: 0,
          text: `[${input.capture.id}] captured ${localStamp(input.capture.capturedAt, tz)}: "${clean(input.capture.text, 400)}"${input.capture.meeting ? `\nduring/after: ${clean(input.capture.meeting.title, 120)} (${localStamp(input.capture.meeting.at, tz)})` : ''}`,
        },
      ],
    },
    { key: 'context', tag: 'my_context', units: contextUnits(input) },
  ];
}

export interface BuiltCapturePrompt {
  system: string;
  user: string;
  model: string;
  maxOutputTokens: number;
  promptVersion: string;
  inputsHash: string;
  budget: BudgetReport;
}

export function buildIntentsPrompt(input: CaptureInput, opts: { skillsDir?: string } = {}): BuiltCapturePrompt {
  const skill = loadSkill('enrich-capture', opts.skillsDir);
  const sections = [
    ...baseSections(input),
    {
      key: 'task',
      tag: 'task',
      units: [{ priority: 0 as const, text: 'MODE: intents. Return ONLY the intents JSON object described in the skill (mode 1).' }],
    },
  ];
  const { text, report } = fitToBudget(sections, 3000);
  return {
    system: skill.body,
    user: text,
    model: MODELS.haiku,
    maxOutputTokens: 1200,
    promptVersion: `enrich-capture@${skill.version}#intents`,
    inputsHash: hashInputs(input.capture, input.context, 'intents', skill.version),
    budget: report,
  };
}

export function buildRankPrompt(
  input: CaptureInput,
  parsed: IntentsOutput['parsed'],
  candidates: Candidate[],
  opts: { skillsDir?: string; voice?: string } = {},
): BuiltCapturePrompt {
  const skill = loadSkill('enrich-capture', opts.skillsDir);
  const common = loadSkill('nba-common', opts.skillsDir);
  const draft = loadSkill('draft-slack', opts.skillsDir);
  const tz = input.user.tz;
  const candUnits: Unit[] = candidates.map((c, i) => ({
    label: c.id,
    priority: i < 6 ? 1 : 3,
    order: -i,
    trimTo: 360,
    text: `[${c.id}] ${c.source} · ${localStamp(c.at, tz)} · "${clean(c.title, 140)}"${c.author ? ` · ${person(c.author)}` : ''}${c.url ? ` · ${c.url}` : ''}\n  ${clean(c.snippet, 700)}`,
  }));
  const sections: Section[] = [
    ...baseSections(input),
    { key: 'parsed', tag: 'parsed', units: [{ priority: 0, text: JSON.stringify(parsed) }] },
    { key: 'candidates', tag: 'candidates', header: 'Search results to rank. Cite by [id].', units: candUnits },
    { key: 'voice', tag: 'voice', units: opts.voice ? [{ priority: 2, trimTo: 1400, text: opts.voice }] : [] },
    {
      key: 'task',
      tag: 'task',
      units: [
        {
          priority: 0,
          text: `MODE: rank. Return ONLY the rank JSON object (mode 2). Its "nba" field follows the NBA contract with verb "${parsed.verbGuess}" unless the candidates show a better verb; cite candidate ids and "${input.capture.id}" in nba.sources. There is no previous version, so nba.update is null.`,
        },
      ],
    },
  ];
  const { text, report } = fitToBudget(sections, 6500);
  return {
    system: [skill.body, common.body, draft.body].join('\n\n---\n\n'),
    user: text,
    model: MODELS.sonnet,
    maxOutputTokens: 4000,
    promptVersion: `enrich-capture@${skill.version}#rank+nba-common@${common.version}+draft-slack@${draft.version}`,
    inputsHash: hashInputs(input.capture, input.context, parsed, candidates, 'rank', skill.version),
    budget: report,
  };
}

export interface ParseResult<T> {
  ok: boolean;
  output?: T;
  errors: Issue[];
  warnings: Issue[];
}

export function parseIntentsReply(raw: string): ParseResult<IntentsOutput> {
  const j = extractJsonObject(raw);
  if (j.error) return { ok: false, errors: [{ code: 'json', message: j.error }], warnings: [] };
  const r = intentsOutputSchema.safeParse(j.value);
  if (!r.success) return { ok: false, errors: zodIssues(r.error), warnings: [] };
  const warnings: Issue[] = [];
  const sources = new Set(r.data.intents.map((i) => i.source));
  if (sources.size < 2) warnings.push({ code: 'narrow_search', message: 'intents cover fewer than 2 sources' });
  return { ok: true, output: r.data, errors: [], warnings };
}

/** The NBA inside a rank reply is validated as if candidates were evidence (same trust rules). */
export function captureToNbaInput(input: CaptureInput, parsed: IntentsOutput['parsed'], candidates: Candidate[], verb: NbaInput['verb'], voice?: string): NbaInput {
  const evidence: EvidenceEntry[] = [
    { id: input.capture.id, source: 'manual', role: 'origin', at: input.capture.capturedAt, author: { name: input.user.name, isMe: true }, excerpt: input.capture.text },
    ...candidates.map(
      (c): EvidenceEntry => ({
        id: c.id,
        source: c.source === 'claude_sessions' ? 'claude' : c.source === 'notes' ? 'gemini' : c.source,
        role: 'context',
        at: c.at,
        title: c.title,
        excerpt: c.snippet,
        ...(c.url ? { permalink: c.url } : {}),
        ...(c.author ? { author: c.author } : {}),
      }),
    ),
  ];
  const account = parsed.accountId ? input.context.accounts.find((a) => a.id === parsed.accountId) : undefined;
  const workItem: WorkItemInput = {
    id: input.capture.id,
    kind: 'task',
    title: input.capture.text,
    state: 'open',
    createdAt: input.capture.capturedAt,
    ...(account ? { account: { id: account.id, name: account.name } } : {}),
    ...(input.context.people ? { people: input.context.people } : {}),
  };
  return { verb, now: input.now, user: input.user, workItem, evidence, ...(voice ? { voice } : {}) };
}

export function parseRankReply(raw: string, input: CaptureInput, parsed: IntentsOutput['parsed'], candidates: Candidate[]): ParseResult<RankOutput> {
  const j = extractJsonObject(raw);
  if (j.error) return { ok: false, errors: [{ code: 'json', message: j.error }], warnings: [] };
  const r = rankOutputSchema.safeParse(j.value);
  if (!r.success) return { ok: false, errors: zodIssues(r.error), warnings: [] };
  const o = r.data;
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const ids = new Set(candidates.map((c) => c.id));
  for (const rel of o.related) if (!ids.has(rel.candidateId)) errors.push({ code: 'unknown_candidate', message: `related ${rel.candidateId} is not a candidate` });
  for (const rej of o.rejected) if (!ids.has(rej.candidateId)) errors.push({ code: 'unknown_candidate', message: `rejected ${rej.candidateId} is not a candidate` });
  const relatedIds = new Set(o.related.map((x) => x.candidateId));
  if (o.rejected.some((x) => relatedIds.has(x.candidateId))) errors.push({ code: 'related_and_rejected', message: 'a candidate is both related and rejected' });
  if (o.link.accountId && !input.context.accounts.some((a) => a.id === o.link.accountId)) errors.push({ code: 'unknown_account', message: `account ${o.link.accountId} is not mine` });
  if (o.link.initiativeId && !(input.context.initiatives ?? []).some((i) => i.id === o.link.initiativeId))
    errors.push({ code: 'unknown_initiative', message: `initiative ${o.link.initiativeId} is unknown` });
  const nbaCheck = validateNbaOutput(o.nba, captureToNbaInput(input, parsed, candidates, o.nba.verb));
  errors.push(...nbaCheck.errors.map((e) => ({ ...e, message: `nba: ${e.message}` })));
  warnings.push(...nbaCheck.warnings.map((e) => ({ ...e, message: `nba: ${e.message}` })));
  return { ok: errors.length === 0, output: o, errors, warnings };
}

export type { NbaOutput };
