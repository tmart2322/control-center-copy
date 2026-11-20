'use client';
/**
 * Deals ▸ Missed opportunities (R-UI-14, design v2): a "Log & fix" kind of gap. Opps that look like yours with no
 * DC from you, in two verb sections: Claim (clearly yours) and Check (look first). Every row has one clear verb
 * (Claim, quiet until the row is selected); Dismiss and the evidence sit on hover or selection; each section
 * header carries the batch action (select rows with x or the checkbox, then "Claim N selected").
 *
 * Claim (one Claim verb, D-58) opens the Claim form (split, role, what you did; your role's DC role by default) and
 * adds a DC request: it goes on your next logging canvas, and Deals ▸ DCs lists it; nothing is sent. Only when the app
 * doesn't know the opp is it a task with the Slackbot "DC Comment Upload" prompt draft instead.
 * Claim and Dismiss are optimistic with Undo (auditId); a failure rolls back with an inline toast. Rows you act on
 * stay in place (nothing moves under the cursor); rows that arrive later append below with an "n new" marker.
 * Click or Enter opens the opp in the docked panel; `?account=` narrows the list to one account.
 *
 * Personas (D-55): the page exists only while the persona has the missed-opp sweep. Without it (only a direct link
 * lands here: the tab, links and commands are hidden) it says the sweep is available, not in the role's
 * preconfiguration, with a link to Settings ▸ Role & rules; nothing reads the sweep.
 */
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MissedOpp, MissedPayload } from '@/contract';
import { api, queryKey } from '@/client/api';
import { useApi } from '@/client/hooks';
import { useCommands, type Command } from '@/client/keyboard';
import { useOptimisticMutation, type OptimisticCache } from '@/client/optimistic';
import { useResumeExtra, useResumeSelection } from '@/client/resume/hooks';
import { toast } from '@/client/toast';
import { useChatContext } from '@/components/chat';
import { StatusBadge } from '@/components/domain';
import { Button, cn, EmptyState, Icon, PanelBoundary, PanelError, Popover, SegmentedToggle, usePanelState } from '@/ui';
import { FeatureInactive } from '@/components/shell/FeatureInactive';
import { ContextHead, ContextPage, ContextRow, Pane, SectionHead, useContextKeys, useDetails, useMainWidth, type Edge } from './context-frame';
import { EvidenceChips, NotesBlock, PromptDraft } from './missed-parts';
import { ClaimDcDialog, type ClaimValues } from './ClaimDc';
import { claimedToast, claimTargetOf } from './panels';
import { DealsTabs } from './DealsHeader';
import { MissedBodySkeleton, MissedSkeleton } from './DealsSkeleton';
import { useContextPanels } from './register-panels';
import { fmtAmount, fmtDate } from './format';
import { useDealsFeatures, useMissedSweep, useToday } from './hooks';
import { AMOUNT_STEPS, DEFAULT_FILTERS, DISMISS_REASONS, filterMissed, missedNotes, type MissedFilters, type MissedNotes } from './missed';
import { accountKey } from './needs';
import { missedDeepLink } from './links';
import { navigate } from '@/components/shell/router';

const SCOPE = 'page:missed';

/**
 * Missed opps carry no `version`, so the generic entity patch (which needs one) can't find them: patch the sweep
 * payload directly. It sits under the snapshotted `deals` topic, so a failure still rolls back.
 */
