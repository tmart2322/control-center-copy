/** Small, never-throwing subprocess helper. Injectable so tests can fake every command. */
import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the binary could not be started (ENOENT etc.). */
  spawnError?: string;
}
export type ExecFn = (cmd: string, args: string[], opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }) => Promise<ExecResult>;

export const run: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 15_000, env: opts.env ?? process.env, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        if (!e) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false });
        const spawnFailed = typeof e.code === 'string';
        resolve({
          code: typeof e.code === 'number' ? e.code : null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: Boolean(e.killed),
          spawnError: spawnFailed ? String(e.code) : undefined,
        });
      },
    );
    child.stdin?.end(); // some CLIs (devbar mcpgw) wait on an open stdin pipe
  });
