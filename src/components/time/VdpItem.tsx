'use client';
/**
 * One open VDP item, the same row on the Time ▸ VDP tree and in the VDP details panel (D-59: one source, one look).
 *
 *   title · who applies it (autopilot, you approving the app's suggestion) · its state (Staged, Waiting for VDP to
 *   refresh) · its one verb: Apply (the call, after its inputs when it needs typed values; nothing reaches VDP before
 *   it; a quiet Edit opens the inputs of one whose values are all suggested, so a choice such as an asset's Type can
 *   change first), Review & apply for a staged one, or, when VDP's MCP can't take it yet, the reason and no verb (D-63)
 *
 * D-63: no handoffs and no Copy in the VDP section. A quiet "Open in VDP ↗" to view a VDP stays.
 *
 * Also: the status chip, the inline inputs form (`VdpInputs`, values held by the caller so a tree row can be ticked
 * once filled), and `useVdpLiveSync` (a staged or applied item refreshes the VDP views, which read the Outbox through
 * the server's status).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { Draft, VdpApply, VdpStatus, VdpStep } from '@/contract';
import { api, type ApiError } from '@/client/api';
import { subscribeLive } from '@/client/live';
import { toast } from '@/client/toast';
import { StatusBadge } from '@/components/domain';
import { Button, cn, Icon } from '@/ui';
import { applyDefaults, applyNeedsInput, applyReady, editableFields, fixedText, nextReadText, STATUS_CHIP, whoText } from './vdp-derive';
import { autopilotLabel } from './vdp-changes-derive';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { errorText } from '@/lib/error-text';

/** The status chip (Done ✓ · N open · Waiting for VDP to refresh · Past). */
export function VdpStatusChip({ status, nowMs, tz, className }: { status: VdpStatus; nowMs?: number; tz?: string; className?: string }) {
  const c = STATUS_CHIP[status.state];
  const next = status.state === 'waiting' && nowMs !== undefined ? nextReadText(status.nextReadAt, nowMs, tz) : null;
  return (
    <StatusBadge tone={c.tone} icon={c.icon} dashed={c.dashed} title={next ?? undefined} className={className}>
      <span data-testid="vdp-status" data-state={status.state}>
        {status.label}
      </span>
    </StatusBadge>
  );
}

/** A staged or applied VDP item changes what the VDP views show: refresh them when the Outbox moves. */
export function useVdpLiveSync() {
  const qc = useQueryClient();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = subscribeLive((ev) => {
      if ((ev.topic !== 'outbox' && ev.topic !== 'draft') || t) return;
      t = setTimeout(() => {
        t = null;
        void qc.invalidateQueries({ queryKey: ['deals'] });
      }, 120);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [qc]);
}

/** A quiet link to VIEW a VDP in VDP (D-63: viewing is fine; nothing is handed off). */
export function OpenInVdp({ url, label = 'Open in VDP' }: { url: string; label?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption font-bold whitespace-nowrap text-muted hover:text-link hover:underline">
      {label} <Icon name="new_window" size="xs" />
    </a>
  );
}

/** "VDP's MCP can't take this yet: <tool/arg>" (D-63): the item shows, with no verb, until VDP lists the tool. */
export function DisabledReason({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-caption text-muted" data-testid="vdp-disabled">
      <Icon name="lock" size="xs" />
      {text}
    </span>
  );
}

/** Stage one item's Apply (the server rebuilds the call from the mirror) and open the draft to review. */
export function useStageItem(onStaged: (d: Draft) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; values: Record<string, string> }) => api('draftVdpUpdate', { body: { itemKey: v.key, values: v.values } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['outbox'] });
      void qc.invalidateQueries({ queryKey: ['deals'] });
      onStaged(r.entity.draft);
    },
    onError: (e: ApiError, v) => toast({ key: `vdp-stage-${v.key}`, tone: 'error', title: "Couldn't stage the VDP change", body: errorText(e, 200) }),
  });
}

/**
 * The inputs of one item (D-63: use-case inputs, an AE no forecast names, the entitlement), filled inline. The values
 * are the caller's (a tree row ticks once they are in); ids the app knows are shown, not typed.
 */
