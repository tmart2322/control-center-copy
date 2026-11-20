'use client';
/**
 * Set a needs row aside: the one mechanism every "needs you" row uses (src/contract/needs.ts). A row's `resolve` says
 * what it offers: Snooze (a week on Deals; "Not now" on Home, to the next working-day start) and/or Not needed with a
 * reason. Each choice is one decideNeed call (one audited change set; the toast has Undo), and the row leaves the
 * list at once (the Deals, account and Home queries drop it; the live topics refetch the server's rows).
 *
 *   useSetAside()        decide(resolve, choice) → the mutation, with the toast and the optimistic drop
 *   <SetAsideActions>    Snooze 1 week + Not needed… (reasons in a popover), for a row's secondary slot or a footer
 */
import { useState } from 'react';
import { SNOOZE_MS, type AccountDetail, type DealsPayload, type HomePayload, type NeedResolve } from '@/contract';
import { useOptimisticMutation } from '@/client/optimistic';
import { toast } from '@/client/toast';
import { Button, Popover } from '@/ui';

export type SetAsideChoice = { kind: 'snooze'; until?: string } | { kind: 'not_needed'; reason: string };

const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const sameRow = (a: NeedResolve | null | undefined, b: NeedResolve) => !!a && a.rule === b.rule && a.subjectIds.some((s) => b.subjectIds.includes(s));

/** The day a snooze ends, in words ("Wed 18 Nov"). */
export function snoozeWords(until: string): string {
  return new Date(until).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function useSetAside() {
  const m = useOptimisticMutation({
    route: 'decideNeed',
    topics: ['deals', 'home', 'today'],
    rebase: false,
    writeBack: false,
    optimistic: (input, cache) => {
      if (!input.body) return;
      const r = { rule: input.body.rule, subjectIds: input.body.subjectIds, snooze: true, reasons: [], baseline: {}, label: null } satisfies NeedResolve;
      cache.client.setQueriesData<DealsPayload>({ queryKey: ['deals', 'getDeals'] }, (old) => (old?.needs ? { ...old, needs: old.needs.filter((n) => !sameRow(n.resolve, r)) } : old));
      cache.client.setQueriesData<AccountDetail>({ queryKey: ['deals', 'getAccount'] }, (old) => (old?.needs ? { ...old, needs: old.needs.filter((n) => !sameRow(n.resolve, r)) } : old));
      cache.client.setQueriesData<HomePayload>({ queryKey: ['home', 'getHome'] }, (old) => (old ? { ...old, sections: old.sections.map((s) => ({ ...s, rows: s.rows.filter((x) => !sameRow(x.resolve, r)), count: Math.max(0, s.count - s.rows.filter((x) => sameRow(x.resolve, r)).length) })) } : old));
    },
    toast: (res, input) => {
      const d = res.entity.decisions[0];
      const b = input.body;
      const what = short(b?.label ?? d?.label ?? 'the row');
      const key = `need:${b?.rule}:${b?.subjectIds[0]}`;
      return d?.kind === 'snooze' ? { title: `Snoozed until ${snoozeWords(d.until!)}: ${what}`, key } : { title: `Not needed: ${what}`, body: d?.reason ?? undefined, key };
    },
    onError: (err) => toast({ title: "Couldn't set it aside", body: `${err.message}. It is back as it was.`, tone: 'error', durationMs: null, key: 'need-err' }),
  });
  const decide = (r: NeedResolve, c: SetAsideChoice) =>
    m.mutate({
      body: {
        rule: r.rule,
        subjectIds: r.subjectIds,
        kind: c.kind,
        ...(c.kind === 'snooze' ? { until: c.until ?? new Date(Date.now() + SNOOZE_MS).toISOString() } : { reason: c.reason }),
        ...(r.label ? { label: r.label.slice(0, 200) } : {}),
        ...(Object.keys(r.baseline ?? {}).length ? { baseline: r.baseline } : {}),
      },
    });
  return { decide, pending: m.isPending };
}

/** "Not needed…": pick a reason, then set the row aside (until something material changes, as the rule says). */
export function NotNeededButton({ resolve, onPick, size = 'sm', label = 'Not needed…', question = 'Why is this not needed?' }: { resolve: NeedResolve; onPick: (reason: string) => void; size?: 'sm' | 'md'; label?: string; question?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  if (!resolve.reasons.length) return null;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      width={340}
      label="Not needed, with a reason"
      trigger={
        <Button variant="quiet" size={size} data-testid="need-not-needed">
          {label}
        </Button>
      }
    >
      {({ close }) => (
        <div className="flex flex-col gap-3 p-4" data-testid="need-reasons">
          <p className="text-body font-bold text-fg-heading">{question}</p>
          <div role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-1.5">
            {resolve.reasons.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={reason === r ? 'h-8 rounded-md border border-accent bg-selected px-2.5 text-caption font-bold text-fg-heading' : 'h-8 rounded-md border border-line-strong bg-surface px-2.5 text-caption text-fg hover:bg-surface-muted'}
              >
                {r}
              </button>
            ))}
          </div>
          <p className="text-caption text-muted">{resolve.rule === 'dc_gap' ? 'It comes back if you join the opp team or log 2 h more on it. Undo is in the toast.' : 'Undo is in the toast.'}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!reason}
              onClick={() => {
                close();
                if (reason) onPick(reason);
                setReason(null);
              }}
            >
              Not needed
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Snooze 1 week and Not needed…, as the row's `resolve` offers them. Nothing leaves the app. */
export function SetAsideActions({ resolve, size = 'sm' }: { resolve: NeedResolve | null | undefined; size?: 'sm' | 'md' }) {
  const { decide, pending } = useSetAside();
  if (!resolve) return null;
  return (
    <>
      {resolve.snooze ? (
        <Button variant="quiet" size={size} disabled={pending} onClick={() => decide(resolve, { kind: 'snooze' })} data-testid="need-snooze">
          Snooze 1 week
        </Button>
      ) : null}
      <NotNeededButton resolve={resolve} size={size} onPick={(reason) => decide(resolve, { kind: 'not_needed', reason })} />
    </>
  );
}
