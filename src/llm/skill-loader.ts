/**
 * Loads prescriptive scanner skills (SCANNER.md §4) and renders the prompt.
 *
 * Caching layout (SCANNER.md §7 "Prompt-cache the skill text and the context pack"):
 *   systemPrompt = [ _scanner-common.md + skill body   ← static, byte-stable, globally cacheable
 *                  , SYSTEM_PROMPT_DYNAMIC_BOUNDARY
 *                  , context pack JSON ]              ← per run, cached across the run's turns
 *   user prompt  = Run block (scope, window, cursor, substitution values) + prefetched items
 * Skill bodies are never template-substituted: `{{…}}` values are given in the Run block, so the
 * static prefix stays identical across runs and users.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { personaOf, renderPersonaBlock } from '../personas';
import { DEFAULT_SCANNING_PREFS, type CoverageObject, type NormalizedSourceItem, type ScanContext, type TimeWindow } from '../scanner/types';

export interface SkillFrontmatter {
  skill: string;
  version: string;
  connector?: string;
  model?: string;
  effort?: string;
  max_turns?: number;
  budget_usd_per_run?: number;
  allowed_tools?: string[];
  never_tools?: string[];
  scopes?: string[];
  [k: string]: unknown;
}

export interface LoadedSkill {
  path: string;
  frontmatter: SkillFrontmatter;
  body: string;
  /** sha256 of the file, first 12 hex chars. */
  contentHash: string;
  /** `<skill>@<version>`: stored on scan runs and evidence (SCANNER.md §4). */
  versionTag: string;
}

/** Minimal YAML subset: `k: v`, `k: [a, b]`, block lists (`- a`), numbers, booleans, quoted strings. */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const rawLine of m[1]!.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as unknown[]).push(scalar(item[1]!));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, val] = kv as unknown as [string, string, string];
    if (val === '') {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    if (/^\[.*\]$/.test(val)) {
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(scalar);
    } else data[key] = scalar(val);
  }
  return { data, body: text.slice(m[0].length) };
}

function scalar(v: string): unknown {
  const s = v.trim();
  if (/^".*"$|^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const cache = new Map<string, { mtimeMs: number; skill: LoadedSkill }>();

export function resolveSkillPath(skillPath: string, repoRoot = process.cwd()): string {
  return path.isAbsolute(skillPath) ? skillPath : path.join(repoRoot, skillPath);
}

export function loadSkill(skillPath: string, repoRoot?: string): LoadedSkill {
  const abs = resolveSkillPath(skillPath, repoRoot);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`config: skill file not found: ${skillPath}`);
  }
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.skill;
  const text = fs.readFileSync(abs, 'utf8');
  const { data, body } = parseFrontmatter(text);
  if (typeof data.skill !== 'string' || data.version == null) {
    throw new Error(`config: invalid skill frontmatter (skill + version required): ${skillPath}`);
  }
  const fm = { ...data, skill: data.skill, version: String(data.version) } as SkillFrontmatter;
  const skill: LoadedSkill = {
    path: abs,
    frontmatter: fm,
    body: body.trim(),
    contentHash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12),
    versionTag: `${fm.skill}@${fm.version}`,
  };
  cache.set(abs, { mtimeMs: stat.mtimeMs, skill });
  return skill;
}

/** Shared rules live next to the source skills. */
export function commonSkillPathFor(skillPath: string): string {
  return path.join(path.dirname(skillPath), '_scanner-common.md');
}

/** Compact context pack: short keys are not used, so Haiku reads it reliably; size is bounded instead. */
/** A cursor value longer than this is fetcher state (per-file offsets, seen ids): the run header carries what to echo. */
const PACK_CURSOR_MAX = 180;

