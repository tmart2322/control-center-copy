import type { ExecFn } from '../ops/exec';

export type ReauthKind = 'slack' | 'org62' | 'vdp' | 'google' | 'devbar_signin' | 'devbar_restart';

/** Every handler returns this shape (the Health page renders `message`, and `status` picks the button state). */
export interface ReauthResult {
  kind: ReauthKind;
  status:
    | 'launched' // a terminal / process was started; the user finishes it, then the status check flips
    | 'refreshed' // finished without the user
    | 'needs_user' // cannot finish unattended (MFA, browser step); `message` has the instructions
    | 'needs_confirm' // called without confirm:true; nothing happened
    | 'unavailable' // prerequisite missing (script, devbar, python)
    | 'failed';
  message: string;
  /** The exact command a human can run themselves (fallback text on the Health page). Never contains secrets. */
  command?: string;
}

export interface ReauthStatus {
  kind: ReauthKind;
  state: 'ok' | 'auth_needed' | 'offline' | 'unknown';
  message: string;
}

export interface ReauthDeps {
  exec: ExecFn;
  /** Open Terminal.app and type+run a command. Tests inject a recorder; the real one is `openInTerminal`. */
  openTerminal: (command: string) => Promise<{ ok: boolean }>;
  /** Start a long-running helper (browser-polling devbar commands) without waiting for it. */
  spawnDetached: (cmd: string, args: string[]) => { ok: boolean };
  now: () => number;
  home: string;
  /** Path to ~/.claude.json (VDP cookie lives there). */
  claudeJson: string;
  /** Does this file exist? (default: the real file system; tests inject one) */
  exists?: (path: string) => boolean;
}

export interface ReauthHandler {
  kind: ReauthKind;
  /** Read-only. Never triggers auth. */
  status(): Promise<ReauthStatus>;
  /** The command a human would run (no side effects). */
  describe(): { command: string; instructions: string };
  /** Performs the action. Must be called with confirm:true or it does nothing. */
  act(opts: { confirm: boolean; /** VDP only: run without --no-window (opens Chromium for MFA) in Terminal. */ window?: boolean }): Promise<ReauthResult>;
}
