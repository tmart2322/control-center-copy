/**
 * SLDS icons (@salesforce-ux/icons 10.18.1, CC BY-ND 4.0), served as sprites from public/icons/
 * by scripts/sync-brand-assets.mjs. Utility glyphs take currentColor. Never modify the glyphs.
 * Server-safe (no hooks).
 */
import type { CSSProperties } from 'react';
import { cn } from './cn';

export type IconSet = 'utility' | 'standard' | 'doctype';
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** 12 inline with captions · 14 dense chips · 16 default · 20 nav/header · 24 row tiles. */
const SIZE: Record<IconSize, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
  xl: 'size-6',
};

export interface IconProps {
  set?: IconSet;
  name: string;
  size?: IconSize;
  className?: string;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  title?: string;
  style?: CSSProperties;
}

export function Icon({ set = 'utility', name, size = 'md', className, title, style }: IconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
      className={cn('inline-block shrink-0', set === 'utility' && 'fill-current', SIZE[size], className)}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      <use href={`/icons/${set}.svg#${name}`} />
    </svg>
  );
}

/** Known standard glyphs (any standard sprite id works). */
type TileName = 'account' | 'opportunity' | 'event' | 'task' | 'email' | 'user' | 'report' | 'timesheet' | 'data_cloud';

export interface ObjectTileProps {
  name: TileName | string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

const TILE_SIZE = { sm: 'size-5 rounded-sm', md: 'size-6 rounded-sm', lg: 'size-8 rounded-md' } as const;

/**
 * Object tile, v2: de-emphasized and neutral (a muted standard glyph on surface-sunken). The Lightning
 * identity-colour tiles read as "platform", and colour is an indicator, never identity (DESIGN-V2 principle 8).
 * Use sparingly: a row title already says what the object is.
 */
export function ObjectTile({ name, size = 'lg', className, title }: ObjectTileProps) {
  return (
    <span className={cn('inline-grid shrink-0 place-items-center bg-surface-sunken text-muted', TILE_SIZE[size], className)}>
      <svg aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} className="size-[72%] fill-current">
        <use href={`/icons/standard.svg#${name}`} />
      </svg>
    </span>
  );
}
