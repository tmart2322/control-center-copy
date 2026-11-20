'use client';
/**
 * Item actions: Done (d) · Resolve (⇧D, ResolvePicker) · Snooze (s) · Not now (n) · Reopen · Open source (o),
 * plus Accept for suggestions and Confirm for likely-done items.
 *
 * v2 (DESIGN-V2 principle 4, "quiet actions, loud selection"): every action here is quiet (ghost). The
 * view's one filled button belongs to the next step (sheet, page) or the panel footer. `exclude` drops the
 * action the footer already shows as its primary.
 */
import type { NotNowReason, PersonRef, SourceRef, WorkItem } from '@/contract';
import { ResolvePicker, type ResolveValue } from '@/components/domain';
import { Button, Menu, Popover, type MenuEntry, type Placement } from '@/ui';
import { CLOSED_STATES } from '../lib/derive';
import { fmtWhen, whenPresets } from '../lib/tz';

export type ItemActionKey = 'accept' | 'confirm' | 'done' | 'resolve' | 'snooze' | 'not-now' | 'reopen' | 'open-source';

export const NOT_NOW_REASONS: Array<{ reason: NotNowReason; label: string; description: string }> = [
  { reason: 'later', label: 'Later', description: 'Snooze it without a date' },
  { reason: 'done_elsewhere', label: 'Done elsewhere', description: 'Close it as done by you' },
  { reason: 'not_mine', label: 'Not mine', description: 'Dismiss it' },
  { reason: 'wrong_account', label: 'Wrong account', description: 'Unlink the account and keep it' },
];

export interface ItemActionsProps {
  item: WorkItem;
  now: string;
  tz?: string;
  people: PersonRef[];
  threadPeople: string[];
  relatedItems: Array<{ id: string; title: string }>;
  source: SourceRef | null;
  resolveOpen: boolean;
  onResolveOpenChange: (open: boolean) => void;
  snoozeOpen: boolean;
  onSnoozeOpenChange: (open: boolean) => void;
  notNowOpen?: boolean;
  onNotNowOpenChange?: (open: boolean) => void;
  onDone: () => void;
  onResolve: (v: ResolveValue) => void;
  onSnooze: (until: string) => void;
  onNotNow?: (reason: NotNowReason) => void;
  onReopen: () => void;
  onAccept: () => void;
  onConfirmDone: () => void;
  onOpenSource: (s: SourceRef) => void;
  size?: 'xs' | 'sm' | 'md';
  /** Actions drawn elsewhere (the panel footer's primary). */
  exclude?: readonly ItemActionKey[];
  /** Hide Open source (the panel's evidence chips open sources; `o` still works). */
  hideOpenSource?: boolean;
  /** Draw key hints and icons in the buttons (default). The panel footer turns them off to stay calm. */
  hints?: boolean;
  /** Where menus open: below a header (default) or above a footer. */
  placement?: Extract<Placement, 'bottom-end' | 'top-end' | 'top-start' | 'bottom-start'>;
  className?: string;
}

export function ItemActions(p: ItemActionsProps) {
  const { item, size = 'sm', placement = 'bottom-end' } = p;
  const closed = CLOSED_STATES.has(item.state);
  const show = (key: ItemActionKey) => !p.exclude?.includes(key);
  /** Key hints inside the buttons (off in the calm panel footer: the keys stay in titles, ⌘K and the cheat sheet). */
  const k = (combo: string) => (p.hints === false ? undefined : combo);
  const snoozeItems: MenuEntry[] = [
    { type: 'label', label: 'Snooze until' },
    ...whenPresets(p.now, p.tz).map((w) => ({ id: w.id, label: w.label, description: fmtWhen(w.at, p.now, p.tz), onSelect: () => p.onSnooze(w.at) })),
  ];
  const notNowItems: MenuEntry[] = [{ type: 'label', label: 'Not now because' }, ...NOT_NOW_REASONS.map((r) => ({ id: r.reason, label: r.label, description: r.description, onSelect: () => p.onNotNow?.(r.reason) }))];

  return (
    <div className={p.className ?? 'flex flex-wrap items-center gap-1'} role="group" aria-label="Item actions">
      {item.state === 'suggested' && show('accept') ? (
        <Button size={size} variant="ghost" icon="check" kbd={k('a')} title="Accept (a)" onClick={p.onAccept} data-action="accept">
          Accept
        </Button>
      ) : null}
      {item.state === 'likely_done' && show('confirm') ? (
        <Button size={size} variant="ghost" icon="check" onClick={p.onConfirmDone} data-action="confirm">
          Confirm done
        </Button>
      ) : null}
      {!closed ? (
        <Menu
          open={p.snoozeOpen}
          onOpenChange={p.onSnoozeOpenChange}
          label="Snooze"
          placement={placement}
          width={248}
          items={snoozeItems}
          trigger={
            <Button size={size} variant="ghost" icon={p.hints === false ? undefined : 'clock'} kbd={k('s')} title="Snooze (s)" data-action="snooze">
              Snooze
            </Button>
          }
        />
      ) : null}
      {!closed && item.state !== 'likely_done' && show('done') ? (
        <Button size={size} variant="ghost" icon={p.hints === false ? undefined : 'check'} kbd={k('d')} title="Mark done (d)" onClick={p.onDone} data-action="done">
          Done
        </Button>
      ) : null}
      {!closed && p.onNotNow && show('not-now') ? (
        <Menu
          open={p.notNowOpen}
          onOpenChange={p.onNotNowOpenChange}
          label="Not now"
          placement={placement}
          width={264}
          items={notNowItems}
          trigger={
            <Button size={size} variant="ghost" kbd={k('n')} title="Not now (n)" data-action="not-now">
              Not now
            </Button>
          }
        />
      ) : null}
      {!closed && show('resolve') ? (
        <Popover
          open={p.resolveOpen}
          onOpenChange={p.onResolveOpenChange}
          placement={placement}
          label="Resolve"
          initialFocus="first"
          // ResolvePicker brings its own surface; the popover only positions it.
          style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
          trigger={
            <Button size={size} variant="ghost" kbd={k('shift+d')} title="Resolve (⇧D)" data-action="resolve">
              Resolve
            </Button>
          }
        >
          {({ close }) => (
            <ResolvePicker
              title={item.title}
              people={p.people}
              threadPeople={p.threadPeople}
              relatedItems={p.relatedItems}
              onCancel={close}
              onResolve={(v) => {
                close();
                p.onResolve(v);
              }}
            />
          )}
        </Popover>
      ) : null}
      {closed && show('reopen') ? (
        <Button size={size} variant="ghost" icon="undo" onClick={p.onReopen} data-action="reopen">
          Reopen
        </Button>
      ) : null}
      {p.source && !p.hideOpenSource && show('open-source') ? (
        <Button size={size} variant="ghost" icon="new_window" kbd={k('o')} onClick={() => p.onOpenSource(p.source!)} title={p.source.label} data-action="open-source">
          Open source
        </Button>
      ) : null}
    </div>
  );
}
