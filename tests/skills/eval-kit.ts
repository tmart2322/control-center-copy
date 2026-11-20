import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BriefInput } from '../../src/engines/briefs/prompt/types';
import type { BriefValidation } from '../../src/engines/briefs/prompt/build';
import type { BriefOutput } from '../../src/engines/briefs/prompt/schema';
import type { Candidate, CaptureInput, IntentsOutput, RankOutput } from '../../src/engines/nba/prompt/enrich';
import type { NbaOutput } from '../../src/engines/nba/prompt/schema';
import { docLinks, docToPlainText } from '../../src/engines/nba/prompt/tiptap';
import type { NbaInput } from '../../src/engines/nba/prompt/types';
import type { NbaValidation } from '../../src/engines/nba/prompt/validate';
import { renderVoiceForPrompt, type DraftAudience } from '../../src/engines/voice/render';
import { voiceProfileSchema } from '../../src/engines/voice/types';

/** Shared helpers for the skill eval set: placeholder people, time helpers, and property checks. */

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '../..');

export const TZ = 'America/Denver';
/** Local MST (UTC-7 after Nov 1, 2026) → ISO with offset. */
export const t = (local: string) => `${local.replace(' ', 'T')}:00-07:00`;
export const NOW = t('2026-11-05 08:40');

export const ME = { name: 'Alex Example', role: 'Lead Technical Architect (Data 360 / Agentforce)', tz: TZ, slackId: 'U0ALEX0001', managerName: 'Morgan Blake' };

export const P = {
  me: { name: 'Alex Example', isMe: true, slackId: 'U0ALEX0001' },
  dana: { name: 'Dana Lee', role: 'customer architect', isExternal: true, slackId: 'U0DANA0001', email: 'dana@acme.example' },
  lee: { name: 'Lee Park', role: 'customer IT lead', isExternal: true, email: 'lee@acme.example' },
  sam: { name: 'Sam Ortiz', role: 'AE (ACME)', slackId: 'U0SAM00001', email: 'sam@example.com' },
  kim: { name: 'Kim Rivera', role: 'AE (Globex)', slackId: 'U0KIM00001', email: 'kim@example.com' },
  priya: { name: 'Priya Shah', role: 'AE (Initech)', slackId: 'U0PRIYA001', email: 'priya@example.com' },
  jo: { name: 'Jo Rivera', role: 'customer security lead', isExternal: true, email: 'jo.rivera@initech.example' },
  morgan: { name: 'Morgan Blake', role: 'manager', slackId: 'U0MORGAN01' },
  ravi: { name: 'Ravi Menon', role: 'peer SE', slackId: 'U0RAVI0001' },
  jordan: { name: 'Jordan Kim', role: 'peer SE', slackId: 'U0JORDAN01' },
} as const;

let voiceCache: ReturnType<typeof voiceProfileSchema.parse> | undefined;
export function exampleVoice(audience: DraftAudience = 'internal', channel: 'slack' | 'email' = 'slack'): string {
  voiceCache ??= voiceProfileSchema.parse(JSON.parse(readFileSync(resolve(REPO, 'src/engines/voice/example-profile.json'), 'utf8')));
  return renderVoiceForPrompt(voiceCache, { audience, channel });
}

// ---------- scenario shapes ----------

export type CheckResult = true | string;
export interface Check<C> {
  name: string;
  fn: (ctx: C) => CheckResult;
}

export interface NbaCtx {
  input: NbaInput;
  output: NbaOutput;
  validation: NbaValidation;
  draftText: string;
  proposalText: string;
}
export interface BriefCtx {
  input: BriefInput;
  output: BriefOutput;
  validation: BriefValidation;
}
export interface IntentsCtx {
  input: CaptureInput;
  output: IntentsOutput;
}
export interface RankCtx {
  input: CaptureInput;
  output: RankOutput;
  candidates: Candidate[];
  draftText: string;
}

export type Scenario =
  | { id: string; kind: 'nba'; covers: string[]; input: NbaInput; checks: Check<NbaCtx>[] }
  | { id: string; kind: 'brief'; covers: string[]; input: BriefInput; checks: Check<BriefCtx>[] }
  | { id: string; kind: 'enrich_intents'; covers: string[]; input: CaptureInput; checks: Check<IntentsCtx>[] }
  | {
      id: string;
      kind: 'enrich_rank';
      covers: string[];
      input: CaptureInput;
      parsed: IntentsOutput['parsed'];
      candidates: Candidate[];
      checks: Check<RankCtx>[];
    };

