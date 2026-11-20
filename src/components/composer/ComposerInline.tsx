'use client';
/**
 * Compact composer for NbaCard's expanded state: the same editor, autosave and send border, with fewer
 * chrome elements (no thread context, five formatting tools, no payload panel, no shortcut hints).
 */
import { Composer, type ComposerProps } from './Composer';

export type ComposerInlineProps = Omit<ComposerProps, 'variant' | 'defaultShowPayload'>;

export function ComposerInline(props: ComposerInlineProps) {
  return <Composer {...props} variant="inline" />;
}
