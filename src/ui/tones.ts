/**
 * Tone → token classes. Tones mirror the contract's `Tone` enum (ok/warn/risk/brand/neutral/ai).
 * v2 (DESIGN-V2 principle 8): tones are indicators, never identity. Status tones use the status ramps;
 * `brand` means "now / in progress / the one action" and draws from the blue status ramp (info) or the accent.
 * Badges are tint 50 + text 700 (+ border 200); dots/bars use 500; solids use 600 with on-solid (warning: on-warning).
 * Class strings are literal so Tailwind can see them.
 */
export type Tone = 'ok' | 'warn' | 'risk' | 'brand' | 'neutral' | 'ai';

/** Tinted fill + text (no border). */
export const TONE_SOFT: Record<Tone, string> = {
  ok: 'bg-success-50 text-success-700',
  warn: 'bg-warning-50 text-warning-700',
  risk: 'bg-danger-50 text-danger-700',
  brand: 'bg-info-50 text-info-700',
  neutral: 'bg-surface-sunken text-fg',
  ai: 'bg-ai-50 text-ai-700',
};

/** The v2 status badge: tint 50 + text 700 + hairline 200 (mockup `.badge`). */
export const TONE_BADGE: Record<Tone, string> = {
  ok: 'border border-success-200 bg-success-50 text-success-700',
  warn: 'border border-warning-200 bg-warning-50 text-warning-700',
  risk: 'border border-danger-200 bg-danger-50 text-danger-700',
  brand: 'border border-info-200 bg-info-50 text-info-700',
  neutral: 'border border-line bg-surface-sunken text-fg',
  ai: 'border border-ai-200 bg-ai-50 text-ai-700',
};

/** Suggested / pending: nothing looks done before it is. */
export const TONE_DASHED: Record<Tone, string> = {
  ok: 'border border-dashed border-success-200 bg-success-50 text-success-700',
  warn: 'border border-dashed border-warning-200 bg-warning-50 text-warning-700',
  risk: 'border border-dashed border-danger-200 bg-danger-50 text-danger-700',
  brand: 'border border-dashed border-info-200 bg-info-50 text-info-700',
  neutral: 'border border-dashed border-line-strong bg-surface text-muted',
  ai: 'border border-dashed border-ai-200 bg-ai-50 text-ai-700',
};

/** Dots, bars and small marks (≥ 3:1 on every surface). */
export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-success-500',
  warn: 'bg-warning-500',
  risk: 'bg-danger-500',
  brand: 'bg-accent',
  neutral: 'bg-ink-500',
  ai: 'bg-ai-500',
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-success-700',
  warn: 'text-warning-700',
  risk: 'text-danger-700',
  brand: 'text-link',
  neutral: 'text-muted',
  ai: 'text-ai-700',
};

/** The icon that pairs with each status tone, so colour is never the only signal (WCAG 1.4.1). */
export const TONE_ICON: Record<Tone, string | null> = {
  ok: 'check',
  warn: 'warning',
  risk: 'error',
  brand: null,
  neutral: null,
  ai: 'sparkles',
};

/** 3 px edge bar on rows/cards: red overdue/blocked, amber at risk, blue now, otherwise a neutral line. */
export const PRIORITY_BAR = {
  risk: 'bg-danger-500',
  warn: 'bg-warning-500',
  brand: 'bg-accent',
  none: 'bg-line-strong',
} as const;
export type Priority = keyof typeof PRIORITY_BAR;
