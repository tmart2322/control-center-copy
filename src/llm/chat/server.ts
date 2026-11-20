/**
 * The chat tools as an in-process MCP server for the Agent SDK (`createSdkMcpServer` + `tool()`).
 * Wire names are `mcp__chat__<name>`. One server per turn: handlers close over the turn's context.
 *
 * D-55: the tool list follows the persona and nothing else. A tool whose feature is inactive (TOOL_GATES: the VDP
 * tools without VDP) is left out, and `chat_app_read` lists only the persona's pages (READ_PAGE_GATES) and routes
 * (ROUTE_GATES), so each persona has one stable tool prefix from turn to turn (prompt cache) and an AE's Assistant
 * never offers VDP.
 */
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { allows, TOOL_GATES, type ResolvedPersona } from '@/personas';

import { callChatTool, CHAT_SERVER_NAME, CHAT_TOOLS, chatToolFullName, describeTool, type AnyChatToolDef, type ChatToolCtx } from './tools';

/**
 * How long the SDK waits for one chat tool call. Above the longest tool (a chat_research run, RESEARCH_TIMEOUT_MS in
 * src/server/chat/research.ts); the turn's own deadline (runner.ts) still bounds the whole message.
 */
export const CHAT_TOOL_TIMEOUT_MS = 200_000;

/** A tool as the turn serves it: its description resolved for the persona. */
export type ServedTool = Omit<AnyChatToolDef, 'description'> & { description: string };

/**
 * The tools (with their wire descriptions and shapes) this persona's Assistant gets, in CHAT_TOOLS order. No persona:
 * every tool, unchanged. D-58: the general tools' route catalogs are built for the persona (ROUTE_GATES), and the live
 * Google reads follow their sources (TOOL_GATES), through the same filter.
 */
export function chatToolsFor(persona?: ResolvedPersona | null): ServedTool[] {
  const all = CHAT_TOOLS as readonly AnyChatToolDef[];
  const list = persona === undefined ? [...all] : all.filter((t) => allows(persona, TOOL_GATES[t.name]));
  return list.map((t) => ({ ...t, description: describeTool(t, persona) }));
}

/** The allowlist entries (`mcp__chat__<name>`) of the persona's tools. */
export const chatAllowedToolsFor = (persona?: ResolvedPersona | null) => chatToolsFor(persona).map((t) => chatToolFullName(t.name));

export function buildChatMcpServer(ctx: ChatToolCtx, persona?: ResolvedPersona | null): McpSdkServerConfigWithInstance {
  const tools = chatToolsFor(persona).map((t) =>
    tool(t.name, t.description, t.shape, async (args: unknown) => {
      const r = await callChatTool(ctx, t.name, args);
      return { content: [{ type: 'text' as const, text: r.text }], ...(r.ok ? {} : { isError: true }) };
    }),
  );
  return createSdkMcpServer({ name: CHAT_SERVER_NAME, version: '1.0.0', tools, alwaysLoad: true, timeout: CHAT_TOOL_TIMEOUT_MS });
}
