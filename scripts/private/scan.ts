/**
 * npm run scan:private [-- --no-history] [--no-db] [--json]
 *
 * Before a push (and before connecting the first remote): does anything git would publish hold private material?
 *   - names: the real account, person and opportunity names in the local database (DATABASE_URL), read at run time
 *     and kept in memory only; placeholders from src/mock/seed.example.json are skipped. Accounts also count by the
 *     short forms people write (core, d/b/a brand, distinctive first word) and by their Org62 parents (D-69 kv);
 *   - ids: Org62 15/18-character record ids, Slack ids, salesforce.com emails (placeholders skipped).
 * It scans every tracked file at HEAD and, unless --no-history, the lines every commit added (git log -p --all)
 * plus commit messages. It prints FILE PATHS AND COUNTS ONLY, never a matched value.
 *
 * Exit code: 0 clean, 2 hits in tracked files (history hits alone exit 0 but say what to do).
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { createDb, databaseName, resolveDatabaseUrl } from '../../src/db/client';
import { addCounts, buildMatchers, formatCounts, formatHits, scanLine, scanText, skipPath, total, type Counts, type FileHit, type Matcher, type NameLists } from '../../src/lib/private-scan';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

async function namesFromDb(): Promise<{ lists: NameLists; note: string }> {
  const empty: NameLists = { accounts: [], opportunities: [], people: [], owner: [], ids: [] };
  if (has('--no-db')) return { lists: empty, note: 'names: skipped (--no-db)' };
  const url = resolveDatabaseUrl();
  const handle = createDb({ url, max: 1, applicationName: 'control-center-scan-private' });
  try {
    const col = async (q: ReturnType<typeof sql>) => ((await handle.db.execute(q)).rows as Array<{ v: string | null }>).map((r) => r.v).filter((v): v is string => !!v);
    const safe = (q: ReturnType<typeof sql>) => col(q).catch(() => [] as string[]);
    const ids = (
      await Promise.all([
        safe(sql`select org62_account_id as v from accounts`),
        safe(sql`select org62_opportunity_id as v from opportunities`),
        safe(sql`select org62_user_id as v from opportunity_team_members`),
        safe(sql`select org62_event_id as v from org62_events`),
        safe(sql`select org62_dc_id as v from deal_contributions`),
        safe(sql`select external_id as v from person_identities`),
        safe(sql`select external_id as v from channels`),
        safe(sql`select external_id as v from canvases`),
      ])
    )
      .flat()
      .filter((v) => /^[A-Za-z0-9]{8,18}$/.test(v));
    const [accounts, aliases, parents, opportunities, people, me, users] = await Promise.all([
      col(sql`select name as v from accounts`),
      col(sql`select value as v from account_aliases where kind in ('name', 'short_name')`),
      // the Org62 parents above my book (D-69 hierarchy, kv): companies the accounts table never holds
      safe(sql`select n.value ->> 'name' as v from user_settings s, jsonb_each(s.value -> 'nodes') n where s.key = 'cc.org62.account_hierarchy' and jsonb_typeof(s.value -> 'nodes') = 'object'`),
      col(sql`select name as v from opportunities`),
      col(sql`select display_name as v from people where not is_me`),
      col(sql`select display_name as v from people where is_me union select primary_email from people where is_me`),
      col(sql`select display_name as v from users union select email from users`),
    ]);
    const lists: NameLists = { accounts: [...accounts, ...aliases, ...parents], opportunities, people, owner: [...me, ...users], ids };
    return { lists, note: `names from ${databaseName(url)}: ${accounts.length} accounts, ${opportunities.length} opportunities, ${people.length} people, ${new Set(ids).size} ids` };
  } catch (err) {
    return { lists: empty, note: `names: database unavailable (${err instanceof Error ? err.message.split('\n')[0] : 'error'}); ids only` };
  } finally {
    await handle.close();
  }
}

/** Names the committed placeholder seed uses (ACME, Globex, …): never a finding. */
function placeholderNames(): Set<string> {
  const out = new Set<string>();
  try {
    const walk = (v: unknown, key = '') => {
      if (typeof v === 'string') {
        if (/name|title|label|account/i.test(key) && v.length < 120) out.add(v.toLowerCase());
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(JSON.parse(readFileSync(path.join(root, 'src/mock/seed.example.json'), 'utf8')));
  } catch {
    /* no example seed */
  }
  return out;
}

function scanTracked(matchers: readonly Matcher[]): FileHit[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  const hits: FileHit[] = [];
  for (const f of files) {
    if (skipPath(f)) continue;
    const abs = path.join(root, f);
    try {
      if (statSync(abs).size > 8 << 20) continue;
      const text = readFileSync(abs, 'utf8');
      if (text.includes('\0')) continue; // binary
      const counts = scanText(text, matchers);
      if (total(counts)) hits.push({ path: f, counts });
    } catch {
      /* deleted in the working tree, unreadable */
    }
  }
  return hits;
}

/** Every line a commit added, per path, plus commit messages (as "(commit messages)"). */
async function scanHistory(matchers: readonly Matcher[]): Promise<{ hits: FileHit[]; commits: number; commitsWithHits: number }> {
  const child = spawn('git', ['log', '-p', '--all', '--no-color', '--no-ext-diff', '--format=%x00commit %H%n%B%x00end'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const byPath = new Map<string, { counts: Counts; commits: Set<string> }>();
  const hitCommits = new Set<string>();
  let commit = '';
  let commits = 0;
  let inMessage = false;
  let file: string | null = null;
  const record = (p: string, c: Counts) => {
    if (!total(c)) return;
    const e = byPath.get(p) ?? { counts: {}, commits: new Set<string>() };
    addCounts(e.counts, c);
    e.commits.add(commit);
    byPath.set(p, e);
    hitCommits.add(commit);
  };
  for await (const line of rl) {
    if (line.startsWith('\0commit ')) {
      commit = line.slice(8, 48);
      commits++;
      inMessage = true;
      file = null;
      continue;
    }
    if (inMessage) {
      if (line.startsWith('\0end')) inMessage = false;
      else record('(commit messages)', scanLine(line, matchers));
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '');
      file = p === '/dev/null' || skipPath(p) ? null : p;
      continue;
    }
    if (file && line.startsWith('+') && !line.startsWith('+++')) record(file, scanLine(line.slice(1), matchers));
  }
  await new Promise((r) => child.on('close', r));
  const hits = [...byPath].map(([p, e]) => ({ path: p, counts: e.counts, commits: e.commits.size }));
  return { hits, commits, commitsWithHits: hitCommits.size };
}

async function main(): Promise<number> {
  const { lists, note } = await namesFromDb();
  const matchers = buildMatchers(lists, placeholderNames());
  const tracked = scanTracked(matchers);
  const history = has('--no-history') ? null : await scanHistory(matchers);

  if (has('--json')) {
    console.log(JSON.stringify({ note, tracked, history }, null, 2));
    return tracked.length ? 2 : 0;
  }
  console.log(`scan:private · ${note}`);
  console.log('  "real ids" and names come from your database; "-shaped" ids match the pattern only (fixture placeholders land there too).');
  console.log(`\nTracked files at HEAD: ${tracked.length ? `${tracked.length} with hits` : 'clean'}`);
  for (const l of formatHits(tracked)) console.log(l);
  if (tracked.length) console.log(`  total: ${formatCounts(tracked.reduce((a, h) => addCounts(a, h.counts), {} as Counts))}`);
  if (history) {
    console.log(`\nGit history (${history.commits} commits, every branch): ${history.hits.length ? `${history.hits.length} path(s) with hits in ${history.commitsWithHits} commit(s)` : 'clean'}`);
    for (const l of formatHits(history.hits)) console.log(l);
  }
  console.log('');
  if (tracked.length) console.log('→ Move or placeholder the files above before pushing (private copies go to ~/Library/Application Support/control-center/private/).');
  if (history?.hits.length) console.log('→ History has hits: when you connect the remote, push a fresh-history snapshot (README ▸ Sharing the repo), not this history.');
  if (!tracked.length && !history?.hits.length) console.log('→ Nothing private found.');
  return tracked.length ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[scan:private] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
