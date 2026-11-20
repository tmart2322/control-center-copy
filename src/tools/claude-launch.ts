/**
 * Claude Code launcher (R-UI-8/9, CHECKPOINTS "Kick-offs").
 *
 * Builds `claude://code/...` deep links for the Claude Desktop Code tab. Pure URL/prompt
 * construction plus one guarded side effect, `open()`, which requires `confirm: true`.
 * This module never opens anything on its own and tests never call `open()`.
 *
 * Findings from /Applications/Claude.app/Contents/Resources/app.asar (read-only, `rg -a`, 2026-11-05,
 * handler next to the "unrecognized code path" warning):
 *  - /code/new       reads `q` (or `prompt`) and `.slice(0, 14336)`; repeated `folder` and `file`
 *                    params; adds src=external. Anything past 14336 chars is silently dropped.
 *                    A cold-start argv-capped launch can refuse ("truncated"); not an issue for
 *                    macOS `open`, which delivers the URL as an Apple event.
 *  - /code/continue  `session` must be the literal `last` OR match /^local_[A-Za-z0-9-]{1,64}$/ and
 *                    equal a desktop session's `sessionId` (non-archived). It does NOT accept the
 *                    CLI session UUID. The `local_...` id is `hostSessionId` in
 *                    ~/.claude/sessions/<pid>.json (sessionId there is the CLI UUID).
 *  - /code/needs-input `session` optional, same local_ pattern; no param = all waiting sessions.
 *  - claude://resume?session=<CLI UUID> imports a CLI session into Desktop (separate verb).
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const MAX_PROMPT_CHARS = 14336;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOCAL_SESSION_RE = /^local_[A-Za-z0-9-]{1,64}$/;
const CLI_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LaunchError extends Error {
  constructor(message: string, public readonly code: 'bad_id' | 'bad_folder' | 'bad_session' | 'too_long' | 'confirm_required' | 'url_not_allowed') {
    super(message);
    this.name = 'LaunchError';
  }
}

// ------------------------------------------------------------------- tag

export const ccTag = (workItemId: string): string => {
  if (!ID_RE.test(workItemId)) throw new LaunchError(`invalid work item id for tag: ${workItemId}`, 'bad_id');
  return `[cc:${workItemId}]`;
};

/** Find the work item id a session was launched for (deterministic link, scan the first user message). */
export function parseCcTag(text: string): string | undefined {
  return /\[cc:([A-Za-z0-9_-]{1,64})\]/.exec(text)?.[1];
}

// ---------------------------------------------------------------- prompt

export interface PromptSection {
  id: string;
  text: string;
  /** Lower = kept first when the budget is tight. */
  priority: number;
  /** Never truncated or dropped (tag, constraints). */
  required?: boolean;
  /** Display order in the final prompt. */
  order: number;
}

export interface PackedPrompt {
  prompt: string;
  length: number;
  trimmed: boolean;
  dropped: string[];
  truncated: string[];
}

const ELLIPSIS = '\n[...trimmed to fit the 14336-char limit]';

/**
 * Fit sections into `max` chars. The tag line is always first. Budget is spent in priority
 * order (summary, task, links, ...); a section that does not fit is cut at a line boundary
 * if at least 200 chars remain, otherwise dropped. Required sections are reserved up front.
 */
export function packPrompt(sections: PromptSection[], max = MAX_PROMPT_CHARS): PackedPrompt {
  const SEP = 2; // "\n\n"
  const required = sections.filter((s) => s.required);
  let used = required.reduce((n, s) => n + s.text.length + SEP, 0);
  if (used > max) throw new LaunchError('required prompt sections exceed the limit', 'too_long');

  const kept = new Map<string, string>();
  const dropped: string[] = [];
  const truncated: string[] = [];
  for (const s of [...sections].filter((x) => !x.required).sort((a, b) => a.priority - b.priority)) {
    if (!s.text.trim()) continue;
    const remaining = max - used - SEP;
    if (s.text.length <= remaining) { kept.set(s.id, s.text); used += s.text.length + SEP; continue; }
    if (remaining >= 200) {
      const budget = remaining - ELLIPSIS.length;
      let cut = s.text.slice(0, budget);
      const nl = cut.lastIndexOf('\n');
      if (nl > budget * 0.5) cut = cut.slice(0, nl);
      kept.set(s.id, cut.trimEnd() + ELLIPSIS);
      truncated.push(s.id);
      used = max; // nothing else fits after a cut
    } else dropped.push(s.id);
  }
  const parts = [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => (s.required ? s.text : kept.get(s.id)))
    .filter((t): t is string => !!t && t.trim().length > 0);
  const prompt = parts.join('\n\n');
  return { prompt, length: prompt.length, trimmed: dropped.length > 0 || truncated.length > 0, dropped, truncated };
}

