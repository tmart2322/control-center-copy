// `npm run update`, step by step (D-57; audit 2026-11-13, lane E: E1). Pure orchestration over injected deps, so the
// order and every failure path are tested without git, npm, launchd or a database (tests/ops/update.test.ts).
//
//   1. what runs now (the running app's version, else package.json) and what the remote has (git fetch, read-only);
//      installed agents that run another checkout stop it here (it would migrate the database they share)
//   2. a MAJOR jump prints its changelog sections and asks before anything changes (--yes answers for you)
//   3. fast-forward to the remote
//   4. stop both LaunchAgents (web, worker) that are running: nothing runs on half-updated code or schema
//   5. npm install
//   6. keep a copy of the current build (.next), then npm run build
//   7. back up the database (scripts/ops/lib/backup.mjs, also into the copy folder when one is set)
//   8. npm run db:migrate (one transaction: a failed migration leaves the database as it was)
//   9. start the agents that were running, then print old → new and the changelog in between
// A failure at 5–8 stops there: the database is not migrated (or rolled back), the copied build is put back, and the
// agents start again, so the app keeps running the version it ran. A failed build never touches the schema.

export const majorOf = (v) => Number(String(v ?? '').replace(/^v/, '').split('.')[0]) || 0;

/** The command in a step's failure message, in the words the user reads. */
const FAILED = {
  fetch: 'Nothing changed.',
  merge: 'Nothing changed: the code here is as it was.',
  elsewhere: 'Nothing changed.',
  install: 'The database was not migrated, and the app runs the build it ran before.',
  build: 'The database was not migrated, and the previous build is back in place.',
  backup: 'The database was not migrated (no backup, no migration), and the previous build is back in place.',
  migrate: 'The migration ran in one transaction, so the database is as it was. The previous build is back in place.',
};

/**
 * deps:
 *   say(msg)                              one progress line
 *   version()                             package.json version on disk
 *   runningVersion()                      Promise<string|null>: the running app's version (GET /api/v1/version)
 *   git: { sha(), hasUpstream(), fetch(), incoming(), upstreamFile(path), mergeFfOnly() }   (fetch / merge → boolean)
 *   changelog(text, fromV, toV)           the sections in between (scripts/lib/release.mjs sectionsBetween)
 *   readLocal(path)                       a file of this checkout, or null
 *   confirm(question)                     Promise<boolean>
 *   agents: { running(), stop(label), start(label), elsewhere() }   (running → labels loaded now; stop / start →
 *                                         boolean; elsewhere → the checkouts installed agents run, when not this one)
 *   install() / build() / migrate()       Promise<boolean>
 *   snapshot()                            copy the current build; returns a handle or null (no build yet)
 *   restore(handle) / drop(handle)        put the copy back / remove it
 *   backup()                              Promise<{ name, bytes, copied }>; throws on failure
 * opts: { pull = true, restart = true, backup = true, yes = false, dry = false }
 * Returns { status: 'updated' | 'up_to_date' | 'declined' | 'failed', failedAt?, fromV, toV, notes }.
 */
