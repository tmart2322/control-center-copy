/**
 * `npm run doctor [-- --json] [--skip id,id] [--only id,id]`
 *
 * Read-only health and prerequisite check (R-UI-12, D-42). Prints a check mark or cross with a fix hint
 * for each item. `--json` emits the same data for the Health page. Never prints secrets: the VDP PAT and
 * cookie are only tested for presence/expiry, env-file values are never echoed, and `claude mcp list`
 * output is reduced to server names and a state.
 */
import { accessSync, constants as fsConstants, existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileMode, readEnvFile } from './envfile';
import { run, type ExecFn } from './exec';
import { classifyHeartbeat, readHeartbeat } from './heartbeat';
import { PersonaSettings } from '../contract/persona';
import { DEFAULT_VDP_REFRESH_SCRIPT } from '../contract/settings';
import { compareSchema, describeSchema, readJournal, type JournalEntry } from '../db/migration-state';
import { featureActive, personaOf } from '../personas';
import { findServer, listMcp, ORG62_SERVER, readVdpInfo, SLACK_SERVER, type McpServerStatus } from './mcp';
import { APP_PORT, backupsDir, DB_NAME, envFilePath, heartbeatPath, PG17_BIN, plistPath, stateDir, WEB_LABEL, WORKER_LABEL } from './paths';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Shown when status is not ok. */
  fix?: string;
  data?: Record<string, unknown>;
}

export interface DoctorContext {
  env: Record<string, string | undefined>;
  repoRoot: string;
  exec: ExecFn;
  now: () => number;
  /** Probe a TCP port on localhost. Injectable for tests. */
  portOpen: (port: number) => Promise<boolean>;
  /** Run `fn` against a Postgres database, or null when `pg` is unavailable / connection refused. Read-only use only. */
  withDb: <T>(database: string, fn: (q: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>) => Promise<T>) => Promise<T | null>;
  fetchStatus: (url: string) => Promise<number | null>;
  freeBytes: (path: string) => number | null;
  uid: number;
  claudeBin: string;
  /** The app database: DATABASE_URL's database (env or env file) when set, else control_center. */
  appDb?: string;
}

const appDb = (c: Pick<DoctorContext, 'appDb'>) => c.appDb ?? DB_NAME;

const ok = (id: string, label: string, detail: string, data?: CheckResult['data']): CheckResult => ({ id, label, status: 'ok', detail, data });
const bad = (status: 'warn' | 'fail' | 'skip', id: string, label: string, detail: string, fix?: string, data?: CheckResult['data']): CheckResult => ({ id, label, status, detail, fix, data });

type Check = (c: DoctorContext) => Promise<CheckResult>;

// ---------------------------------------------------------------- individual checks

export const checkNode: Check = async () => {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 20
    ? ok('node', 'Node.js', `v${process.versions.node}`)
    : bad('fail', 'node', 'Node.js', `v${process.versions.node} (need 20+)`, 'brew install node');
};

export const checkPostgres: Check = async (c) => {
  const r = await c.exec(join(PG17_BIN, 'pg_isready'), ['-h', 'localhost', '-p', '5432'], { timeoutMs: 5000 });
  if (r.spawnError) return bad('fail', 'postgres', 'Postgres 17', 'PG17 binaries not found', 'brew install postgresql@17 && brew services start postgresql@17');
  return r.code === 0
    ? ok('postgres', 'Postgres 17', 'accepting connections on :5432')
    : bad('fail', 'postgres', 'Postgres 17', 'not accepting connections on :5432', 'brew services start postgresql@17');
};

export const checkDatabase: Check = async (c) => {
  const DB = appDb(c);
  const rows = await c.withDb('postgres', (q) => q('SELECT 1 AS x FROM pg_database WHERE datname = $1', [DB]));
  if (rows === null) return bad('skip', 'database', `Database ${DB}`, 'could not connect to Postgres', 'start Postgres first');
  return rows.length
    ? ok('database', `Database ${DB}`, 'exists')
    : bad('fail', 'database', `Database ${DB}`, 'missing', `${PG17_BIN}/createdb ${DB}  (or: npm run setup)`);
};

/**
 * The checkout's journal against what the database applied (src/db/migration-state.ts): behind, a migration drizzle
 * skipped, or nothing applied fails; a database newer than this checkout warns. The worker waits on any of them.
 */
