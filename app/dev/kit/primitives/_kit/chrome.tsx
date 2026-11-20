'use client';
/** Kit: chrome pieces in each state (the live chrome frames this page at full width). */
import { useEffect, useState } from 'react';
import type { Connector, HealthPayload } from '@/contract';
import { BudgetChip, HealthButton, LogoTile } from '@/components/shell/GlobalHeader';
import { NAV_TABS } from '@/components/shell/nav';
import { NavTab } from '@/components/shell/NavBar';
import { AssistantTile } from '@/components/shell/RightRail';
import { pulseFor } from '@/components/shell/ScannerPulse';
import { UtilityItem } from '@/components/shell/UtilityPanel';
import { DryRunChip } from '@/components/shell/UtilityBar';
import { KbdHint } from '@/ui';
import { Cell, KitSection, Specimen } from './frame';

function conn(id: string, label: string, state: Connector['state'], extra: Partial<Connector> = {}, now = Date.now()): Connector {
  return {
    id,
    label,
    source: 'slack',
    state,
    since: new Date(now - 3600_000).toISOString(),
    lastSuccessAt: new Date(now - 40_000).toISOString(),
    cursor: { label: `${label} through 10:41`, at: null },
    backlog: 0,
    itemsToday: 0,
    catchUpPct: null,
    lastError: null,
    impact: null,
    reauth: null,
    affects: [],
    ...extra,
  };
}

function health(ok: number, total: number, worst: Connector['state'], broken: HealthPayload['summary']['broken'] = []): HealthPayload {
  return {
    connectors: [],
    summary: { ok, total, worst, broken },
    spend: { today: { usd: 4.2, softBudgetUsd: 5, hardCapUsd: 15, pct: 84 }, state: 'soft_alert', last7d: [], byScanner: [], byModel: [] },
    worker: { alive: true, lastHeartbeatAt: null, queueDepth: 0 },
    dryRun: true,
    firstScan: null,
  };
}

export function ChromeSection() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const pulses = now
    ? [
        pulseFor([conn('slack', 'Slack', 'ok', {}, now), conn('gmail', 'Gmail', 'ok', {}, now)], new Date(now), 'open'),
        pulseFor([conn('slack', 'Slack', 'catching_up', { catchUpPct: 60 }, now), conn('gmail', 'Gmail', 'ok', {}, now)], new Date(now), 'open'),
        pulseFor([conn('slack', 'Slack', 'ok', { lastSuccessAt: new Date(now - 1200_000).toISOString() }, now)], new Date(now), 'open'),
        pulseFor([], new Date(now), 'closed'),
      ]
    : [];
  return (
    <KitSection id="chrome" eyebrow="Chrome" title="Header, nav and utility bar pieces" intro="Global header 44 · nav bar 36 with a 3 px indicator · utility bar 32. The live chrome frames this page.">
      <Specimen label="Logo · assistant tile" note="the gradient budget: logo, assistant, ≤ 1 glow">
        <LogoTile />
        <AssistantTile />
        <AssistantTile size="sm" />
      </Specimen>
      <Specimen label="Nav tabs" note="rest · active · counts (brand = act, neutral = read)">
        <div className="flex h-9 items-stretch rounded-md border border-line bg-surface">
          <NavTab tab={NAV_TABS[0]!} active />
          <NavTab tab={NAV_TABS[1]!} active={false} count={4} />
          <NavTab tab={NAV_TABS[2]!} active={false} />
          <NavTab tab={NAV_TABS[3]!} active={false} count={3} />
          <NavTab tab={NAV_TABS[5]!} active={false} count={1} />
          <NavTab tab={NAV_TABS[7]!} active={false} count={2} />
        </div>
      </Specimen>
      <Specimen label="Health" note="8/8 calm · one broken is loud">
        <HealthButton health={health(8, 8, 'ok')} />
        <HealthButton health={health(7, 8, 'catching_up')} />
        <HealthButton health={health(7, 8, 'auth_needed', [{ id: 'gmail', label: 'Gmail', state: 'auth_needed' }])} />
        <BudgetChip spend={health(8, 8, 'ok').spend} />
        <BudgetChip spend={{ ...health(8, 8, 'ok').spend, state: 'capped', today: { usd: 15, softBudgetUsd: 5, hardCapUsd: 15, pct: 300 } }} />
      </Specimen>
      <Specimen label="Scanner pulse">
        {pulses.map((p) => (
          <Cell key={p.label} label={p.tone}>
            <span className="inline-flex h-7 items-center gap-1.5 text-caption text-muted tabular-nums">
              <span className={p.tone === 'live' ? 'size-2 rounded-full bg-success-500' : p.tone === 'catching' ? 'size-2 rounded-full bg-brand-600' : p.tone === 'stale' ? 'size-2 rounded-full bg-warning-500' : 'size-2 rounded-full bg-ink-400'} />
              {p.label}
            </span>
          </Cell>
        ))}
      </Specimen>
      <Specimen label="Utility items" note="Dry run is quiet; Live send is the loud one">
        <div className="flex h-8 items-stretch overflow-hidden rounded-md border border-line bg-surface">
          <UtilityItem icon="record_create">
            Capture <KbdHint combo="c" tone="quiet" />
          </UtilityItem>
          <UtilityItem icon="recent" dot>
            Since you left
          </UtilityItem>
          <DryRunChip dryRun />
          <DryRunChip dryRun={false} />
          <UtilityItem icon="money">
            $0.42 <span className="font-normal text-faint">/ $5</span>
          </UtilityItem>
          <UtilityItem icon="money" tone="loud">
            $4.20 <span className="font-normal">/ $5</span>
          </UtilityItem>
        </div>
      </Specimen>
    </KitSection>
  );
}
