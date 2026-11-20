// Release helpers (D-57, docs/RELEASING.md): semver bumps and the CHANGELOG section written from commit subjects.
// Pure functions plus thin git wrappers, shared by scripts/release.mjs and its tests.
import { execFileSync } from 'node:child_process';

export const BUMPS = ['patch', 'minor', 'major'];

/** "1.2.3" + "minor" → "1.3.0". Pre-release or build suffixes are dropped. */
export function bumpVersion(version, bump) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!m) throw new Error(`not a semver version: ${version}`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (bump === 'major') [maj, min, pat] = [maj + 1, 0, 0];
  else if (bump === 'minor') [min, pat] = [min + 1, 0];
  else if (bump === 'patch') pat += 1;
  else throw new Error(`bump must be one of ${BUMPS.join(', ')}; got ${bump}`);
  return `${maj}.${min}.${pat}`;
}

/** Keep a Changelog headings, in order; conventional-commit types map onto them. */
export const HEADINGS = ['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Other'];
const TYPE_HEADING = { feat: 'Added', fix: 'Fixed', perf: 'Changed', refactor: 'Changed', revert: 'Removed', security: 'Security', sec: 'Security' };
/** Housekeeping that never reaches the changelog. */
const SKIP_TYPES = new Set(['chore', 'ci', 'build', 'test', 'style', 'wip']);

/** One commit subject → {heading, line} or null (merges, release commits, housekeeping). */
export function classifySubject(subject) {
  const s = String(subject).trim();
  if (!s || /^Merge\b/.test(s) || /^chore\(release\)/i.test(s)) return null;
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(s);
  if (!m) return { heading: 'Other', line: capitalize(s) };
  const [, type, scope, bang, text] = m;
  const t = type.toLowerCase();
  if (SKIP_TYPES.has(t) && !bang) return null;
  const heading = bang ? 'Changed' : (TYPE_HEADING[t] ?? 'Other');
  const line = `${scope ? `**${scope}**: ` : ''}${capitalize(text)}${bang ? ' (breaking)' : ''}`;
  return { heading, line };
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Commit subjects → {Added: [...], Fixed: [...], ...}, de-duplicated, in commit order. */
export function groupSubjects(subjects) {
  const out = {};
  const seen = new Set();
  for (const s of subjects) {
    const c = classifySubject(s);
    if (!c || seen.has(c.line)) continue;
    seen.add(c.line);
    (out[c.heading] ??= []).push(c.line);
  }
  return out;
}

/**
 * Split a CHANGELOG into {head, unreleased, rest}: `unreleased` is the body under "## [Unreleased]" (hand-written
 * entries), `rest` starts at the next "## [" heading.
 */
export function splitChangelog(text) {
  const lines = text.split('\n');
  const u = lines.findIndex((l) => /^## \[Unreleased\]/i.test(l));
  if (u < 0) {
    const first = lines.findIndex((l) => /^## \[/.test(l));
    const at = first < 0 ? lines.length : first;
    return { head: lines.slice(0, at).join('\n').replace(/\n+$/, ''), unreleased: '', rest: lines.slice(at).join('\n') };
  }
  const next = lines.findIndex((l, i) => i > u && /^## \[/.test(l));
  const end = next < 0 ? lines.length : next;
  return { head: lines.slice(0, u).join('\n').replace(/\n+$/, ''), unreleased: lines.slice(u + 1, end).join('\n').trim(), rest: lines.slice(end).join('\n') };
}

/** Parse "### Added\n- a\n- b" blocks; text before any heading goes under Other. */
export function parseSections(body) {
  const out = {};
  let cur = 'Other';
  let item = null;
  const flush = () => {
    if (item !== null) (out[cur] ??= []).push(item.trim());
    item = null;
  };
  for (const raw of String(body).split('\n')) {
    const h = /^###\s+(.+?)\s*$/.exec(raw);
    if (h) {
      flush();
      cur = HEADINGS.find((x) => x.toLowerCase() === h[1].toLowerCase()) ?? h[1];
      continue;
    }
    const b = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (b) {
      flush();
      item = b[1];
    } else if (raw.trim() && item !== null) item += ` ${raw.trim()}`;
    else if (raw.trim()) {
      flush();
      item = raw.trim();
    }
  }
  flush();
  return out;
}

/** The new release section: hand-written Unreleased entries first, then the commit subjects. */
export function renderSection({ version, date, unreleased = '', subjects = [] }) {
  const hand = parseSections(unreleased);
  const auto = groupSubjects(subjects);
  const headings = [...HEADINGS, ...Object.keys(hand).filter((h) => !HEADINGS.includes(h))];
  const parts = [`## [${version}] - ${date}`];
  for (const h of headings) {
    const items = [...(hand[h] ?? []), ...(auto[h] ?? []).filter((l) => !(hand[h] ?? []).includes(l))];
    if (!items.length) continue;
    parts.push('', `### ${h}`, ...items.map((i) => `- ${i}`));
  }
  if (parts.length === 1) parts.push('', '- No user-facing changes.');
  return parts.join('\n');
}

/** The whole new CHANGELOG: an empty Unreleased section, then the new release, then the older ones. */
export function foldChangelog(text, { version, date, subjects }) {
  const { head, unreleased, rest } = splitChangelog(text);
  const section = renderSection({ version, date, unreleased, subjects });
  return `${head}\n\n## [Unreleased]\n\n${section}\n${rest ? `\n${rest.replace(/^\n+/, '')}` : ''}`.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

/** The CHANGELOG sections newer than `from` up to and including `to` (what `npm run update` prints). */
export function sectionsBetween(text, from, to) {
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  };
  const out = [];
  const re = /^## \[(\d+\.\d+\.\d+)\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text))) if (cmp(m[1], from) > 0 && cmp(m[1], to) <= 0) out.push(m[0].trimEnd());
  return out;
}

// ── git ─────────────────────────────────────────────────────────────────────────────────────

export function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'] }).trim();
}

export function lastTag(cwd) {
  try {
    return git(cwd, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], { quiet: true }) || null;
  } catch {
    return null;
  }
}

export function subjectsSince(cwd, tag) {
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  const out = git(cwd, ['log', '--no-merges', '--format=%s', ...range]);
  return out ? out.split('\n').reverse() : [];
}

export function isClean(cwd) {
  return git(cwd, ['status', '--porcelain']) === '';
}

export function today(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