export const checkMigrations: Check = async (c) => {
  const folder = join(c.repoRoot, 'src', 'db', 'migrations');
  if (!existsSync(join(folder, 'meta', '_journal.json'))) return bad('skip', 'migrations', 'Migrations', 'no migrations journal in this checkout (src/db/migrations/meta/_journal.json)');
  let journal: JournalEntry[];
  try {
    journal = readJournal(folder);
  } catch {
    return bad('warn', 'migrations', 'Migrations', 'could not read drizzle journal', 'git status; re-run npm run db:migrate');
  }
  const exists = await c.withDb(appDb(c), (q) => q(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`));
  if (exists === null) return bad('skip', 'migrations', 'Migrations', 'database not reachable');
  const rows = exists[0]?.ok ? await c.withDb(appDb(c), (q) => q('SELECT created_at::text AS at FROM drizzle.__drizzle_migrations')) : [];
  if (rows === null) return bad('skip', 'migrations', 'Migrations', 'database not reachable');
  const s = compareSchema(journal, rows.map((r) => Number(r.at)));
  const applied = journal.length - s.pending.length;
  const data = { state: s.state, applied, expected: journal.length, bundled: s.bundled, db: s.applied, ...(s.skipped.length ? { skipped: s.skipped } : {}), ...(s.unknown ? { unknown: s.unknown } : {}) };
  const d = describeSchema(s);
  if (s.state === 'match') return ok('migrations', 'Migrations', `${applied}/${journal.length} applied (${s.applied ?? 'none'})`, data);
  return bad(s.state === 'ahead' ? 'warn' : 'fail', 'migrations', 'Migrations', d.text, d.fix ?? undefined, data);
};

export const checkAssets: Check = async (c) => {
  const count = (d: string) => {
    try {
      return readdirSync(join(c.repoRoot, 'public', d)).filter((f) => !f.startsWith('.')).length;
    } catch {
      return 0;
    }
  };
  const fonts = count('fonts');
  const icons = count('icons');
  return fonts > 0 && icons > 0
    ? ok('assets', 'Fonts and icons', `${fonts} font files, ${icons} icons`)
    : bad('warn', 'assets', 'Fonts and icons', `fonts=${fonts}, icons=${icons}`, 'node scripts/sync-brand-assets.mjs  (or: npm run setup)');
};

export const checkClaude: Check = async (c) => {
  const r = await c.exec(c.claudeBin, ['--version'], { timeoutMs: 10_000 });
  if (r.code !== 0) return bad('fail', 'claude', 'claude CLI', 'not found', 'install Claude Code and make sure ~/.local/bin is on PATH');
  return ok('claude', 'claude CLI', r.stdout.trim().split('\n')[0] ?? 'present');
};

export const checkMcp: Check = async (c) => {
  const { ok: listed, servers } = await listMcp(c.exec, c.claudeBin);
  if (!listed) return bad('skip', 'mcp', 'MCP servers (Slack, Org62)', 'could not run "claude mcp list"', 'check the claude CLI');
  return summarizeMcp(servers);
};

export function summarizeMcp(servers: McpServerStatus[]): CheckResult {
  const want = [
    { name: SLACK_SERVER, label: 'Slack', login: `claude mcp login ${SLACK_SERVER}` },
    { name: ORG62_SERVER, label: 'Org62', login: `claude mcp login ${ORG62_SERVER}` },
  ];
  const parts: string[] = [];
  const fixes: string[] = [];
  let worst: CheckStatus = 'ok';
  for (const w of want) {
    const s = findServer(servers, w.name);
    if (!s) {
      parts.push(`${w.label}: not configured`);
      fixes.push(`add the ${w.name} MCP server in Claude Code, then ${w.login}`);
      worst = 'fail';
    } else if (s.state === 'connected') parts.push(`${w.label}: connected`);
    else if (s.state === 'needs_auth') {
      parts.push(`${w.label}: needs auth`);
      fixes.push(w.login);
      if (worst !== 'fail') worst = 'warn';
    } else {
      parts.push(`${w.label}: ${s.state}`);
      fixes.push(`${w.label}: check network, then retry`);
      if (worst !== 'fail') worst = 'warn';
    }
  }
  const data = { servers: Object.fromEntries(want.map((w) => [w.name, findServer(servers, w.name)?.state ?? 'missing'])) };
  return worst === 'ok'
    ? ok('mcp', 'MCP servers (Slack, Org62)', parts.join(', '), data)
    : bad(worst, 'mcp', 'MCP servers (Slack, Org62)', parts.join(', '), fixes.join('; '), data);
}

export const checkDevbar: Check = async (c) => {
  const auth = await c.exec('devbar', ['auth', 'status', '--json'], { timeoutMs: 10_000 });
  if (auth.spawnError) return bad('fail', 'devbar', 'devbar + Google bridge', 'devbar not installed', 'install devbar (see docs/ui/OPS.md, teammate setup)');
  let authed = false;
  try {
    authed = (JSON.parse(auth.stdout) as { authenticated?: boolean }).authenticated === true;
  } catch {
    /* treated as signed out */
  }
  if (!authed) return bad('fail', 'devbar', 'devbar + Google bridge', 'signed out', 'devbar auth login');
  const gw = await c.exec('devbar', ['mcpgw', 'status', '--json'], { timeoutMs: 10_000 });
  let status: { listener_ok?: boolean; upstream_ok?: boolean; port?: number } = {};
  try {
    status = JSON.parse(gw.stdout);
  } catch {
    /* handled below */
  }
  if (!status.listener_ok) return bad('fail', 'devbar', 'devbar + Google bridge', 'gateway listener is down', 'devbar daemon start');
  const port = status.port ?? 13316;
  const http = await c.fetchStatus(`http://localhost:${port}/proxy/mcp/server/google_workspace_readonly/mcp`);
  if (http === null || http >= 500) {
    return bad('warn', 'devbar', 'devbar + Google bridge', `google_workspace_readonly not answering on :${port}`, 'devbar mcpgw connectors connect google-workspace-readonly');
  }
  if (status.upstream_ok === false) return bad('warn', 'devbar', 'devbar + Google bridge', 'bridge up, upstream not ok', 'devbar mcpgw connectors connect google-workspace-readonly');
  return ok('devbar', 'devbar + Google bridge', `signed in; google_workspace_readonly reachable on :${port}`);
};

/**
 * D-55: whether the app's user has VDP active (Settings ▸ Role & rules), from the database the worker reads: the user
 * CC_USER_EMAIL names, else the first active user (the worker's rule). null when the database can't be read.
 */
export async function vdpActive(c: DoctorContext): Promise<boolean | null> {
  const email = c.env.CC_USER_EMAIL?.toLowerCase() || null;
  const rows = await c
    .withDb(appDb(c), (q) =>
      q(
        `select s.key, s.value from user_settings s
          where s.key in ('settings.persona', 'settings.profile')
            and s.owner_user_id = (select id from users where is_active and ($1::text is null or lower(email) = $1) order by created_at limit 1)`,
        [email],
      ),
    )
    .catch(() => null);
  if (!rows) return null;
  const by = new Map(rows.map((r) => [String(r.key), r.value]));
  const parsed = PersonaSettings.safeParse(by.get('settings.persona') ?? { version: 1 });
  return featureActive(personaOf({ persona: parsed.success ? parsed.data : null, profile: (by.get('settings.profile') ?? null) as { role?: string } | null }), 'vdp');
}

/** The cookie refresh script Health runs (Settings ▸ Sources), from the app database; the default when unset. */
export async function vdpRefreshScriptPath(c: DoctorContext): Promise<string> {
  const email = c.env.CC_USER_EMAIL?.toLowerCase() || null;
  const rows = await c
    .withDb(appDb(c), (q) =>
      q(
        `select s.value->>'vdpRefreshScript' as script from user_settings s
          where s.key = 'settings.scanning'
            and s.owner_user_id = (select id from users where is_active and ($1::text is null or lower(email) = $1) order by created_at limit 1)`,
        [email],
      ),
    )
    .catch(() => null);
  const script = typeof rows?.[0]?.script === 'string' && rows[0].script.trim() ? rows[0].script.trim() : DEFAULT_VDP_REFRESH_SCRIPT;
  return script.replace(/^~(?=\/)/, c.env.HOME ?? homedir());
}

/**
 * VDP is one persona feature (the SE's): a problem with it is a warning, and only while it is active. The Okta gateway
 * cookie lives one hour, so the refresh script has to be there too (lane E, E3: README ▸ VDP sign-in says where it
 * comes from).
 */
export const checkVdp: Check = async (c) => {
  if ((await vdpActive(c)) === false) return bad('skip', 'vdp', 'VDP access', "VDP is not in your role's preconfiguration (activate it in Settings ▸ Role & rules)");
  const v = readVdpInfo({ claudeJson: join(c.env.HOME ?? '', '.claude.json'), now: c.now });
  if (!v.configured) return bad('warn', 'vdp', 'VDP access', 'vdp-app-fir MCP entry missing', 'ask an admin for a VDP PAT, then add the vdp-app-fir MCP server (README ▸ VDP sign-in)');
  if (!v.hasPat) return bad('warn', 'vdp', 'VDP access', 'PAT missing', 'ask an admin for a VDP PAT (README ▸ VDP sign-in)');
  const script = await vdpRefreshScriptPath(c);
  const hasScript = existsSync(script);
  const shown = tilde(script, c.env.HOME);
  const refresh = hasScript ? `python3 ${shown}` : `get the refresh script (README ▸ VDP sign-in), save it as ${shown}, then python3 ${shown}`;
  const data = { pat: 'present', cookie_seconds_left: v.cookieSecondsLeft, refresh_script: hasScript ? 'present' : 'missing' };
  if (!v.hasCookie || v.cookieSecondsLeft === null) return bad('warn', 'vdp', 'VDP access', 'PAT present, gateway cookie missing', refresh, data);
  const mins = Math.round(v.cookieSecondsLeft / 60);
  if (v.cookieSecondsLeft <= 0) return bad('warn', 'vdp', 'VDP access', `PAT present, cookie expired ${Math.abs(mins)} min ago`, hasScript ? `${refresh}  (or the Health "Re-auth VDP" button)` : refresh, data);
  if (!hasScript) return bad('warn', 'vdp', 'VDP access', `PAT present, cookie valid for ${mins} min, but no refresh script at ${shown} (the cookie lasts 1 h)`, refresh, data);
  return ok('vdp', 'VDP access', `PAT present, cookie valid for ${mins} min`, data);
};

export const checkPorts: Check = (c) => checkSiblingApps(c);

/** Where the sibling repos and the port registry (PORTS.md) live: ~/Projects. A teammate may have neither. */
export const projectsDir = (env: DoctorContext['env']): string => join(env.HOME ?? homedir(), 'Projects');
const tilde = (p: string, home?: string): string => (home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);

export interface SiblingApp {
  name: string;
  port: number;
  /** Repo folder under the projects dir. */
  repo: string;
}
export const SIBLING_APPS: SiblingApp[] = [
  { name: 'talk-track', port: 4320, repo: 'talk-track' },
  { name: 'pulse-footprint', port: 4318, repo: 'greg-playground' },
];

export interface LocalDirOptions {
  /** Defaults to projectsDir(c.env). */
  projects?: string;
  exists?: (path: string) => boolean;
}

/**
 * The optional sibling apps. One that is neither checked out under the projects dir nor listening is not used on this
 * machine and is skipped, not warned about; with none in use the whole check is `skip`.
 */
export async function checkSiblingApps(c: DoctorContext, o: LocalDirOptions & { apps?: SiblingApp[] } = {}): Promise<CheckResult> {
  const projects = o.projects ?? projectsDir(c.env);
  const exists = o.exists ?? existsSync;
  const apps = o.apps ?? SIBLING_APPS;
  const label = `Sibling apps (${apps.map((a) => a.name).join(', ')})`;
  const states = await Promise.all(apps.map(async (a) => ({ ...a, here: exists(join(projects, a.repo)), open: await c.portOpen(a.port) })));
  const used = states.filter((s) => s.here || s.open);
  const absent = states.filter((s) => !s.here && !s.open).map((s) => s.name);
  const data = { ports: Object.fromEntries(states.map((s) => [s.name, s.open])), ...(absent.length ? { not_on_this_machine: absent } : {}) };
  if (!used.length) return bad('skip', 'ports', label, 'not used on this machine (optional integrations)', undefined, data);
  const detail = used.map((s) => `${s.name} :${s.port} ${s.open ? 'up' : 'down'}`).join(', ') + (absent.length ? `; ${absent.join(', ')} not on this machine` : '');
  if (used.every((s) => s.open)) return ok('ports', label, detail, data);
  const registry = join(projects, 'PORTS.md');
  const see = exists(registry) ? ` (see ${tilde(registry, c.env.HOME)})` : '';
  return bad('warn', 'ports', label, `${detail} (optional integrations)`, `start the app(s) from ${tilde(projects, c.env.HOME)}${see}`, data);
}

/**
 * The shared port registry (~/Projects/PORTS.md) should claim the app's port. Optional: without the file the check is
 * `skip` ("not used on this machine"), never a failure.
 */
export async function checkPortRegistry(c: DoctorContext, o: LocalDirOptions & { read?: (path: string) => string } = {}): Promise<CheckResult> {
  const label = 'Port registry (PORTS.md)';
  const file = join(o.projects ?? projectsDir(c.env), 'PORTS.md');
  const exists = o.exists ?? existsSync;
  const shown = tilde(file, c.env.HOME);
  if (!exists(file)) return bad('skip', 'port-registry', label, `not used on this machine (no ${shown})`);
  let text: string;
  try {
    text = (o.read ?? ((p) => readFileSync(p, 'utf8')))(file);
  } catch {
    return bad('warn', 'port-registry', label, `${shown} is unreadable`, `check the file's permissions`);
  }
  const listed = text.split('\n').some((line) => line.startsWith('|') && line.split('|')[1]?.trim() === String(APP_PORT));
  return listed
    ? ok('port-registry', label, `:${APP_PORT} registered in ${shown}`)
    : bad('warn', 'port-registry', label, `:${APP_PORT} is not listed in ${shown}`, `add a control-center row for :${APP_PORT} to ${shown}`);
}

export const checkDisk: Check = async (c) => {
  const free = c.freeBytes(stateDir(c.env));
  if (free === null) return bad('skip', 'disk', 'Disk space', 'could not read free space');
  const gb = free / 1024 ** 3;
  const detail = `${gb.toFixed(1)} GB free`;
  if (gb < 2) return bad('fail', 'disk', 'Disk space', detail, 'free up space (backups, logs, and Postgres need room)', { free_gb: gb });
  if (gb < 5) return bad('warn', 'disk', 'Disk space', detail, 'free up space soon', { free_gb: gb });
  return ok('disk', 'Disk space', detail, { free_gb: gb });
};

/** A backup older than this is a warning (the worker writes one a night; a Mac asleep for a weekend catches up). */
export const BACKUP_MAX_AGE_MS = 48 * 3600_000;
const BACKUP_FILE = /^[a-z_][a-z0-9_]{0,62}-\d{8}-\d{6}\.dump$/;

/** The newest `*.dump` of the app database in `dir` (the names scripts/ops/lib/backup.mjs writes), or null. */
export function newestBackup(dir: string, db: string): { name: string; mtimeMs: number } | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => BACKUP_FILE.test(f) && f.startsWith(`${db}-`)).sort();
  } catch {
    return null;
  }
  const name = names.at(-1);
  if (!name) return null;
  try {
    return { name, mtimeMs: statSync(join(dir, name)).mtimeMs };
  } catch {
    return null;
  }
}

