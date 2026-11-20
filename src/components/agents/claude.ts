/**
 * Claude Desktop deep links (pure). The contract supplies `AgentRun.deepLink` and `LaunchResult.url`;
 * these helpers only validate and read them. Nothing here opens anything: opening is an explicit click
 * handled by `openClaudeUrl`, which refuses any scheme other than claude://.
 *
 *   claude://code/continue?session=<local_… host session id>   Open in Claude
 *   claude://code/new?folder=<abs path>&q=<prompt>               Start in Claude
 *   claude://code/needs-input                                    All waiting
 */
import type { AgentRun } from '@/contract';

export const NEEDS_INPUT_URL = 'claude://code/needs-input';

export function isClaudeUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && /^claude:\/\/(code\/(continue|new|needs-input)|resume)(\?|$)/.test(u);
}

/** Open in Claude: the contract's deepLink, else built from the host session id. Null for non-Claude runs. */
export function openInClaudeUrl(run: Pick<AgentRun, 'kind' | 'deepLink' | 'sessionId'>): string | null {
  if (run.kind !== 'claude_session') return null;
  if (isClaudeUrl(run.deepLink) && !/^claude:\/\/code\/new/.test(run.deepLink)) return run.deepLink;
  if (run.sessionId) return `claude://code/continue?session=${encodeURIComponent(run.sessionId)}`;
  return null;
}

/** A not-yet-started session carries a claude://code/new link; this is the "Start in Claude" target. */
export function startInClaudeUrl(run: Pick<AgentRun, 'kind' | 'deepLink'>): string | null {
  return run.kind === 'claude_session' && isClaudeUrl(run.deepLink) && /^claude:\/\/code\/new\?/.test(run.deepLink) ? run.deepLink : null;
}

export interface NewLink {
  folder: string;
  prompt: string;
}

/** Decode a claude://code/new link into its folder and prompt (for the confirm popover). */
export function parseNewLink(url: string): NewLink | null {
  if (!/^claude:\/\/code\/new\?/.test(url)) return null;
  const qs = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  return { folder: qs.get('folder') ?? '', prompt: qs.get('q') ?? '' };
}

/** The first `max` lines of the context pack, and how many lines were cut. */
export function promptPreview(prompt: string, max = 20): { lines: string[]; hidden: number } {
  const all = prompt.replace(/\r\n/g, '\n').split('\n');
  return { lines: all.slice(0, max), hidden: Math.max(0, all.length - max) };
}

/** "~/Projects/x" for a path under the home directory (display only). */
export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

export type Opener = (url: string) => void;
/** Test seam: e2e sets window.__ccOpenUrl to capture the URL instead of handing it to the OS. */
declare global {
  interface Window {
    __ccOpenUrl?: (url: string) => void;
  }
}

const defaultOpener: Opener = (url) => {
  if (typeof window.__ccOpenUrl === 'function') return window.__ccOpenUrl(url);
  window.location.assign(url);
};

/**
 * Open a claude:// URL. Call ONLY from an explicit click. Returns false (and does nothing) for any other scheme.
 * Tests inject `opener` to assert the URL without opening it.
 */
export function openClaudeUrl(url: string, opener: Opener = defaultOpener): boolean {
  if (!isClaudeUrl(url)) return false;
  opener(url);
  return true;
}

/**
 * 2026-11-13 audit C8: Start in Claude's task picker ranks every open task (it stopped at 40): the ranked ones first in
 * rank order, then the rest by title; a search keeps the tasks whose title or account holds every word, title matches
 * first. Pure.
 */
export function rankTasks<T extends { id: string; title: string; rank: number | null; refs?: { account: { label?: string | null } | null } }>(items: readonly T[], q: string): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (t: T) => `${t.title} ${t.refs?.account?.label ?? ''}`.toLowerCase();
  const hit = words.length ? items.filter((t) => words.every((w) => hay(t).includes(w))) : [...items];
  const inTitle = (t: T) => (words.length && words.every((w) => t.title.toLowerCase().includes(w)) ? 0 : 1);
  return hit.sort((a, b) => inTitle(a) - inTitle(b) || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
}
