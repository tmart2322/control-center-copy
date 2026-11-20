/**
 * Stroke icons for the v2 assistant (DESIGN-V2: calm chrome). One 20×20 grid, 1.7 stroke, currentColor.
 * Decorative unless `title` is given. Server-safe.
 */
import type { CSSProperties } from 'react';

const PATHS = {
  x: 'M5 5l10 10M15 5 5 15',
  plus: 'M10 4v12M4 10h12',
  search: 'M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zm4 9 3.5 3.5',
  popout: 'M11 4h5v5M16 4l-7 7M14 12v4H4V6h4',
  dock: 'M5 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm7 0v12',
  'chev-d': 'm6 8 4 4 4-4',
  'chev-r': 'm8 6 4 4-4 4',
  at: 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm3 3v1.2a2 2 0 0 0 4 0V10a7 7 0 1 0-2.8 5.6',
  slash: 'M13 4 7 16',
  clip: 'm14.5 9.5-4.9 4.9a3 3 0 0 1-4.2-4.2l5.6-5.6a2 2 0 0 1 2.8 2.8l-5.5 5.5a1 1 0 0 1-1.4-1.4l4.9-4.9',
  mic: 'M10 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 10 3zM5 10a5 5 0 0 0 10 0M10 15v2.5',
  send: 'M10 16V4M5 9l5-5 5 5',
  stop: 'M6 6h8v8H6z',
  ext: 'M8 5H5v10h10v-3M11 4h5v5M16 4l-6 6',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  scan: 'M16 10a6 6 0 1 1-1.8-4.3M16 4v3.5h-3.5',
  term: 'M5 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1.5 4.5 2 1.5-2 1.5M10.5 12h3',
  undo: 'M7 6 4 9l3 3M4 9h8a4 4 0 0 1 0 8h-2',
  alert: 'M10 4v7M10 14.5v.5',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
} as const;

export type ChatIconName = keyof typeof PATHS;

export function ChatIcon({ name, size = 18, className, title, style }: { name: ChatIconName; size?: 14 | 16 | 18 | 20; className?: string; title?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 2.6 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
