/**
 * The deep links into Deals that other views build (hrefFor, ⌘K, notifications), read back by the Deals pages:
 *
 *   /deals?opp=<oppId>              the opp's account page, with that opportunity open in Details
 *   /deals/<accountId>?opp=<oppId>  the same, once the account is known
 *   /deals?tab=missed&id=<id>       the older form of a missed-opp link: Missed, with that row open
 *   /deals/missed?id=<id>           Missed, with that row open in Details
 *
 * Pure, so tests read them without a browser.
 */
interface Params {
  get(name: string): string | null;
}

export type DealsDeepLink = { kind: 'opp'; id: string } | { kind: 'missed'; href: string } | null;

const clean = (v: string | null | undefined) => v?.trim() || null;

/** What a `/deals?…` URL asks for: open an opp, or go to Missed (with the row to open). */
export function dealsDeepLink(sp: Params | null | undefined): DealsDeepLink {
  if (!sp) return null;
  if (sp.get('tab') === 'missed') {
    const id = clean(sp.get('id'));
    return { kind: 'missed', href: id ? `/deals/missed?id=${encodeURIComponent(id)}` : '/deals/missed' };
  }
  const opp = clean(sp.get('opp'));
  return opp ? { kind: 'opp', id: opp } : null;
}

/** The missed row a `/deals/missed?id=…` URL asks to open. */
export function missedDeepLink(sp: Params | null | undefined): string | null {
  return clean(sp?.get('id'));
}

/**
 * Where `/deals?opp=<id>` lands: the opp's account page with the opp open (`/deals/<accountId>?opp=<id>`), since an
 * opportunity loads with its account. Null while the opp (or its account) is unknown.
 */
export function oppAccountHref(opps: ReadonlyArray<{ id: string; accountId: string | null }> | undefined, oppId: string): string | null {
  const acc = opps?.find((o) => o.id === oppId)?.accountId;
  return acc ? `/deals/${encodeURIComponent(acc)}?opp=${encodeURIComponent(oppId)}` : null;
}

/** The opp an account page's `?opp=` asks to open. */
export function accountOppDeepLink(sp: Params | null | undefined): string | null {
  return clean(sp?.get('opp'));
}
