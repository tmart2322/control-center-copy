/**
 * A Time row's issues in plain English (Time ▸ Needs you, Log it, the row's details, the week's rows). The engine and
 * the old autopilot write their notes for the canvas grammar ("NEEDS WhatId: which account/opp was this for? write
 * `=> 006…` or `=> skip`", "CF forced: external attendee (a.example); Neither type -> Customer Discovery, review");
 * nothing on screen shows that text as it is. Each known note becomes one sentence that says what is off and what to
 * do; an unknown one loses its canvas syntax (backticks, `=> …` instructions, "NEEDS"). Pure; the stored flags are
 * unchanged (the engine and the canvas parser still read them).
 */
import type { ActivityEntry, SourceKind } from '@/contract';

/** What a row's work was, by its first source: "Slack work", "A meeting", "Claude session work". */
export function workWord(e: Pick<ActivityEntry, 'sources'>): string {
  const k: SourceKind | undefined = e.sources[0]?.kind;
  switch (k) {
    case 'slack':
      return 'Slack work';
    case 'calendar':
      return 'A meeting';
    case 'claude':
      return 'Claude session work';
    case 'drive':
      return 'Drive work';
    case 'gmail':
      return 'Email work';
    case 'gemini':
      return 'A meeting';
    default:
      return 'This work';
  }
}

const list = (s: string) =>
  s
    .split(/\s*,\s*/)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');

/** Strip the canvas grammar from a note we don't know: backticks, "=> …" instructions, a leading NEEDS. */
function scrub(s: string): string {
  return s
    .replace(/;?\s*(write|add|adjust with|fix (it|them) with)\s+`=>[^`]*`(\s+or\s+`=>[^`]*`)*/gi, '')
    .replace(/`=>[^`]*`/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^NEEDS\s+/i, 'Needs ')
    .replace(/\bWhatId\b/g, 'opportunity')
    .replace(/\s+->\s+/g, ' → ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s;:,]+$/, '')
    .trim();
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * One issue as a sentence. `e` gives the context (its source, for "Slack work with no account"); null drops the note
 * (informational notes the row already says another way).
 */
export function plainIssue(issue: string, e: Pick<ActivityEntry, 'sources'> = { sources: [] }): string | null {
  const s = issue.trim();
  if (!s) return null;
  let m: RegExpExecArray | null;
  // the engine's estimate note: the row logs as estimated
  if (/^GUESS:/i.test(s)) return 'Hours estimated from the evidence: change them if they are off.';
  if (/^NEEDS WhatId: which account was this onsite for/i.test(s)) return 'Onsite day with no account: change the account on the day chip, or pick the opportunity.';
  if (/^NEEDS WhatId/i.test(s)) return `${workWord(e)} with no account: which opportunity, or internal?`;
  if (/^WhatId = account fallback/i.test(s)) return 'Logs to the account for now: no single opportunity stood out. Pick the opportunity.';
  if (/^Needs an opp(?:ortunity)? \(WhatId\) and a task type/i.test(s)) return 'Needs an opportunity and a task type.';
  if ((m = /^CF forced: external attendees? \(([^)]*)\); Neither type -> ([^,;]+?)(?:, review)?$/i.exec(s))) return `Someone from ${list(m[1]!)} was there, so it counts as customer-facing (${m[2]!.trim()}). Check the type.`;
  if ((m = /^CF forced: external attendees? \(([^)]*)\); (.+?) -> (.+)$/i.exec(s))) return `Someone from ${list(m[1]!)} was there, so it counts as customer-facing: ${m[2]!.trim()} became ${m[3]!.trim()}.`;
  if (/^opp you are not on the team for/i.test(s)) return 'You are not on this opportunity’s team: check it is the right one, then approve.';
  if ((m = /^overlaps OOO '(.*)' \((\d{2}:\d{2})\); trim or drop$/i.exec(s))) return `Overlaps your time off “${m[1]}” (${m[2]}): trim the hours or dismiss it.`;
  if ((m = /^overlaps '(.*)': hours are human hours, counted once$/i.exec(s))) return `Overlaps “${m[1]}”: your hours count once.`;
  if (/^double-booked/i.test(s)) return 'Double-booked with another row: your hours count once.';
  if ((m = /^Duration__c ([\d.]+) h differs from End-Start by (\d+) min/i.exec(s))) return `Org62’s Time (Hrs) says ${m[1]} h, ${m[2]} min off its start and end.`;
  if (/^Duration__c is blank in Org62/i.test(s)) return 'Org62’s Time (Hrs) is blank: the next canvas fills it in.';
  if (/^SE_Task_Type__c is blank in Org62/i.test(s)) return 'Org62 has no task type on this Event.';
  if (/^canvas edge rule says Admin/i.test(s)) return 'A recurring internal meeting, kept as Account Planning because it names the account.';
  if (/^account from your onsite trip; confirm/i.test(s)) return 'The account comes from your onsite trip: check it.';
  if (/^travel linked to a customer meeting; confirm/i.test(s)) return 'Travel tied to a customer meeting: check it.';
  if ((m = /^'(.+)' is Neither CF nor CR/i.exec(s))) return `${m[1]} time is not customer work, so it is not logged.`;
  if ((m = /^(.+?): '(.+)' work \(demo org \/ tooling\), Neither CF nor CR/i.exec(s))) return `${m[1]} is ${m[2]} work (a demo org or tooling), not customer work: pick an opportunity if it was for a deal.`;
  if ((m = /^Org62 check: (.+)$/.exec(s))) return `${m[1]!.replace(/\.$/, '')}.`;
  if (/^calendar hold/i.test(s)) return 'A calendar hold, not a meeting: approve it only if you worked then.';
  if (/placeholder/i.test(s) && /^\S*\s*placeholder|a [\d.]+ h block marks/i.test(s)) return 'A placeholder on your calendar, not a meeting: approve it only if you worked then.';
  if (/^optional:/i.test(s)) return 'You were optional on this meeting: approve it if you went.';
  const out = scrub(s);
  return out ? cap(out) : null;
}

/** Every issue of a row as sentences, without repeats (informational notes the caller drops stay out). */
export function plainIssues(e: Pick<ActivityEntry, 'issues' | 'sources'>, keep: (issue: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const i of e.issues) {
    if (!keep(i)) continue;
    const p = plainIssue(i, e);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
