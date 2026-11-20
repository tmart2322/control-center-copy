'use client';
/**
 * v1 utility-bar compatibility. The bar is gone (DESIGN-V2: system state lives in the sidebar footer,
 * see StatusPanels.tsx); DryRunChip stays because the primitives kit still renders it.
 */
import type { ComponentProps } from 'react';
import { UtilityItem } from './UtilityPanel';

/** @deprecated v1 utility-bar chip (kit specimens only). */
export function DryRunChip({ dryRun, ...rest }: { dryRun: boolean } & Omit<ComponentProps<typeof UtilityItem>, 'icon'>) {
  return (
    <UtilityItem icon={dryRun ? 'lock' : 'send'} tone={dryRun ? 'default' : 'loud'} aria-label={dryRun ? 'Dry run is on: nothing leaves the machine' : 'Live send is on: approved sends leave the machine'} {...rest}>
      {dryRun ? 'Dry run' : 'Live send'}
    </UtilityItem>
  );
}
