'use client';
/** Kit: panel states, banners, inline status, toasts, palette. */
import { useEffect, useState } from 'react';
import { useCommands, useFocusedCommands } from '@/client/keyboard/commands';
import { toast } from '@/client/toast/store';
import { useShellOptional } from '@/components/shell/ShellContext';
import {
  Banner,
  Button,
  ChangedElsewhere,
  EmptyState,
  Eyebrow,
  InlineStatus,
  KbdHint,
  ListContainer,
  ListGroupHeader,
  ListRow,
  PanelBoundary,
  PanelError,
  Skeleton,
  usePanelState,
} from '@/ui';
import { Cell, KitSection, Specimen } from './frame';

function Exploding({ armed }: { armed: boolean }) {
  if (armed) throw new Error('Render failed: cannot read properties of undefined (reading "cards"). token=sk-demo-abcdefghijklmnop');
  return <p className="px-3 py-6 text-body text-muted">This panel renders normally. Press “Break it” to throw inside its boundary.</p>;
}

function SavedDemo() {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => setAt(Date.now() - 2000), []);
  return at ? <InlineStatus state="saved" savedAt={at} /> : <InlineStatus state="idle" />;
}

function ForcedDemo() {
  const state = usePanelState('kit.demo', { loading: false, error: null, empty: false });
  return (
    <div className="w-80 rounded-lg border border-line bg-surface">
      <div className="flex h-8 items-center border-b border-line px-3">
        <Eyebrow count={state === 'ready' ? 3 : undefined}>Waiting on you</Eyebrow>
        <span className="ml-auto text-caption text-muted">state: {state}</span>
      </div>
      {state === 'loading' ? <Skeleton variant="row" count={3} /> : state === 'empty' ? <EmptyState size="panel" title="Nothing is waiting on you" /> : state === 'error' ? <PanelError compact error={new Error('upstream_unavailable')} onRetry={() => undefined} /> : (
        <div>
          {['ACME build session asks: which org alias?', 'Approve Outbox: reply to Dana', 'Globex SOW redlines need your call'].map((t) => (
            <ListRow key={t}>
              <span className="truncate">{t}</span>
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatesSection() {
  const [armed, setArmed] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState(false);
  return (
    <KitSection id="states" eyebrow="Panel states" title="Skeleton, EmptyState, PanelBoundary, Banner, InlineStatus" intro="Every panel has empty, loading and error states. The dev toolbar forces them everywhere (Panel state).">
      <Specimen label="Skeleton" note="mirrors the final layout" className="items-start">
        <Cell label="line ×3" className="w-56">
          <Skeleton count={3} className="w-56" />
        </Cell>
        <Cell label="row ×3" className="w-80">
          <div className="w-80 overflow-hidden rounded-lg border border-line bg-surface">
            <Skeleton variant="row" count={3} />
          </div>
        </Cell>
        <Cell label="card (NBA)" className="w-96">
          <Skeleton variant="card" className="w-96" />
        </Cell>
      </Specimen>
      <Specimen label="EmptyState" note="calm, no emoji, one way forward" className="items-start">
        <Cell label="inline" className="w-80">
          <div className="w-80 rounded-lg border border-line bg-surface">
            <EmptyState size="inline" icon="check" title="All clear." body="Nothing due before 14:00." />
          </div>
        </Cell>
        <Cell label="panel" className="w-72">
          <div className="w-72 rounded-lg border border-line bg-surface">
            <EmptyState icon="filterList" title="No items match these filters" body="Clear a filter or search all of Work." action={<Button size="sm" variant="secondary">Clear filters</Button>} />
          </div>
        </Cell>
        <Cell label="page" className="w-96">
          <div className="w-96 rounded-lg border border-line bg-surface">
            <EmptyState size="page" icon="summary" title="No briefs yet" body="Watch a channel or an opportunity to get a daily brief with what's worth a closer look." action={<Button size="sm" variant="primary">Add a watch</Button>} />
          </div>
        </Cell>
      </Specimen>
      <Specimen label="PanelBoundary" note="one panel fails; the rest keeps working" className="items-start">
        <div className="w-96 rounded-lg border border-line bg-surface">
          <div className="flex h-8 items-center border-b border-line px-3">
            <Eyebrow>Agents</Eyebrow>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setArmed(true)} disabled={armed}>
              Break it
            </Button>
          </div>
          <PanelBoundary name="kit.exploding" onRetry={() => setArmed(false)}>
            <Exploding armed={armed} />
          </PanelBoundary>
        </div>
        <div className="w-80 rounded-lg border border-line bg-surface">
          <PanelError title="Couldn't load Health" error={new Error('upstream_unavailable: connector, tool or LLM is down')} onRetry={() => undefined} />
        </div>
      </Specimen>
      <Specimen label="usePanelState" note="follows the dev toolbar override">
        <ForcedDemo />
      </Specimen>
      <Specimen label="Banner · panel" stack>
        <Banner tone="warn" title="Gmail needs re-auth." body="Email items after 09:40 may be missing." action={<Button size="xs" variant="secondary">Re-auth</Button>} />
        <Banner tone="risk" title="Slack disconnected." body="Items below may be stale." action={<Button size="xs" variant="secondary">Open Terminal command</Button>} onDismiss={() => undefined} />
        <Banner tone="info" title="Re-rank ready · 2." body="Dana's reply moves the ACME reply above the SOW." action={<Button size="xs" variant="secondary" kbd="r">Apply</Button>} />
        <Banner tone="ok" title="Verified in Slack." body="Reply landed in #acme-ext at 10:42." />
        <Banner tone="ai" title="New info for a draft you edited." body="Apply the update or keep yours." action={<Button size="xs" variant="ai">Review diff</Button>} />
      </Specimen>
      <Specimen label="Banner · page" stack>
        <div className="overflow-hidden rounded-lg border border-line">
          <Banner scope="page" tone="warn" title="Budget at 84% of today's soft cap." body="Scanners switch to deterministic-only at the hard cap." action={<Button size="xs" variant="secondary">Open Health</Button>} />
          <div className="bg-surface px-4 py-3 text-caption text-muted">Page content…</div>
        </div>
      </Specimen>
      <Specimen label="InlineStatus" note="beside the field or row">
        <Cell label="saving">
          <InlineStatus state="saving" />
        </Cell>
        <Cell label="saved">
          <SavedDemo />
        </Cell>
        <Cell label="dirty">
          <InlineStatus state="dirty" />
        </Cell>
        <Cell label="error">
          <InlineStatus state="error" error="upstream_unavailable" onRetry={() => toast({ title: 'Retrying…' })} />
        </Cell>
        <Cell label="conflict">
          <InlineStatus state="conflict" />
        </Cell>
      </Specimen>
      <Specimen label="ChangedElsewhere" note="409 on a field someone else changed">
        <ChangedElsewhere
          className="w-[28rem]"
          fields={[{ field: 'title', label: 'Title', mine: 'Reply to Dana: confirm Thu scope + pricing', theirs: 'Reply to Dana: confirm Thursday demo scope' }]}
          onKeepMine={() => toast({ title: 'Kept yours' })}
          onTakeTheirs={() => toast({ title: 'Took theirs' })}
        />
      </Specimen>
      <Specimen label="ListGroupHeader">
        <div className="w-96 overflow-hidden rounded-lg border border-line bg-surface">
          <ListGroupHeader label="Before 14:00" count={3} collapsed={groupCollapsed} onToggle={() => setGroupCollapsed((v) => !v)} trailing={<span className="text-caption text-muted">View all</span>} />
          {!groupCollapsed ? (
            <ListContainer className="rounded-none border-0">
              <ListRow priority="risk">Kick off demo-org build</ListRow>
              <ListRow priority="warn">Reply to Dana</ListRow>
              <ListRow priority="brand" dashed>
                Suggested: follow up on Initech QBR takeaways
              </ListRow>
            </ListContainer>
          ) : null}
        </div>
      </Specimen>
    </KitSection>
  );
}

export function FeedbackSection() {
  return (
    <KitSection id="toasts" eyebrow="Feedback" title="Toasts" intro="Bottom-left, at most 3, ~6 s, paused on hover. Only for reversible things you just did; anything needing action also persists elsewhere.">
      <Specimen label="Tones">
        <Button size="sm" variant="secondary" onClick={() => toast({ title: 'Done: Reply to Dana', body: 'Moved to Closed', undo: { run: () => new Promise((r) => setTimeout(r, 400)) } })}>
          Info + Undo
        </Button>
        <Button size="sm" variant="secondary" onClick={() => toast({ tone: 'success', title: 'Verified in Slack', action: { label: 'View', href: '/outbox' } })}>
          Success + View
        </Button>
        <Button size="sm" variant="secondary" onClick={() => toast({ tone: 'warning', title: 'Budget at 80% of today', body: 'Shown once per day.' })}>
          Warning
        </Button>
        <Button size="sm" variant="secondary" onClick={() => toast({ tone: 'error', title: "Couldn't undo", body: 'It changed since; open its history.', durationMs: null })}>
          Error (sticky)
        </Button>
      </Specimen>
      <Specimen label="Rules" note="one channel per event">
        <Button size="sm" variant="secondary" onClick={() => [1, 2, 3, 4, 5].forEach((n) => toast({ title: `Snoozed item ${n}`, undo: { run: () => undefined } }))}>
          Fire 5 (stack keeps 3)
        </Button>
        <Button size="sm" variant="secondary" onClick={() => toast({ key: 'rerank', title: `Re-ranked at ${new Date().toLocaleTimeString()}`, undo: { run: () => undefined } })}>
          Same key replaces
        </Button>
        <span className="inline-flex items-center gap-1.5 text-caption text-muted">
          Undo the newest with <KbdHint combo="z|mod+z" />
        </span>
      </Specimen>
    </KitSection>
  );
}

export function PaletteSection() {
  const shell = useShellOptional();
  const [pinned, setPinned] = useState(false);
  useCommands([
    { id: 'kit.pin', title: pinned ? 'Unpin the kit demo' : 'Pin the kit demo', group: 'Kit', icon: { set: 'utility', name: 'pin' }, keywords: ['demo'], run: () => setPinned((v) => !v) },
    { id: 'kit.toast', title: 'Show a demo toast', group: 'Kit', shortcut: 't', icon: { set: 'utility', name: 'notification' }, run: () => toast({ title: 'From the palette', undo: { run: () => undefined } }) },
  ]);
  const [focused, setFocused] = useState(true);
  useFocusedCommands(focused ? { label: 'Reply to Dana: confirm scope' } : null, [
    { id: 'kit.item.send', title: 'Send', shortcut: 'mod+enter', icon: { set: 'utility', name: 'send' }, run: () => toast({ title: 'Opened the send confirm' }) },
    { id: 'kit.item.done', title: 'Mark done', shortcut: 'd', keywords: ['archive', 'complete', 'close'], icon: { set: 'utility', name: 'check' }, run: () => toast({ title: 'Done: Reply to Dana', undo: { run: () => undefined } }) },
    { id: 'kit.item.snooze', title: 'Snooze…', shortcut: 's', icon: { set: 'utility', name: 'clock' }, run: () => undefined },
    { id: 'kit.item.open', title: 'Open source in Slack', shortcut: 'o', icon: { set: 'utility', name: 'new_window' }, run: () => undefined },
  ]);
  return (
    <KitSection id="palette" eyebrow="Commands" title="⌘K palette" intro="The focused item's actions come first, each with its key. Search and commands share one box.">
      <Specimen label="Open">
        <Button size="sm" variant="secondary" kbd="mod+k" onClick={() => shell?.setPaletteOpen(true)}>
          Open palette
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setFocused((v) => !v)}>
          {focused ? 'Clear focused item' : 'Focus a demo item'}
        </Button>
        <span className="text-caption text-muted">Registered here: “{pinned ? 'Unpin' : 'Pin'} the kit demo”, “Show a demo toast”. Try typing “archive”.</span>
      </Specimen>
    </KitSection>
  );
}
