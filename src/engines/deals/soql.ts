/**
 * SOQL builders for the Org62 scanner (strings only; NOTHING executes here).
 * Windows are by SystemModstamp so a scan resumes from its cursor (`org62:opps`, `org62:events`, ...).
 * Every query is a read-only SELECT; `assertReadOnlySoql` guards that invariant.
 */

export interface SoqlWindow {
  /** Inclusive lower bound (ISO). */
  from?: string;
  /** Exclusive upper bound (ISO). */
  to?: string;
}

const ID_RE = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function id(v: string): string {
  if (!ID_RE.test(v)) throw new Error(`not a Salesforce id: ${JSON.stringify(v)}`);
  return `'${v}'`;
}
function ids(vs: readonly string[]): string {
  if (!vs.length) throw new Error('empty id list');
  return [...new Set(vs)].sort().map(id).join(',');
}
/** SOQL datetime literal: UTC, seconds precision, no quotes. */
function dt(v: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v) ? new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z') : v;
  if (!DT_RE.test(iso)) throw new Error(`bad datetime: ${v}`);
  return iso;
}
const dateLit = (v: string) => {
  if (!DATE_RE.test(v)) throw new Error(`bad date: ${v}`);
  return v;
};
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function win(w: SoqlWindow | undefined, field = 'SystemModstamp'): string[] {
  const out: string[] = [];
  if (w?.from) out.push(`${field} >= ${dt(w.from)}`);
  if (w?.to) out.push(`${field} < ${dt(w.to)}`);
  return out;
}
const where = (parts: string[]) => (parts.length ? ` WHERE ${parts.join(' AND ')}` : '');

