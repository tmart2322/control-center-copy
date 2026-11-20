'use client';
/**
 * Related (UI-SPEC §12, R-UI-20): the initiative's sibling tasks as WorkRows, then the assets — slides
 * and docs, demo orgs, Claude sessions (status + Open in Claude), tool outputs — and anything linked
 * from capture enrichment. Rows keep their order while you look (UI-SPEC §10).
 */
import { useRef } from 'react';
import type { AgentRun, Asset, WorkItem, WorkItemDetail } from '@/contract';
import { AgentRunRow, WorkGroup, WorkList, type WorkRowActionKey } from '@/components/domain';
import { WorkRow } from '@/components/domain';
import { EmptyState, Icon, SourceChip } from '@/ui';
import { CLOSED_STATES, doctypeIcon, groupAssets, stableOrder } from '../lib/derive';
import { useChipDecisions } from '../lib/enrichment-store';
import { fmtWhen } from '../lib/tz';
import { openDeepLink } from '../nba/ClaudeLaunchPanel';
import { GroupLabel, OpenButton } from '../panel/bits';

export interface RelatedTabProps {
  detail: WorkItemDetail;
  now: string;
  tz?: string;
  onOpenItem: (id: string, mode: 'sheet' | 'page') => void;
  onSiblingAction: (key: WorkRowActionKey, item: WorkItem) => void;
}

function AssetRow({ a, now, tz }: { a: Asset; now: string; tz?: string }) {
  // Neutral utility glyphs: the kind is a label, not a color (DESIGN-V2 principle 8).
  const icon = a.kind === 'demo_org' ? 'salesforce1' : a.kind === 'link' ? 'link' : a.kind === 'tool_output' ? 'apps' : a.kind === 'claude_session' ? 'agent_session' : 'file';
  return (
    <li className="flex min-h-11 items-center gap-2.5 border-b border-line px-4 last:border-b-0 hover:bg-surface-muted" data-asset-id={a.id} data-doctype={doctypeIcon(a.kind)}>
      <Icon name={icon} size="sm" className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-body text-fg" title={a.title}>
        {a.title}
      </span>
      {a.updatedAt ? (
        <span className="hidden shrink-0 text-caption text-muted tabular-nums @md:inline">
          edited {fmtWhen(a.updatedAt, now, tz, { today: true })}
          {a.updatedBy ? ` · ${a.updatedBy.split(' ')[0]}` : ''}
        </span>
      ) : null}
      {a.url ? (
        <OpenButton url={a.url} label={a.title} />
      ) : (
        <SourceChip source={a.source} compact />
      )}
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <GroupLabel count={count}>{title}</GroupLabel>
      {children}
    </section>
  );
}

function Runs({ runs, assets, now, tz }: { runs: AgentRun[]; assets: Asset[]; now: string; tz?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      {runs.map((r) => (
        <AgentRunRow key={r.id} run={r} now={now} onOpenDeepLink={(url) => openDeepLink(url)} onAction={(k, run) => (run.deepLink && (k === 'review' || k === 'open_log') ? openDeepLink(run.deepLink) : undefined)} />
      ))}
      {assets.length ? (
        <ul>
          {assets.map((a) => (
            <AssetRow key={a.id} a={a} now={now} tz={tz} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RelatedTab({ detail, now, tz, onOpenItem, onSiblingAction }: RelatedTabProps) {
  const order = useRef<string[]>([]);
  const s = stableOrder(order.current, detail.siblings);
  order.current = s.order;
  const open = s.list.filter((i) => !CLOSED_STATES.has(i.state));
  const closed = s.list.filter((i) => CLOSED_STATES.has(i.state));
  const g = groupAssets(detail.assets, detail.runs);
  const decisions = useChipDecisions(detail.item.id);
  const linked = (detail.item.enrichment?.chips ?? []).filter((c) => decisions[c.id] === 'accepted' || c.status === 'accepted');
  const total = detail.siblings.length + detail.assets.length + detail.runs.length + linked.length;

  if (!total) return <EmptyState size="panel" icon="link" title="Nothing related yet" body="Sibling tasks, decks, docs, demo orgs and Claude sessions for this work show up here." />;

  return (
    <div className="space-y-6" data-related-tab>
      {detail.siblings.length ? (
        <section aria-label="Sibling tasks" className="space-y-2">
          <div className="flex items-center gap-2">
            <GroupLabel count={detail.siblings.length}>Sibling tasks</GroupLabel>
            {detail.initiative ? <span className="truncate text-caption text-muted">in {detail.initiative.title}</span> : null}
            {s.added.length ? <span className="ml-auto text-caption font-bold text-link">{s.added.length} new ↓</span> : null}
          </div>
          <WorkList label="Sibling tasks">
            {open.length ? (
              <WorkGroup label="Open" count={open.length}>
                {open.map((i) => (
                  <WorkRow key={i.id} item={i} now={now} onOpen={(it, mode) => onOpenItem(it.id, mode)} onAction={onSiblingAction} onOpenSource={(src) => src.url && openDeepLink(src.url)} />
                ))}
              </WorkGroup>
            ) : null}
            {closed.length ? (
              <WorkGroup label="Done" count={closed.length} defaultCollapsed={open.length > 0}>
                {closed.map((i) => (
                  <WorkRow key={i.id} item={i} now={now} onOpen={(it, mode) => onOpenItem(it.id, mode)} onAction={onSiblingAction} />
                ))}
              </WorkGroup>
            ) : null}
          </WorkList>
        </section>
      ) : null}

      <Section title="Slides and docs" count={g.files.length}>
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {g.files.map((a) => (
            <AssetRow key={a.id} a={a} now={now} tz={tz} />
          ))}
        </ul>
      </Section>
      <Section title="Demo orgs" count={g.demoOrgs.length}>
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {g.demoOrgs.map((a) => (
            <AssetRow key={a.id} a={a} now={now} tz={tz} />
          ))}
        </ul>
      </Section>
      <Section title="Claude sessions" count={g.sessions.runs.length + g.sessions.assets.length}>
        <Runs runs={g.sessions.runs} assets={g.sessions.assets} now={now} tz={tz} />
      </Section>
      <Section title="Tool outputs" count={g.toolOutputs.runs.length + g.toolOutputs.assets.length}>
        <Runs runs={g.toolOutputs.runs} assets={g.toolOutputs.assets} now={now} tz={tz} />
      </Section>
      <Section title="Links" count={g.links.length}>
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {g.links.map((a) => (
            <AssetRow key={a.id} a={a} now={now} tz={tz} />
          ))}
        </ul>
      </Section>
      <Section title="Linked from capture" count={linked.length}>
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {linked.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-2.5 border-b border-line px-4 last:border-b-0">
              <Icon name="check" size="xs" className="text-success-700" />
              <span className="min-w-0 flex-1 truncate text-body text-fg">{c.label}</span>
              {c.url ? <OpenButton url={c.url} label={c.label} /> : null}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
