/**
 * SOQL guardrails for the Assistant's direct Org62 reads (D-58): the chat turn loads the scanners' restricted
 * `Org62-Sobject-Read` server (soqlQuery only), and every query passes through here first (the PreToolUse hook and
 * canUseTool, src/llm/chat/runner.ts):
 *
 *   - one SELECT statement only: no DML words, no `FOR UPDATE / VIEW / REFERENCE` (the last two write view stamps);
 *   - every FROM names an object on the persona's allowlist (or a child relationship of one);
 *   - the top-level LIMIT is at most 2,000, Org62's own per-query maximum (added when missing, lowered when higher);
 *   - an `IN (…)` list holds at most 2,000 values (batch ids into one query instead of one query per id), and the
 *     query at most 100,000 characters (Salesforce's SOQL statement limit).
 *
 * A refused query never reaches Org62; a capped one runs with the new LIMIT and the model is told.
 */
import { featureActive, type ResolvedPersona } from '@/personas';

/** A8 (2026-11-13): Org62's own limits, not ours (2,000 rows per query; a SOQL statement is at most 100,000 characters). */
export const SOQL_MAX_LIMIT = 2_000;
export const SOQL_MAX_IN = 2_000;
export const SOQL_MAX_CHARS = 100_000;

/** Objects any persona may read (Contact and OpportunityContactRole since A8: the people on a deal). */
const BASE_OBJECTS = ['Opportunity', 'Account', 'Event', 'Task', 'OpportunityTeamMember', 'User', 'RecordType', 'OpportunityLineItem', 'Contact', 'OpportunityContactRole'] as const;

/** Child relationship names (subqueries in the SELECT list) and the object each reads. */
const CHILD_RELATIONSHIPS: Record<string, string> = {
  opportunities: 'Opportunity',
  events: 'Event',
  tasks: 'Task',
  opportunityteammembers: 'OpportunityTeamMember',
  opportunitylineitems: 'OpportunityLineItem',
  contacts: 'Contact',
  opportunitycontactroles: 'OpportunityContactRole',
  deal_contributions__r: 'Deal_Contribution__c',
  specialistforecasts__r: 'SpecialistForecast__c',
};

/** The objects this persona's Assistant may query: the base set plus the ones its active features need. */
export function soqlObjectsFor(p: ResolvedPersona | null): string[] {
  const out: string[] = [...BASE_OBJECTS];
  if (featureActive(p, 'dealContributions') || featureActive(p, 'missedOpps')) out.push('Deal_Contribution__c');
  if (featureActive(p, 'specialistForecast') || featureActive(p, 'solutionsJudgement')) out.push('SpecialistForecast__c');
  return out;
}

export type SoqlVerdict = { ok: true; q: string; capped: boolean; note?: string } | { ok: false; reason: string };

/** The query with string literals blanked (same length), so keyword checks never match inside a value. */
function blankStrings(q: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]!;
    if (inStr) {
      if (ch === '\\') {
        out += '  ';
        i++;
        continue;
      }
      if (ch === "'") {
        inStr = false;
        out += ch;
        continue;
      }
      out += ' ';
      continue;
    }
    if (ch === "'") inStr = true;
    out += ch;
  }
  return inStr ? `${out}\u0000` : out;
}

/** Parenthesis depth at each index (of the blanked query). */
function depths(b: string): number[] {
  const d: number[] = [];
  let n = 0;
  for (const ch of b) {
    if (ch === '(') n++;
    d.push(n);
    if (ch === ')') n--;
  }
  return d;
}

export function guardSoql(raw: unknown, p: ResolvedPersona | null): SoqlVerdict {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'pass the query as q (a SOQL SELECT)' };
  let q = raw.trim().replace(/;+\s*$/, '');
  if (q.length > SOQL_MAX_CHARS) return { ok: false, reason: `the query is ${q.length} characters; keep it under ${SOQL_MAX_CHARS} (split the IN list across queries)` };
  const b = blankStrings(q);
  if (b.endsWith('\u0000')) return { ok: false, reason: 'an unterminated string literal' };
  if (!/^select\s/i.test(b)) return { ok: false, reason: 'only SELECT queries are allowed' };
  if (b.includes(';')) return { ok: false, reason: 'one statement only (no ;)' };
  if (/\bfor\s+(update|view|reference)\b/i.test(b)) return { ok: false, reason: 'FOR UPDATE / FOR VIEW / FOR REFERENCE are not allowed (they lock rows or write view stamps)' };
  // SOQL has no DML, and no field is named like these words, so one means a write was attempted.
  if (/\b(insert|update|delete|upsert|merge|undelete)\b/i.test(b)) return { ok: false, reason: 'only SELECT queries are allowed (no DML words)' };
  const allowed = new Set(soqlObjectsFor(p).map((o) => o.toLowerCase()));
  const froms = [...b.matchAll(/\bfrom\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]!);
  if (!froms.length) return { ok: false, reason: 'no FROM object' };
  for (const f of froms) {
    const k = f.toLowerCase();
    const obj = allowed.has(k) ? k : CHILD_RELATIONSHIPS[k]?.toLowerCase();
    if (!obj || !allowed.has(obj)) return { ok: false, reason: `${f} is not on your Org62 object allowlist (${soqlObjectsFor(p).join(', ')})` };
  }
  for (const m of b.matchAll(/\bin\s*\(([^()]*)\)/gi)) {
    if (/^\s*select\b/i.test(m[1]!)) continue;
    const n = m[1]!.split(',').filter((x) => x.trim()).length;
    if (n > SOQL_MAX_IN) return { ok: false, reason: `an IN list has ${n} values; at most ${SOQL_MAX_IN} per query (split it)` };
  }
  // The top-level LIMIT (depth 0): add one, or lower it.
  const d = depths(b);
  const tops = [...b.matchAll(/\blimit\s+(\d+)/gi)].filter((m) => d[m.index!] === 0);
  const top = tops.at(-1);
  if (!top) return { ok: true, q: `${q} LIMIT ${SOQL_MAX_LIMIT}`, capped: true, note: `LIMIT ${SOQL_MAX_LIMIT} added` };
  const n = Number(top[1]);
  if (n <= SOQL_MAX_LIMIT) return { ok: true, q, capped: false };
  const at = top.index!;
  q = `${q.slice(0, at)}LIMIT ${SOQL_MAX_LIMIT}${q.slice(at + top[0].length)}`;
  return { ok: true, q, capped: true, note: `LIMIT ${n} lowered to ${SOQL_MAX_LIMIT}` };
}
