/**
 * The plain text of a React node (strings, numbers, fragments and elements' children, in order), for a `title` tooltip
 * on text a row truncates (2026-11-13 audit C5: a cut name or why line can always be read in full). Pure.
 */
import { isValidElement, type ReactNode } from 'react';

export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

/** A tooltip for truncated text: its full text, or undefined when there is none. */
export function titleOf(node: ReactNode): string | undefined {
  const s = nodeText(node).replace(/\s+/g, ' ').trim();
  return s || undefined;
}