function patchMissed(cache: OptimisticCache, id: string, patch: Partial<MissedOpp>) {
  cache.setQuery<MissedPayload>(queryKey('getMissed'), (old) => (old ? { ...old, missed: old.missed.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : old));
}

// ── Small pieces ────────────────────────────────────────────────────────────────────────────

// ── Dismiss with a reason ───────────────────────────────────────────────────────────────────

function DismissForm({ count = 1, onSubmit, onCancel }: { count?: number; onSubmit: (reason: string, note: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) onSubmit(reason, note.trim());
      }}
    >
      <p className="text-body font-bold text-fg-heading">{count > 1 ? `Dismiss ${count} opps: why aren't they yours?` : "Dismiss: why isn't this yours?"}</p>
      <div role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-1.5">
        {DISMISS_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-caption focus-visible:outline-none focus-visible:shadow-focus',
              reason === r ? 'border-accent bg-selected font-bold text-fg-heading' : 'border-line-strong bg-surface text-fg hover:bg-surface-muted',
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        aria-label="Note"
        className="h-9 rounded-md border border-line-input bg-surface-input px-2.5 text-body text-fg placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-caption text-muted">{reason ? 'You can undo this.' : 'Pick a reason.'}</span>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!reason}>
          {count > 1 ? `Dismiss ${count}` : 'Dismiss'}
        </Button>
      </div>
    </form>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────────────────────

interface RowCtx {
  today: string;
  selected: string | null;
  /** The #1 row (first Claim row still to review): its verb is filled while nothing is selected. */
  firstId: string | null;
  openId: string | null;
  picked: Set<string>;
  expanded: Set<string>;
  newIds: Set<string>;
  dismissOpenId: string | null;
  canUndo: (id: string) => boolean;
  onSelect: (m: MissedOpp) => void;
  onPick: (m: MissedOpp) => void;
  onClaim: (m: MissedOpp) => void;
  onDismiss: (m: MissedOpp, reason: string, note: string) => void;
  onUndo: (m: MissedOpp) => void;
  onOpenTask: (m: MissedOpp) => void;
  onToggle: (id: string) => void;
  setDismissOpenId: (id: string | null) => void;
}

function edgeOf(m: MissedOpp, notes: MissedNotes): Edge {
  if (m.status === 'claimed') return 'success';
  if (m.status !== 'new') return 'none';
  if (notes.lock) return 'danger';
  if (notes.lockSoon || notes.stranded) return 'warning';
  return 'none';
}

function MissedRow({ m, c }: { m: MissedOpp; c: RowCtx }) {
  const notes = missedNotes(m, c.today);
  const isNew = m.status === 'new';
  const expanded = c.expanded.has(m.id);
  const selected = c.selected === m.id;
  const edge = edgeOf(m, notes);
  const badge =
    m.status === 'claimed' ? (
      <StatusBadge tone="success" icon="check">
        Claimed
      </StatusBadge>
    ) : m.status === 'dismissed' ? (
      <StatusBadge tone="neutral">Dismissed</StatusBadge>
    ) : edge === 'danger' ? (
      <StatusBadge tone="danger" icon="lock">
        Locked
      </StatusBadge>
    ) : notes.lockSoon ? (
      <StatusBadge tone="warning" icon="clock">
        Locks soon
      </StatusBadge>
    ) : notes.stranded ? (
      <StatusBadge tone="warning" icon="warning">
        Stranded DC
      </StatusBadge>
    ) : null;
  const verb = isNew
    ? { label: 'Claim', kbd: 'a', onClick: () => c.onClaim(m) }
    : m.status === 'claimed' && m.claimedWorkItemId
      ? { label: 'Open task', onClick: () => c.onOpenTask(m) }
      : c.canUndo(m.id)
        ? { label: 'Undo', icon: 'undo', onClick: () => c.onUndo(m) }
        : undefined;
  return (
    <ContextRow
      rowId={m.id}
      aria-label={`${m.verdict === 'claim' ? 'Claim' : 'Check'}: ${m.oppName}`}
      title={
        <span className="inline-flex max-w-full min-w-0 items-baseline gap-2">
          <span className={cn('truncate', m.status === 'dismissed' && 'text-muted line-through decoration-line-strong')} title={m.oppName}>
            {m.oppName}
          </span>
          {c.newIds.has(m.id) ? <span className="shrink-0 text-caption font-normal text-link">New</span> : null}
        </span>
      }
      meta={
        <>
          <span className="text-body text-fg">{fmtAmount(m.amount)}</span>
          <span className={notes.lock && isNew ? 'text-danger-700' : undefined}>{fmtDate(m.closeDate)}</span>
        </>
      }
      why={
        <>
          <span className="text-fg">{m.accountName}</span>
          {` · ${m.stage.replace(/^\d+\s*-\s*/, '')}`}
          {m.status === 'dismissed' && m.dismissReason ? ` · ${m.dismissReason}` : m.evidence[0] ? ` · ${m.evidence[0]}` : ''}
        </>
      }
      badge={badge}
      edge={edge}
      selected={selected}
      emphasized={!c.selected && c.firstId === m.id}
      inPanel={c.openId === m.id && selected}
      dimmed={m.status === 'dismissed'}
      lead={
        isNew ? (
          <input
            type="checkbox"
            checked={c.picked.has(m.id)}
            onChange={() => c.onPick(m)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${m.oppName}`}
            className="mt-1 size-4 cursor-pointer accent-[var(--color-accent)]"
          />
        ) : (
          <span className="block size-4" />
        )
      }
      verb={verb}
      secondary={
        <>
          <Button size="xs" variant="quiet" onClick={() => c.onToggle(m.id)} aria-expanded={expanded}>
            {expanded ? 'Less' : `Evidence ${m.evidence.length}`}
          </Button>
          {isNew ? (
            <Popover
              open={c.dismissOpenId === m.id}
              onOpenChange={(o) => c.setDismissOpenId(o ? m.id : null)}
              placement="bottom-end"
              width={380}
              label="Dismiss with a reason"
              trigger={
                <Button size="xs" variant="quiet" aria-label={`Dismiss ${m.oppName}`}>
                  Dismiss…
                </Button>
              }
            >
              {({ close }) => (
                <DismissForm
                  onCancel={close}
                  onSubmit={(reason, note) => {
                    close();
                    c.onDismiss(m, reason, note);
                  }}
                />
              )}
            </Popover>
          ) : m.status === 'claimed' && c.canUndo(m.id) ? (
            <Button size="xs" variant="quiet" icon="undo" onClick={() => c.onUndo(m)}>
              Undo
            </Button>
          ) : null}
        </>
      }
      below={
        <>
          {expanded ? <EvidenceChips evidence={m.evidence} /> : null}
          {isNew || expanded ? <NotesBlock notes={notes} /> : null}
          {m.otherDcs.length && expanded ? <p className="mt-1 text-caption text-muted">Other DCs: {m.otherDcs.join(', ')}</p> : null}
          {m.status === 'claimed' && m.claimedWorkItemId ? <PromptDraft m={m} /> : null}
        </>
      }
      onClick={() => c.onSelect(m)}
    />
  );
}

// ── Section ─────────────────────────────────────────────────────────────────────────────────

function VerdictSection({
  verdict,
  rows,
  c,
  onClaimMany,
  onDismissMany,
  onPickAll,
  batchDismissOpen,
  setBatchDismissOpen,
  className,
}: {
  verdict: 'claim' | 'check';
  rows: MissedOpp[];
  c: RowCtx;
  onClaimMany: (ms: MissedOpp[]) => void;
  onDismissMany: (ms: MissedOpp[], reason: string, note: string) => void;
  onPickAll: (ms: MissedOpp[], on: boolean) => void;
  batchDismissOpen: string | null;
  setBatchDismissOpen: (v: string | null) => void;
  className?: string;
}) {
  const open = rows.filter((m) => m.status === 'new');
  const picked = open.filter((m) => c.picked.has(m.id));
  const title = verdict === 'claim' ? 'Claim' : 'Check first';
  const sub = verdict === 'claim' ? 'clearly yours, no DC' : 'ambiguous: look before claiming';
  return (
    <Pane
      as="section"
      aria-label={title}
      className={className}
      head={
        <SectionHead
          title={title}
          count={open.length}
          sub={sub}
          action={
            picked.length ? (
              <>
                <Button size="xs" variant="quiet" onClick={() => onClaimMany(picked)} data-testid={`batch-claim-${verdict}`}>
                  Claim {picked.length} selected
                </Button>
                <Popover
                  open={batchDismissOpen === verdict}
                  onOpenChange={(o) => setBatchDismissOpen(o ? verdict : null)}
                  placement="bottom-end"
                  width={380}
                  label="Dismiss the selected opps"
                  trigger={
                    <Button size="xs" variant="quiet">
                      Dismiss {picked.length}…
                    </Button>
                  }
                >
                  {({ close }) => (
                    <DismissForm
                      count={picked.length}
                      onCancel={close}
                      onSubmit={(reason, note) => {
                        close();
                        onDismissMany(picked, reason, note);
                      }}
                    />
                  )}
                </Popover>
                <Button size="xs" variant="quiet" onClick={() => onPickAll(open, false)}>
                  Clear
                </Button>
              </>
            ) : open.length > 1 ? (
              <Button size="xs" variant="quiet" onClick={() => onPickAll(open, true)}>
                Select all {open.length}
              </Button>
            ) : undefined
          }
        />
      }
      bodyClassName="pb-3"
    >
      {rows.length ? (
        <div role="list" aria-label={title}>
          {rows.map((m) => (
            <MissedRow key={m.id} m={m} c={c} />
          ))}
        </div>
      ) : (
        <p className="px-5 py-3 text-body text-muted">Nothing to {verdict === 'claim' ? 'claim' : 'check'} with these filters.</p>
      )}
    </Pane>
  );
}

// ── View ────────────────────────────────────────────────────────────────────────────────────

export function MissedView() {
  const f = useDealsFeatures();
  const { ready, missed } = f;
  // Start the sweep's read with the page, as before personas (MissedSweep reads the same query once it mounts).
  useMissedSweep(f);
  // While the persona loads: the route's own skeleton (what the pending navigation showed a moment ago).
  if (!ready) return <MissedSkeleton />;
  if (!missed) return <MissedInactive />;
  return <MissedSweep />;
}

function MissedInactive() {
  useContextPanels();
  return (
    <ContextPage label="Missed opportunities">
      <ContextHead title="Missed opportunities" tabs={<DealsTabs tab="missed" />} />
      <FeatureInactive feature="missedOpps" icon="opportunity" />
    </ContextPage>
  );
}

function MissedSweep() {
  useContextPanels();
  const today = useToday();
  const pathname = usePathname();
  const sp = useSearchParams();
  const account = sp.get('account')?.trim().toLowerCase() || null;
  const missed = useApi('getMissed');
  const deals = useApi('getDeals');
  const mainW = useMainWidth();
  const { open: openDetails, openId } = useDetails();
  const [filters, setFilters] = useResumeExtra<MissedFilters>('missed-filters', DEFAULT_FILTERS);
  const [selected, setSelected] = useResumeSelection('missed');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dismissOpenId, setDismissOpenId] = useState<string | null>(null);
  const [batchDismissOpen, setBatchDismissOpen] = useState<string | null>(null);
  const [touched, setTouched] = useState<Map<string, string | null>>(new Map()); // id → auditId (undo)
  const orderRef = useRef<string[]>([]);
  const keepRef = useRef<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const all = useMemo(() => missed.data?.missed ?? [], [missed.data]);

  // Stable order: first-seen order; rows that arrive later append below with a "n new" marker.
  useEffect(() => {
    if (!missed.data) return;
    const known = new Set(orderRef.current);
    for (const m of all) if (!known.has(m.id)) orderRef.current.push(m.id);
    // Rows still to review when first seen stay in place for the session, whoever acts on them (this list, the
    // docked panel's Claim, another tab): nothing moves under the cursor.
    for (const m of all) if (m.status === 'new') keepRef.current.add(m.id);
    setSeen((s) => s ?? new Set(all.map((m) => m.id)));
  }, [missed.data, all]);

  const filtered = useMemo(() => {
    const touchedIds = new Set([...touched.keys(), ...keepRef.current]);
    const rows = filterMissed(all, filters, touchedIds).filter((m) => !account || accountKey(m.accountName) === account || m.accountName.toLowerCase().includes(account));
    const idx = new Map(orderRef.current.map((id, i) => [id, i] as const));
    return rows.slice().sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9));
    // orderRef is intentionally read at render: it only ever appends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filters, touched, missed.data, account]);

  const claimRows = useMemo(() => filtered.filter((m) => m.verdict === 'claim'), [filtered]);
  const checkRows = useMemo(() => filtered.filter((m) => m.verdict === 'check'), [filtered]);
  const newIds = useMemo(() => new Set(seen ? filtered.filter((m) => !seen.has(m.id)).map((m) => m.id) : []), [filtered, seen]);
  const ids = useMemo(() => [...claimRows, ...checkRows].map((m) => m.id), [claimRows, checkRows]);
  const byId = useMemo(() => new Map(all.map((m) => [m.id, m] as const)), [all]);
  const state = usePanelState('deals.missed', { loading: missed.isLoading, error: missed.data ? null : missed.error, empty: false });
  const active = selected && ids.includes(selected) ? selected : null;
  const activeRow = active ? byId.get(active) : undefined;
  useChatContext(activeRow ? { kind: 'missed_opp', id: activeRow.id, label: activeRow.oppName } : null);

  // ── Mutations ──
  const forget = (id: string) =>
    setTouched((t) => {
      const n = new Map(t);
      n.delete(id);
      return n;
    });
  const claimCfg = {
    route: 'claimMissed' as const,
    topics: ['deals', 'today', 'work', 'time'],
    rebase: false as const,
    optimistic: (input: { params: { id: string } }, cache: OptimisticCache) => patchMissed(cache, input.params.id, { status: 'claimed' }),
    onSuccess: (res: { entity: MissedOpp; auditId: string | null }) => setTouched((t) => new Map(t).set(res.entity.id, res.auditId)),
  };
  const claim = useOptimisticMutation({
    ...claimCfg,
    onSuccess: (res, input) => {
      claimCfg.onSuccess(res);
      claimedToast(res.entity, res.auditId ?? null, input.body?.split ?? 100);
    },
    onError: (err, input) => {
      forget(input.params.id);
      toast({ title: "Couldn't claim", body: `${err.message}. The row is back as it was.`, tone: 'error', durationMs: null, key: `claim-err:${input.params.id}` });
    },
  });
  const claimQuiet = useOptimisticMutation({ ...claimCfg, onError: (_e, input) => forget(input.params.id) });
  const dismissCfg = {
    route: 'dismissMissed' as const,
    topics: ['deals', 'today'],
    rebase: false as const,
    optimistic: (input: { params: { id: string }; body?: { reason: string; note?: string } }, cache: OptimisticCache) =>
      patchMissed(cache, input.params.id, { status: 'dismissed', dismissReason: input.body?.note ? `${input.body?.reason}: ${input.body?.note}` : (input.body?.reason ?? null) }),
    onSuccess: (res: { entity: MissedOpp; auditId: string | null }) => setTouched((t) => new Map(t).set(res.entity.id, res.auditId)),
  };
  const dismiss = useOptimisticMutation({
    ...dismissCfg,
    toast: (res) => ({ title: `Dismissed ${res.entity.oppName}`, body: res.entity.dismissReason ?? undefined, key: `dismiss:${res.entity.id}` }),
    onError: (err, input) => {
      forget(input.params.id);
      toast({ title: "Couldn't dismiss", body: `${err.message}. The row is back as it was.`, tone: 'error', durationMs: null, key: `dismiss-err:${input.params.id}` });
    },
  });
  const dismissQuiet = useOptimisticMutation({ ...dismissCfg, onError: (_e, input) => forget(input.params.id) });

  // The Claim form: one row (its evidence as the comment to edit) or a batch (one split and role for all; each row
  // keeps its own evidence unless you write a comment for all of them)
  const [claimAsk, setClaimAsk] = useState<MissedOpp[] | null>(null);
  const onClaim = useCallback((m: MissedOpp) => {
    if (m.status === 'new') setClaimAsk([m]);
  }, []);
  const claimNow = useCallback(
    (m: MissedOpp, v: ClaimValues) => {
      if (m.status !== 'new') return;
      setTouched((t) => new Map(t).set(m.id, null)); // keep the row in place the moment it's claimed
      setSelected(m.id);
      setPicked((p) => {
        const n = new Set(p);
        n.delete(m.id);
        return n;
      });
      claim.mutate({ params: { id: m.id }, body: { split: v.split, role: v.role, ...(v.comment ? { comment: v.comment } : {}) } });
    },
    [claim, setSelected],
  );
  const onDismiss = useCallback(
    (m: MissedOpp, reason: string, note: string) => {
      if (m.status !== 'new' || !reason) return;
      setTouched((t) => new Map(t).set(m.id, null));
      dismiss.mutate({ params: { id: m.id }, body: note ? { reason, note } : { reason } });
    },
    [dismiss],
  );

  const undoMany = useCallback(
    async (auditIds: string[], label: string) => {
      for (const a of auditIds) await api('undoAudit', { params: { id: a }, body: {} });
      await missed.refetch();
      toast({ title: `Undone: ${label}`, key: `undo:${label}`, durationMs: 4800 });
    },
    [missed],
  );
  const runManyNow = useCallback(
    async (ms: MissedOpp[], kind: 'claim' | 'dismiss', reason?: string, note?: string, values?: ClaimValues) => {
      const live = ms.filter((m) => m.status === 'new');
      if (!live.length) return;
      setTouched((t) => {
        const n = new Map(t);
        for (const m of live) n.set(m.id, null);
        return n;
      });
      setPicked(new Set());
      const audits: string[] = [];
      let failed = 0;
      for (const m of live) {
        try {
          const res =
            kind === 'claim'
              ? await claimQuiet.mutateAsync({ params: { id: m.id }, body: values ? { split: values.split, role: values.role, ...(values.comment ? { comment: values.comment } : {}) } : {} })
              : await dismissQuiet.mutateAsync({ params: { id: m.id }, body: note ? { reason: reason!, note } : { reason: reason! } });
          if (res.auditId) audits.push(res.auditId);
        } catch {
          failed++;
        }
      }
      const done = live.length - failed;
      const verb = kind === 'claim' ? 'Claimed' : 'Dismissed';
      if (done)
        toast({
          key: `batch:${kind}`,
          title: `${verb} ${done} ${done === 1 ? 'opp' : 'opps'}`,
          body: kind === 'claim' ? 'DC requests added: they go on your next logging canvas (Deals ▸ DCs). Nothing was sent.' : reason,
          tone: failed ? 'warning' : 'success',
          undo: audits.length ? { run: () => undoMany(audits, `${kind} on ${done} ${done === 1 ? 'opp' : 'opps'}`) } : undefined,
        });
      if (failed) toast({ key: `batch-err:${kind}`, tone: 'error', durationMs: null, title: `${failed} ${failed === 1 ? 'opp' : 'opps'} couldn't be ${kind === 'claim' ? 'claimed' : 'dismissed'}`, body: 'They are back as they were. Try them one by one.' });
    },
    [claimQuiet, dismissQuiet, undoMany],
  );
  // a batch Claim asks once (the form), a batch Dismiss runs at once
  const runMany = useCallback(
    async (ms: MissedOpp[], kind: 'claim' | 'dismiss', reason?: string, note?: string) => {
      if (kind === 'claim') {
        const live = ms.filter((m) => m.status === 'new');
        if (live.length) setClaimAsk(live);
        return;
      }
      await runManyNow(ms, kind, reason, note);
    },
    [runManyNow],
  );

  const onUndo = useCallback(
    async (m: MissedOpp) => {
      const auditId = touched.get(m.id);
      if (!auditId) return;
      try {
        await api('undoAudit', { params: { id: auditId }, body: {} });
        setTouched((t) => new Map(t).set(m.id, null)); // stays in place as a normal row
        await missed.refetch();
        toast({ title: `Undone: ${m.status === 'claimed' ? 'claim' : 'dismiss'} on ${m.oppName}`, key: `undo:${m.id}`, durationMs: 4800 });
      } catch (e) {
        toast({ title: "Couldn't undo", body: (e as Error).message, tone: 'error', durationMs: null, key: `undo-err:${m.id}` });
      }
    },
    [touched, missed],
  );

  const toggle = useCallback(
    (id: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const pick = useCallback((m: MissedOpp) => {
    if (m.status !== 'new') return;
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(m.id)) n.delete(m.id);
      else n.add(m.id);
      return n;
    });
  }, []);
  const pickAll = useCallback(
    (ms: MissedOpp[], on: boolean) =>
      setPicked((p) => {
        const n = new Set(p);
        for (const m of ms) if (on) n.add(m.id);
        else n.delete(m.id);
        return n;
      }),
    [],
  );

  const openRow = useCallback(
    (id: string) => {
      const m = byId.get(id);
      if (!m) return;
      setSelected(id);
      openDetails({ kind: 'missed_opp', id: m.id, label: m.oppName });
    },
    [byId, openDetails, setSelected],
  );
  // ?id=<missedId> (a deep link: hrefFor, ⌘K, a notification) selects that row and opens it in Details, once.
  const linked = missedDeepLink(sp);
  const linkedOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || linkedOpened.current === linked || !byId.has(linked)) return;
    linkedOpened.current = linked;
    openRow(linked);
  }, [linked, byId, openRow]);
  const openTask = useCallback(
    (m: MissedOpp) => {
      if (m.claimedWorkItemId) openDetails({ kind: 'work_item', id: m.claimedWorkItemId, label: `DC task: ${m.oppName}` });
    },
    [openDetails],
  );

  useContextKeys({
    scope: SCOPE,
    rootRef,
    ids,
    selected: active,
    setSelected,
    enabled: state === 'ready',
    onOpen: openRow,
    onPrimary: (id) => {
      const m = byId.get(id);
      if (m) onClaim(m);
    },
    actions: {
      a: (id) => {
        const m = byId.get(id);
        if (m) onClaim(m);
      },
      n: (id) => byId.get(id)?.status === 'new' && setDismissOpenId(id),
      x: (id) => {
        const m = byId.get(id);
        if (m) pick(m);
      },
      space: (id) => toggle(id),
    },
  });

  const setAccount = (v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set('account', v);
    else p.delete('account');
    navigate(`${pathname}${p.size ? `?${p}` : ''}`, { replace: true });
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'missed.filter.claim', title: 'Missed: show Claim only', group: 'Deals', run: () => setFilters({ ...filters, verdict: 'claim' }) },
      { id: 'missed.filter.check', title: 'Missed: show Check only', group: 'Deals', run: () => setFilters({ ...filters, verdict: 'check' }) },
      { id: 'missed.filter.reset', title: 'Missed: reset filters', group: 'Deals', run: () => (setFilters(DEFAULT_FILTERS), setAccount(null)) },
    ];
    const pickedRows = [...picked].map((id) => byId.get(id)).filter((m): m is MissedOpp => !!m && m.status === 'new');
    if (pickedRows.length) list.push({ id: 'missed.claim-selected', title: `Missed: claim ${pickedRows.length} selected`, subtitle: 'Adds DC requests for your next logging canvas. Nothing is sent.', group: 'Deals', run: () => void runMany(pickedRows, 'claim') });
    if (activeRow && activeRow.status === 'new')
      list.push(
        { id: 'missed.claim', title: `Claim: ${activeRow.oppName}`, subtitle: 'Adds a DC request for your next logging canvas. Nothing is sent.', group: 'Deals', shortcut: 'a', run: () => onClaim(activeRow) },
        { id: 'missed.dismiss', title: `Dismiss: ${activeRow.oppName}`, subtitle: 'Needs a reason', group: 'Deals', shortcut: 'n', run: () => setDismissOpenId(activeRow.id) },
        { id: 'missed.select', title: `Select: ${activeRow.oppName}`, group: 'Deals', shortcut: 'x', run: () => pick(activeRow) },
      );
    if (activeRow) list.push({ id: 'missed.details', title: `Details: ${activeRow.oppName}`, group: 'Deals', shortcut: 'enter', run: () => openRow(activeRow.id) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, picked, byId, activeRow, runMany, onClaim, pick, openRow]);
  useCommands(commands);

  const c: RowCtx = {
    today,
    selected: active,
    firstId: (claimRows.find((m) => m.status === 'new') ?? checkRows.find((m) => m.status === 'new'))?.id ?? null,
    openId,
    picked,
    expanded,
    newIds,
    dismissOpenId,
    canUndo: (id) => !!touched.get(id),
    onSelect: (m) => openRow(m.id),
    onPick: pick,
    onClaim,
    onDismiss,
    onUndo: (m) => void onUndo(m),
    onOpenTask: openTask,
    onToggle: toggle,
    setDismissOpenId,
  };

  const openCount = all.filter((m) => m.status === 'new').length;
  const claimCount = all.filter((m) => m.status === 'new' && m.verdict === 'claim').length;
  const handledCount = all.length - openCount;
  const lastSweep = missed.data?.lastSweepAt ?? null;
  const tzFmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const both = filters.verdict === 'all';
  const sideBySide = both && mainW >= 1500;

  return (
    <ContextPage label="Missed opportunities">
      <ContextHead
        title="Missed opportunities"
        sentence={
          missed.data ? (
            <>
              <span className="font-bold text-fg">{openCount ? `${openCount} opps look like yours with no DC from you` : 'Nothing to claim'}</span>
              {openCount ? ` · ${claimCount} to claim, ${openCount - claimCount} to check` : ''}
              {lastSweep ? ` · swept ${tzFmt(lastSweep)}` : ''}. Claiming adds a DC request for your next logging canvas; nothing is sent.
            </>
          ) : (
            'Loading the missed-opp sweep…'
          )
        }
        tabs={<DealsTabs tab="missed" missedCount={deals.data?.missedCount} />}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filters">
        <SegmentedToggle
          label="Verdict"
          size="sm"
          value={filters.verdict}
          onChange={(v) => setFilters({ ...filters, verdict: v })}
          options={[
            { value: 'all', label: 'Claim + check' },
            { value: 'claim', label: 'Claim' },
            { value: 'check', label: 'Check' },
          ]}
        />
        <SegmentedToggle
          label="Opp status"
          size="sm"
          value={filters.stage}
          onChange={(v) => setFilters({ ...filters, stage: v })}
          options={[
            { value: 'all', label: 'Open + closed' },
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <label className="flex items-center gap-2 text-caption text-muted">
          Amount
          <select
            value={filters.minAmount}
            onChange={(e) => setFilters({ ...filters, minAmount: Number(e.target.value) })}
            aria-label="Minimum amount"
            className="h-8 rounded-md border border-line-input bg-surface-input px-2 text-caption text-fg focus:border-accent focus:outline-none"
          >
            {AMOUNT_STEPS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <SegmentedToggle
          label="Show"
          size="sm"
          value={filters.scope}
          onChange={(v) => setFilters({ ...filters, scope: v })}
          options={[
            { value: 'review', label: 'To review' },
            { value: 'handled', label: `Handled${handledCount ? ` ${handledCount}` : ''}` },
            { value: 'all', label: 'All' },
          ]}
        />
        {account ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface-sunken pr-1 pl-2.5 text-caption font-bold text-fg">
            Account: {account}
            <button type="button" aria-label="Clear the account filter" onClick={() => setAccount(null)} className="inline-grid size-6 place-items-center rounded-sm text-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus">
              <Icon name="close" size="xs" />
            </button>
          </span>
        ) : null}
        <span className="text-caption text-muted tabular-nums" aria-live="polite">
          {filtered.length} of {all.length}
        </span>
        {newIds.size ? (
          <button
            type="button"
            onClick={() => {
              const first = [...newIds][0]!;
              document.querySelector(`[data-row-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'center' });
              setSeen(new Set(all.map((m) => m.id)));
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus"
          >
            {newIds.size} new <Icon name="arrowdown" size="xs" />
          </button>
        ) : null}
        <span className="ml-auto text-caption text-muted">
          <kbd className="font-mono">x</kbd> select · <kbd className="font-mono">a</kbd> claim · <kbd className="font-mono">n</kbd> dismiss
        </span>
      </div>

      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        <PanelBoundary name="deals.missed">
          {state === 'error' ? (
            <PanelError title="Couldn't load missed opportunities" error={missed.error} onRetry={() => void missed.refetch()} />
          ) : state === 'loading' ? (
            <MissedBodySkeleton />
          ) : !filtered.length ? (
            (() => {
              // everything the sweep found is handled (dismissed or claimed): say so, and offer the handled list
              const handled = all.filter((m) => m.status !== 'new').length;
              const caughtUp = all.length > 0 && handled === all.length && filters.scope === 'review';
              return (
                <EmptyState
                  icon="success"
                  title={caughtUp ? 'All caught up' : all.length ? 'Nothing matches these filters' : 'No missed opportunities'}
                  body={
                    caughtUp
                      ? `The sweep's ${handled === 1 ? 'one finding is' : `${handled} findings are`} already handled (dismissed or claimed). It runs again after the next Org62 scan.`
                      : all.length
                        ? 'Loosen a filter, or switch Show to All.'
                        : 'The sweep found no opps that look like yours without a DC. It runs again after the next Org62 scan.'
                  }
                  action={
                    caughtUp ? (
                      <Button size="sm" variant="secondary" onClick={() => setFilters({ ...filters, scope: 'handled' })}>
                        Show handled
                      </Button>
                    ) : all.length ? (
                      <Button size="sm" variant="secondary" onClick={() => (setFilters({ ...DEFAULT_FILTERS, scope: 'all' }), setAccount(null))}>
                        Show everything
                      </Button>
                    ) : undefined
                  }
                />
              );
            })()
          ) : (
            <div className={cn('grid min-h-0 flex-1 gap-5', sideBySide ? 'grid-cols-2' : 'grid-cols-1')}>
              {sideBySide || !both ? (
                <>
                  {filters.verdict !== 'check' ? (
                    <VerdictSection verdict="claim" rows={claimRows} c={c} onClaimMany={(ms) => void runMany(ms, 'claim')} onDismissMany={(ms, r, n) => void runMany(ms, 'dismiss', r, n)} onPickAll={pickAll} batchDismissOpen={batchDismissOpen} setBatchDismissOpen={setBatchDismissOpen} />
                  ) : null}
                  {filters.verdict !== 'claim' ? (
                    <VerdictSection verdict="check" rows={checkRows} c={c} onClaimMany={(ms) => void runMany(ms, 'claim')} onDismissMany={(ms, r, n) => void runMany(ms, 'dismiss', r, n)} onPickAll={pickAll} batchDismissOpen={batchDismissOpen} setBatchDismissOpen={setBatchDismissOpen} />
                  ) : null}
                </>
              ) : (
                <StackedSections claimRows={claimRows} checkRows={checkRows} c={c} runMany={runMany} pickAll={pickAll} batchDismissOpen={batchDismissOpen} setBatchDismissOpen={setBatchDismissOpen} />
              )}
            </div>
          )}
        </PanelBoundary>
        <p className="mt-2 shrink-0 text-caption text-muted">
          Claim adds a DC request (Deals ▸ DCs): it goes on your next logging canvas, which you Apply on Activity before Slackbot sees it. Command Center never writes to Org62.
        </p>
      </div>
      <ClaimDcDialog
        target={claimAsk ? (claimAsk.length === 1 ? claimTargetOf(claimAsk[0]!) : { oppId: null, oppName: `${claimAsk.length} opps`, myDc: null, comment: '' }) : null}
        commentRequired={(claimAsk?.length ?? 0) <= 1}
        onClose={() => setClaimAsk(null)}
        onSubmit={(v) => {
          const rows = claimAsk ?? [];
          if (rows.length === 1) claimNow(rows[0]!, v);
          else void runManyNow(rows, 'claim', undefined, undefined, v);
        }}
      />
    </ContextPage>
  );
}

