/**
 * Scanner process settings: pinned CLI, fixed cwd, clean env. The env logic lives in `claude-env.ts`
 * (shared with NBA/chat); `cleanEnv` is kept as the scanner-allowlist alias.
 */
import os from 'node:os';
import path from 'node:path';
import { scannerEnv } from './claude-env';

/** Allowlist env without gateway vars (tests / callers that add their own). */
export function cleanEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return scannerEnv({}, source, extra);
}

/** Pinned CLI (brief 09 §3.9: two binaries with different versions exist). Override with CC_CLAUDE_BIN. */
export function defaultClaudeExecutable(source: NodeJS.ProcessEnv = process.env): string {
  return source.CC_CLAUDE_BIN ?? path.join(os.homedir(), '.local/bin/claude');
}

/** Fixed scanner cwd so the Claude-sessions source can filter scanner runs trivially (brief 09 §3.8). */
export function defaultScannerCwd(source: NodeJS.ProcessEnv = process.env): string {
  return source.CC_SCANNER_CWD ?? path.join(os.homedir(), 'Library/Application Support/control-center/scanner-cwd');
}
