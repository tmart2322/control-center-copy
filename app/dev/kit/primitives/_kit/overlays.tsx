'use client';
/** Kit: Tooltip, Popover, Menu, Dialog, SideSheet (+ list keys), Tabs, SegmentedToggle. */
import { useState } from 'react';
import { useListKeys } from '@/client/keyboard/useListKeys';
import { toast } from '@/client/toast/store';
import {
  Button,
  Dialog,
  EffortSplit,
  EntityChip,
  Eyebrow,
  IconButton,
  KbdHint,
  ListContainer,
  ListHeader,
  ListRow,
  Menu,
  Popover,
  SegmentedToggle,
  SideSheet,
  SourceChip,
  StatePill,
  Tabs,
  Tooltip,
  tabPanelProps,
  type Priority,
} from '@/ui';
import { KitSection, Specimen } from './frame';

export function OverlaysSection() {
  const [confirm, setConfirm] = useState<null | 'send' | 'danger'>(null);
  const [busy, setBusy] = useState(false);
  return (
    <KitSection id="overlays" eyebrow="Layers" title="Tooltip, Popover, Menu, Dialog" intro="Dialogs are for short blocking confirms at the border only; Cancel is focused first.">
      <Specimen label="Tooltip" note="navy; hover or focus">
        <Tooltip content="Dana asked in #acme-ext; scope changed after Tue call">
          <Button variant="secondary" size="sm">
            Hover me
          </Button>
        </Tooltip>
        <Tooltip content={<span className="inline-flex items-center gap-1.5">Snooze <KbdHint combo="s" tone="inverse" /></span>} side="bottom">
          <IconButton icon="clock" label="Snooze" />
        </Tooltip>
      </Specimen>
      <Specimen label="Popover">
        <Popover trigger={<Button variant="secondary" size="sm" iconRight="chevrondown">Snooze until…</Button>} width={260} label="Snooze">
          {({ close }) => (
            <div className="p-3">
              <Eyebrow>Snooze until</Eyebrow>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {['Later today', 'Tomorrow 09:00', 'Monday 09:00', 'After ACME demo'].map((l) => (
                  <Button
                    key={l}
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      close();
                      toast({ title: `Snoozed until ${l.toLowerCase()}`, undo: { run: () => undefined } });
                    }}
                  >
                    {l}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      </Specimen>
      <Specimen label="Menu" note="↑↓ Home End, typeahead, Esc">
        <Menu
          label="Row actions"
          trigger={<IconButton icon="threedots" label="More actions" variant="outline" size="sm" />}
          items={[
            { type: 'label', label: 'This item' },
            { id: 'done', label: 'Mark done', icon: 'check', kbd: 'd', onSelect: () => toast({ title: 'Done: Reply to Dana', undo: { run: () => undefined } }) },
            { id: 'resolve', label: 'Resolve with a reason…', icon: 'success', kbd: 'shift+d', onSelect: () => undefined },
            { id: 'snooze', label: 'Snooze', icon: 'clock', kbd: 's', onSelect: () => undefined },
            { id: 'open', label: 'Open source', description: 'Slack · #acme-ext', icon: 'new_window', kbd: 'o', onSelect: () => undefined },
            { type: 'separator' },
            { id: 'notnow', label: 'Not now…', icon: 'away', kbd: 'n', onSelect: () => undefined },
            { id: 'dismiss', label: 'Dismiss', icon: 'close', tone: 'danger', onSelect: () => undefined },
            { id: 'disabled', label: 'Merge (needs a target)', icon: 'merge', disabled: true, onSelect: () => undefined },
          ]}
        />
        <Menu
          label="Sort"
          placement="bottom-start"
          trigger={<Button variant="secondary" size="sm" iconRight="chevrondown">Sort: due</Button>}
          items={[
            { type: 'radio', id: 'due', label: 'Due', checked: true, onSelect: () => undefined },
            { type: 'radio', id: 'start', label: 'Start by', checked: false, onSelect: () => undefined },
            { type: 'radio', id: 'age', label: 'Age', checked: false, onSelect: () => undefined },
          ]}
        />
      </Specimen>
      <Specimen label="Dialog" note="primary · danger · busy">
        <Button variant="secondary" size="sm" onClick={() => setConfirm('send')}>
          Confirm a send
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setConfirm('danger')}>
          Confirm dry-run off
        </Button>
      </Specimen>
      <Dialog
        open={confirm === 'send'}
        onClose={() => setConfirm(null)}
        title="Send to #acme-ext?"
        description="Posts the reply in Dana's thread as you. You get a 10 s undo window after Confirm."
        confirmLabel="Send"
        confirmKbd="mod+enter"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await new Promise((r) => setTimeout(r, 700));
          setBusy(false);
          setConfirm(null);
          toast({ title: 'Sent (dry run): payload rendered only', tone: 'info' });
        }}
      />
      <Dialog
        open={confirm === 'danger'}
        onClose={() => setConfirm(null)}
        title="Turn on live send?"
        description="Approved drafts will post to Slack and Gmail for real."
        confirmLabel="Turn on live send"
        tone="danger"
        onConfirm={() => setConfirm(null)}
      />
    </KitSection>
  );
}