export function renderContextPack(ctx: ScanContext, opts: { maxOpenItems?: number; maxTitle?: number; maxInitiatives?: number } = {}): string {
  const maxItems = opts.maxOpenItems ?? 60;
  const maxInitiatives = opts.maxInitiatives ?? 25;
  const maxTitle = opts.maxTitle ?? 90;
  const cut = (s: string | undefined, n = maxTitle) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
  // CTX-1: a deterministic fetcher's cursor (Claude sessions: about 8 K characters on a real machine) was rendered here
  // in full, although the agent only ever echoes the run header's cursor (CUR-1).
  const cursor = ctx.cursor && ctx.cursor.value.length > PACK_CURSOR_MAX ? { at: ctx.cursor.at, value: '(fetcher state; echo the run header cursor)' } : ctx.cursor;
  const pack = {
    scope: `${ctx.scope.connector}:${ctx.scope.scope}`,
    me: ctx.me,
    cursor,
    gaps: ctx.gaps.slice(0, 10),
    watchList: ctx.watchList,
    aliases: ctx.aliases,
    initiatives: ctx.initiatives.slice(0, maxInitiatives).map((i) => ({ ...i, title: cut(i.title), purpose: cut(i.purpose, 140) })),
    ...(ctx.initiatives.length > maxInitiatives ? { initiativesTruncated: ctx.initiatives.length - maxInitiatives } : {}),
    openItems: ctx.openItems.slice(0, maxItems).map((o) => {
      const ext = o as typeof o & { resolution?: string; involvement?: string };
      return {
        id: o.workItemId,
        ...(o.initiativeId ? { initiative: o.initiativeId } : {}),
        kind: o.kind,
        state: o.state,
        ...(ext.resolution ? { resolution: ext.resolution } : {}),
        ...(ext.involvement ? { involvement: ext.involvement } : {}),
        title: cut(o.title),
        ...(o.purpose ? { purpose: cut(o.purpose, 140) } : {}),
        people: o.people.slice(0, 6),
        accounts: o.accounts.slice(0, 4),
        keywords: o.keywords.slice(0, 8),
        threads: o.threadRefs.slice(0, 4),
        files: o.fileRefs.slice(0, 4),
        ...(o.lastEvidenceAt ? { last: o.lastEvidenceAt } : {}),
      };
    }),
    ...(ctx.openItems.length > maxItems ? { openItemsTruncated: ctx.openItems.length - maxItems } : {}),
    skillVersion: ctx.skillVersion,
  };
  return JSON.stringify(pack);
}

/**
 * The scanner's system prompt (SCANNER.md §7): the static, byte-stable prefix (`_scanner-common.md` + the skill),
 * the dynamic boundary, then the per-run part: the context pack and the Persona block (D-55). The persona lives only
 * after the boundary, so every persona shares one cached prefix per skill, and a persona's block is the same bytes
 * from run to run (renderPersonaBlock is deterministic). No persona in the context: the SE persona's block.
 */
export function scannerSystemPrompt(commonBody: string, skillBody: string, ctx: ScanContext, boundary: string): string[] {
  return [`${commonBody}\n\n---\n\n${skillBody}`, boundary, `## Context pack (JSON)\n${renderContextPack(ctx)}\n\n${renderPersonaBlock(ctx.persona ?? personaOf({}))}`];
}