export async function runUpdate(deps, opts = {}) {
  const o = { pull: true, restart: true, backup: true, yes: false, dry: false, ...opts };
  const say = deps.say;
  const fromV = (await deps.runningVersion().catch(() => null)) ?? deps.version();
  const fromSha = deps.git.sha();
  say(`current: v${fromV}${fromSha ? ` · ${fromSha}` : ''}`);

  let notes = [];
  let toV = deps.version();
  // the installed agents run another checkout (a lane worktree, a second clone): updating here would migrate the
  // database they share and restart them on code this run never built
  const elsewhere = deps.agents.elsewhere?.() ?? [];
  if (elsewhere.length) {
    say(`the LaunchAgents run ${elsewhere.join(', ')}, not this checkout: run npm run update there`);
    return fail('elsewhere');
  }

  // 1. what the remote has, without touching the working tree
  let incoming = 0;
  let changelogText = deps.readLocal('CHANGELOG.md');
  if (!o.pull) say('pull skipped (--no-pull): updating to the code already here');
  else if (!deps.git.hasUpstream()) say('no remote branch to pull from yet; using the code already here');
  else if (o.dry) say('would fetch and fast-forward to the remote (--dry)');
  else {
    if (!(await deps.git.fetch())) return fail('fetch');
    incoming = deps.git.incoming();
    if (incoming) {
      toV = versionOf(deps.git.upstreamFile('package.json')) ?? toV;
      changelogText = deps.git.upstreamFile('CHANGELOG.md') ?? changelogText;
    }
  }
  notes = changelogText && toV !== fromV ? deps.changelog(changelogText, fromV, toV) : [];

  // 2. a major version needs a step from you: read it first, then say yes
  if (majorOf(toV) > majorOf(fromV)) {
    say(`v${toV} is a MAJOR update (from v${fromV}). It needs a step from you, named in its changelog:`);
    if (notes.length) say(`\n${notes.join('\n\n')}\n`);
    const go = o.yes || (!o.dry && (await deps.confirm(`Update to v${toV} and migrate the database now?`)));
    if (!go) {
      say(o.dry ? 'a major update asks before it changes anything (--dry: stopping here)' : 'Not updated. Nothing changed. Run npm run update again when you are ready (or with --yes).');
      return { status: 'declined', fromV, toV, notes };
    }
  }

  if (o.dry) {
    for (const s of ['stop the running LaunchAgents', 'npm install', 'npm run build (the current build is kept until it succeeds)', 'back up the database', 'npm run db:migrate', 'start the agents again']) say(`would: ${s}`);
    return { status: 'up_to_date', fromV, toV, notes };
  }

  // 3. fast-forward
  if (incoming) {
    say(`pull: ${incoming} new commit${incoming === 1 ? '' : 's'}`);
    if (!(await deps.git.mergeFfOnly())) return fail('merge');
  }

  // 4. stop what runs, so nothing serves or claims jobs on half-updated code or schema
  const stopped = [];
  if (!o.restart) say('agents left running (--no-restart): the migration runs under them; restart them yourself after');
  else {
    const running = deps.agents.running();
    if (!running.length) say('no LaunchAgent is running (npm run ops:install installs them); stop any app you run by hand first');
    for (const label of running) {
      say(`stop ${label}`);
      if (await deps.agents.stop(label)) stopped.push(label);
      else say(`couldn't stop ${label}; continuing`);
    }
  }
  const startAgain = async () => {
    for (const label of stopped) {
      say(`start ${label}`);
      if (!(await deps.agents.start(label))) say(`couldn't start ${label}; run: npm run ops:install`);
    }
  };

  // 5–8. any failure stops here, puts the build back and starts the app again: it keeps running what it ran
  let snap = null;
  const undo = async (step) => {
    if (snap) {
      say('putting the previous build back');
      await deps.restore(snap);
      snap = null;
    }
    await startAgain();
    return fail(step);
  };
  say('install: npm install');
  if (!(await deps.install())) return undo('install');
  snap = await deps.snapshot();
  say('build: npm run build');
  if (!(await deps.build())) return undo('build');
  if (o.backup) {
    say('backup: the database, before migrating');
    try {
      const b = await deps.backup();
      say(`backup written: ${b.name} (${Math.round(b.bytes / 1024)} KB)${b.copied ? `, copied to ${b.copied}` : ''}`);
    } catch (e) {
      say(`backup failed: ${String(e?.message ?? e).split('\n')[0]}`);
      return undo('backup');
    }
  } else say('backup skipped (--no-backup)');
  say('migrate: npm run db:migrate');
  if (!(await deps.migrate())) return undo('migrate');
  if (snap) await deps.drop(snap);
  snap = null;

  // 9. start again
  await startAgain();
  const toSha = deps.git.sha();
  const same = toV === fromV && toSha === fromSha;
  say(`v${fromV}${fromSha ? ` · ${fromSha}` : ''} → v${toV}${toSha ? ` · ${toSha}` : ''}${same ? ' (already up to date)' : ''}`);
  if (notes.length && majorOf(toV) <= majorOf(fromV)) say(`\n${notes.join('\n\n')}\n`);
  return { status: same ? 'up_to_date' : 'updated', fromV, toV, notes, restarted: stopped };

  function fail(step) {
    if (step === 'elsewhere') {
      say(FAILED.elsewhere);
      return { status: 'failed', failedAt: step, fromV, toV, notes };
    }
    say(`${step} failed. ${FAILED[step]} Fix it and run npm run update again.${fromSha && step !== 'fetch' && step !== 'merge' ? ` To go back to the version you had: git reset --keep ${fromSha} && npm install && npm run build` : ''}`);
    return { status: 'failed', failedAt: step, fromV, toV, notes };
  }
}

function versionOf(pkgText) {
  try {
    return JSON.parse(pkgText ?? '').version ?? null;
  } catch {
    return null;
  }
}