const ROWS: Array<{ id: string; title: string; account: string; due: string; you: number; agent?: number; prio: Priority; state?: { tone: 'warn' | 'brand' | 'ai'; label: string } }> = [
  { id: 'r1', title: 'Kick off demo-org build for the 14:00 demo', account: 'ACME', due: '10:15', you: 10, agent: 100, prio: 'risk', state: { tone: 'warn', label: 'Waiting on you' } },
  { id: 'r2', title: 'Reply to Dana: confirm Thursday demo scope', account: 'ACME', due: '11:00', you: 5, prio: 'warn' },
  { id: 'r3', title: 'Send Globex the SOW redlines', account: 'Globex', due: '15:00', you: 20, prio: 'brand', state: { tone: 'brand', label: 'In progress' } },
  { id: 'r4', title: 'Package the desktop build for Dana', account: 'Initech', due: 'Fri', you: 15, agent: 45, prio: 'none' },
  { id: 'r5', title: 'Finish the D360 accreditation module', account: 'Internal', due: 'Fri', you: 30, prio: 'none', state: { tone: 'ai', label: 'Likely done · Confirm' } },
];

export function SheetSection() {
  const [active, setActive] = useState<string | null>('r2');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('context');
  const ids = ROWS.map((r) => r.id);
  const list = useListKeys({
    scope: 'list:kit',
    ids,
    activeId: active,
    onActiveChange: setActive,
    onOpen: () => setOpen(true),
    actions: {
      d: (id) => toast({ key: `done-${id}`, title: `Done: ${ROWS.find((r) => r.id === id)?.title}`, undo: { run: () => undefined } }),
      s: (id) => toast({ key: `snooze-${id}`, title: `Snoozed: ${ROWS.find((r) => r.id === id)?.title}`, undo: { run: () => undefined } }),
    },
  });
  const idx = active ? ids.indexOf(active) : 0;
  const row = ROWS[idx]!;
  const go = (d: number) => {
    const next = ids[Math.max(0, Math.min(ids.length - 1, idx + d))]!;
    setActive(next);
    list.focusRow(next);
  };
  return (
    <KitSection id="sheet" eyebrow="Drill" title="ListContainer, ListRow, SideSheet, Tabs" intro="Click a row, then j/k, Enter (sheet), d (done), s (snooze), Esc (focus returns to the row). ≥ 2400 px the sheet docks as a column.">
      <Specimen label="List + sheet" stack>
        <ListContainer label="Kit work list" {...list.containerProps}>
          <ListHeader trailing={<span className="text-caption text-muted">5 of 17</span>}>
            <span>Title</span>
          </ListHeader>
          {ROWS.map((r) => (
            <ListRow
              key={r.id}
              priority={r.prio}
              selected={open && r.id === active}
              onClick={() => {
                setActive(r.id);
                setOpen(true);
              }}
              actions={
                <>
                  <IconButton icon="check" label="Done (d)" size="xs" />
                  <IconButton icon="clock" label="Snooze (s)" size="xs" />
                  <IconButton icon="new_window" label="Open source (o)" size="xs" />
                </>
              }
              {...list.rowProps(r.id)}
            >
              <span className="min-w-0 flex-1 truncate font-bold text-fg">{r.title}</span>
              {r.state ? <StatePill size="xs" tone={r.state.tone} label={r.state.label} /> : null}
              <SourceChip source={r.id === 'r1' ? 'claude' : 'slack'} compact />
              <EntityChip kind="account" label={r.account} />
              <EffortSplit youMin={r.you} agentMin={r.agent} className="w-36" />
              <span className="w-12 text-right text-caption text-muted tabular-nums">{r.due}</span>
            </ListRow>
          ))}
        </ListContainer>
      </Specimen>
      <SideSheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Task"
        title={row.title}
        index={idx}
        total={ROWS.length}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onOpenPage={() => toast({ title: 'Would open the full page (⇧Enter)' })}
        returnFocus={() => document.querySelector<HTMLElement>(`[data-key-scope="list:kit"] [data-row-id="${active}"]`)}
        actions={<Button size="sm" variant="primary" kbd="mod+enter">Send</Button>}
        footer={<span className="text-caption text-muted">Sheet and page share field components.</span>}
      >
        <Tabs
          idBase="kit-sheet"
          size="sm"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'context', label: 'Context' },
            { value: 'evidence', label: 'Evidence', count: 3 },
            { value: 'related', label: 'Related', count: 0 },
            { value: 'history', label: 'History' },
          ]}
        />
        <div {...tabPanelProps('kit-sheet', tab)} className="space-y-2 pt-3 text-body">
          <p className="max-w-[72ch]">
            <span className="font-bold">For:</span> ACME demo Thu 14:00. Dana asked in #acme-ext; scope changed after Tuesday&apos;s call.
          </p>
          <div className="flex flex-wrap gap-2">
            <SourceChip source="slack" label="#acme-ext · thread" href="https://example.com" />
            <EntityChip kind="initiative" label="Headless Phase 2 demo" href="/work" />
            <EntityChip kind="person" label="Dana Reyes" />
          </div>
        </div>
      </SideSheet>
    </KitSection>
  );
}

