'use client';
/**
 * The sidebar footer's app version line ("v1.0.0 · abc1234", D-57), from GET /version. It links to Settings ▸ About.
 * When the web app and the worker run different versions (or a migration is pending) it turns into a warning that
 * says what to run. Collapsed: only the warning shows, as an icon.
 */
import { useApi } from '@/client/hooks';
import { versionLine } from '@/lib/version-line';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { AppLink } from './AppLink';

const ABOUT = '/settings?section=about';

export function FooterVersion({ collapsed }: { collapsed?: boolean }) {
  // No poll: the version changes on a deploy, which restarts the web app; the live stream's reconnect refetches it.
  const q = useApi('getVersion', undefined, { staleTime: 60_000 });
  if (!q.data) return null;
  const line = versionLine(q.data);
  if (collapsed) {
    if (!line.warn) return null;
    return (
      <Tooltip side="right" content={line.warn}>
        <AppLink href={ABOUT} aria-label={`${line.text}. ${line.warn}`} data-testid="footer-version" className="grid size-10 place-items-center rounded-md text-warning-700 hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus">
          <Icon name="warning" size="md" />
        </AppLink>
      </Tooltip>
    );
  }
  const link = (
    <AppLink
      href={ABOUT}
      data-testid="footer-version"
      aria-label={line.warn ? `${line.text}. ${line.warn}` : `${line.text}. About this version.`}
      className={cn(
        '-mx-2 flex min-h-7 min-w-0 items-center gap-1.5 rounded-md px-2 py-1 no-underline hover:bg-surface-muted hover:no-underline focus-visible:outline-none focus-visible:shadow-focus',
        line.warn ? 'font-bold text-warning-700 hover:text-warning-700' : 'text-faint hover:text-muted',
      )}
    >
      {line.warn ? <Icon name="warning" size="sm" /> : null}
      <span className="min-w-0 truncate tabular-nums">{line.text}</span>
      {line.action ? <span className="shrink-0 font-normal">· {line.action}</span> : null}
    </AppLink>
  );
  return line.warn ? (
    <Tooltip side="right" content={line.warn}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}