/** Mirrors scripts/ops/lib/backup.mjs cloudSyncedReason: a copy folder a sync client uploads takes data off the Mac. */
export function cloudSynced(dir: string, home: string): string | null {
  const p = resolve(dir);
  const under = (rel: string) => p === join(home, rel) || p.startsWith(`${join(home, rel)}/`);
  if (under('Library/Mobile Documents')) return 'iCloud Drive';
  if (under('Library/CloudStorage')) return 'a cloud-synced folder';
  const top = p.startsWith(`${home}/`) ? (p.slice(home.length + 1).split('/')[0] ?? '') : '';
  if (/^OneDrive\b/.test(top)) return 'OneDrive';
  if (/^(Dropbox|Google Drive|Box|Box Sync|iCloud Drive)$/.test(top)) return top;
  return null;
}

/**
 * Lane E (E2): the newest backup is under 48 h old, and so is its copy when a copy folder is set
 * (CC_BACKUP_COPY_DIR, environment or env file). File names and ages only.
 */
export const checkBackups: Check = async (c) => {
  const label = 'Backups';
  const db = appDb(c);
  const home = c.env.HOME ?? homedir();
  const age = (ms: number) => (ms < 2 * 3600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 72 * 3600_000 ? `${Math.round(ms / 3600_000)} h` : `${Math.round(ms / 86_400_000)} days`);
  const last = newestBackup(backupsDir(c.env), db);
  const rawCopy = c.env.CC_BACKUP_COPY_DIR ?? readEnvFile(envFilePath(c.env))?.CC_BACKUP_COPY_DIR ?? '';
  const copyDir = rawCopy ? resolve(rawCopy.replace(/^~(?=\/|$)/, home)) : null;
  const data: Record<string, unknown> = { last: last?.name ?? null, age_h: last ? Math.round((c.now() - last.mtimeMs) / 360_000) / 10 : null, copy_dir: copyDir ? tilde(copyDir, home) : null };
  if (!last) return bad('warn', 'backups', label, 'no backup yet (the worker writes one each night)', 'npm run backup', data);
  const lastAge = c.now() - last.mtimeMs;
  const problems: string[] = [];
  const fixes: string[] = [];
  if (lastAge > BACKUP_MAX_AGE_MS) {
    problems.push(`the newest backup is ${age(lastAge)} old`);
    fixes.push('npm run backup (and check the worker is running: the nightly backup is its job)');
  }
  if (copyDir) {
    const cloud = cloudSynced(copyDir, home);
    const copy = cloud ? null : newestBackup(copyDir, db);
    data.copy_last = copy?.name ?? null;
    if (cloud) {
      problems.push(`the copy folder is ${cloud}, which would take your data off this Mac: nothing is copied there`);
      fixes.push('set CC_BACKUP_COPY_DIR in the env file to an external disk or another local folder');
    } else if (!copy) {
      problems.push(`no copy in ${tilde(copyDir, home)} yet`);
      fixes.push('plug in the disk, then npm run backup');
    } else if (c.now() - copy.mtimeMs > BACKUP_MAX_AGE_MS) {
      problems.push(`the newest copy in ${tilde(copyDir, home)} is ${age(c.now() - copy.mtimeMs)} old`);
      fixes.push('plug in the disk, then npm run backup');
    }
  }
  const detail = `newest ${age(lastAge)} old${copyDir ? `, copied to ${tilde(copyDir, home)}` : ' (no copy folder: CC_BACKUP_COPY_DIR)'}`;
  return problems.length ? bad('warn', 'backups', label, problems.join('; '), [...new Set(fixes)].join('; '), data) : ok('backups', label, detail, data);
};

