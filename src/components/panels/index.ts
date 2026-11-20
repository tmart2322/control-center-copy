/**
 * Context Details renderers for the v2 docked panel (P-CONTEXT-B): calendar_event, connector, agent_run,
 * tool_adapter and tool_run. Importing this barrel registers them in the browser (see ./register).
 */
import './register';

export { EventPanel, type EventPanelProps } from './EventPanel';
export { MeetingHover, MeetingCard, AgendaText } from './meeting';
export { ConnectorPanel, type ConnectorPanelProps } from './ConnectorPanel';
export { RunPanel, RunBadge, RUN_BADGE, type RunPanelProps } from './RunPanel';
export { PanelFrame, PanelSection, Facts, CommandBlock, CopyButton, copyToClipboard, type PanelPrimary, type PanelFrameProps } from './bits';
