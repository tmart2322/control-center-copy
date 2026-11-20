'use client';
/** "That's everything for today." plus one quiet status line; only the broken part gets color. */
import { AppLink } from '@/components/shell/AppLink';
import type { ReactNode } from 'react';
import type { HomeFooter } from '@/contract';

/** `day`: the day shown, in a sentence ("today", "tomorrow", "Monday"). */
export function HomeEnd({ f, day = 'today' }: { f: HomeFooter; day?: string }) {
  const more = Math.max(0, f.chase.count - f.chase.names.length);
  const budget = f.spend.budgetUsd % 1 ? f.spend.budgetUsd.toFixed(2) : String(f.spend.budgetUsd);
  const parts: Array<{ key: string; node: ReactNode; opt?: boolean; chase?: boolean }> = [
    { key: 'src', node: <span>Sources {f.sources.live}/{f.sources.total}</span> },
    ...f.alerts.map((a) => ({
      key: `a-${a.id}`,
      node: (
        <AppLink href={a.href} className="hm-link is-warn">
          ✕ {a.label}
        </AppLink>
      ),
    })),
    { key: 'spend', node: <span>${f.spend.usd.toFixed(2)} of ${budget}</span>, opt: true },
    ...(f.dryRun ? [{ key: 'dry', node: <span>Dry run</span>, opt: true }] : []),
    ...(f.briefs.count
      ? [
          {
            key: 'briefs',
            node: (
              <AppLink className="hm-link" href={f.briefs.href}>
                {f.briefs.count} {f.briefs.count === 1 ? 'brief' : 'briefs'} worth a look →
              </AppLink>
            ),
          },
        ]
      : []),
    ...(f.agentRuns.count
      ? [
          {
            key: 'runs',
            node: (
              <AppLink className="hm-link" href={f.agentRuns.href}>
                {f.agentRuns.count} agent {f.agentRuns.count === 1 ? 'run' : 'runs'} to review →
              </AppLink>
            ),
          },
        ]
      : []),
    ...(f.chase.count
      ? [
          {
            key: 'chase',
            chase: true,
            node: (
              <AppLink className="hm-link" href={f.chase.href}>
                Chase {f.chase.count}: {[...f.chase.names, ...(more ? [`+${more}`] : [])].join(', ')} →
              </AppLink>
            ),
          },
        ]
      : []),
  ];
  return (
    <footer className="hm-end" data-home-panel="footer">
      <span className="hm-end-title">That’s everything for {day}.</span>
      <span className="hm-end-status">
        {parts.map((p, i) => (
          <span key={p.key} className={['hm-part', p.opt ? 'is-opt' : '', p.chase ? 'hm-chase-link' : ''].filter(Boolean).join(' ')}>
            {i > 0 ? <span aria-hidden>·</span> : null}
            {p.node}
          </span>
        ))}
      </span>
    </footer>
  );
}