/** Split big id lists (SOQL query length limit): one query per chunk. */
export function chunk<T>(xs: readonly T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function assertReadOnlySoql(soql: string): string {
  if (!/^\s*SELECT\b/i.test(soql)) throw new Error('only SELECT is allowed');
  if (/\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|UNDELETE)\b/i.test(soql.replace(/'(?:[^'\\]|\\.)*'/g, "''"))) throw new Error('DML keyword in SOQL');
  return soql;
}

const OPP_FIELDS = 'Id, Name, AccountId, Account.Name, Amount, StageName, CloseDate, IsClosed, IsWon, Type, Deadline_to_Update__c, SystemModstamp';

/** Opps on a set of accounts, changed in the window. */
export function oppsOnAccounts(accountIds: readonly string[], w?: SoqlWindow): string {
  return assertReadOnlySoql(`SELECT ${OPP_FIELDS} FROM Opportunity${where([`AccountId IN (${ids(accountIds)})`, ...win(w)])} ORDER BY SystemModstamp ASC`);
}

/** Opps by id (used to re-read opps named by events and DCs). */
export function oppsByIds(oppIds: readonly string[], w?: SoqlWindow): string {
  return assertReadOnlySoql(`SELECT ${OPP_FIELDS} FROM Opportunity${where([`Id IN (${ids(oppIds)})`, ...win(w)])} ORDER BY SystemModstamp ASC`);
}

/** Opp-team memberships of a user, optionally only open opps. */
export function myOppTeam(userId: string, opts: { openOnly?: boolean } & SoqlWindow = {}): string {
  const parts = [`UserId = ${id(userId)}`, ...(opts.openOnly ? ['Opportunity.IsClosed = false'] : []), ...win(opts)];
  return assertReadOnlySoql(`SELECT Id, OpportunityId, Opportunity.AccountId, Opportunity.Name, TeamMemberRole, UserId, SystemModstamp FROM OpportunityTeamMember${where(parts)} ORDER BY SystemModstamp ASC`);
}

/** Line items for opps (the D360 / Flex classifier input). */
export function lineItems(oppIds: readonly string[], w?: SoqlWindow): string {
  return assertReadOnlySoql(
    `SELECT Id, OpportunityId, Product2.Name, Product2.ProductCode, Name, Quantity, UnitPrice, TotalPrice, SystemModstamp FROM OpportunityLineItem${where([`OpportunityId IN (${ids(oppIds)})`, ...win(w)])} ORDER BY SystemModstamp ASC`,
  );
}

const DC_FIELDS = 'Id, Opportunity__c, Opportunity__r.Name, Opportunity__r.CloseDate, Opportunity__r.StageName, SE_Name__c, SE_Name__r.Name, Opportunity_Role__c, Split_Percentage__c, SystemModstamp';

/** My Deal Contributions (with Comments__c to check for VDP links). */
export function myDealContributions(userId: string, w?: SoqlWindow): string {
  return assertReadOnlySoql(`SELECT ${DC_FIELDS}, Comments__c FROM Deal_Contribution__c${where([`SE_Name__c = ${id(userId)}`, ...win(w)])} ORDER BY SystemModstamp ASC`);
}

/** Other SEs' DCs on opps (no comments): split awareness. Pass the architect role filter. */
export function otherDealContributions(oppIds: readonly string[], userId: string, w?: SoqlWindow, roleLike = 'AI%Data Architect'): string {
  return assertReadOnlySoql(
    `SELECT ${DC_FIELDS} FROM Deal_Contribution__c${where([`Opportunity__c IN (${ids(oppIds)})`, `SE_Name__c != ${id(userId)}`, `Opportunity_Role__c LIKE ${q(roleLike)}`, ...win(w)])} ORDER BY SystemModstamp ASC`,
  );
}

/** The user's own Events (Solutions Events and legacy types) from a start day, changed in the window. */
export function solutionsEvents(ownerId: string, startDay: string, w?: SoqlWindow): string {
  return assertReadOnlySoql(
    'SELECT Id, Subject, StartDateTime, EndDateTime, Duration__c, SE_Task_Type__c, Meeting_Type__c, RecordType.Name, WhatId, What.Name, OwnerId, CreatedDate, SystemModstamp ' +
      `FROM Event${where([`OwnerId = ${id(ownerId)}`, 'IsChild = false', `StartDateTime >= ${dateLit(startDay)}T00:00:00Z`, ...win(w)])} ORDER BY StartDateTime ASC`,
  );
}

/** Users by id (names for DC holders, manager chain). */
export function users(userIds: readonly string[]): string {
  return assertReadOnlySoql(`SELECT Id, Name, Email, Title, ManagerId, IsActive FROM User WHERE Id IN (${ids(userIds)})`);
}

/** Accounts by id (names and parent, for sibling orgs). */
export function accounts(accountIds: readonly string[], w?: SoqlWindow): string {
  return assertReadOnlySoql(`SELECT Id, Name, ParentId, SystemModstamp FROM Account${where([`Id IN (${ids(accountIds)})`, ...win(w)])} ORDER BY SystemModstamp ASC`);
}

/** The named scan steps the Org62 scanner skill runs for one window. */
export interface ScanQuerySet {
  oppTeam: string;
  myDcs: string;
  events: string;
  oppsOnAccounts: string | null;
  lineItems: string | null;
  otherDcs: string | null;
}

export function buildScanQueries(a: {
  userId: string;
  startDay: string;
  window: SoqlWindow;
  accountIds: readonly string[];
  oppIds: readonly string[];
}): ScanQuerySet {
  return {
    oppTeam: myOppTeam(a.userId, { openOnly: true }),
    myDcs: myDealContributions(a.userId, a.window),
    events: solutionsEvents(a.userId, a.startDay, a.window),
    oppsOnAccounts: a.accountIds.length ? oppsOnAccounts(a.accountIds, a.window) : null,
    lineItems: a.oppIds.length ? lineItems(a.oppIds, a.window) : null,
    otherDcs: a.oppIds.length ? otherDealContributions(a.oppIds, a.userId, a.window) : null,
  };
}
