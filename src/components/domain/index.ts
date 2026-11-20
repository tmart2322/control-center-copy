/**
 * Domain components (FE-1b, restyled for design v2 by V2-DOMAIN): presentational, props from `@/contract`
 * view models, callbacks for every action, no data fetching. Wrap a page in <DomainClock now tz> so times
 * render in the profile timezone. Color is an indicator only (DESIGN-V2): accounts and sources are neutral.
 */
export { NbaCard, type NbaCardProps, type NbaPrimaryEvent, type NbaPrimaryKind, type NbaSecondaryKey } from './NbaCard';
export { DraftPreviewBlock, type DraftPreviewBlockProps } from './DraftPreviewBlock';
export { WorkRow, WorkList, WorkGroup, type WorkRowProps, type WorkRowActionKey, type WorkGroupProps } from './WorkRow';
export { DaySpine, DayRibbon, type DaySpineProps, type DayRibbonProps, type AgentBlock } from './DaySpine';
/** @deprecated design v2 has no status strip: use CapacityMeter. */
export { HeaderStrip, type HeaderStripProps } from './HeaderStrip';
/** @deprecated design v2 has no status rail: use SectionColumn. */
export { StatusRail, RailLane, type StatusRailProps, type RailLaneProps, type RailCallbacks } from './StatusRail';
export { Shelf, FitInRow, PromiseRow, type ShelfProps, type ShelfRowProps } from './Shelves';
export { ReceiptCard, type ReceiptCardProps } from './ReceiptCard';
export { ProposalDiff, TextDiff, type ProposalDiffProps } from './ProposalDiff';
export { AgentRunRow, type AgentRunRowProps, type AgentRunActionKey } from './AgentRunRow';
export { BriefHighlightCard, BriefSummary, RelevanceWord, type BriefHighlightCardProps, type BriefSummaryProps } from './Briefs';
export { ConnectorRow, ConnectorRowHeader, CONNECTOR_COLS, type ConnectorRowProps } from './ConnectorRow';
export { ActivityRow, ActivityRowHeader, ActivityStatusWord, ACTIVITY_AREA, ACTIVITY_COLS, ACTIVITY_ROWS, type ActivityRowProps, type ActivityPatch } from './ActivityRow';
export { ResolvePicker, type ResolvePickerProps, type ResolveValue } from './ResolvePicker';
export { RunGlyph } from './RunGlyph';
export { StateGlyph } from './StateGlyph';
export { AheadStrip, buildAheadDays, type AheadStripProps, type AheadDay, type AheadInput } from './AheadStrip';
export { CapacityMeter, approxMin, type CapacityMeterProps } from './CapacityMeter';
export { SectionColumn, type SectionColumnProps } from './SectionColumn';
export { DomainClock, useClock } from './lib/clock';
export { originSource, openInLabel } from './lib/source-link';
export {
  hm,
  itemIndicator,
  StatusBadge,
  AiMark,
  AccountTag,
  EffortNote,
  EDGE_BG,
  type Indicator,
  type BadgeTone,
  type StatusBadgeProps,
  type AccountTagProps,
  type EffortNoteProps,
} from './lib/v2';
export * from './vocab';
export { barTone, agePhrase, leadTiming, draftPreviewHtml, draftFirstLine, destinationLabel, toComposeDestination } from './derive';