export interface RunBlockInput {
  runId: string;
  mode: string;
  window: TimeWindow;
  ctx: ScanContext;
  /** Extra substitution values for this scope (channel id, thread ref, SOQL ids…). */
  vars?: Record<string, string | number | boolean | undefined>;
  /** Deterministic sources: what the fetcher already covered (listed in the header). */
  coverage?: CoverageObject[];
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** The volatile part: everything the skill's `{{…}}` placeholders refer to. */
export function renderRunBlock(r: RunBlockInput): string {
  const fromUnix = unix(r.window.from);
  const toUnix = unix(r.window.to);
  const vars: Record<string, unknown> = {
    runId: r.runId,
    mode: r.mode,
    scope: `${r.ctx.scope.connector}:${r.ctx.scope.scope}`,
    'window.from': r.window.from,
    'window.to': r.window.to,
    'window.fromUnix': fromUnix,
    'window.toUnix': toUnix,
    /** Slack: 2-minute overlap on the lower bound (brief 09 §5.4); dedupe absorbs it. */
    'window.afterUnix': fromUnix - 120,
    'window.fromDate': r.window.from.slice(0, 10),
    'window.toDate': r.window.to.slice(0, 10),
    'window.fromSoql': soqlDateTime(r.window.from),
    'window.toSoql': soqlDateTime(r.window.to),
    'cursor.value': r.ctx.cursor?.value ?? '',
    'cursor.at': r.ctx.cursor?.at ?? '',
    'me.userId': r.ctx.me.userId,
    'me.name': r.ctx.me.name,
    'me.email': r.ctx.me.email ?? '',
    'me.slackId': r.ctx.me.slackId ?? '',
    'me.org62UserId': r.ctx.me.org62UserId ?? '',
    // SCAN-SET: Settings ▸ Scanning, so a skill can say what is on (the cc tools enforce the same).
    'scan.channelAsks': (r.ctx.scanning ?? DEFAULT_SCANNING_PREFS).channelAsks,
    'scan.meetingCatchUps': (r.ctx.scanning ?? DEFAULT_SCANNING_PREFS).meetingCatchUps ? 'on' : 'off',
    'scan.oppTeamCatchUps': (r.ctx.scanning ?? DEFAULT_SCANNING_PREFS).oppTeamCatchUps ? 'on' : 'off',
    ...(r.vars ?? {}),
  };
  const lines = Object.entries(vars)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `- {{${k}}} = ${String(v)}`);
  const out = ['## Run (header)', ...lines];
  if (r.coverage?.length) {
    out.push('', '### Fetcher coverage (already reported; echo it in cc_report_coverage)', JSON.stringify(r.coverage.slice(0, 80)));
  }
  return out.join('\n');
}

export function soqlDateTime(iso: string): string {
  // SOQL datetime literal: 2026-11-05T15:42:05Z (no millis, no quotes)
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Prefetched items for the user prompt, compacted: an email's body appears ONCE (`payload.bodyNew`, ≤ 1500 chars,
 * with `bodyFull` ≤ 600 for resolving references; bulk mail ≤ 300), and other long payload strings are capped at
 * 800. Before, 25 emails rendered excerpt + snippet + bodyNew + bodyFull at 2000 chars each (≈ 60–85K tokens) and
 * every busy Gmail catch-up tripped the prefix tripwire forever (stress finding G-3).
 */
export function renderPrefetched(items: NormalizedSourceItem[] | undefined, ids?: Map<string, string>): string {
  if (!items?.length) return '';
  const rows = items.map((it) => {
    const p = it.payload ? (capStrings(compactPayload(it.payload), 800) as Record<string, unknown>) : undefined;
    const hasBody = typeof it.payload?.bodyNew === 'string';
    return {
      sourceItemId: ids?.get(it.dedupeKey),
      kind: it.kind,
      externalId: it.externalId,
      occurredAt: it.occurredAt,
      author: it.author,
      participants: it.participants?.slice(0, 12),
      title: it.title,
      // The email body is in payload.bodyNew; the excerpt would repeat it.
      excerpt: hasBody ? undefined : it.excerpt,
      threadRef: it.threadRef,
      fileRefs: it.fileRefs,
      accountHints: it.accountHints,
      oppHints: it.oppHints,
      permalink: it.permalink,
      // BE-2b skills read fetcher fields from payload (direction, toMe, bodyNew, plan…).
      payload: p,
    };
  });
  return ['## Prefetched items (already recorded; link them, do not re-record)', JSON.stringify(rows)].join('\n');
}

function compactPayload(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  const bulk = p.bulk === true;
  if (typeof p.bodyNew === 'string') out.bodyNew = clip(p.bodyNew, bulk ? 300 : 1500);
  if (typeof p.bodyFull === 'string') {
    if (bulk || p.bodyFull === p.bodyNew) delete out.bodyFull;
    else out.bodyFull = clip(p.bodyFull, 600);
  }
  if (typeof p.snippet === 'string' && typeof p.bodyNew === 'string') delete out.snippet;
  if (Array.isArray(p.urls)) out.urls = p.urls.slice(0, 8);
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function capStrings(v: unknown, max: number, depth = 0): unknown {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…` : v;
  if (depth > 5 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => capStrings(x, max, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, capStrings(x, max, depth + 1)]));
}