// --------------------------------------------------------------- context pack

/** Minimal local input types; W0's contract is reconciled later. */
export interface PackWorkItem { id: string; title: string; summary?: string; task?: string; doneWhen?: string[]; dueAt?: string }
export interface PackInitiative { name: string; summary?: string }
export interface PackAsset { kind: 'drive' | 'doc' | 'slack' | 'gmail' | 'org62' | 'other'; title: string; url: string }
export interface PackSession { id?: string; title: string; url?: string; summary?: string }
export interface PackPerson { name: string; role?: string }
export interface PackOpp { name: string; stage?: string; amount?: string; closeDate?: string; account?: string }

export interface ContextPackInput {
  workItem: PackWorkItem;
  initiative?: PackInitiative;
  assets?: PackAsset[];
  sessions?: PackSession[];
  people?: PackPerson[];
  opp?: PackOpp;
  /** Absolute repo path the session opens in. */
  repoPath: string;
  branchHint?: string;
}

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

export function buildContextPack(input: ContextPackInput, max = MAX_PROMPT_CHARS): PackedPrompt {
  const { workItem: w, initiative, assets = [], sessions = [], people = [], opp, repoPath } = input;
  const tag = ccTag(w.id);

  const goal = [`## Goal`, w.summary ? `${w.title}\n\n${w.summary}` : w.title, initiative ? `Initiative: ${initiative.name}${initiative.summary ? `: ${initiative.summary}` : ''}` : ''].filter(Boolean).join('\n');
  const done = ['## What done looks like', w.task ? w.task : '', w.doneWhen?.length ? bullets(w.doneWhen) : '', w.dueAt ? `Due: ${w.dueAt}` : ''].filter(Boolean).join('\n');
  const doneText = done === '## What done looks like' ? '' : done;

  const byKind = (k: PackAsset['kind'][]) => assets.filter((a) => k.includes(a.kind));
  const linkLines: string[] = [];
  const drive = byKind(['drive', 'doc']);
  if (drive.length) linkLines.push('Drive and docs:', ...drive.map((a) => `- [${a.title}](${a.url})`));
  const slack = byKind(['slack']);
  if (slack.length) linkLines.push('Slack permalinks:', ...slack.map((a) => `- [${a.title}](${a.url})`));
  const other = byKind(['gmail', 'org62', 'other']);
  if (other.length) linkLines.push('Other:', ...other.map((a) => `- [${a.title}](${a.url})`));
  if (sessions.length) linkLines.push('Prior sessions:', ...sessions.map((s) => `- ${s.title}${s.url ? ` (${s.url})` : s.id ? ` (${s.id})` : ''}${s.summary ? `: ${s.summary}` : ''}`));
  const links = linkLines.length ? `## Links\n${linkLines.join('\n')}` : '';

  const who = people.length ? `## People\n${bullets(people.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)))}` : '';
  const oppText = opp ? `## Opportunity\n${bullets([`${opp.name}${opp.account ? ` (${opp.account})` : ''}`, [opp.stage && `Stage: ${opp.stage}`, opp.amount && `Amount: ${opp.amount}`, opp.closeDate && `Close: ${opp.closeDate}`].filter(Boolean).join(', ')].filter(Boolean))}` : '';

  const constraints = [
    '## Constraints',
    bullets([
      `Work only in ${repoPath}.`,
      `Commit on a branch${input.branchHint ? ` (suggested: ${input.branchHint})` : ''}; never commit to main.`,
      'Do not send, post, or write to any external system (Slack, Gmail, Calendar, Drive, Org62, VDP). Stop at drafts.',
      'Do not print or copy tokens, cookies, or passwords.',
      'Ask me before anything destructive or irreversible.',
    ]),
  ].join('\n');

  return packPrompt(
    [
      { id: 'tag', text: tag, priority: 0, required: true, order: 0 },
      { id: 'summary', text: goal, priority: 1, order: 1 },
      { id: 'task', text: doneText, priority: 2, order: 2 },
      { id: 'links', text: links, priority: 3, order: 3 },
      { id: 'opp', text: oppText, priority: 4, order: 4 },
      { id: 'people', text: who, priority: 5, order: 5 },
      { id: 'constraints', text: constraints, priority: 0, required: true, order: 6 },
    ],
    max,
  );
}

