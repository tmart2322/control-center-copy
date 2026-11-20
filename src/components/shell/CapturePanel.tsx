'use client';
/**
 * Quick capture (UI-SPEC §13, R-UI-9) as a utility panel. Enter saves instantly: the line clears
 * at once, the row shows its own status, and enrichment arrives later on the item. Todoist-style
 * tokens are passed through (#account @person ~30m).
 */
import { AppLink } from './AppLink';
import { useRef, useState } from 'react';
import type { WorkItem } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { captureStatus } from '@/components/detail/lib/enrichment-state';
import { useNow, useTimeZone } from '@/ui/clock';
import { captureLanding } from './capture-landing';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { KbdHint } from '@/ui/Kbd';
import { InlineStatus } from '@/ui/states';

interface Captured {
  key: number;
  text: string;
  state: 'saving' | 'saved' | 'error';
  item?: WorkItem;
  error?: string;
}

/**
 * A saved row's status, read live from the item: "Enriching…" (AI) while it looks, then what it found, else "Added".
 * The db DataSource has no enrich worker yet, so past the wait (ENRICH_WAIT_MS) the row stops saying it is looking.
 */
function CapturedStatus({ item }: { item: WorkItem }) {
  const live = useApi('getItem', { params: { id: item.id } });
  const nowMs = useNow(5_000).getTime();
  const s = captureStatus(live.data?.item ?? item, nowMs);
  return s.looking ? (
    <span className="inline-flex items-center gap-1 text-caption text-ai-700" data-capture-status="enriching">
      <Icon name="sparkles" size="xs" /> {s.text}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-caption text-muted" data-capture-status="added">
      <Icon name="check" size="xs" /> {s.text}
    </span>
  );
}

export function CaptureBody({ close }: { close: () => void }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Captured[]>([]);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tz = useTimeZone();
  const tzRef = useRef(tz);
  tzRef.current = tz;
  const capture = useOptimisticMutation({
    route: 'captureItem',
    topics: ['items', 'today'],
    // 2026-11-13 audit C8: where it landed (Today, Think ahead, or Work ▸ All open), never always "Today"
    toast: (res) => ({ title: `Captured: ${res.entity.title}`, body: captureLanding(res.entity, new Date().toISOString(), tzRef.current), action: { label: 'Open', href: `/work/${res.entity.id}` } }),
  });

  const submit = (value: string, key?: number) => {
    const t = value.trim();
    if (!t) return;
    const k = key ?? ++seq.current;
    setRows((prev) => [{ key: k, text: t, state: 'saving' as const }, ...prev.filter((r) => r.key !== k)].slice(0, 5));
    capture
      .mutateAsync({ body: { text: t } })
      .then((res) => setRows((prev) => prev.map((r) => (r.key === k ? { ...r, state: 'saved', item: res.entity } : r))))
      .catch((err: Error) => setRows((prev) => prev.map((r) => (r.key === k ? { ...r, state: 'error', error: err.message } : r))));
  };

  return (
    <div className="p-4">
      <label htmlFor="cc-capture" className="sr-only">
        Capture a to-do
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-line-input bg-surface px-3 py-2 focus-within:border-brand-600 focus-within:shadow-[0_0_0_1px_var(--color-brand-600)]">
        <Icon name="record_create" size="md" className="text-muted" />
        <input
          ref={inputRef}
          id="cc-capture"
          data-autofocus
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(text);
              setText('');
            } else if (e.key === 'Escape' && !text) {
              e.preventDefault();
              close();
            }
          }}
          placeholder="Follow up with the customer on next steps by Friday"
          className="min-w-0 flex-1 bg-transparent text-body-lg text-fg outline-none placeholder:text-faint"
        />
        <KbdHint combo="enter" />
      </div>
      <p className="mt-2 text-caption text-muted">
        Saves on Enter. Related work (sessions, docs, threads) attaches as suggestions. Tokens: <span className="font-mono">#account</span> <span className="font-mono">@person</span>{' '}
        <span className="font-mono">~30m</span>
      </p>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {rows.map((r) => (
            <li key={r.key} className={cn('flex min-h-9 items-center gap-2 px-3 py-1.5 text-body', r.state === 'error' && 'bg-danger-50')}>
              <span className="min-w-0 flex-1 truncate">
                {r.item ? (
                  <AppLink href={`/work/${r.item.id}`} onClick={close} className="text-fg">
                    {r.item.title}
                  </AppLink>
                ) : (
                  r.text
                )}
              </span>
              {r.state === 'saved' && r.item ? (
                <CapturedStatus item={r.item} />
              ) : (
                <InlineStatus state={r.state} error={r.error} onRetry={() => submit(r.text, r.key)} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
