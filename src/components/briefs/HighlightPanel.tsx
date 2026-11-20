'use client';
/**
 * Details renderer for a brief highlight (docked right panel): relevance, why it's for you, the summary, its sources.
 * Footer: Promote → Triage (the one filled action) · Make task · Not relevant; a promoted or dismissed highlight
 * keeps its Undo (highlight-undo.ts). The highlight is read from the brief a page already loaded.
 */
import type { Brief, BriefHighlight } from '@/contract';
import { RelevanceWord, StatusBadge } from '@/components/domain';
import { Facts, PanelSection, PanelShell, useCachedFind } from '@/components/deals/panel-shell';
import { isOpenHighlight } from '@/components/lists/cache-patches';
import { useRightPanel } from '@/components/shell/panel';
import { Button, EmptyState, fmtClock, SourceChip, useTimeZone } from '@/ui';
import { useHighlightActions } from './useHighlightActions';
import { promotedState } from './promoted';
import { navigate } from '@/components/shell/router';

export function HighlightPanel({ id, label }: { id: string; label?: string }) {
  const panel = useRightPanel();
  const tz = useTimeZone();
  const actions = useHighlightActions();
  const hit = useCachedFind<{ h: BriefHighlight; b: Brief }>('briefs', (data) => {
    const b = data as Partial<Brief>;
    const h = Array.isArray(b.highlights) ? b.highlights.find((x) => x.id === id) : undefined;
    return h ? { h, b: b as Brief } : null;
  });
  if (!hit) {
    return (
      <PanelShell from="Brief highlight" title={label ?? 'Highlight'}>
        <EmptyState size="inline" icon="summary" title="Not loaded here" body="Highlights load with their brief. Open Briefs to read it." action={<Button size="sm" variant="secondary" onClick={() => navigate('/briefs')}>Open Briefs</Button>} />
      </PanelShell>
    );
  }
  const { h, b } = hit;
  const live = isOpenHighlight(h.status);
  // One state once handled: "In Triage" (opens that row in Triage) or "Task made" (opens the task).
  const st = promotedState(h, actions.kindOf(h.id));
  const to = st?.open ?? null;
  return (
    <PanelShell
      testId="panel-highlight"
      from={`Worth a closer look · ${b.title}`}
      title={h.title}
      badge={
        st ? (
          <StatusBadge tone="success" icon="check">
            {st.word}
          </StatusBadge>
        ) : h.status === 'dismissed' ? (
          <StatusBadge tone="neutral">Not relevant</StatusBadge>
        ) : null
      }
      footer={
        live ? (
          <>
            <Button variant="primary" size="md" kbd="p" onClick={() => actions.promote(h)} data-testid="panel-promote">
              Promote → Triage
            </Button>
            <Button variant="quiet" size="md" onClick={() => actions.makeTask(h)}>
              Make task
            </Button>
            <Button variant="quiet" size="md" onClick={() => actions.dismiss(h)}>
              Not relevant
            </Button>
          </>
        ) : (
          <>
            {to && 'href' in to ? (
              <Button variant="primary" size="md" onClick={() => navigate(to.href)}>
                {to.label}
              </Button>
            ) : to ? (
              <Button variant="primary" size="md" onClick={() => panel.openDetails({ kind: 'work_item', id: to.taskId, label: h.title })}>
                {to.label}
              </Button>
            ) : null}
            <Button variant="quiet" size="md" icon="undo" onClick={() => void actions.undo(h)}>
              Undo
            </Button>
          </>
        )
      }
    >
      <p className="cx-prose text-fg">{h.summary}</p>
      <PanelSection title="Why it's for you">
        <ul className="space-y-1.5">
          {h.reasons.map((r) => (
            <li key={r} className="text-body text-fg">
              {r}
            </li>
          ))}
        </ul>
      </PanelSection>
      <Facts rows={[['Relevance', <RelevanceWord key="r" value={h.relevance} />], ['When', fmtClock(h.at, tz)], ['Brief', b.title]]} />
      <PanelSection title="Sources">
        <div className="flex flex-wrap gap-1.5">
          {h.sources.map((s) => (
            <SourceChip key={`${s.kind}${s.label}`} source={s.kind} label={s.label} href={s.url ?? undefined} />
          ))}
        </div>
      </PanelSection>
    </PanelShell>
  );
}