export function nbaCtx(input: NbaInput, output: NbaOutput, validation: NbaValidation): NbaCtx {
  return {
    input,
    output,
    validation,
    draftText: output.draft ? docToPlainText(output.draft.doc) : '',
    proposalText: output.update?.proposal ? docToPlainText(output.update.proposal.doc) : '',
  };
}

// ---------- reusable NBA checks ----------

export const c = {
  check<C>(name: string, fn: (ctx: C) => boolean | string): Check<C> {
    return { name, fn: (ctx) => { const r = fn(ctx); return r === true ? true : r === false ? `failed: ${name}` : r; } };
  },
  valid: (): Check<NbaCtx> => ({ name: 'valid', fn: (x) => (x.validation.ok ? true : x.validation.errors.map((e) => e.code).join(',')) }),
  verb: (v: NbaOutput['verb']): Check<NbaCtx> => ({ name: `verb=${v}`, fn: (x) => x.output.verb === v || `verb ${x.output.verb}` }),
  confidenceIn: (...cs: NbaOutput['confidence'][]): Check<NbaCtx> => ({ name: `confidence∈${cs.join('|')}`, fn: (x) => cs.includes(x.output.confidence) || `confidence ${x.output.confidence}` }),
  noUnsupportedDates: (): Check<NbaCtx> => ({
    name: 'no unsupported dates',
    fn: (x) => {
      const w = x.validation.warnings.filter((w) => w.code === 'unsupported_date');
      return w.length === 0 || w.map((y) => y.message).join('; ');
    },
  }),
  draftMatches: (re: RegExp, label = re.source): Check<NbaCtx> => ({ name: `draft ~ ${label}`, fn: (x) => re.test(x.draftText) || `draft lacks ${label}` }),
  draftNotMatches: (re: RegExp, label = re.source): Check<NbaCtx> => ({ name: `draft !~ ${label}`, fn: (x) => !re.test(x.draftText) || `draft contains ${label}` }),
  draftMaxWords: (n: number): Check<NbaCtx> => ({
    name: `draft ≤ ${n} words`,
    fn: (x) => {
      const w = x.draftText.split(/\s+/).filter(Boolean).length;
      return w <= n || `draft has ${w} words`;
    },
  }),
  draftLinks: (href: string): Check<NbaCtx> => ({ name: `draft links ${href}`, fn: (x) => (x.output.draft ? docLinks(x.output.draft.doc).includes(href) : false) || 'link missing' }),
  sourcesInclude: (...ids: string[]): Check<NbaCtx> => ({ name: `sources ⊇ ${ids.join(',')}`, fn: (x) => ids.every((i) => x.output.sources.includes(i)) || `sources ${x.output.sources.join(',')}` }),
  sourcesIncludeAny: (...ids: string[]): Check<NbaCtx> => ({ name: `sources ∩ ${ids.join('|')}`, fn: (x) => ids.some((i) => x.output.sources.includes(i)) || `sources ${x.output.sources.join(',')}` }),
  hasAsk: (re?: RegExp): Check<NbaCtx> => ({ name: `ask${re ? ` ~ ${re.source}` : ''}`, fn: (x) => x.output.asks.some((a) => !re || re.test(a.question)) || 'no matching ask' }),
  alternativesAtLeast: (n: number): Check<NbaCtx> => ({ name: `alternatives ≥ ${n}`, fn: (x) => x.output.alternatives.length >= n || `${x.output.alternatives.length} alternatives` }),
  whyMatches: (re: RegExp): Check<NbaCtx> => ({ name: `why ~ ${re.source}`, fn: (x) => re.test(`${x.output.why} ${x.output.title} ${x.output.startBy.reasoning}`) || `why: ${x.output.why}` }),
  startByBetween: (fromIso: string, toIso: string): Check<NbaCtx> => ({
    name: `startBy in [${fromIso}, ${toIso}]`,
    fn: (x) => {
      const at = x.output.startBy.at;
      if (!at) return 'startBy.at is null';
      const v = new Date(at).getTime();
      return (v >= new Date(fromIso).getTime() && v <= new Date(toIso).getTime()) || `startBy ${at}`;
    },
  }),
  noSignoffSlack: (): Check<NbaCtx> => ({ name: 'no Slack sign-off', fn: (x) => !/\n\s*(thanks|best|cheers|regards)[,!]?\s*\n\s*\w+\s*$/i.test(x.draftText) || 'has a sign-off' }),
};

export function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
