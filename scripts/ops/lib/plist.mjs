// Renders ops/launchd/*.plist.tmpl. Pure functions so tests can check output without touching launchd.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { brewPrefix, pg17BinFor } from './brew.mjs';

export const WEB_LABEL = 'com.controlcenter.web';
export const WORKER_LABEL = 'com.controlcenter.worker';

export const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderTemplate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`plist template placeholder {{${key}}} has no value`);
    return vars[key];
  });
}

const arrayXml = (items) => items.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');

/** `prefix` is the Homebrew prefix (Apple Silicon or Intel); defaults to this machine's. */
export function defaultPath({ home, nodeDir, prefix = brewPrefix() }) {
  return [nodeDir, join(prefix, 'bin'), pg17BinFor(prefix), `${home}/.local/bin`, `${home}/.devbar/bin`, '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    .filter(Boolean)
    .filter((p, i, a) => a.indexOf(p) === i)
    .join(':');
}

/**
 * Substitution map for one agent. `repo` is the absolute checkout path resolved at install time.
 * Values are XML-escaped; ProgramArguments are pre-rendered as <string> lines.
 */
export function buildVars({ kind, repo, home, node, npm, logDir, stateDir, envFile, port = 4327 }) {
  const wrapper = join(repo, 'scripts', 'ops', 'run-service.mjs');
  const cmd = kind === 'web' ? [join(repo, 'node_modules', '.bin', 'next'), 'start', '-p', String(port)] : [npm, 'run', 'worker:start'];
  const programArgs = [node, wrapper, '--name', kind, '--env-file', envFile, '--log-dir', logDir, '--', ...cmd];
  const raw = {
    LABEL: kind === 'web' ? WEB_LABEL : WORKER_LABEL,
    REPO: repo,
    HOME: home,
    PATH: defaultPath({ home, nodeDir: node.replace(/\/[^/]+$/, '') }),
    PORT: String(port),
    LOG_DIR: logDir,
    STATE_DIR: stateDir,
    ENV_FILE: envFile,
  };
  const vars = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, xmlEscape(v)]));
  vars.PROGRAM_ARGS = arrayXml(programArgs);
  return vars;
}

export function renderAgent({ kind, templateDir, ...rest }) {
  const file = join(templateDir, `${kind === 'web' ? WEB_LABEL : WORKER_LABEL}.plist.tmpl`);
  return renderTemplate(readFileSync(file, 'utf8'), buildVars({ kind, ...rest }));
}
