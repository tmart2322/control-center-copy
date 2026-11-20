/**
 * Deals overview: the client side of "what needs you on a deal". The rows themselves are computed once on the server
 * (src/engines/deals/needs.ts `dealsNeeds`: getDeals `needs`, getAccount `needs`; the Assistant reads the same rows),
 * so this module only groups and words them, plus the quiet account-list words and the account page's one need.
 *
 *   Log & fix     a DC gap: open opps of yours with no DC and no request in flight (the server's rule, which names
 *                 each opp). Verb: Claim DC (in place on the account page). Not needed sets it aside per opp.
 *   Think ahead   an open opp closing within 45 days, or whose close date has passed. Verb: Open account.
 *   Chase         a DC you requested that hasn't been granted yet. Verb: Open account.
 *
 * Color is an indicator: a passed close date is red, a close within 14 days or a DC gap on live work is amber,
 * everything else is neutral. Accounts themselves are never colored.
 *
 * Personas (D-55): the server builds the rows for the persona's active Deals features (`DealsFeatures`); the words
 * here take the same features (default all on, which is the SE).
 */
import { myDcWords, type AccountDetail, type AccountRow, type DealsNeed, type MissedOpp, type NeedResolve, type Opportunity } from '@/contract';
import { ALL_DEALS_FEATURES, dcGapEvidence, type DealsFeatures } from '@/engines/deals/needs';
import { daysUntil, fmtDate, fmtHours } from './format';

export { ALL_DEALS_FEATURES, CLOSE_SOON_DAYS, dealsFeaturesOf, type DealsFeatures } from '@/engines/deals/needs';

export type NeedSection = DealsNeed['section'];
export type NeedTone = DealsNeed['tone'];
/** One row of the Needs-you pane: the server's row as is. */
export type NeedRow = DealsNeed;

export const NEED_TITLES: Record<NeedSection, string> = { fix: 'Log & fix', ahead: 'Think ahead', chase: 'Chase' };

/** "Acme Corporation" → "acme" (missed opps carry the Org62 legal name, accounts the short one). */
export function accountKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|company|management|technology|technologies|health|group|of|the)\b/g, ' ')
    .trim()
    .split(/\s+/)[0] ?? '';
}

