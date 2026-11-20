'use client';
/**
 * Dev toolbar (dev builds only; mounted by app/layout.tsx when NODE_ENV=development).
 * Collapsible, bottom-right above the utility bar:
 * - scenario clock play / pause / reset / seek (POST /api/v1/dev/scenario);
 * - random failure rate for rollback testing (POST /api/v1/dev/fail);
 * - force every panel (or one) to empty / loading / error;
 * - density toggle.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { ScenarioStatus } from '@/contract';
import { api, queryKey } from '@/client/api';
import { useApi } from '@/client/hooks';
import { usePrefs } from '@/components/shell/prefs';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { forcePanelState, useForcedPanelStates, type ForcedPanelState } from '@/ui/panel-state';
import { SegmentedToggle } from '@/ui/Tabs';

const OPEN_KEY = 'cc:dev:toolbar-open';

function fmtT(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Section({ title, children, trailing }: { title: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="border-t border-line px-3 py-2.5 first:border-t-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="eyebrow">{title}</span>
        {trailing ? <span className="ml-auto">{trailing}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function DevToolbar() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const prefs = usePrefs();
  const forced = useForcedPanelStates();
  // Pushed on every step (the scenario topic); only the open toolbar's running clock ticks while it plays.
  const scenario = useApi('getScenario', undefined, { refetchInterval: (q) => (open && (q.state.data as ScenarioStatus | undefined)?.state === 'playing' ? 1000 : false) });
  const fail = useApi('getDevFail', undefined, { enabled: open });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const control = async (action: 'play' | 'pause' | 'reset' | 'seek', seconds?: number) => {
    setBusy(true);
    setErr(null);
    try {
      const s = await api('controlScenario', { body: { action, seconds } });
      qc.setQueryData(queryKey('getScenario'), s);
      void qc.invalidateQueries();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setRate = async (rate: number) => {
    setErr(null);
    try {
      const r = await api('setDevFail', { body: { rate } });
      qc.setQueryData(queryKey('getDevFail'), r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const s = scenario.data;
  const rate = fail.data?.rate ?? 0;
  const anyForced = forced.all !== null || Object.keys(forced.byId).length > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Open dev toolbar"
        className={cn(
          'absolute right-3 bottom-3 z-[75] inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-caption font-bold text-muted shadow-raise hover:text-fg focus-visible:outline-none focus-visible:shadow-focus',
          (rate > 0 || anyForced) && 'border-warning-200 bg-warning-50 text-warning-700',
        )}
      >
        <Icon name="bug" size="xs" />
        Dev
        {s ? <span className="font-normal tabular-nums">{s.state === 'playing' ? `▶ ${fmtT(s.t)}` : s.state === 'idle' ? '' : fmtT(s.t)}</span> : null}
        {rate > 0 ? <span className="font-normal">fail {Math.round(rate * 100)}%</span> : null}
        {anyForced ? <span className="font-normal">forced</span> : null}
      </button>
    );
  }

  return (
    <div role="region" aria-label="Dev toolbar" className="absolute right-3 bottom-3 z-[75] w-[22rem] rounded-lg border border-line bg-surface text-body shadow-pop">
      <div className="flex h-9 items-center gap-2 border-b border-line pr-1 pl-3">
        <Icon name="bug" size="sm" className="text-muted" />
        <span className="font-bold text-fg-heading">Dev toolbar</span>
        <span className="text-caption text-muted">mock data</span>
        <IconButton icon="minimize_window" label="Collapse dev toolbar" size="sm" className="ml-auto" onClick={toggle} />
      </div>

      <Section title="Scenario" trailing={s ? <span className="text-caption text-muted tabular-nums">{fmtT(s.t)} / {fmtT(s.durationSec)} · {s.state}</span> : null}>
        <div className="flex items-center gap-1">
          {s?.state === 'playing' ? (
            <IconButton icon="pause" label="Pause scenario" size="sm" variant="outline" onClick={() => void control('pause')} disabled={busy} />
          ) : (
            <IconButton icon="play" label="Play scenario" size="sm" variant="outline" onClick={() => void control('play')} disabled={busy} />
          )}
          <IconButton icon="refresh" label="Reset scenario" size="sm" onClick={() => void control('reset')} disabled={busy} />
          <input
            type="range"
            min={0}
            max={s?.durationSec ?? 180}
            step={5}
            value={Math.round(s?.t ?? 0)}
            onChange={(e) => void control('seek', Number(e.target.value))}
            aria-label="Seek scenario"
            className="ml-2 h-1 flex-1 accent-(--color-brand-600)"
          />
        </div>
        {s?.events.length ? (
          <ol className="cc-scroll mt-2 max-h-36 space-y-0.5 overflow-y-auto">
            {s.events.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => void control('seek', ev.at)}
                  title={ev.exercises}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-caption hover:bg-surface-muted"
                >
                  <span className="w-9 shrink-0 text-muted tabular-nums">+{ev.at}s</span>
                  <span className={cn('min-w-0 flex-1 truncate', ev.fired ? 'text-muted line-through decoration-ink-300' : 'text-fg')}>{ev.label}</span>
                  {ev.fired ? <Icon name="check" size="xs" className="text-success-600" /> : null}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </Section>

      <Section title="Failures">
        <SegmentedToggle
          size="xs"
          block
          label="Failure rate"
          value={String(rate)}
          onChange={(v) => void setRate(Number(v))}
          options={[
            { value: '0', label: 'Off' },
            { value: '0.2', label: '20%' },
            { value: '0.5', label: '50%' },
            { value: '1', label: 'All' },
          ]}
        />
        <p className="mt-1 text-caption text-muted">
          Random 503s on every API call. One request can add <code className="whitespace-nowrap">?fail=1</code>.
        </p>
      </Section>

      <Section title="Panel state">
        <SegmentedToggle
          size="xs"
          block
          label="Force panel state"
          value={forced.all ?? 'auto'}
          onChange={(v) => forcePanelState(v === 'auto' ? null : (v as ForcedPanelState))}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'empty', label: 'Empty' },
            { value: 'loading', label: 'Loading' },
            { value: 'error', label: 'Error' },
          ]}
        />
        {Object.keys(forced.byId).length ? (
          <p className="mt-1 text-caption text-muted">
            Per panel: {Object.entries(forced.byId).map(([k, v]) => `${k}=${v}`).join(', ')}{' '}
            <button type="button" className="font-bold text-link" onClick={() => Object.keys(forced.byId).forEach((k) => forcePanelState(null, k))}>
              Clear
            </button>
          </p>
        ) : null}
      </Section>

      <Section title="Density">
        <SegmentedToggle
          size="xs"
          block
          label="Density"
          value={prefs.density}
          onChange={(density) => prefs.set({ density })}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
        />
      </Section>
      {err ? <p className="border-t border-line px-3 py-2 text-caption text-danger-700">{err}</p> : null}
    </div>
  );
}