export const checkState: Check = async (c) => {
  const dir = stateDir(c.env);
  if (!existsSync(dir)) return bad('fail', 'state', 'State directory', 'missing', 'npm run setup');
  const mode = fileMode(envFilePath(c.env));
  if (mode === null) return bad('warn', 'state', 'State directory', 'env file missing (the LaunchAgents read it)', 'npm run setup');
  if ((mode & 0o077) !== 0) return bad('warn', 'state', 'State directory', `env file mode is ${mode.toString(8)}, should be 600`, `chmod 600 "${envFilePath(c.env)}"`);
  return ok('state', 'State directory', 'present, env file mode 600');
};

export const checkAgents: Check = async (c) => {
  const labels = [WEB_LABEL, WORKER_LABEL];
  const installed = labels.map((l) => existsSync(plistPath(l, c.env)));
  const loaded: boolean[] = [];
  for (const l of labels) {
    const r = await c.exec('launchctl', ['print', `gui/${c.uid}/${l}`], { timeoutMs: 5000 });
    loaded.push(r.code === 0);
  }
  const data = { web: { installed: installed[0], loaded: loaded[0] }, worker: { installed: installed[1], loaded: loaded[1] } };
  const webUp = await c.portOpen(APP_PORT);
  if (installed.every(Boolean) && loaded.every(Boolean)) return ok('agents', 'LaunchAgents', `installed and loaded; web :${APP_PORT} ${webUp ? 'up' : 'down'}`, data);
  if (!installed.some(Boolean)) {
    return bad('warn', 'agents', 'LaunchAgents', 'not installed (the app only runs while a terminal is open)', 'npm run ops:install', data);
  }
  return bad('warn', 'agents', 'LaunchAgents', `partial: web installed=${installed[0]} loaded=${loaded[0]}, worker installed=${installed[1]} loaded=${loaded[1]}`, 'npm run ops:install', data);
};