export function NavigationSection() {
  const [tab, setTab] = useState('all');
  const [seg, setSeg] = useState('initiative');
  const [segSm, setSegSm] = useState('compact');
  return (
    <KitSection id="tabs" eyebrow="Navigation" title="Tabs and SegmentedToggle">
      <Specimen label="Tabs md" note="detail tabs: 14 px bold, 3 px bar">
        <Tabs
          className="w-full"
          value={tab}
          onChange={setTab}
          label="Work tabs"
          tabs={[
            { value: 'all', label: 'All open', count: 37 },
            { value: 'said', label: 'Said by me', count: 9 },
            { value: 'asked', label: 'Asked of me', count: 12 },
            { value: 'promises', label: 'Promises', count: 4 },
            { value: 'trainings', label: 'Trainings', count: 2 },
            { value: 'snoozed', label: 'Snoozed', count: 0 },
            { value: 'done', label: 'Done' },
          ]}
          trailing={<Button size="xs" variant="ghost" icon="filterList">Filter</Button>}
        />
      </Specimen>
      <Specimen label="Tabs sm">
        <Tabs size="sm" value={tab === 'all' ? 'context' : 'evidence'} onChange={() => undefined} tabs={[{ value: 'context', label: 'Context' }, { value: 'evidence', label: 'Evidence', count: 2 }, { value: 'history', label: 'History', disabled: true }]} />
      </Specimen>
      <Specimen label="SegmentedToggle" note="xs · sm · md">
        <SegmentedToggle size="xs" label="Density" value={segSm} onChange={setSegSm} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />
        <SegmentedToggle size="sm" label="Group by" value={seg} onChange={setSeg} options={[{ value: 'initiative', label: 'Initiative' }, { value: 'due', label: 'Due date' }, { value: 'source', label: 'Source', disabled: true }]} />
        <SegmentedToggle size="md" label="Mode" value={seg === 'due' ? 'send' : 'draft'} onChange={(v) => setSeg(v === 'send' ? 'due' : 'initiative')} options={[{ value: 'draft', label: 'Draft', icon: 'edit' }, { value: 'send', label: 'Send', icon: 'send' }]} />
      </Specimen>
    </KitSection>
  );
}
