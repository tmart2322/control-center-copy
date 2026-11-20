'use client';
/**
 * The topbar's "?" button: help for the page you are on (src/guide/pages.ts), for your persona. What the page
 * shows, where its data comes from, the main actions with their keys, and a way to replay the page's coach marks.
 * The `?` key itself stays the keyboard cheat sheet; this is a click.
 */
import { usePathname } from 'next/navigation';
import { forwardRef, useMemo, useState, type ButtonHTMLAttributes } from 'react';
import { usePersona } from '@/client/persona';
import { matchRoute } from '@/components/shell/routes';
import { useShellOptional } from '@/components/shell/ShellContext';
import { IconButton } from '@/ui/Button';
import { KbdHint } from '@/ui/Kbd';
import { Popover } from '@/ui/Popover';
import { Tooltip } from '@/ui/Tooltip';
import { pageHelpFor, type PageHelp } from './pages';
import { CoachMarks, replayCoachMarks } from './CoachMarks';

/** The trigger: a forwardRef button (the Popover attaches its ref and click), with its own hover tooltip. */
const HelpTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { title: string }>(function HelpTrigger({ title, ...rest }, ref) {
  return (
    <Tooltip content="About this page" side="bottom">
      <IconButton ref={ref} icon="help" label={`Help: ${title}`} size="sm" variant="ghost" data-guide="page-help" data-testid="page-help" className="text-muted" {...rest} />
    </Tooltip>
  );
});

export function PageHelpButton() {
  const pathname = usePathname() ?? '/';
  const persona = usePersona();
  const shell = useShellOptional();
  const [open, setOpen] = useState(false);
  const key = matchRoute(pathname.split('?')[0] || '/').key;
  const help = useMemo(() => (key === 'notFound' ? null : pageHelpFor(key, persona)), [key, persona]);
  // the tours mount on every page (one place in the tree, so a request survives the navigation it waits for):
  // Getting started's tips (the Assistant, Feedback) play on pages without help too
  return (
    <>
    <CoachMarks routeKey={key} persona={persona} paused={open} />
    {help ? <HelpPopover help={help} open={open} setOpen={setOpen} canCheat={!!shell} openCheat={() => shell?.setCheatOpen(true)} /> : null}
    </>
  );
}

function HelpPopover({ help, open, setOpen, canCheat, openCheat }: { help: PageHelp; open: boolean; setOpen: (v: boolean) => void; canCheat: boolean; openCheat: () => void }) {
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      width={400}
      label={`About ${help.title}`}
      trigger={<HelpTrigger title={help.title} />}
    >
      {({ close }) => (
        <div className="max-h-[min(70vh,36rem)] overflow-y-auto p-4 text-body" data-testid="page-help-panel">
          <h2 className="text-body font-bold text-fg-heading">{help.title}</h2>
          <p className="mt-1.5 text-fg">{help.shows}</p>
          {help.note ? <p className="mt-1.5 text-fg">{help.note}</p> : null}
          <h3 className="mt-3 text-caption font-bold text-muted">Where it comes from</h3>
          <p className="mt-0.5 text-muted">{help.sources}</p>
          {help.actions.length ? (
            <>
              <h3 className="mt-3 text-caption font-bold text-muted">What you can do</h3>
              <ul className="mt-1 divide-y divide-line">
                {help.actions.map((a) => (
                  <li key={a.text} className="flex min-h-8 items-center gap-3 py-1">
                    <span className="min-w-0 flex-1">{a.text}</span>
                    {a.keys ? <KbdHint combo={a.keys} /> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-caption">
            {help.marks.length ? (
              <button
                type="button"
                className="text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                data-testid="page-help-replay"
                onClick={() => {
                  close();
                  replayCoachMarks(help.key);
                }}
              >
                Show this page’s tips again
              </button>
            ) : null}
            {canCheat ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                onClick={() => {
                  close();
                  openCheat();
                }}
              >
                All keyboard shortcuts <KbdHint combo="?" tone="quiet" />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Popover>
  );
}
