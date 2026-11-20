/**
 * The Sources step (B-079): every connector's sign-in state with the exact command to fix it.
 *
 * Read-only. It calls only the re-auth handlers' `status()` and `describe()` (src/reauth/**): never `act()`, never a
 * login, never a credential. `claude mcp list` (Slack, Org62) takes 10–40 s, so one probe runs at a time, both
 * handlers share its output, and the result is kept for 2 minutes ("Check again" refreshes it).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Connector, OnboardingSource, OnboardingSourceId, OnboardingSourcesPayload, OnboardingSourceState } from '@/contract';
import type { ExecFn } from '@/ops/exec';
import { allHandlers, realDeps, type ReauthDeps, type ReauthStatus } from '@/reauth';

interface SourceMeta {
  label: string;
  reads: string;
  via: OnboardingSourceId | null;
}

export const SOURCE_META: Record<OnboardingSourceId, SourceMeta> = {
  slack: { label: 'Slack', reads: 'Your DMs, mentions, your own messages and the channels you watch.', via: null },
  org62: { label: 'Org62', reads: 'Your opportunity teams, events and DC requests.', via: null },
  google: { label: 'Google, through devbar', reads: 'Gmail, Calendar and the Drive docs you track.', via: null },
  vdp: { label: 'VDP', reads: 'Your VDP records, so updates can be drafted for you.', via: null },
  claude: { label: 'Claude sessions', reads: 'Your Claude Code sessions on this Mac (~/.claude).', via: null },
  gemini: { label: 'Gemini notes', reads: 'Meeting notes and next steps from Google Meet.', via: 'google' },
  trainings: { label: 'Trainings', reads: 'Training and certification notices in Gmail, Calendar and Slack.', via: 'google' },
};
export const SOURCE_ORDER: OnboardingSourceId[] = ['slack', 'org62', 'google', 'vdp', 'claude', 'gemini', 'trainings'];

export interface SourceProbeDeps {
  reauth: ReauthDeps;
  /** ~/.claude/projects: the Claude sessions scanner reads transcripts from here. */
  claudeProjectsDir: string;
  exists: (path: string) => boolean;
}

export function defaultProbeDeps(): SourceProbeDeps {
  return { reauth: realDeps(), claudeProjectsDir: join(homedir(), '.claude', 'projects'), exists: existsSync };
}

/** Identical commands share one run (Slack and Org62 both read `claude mcp list`; devbar status is read twice). */
export function sharedExec(exec: ExecFn): ExecFn {
  const runs = new Map<string, ReturnType<ExecFn>>();
  return (cmd, args, opts) => {
    const key = JSON.stringify([cmd, args]);
    let p = runs.get(key);
    if (!p) {
      p = exec(cmd, args, opts);
      runs.set(key, p);
    }
    return p;
  };
}

async function safeStatus(fn: () => Promise<ReauthStatus>, kind: ReauthStatus['kind']): Promise<ReauthStatus> {
  try {
    return await fn();
  } catch {
    return { kind, state: 'unknown', message: 'The check did not finish.' };
  }
}

const row = (id: OnboardingSourceId, state: OnboardingSourceState, message: string, fix: { command: string; instructions: string } | null): OnboardingSource => ({
  id,
  ...SOURCE_META[id],
  state,
  message,
  command: state === 'ok' || !fix ? null : fix.command,
  instructions: state === 'ok' || !fix ? null : fix.instructions,
});

/** The rows that ride on Google: their state is Google's, their fix is Google's sign-in. */
function viaGoogle(google: OnboardingSource): OnboardingSource[] {
  const ok = google.state === 'ok';
  return [
    row('gemini', google.state, ok ? 'Rides on Google. Make sure notes are turned on in Google Meet.' : 'Needs Google first (above). Then turn notes on in Google Meet.', null),
    row('trainings', google.state, ok ? 'Rides on Google, and on Slack for notices posted there.' : 'Needs Google first (above).', null),
  ];
}