// ------------------------------------------------------------------- URLs

const enc = encodeURIComponent;
const expandTilde = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** `claude://code/new?folder=<abs>&q=<prompt>`; the prompt must already begin with the [cc:id] tag. */
export function newSessionUrl(args: { folder: string; prompt: string; workItemId?: string }): string {
  const folder = expandTilde(args.folder);
  if (!path.isAbsolute(folder) || folder.includes('\0')) throw new LaunchError(`folder must be an absolute path: ${args.folder}`, 'bad_folder');
  let prompt = args.prompt;
  if (args.workItemId) {
    const tag = ccTag(args.workItemId);
    if (!prompt.startsWith(tag)) prompt = `${tag}\n\n${prompt}`;
  }
  if (prompt.length > MAX_PROMPT_CHARS) prompt = prompt.slice(0, MAX_PROMPT_CHARS); // Desktop would do the same; keep the tag intact since it is first
  return `claude://code/new?folder=${enc(path.normalize(folder))}&q=${enc(prompt)}`;
}

/** Resolve the context pack and URL in one go. */
export function prepareKickoff(input: ContextPackInput): { url: string; pack: PackedPrompt; folder: string; tag: string } {
  const folder = expandTilde(input.repoPath);
  const pack = buildContextPack({ ...input, repoPath: folder });
  return { url: newSessionUrl({ folder, prompt: pack.prompt, workItemId: input.workItem.id }), pack, folder, tag: ccTag(input.workItem.id) };
}

/** Accepts `last` or a desktop session id (`local_...` = hostSessionId in ~/.claude/sessions/<pid>.json). */
export function continueUrl(sessionId: string = 'last'): string {
  if (sessionId !== 'last' && !LOCAL_SESSION_RE.test(sessionId)) {
    const hint = CLI_UUID_RE.test(sessionId) ? ' (this is a CLI session UUID; use hostSessionId, or resumeUrl() to import it)' : '';
    throw new LaunchError(`continue needs "last" or a local_<id> desktop session id${hint}`, 'bad_session');
  }
  return `claude://code/continue?session=${enc(sessionId)}`;
}

export function needsInputUrl(sessionId?: string): string {
  if (sessionId === undefined) return 'claude://code/needs-input';
  if (!LOCAL_SESSION_RE.test(sessionId)) throw new LaunchError('needs-input session must be a local_<id> desktop session id', 'bad_session');
  return `claude://code/needs-input?session=${enc(sessionId)}`;
}

/** Import a CLI session (UUID) into Desktop. Separate verb from /code/continue. */
export function resumeUrl(cliSessionId: string): string {
  if (!CLI_UUID_RE.test(cliSessionId)) throw new LaunchError('resume needs a CLI session UUID', 'bad_session');
  return `claude://resume?session=${enc(cliSessionId)}`;
}

/** Pull the id `continueUrl` accepts out of a ~/.claude/sessions/<pid>.json entry. */
export function desktopSessionId(entry: { hostSessionId?: unknown }): string | undefined {
  return typeof entry.hostSessionId === 'string' && LOCAL_SESSION_RE.test(entry.hostSessionId) ? entry.hostSessionId : undefined;
}

// ------------------------------------------------------------------- open

/** Pure gate used by open(); exported so it is testable without touching `open`. */
export function assertOpenAllowed(url: string, confirm: unknown): void {
  if (confirm !== true) throw new LaunchError('open() requires confirm: true', 'confirm_required');
  let u: URL;
  try { u = new URL(url); } catch { throw new LaunchError(`not a url: ${url.slice(0, 40)}`, 'url_not_allowed'); }
  const loopback = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'claude:' && !loopback) throw new LaunchError(`refusing to open ${u.protocol}//${u.hostname}`, 'url_not_allowed');
}

/** Shell out to macOS `open`. Behind an explicit confirm; never called by tests or by the build. */
export function open(url: string, opts: { confirm: boolean }): Promise<void> {
  try { assertOpenAllowed(url, opts?.confirm); } catch (e) { return Promise.reject(e); }
  return new Promise((resolve, reject) => {
    execFile('open', [url], (err) => (err ? reject(err) : resolve()));
  });
}
