'use client';
/**
 * Kit-only stand-in for the v2 shell (V2-SHELL builds the real one): a dimmed left sidebar and a calm top
 * bar, just enough to judge the domain components in place. Not for product pages.
 */
import type { TodayPayload } from '@/contract';
import type { ReactNode } from 'react';
import { cn, Icon, Kbd } from '@/ui';

const NAV: Array<[string, string, Exclude<keyof TodayPayload['navCounts'], 'adminBySurface' | 'waitingForCanvas'> | null]> = [
  ['Home', 'home', null],
  ['Today', 'event', null],
  ['Triage', 'list', 'triage'],
  ['Outbox', 'send', 'outbox'],
];
const CONTEXT: Array<[string, string]> = [
  ['Work', 'task'],
  ['Deals', 'opportunity'],
  ['Briefs', 'summary'],
  ['Agents', 'agent_session'],
  ['Time', 'clock'],
];

export function MockSidebar({ today, active }: { today: TodayPayload; active: string }) {
  const broken = today.health.broken;
  return (
    <aside className="flex w-[232px] shrink-0 flex-col gap-1 border-r border-line bg-sidebar px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <span className="grid size-7 place-items-center rounded-lg bg-gradient-brand text-caption font-bold text-white">cc</span>
        <span className="font-bold text-fg-heading">Command Center</span>
      </div>
      {NAV.map(([label, icon, count]) => (
        <NavItem key={label} label={label} icon={icon} active={active === label} count={count ? today.navCounts[count] : null} attn={count === 'outbox'} />
      ))}
      <p className="mt-3 px-2.5 py-1 text-caption text-faint">Context</p>
      {CONTEXT.map(([label, icon]) => (
        <NavItem key={label} label={label} icon={icon} active={active === label} />
      ))}
      <div className="mt-auto space-y-1.5 border-t border-line px-2.5 pt-3 text-caption text-muted">
        {broken.length ? (
          <p className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-danger-500" />
            {broken.map((b) => b.label).join(', ')} needs re-auth
          </p>
        ) : null}
        <p className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-success-500" />
          {today.dryRun ? 'Dry run' : 'Live send'}
        </p>
        <p className="text-faint">
          ${today.spend.today.usd.toFixed(2)} of ${today.spend.today.softBudgetUsd} today
        </p>
      </div>
    </aside>
  );
}

function NavItem({ label, icon, active, count, attn }: { label: string; icon: string; active?: boolean; count?: number | null; attn?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body', active ? 'bg-selected font-bold text-fg-heading' : 'text-muted')}>
      <Icon name={icon} size="md" />
      {label}
      {count ? <span className={cn('ml-auto text-caption tabular-nums', attn ? 'font-bold text-danger-700' : 'text-muted')}>{count}</span> : null}
    </span>
  );
}

export function MockTopbar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line px-6">
      <h1 className="text-title font-bold text-fg-heading">{title}</h1>
      <div className="flex h-10 w-[27.5rem] items-center gap-2.5 rounded-md border border-line-strong bg-surface-input px-3 text-faint">
        <Icon name="search" size="sm" />
        Search or ask…
        <Kbd className="ml-auto">⌘K</Kbd>
      </div>
      <span className="flex-1" />
      {right}
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-caption font-bold text-fg">
        <span className="text-ai-700">✦</span> Assistant <Kbd>⌘J</Kbd>
      </span>
    </header>
  );
}
