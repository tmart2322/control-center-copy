'use client';
/**
 * Scanner pulse (UI-SPEC §2): "Live · 40s" while scanners keep up, "Catching up · Slack 60%" after
 * downtime, "Reconnecting…" when the live channel drops. The header pulse is the only channel for
 * "a connector is behind" (UI-SPEC §9).
 */
import type { Connector } from '@/contract';
import { useLiveStatus } from '@/client/providers';
import { useNow } from '@/ui/clock';
import { cn } from '@/ui/cn';
import { Tooltip } from '@/ui/Tooltip';

export interface ScannerPulseProps {
  connectors?: Connector[];
  /** Server label fallback (today.scannerPulse). */
  fallback?: { label: string; state: string };
  className?: string;
}

/** Humanized age: 40 → "40s", 180 → "3m", 7200 → "2h", 200000 → "2d". Never a raw second count past a minute. */
export function ago(sec: number) {
  if (sec < 90) return `${Math.max(0, Math.round(sec))}s`;
  const m = Math.round(sec / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** The server's fallback label carries raw seconds ("Live · 2552s"); show it humanized ("Live · 43m"). */
export function humanizePulseLabel(label: string) {
  return label.replace(/(\d+)s\b/, (_, n: string) => ago(Number(n)));
}

export function pulseFor(connectors: Connector[] | undefined, now: Date, live: string): { label: string; tone: 'live' | 'catching' | 'stale' | 'off'; detail: string } {
  // A drop shorter than a few seconds never shows (src/client/live.ts); after that, a calm grey "Reconnecting…".
  // When the stream is back every view refetches once, so nothing stays stale.
  if (live === 'reconnecting' || live === 'closed') return { label: 'Reconnecting…', tone: 'off', detail: 'Live updates paused: the app is reconnecting. Everything refreshes when it is back.' };
  if (!connectors?.length) return { label: 'Starting…', tone: 'off', detail: 'Waiting for the first scan.' };
  const catching = connectors.filter((c) => c.state === 'catching_up');
  if (catching.length) {
    const first = catching[0]!;
    return {
      label: `Catching up · ${first.label} ${first.catchUpPct ?? 0}%`,
      tone: 'catching',
      detail: catching.map((c) => `${c.label} ${c.catchUpPct ?? 0}%`).join(' · '),
    };
  }
  const latest = connectors.map((c) => (c.lastSuccessAt ? Date.parse(c.lastSuccessAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
  const sec = latest ? Math.max(0, Math.round((now.getTime() - latest) / 1000)) : null;
  if (sec === null) return { label: 'Idle', tone: 'off', detail: 'No scans yet.' };
  return { label: `Live · ${ago(sec)}`, tone: sec > 600 ? 'stale' : 'live', detail: `Last scan ${ago(sec)} ago · ${connectors.filter((c) => c.state === 'ok').length}/${connectors.length} sources healthy` };
}

export function ScannerPulse({ connectors, fallback, className }: ScannerPulseProps) {
  const now = useNow(5_000);
  const live = useLiveStatus();
  const p = connectors ? pulseFor(connectors, now, live) : { label: humanizePulseLabel(fallback?.label ?? '…'), tone: 'off' as const, detail: '' };
  return (
    <Tooltip content={p.detail || null}>
      <span
        tabIndex={0}
        aria-live="polite"
        className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-caption whitespace-nowrap text-muted tabular-nums focus-visible:outline-none focus-visible:shadow-focus', className)}
      >
        {/* Calm by default: a static dot; only catching-up breathes (it's temporary). */}
        <span className="relative grid size-2 place-items-center" aria-hidden>
          {p.tone === 'catching' ? <span className="absolute inset-0 rounded-full bg-brand-500 opacity-50 motion-safe:animate-ping" style={{ animationDuration: '2.4s' }} /> : null}
          <span className={cn('relative size-2 rounded-full', p.tone === 'live' ? 'bg-success-500' : p.tone === 'catching' ? 'bg-brand-600' : p.tone === 'stale' ? 'bg-warning-500' : 'bg-ink-400')} />
        </span>
        {p.label}
      </span>
    </Tooltip>
  );
}
