'use client';
/**
 * Agents masthead (DESIGN-V2): ONE sentence (the topbar carries the page title) that says what the runs need from you (hands-on
 * minutes only; background runs never count against the day), quiet header actions, and the "Runs · Tools"
 * line tabs (routes /agents and /agents/tools). No ALL-CAPS eyebrow, no stat tiles.
 */
import type { ReactNode } from 'react';
import { Tabs } from '@/ui';
import { navigate } from '@/components/shell/router';

export type AgentsTab = 'runs' | 'tools';

export function AgentsHeader({ tab, sentence, waiting, actions }: { tab: AgentsTab; sentence?: ReactNode; waiting?: number; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3" data-agents-head>
      {/* The topbar holds the page title (h1); the masthead is one sentence, like Today's. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2">
        {sentence ? (
          <p className="min-w-0 flex-1 basis-[28rem] text-lead text-fg text-pretty" data-agents-sentence>
            {sentence}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <Tabs
        label="Agents sections"
        idBase="agents"
        variant="line"
        value={tab}
        onChange={(v) => navigate(v === 'runs' ? '/agents' : '/agents/tools')}
        tabs={[
          { value: 'runs', label: 'Runs', count: waiting || undefined },
          { value: 'tools', label: 'Tools' },
        ]}
      />
    </header>
  );
}
