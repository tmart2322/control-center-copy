'use client';
/**
 * W0 placeholder page body: fetches a route's payload through the typed client and prints a summary.
 * Proves the wiring end to end (contract → route → mock DataSource → client → live invalidation).
 * FE lanes replace every page that uses it.
 */
import type { JsonRouteKey } from '@/contract';
import { useApi } from './hooks';

function summarize(value: unknown, depth = 0): string[] {
  if (value === null || typeof value !== 'object') return [JSON.stringify(value)];
  const lines: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const first = v[0] as Record<string, unknown> | undefined;
      const label = first && typeof first === 'object' ? String(first.title ?? first.label ?? first.name ?? (first.item as { title?: string } | undefined)?.title ?? first.id ?? '') : '';
      lines.push(`${'  '.repeat(depth)}${k}: [${v.length}]${label ? `  first: ${label}` : ''}`);
    } else if (v && typeof v === 'object') {
      if (depth < 1) {
        lines.push(`${'  '.repeat(depth)}${k}:`);
        lines.push(...summarize(v, depth + 1));
      } else lines.push(`${'  '.repeat(depth)}${k}: {${Object.keys(v).length} keys}`);
    } else {
      const s = JSON.stringify(v);
      lines.push(`${'  '.repeat(depth)}${k}: ${s && s.length > 90 ? `${s.slice(0, 87)}…` : s}`);
    }
  }
  return lines;
}

export function Placeholder({ title, route, input }: { title: string; route: JsonRouteKey; input?: Record<string, unknown> }) {
  const q = useApi(route, input as never);
  return (
    <main className="p-6 text-sm text-fg">
      <h1 className="mb-1 text-lg font-semibold">{title}</h1>
      <p className="mb-4 font-mono text-xs text-neutral-500">
        W0 placeholder · {route} · {q.isFetching ? 'fetching…' : q.isError ? 'error' : 'ok'}
      </p>
      {q.isError ? (
        <pre data-testid="placeholder-error" className="rounded border border-red-300 bg-red-50 p-3 font-mono text-xs text-red-800">
          {q.error.code}: {q.error.message}
        </pre>
      ) : q.data ? (
        <pre data-testid="placeholder-summary" className="overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-5">
          {summarize(q.data).join('\n')}
        </pre>
      ) : (
        <p className="text-neutral-500">Loading…</p>
      )}
    </main>
  );
}