/** Probe this Mac: the real `status()` of each re-auth handler. Never throws. */
export async function probeSources(deps: SourceProbeDeps = defaultProbeDeps(), now: () => Date = () => new Date()): Promise<OnboardingSourcesPayload> {
  const h = allHandlers({ ...deps.reauth, exec: sharedExec(deps.reauth.exec) });
  const [slack, org62, google, vdp] = await Promise.all([
    safeStatus(() => h.slack.status(), 'slack'),
    safeStatus(() => h.org62.status(), 'org62'),
    safeStatus(() => h.google.status(), 'google'),
    safeStatus(() => h.vdp.status(), 'vdp'),
  ]);
  // devbar has three fixes; pick the one its status points at
  const googleFix =
    google.state === 'offline' && /not installed|not responding/i.test(google.message)
      ? { command: 'devbar auth login', instructions: 'Install devbar (internal), then run: devbar auth login, then devbar mcpgw connectors connect google-workspace-readonly.' }
      : google.state === 'offline'
        ? h.devbar_restart.describe()
        : /signed out/i.test(google.message)
          ? h.devbar_signin.describe()
          : h.google.describe();
  const googleRow = row('google', google.state, google.message, googleFix);
  const claudeOk = deps.exists(deps.claudeProjectsDir);
  return {
    checkedAt: now().toISOString(),
    simulated: false,
    sources: [
      row('slack', slack.state, slack.message, h.slack.describe()),
      row('org62', org62.state, org62.message, h.org62.describe()),
      googleRow,
      row('vdp', vdp.state, vdp.message, h.vdp.describe()),
      row('claude', claudeOk ? 'ok' : 'unknown', claudeOk ? 'Found your Claude Code sessions folder.' : 'No sessions folder yet. It appears after your first Claude Code session.', null),
      ...viaGoogle(googleRow),
    ],
  };
}

// ---------------------------------------------------------------------------
// One probe at a time, kept for 2 minutes
// ---------------------------------------------------------------------------

export const SOURCES_TTL_MS = 2 * 60_000;

export class SourceProbe {
  private last: { at: number; payload: OnboardingSourcesPayload } | null = null;
  private running: Promise<OnboardingSourcesPayload> | null = null;
  constructor(
    private readonly run: () => Promise<OnboardingSourcesPayload> = () => probeSources(),
    private readonly clock: () => number = Date.now,
  ) {}

  get(refresh = false): Promise<OnboardingSourcesPayload> {
    if (this.running) return this.running;
    if (!refresh && this.last && this.clock() - this.last.at < SOURCES_TTL_MS) return Promise.resolve(this.last.payload);
    this.running = this.run()
      .then((payload) => {
        this.last = { at: this.clock(), payload };
        return payload;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}

// ---------------------------------------------------------------------------
// Mock mode: the seed's connectors, with the real commands (describe() runs nothing)
// ---------------------------------------------------------------------------

function fromConnector(c: Connector | undefined): { state: OnboardingSourceState; message: string } {
  if (!c) return { state: 'unknown', message: 'Not seen yet.' };
  switch (c.state) {
    case 'ok':
    case 'catching_up':
    case 'degraded':
      return { state: 'ok', message: `${c.label} is connected (mock).` };
    case 'auth_needed':
      return { state: 'auth_needed', message: `${c.label} needs sign-in (mock).` };
    case 'error':
    case 'offline':
      return { state: 'offline', message: `${c.label} is not reachable (mock).` };
    default:
      return { state: 'unknown', message: `${c.label} is paused (mock).` };
  }
}

const rowOf = (id: OnboardingSourceId, s: { state: OnboardingSourceState; message: string }, fix: { command: string; instructions: string } | null) => row(id, s.state, s.message, fix);

const RANK: Record<OnboardingSourceState, number> = { ok: 0, unknown: 1, offline: 2, auth_needed: 3 };

export function simulatedSources(connectors: Connector[], now: Date, home = homedir()): OnboardingSourcesPayload {
  const noExec: ExecFn = async () => ({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: 'mock' });
  const h = allHandlers({ ...realDeps(), exec: noExec, home, claudeJson: join(home, '.claude.json') });
  const by = new Map(connectors.map((c) => [c.id, c]));
  const google = ['gmail', 'calendar', 'drive'].map((id) => fromConnector(by.get(id))).sort((a, b) => RANK[b.state] - RANK[a.state])[0]!;
  const googleRow = row('google', google.state, google.state === 'ok' ? 'Gmail, Calendar and Drive are connected (mock).' : google.message, h.google.describe());
  const claude = fromConnector(by.get('claude'));
  return {
    checkedAt: now.toISOString(),
    simulated: true,
    sources: [
      rowOf('slack', fromConnector(by.get('slack')), h.slack.describe()),
      rowOf('org62', fromConnector(by.get('org62')), h.org62.describe()),
      googleRow,
      rowOf('vdp', fromConnector(by.get('vdp')), h.vdp.describe()),
      rowOf('claude', claude, null),
      ...viaGoogle(googleRow),
    ],
  };
}
