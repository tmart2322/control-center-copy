'use client';
/**
 * Sources pane (Health): one calm row per connector, broken first.
 *
 *   ▌ [glyph] Slack                                        Rescan
 *   ▌         Slack through 08:21 · 46 items today
 *
 * Healthy rows carry no colour at all (a quiet screen means nothing needs you); only a broken (red) or degraded
 * (amber) source gets an edge and a word. The verb is quiet text (Rescan, or the re-auth), filled only on the
 * selected row. While a scan runs its real ledger state shows in the row ("Scanning · running").
 * Click or Enter opens the connector in the docked panel.
 */
import type { Connector, ScanRun } from '@/contract';
import { EDGE_BG, type Indicator } from '@/components/domain';
import { connectorLine, connectorPrimary, SCAN_STATUS } from '@/components/panels/derive';
import { cn, Icon, RowVerb, SOURCE_META } from '@/ui';
import { ATTENTION_STATES, BROKEN_STATES } from './derive';
import type { useConnectorActions } from './actions';

type Actions = ReturnType<typeof useConnectorActions>;

const RANK: Record<string, number> = { auth_needed: 0, error: 0, degraded: 1, offline: 1, catching_up: 2 };

export function sortConnectors(all: Connector[]): Connector[] {
  return [...all].sort((x, y) => (RANK[x.state] ?? 3) - (RANK[y.state] ?? 3));
}

export interface ConnectorListProps {
  connectors: Connector[];
  scans: ScanRun[];
  now: string;
  tz?: string;
  actions: Actions;
  activeId: string | null;
  panelId: string | null;
  rowProps: (id: string) => Record<string, unknown>;
  onOpen: (c: Connector) => void;
}

export function ConnectorList({ connectors, scans, now, tz, actions, activeId, panelId, rowProps, onOpen }: ConnectorListProps) {
  return (
    <div role="list" aria-label="Connectors" className="flex flex-col">
      {connectors.map((c) => {
        const broken = BROKEN_STATES.has(c.state);
        const attention = ATTENTION_STATES.has(c.state);
        const selected = activeId === c.id;
        const ind: Indicator = broken ? 'danger' : attention ? 'warning' : selected ? 'now' : 'none';
        const src = SOURCE_META[c.source] ?? SOURCE_META.manual;
        const p = connectorPrimary(c);
        // The ledger's own state for a scan in flight (never an assumed success).
        const scanState = scans.find((s) => s.connectorId === c.id && (s.status === 'running' || s.status === 'queued')) ?? null;
        const busy = actions.scanning(c.id) || actions.reauthing(c.id);
        return (
          <div
            key={c.id}
            role="listitem"
            {...rowProps(c.id)}
            data-connector={c.id}
            data-state={c.state}
            data-selected={selected || undefined}
            aria-label={`${c.label}, ${connectorLine(c, now, tz)}`}
            onClick={() => onOpen(c)}
            className={cn(
              'relative grid cursor-pointer grid-cols-[3px_auto_minmax(0,1fr)] items-center gap-x-3 rounded-md px-3 py-2.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]',
              selected ? 'bg-selected' : 'hover:bg-surface-muted',
            )}
          >
            <span aria-hidden className={cn('row-span-2 h-full w-[3px] self-stretch rounded-full', EDGE_BG[ind])} />
            <Icon set={src.icon.set} name={src.icon.name} size="md" className="row-span-2 text-muted" />
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-body-lg font-bold text-fg-heading">{c.label}</span>
              <span className="ml-auto shrink-0">
                <RowVerb
                  action={{ label: p.label, onClick: () => (p.kind === 'reauth' ? actions.reauth.mutate(c) : actions.scan.mutate(c)), loading: busy, kbd: 'mod+enter' }}
                  filled={selected && panelId !== c.id}
                />
              </span>
            </div>
            <p className={cn('col-start-3 min-w-0 truncate text-caption tabular-nums', broken ? 'font-bold text-danger-700' : attention ? 'font-bold text-warning-700' : 'text-muted')} data-connector-line>
              {scanState ? `Scanning · ${SCAN_STATUS[scanState.status].label.toLowerCase()} · ${scanState.scope}` : connectorLine(c, now, tz)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
