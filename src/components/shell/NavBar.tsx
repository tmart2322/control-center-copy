'use client';
/**
 * v1 nav-bar compatibility. The nav bar is gone (DESIGN-V2: the sidebar, see Sidebar.tsx); NavTab
 * stays because the primitives kit still renders it.
 */
import { AppLink } from './AppLink';
import { CountBadge } from '@/ui/badges';
import { cn } from '@/ui/cn';
import { KbdHint } from '@/ui/Kbd';
import { Tooltip } from '@/ui/Tooltip';
import type { NavTabDef } from './nav';

export interface NavTabProps {
  tab: NavTabDef;
  active: boolean;
  count?: number;
}

/** @deprecated v1 nav-bar tab (kit specimens only); use SidebarLink. */
export function NavTab({ tab, active, count }: NavTabProps) {
  const reading = tab.count === 'briefsUnread';
  return (
    <Tooltip content={<span className="inline-flex items-center gap-1.5">{tab.label} <KbdHint combo={tab.chord} tone="inverse" /></span>} side="bottom">
      <AppLink
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative inline-flex h-full shrink-0 items-center gap-1.5 px-3 text-body font-bold whitespace-nowrap no-underline transition-colors hover:no-underline focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]',
          active ? 'text-link hover:text-link' : 'text-muted hover:bg-surface-muted hover:text-fg',
        )}
      >
        {tab.label}
        {count ? <CountBadge count={count} tone={reading ? 'neutral' : 'brand'} label={`${count} ${reading ? 'unread' : 'need you'}`} /> : null}
      </AppLink>
    </Tooltip>
  );
}
