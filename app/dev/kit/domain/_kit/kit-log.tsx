'use client';
/**
 * Kit-only callback log: every domain-component callback the gallery wires lands here, so you can see that
 * each action fires (and with what). Dev aid; never shipped in product pages.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Portal } from '@/ui';

type Entry = { id: number; name: string; detail: string };
type Log = (name: string, ...args: unknown[]) => void;
const Ctx = createContext<Log>(() => {});

function summarize(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (typeof v !== 'object') return String(v);
  const o = v as Record<string, unknown>;
  if (o.item && typeof o.kind === 'string') return `${o.kind} · ${(o.item as { title?: string }).title ?? ''}${o.url ? ` · ${o.url}` : ''}${o.answer ? ` · “${o.answer}”` : ''}`;
  for (const k of ['title', 'label', 'summary', 'name', 'resolution', 'id']) if (typeof o[k] === 'string') return summarize(o[k]);
  return Object.keys(o).slice(0, 3).join(',');
}

export function KitLogProvider({ children, quiet }: { children: ReactNode; /** Render the panel only once something fires. */ quiet?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const log = useCallback<Log>((name, ...args) => {
    setEntries((e) => [{ id: Date.now() + Math.random(), name, detail: args.map(summarize).join(' · ') }, ...e].slice(0, 12));
    setOpen(true);
  }, []);
  const value = useMemo(() => log, [log]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Portal>
        <div className={`fixed bottom-4 right-4 z-[80] w-[24rem] rounded-lg border border-line bg-surface-overlay shadow-pop ${quiet && !entries.length ? 'hidden' : ''}`} data-kit-log>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-8 w-full items-center gap-2 px-3 text-left">
          <span className="text-caption font-bold text-fg-heading">Callbacks</span>
          <span className="text-caption text-muted tabular-nums">{entries.length ? `${entries.length} fired` : 'none yet: try a button or key'}</span>
          {entries.length ? (
            <span
              role="button"
              tabIndex={0}
              className="ml-auto text-caption text-link hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setEntries([]);
              }}
              onKeyDown={(e) => e.key === 'Enter' && setEntries([])}
            >
              Clear
            </span>
          ) : null}
        </button>
        {open && entries.length ? (
          <ol className="max-h-56 overflow-y-auto border-t border-line py-1">
            {entries.map((e) => (
              <li key={e.id} className="px-3 py-0.5 font-mono text-micro text-fg">
                <span className="font-bold text-link">{e.name}</span> <span className="text-muted">{e.detail}</span>
              </li>
            ))}
          </ol>
        ) : null}
        </div>
      </Portal>
    </Ctx.Provider>
  );
}

export function useKitLog() {
  const log = useContext(Ctx);
  /** cb('onPrimary') → a handler that logs its arguments. */
  return useCallback((name: string) => (...args: unknown[]) => log(name, ...args), [log]);
}
