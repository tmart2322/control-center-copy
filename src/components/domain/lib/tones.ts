/**
 * Domain-only tone lookup: the 3 px state edge on rows and cards, drawn as a `before:` pseudo element so
 * the row keeps its own background. Design v2: the edge is an indicator, never identity. Late = danger,
 * tight = warning, high priority = the accent ("now"), else the neutral hairline. Complete literal strings
 * so Tailwind's scanner sees them. Everything else (TONE_DOT, TONE_TEXT, ...) comes from `@/ui`.
 */
export const BAR = {
  risk: 'before:bg-danger-500',
  warn: 'before:bg-warning-500',
  brand: 'before:bg-accent',
  neutral: 'before:bg-line-strong',
} as const;
export type BarTone = keyof typeof BAR;
