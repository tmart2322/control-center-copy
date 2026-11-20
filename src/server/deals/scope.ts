/**
 * D-68 (dc-roundtrip): book and scope rules shared by both DataSources and the hygiene sweep. Pure.
 *
 *  - DC-24 `accountMerges`: an account merged in Org62 is one every opp of which moved to one other account (the
 *    survivor), with no opp left on it. Strong evidence only: one opp re-parented while others stay is a move (DC-21),
 *    never a merge, and two survivors are no merge either.
 *  - DC-10 `vdpItemsOutOfScope`: pending VDP items for an account that left the 100%-DC scope (D-63: no open opp
 *    where my DC is 100%) are withdrawn, never pushed for an account that is no longer mine for VDP.
 */
import type { AccountMove, Org62Book } from '@/projections/types';

const id15 = (s: string) => s.slice(0, 15);

/** Why a pending VDP item was withdrawn when its account left the scope (the draft's reject reason). */
export const VDP_SCOPE_WITHDRAWN_REASON = 'Withdrawn: the account has no open opp where your DC is 100% any more (it left your VDP scope)';

/** The accounts merged away in Org62 (`from`) and the account that took them over (`to`), from the opp moves. */
export function accountMerges(book: Pick<Org62Book, 'opps'> & { accountMoves?: readonly AccountMove[] }): Array<{ from: string; to: string; opps: number }> {
  const moves = book.accountMoves ?? [];
  if (!moves.length) return [];
  const stillOn = new Set(book.opps.map((o) => (o.org62AccountId ? id15(o.org62AccountId) : null)).filter((x): x is string => !!x));
  const by = new Map<string, { from: string; to: Set<string>; opps: Set<string> }>();
  for (const m of moves) {
    const k = id15(m.from);
    const cur = by.get(k) ?? { from: m.from, to: new Set<string>(), opps: new Set<string>() };
    cur.to.add(id15(m.to));
    cur.opps.add(id15(m.org62OpportunityId));
    by.set(k, cur);
  }
  const out: Array<{ from: string; to: string; opps: number }> = [];
  for (const [k, v] of by) {
    if (stillOn.has(k) || v.to.size !== 1) continue;
    const to = moves.find((m) => id15(m.from) === k)!.to;
    out.push({ from: v.from, to, opps: v.opps.size });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** A pending VDP item: its draft id, the account it is for (null: unknown), and whether you edited it. */
export interface VdpItemScope {
  id: string;
  accountId: string | null;
  editedByUser: boolean;
}

/** The items to withdraw: for an account no longer engaged (no open opp at 100% DC), never one you edited. */
export function vdpItemsOutOfScope(items: readonly VdpItemScope[], engagedAccountIds: ReadonlySet<string>): string[] {
  return items.filter((d) => !d.editedByUser && !!d.accountId && !engagedAccountIds.has(d.accountId)).map((d) => d.id);
}