export function VdpInputs({ apply, values, onChange, footer }: { apply: VdpApply; values: Record<string, string>; onChange: (field: string, value: string) => void; footer?: ReactNode }) {
  const fixed = apply.fields.filter((f) => f.fixed && fixedText(f));
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5" data-testid="vdp-apply-form">
      {fixed.length ? (
        <p className="text-caption text-muted">
          {fixed.map((f) => (
            <span key={f.field} className="mr-3 inline-block">
              {f.label}: <span className="font-bold text-fg tabular-nums">{fixedText(f)}</span>
            </span>
          ))}
        </p>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        {editableFields(apply).map((f) => (
          <label key={f.field} className={cn('flex min-w-0 flex-col gap-1 text-caption text-muted', f.multiline && 'sm:col-span-2')}>
            <span>
              {f.label}
              {f.required ? <span aria-hidden> *</span> : null}
              {f.current !== null && f.current !== '' ? <span> · now {String(f.current)}</span> : null}
            </span>
            {f.options.length ? (
              <select aria-label={f.label} className="h-8 min-w-0 rounded-md border border-line bg-surface px-2 text-body text-fg" value={values[f.field] ?? ''} onChange={(e) => onChange(f.field, e.target.value)}>
                <option value="">{f.required ? 'Pick one' : '(leave empty)'}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o === 'd360' ? 'D360' : o === 'agentforce' ? 'Agentforce' : o}
                  </option>
                ))}
              </select>
            ) : f.multiline ? (
              <textarea aria-label={f.label} rows={3} className="min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-body text-fg" value={values[f.field] ?? ''} onChange={(e) => onChange(f.field, e.target.value)} />
            ) : (
              <input aria-label={f.label} type={/_date$/.test(f.field) ? 'date' : 'text'} className="h-8 min-w-0 rounded-md border border-line bg-surface px-2 text-body text-fg" value={values[f.field] ?? ''} onChange={(e) => onChange(f.field, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {footer}
    </div>
  );
}

/** An Apply's inputs with its stage button (the suggestions pre-filled; a choice is a select). */
export function ApplyForm({ apply, onStage, pending, onCancel }: { apply: VdpApply; onStage: (values: Record<string, string>) => void; pending: boolean; onCancel?: () => void }) {
  const [values, setValues] = useState(() => applyDefaults(apply));
  const ready = applyReady(apply, values);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onStage(values);
      }}
    >
      <VdpInputs
        apply={apply}
        values={values}
        onChange={(f, v) => setValues((x) => ({ ...x, [f]: v }))}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={!ready} loading={pending} data-testid="vdp-apply-stage">
              {apply.label}
            </Button>
            {onCancel ? (
              <Button size="sm" variant="quiet" type="button" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <span className="text-caption text-muted">Stages one change you review and Apply; nothing reaches VDP before that.</span>
          </div>
        }
      />
    </form>
  );
}

/** A suggestion for a judgment item (D-60): the AI color marks it as the app's, not yet yours. */
export function SuggestionLine({ s }: { s: NonNullable<VdpStep['suggestion']> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="vdp-suggestion" title={s.basis.join('\n') || undefined}>
      <StatusBadge tone="ai" icon="sparkle">{`Suggested: ${s.line}`}</StatusBadge>
      {s.basis.length ? <span className="text-caption text-muted">{s.basis.join(' · ')}</span> : null}
    </span>
  );
}

/** What autopilot did or will do with an item: "Applied automatically · 14:02 · Open ↗", queued, paused, failed. */
export function AutopilotState({ a, tz }: { a: NonNullable<VdpStep['autopilot']>; tz?: string }) {
  const l = autopilotLabel(a, (iso) => `${dayLabel(iso, tz)} ${clock(iso, tz)}`);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2" data-testid="vdp-autopilot-state" data-state={a.state}>
      <StatusBadge tone={l.tone} icon={a.state === 'applied' ? 'check' : a.state === 'failed' ? 'error' : a.state === 'paused' ? 'pause' : 'clock'}>
        {l.text}
      </StatusBadge>
      {a.url ? <OpenInVdp url={a.url} label="Open" /> : null}
    </span>
  );
}

/**
 * One item (the details panel's list). `n`: its number in the list; `onDraft`: open a staged draft (Review & apply);
 * `onPush`: push it with what it needs first (D-63: an item under a company or VDP that does not exist yet can only go
 * with them; the Changes tab's confirm lists them); `extra`: what the caller adds (Find assets, Review assets).
 */
export function VdpItemRow({ step, n, onDraft, onPush, extra, compact, onOpen, tz }: { step: VdpStep; n?: number; after?: number; onDraft: (draftId: string) => void; onPush?: (key: string) => void; extra?: ReactNode; compact?: boolean; onOpen?: () => void; tz?: string }) {
  const [open, setOpen] = useState(false);
  const stage = useStageItem((d) => {
    setOpen(false);
    onDraft(d.id);
  });
  const a = step.apply;
  const off = !!step.disabled;
  const chained = (step.requires ?? []).length > 0;
  const go = (values: Record<string, string>) => a && stage.mutate({ key: a.key, values });
  const suggest = step.suggestion && step.state === 'todo' ? step.suggestion : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-step={step.kind} data-state={step.state} data-who={step.who} data-disabled={off ? 'true' : undefined} data-testid="vdp-item">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        {n !== undefined ? (
          <span aria-hidden className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-bold tabular-nums', off ? 'border-line text-muted' : 'border-line-strong text-fg')}>
            {n}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button type="button" className={cn('min-w-0 text-left font-bold hover:underline', off ? 'text-muted' : 'text-fg')} onClick={onOpen} data-testid="vdp-item-open">
              {step.title}
            </button>
          ) : (
            <p className={cn('min-w-0 font-bold', off ? 'text-muted' : 'text-fg')}>{step.title}</p>
          )}
          <p className="text-caption text-muted">
            {off ? null : whoText(step)}
            {step.state === 'waiting' ? ' · applied: waiting for VDP to refresh' : step.state === 'staged' ? ' · staged: waiting for your Apply' : ''}
            {!compact && step.detail ? `${off ? '' : ' · '}${step.detail}` : ''}
          </p>
          {off ? <DisabledReason text={step.disabled!} /> : null}
          {suggest || step.autopilot ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              {suggest ? <SuggestionLine s={suggest} /> : null}
              {step.autopilot ? <AutopilotState a={step.autopilot} tz={tz} /> : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {off ? null : step.state === 'waiting' ? (
            <StatusBadge tone="neutral" icon="clock">
              Waiting for VDP to refresh
            </StatusBadge>
          ) : step.state === 'staged' && step.draftId && !chained ? (
            <Button size="sm" variant="secondary" onClick={() => onDraft(step.draftId!)} data-testid="vdp-review">
              Review & apply
            </Button>
          ) : a && chained && onPush ? (
            // D-63: it goes with the items above it (a new company, a new VDP), in order, new ids passed down
            <Button size="sm" variant="secondary" onClick={() => onPush(a.key)} title={`Pushes ${step.requires.length === 1 ? 'the item it needs' : `the ${step.requires.length} items it needs`} first`} data-testid="vdp-push-one">
              {`Apply · ${step.requires.length} first`}
            </Button>
          ) : a && suggest && !open ? (
            // one "Apply suggestions" per item: stages the suggested values for you to review and Apply (never auto)
            <Button size="sm" variant="secondary" loading={stage.isPending} onClick={() => go({ ...applyDefaults(a), ...suggest.values })} data-testid="vdp-apply-suggestions">
              Apply suggestions
            </Button>
          ) : a && !chained ? (
            open ? null : (
              <>
                {/* every value suggested: Apply stages them; Edit changes one first (a choice such as a Type, a quarter) */}
                {step.state === 'todo' && !off && !applyNeedsInput(a) && editableFields(a).length ? (
                  <Button size="sm" variant="quiet" onClick={() => setOpen(true)} data-testid="vdp-edit">
                    Edit
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" loading={stage.isPending} onClick={() => (applyNeedsInput(a) ? setOpen(true) : go(applyDefaults(a)))} data-testid="vdp-apply">
                  Apply
                </Button>
              </>
            )
          ) : null}
          {extra}
        </div>
      </div>
      {a && open && step.state === 'todo' && !off ? <ApplyForm apply={a} pending={stage.isPending} onStage={go} onCancel={() => setOpen(false)} /> : null}
    </div>
  );
}
