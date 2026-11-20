/**
 * The origin-source link every row carries (tenet: Provenance on everything): the first source with a URL, and its
 * screen-reader name ("Open in Slack", "Open in Gmail", "Open in Calendar"). Pure.
 */
import type { SourceRef } from '@/contract';
import { SOURCE_META } from '@/ui';

export function originSource<S extends Pick<SourceRef, 'url'>>(sources: readonly S[] | null | undefined): (S & { url: string }) | null {
  return (sources?.find((s) => !!s.url) as (S & { url: string }) | undefined) ?? null;
}

/** "Open in Slack" · "Open in Gmail" · … ("Open source" for a manual or unknown kind). */
export function openInLabel(kind: SourceRef['kind'] | null | undefined): string {
  if (!kind || kind === 'manual') return 'Open source';
  const meta = SOURCE_META[kind];
  return meta ? `Open in ${meta.label}` : 'Open source';
}
