/**
 * Restricted single-server MCP config (brief 09 §5.10, SCANNER.md §7).
 *
 * Each traversal scanner loads ONLY its own MCP server, redeclared under the identical name, URL and
 * oauth block as `~/.claude.json` so the OAuth token from interactive `/mcp` is reused, plus the
 * in-process `cc` server. Every other tool on that server goes into `disallowedTools`, so its schema
 * never enters the prompt (the biggest cost lever). Secrets are never copied: only `type`, `url` and the
 * non-secret oauth `clientId` / `callbackPort` are carried; `headers` (cookies, PATs) are dropped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConnectorId } from '../scanner/types';
import { MCP_SERVER_NAME } from './errors';

export const mcpToolName = (server: string, tool: string) => `mcp__${server}__${tool}`;

/** Full tool list of the Slack server (32 tools, brief 09 §2). New upstream tools are denied by the runtime guard. */
export const SLACK_ALL_TOOLS = [
  'slack_add_list_comment', 'slack_add_list_record', 'slack_add_reaction', 'slack_complete_file_upload',
  'slack_create_canvas', 'slack_create_conversation', 'slack_create_list', 'slack_get_file_upload_url',
  'slack_get_reactions', 'slack_list_channel_members', 'slack_list_unreads', 'slack_list_user_channels',
  'slack_mark_read', 'slack_read_canvas', 'slack_read_channel', 'slack_read_file', 'slack_read_list',
  'slack_read_list_comments', 'slack_read_thread', 'slack_read_user_profile', 'slack_schedule_message',
  'slack_search_channels', 'slack_search_emojis', 'slack_search_public', 'slack_search_public_and_private',
  'slack_search_users', 'slack_send_message', 'slack_send_message_draft', 'slack_update_canvas',
  'slack_update_list', 'slack_update_list_comment', 'slack_update_list_record',
] as const;

/** The scan-slack allowlist: search + read only. */
export const SLACK_SCAN_TOOLS = ['slack_search_public_and_private', 'slack_read_thread', 'slack_read_channel', 'slack_list_unreads'] as const;

export const ORG62_ALL_TOOLS = ['find', 'getObjectSchema', 'getRelatedRecords', 'getUserInfo', 'listRecentSobjectRecords', 'soqlQuery'] as const;
export const ORG62_SCAN_TOOLS = ['soqlQuery'] as const;

const KNOWN_TOOLS: Partial<Record<ConnectorId, readonly string[]>> = {
  slack: SLACK_ALL_TOOLS,
  org62: ORG62_ALL_TOOLS,
};

const SCAN_TOOLS: Partial<Record<ConnectorId, readonly string[]>> = {
  slack: SLACK_SCAN_TOOLS,
  org62: ORG62_SCAN_TOOLS,
};

/** Never allowlist anything that looks like a write, whatever a skill says (tenet: Read-only ingest). */
// generate: AI generation writes (VDP's generate_*, D-59), never a scanner read
const WRITE_LIKE = /(send|schedule|add_|create|update|upload|mark|delete|draft|react|trash|label|share|manage|modify|insert|batch_update|set_|post|dispatch(?!_readonly)|write|merge|push|respond|generate)/i;

export function assertReadOnly(toolNames: readonly string[]): void {
  for (const t of toolNames) {
    const bare = t.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
    if (WRITE_LIKE.test(bare) && !/^(read|get|list|search|find|soqlQuery)/i.test(bare)) {
      throw new Error(`refusing write-like tool in scanner allowlist: ${t}`);
    }
  }
}

export interface RestrictedToolConfig {
  serverName: string;
  allowedTools: string[];
  disallowedTools: string[];
}

export function restrictedTools(connector: ConnectorId, allowBare: readonly string[] = SCAN_TOOLS[connector] ?? []): RestrictedToolConfig {
  const serverName = MCP_SERVER_NAME[connector];
  if (!serverName) throw new Error(`connector ${connector} has no traversal MCP server`);
  const all = KNOWN_TOOLS[connector] ?? [];
  const allowed = allowBare.map((t) => mcpToolName(serverName, t));
  assertReadOnly(allowed);
  const allowSet = new Set(allowBare);
  const disallowed = all.filter((t) => !allowSet.has(t)).map((t) => mcpToolName(serverName, t));
  return { serverName, allowedTools: allowed, disallowedTools: disallowed };
}

/** Disallow list for every known server tool not in `allowed` (works for any mix of servers). */
export function disallowedFor(allowed: readonly string[]): string[] {
  const allowSet = new Set(allowed);
  const out: string[] = [];
  for (const [connector, tools] of Object.entries(KNOWN_TOOLS)) {
    const server = MCP_SERVER_NAME[connector as ConnectorId];
    if (!server || !tools) continue;
    const anyAllowed = allowed.some((a) => a.startsWith(`mcp__${server}__`));
    if (!anyAllowed) continue;
    for (const t of tools) {
      const full = mcpToolName(server, t);
      if (!allowSet.has(full)) out.push(full);
    }
  }
  return out;
}

export interface HttpServerDecl {
  type: 'http';
  url: string;
  oauth?: { clientId?: string; callbackPort?: number };
}

export function claudeConfigPath(): string {
  return process.env.CC_CLAUDE_JSON ?? path.join(os.homedir(), '.claude.json');
}

/**
 * Read one server declaration from the user's Claude config. Only non-secret fields are copied.
 * Throws a `config` error (no secrets in the message) when the server is missing or not http.
 */
export function resolveServerDecl(serverName: string, configPath = claudeConfigPath()): HttpServerDecl {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error(`config: cannot read Claude config for MCP server ${serverName}`);
  }
  const servers = (raw as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
  const decl = servers[serverName] as { type?: string; url?: string; oauth?: { clientId?: unknown; callbackPort?: unknown } } | undefined;
  if (!decl) throw new Error(`config: MCP server ${serverName} is not declared in the user Claude config`);
  if (decl.type !== 'http' || typeof decl.url !== 'string') throw new Error(`config: MCP server ${serverName} is not an http server`);
  const out: HttpServerDecl = { type: 'http', url: decl.url };
  if (decl.oauth && typeof decl.oauth === 'object') {
    const o: HttpServerDecl['oauth'] = {};
    if (typeof decl.oauth.clientId === 'string') o.clientId = decl.oauth.clientId;
    if (typeof decl.oauth.callbackPort === 'number') o.callbackPort = decl.oauth.callbackPort;
    out.oauth = o;
  }
  return out;
}

/** The `mcpServers` record for one traversal connector, ready for `SkillRunInput.mcpServers`. */
export function traversalMcpServers(connector: ConnectorId, configPath?: string): Record<string, unknown> {
  const serverName = MCP_SERVER_NAME[connector];
  if (!serverName) return {};
  return { [serverName]: resolveServerDecl(serverName, configPath) };
}

/** Log-safe description: server name, transport and host only. */
export function describeServers(servers: Record<string, unknown>): string {
  return Object.entries(servers)
    .map(([name, v]) => {
      const d = v as { type?: string; url?: string };
      let host = '';
      try {
        host = d.url ? new URL(d.url).host : '';
      } catch {
        host = '?';
      }
      return `${name}(${d.type ?? 'sdk'}${host ? `:${host}` : ''})`;
    })
    .join(', ');
}