/** ProgramArguments of a rendered LaunchAgent plist (XML-unescaped), or null when it has none. */
export function plistProgramArgs(xml: string): string[] | null {
  const arr = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1];
  if (arr === undefined) return null;
  const un = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return [...arr.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => un(m[1]!));
}

const executable = (p: string) => {
  try {
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Lane E (E5): the Node (and, for the worker, npm) baked into each installed LaunchAgent at install time still exists
 * and is 20+. A Node removed or replaced since (a Homebrew cleanup, an nvm version deleted) leaves the agent failing
 * to start with nothing in the app's own log.
 */
export const checkAgentNode: Check = async (c) => {
  const label = 'LaunchAgent Node path';
  const found: string[] = [];
  const problems: string[] = [];
  for (const l of [WEB_LABEL, WORKER_LABEL]) {
    const file = plistPath(l, c.env);
    if (!existsSync(file)) continue;
    const kind = l === WEB_LABEL ? 'web' : 'worker';
    let args: string[] | null = null;
    try {
      args = plistProgramArgs(readFileSync(file, 'utf8'));
    } catch {
      args = null;
    }
    const node = args?.[0];
    if (!node) {
      problems.push(`${kind}: no program in its plist`);
      continue;
    }
    if (!executable(node)) {
      problems.push(`${kind}: ${tilde(node, c.env.HOME)} is gone`);
      continue;
    }
    const v = await c.exec(node, ['--version'], { timeoutMs: 5000 });
    const major = Number(/^v?(\d+)/.exec(v.stdout.trim())?.[1] ?? 0);
    if (v.code !== 0 || major < 20) problems.push(`${kind}: ${tilde(node, c.env.HOME)} is ${v.code === 0 ? v.stdout.trim() : 'not runnable'} (need 20+)`);
    else found.push(`${kind} ${v.stdout.trim()}`);
    // the worker runs `npm run worker:start` through the npm it was installed with
    const sep = args!.indexOf('--');
    const npm = kind === 'worker' && sep >= 0 ? args![sep + 1] : undefined;
    if (npm && npm.startsWith('/') && !executable(npm)) problems.push(`worker: npm ${tilde(npm, c.env.HOME)} is gone`);
  }
  if (!found.length && !problems.length) return bad('skip', 'agent-node', label, 'no LaunchAgents installed');
  return problems.length
    ? bad('fail', 'agent-node', label, problems.join('; '), 'npm run ops:install  (writes both plists again with the Node on your PATH)', { found })
    : ok('agent-node', label, found.join(', '), { found });
};

export const checkHeartbeat: Check = async (c) => {
  const { hb, health } = readHeartbeat(heartbeatPath(c.env));
  if (!hb) {
    return health === 'invalid'
      ? bad('warn', 'heartbeat', 'Worker heartbeat', 'file is unreadable', 'restart the worker (launchctl kickstart -k gui/$UID/com.controlcenter.worker)')
      : bad('warn', 'heartbeat', 'Worker heartbeat', 'no heartbeat file: the worker has not run yet', 'npm run worker (or npm run ops:install)');
  }
  const { health: h, ageMs } = classifyHeartbeat(hb, c.now());
  const age = ageMs < 90_000 ? `${Math.round(ageMs / 1000)} s` : `${Math.round(ageMs / 60_000)} min`;
  const data = { state: hb.state, age_ms: ageMs, pid: hb.pid, seq: hb.seq, active_jobs: hb.active_jobs };
  if (hb.state === 'stopped') return bad('warn', 'heartbeat', 'Worker heartbeat', `worker stopped cleanly ${age} ago`, 'start it: npm run ops:install, or npm run worker', data);
  // lane E: alive, but claiming nothing until the database schema matches its build (the migrations check says how)
  if (hb.state === 'blocked' && h === 'fresh') return bad('fail', 'heartbeat', 'Worker heartbeat', `waiting: the database schema differs from the worker's build (beat ${age} ago); no jobs run`, 'npm run update (see the Migrations line)', data);
  if (h === 'fresh') return ok('heartbeat', 'Worker heartbeat', `${hb.state}, beat ${age} ago, pid ${hb.pid}`, data);
  if (h === 'stale') return bad('warn', 'heartbeat', 'Worker heartbeat', `stale: last beat ${age} ago (asleep, or busy)`, 'wait a minute; if it persists, restart the worker', data);
  return bad('fail', 'heartbeat', 'Worker heartbeat', `dead: last beat ${age} ago`, 'restart: launchctl kickstart -k gui/$UID/com.controlcenter.worker', data);
};

export const checkBudget: Check = async (c) => {
  const rows = await c.withDb(
    appDb(c),
    (q) =>
      q(
        `SELECT b.daily_limit_usd::float AS limit_usd, b.alert_at_pct, b.hard_stop, coalesce(d.spent_usd, 0)::float AS spent_usd
           FROM llm_budgets b JOIN users u ON u.id = b.owner_user_id
           LEFT JOIN llm_budget_days d ON d.budget_id = b.id AND d.day = (now() AT TIME ZONE u.timezone)::date
          WHERE b.scope = 'total' ORDER BY b.effective_from DESC LIMIT 1`,
      ),
  ).catch(() => null);
  if (rows === null || rows.length === 0) return bad('skip', 'budget', 'LLM budget (today)', 'no budget data yet (database or tables not ready)');
  const r = rows[0]!;
  const limit = Number(r.limit_usd);
  const spent = Number(r.spent_usd);
  const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  const data = { spent_usd: spent, limit_usd: limit, pct };
  const detail = `$${spent.toFixed(2)} of $${limit.toFixed(2)} (${pct}%)`;
  if (pct >= 100) return bad(r.hard_stop ? 'fail' : 'warn', 'budget', 'LLM budget (today)', `${detail}, cap reached${r.hard_stop ? ': scanning paused' : ''}`, 'raise the cap on Health, or wait for tomorrow', data);
  if (pct >= Number(r.alert_at_pct ?? 80)) return bad('warn', 'budget', 'LLM budget (today)', detail, 'watch spend on Health', data);
  return ok('budget', 'LLM budget (today)', detail, data);
};

export const ALL_CHECKS: Array<[string, Check]> = [
  ['node', checkNode],
  ['postgres', checkPostgres],
  ['database', checkDatabase],
  ['migrations', checkMigrations],
  ['assets', checkAssets],
  ['claude', checkClaude],
  ['mcp', checkMcp],
  ['devbar', checkDevbar],
  ['vdp', checkVdp],
  ['ports', checkPorts],
  ['port-registry', (c) => checkPortRegistry(c)],
  ['disk', checkDisk],
  ['state', checkState],
  ['agents', checkAgents],
  ['agent-node', checkAgentNode],
  ['heartbeat', checkHeartbeat],
  ['backups', checkBackups],
  ['budget', checkBudget],
];

// ---------------------------------------------------------------- runner

export interface DoctorReport {
  generated_at: string;
  ok: boolean;
  summary: Record<CheckStatus, number>;
  checks: CheckResult[];
}

export async function runDoctor(ctx: DoctorContext, opts: { skip?: string[]; only?: string[] } = {}): Promise<DoctorReport> {
  const selected = ALL_CHECKS.filter(([id]) => (!opts.only?.length || opts.only.includes(id)) && !opts.skip?.includes(id));
  // Run concurrently; the slow ones (claude mcp list, devbar) dominate.
  const checks = await Promise.all(
    selected.map(async ([id, fn]) => {
      try {
        return await fn(ctx);
      } catch (e) {
        return bad('warn', id, id, `check crashed (${e instanceof Error ? e.name : 'error'})`, 'report this as a bug');
      }
    }),
  );
  const summary: Record<CheckStatus, number> = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;
  return { generated_at: new Date(ctx.now()).toISOString(), ok: summary.fail === 0, summary, checks };
}

const MARK: Record<CheckStatus, string> = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

export function formatReport(r: DoctorReport): string {
  const lines = r.checks.map((c) => {
    const base = `${MARK[c.status]} ${c.label}: ${c.detail}`;
    return c.status !== 'ok' && c.fix ? `${base}\n    fix: ${c.fix}` : base;
  });
  const s = r.summary;
  lines.push('', `${s.ok} ok, ${s.warn} warnings, ${s.fail} failed, ${s.skip} skipped`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- real context + CLI

export async function realContext(): Promise<DoctorContext> {
  const env = process.env;
  const fileEnv = readEnvFile(envFilePath(env)) ?? {};
  const configured = env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  let configuredDb: string | undefined;
  try {
    configuredDb = configured ? decodeURIComponent(new URL(configured).pathname.replace(/^\//, '')) || undefined : undefined;
  } catch {
    configuredDb = undefined;
  }
  const dbUrl = (database: string) => {
    const base = configured ?? `postgresql://localhost:5432/${DB_NAME}`;
    try {
      const u = new URL(base);
      u.pathname = `/${database}`;
      return u.toString();
    } catch {
      return `postgresql://localhost:5432/${database}`;
    }
  };
  return {
    env,
    repoRoot: resolve(process.cwd()),
    exec: run,
    now: Date.now,
    claudeBin: 'claude',
    appDb: configuredDb,
    uid: process.getuid?.() ?? 501,
    portOpen: (port) =>
      new Promise((res) => {
        const s = net.connect({ port, host: '127.0.0.1' });
        s.setTimeout(1500);
        s.once('connect', () => (s.destroy(), res(true)));
        s.once('timeout', () => (s.destroy(), res(false)));
        s.once('error', () => res(false));
      }),
    fetchStatus: async (url) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
        await r.body?.cancel();
        return r.status;
      } catch {
        return null;
      }
    },
    freeBytes: (p) => {
      try {
        const s = statfsSync(p);
        return s.bavail * s.bsize;
      } catch {
        try {
          const s = statfsSync('/');
          return s.bavail * s.bsize;
        } catch {
          return null;
        }
      }
    },
    withDb: async (database, fn) => {
      let pg: typeof import('pg');
      try {
        pg = (await import('pg')).default as unknown as typeof import('pg');
      } catch {
        return null;
      }
      const client = new pg.Client({ connectionString: dbUrl(database), connectionTimeoutMillis: 4000 });
      try {
        await client.connect();
      } catch {
        return null;
      }
      try {
        await client.query('SET default_transaction_read_only = on');
        return await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows as Array<Record<string, unknown>>);
      } catch {
        return null;
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

function listArg(argv: string[], flag: string): string[] | undefined {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const report = await runDoctor(await realContext(), { skip: listArg(argv, '--skip'), only: listArg(argv, '--only') });
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && /doctor\.(ts|js|mjs)$/.test(process.argv[1])) {
  main().then((code) => process.exit(code));
}
