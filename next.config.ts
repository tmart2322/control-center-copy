import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/** The build's version, short git sha and build time (D-57), embedded for GET /version and the sidebar footer. */
function buildMeta(): { version: string; sha: string; builtAt: string } {
  let version = '0.0.0';
  try {
    version = (JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? version;
  } catch {
    /* keep 0.0.0 */
  }
  let sha = '';
  try {
    sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch {
    /* not a git checkout */
  }
  return { version, sha, builtAt: new Date().toISOString() };
}

const meta = buildMeta();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev "N" badge covers the utility bar's Capture item.
  devIndicators: false,
  // Server-only packages that must not be bundled (native deps, child processes).
  serverExternalPackages: ['pg', 'pino', '@anthropic-ai/claude-agent-sdk', '@modelcontextprotocol/sdk'],
  env: {
    CC_APP_VERSION: meta.version,
    CC_GIT_SHA: meta.sha,
    CC_BUILT_AT: meta.builtAt,
    // the same, under the names the feedback lane's browser code reads (src/components/feedback/context.ts)
    NEXT_PUBLIC_CC_VERSION: meta.version,
    NEXT_PUBLIC_CC_GIT_SHA: meta.sha,
  },
};

export default nextConfig;
