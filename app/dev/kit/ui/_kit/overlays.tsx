'use client';
/**
 * Portaled layers (Tooltip, Popover, Menu, Dialog, SideSheet) render into <body>, so they follow the page theme
 * (?theme=light|dark), not the side-by-side islands. `?open=1` forces the menu and a tooltip open for screenshots;
 * `?open=dialog` opens the confirm; `?open=sheet` opens the side sheet.
 */
import { useState } from 'react';
import { Button, Dialog, EffortSplit, Eyebrow, IconButton, KbdHint, Menu, Popover, SideSheet, SourceChip, StatePill, Tooltip } from '@/ui';
import { Section, Specimen } from './frame';

export function OverlaysSection({ open }: { open: string | null }) {
  const [confirm, setConfirm] = useState<null | 'send' | 'danger'>(open === 'dialog' ? 'send' : null);
  const [menuOpen, setMenuOpen] = useState(open === '1');
  const [sheet, setSheet] = useState(open === 'sheet');
  const [busy, setBusy] = useState(false);
  return (
    <Section id="overlays" title="Layers (page theme)" intro="Tooltip on surface-inverse, menus and popovers on L2 raised, dialogs on L3 overlay over a scrim. These follow the page theme, not the islands.">
      <Specimen label="Tooltip" note="surface-inverse">
        <Tooltip content="Dana asked in #acme-ext; scope changed after Tuesday's call" open={open === '1' ? true : undefined}>
          <Button variant="secondary" size="sm">
            Hover me
          </Button>
        </Tooltip>
        <Tooltip
          content={
            <span className="inline-flex items-center gap-1.5">
              Snooze <KbdHint combo="s" tone="inverse" />
            </span>
          }
          side="bottom"
        >
          <IconButton icon="clock" label="Snooze" />
        </Tooltip>
      </Specimen>
      <Specimen label="Popover">
        <Popover trigger={<Button variant="secondary" size="sm" iconRight="chevrondown">Snooze until…</Button>} width={280} label="Snooze">
          {({ close }) => (
            <div className="p-4">
              <Eyebrow>Snooze until</Eyebrow>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {['Later today', 'Tomorrow 09:00', 'Monday 09:00', 'After the demo'].map((l) => (
                  <Button key={l} size="xs" variant="secondary" onClick={close}>
                    {l}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      </Specimen>
      <Specimen label="Menu" note="↑↓ Home End, typeahead, Esc">
        <div className="min-h-[19rem]">
          <Menu
            label="Row actions"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            placement="bottom-start"
            trigger={<IconButton icon="threedots" label="More actions" variant="outline" size="sm" />}
            items={[
              { type: 'label', label: 'This item' },
              { id: 'done', label: 'Mark done', icon: 'check', kbd: 'e', onSelect: () => undefined },
              { id: 'snooze', label: 'Snooze', icon: 'clock', kbd: 'h', onSelect: () => undefined },
              { id: 'open', label: 'Open source', description: 'Slack · #acme-ext', icon: 'new_window', kbd: 'o', onSelect: () => undefined },
              { type: 'separator' },
              { type: 'radio', id: 'r1', label: 'Roomy', checked: true, onSelect: () => undefined },
              { type: 'radio', id: 'r2', label: 'Compact', checked: false, onSelect: () => undefined },
              { type: 'separator' },
              { id: 'notnow', label: 'Not now…', icon: 'away', kbd: 'n', tone: 'danger', onSelect: () => undefined },
              { id: 'dis', label: 'Disabled item', disabled: true, onSelect: () => undefined },
            ]}
          />
        </div>
      </Specimen>
      <Specimen label="Dialog" note="Cancel focused first">
        <Button variant="primary" onClick={() => setConfirm('send')}>
          Send for real…
        </Button>
        <Button variant="danger" onClick={() => setConfirm('danger')}>
          Discard draft…
        </Button>
        <Dialog
          open={confirm !== null}
          onClose={() => setConfirm(null)}
          title={confirm === 'danger' ? 'Discard this draft?' : 'Turn off dry run for this send?'}
          description={confirm === 'danger' ? 'The draft is removed from the Outbox. You can undo for 10 seconds.' : 'This one reply goes to Slack for real. Everything else stays a draft.'}
          tone={confirm === 'danger' ? 'danger' : 'primary'}
          confirmLabel={confirm === 'danger' ? 'Discard' : 'Send'}
          confirmKbd="mod+enter"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            await new Promise((r) => setTimeout(r, 600));
            setBusy(false);
            setConfirm(null);
          }}
        />
      </Specimen>
      <Specimen label="SideSheet" note="legacy drill-in; v2 routes detail into the right panel">
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open sheet
        </Button>
        <SideSheet
          open={sheet}
          onClose={() => setSheet(false)}
          eyebrow="Task"
          title="Reply to Dana: confirm scope"
          index={1}
          total={4}
          onPrev={() => undefined}
          onNext={() => undefined}
          footer={
            <div className="flex items-center gap-2">
              <Button variant="primary" kbd="mod+enter">
                Send draft
              </Button>
              <Button variant="quiet">Snooze</Button>
              <span className="flex-1" />
              <EffortSplit youMin={5} agentMin={10} compact />
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatePill tone="warn" label="Waiting on you" />
              <SourceChip source="slack" label="#acme-ext · thread" href="https://example.com/slack" />
            </div>
            <p className="max-w-measure text-body text-fg">Dana asked whether the pilot scope still includes the second region. The draft confirms it and links the updated deck.</p>
          </div>
        </SideSheet>
      </Specimen>
    </Section>
  );
}
