/**
 * Registers the docked panel's Details renderers for the context kinds (BUILD-V2 wave 2, backlog B-064):
 *   calendar_event → the meeting brief · connector → source state, coverage and re-auth ·
 *   agent_run → what a run did and needs from you · tool_adapter → a tool's run form · tool_run → one tool run.
 * Today, Home, Agents and Health call `openDetails({ kind, id, label })`; until a kind is registered the shell
 * shows its generic fallback.
 *
 * Browser only, like src/components/detail/lib/register.ts: server components can reach this module through
 * client barrels, and there the shell's client module is only a reference that can't be called (registering
 * on the server caused a 500). Uses the leaf `@/components/shell/panel`, never the shell barrel (a cycle:
 * the shell imports this module).
 */
import { createElement } from 'react';
import { registerDetailRenderer } from '@/components/shell/panel';
import { ToolAdapterPanel, ToolRunDetail } from '@/components/agents/ToolRunPanel';
import { ConnectorPanel } from './ConnectorPanel';
import { EventPanel } from './EventPanel';
import { RunPanel } from './RunPanel';

if (typeof window !== 'undefined') {
  registerDetailRenderer('calendar_event', (e) => createElement(EventPanel, { key: e.id, eventId: e.id, label: e.label }));
  registerDetailRenderer('connector', (e) => createElement(ConnectorPanel, { key: e.id, connectorId: e.id }));
  registerDetailRenderer('agent_run', (e) => createElement(RunPanel, { key: e.id, runId: e.id }));
  registerDetailRenderer('tool_adapter', (e) => createElement(ToolAdapterPanel, { key: e.id, adapterId: e.id }));
  registerDetailRenderer('tool_run', (e) => createElement(ToolRunDetail, { key: e.id, runId: e.id }));
}
