/**
 * Repo resolver. Given a work item's hints (account, keywords, tool name) pick the local repo
 * under ~/Projects that a Claude Code session should open in. Read-only: directory names,
 * ~/Projects/PORTS.md rows and README heads. Returns ranked candidates with reasons.
 *
 *   "package Pulse footprint"     -> ~/Projects/greg-playground
 *   "<customer> headless demo"    -> ~/Projects/<repo>-worktrees/<...-customer> (then ~/Projects/<repo>)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface RepoHints {
  account?: string;
  keywords?: string[];
  /** Free text, e.g. the work item title. Tokenised like keywords. */
  text?: string;
  /** A ToolAdapter id (manifest id) or tool name. */
  toolName?: string;
}

export interface RepoCandidate {
  path: string;
  name: string;
  kind: 'repo' | 'worktree';
  /** For worktrees: the main repo they belong to (name minus "-worktrees"). */
  parent?: string;
  score: number;
  reasons: string[];
}

export interface ResolveOptions {
  projectsDir?: string;
  portsMdPath?: string;
  /** Tool id/name -> directory name under projectsDir. */
  toolAliases?: Record<string, string>;
  limit?: number;
}

export const DEFAULT_TOOL_ALIASES: Record<string, string> = {
  'pulse-footprint': 'greg-playground',
  'pulse': 'greg-playground',
  'talk-track': 'talk-track',
  'afd360-estimator': 'afd360-estimates',
  'afd360-estimate-new': 'afd360-estimates',
  'afd360': 'afd360-estimates',
};

const STOP = new Set(['the', 'a', 'an', 'for', 'to', 'of', 'and', 'or', 'in', 'on', 'with', 'package', 'build', 'make', 'create', 'new', 'kick', 'off', 'run', 'app', 'project', 'please', 'update', 'prep']);

export const tokenize = (s: string): string[] =>
  [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)))];

interface PortRow { app: string; path?: string; notes: string }

export function parsePortsMd(md: string, home = os.homedir()): PortRow[] {
  const rows: PortRow[] = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || !/^\d{2,5}$/.test(cells[0] ?? '')) continue;
    const p = /`([^`]+)`/.exec(cells[2] ?? '')?.[1];
    rows.push({ app: cells[1] ?? '', path: p ? (p.startsWith('~') ? path.join(home, p.slice(1)) : p) : undefined, notes: cells.slice(4).join(' ') });
  }
  return rows;
}

async function isDir(p: string) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function readmeHead(dir: string): Promise<string> {
  for (const n of ['README.md', 'readme.md', 'README']) {
    try { return (await readFile(path.join(dir, n), 'utf8')).slice(0, 4000).toLowerCase(); } catch { /* next */ }
  }
  return '';
}

export async function discoverRepos(projectsDir: string): Promise<Omit<RepoCandidate, 'score' | 'reasons'>[]> {
  const out: Omit<RepoCandidate, 'score' | 'reasons'>[] = [];
  let entries: string[] = [];
  try { entries = await readdir(projectsDir); } catch { return out; }
  for (const name of entries.sort()) {
    if (name.startsWith('.')) continue;
    const p = path.join(projectsDir, name);
    if (!(await isDir(p))) continue;
    if (name.endsWith('-worktrees')) {
      const parent = name.slice(0, -'-worktrees'.length);
      for (const w of (await readdir(p).catch(() => [])).sort()) {
        const wp = path.join(p, w);
        if (!w.startsWith('.') && (await isDir(wp))) out.push({ path: wp, name: w, kind: 'worktree', parent });
      }
    } else out.push({ path: p, name, kind: 'repo' });
  }
  return out;
}

export async function resolveRepos(hints: RepoHints, opts: ResolveOptions = {}): Promise<RepoCandidate[]> {
  const projectsDir = opts.projectsDir ?? path.join(os.homedir(), 'Projects');
  const portsPath = opts.portsMdPath ?? path.join(projectsDir, 'PORTS.md');
  const aliases = { ...DEFAULT_TOOL_ALIASES, ...(opts.toolAliases ?? {}) };

  const hintTokens = tokenize([hints.account ?? '', hints.text ?? '', ...(hints.keywords ?? [])].join(' '));
  const accountTokens = tokenize(hints.account ?? '');
  const tool = hints.toolName?.toLowerCase().trim();
  const toolTokens = tool ? tokenize(tool) : [];
  const allTokens = [...new Set([...hintTokens, ...toolTokens])];
  if (!allTokens.length && !tool) return [];

  const ports = await readFile(portsPath, 'utf8').then((m) => parsePortsMd(m), () => [] as PortRow[]);
  const repos = await discoverRepos(projectsDir);
  const results: RepoCandidate[] = [];

  for (const r of repos) {
    const reasons: string[] = [];
    let score = 0;
    const add = (n: number, why: string) => { score += n; reasons.push(why); };
    const nameTokens = tokenize(r.name.replace(/-/g, ' '));

    // 1. explicit tool alias
    if (tool) {
      const target = aliases[tool];
      if (target && r.kind === 'repo' && r.name === target) add(20, `tool "${tool}" maps to ${target}`);
    }
    // 2. directory name
    for (const t of allTokens) {
      if (nameTokens.includes(t)) add(accountTokens.includes(t) ? 7 : 5, `name contains "${t}"`);
      else if (r.name.toLowerCase().includes(t)) add(3, `name partly matches "${t}"`);
    }
    // worktrees inherit the parent repo's name tokens at lower weight
    if (r.parent) {
      for (const t of tokenize(r.parent.replace(/-/g, ' '))) if (allTokens.includes(t)) add(2, `worktree of ${r.parent}`);
    }
    // 3. PORTS.md rows whose path lives in this repo/worktree
    const rowsHere = ports.filter((row) => row.path && (row.path === r.path || row.path.startsWith(r.path + path.sep)));
    // main repos also own the rows of their worktrees' parent (e.g. a demos repo owns the headless apps that live under it)
    const rowsParent = r.kind === 'repo' ? ports.filter((row) => row.path && row.path.startsWith(path.join(projectsDir, r.name) + path.sep)) : [];
    const seen = new Set<PortRow>();
    for (const row of [...rowsHere, ...rowsParent]) {
      if (seen.has(row)) continue;
      seen.add(row);
      const hay = `${row.app} ${row.notes}`.toLowerCase();
      const hits = allTokens.filter((t) => hay.includes(t));
      if (hits.length) add(Math.min(2 * hits.length, 8), `PORTS.md "${row.app.slice(0, 50)}" mentions ${hits.join(', ')}`);
    }
    // 4. README head (weak signal, capped)
    if (score > 0 || r.kind === 'repo') {
      const readme = await readmeHead(r.path);
      const hits = allTokens.filter((t) => readme.includes(t));
      if (hits.length) add(Math.min(hits.length, 4), `README mentions ${hits.slice(0, 4).join(', ')}`);
    }
    if (r.kind === 'worktree' && score > 0 && accountTokens.length && !accountTokens.some((t) => nameTokens.includes(t))) {
      score *= 0.3;
      reasons.push('worktree belongs to a different account (score x0.3)');
    }
    if (score > 0) results.push({ ...r, score, reasons });
  }

  results.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === 'worktree' ? -1 : 1) || a.name.localeCompare(b.name));
  return results.slice(0, opts.limit ?? 5);
}