/** Below 1,500 px of main width (or with the panel open): one scrolling pane, Claim then Check. */
function StackedSections({
  claimRows,
  checkRows,
  c,
  runMany,
  pickAll,
  batchDismissOpen,
  setBatchDismissOpen,
}: {
  claimRows: MissedOpp[];
  checkRows: MissedOpp[];
  c: RowCtx;
  runMany: (ms: MissedOpp[], kind: 'claim' | 'dismiss', reason?: string, note?: string) => Promise<void>;
  pickAll: (ms: MissedOpp[], on: boolean) => void;
  batchDismissOpen: string | null;
  setBatchDismissOpen: (v: string | null) => void;
}) {
  const head = (verdict: 'claim' | 'check', rows: MissedOpp[]) => {
    const open = rows.filter((m) => m.status === 'new');
    const picked = open.filter((m) => c.picked.has(m.id));
    return (
      <SectionHead
        title={verdict === 'claim' ? 'Claim' : 'Check first'}
        count={open.length}
        sub={verdict === 'claim' ? 'clearly yours, no DC' : 'ambiguous: look before claiming'}
        action={
          picked.length ? (
            <>
              <Button size="xs" variant="quiet" onClick={() => void runMany(picked, 'claim')} data-testid={`batch-claim-${verdict}`}>
                Claim {picked.length} selected
              </Button>
              <Popover
                open={batchDismissOpen === verdict}
                onOpenChange={(o) => setBatchDismissOpen(o ? verdict : null)}
                placement="bottom-end"
                width={380}
                label="Dismiss the selected opps"
                trigger={
                  <Button size="xs" variant="quiet">
                    Dismiss {picked.length}…
                  </Button>
                }
              >
                {({ close }) => (
                  <DismissForm
                    count={picked.length}
                    onCancel={close}
                    onSubmit={(reason, note) => {
                      close();
                      void runMany(picked, 'dismiss', reason, note);
                    }}
                  />
                )}
              </Popover>
              <Button size="xs" variant="quiet" onClick={() => pickAll(open, false)}>
                Clear
              </Button>
            </>
          ) : open.length > 1 ? (
            <Button size="xs" variant="quiet" onClick={() => pickAll(open, true)}>
              Select all {open.length}
            </Button>
          ) : undefined
        }
      />
    );
  };
  return (
    <Pane aria-label="Missed opportunities" bodyClassName="pb-3">
      {claimRows.length ? (
        <section aria-label="Claim">
          <div className="sticky top-0 z-[1] bg-surface">{head('claim', claimRows)}</div>
          <div role="list" aria-label="Claim">
            {claimRows.map((m) => (
              <MissedRow key={m.id} m={m} c={c} />
            ))}
          </div>
        </section>
      ) : null}
      {checkRows.length ? (
        <section aria-label="Check first" className="mt-3">
          <div className="sticky top-0 z-[1] bg-surface">{head('check', checkRows)}</div>
          <div role="list" aria-label="Check first">
            {checkRows.map((m) => (
              <MissedRow key={m.id} m={m} c={c} />
            ))}
          </div>
        </section>
      ) : null}
    </Pane>
  );
}
