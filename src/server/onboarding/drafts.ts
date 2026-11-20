/**
 * Where an unfinished onboarding waits between steps (B-079), so a reload resumes it.
 *
 * Before the last step there is no user row to hang it on (a fresh database), so db mode keeps the draft in the
 * state folder: `<CC_STATE_DIR>/onboarding.json` (0600, folder 0700; outside the repo, CLAUDE.md invariant 6),
 * tagged with the database it belongs to. Finishing deletes it: from then on the database holds the truth
 * (`user_settings` key `onboarding`). Mock mode keeps it in memory.
 */
import fs from 'node:fs';
import path from 'node:path';

import { OnboardingDraft, OnboardingStep, type FirstScanRequest } from '@/contract';
import { stateDir } from '@/ops/paths';

export interface StoredOnboarding {
  version: 1;
  /** The database this draft belongs to (another database's draft is ignored). */
  database: string;
  step: OnboardingStep;
  reached: OnboardingStep;
  draft: OnboardingDraft;
  updatedAt: string;
  /** Mock only: finished (db mode records completion in the database). */
  completedAt?: string;
  firstScan?: FirstScanRequest;
}

export interface DraftStore {
  load(): StoredOnboarding | null;
  save(s: StoredOnboarding): void;
  clear(): void;
}

/** A stored draft, or null when it is missing, unreadable or for another database. */
export function parseStored(raw: unknown, database: string): StoredOnboarding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || r.database !== database) return null;
  const step = OnboardingStep.safeParse(r.step);
  const reached = OnboardingStep.safeParse(r.reached);
  const draft = OnboardingDraft.safeParse(r.draft ?? {});
  if (!step.success || !reached.success || !draft.success || typeof r.updatedAt !== 'string') return null;
  return { version: 1, database, step: step.data, reached: reached.data, draft: draft.data, updatedAt: r.updatedAt };
}

export const draftPath = (env: Record<string, string | undefined> = process.env) => path.join(stateDir(env), 'onboarding.json');

export class FileDraftStore implements DraftStore {
  constructor(
    readonly database: string,
    readonly file = draftPath(),
  ) {}
  load(): StoredOnboarding | null {
    try {
      return parseStored(JSON.parse(fs.readFileSync(this.file, 'utf8')), this.database);
    } catch {
      return null;
    }
  }
  save(s: StoredOnboarding): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  clear(): void {
    try {
      const cur = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { database?: unknown };
      if (cur.database !== this.database) return; // another database's draft stays
    } catch {
      /* missing or unreadable: remove it below */
    }
    fs.rmSync(this.file, { force: true });
  }
}

export class MemoryDraftStore implements DraftStore {
  private s: StoredOnboarding | null = null;
  load() {
    return this.s ? structuredClone(this.s) : null;
  }
  save(s: StoredOnboarding) {
    this.s = structuredClone(s);
  }
  clear() {
    this.s = null;
  }
}
