/**
 * Composer-local helpers. Primitives come from `@/ui` (the FE-1a swap is done); what stays here is what
 * @/ui doesn't offer the composer:
 *   cx            className joiner
 *   Tooltip       span-wrapping tooltip that also works on disabled buttons (blocked-send reasons)
 *   ConfirmFrame  the border confirm's shell on @/ui Overlay (free footer, wide size, inline specimen)
 *
 * Legacy stand-ins (Button, Dialog, Icon, StatePill, Kbd) remain ONLY for app/dev/kit/composer, which
 * isn't in this lane. Nothing under src/components/composer imports them. Delete them when the kit page
 * moves to @/ui.
 */
export { cx } from './cx';
export { Tooltip, type TooltipProps } from './Tooltip';
export { ConfirmFrame, type ConfirmFrameProps } from './ConfirmFrame';

/** @deprecated kit-only: use `@/ui`. */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
/** @deprecated kit-only: use `@/ui` Dialog, or ConfirmFrame for the border confirm. */
export { Dialog, type DialogProps } from './Dialog';
/** @deprecated kit-only: use `@/ui`. */
export { StatePill, type StatePillProps } from './StatePill';
/** @deprecated kit-only: use `@/ui`. */
export { Icon, type IconProps, type IconSet } from './Icon';
/** @deprecated kit-only: use `@/ui`. */
export { Kbd, type KbdProps } from './Kbd';
