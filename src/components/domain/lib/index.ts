/**
 * Domain-only helpers that `@/ui` does not cover: the domain clock, time formatting, safe HTML, the
 * state-edge tone, three thin chip wrappers with domain behaviour (SourceRef + onOpen, bare entity chips,
 * "due" / headline timing) and the design-v2 marks (indicator, status badge, neutral tag, effort note).
 */
export { DomainClock, useClock } from './clock';
export { SafeHtml, sanitize } from './SafeHtml';
export { BAR, type BarTone } from './tones';
export * as t from './time';
export { originSource, openInLabel } from './source-link';
export { SourceChip, EntityChip, StartBy, startByTone, type SourceChipProps, type EntityChipProps, type EntityKind, type StartByProps } from './chips';
export {
  hm,
  sentence,
  itemIndicator,
  EDGE_BG,
  EDGE_TOP,
  INDICATOR_TEXT,
  INDICATOR_BADGE,
  TONE_INDICATOR,
  TONE_TO_BADGE,
  TIGHT_MIN,
  RAISED_BG,
  StatusBadge,
  AiMark,
  AccountTag,
  EffortNote,
  type Indicator,
  type IndicatorOpts,
  type BadgeTone,
  type StatusBadgeProps,
  type AccountTagProps,
  type EffortNoteProps,
} from './v2';