export function missedForAccount(missed: MissedOpp[], accountName: string): MissedOpp[] {
  const key = accountKey(accountName);
  if (!key) return [];
  return missed.filter((m) => accountKey(m.accountName) === key);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function groupNeeds(rows: readonly NeedRow[]): Array<{ section: NeedSection; title: string; rows: NeedRow[] }> {
  return (['fix', 'ahead', 'chase'] as const)
    .map((s) => ({ section: s, title: NEED_TITLES[s], rows: rows.filter((r) => r.section === s) }))
    .filter((g) => g.rows.length > 0);
}

/** The why line of an account row in the full list: quiet facts, nothing colored. */
export function accountWhy(a: AccountRow, today: string): string {
  if (!a.openOpps) {
    return [a.hoursQtd ? `${fmtHours(a.hoursQtd)} QTD` : null, a.openTasks ? plural(a.openTasks, 'open task') : null, 'no open opps'].filter(Boolean).join(' · ');
  }
  const close = a.nextCloseDate ? `next close ${fmtDate(a.nextCloseDate)}${daysUntil(a.nextCloseDate, today) < 0 ? ' (passed)' : ''}` : 'no close date';
  return [plural(a.openOpps, 'open opp'), close, a.openTasks ? plural(a.openTasks, 'open task') : null, a.hoursQtd ? `${fmtHours(a.hoursQtd)} QTD` : null].filter(Boolean).join(' · ');
}

export const DC_WORD: Record<AccountRow['dcStatus'], string> = { assigned: 'DC assigned', partial: 'DC partial', requested: 'DC requested', none: 'No DC' };
export const VDP_WORD: Record<AccountRow['vdpStatus'], string> = { linked: 'VDP linked', stale: 'VDP stale', none: 'VDP not linked' };

/** My DCs on an account in words: "Your DC: 100% · AI + Data Architect", or "Your DCs on 2 opps: 100%, 50%". */
export function accountDcWords(dcs: AccountRow['myDcs'] | undefined): string | null {
  if (!dcs?.length) return null;
  if (dcs.length === 1) return myDcWords(dcs[0]);
  return `Your DCs on ${dcs.length} opps: ${dcs.map((d) => (d.split === null ? '?' : `${d.split}%`)).join(', ')}`;
}

/** The faint DC and VDP words after an account row's why line ("DC assigned · VDP linked"), active features only. */
export function accountWords(a: Pick<AccountRow, 'openOpps' | 'dcStatus' | 'vdpStatus'> & { myDcs?: AccountRow['myDcs'] }, f: DealsFeatures = ALL_DEALS_FEATURES): string {
  const dc = a.openOpps && f.dc ? (a.dcStatus === 'assigned' ? (accountDcWords(a.myDcs) ?? DC_WORD.assigned) : [DC_WORD[a.dcStatus], a.dcStatus === 'partial' ? accountDcWords(a.myDcs) : null].filter(Boolean).join(' · ')) : null;
  return [dc, a.openOpps && f.vdp ? VDP_WORD[a.vdpStatus] : null].filter(Boolean).join(' · ');
}

/** The Needs-you pane's empty line: what "nothing needs you" covers, in the active features' words only. */
export function needsEmptyLine(f: DealsFeatures = ALL_DEALS_FEATURES): string {
  const sweep = f.missed ? ' Missed opportunities are swept after each Org62 scan.' : '';
  if (f.dc) return `Every account you work has your DC, and nothing closes in the next 45 days.${sweep}`;
  return `Nothing closes in the next 45 days, and no open opp is past its close date.${sweep}`;
}

/** The accounts list's empty body: where accounts come from. */
export function noAccountsLine(f: DealsFeatures = ALL_DEALS_FEATURES): string {
  return f.dc ? 'Accounts appear when Org62 shows you on an opportunity team or a DC. The next scan will pick them up.' : 'Accounts appear when Org62 shows you on an opportunity. The next scan will pick them up.';
}

/** An opp of mine for the account page's close-soon need: on the team, my DC, or my hours (DEALS-1). */
const isMine = (o: Pick<Opportunity, 'isMine' | 'dcAssigned' | 'myDc' | 'hoursQtd'>) => o.isMine || o.dcAssigned || !!o.myDc || (o.hoursQtd ?? 0) > 0;

export interface AccountNeed {
  label: string;
  why: string;
  href: string;
  /** A DC gap: the opp the Claim form opens on, in place (never a trip to Missed, which may not list it). */
  claimOppId?: string;
  /** How the need can be set aside (Not needed, Snooze 1 week); null: it has its own (Missed dismisses per finding). */
  resolve: NeedResolve | null;
}

/**
 * The one thing this account needs from you, if anything, from the server's rows (`d.needs`): a DC gap first (Claim
 * DC on its first opp, Not needed per opp), else a possible missed opp to review, else one of my opps closing within
 * 14 days (when the Think ahead row is not set aside).
 */
export function accountNeed(d: AccountDetail, sweep: MissedOpp[], today: string, f: DealsFeatures = ALL_DEALS_FEATURES): AccountNeed | null {
  const needs = d.needs ?? [];
  const fix = f.dc ? needs.find((n) => n.section === 'fix') : undefined;
  if (fix) return { label: fix.verb.label, why: fix.why, href: fix.verb.href, ...(fix.claimOppId ? { claimOppId: fix.claimOppId } : {}), resolve: fix.resolve };
  // The sweep names Org62 legal accounts ("Globex Inc."); match them to this account as the overview does.
  const ids = new Set(d.missed.map((m) => m.id));
  const missed = f.missed ? [...d.missed, ...missedForAccount(sweep, d.account.name).filter((m) => !ids.has(m.id))].filter((m) => m.status === 'new') : [];
  if (missed.length) return { label: 'Review in Missed', why: `${missed.length} possible missed ${missed.length === 1 ? 'opp' : 'opps'} on this account`, href: `/deals/missed?account=${encodeURIComponent(accountKey(d.account.name))}`, resolve: null };
  const ahead = needs.find((n) => n.section === 'ahead');
  if (!ahead) return null;
  const soon = d.opps.filter((o) => o.isOpen && isMine(o) && o.closeDate && daysUntil(o.closeDate, today) <= 14).sort((a, b) => (a.closeDate ?? '').localeCompare(b.closeDate ?? ''))[0];
  if (soon) return { label: 'Open the opp', why: `${soon.name} closes ${fmtDate(soon.closeDate)}`, href: soon.org62Url ?? `/deals/${d.account.id}`, resolve: ahead.resolve };
  return null;
}

/** The claim form's evidence line for an opp on this account: the server's DC-gap facts when it is one, else the opp's. */
export function claimEvidenceOf(d: Pick<AccountDetail, 'needs'>, o: Pick<Opportunity, 'id' | 'hoursQtd' | 'isMine'>): string {
  const gap = (d.needs ?? []).flatMap((n) => n.opps).find((g) => g.oppId === o.id);
  return dcGapEvidence(gap ?? { hoursQtd: o.hoursQtd ?? 0, onTeam: o.isMine, evidence: [] });
}
