'use client';
/**
 * Per-row popovers (snooze · resolve · run tool), opened by click or key (s, ⇧D, ⌘↵ on a tool NBA) and
 * anchored inside the row. Re-auth for a broken connector is a persistent inline panel under its fit-in
 * row (it needs action, so never a toast): terminal commands show Copy plus an explicit "Open Terminal";
 * other kinds call POST /connectors/:id/reauth on the click. The client never shells out.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Connector, ReauthResult, WorkItem } from '@/contract';
import { useApi } from '@/client/hooks';
import { ResolvePicker } from '@/components/domain';
import { Button, cn, Icon, IconButton, Spinner } from '@/ui';
import { useToday, type Surface } from './ctx';
import { AnchoredPopover, SnoozeMenu, ToolRunForm } from './parts';

export function ItemPopovers({ item, surface, anchorClassName }: { item: WorkItem; surface: Surface; anchorClassName?: string }) {
  const ctx = useToday();
  const p = ctx.popover;
  const mine = p && p.itemId === item.id && p.surface === surface ? p.kind : null;
  const people = useMemo(() => {
    const all = [...item.people, ...(item.counterparty ? [item.counterparty] : []), ...(item.owner ? [item.owner] : [])];
    return all.filter((x, i) => all.findIndex((y) => y.id === x.id) === i);
  }, [item.people, item.counterparty, item.owner]);
  const nba = ctx.cardFor(item.id)?.nba ?? null;
  const onOpenChange = (v: boolean) => {
    if (!v) ctx.closePopover();
  };
  if (!mine) return null;
  return (
    <>
      <AnchoredPopover open={mine === 'snooze'} onOpenChange={onOpenChange} label="Snooze" width={300} anchorClassName={anchorClassName}>
        <SnoozeMenu
          now={ctx.now}
          tz={ctx.tz}
          onCancel={ctx.closePopover}
          onPick={(until, label) => {
            ctx.closePopover();
            ctx.actions.snooze(item, until, label);
          }}
        />
      </AnchoredPopover>
      <AnchoredPopover open={mine === 'resolve'} onOpenChange={onOpenChange} label="Resolve" width={384} anchorClassName={anchorClassName}>
        <ResolvePicker
          className="border-0 shadow-none"
          title={item.title}
          people={people}
          threadPeople={item.people.map((x) => x.id)}
          relatedItems={ctx.relatedItems.filter((r) => r.id !== item.id)}
          onCancel={ctx.closePopover}
          onResolve={(v) => {
            ctx.closePopover();
            ctx.actions.resolve(item, v);
          }}
        />
      </AnchoredPopover>
      {nba ? (
        <AnchoredPopover open={mine === 'tool'} onOpenChange={onOpenChange} label="Run tool" width={340} anchorClassName={anchorClassName}>
          <ToolRunForm
            nba={nba}
            onCancel={ctx.closePopover}
            onRun={async (adapterId, inputs, name) => {
              const err = await ctx.actions.runTool(adapterId, inputs, item, nba.id, name);
              if (!err) ctx.closePopover();
              return err;
            }}
          />
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function ReauthBody({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const { actions } = useToday();
  const kind = connector.reauth?.kind ?? 'instructions';
  const [phase, setPhase] = useState<'ready' | 'calling' | 'done' | 'error'>('ready');
  const [result, setResult] = useState<ReauthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const call = async () => {
    setPhase('calling');
    setError(null);
    const r = await actions.reauth(connector.id);
    if (r.error) {
      setError(r.error);
      setPhase('error');
    } else {
      setResult(r.result);
      setPhase('done');
    }
  };
  // The Re-auth click is the explicit action for in-app / script kinds; terminal commands wait for "Open Terminal".
  useEffect(() => {
    if (kind !== 'terminal_command' && kind !== 'instructions') void call();
    // run once per connector
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id]);

  const action = result?.action ?? connector.reauth;
  const command = action?.command ?? null;
  const healthy = connector.state === 'ok';
  const copy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-label={`Re-auth ${connector.label}`} data-reauth-panel className={cn('mt-2 rounded-md border bg-surface p-3', healthy ? 'border-success-200' : 'border-danger-200')}>
      <div className="flex items-center gap-2">
        <Icon name={healthy ? 'check' : 'connected_apps'} size="sm" className={healthy ? 'text-success-700' : 'text-danger-700'} />
        <p className="min-w-0 flex-1 truncate text-body font-bold text-fg-heading">{healthy ? `${connector.label} reconnected` : action?.label ?? `Re-auth ${connector.label}`}</p>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </div>
      {healthy ? (
        <p className="mt-1 text-caption text-fg">Stale marks clear as items refresh.</p>
      ) : connector.impact ? (
        <p className="mt-1 text-caption text-muted">{connector.impact}</p>
      ) : null}
      {command ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1">
          <code className="min-w-0 flex-1 truncate font-mono text-caption text-fg" title={command}>
            {command}
          </code>
          <Button size="xs" variant="ghost" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      ) : null}
      {action?.instructions ? <p className="mt-2 text-caption text-fg">{action.instructions}</p> : null}
      {phase === 'calling' ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-caption text-muted">
          <Spinner size="xs" /> {kind === 'terminal_command' ? 'Opening Terminal…' : 'Starting re-auth…'}
        </p>
      ) : null}
      {phase === 'done' && result ? (
        <p className="mt-2 text-caption text-fg">
          {result.started
            ? result.action.kind === 'terminal_command'
              ? 'Terminal opened with the command above. Finish the login there; this clears when the connector reports in.'
              : `Started. ${result.connector.label} is ${result.connector.state === 'catching_up' ? 'catching up' : result.connector.state.replace('_', ' ')}.`
            : 'Nothing to start for this connector; follow the instructions above.'}
        </p>
      ) : null}
      {phase === 'error' && error ? (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-caption text-danger-700">
          <Icon name="error" size="xs" /> Couldn’t start re-auth: {error}
        </p>
      ) : null}
      {kind === 'terminal_command' || phase === 'error' ? (
        <div className="mt-2 flex items-center justify-end gap-2">
          {kind === 'terminal_command' ? (
            <Button size="sm" variant="primary" icon="new_window" loading={phase === 'calling'} onClick={() => void call()}>
              Open Terminal
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void call()}>
              Retry
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Inline re-auth under a fit-in row; reads the live connector from GET /health. */
export function InlineReauth({ connectorId, onClose }: { connectorId: string; onClose: () => void }) {
  const health = useApi('getHealth');
  const connector = health.data?.connectors.find((c) => c.id === connectorId) ?? null;
  if (!connector) {
    return health.isLoading ? (
      <p className="mt-2 inline-flex items-center gap-1.5 text-caption text-muted">
        <Spinner size="xs" /> Checking the connector…
      </p>
    ) : null;
  }
  return <ReauthBody key={connector.id} connector={connector} onClose={onClose} />;
}
