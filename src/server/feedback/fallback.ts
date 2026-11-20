/**
 * The deterministic report (D-56): what the panel gets with no model call. The mock always uses it (the "fake model"),
 * and the db uses it when the Assistant's LLM is off, the budget is used up, or the agent run fails. It reads the same
 * scrubbed app state the agent would (src/server/feedback/reads.ts) and points at the page's own files.
 */
import type { FeedbackContextInput, FeedbackDiagnosis, FeedbackKind, FeedbackReport, FeedbackReportContext } from '@/contract';

import type { FeedbackReads } from './reads';

/** The page's own code, by the route's first segment. */
const PAGE_FILES: Record<string, string[]> = {
  '': ['src/components/home/'],
  home: ['src/components/home/'],
  today: ['src/components/today/'],
  work: ['src/components/detail/', 'src/components/lists/'],
  time: ['src/components/time/TimePage.tsx'],
  history: ['src/components/history/'],
  deals: ['src/components/deals/'],
  outbox: ['src/components/composer/', 'src/outbox/'],
  health: ['src/components/health/'],
  agents: ['src/components/agents/'],
  briefs: ['src/components/briefs/'],
  triage: ['src/components/lists/'],
  settings: ['src/components/settings/SettingsPage.tsx'],
  onboarding: ['src/components/onboarding/'],
  assistant: ['src/components/chat/'],
};

const CONNECTOR_FILES: Record<string, string> = { slack: 'src/connectors/slack/', gmail: 'src/connectors/google/', calendar: 'src/connectors/google/', drive: 'src/connectors/google/', gemini: 'src/connectors/google/', vdp: 'src/connectors/vdp/', claude: 'src/connectors/claude/', org62: 'src/scanner/', worker: 'src/worker/' };

export function pageFilesFor(route: string): string[] {
  const seg = route.split('?', 1)[0]!.split('/').filter(Boolean)[0] ?? '';
  return PAGE_FILES[seg] ?? [];
}

/** "Time · /time?tab=log". */
export function pageLabel(ctx: Pick<FeedbackContextInput, 'page' | 'route'>): string {
  return [ctx.page.trim(), ctx.route.trim()].filter(Boolean).join(' · ').slice(0, 400);
}

export function reportContext(ctx: FeedbackContextInput): FeedbackReportContext {
  return { version: ctx.version || '', sha: ctx.sha, persona: ctx.persona, page: pageLabel(ctx), entityKind: ctx.lookingAt?.kind ?? null };
}

const firstSentence = (t: string) => (t.split(/(?<=[.!?])\s+|\n/)[0] ?? t).trim();

export function titleFrom(text: string): string {
  const s = firstSentence(text).replace(/\s+/g, ' ');
  return (s.length > 80 ? `${s.slice(0, 77).trimEnd()}…` : s) || 'Feedback';
}

/** "It should X but it does Y" → expected / actual (only when the text says what should happen); else the text is what happened. */
export function splitExpected(text: string, kind: FeedbackKind): { expected: string; actual: string } {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^(.*?\b(?:should|expected?|supposed to|meant to|ought to)\b.*?)[,;]?\s+\b(?:but|instead|however)\b,?\s*(.+)$/i.exec(t);
  if (m && m[1]!.trim().length > 3 && m[2]!.trim().length > 3) return { expected: m[1]!.trim().replace(/[,;]$/, '').slice(0, 800), actual: m[2]!.trim().slice(0, 800) };
  return kind === 'bug' ? { expected: '', actual: t.slice(0, 800) } : { expected: t.slice(0, 800), actual: '' };
}

interface LogRow {
  level: string;
  source: string;
  code: string;
  message: string;
  acknowledged?: boolean;
}

/** The most telling signal in the app state: an unacknowledged error, a failing connector, a dead job. */
async function signal(reads: FeedbackReads): Promise<{ cause: string; files: string[] } | null> {
  const log = (await reads.eventLog()) as LogRow[] | { unavailable: string } | null;
  const err = Array.isArray(log) ? (log.find((e) => e.level === 'error' && !e.acknowledged) ?? log.find((e) => e.level === 'error')) : null;
  if (err) return { cause: `The event log's latest error is ${err.source} ${err.code}: ${err.message}`.slice(0, 600), files: CONNECTOR_FILES[err.source] ? [CONNECTOR_FILES[err.source]!] : [] };
  const health = (await reads.health()) as { connectors?: Array<{ id: string; state: string; lastError: { message: string } | null }> } | null;
  const bad = health?.connectors?.find((c) => c.state === 'error' || c.state === 'auth_needed');
  if (bad) return { cause: `The ${bad.id} connector is ${bad.state.replace('_', ' ')}${bad.lastError ? `: ${bad.lastError.message}` : ''}`.slice(0, 600), files: CONNECTOR_FILES[bad.id] ? [CONNECTOR_FILES[bad.id]!] : [] };
  const jobs = (await reads.jobs()) as { failing?: Array<{ type: string; status: string; error: string | null }> } | null;
  const dead = jobs?.failing?.find((j) => j.status === 'dead');
  if (dead) return { cause: `A ${dead.type} job is dead${dead.error ? `: ${dead.error}` : ''}`.slice(0, 600), files: dead.type.startsWith('scan') ? ['src/scanner/'] : ['src/jobs/handlers/'] };
  return null;
}

export async function fallbackReport(i: { kind: FeedbackKind; text: string; ctx: FeedbackContextInput; reads: FeedbackReads }): Promise<FeedbackReport> {
  const page = i.ctx.page || 'the page';
  const steps = [`Open ${page}${i.ctx.route ? ` (${i.ctx.route})` : ''}`, ...(i.ctx.lookingAt ? [`Open the ${i.ctx.lookingAt.kind.replace(/_/g, ' ')}${i.ctx.lookingAt.label ? ` "${i.ctx.lookingAt.label}"` : ''}`] : []), i.kind === 'bug' ? 'Do what the summary describes' : 'Look for where this would fit'];
  const { expected, actual } = splitExpected(i.text, i.kind);
  const files = pageFilesFor(i.ctx.route);
  const s = i.kind === 'bug' ? await signal(i.reads) : null;
  const errs = i.ctx.clientErrors.length ? `The browser logged: ${i.ctx.clientErrors[i.ctx.clientErrors.length - 1]}` : '';
  const diagnosis: FeedbackDiagnosis = s
    ? { cause: s.cause, files: [...new Set([...s.files, ...files])].slice(0, 8), confidence: 'low' }
    : { cause: i.kind === 'bug' ? errs || 'No error in the event log, jobs or connectors points at a cause; start with the page code.' : '', files: files.slice(0, 8), confidence: 'low' };
  return {
    title: titleFrom(i.text),
    kind: i.kind,
    summary: i.text.slice(0, 2000),
    steps: steps.map((x) => x.slice(0, 300)),
    expected,
    actual,
    diagnosis,
    context: reportContext(i.ctx),
  };
}
