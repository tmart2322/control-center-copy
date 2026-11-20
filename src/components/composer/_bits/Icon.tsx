/**
 * Stand-in for `@/ui` Icon (FE-1a). SLDS sprites are copied to /public/icons by `npm run predev`.
 * Same name and props as the shared primitive, so the swap is an import change.
 */
import { cx } from './cx';

export type IconSet = 'utility' | 'standard' | 'doctype';

export interface IconProps {
  set?: IconSet;
  name: string;
  /** Pixel size: 12 inline with captions, 16 default, 20 nav/header. */
  size?: number;
  className?: string;
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  title?: string;
}

export function Icon({ set = 'utility', name, size = 16, className, title }: IconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      width={size}
      height={size}
      className={cx('shrink-0 fill-current', className)}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <use href={`/icons/${set}.svg#${name}`} />
    </svg>
  );
}
