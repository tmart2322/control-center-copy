/**
 * "Catching up: Slack 60%" (UI-SPEC §10) across processes. The scanner knows how far each connector's catch-up plan
 * got (`ScannerRuntime.catchUpProgress()`, the worker's memory: a first scan, or the backlog after a sleep); the web
 * serves Health, the sidebar pulse and Today's "Catching up" line. The worker's heartbeat writes the progress to
 * `<CC_STATE_DIR>/catch-up.json` every 15 s, and the web's connector read (store/health.ts `loadConnectors`) lays it
 * over each connector: a healthy connector with a plan under way reads `catching_up` with its `catchUpPct`.
 *
 * Only `ok` connectors change (a failing or signed-out one keeps its state: that is the thing to fix), and only while
 * the file is fresh (a stopped worker catches nothing up). Scanner rows are named by their connector id
 * (DbScannerStore registers them that way); a seeded row with another name is left alone. Tests never read the real
 * state folder: under vitest the file is read only when CC_STATE_DIR is set.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Connector } from '@/contract';
import { stateDir } from '@/ops/paths';

export interface CatchUpFile {
  v: 1;
  at: string;
  /** Scanner connector id → covered percent of its catch-up plan (0–100). Only connectors catching up are listed. */
  connectors: Record<string, number>;
}

/** Older than this, the worker is gone (it writes every 15 s): nothing is catching up. */
export const CATCH_UP_FRESH_MS = 2 * 60_000;

export const catchUpPath = (env: Record<string, string | undefined> = process.env) => join(stateDir(env), 'catch-up.json');

/** The worker's heartbeat: write what `catchUpProgress()` returned. Never throws (a failed write only goes stale). */
export function writeCatchUpFile(progress: Partial<Record<string, number>>, now: Date = new Date(), file = catchUpPath()): void {
  const connectors: Record<string, number> = {};
  for (const [k, v] of Object.entries(progress)) if (typeof v === 'number' && Number.isFinite(v)) connectors[k] = Math.max(0, Math.min(100, Math.round(v)));
  const body: CatchUpFile = { v: 1, at: now.toISOString(), connectors };
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    /* disk full / permissions: the web just shows no catch-up */
  }
}

/**
 * Live pass (docs/UX.md "Live updates"): the progress as a string that changes per 5 % step and when a connector starts
 * or finishes catching up. The worker publishes a `health` event when it changes, so the views follow without a poll.
 */
export function catchUpSignature(progress: Partial<Record<string, number>>): string {
  return Object.entries(progress)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([k, v]) => `${k}:${Math.floor(Math.max(0, Math.min(100, v as number)) / 5)}`)
    .sort()
    .join(',');
}

export function readCatchUpFile(env: Record<string, string | undefined> = process.env): CatchUpFile | null {
  if (env.VITEST && !env.CC_STATE_DIR) return null;
  try {
    const f = JSON.parse(readFileSync(catchUpPath(env), 'utf8')) as Partial<CatchUpFile>;
    return f?.v === 1 && typeof f.at === 'string' && f.connectors && typeof f.connectors === 'object' ? (f as CatchUpFile) : null;
  } catch {
    return null;
  }
}

/** `connectors.kind` → the scanner's connector id, where they differ (a row named by label falls back to its kind). */
const KIND_TO_CONNECTOR: Record<string, string> = { claude: 'claude_sessions' };

/**
 * Pure: the connectors with the catch-up laid over. `names[i]` is row i's scanner connector id (its `connectors.name`)
 * and, as a fallback, its kind. A plan at 100% is done (the scanner releases it on its next tick), so it reads `ok`.
 */
export function applyCatchUp(list: Connector[], names: ReadonlyArray<string | readonly [string, string]>, file: CatchUpFile | null, now: Date): Connector[] {
  if (!file || !(now.getTime() - Date.parse(file.at) <= CATCH_UP_FRESH_MS)) return list;
  return list.map((c, i) => {
    const n = names[i];
    const [name, kind] = typeof n === 'string' ? [n, ''] : (n ?? ['', '']);
    const pct = file.connectors[name] ?? file.connectors[KIND_TO_CONNECTOR[kind] ?? kind];
    if (pct === undefined || pct >= 100) return c;
    if (c.state === 'ok') return { ...c, state: 'catching_up', catchUpPct: pct };
    if (c.state === 'catching_up') return { ...c, catchUpPct: pct };
    return c;
  });
}
