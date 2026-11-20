/**
 * D-67: which use cases need you on the Org62 side, and what each one asks (pure). VDP-side work (add a use case from
 * Org62, take Org62's values) is an item in Time ▸ VDP; canvas rows ride the next logging canvas. What is left here is
 * what only you can decide or do in Org62: values to change there by hand, a record deleted there, a duplicate, a
 * use case Org62 has before its VDP exists, and the ones you left as they are (with Undo).
 */
import type { UseCaseSyncItem, UseCaseSyncPayload } from '@/contract';

/** States the list shows (everything else is quiet, on its way, or in Time ▸ VDP). */
const ATTENTION: ReadonlySet<UseCaseSyncItem['state']> = new Set(['drift', 'gone', 'duplicate', 'org62_only', 'left']);

export interface UcRow {
  key: string;
  title: string;
  where: string;
  /** "Deleted in Org62" · "Duplicate in Org62" · "Differs" · "Only in Org62" · "Left as it is". */
  label: string;
  why: string;
  org62Url: string | null;
  vdpUrl: string | null;
  actions: Array<{ kind: 'readd' | 'leave' | 'undo'; label: string; rule: string }>;
  quiet: boolean;
}

const LABEL: Partial<Record<UseCaseSyncItem['state'], string>> = { drift: 'Differs from VDP', gone: 'Deleted in Org62', duplicate: 'Duplicate in Org62', org62_only: 'Only in Org62', left: 'Left as it is' };

/** A drift needs you here only when some value is changed by hand in Org62 (the rest are VDP items or canvas rows). */
const needsOrg62 = (x: UseCaseSyncItem) => x.state !== 'drift' || x.drift.some((d) => d.fix === 'org62_by_hand' || d.fix === 'choose');
/** An Org62-only use case needs you here only before a VDP lists its opp (else it is an item in Time ▸ VDP). */
const noVdpYet = (x: UseCaseSyncItem) => x.state !== 'org62_only' || !x.vdpSlug;

export function ucRows(p: Pick<UseCaseSyncPayload, 'items'> | null | undefined): UcRow[] {
  const out: UcRow[] = [];
  for (const x of p?.items ?? []) {
    if (!ATTENTION.has(x.state) || !needsOrg62(x) || (x.state !== 'left' && !noVdpYet(x))) continue;
    const actions: UcRow['actions'] = [];
    if (x.decided) actions.push({ kind: 'undo', label: 'Undo', rule: x.decided === 'readd' ? 'use_case_readd' : 'use_case' });
    else {
      if (x.options.includes('readd')) actions.push({ kind: 'readd', label: 'Add it again', rule: 'use_case_readd' });
      if (x.options.includes('leave')) actions.push({ kind: 'leave', label: 'Leave it', rule: 'use_case' });
    }
    out.push({ key: x.key, title: x.title, where: [x.companyName, x.oppName].filter(Boolean).join(' · '), label: LABEL[x.state] ?? x.state, why: x.why, org62Url: x.org62Url, vdpUrl: x.vdpUrl, actions, quiet: x.state === 'left' });
  }
  return out.sort((a, b) => Number(a.quiet) - Number(b.quiet) || a.title.localeCompare(b.title));
}
