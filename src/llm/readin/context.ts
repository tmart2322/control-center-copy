/**
 * The deterministic context pack for a read-in (pure over contract records, so the mock and the db build the same
 * thing): the item or meeting, its evidence (redacted excerpts), initiative and siblings, related items on the same
 * account or counterparty, and what I said or committed before. The agent researches only what this lacks.
 */
import type { Account, CalendarEvent, Draft, Evidence, Initiative, Opportunity, Person, ReadInEntity, ReadInTrigger, WorkItemRecord } from '@/contract';
import { redactText } from '@/llm/redact';

import type { ContextEvidence, ContextItemRef, ContextPerson, ReadInContext, ReplyTarget } from './types';

export interface ReadInRecords {
  me: { id: string; name: string; email?: string };
  timezone: string;
  now: Date;
  workItem(id: string): WorkItemRecord | undefined;
  workItems(): WorkItemRecord[];
  evidence(workItemId: string): Evidence[];
  initiative(id: string): Initiative | undefined;
  account(id: string): Account | undefined;
  opp(id: string): Opportunity | undefined;
  event(id: string): CalendarEvent | undefined;
  person(id: string): Person | undefined;
  drafts(workItemId: string): Draft[];
  /** Current generation of a work item (work_items.reeval_generation; the mock uses the record version). */
  generation(workItemId: string): number;
  voice?: string | null;
}

const LIVE = new Set(['suggested', 'open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'snoozed']);
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const clean = (s: string | null | undefined, n = 600) => cap(redactText((s ?? '').replace(/\s+/g, ' ').trim()), n);

function ref(w: WorkItemRecord): ContextItemRef {
  return { id: w.id, title: w.title, kind: w.kind, state: w.state, due: w.due, doneAt: w.doneAt, why: cap(w.why, 140) };
}

function person(r: ReadInRecords, p: { id: string; name: string; role?: string } | null | undefined, accountId?: string | null): ContextPerson | null {
  if (!p) return null;
  const full = r.person(p.id);
  const out: ContextPerson = { name: p.name };
  if (p.role ?? full?.role) out.role = p.role ?? full?.role;
  if (full?.email) out.email = full.email;
  if (full?.slackHandle) out.slackId = full.slackHandle;
  if (full && accountId && full.accountId && full.accountId === accountId) out.external = true;
  if (p.role && /customer|partner|external/i.test(p.role)) out.external = true;
  return out;
}

/** Slack permalink → channel + ts (https://x.slack.com/archives/C0…/p1793893334322509?thread_ts=…). */
export function parseSlackPermalink(url: string | undefined): { channelId: string; ts: string; threadTs: string | null } | null {
  if (!url) return null;
  const m = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?(?:.*&)?thread_ts=(\d+\.\d+))?/.exec(url);
  if (!m) return null;
  return { channelId: m[1]!, ts: `${m[2]}.${m[3]}`, threadTs: m[4] ?? null };
}

export function org62IdFromUrl(url: string | null | undefined): string | null {
  const m = url ? /\/((?:001|006)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)(?:[/?#]|$)/.exec(url) : null;
  return m ? m[1]! : null;
}

function evidenceOf(r: ReadInRecords, e: Evidence): ContextEvidence {
  const fromMe = !!e.author && e.author.trim().toLowerCase() === r.me.name.trim().toLowerCase();
  return {
    id: e.id,
    role: e.role,
    at: e.at,
    source: { kind: e.source.kind, label: e.source.label, ...(e.source.url ? { url: e.source.url } : {}), ...(e.source.externalId ? { externalId: e.source.externalId } : {}) },
    author: e.author,
    fromMe,
    text: clean([e.summary, e.snippet].filter(Boolean).join(' — '), 700),
  };
}

/** Where a reply to this item goes: the item's latest message draft, else its origin thread. */
export function replyTargetFor(r: ReadInRecords, item: WorkItemRecord, evidence: Evidence[]): ReplyTarget | null {
  const draft = r
    .drafts(item.id)
    .filter((d) => d.status !== 'sent' && d.status !== 'discarded' && d.status !== 'rejected')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (draft) {
    const d = draft.destination;
    if (d.kind === 'slack') return { kind: 'slack', target: d.target, channelId: d.channelId, channelName: d.channelName, threadTs: d.threadTs };
    // A VDP item is not a reply: the reply target comes from the evidence below.
    if (d.kind === 'email') return { kind: 'email', to: d.to, subject: d.subject, threadId: d.threadId, inReplyTo: d.inReplyTo };
  }
  const origin = [...evidence].filter((e) => e.role === 'origin').sort((a, b) => b.at.localeCompare(a.at))[0] ?? evidence[0];
  if (!origin) return null;
  if (origin.source.kind === 'slack') {
    const p = parseSlackPermalink(origin.source.url);
    if (!p) return null;
    const isDm = p.channelId.startsWith('D');
    return { kind: 'slack', target: isDm ? 'dm' : 'thread', channelId: p.channelId, channelName: origin.source.label, threadTs: isDm ? p.threadTs : (p.threadTs ?? p.ts), permalink: origin.source.url };
  }
  if (origin.source.kind === 'gmail') {
    const cp = item.counterparty ? r.person(item.counterparty.id) : undefined;
    if (!cp?.email) return null;
    return { kind: 'email', to: [{ name: cp.name, email: cp.email }], subject: `Re: ${cap(item.title, 80)}`, threadId: origin.source.externalId ?? null, inReplyTo: null };
  }
  return null;
}

export interface BuildContextOptions {
  trigger: ReadInTrigger;
  /** Max evidence lines (newest first, origin always kept). */
  maxEvidence?: number;
}

export function buildReadInContext(r: ReadInRecords, entity: ReadInEntity, opts: BuildContextOptions): ReadInContext | null {
  const base = {
    entity,
    trigger: opts.trigger,
    now: r.now.toISOString(),
    timezone: r.timezone,
    me: { name: r.me.name, ...(r.me.email ? { email: r.me.email } : {}) },
    voice: r.voice ?? null,
  };
  const maxEv = opts.maxEvidence ?? 14;
  const all = r.workItems();

  if (entity.type === 'work_item') {
    const item = r.workItem(entity.id);
    if (!item) return null;
    const ev = r.evidence(item.id).sort((a, b) => b.at.localeCompare(a.at));
    const origin = ev.filter((e) => e.role === 'origin');
    const rest = ev.filter((e) => e.role !== 'origin').slice(0, Math.max(0, maxEv - origin.length));
    const evidence = [...origin, ...rest].sort((a, b) => a.at.localeCompare(b.at)).map((e) => evidenceOf(r, e));
    const ini = item.initiativeId ? r.initiative(item.initiativeId) : undefined;
    const acc = item.accountId ? r.account(item.accountId) : undefined;
    const opp = item.oppId ? r.opp(item.oppId) : undefined;
    const siblings = ini ? all.filter((w) => w.id !== item.id && w.initiativeId === ini.id).slice(0, 10).map(ref) : [];
    const cpId = item.counterparty?.id;
    const related = all
      .filter((w) => w.id !== item.id && (!ini || w.initiativeId !== ini.id))
      .filter((w) => (item.accountId && w.accountId === item.accountId) || (cpId && (w.counterparty?.id === cpId || w.people.some((p) => p.id === cpId))))
      .sort((a, b) => (LIVE.has(b.state) ? 1 : 0) - (LIVE.has(a.state) ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map(ref);
    // What I said or committed before: my own messages on this item's thread, and my commitments to the same people/account.
    const said = ev
      .map((e) => evidenceOf(r, e))
      .filter((e) => e.fromMe)
      .map((e) => ({ text: e.text, at: e.at, source: e.source, commitment: /\b(i'?ll|i will|let me|will send|on it|by eod|i can)\b/i.test(e.text) }));
    const commitments = all
      .filter((w) => w.id !== item.id && w.kind === 'commitment')
      .filter((w) => (cpId && w.counterparty?.id === cpId) || (item.accountId && w.accountId === item.accountId) || (ini && w.initiativeId === ini.id))
      .slice(0, 6)
      .map((w) => ({ text: `${w.title}${w.state === 'done' ? ' (done)' : ''}`, at: w.createdAt, source: { kind: 'manual' as const, label: 'Command Center · commitment' }, commitment: true, workItemId: w.id }));
    return {
      ...base,
      skill: 'readin-ask',
      generation: r.generation(item.id),
      item: {
        id: item.id,
        title: item.title,
        purpose: item.purpose,
        kind: item.kind,
        state: item.state,
        due: item.due,
        createdAt: item.createdAt,
        rank: item.rank,
        why: clean(item.why, 240),
        counterparty: person(r, item.counterparty, item.accountId),
        people: item.people.slice(0, 10).map((p) => person(r, p, item.accountId)!).filter(Boolean),
      },
      account: acc ? { id: acc.id, name: acc.name, org62Id: org62IdFromUrl(acc.org62Url) } : null,
      opp: opp ? { id: opp.id, name: opp.name, stage: opp.stage, amount: opp.amount, closeDate: opp.closeDate, org62Id: org62IdFromUrl(opp.org62Url) ?? (/^006[A-Za-z0-9]{12,15}$/.test(opp.id) ? opp.id : null) } : null,
      initiative: ini ? { id: ini.id, title: ini.title, purpose: clean(ini.purpose, 300), summary: clean(ini.summary, 600) } : null,
      evidence,
      siblings,
      related,
      saidBefore: [...said, ...commitments].slice(0, 10),
      reply: replyTargetFor(r, item, ev),
    };
  }

  const event = r.event(entity.id);
  if (!event) return null;
  const linked = all.filter((w) => w.servesEventId === event.id || event.prep?.workItemId === w.id || event.takeaways?.workItemIds.includes(w.id));
  const acc = event.accountId ? r.account(event.accountId) : undefined;
  const opp = event.oppId ? r.opp(event.oppId) : undefined;
  const evidence = linked
    .flatMap((w) => r.evidence(w.id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, maxEv)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => evidenceOf(r, e));
  const ini = linked.map((w) => (w.initiativeId ? r.initiative(w.initiativeId) : undefined)).find(Boolean);
  const related = all
    .filter((w) => !linked.includes(w) && ((event.accountId && w.accountId === event.accountId) || (ini && w.initiativeId === ini.id)))
    .slice(0, 8)
    .map(ref);
  return {
    ...base,
    skill: 'readin-meeting',
    generation: linked.reduce((a, w) => a + r.generation(w.id), 0),
    event: {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      attendees: event.attendees.slice(0, 20).map((p) => person(r, p, event.accountId)!).filter(Boolean),
      linkedItems: linked.map(ref),
      ...(event.source.url ? { url: event.source.url } : {}),
    },
    account: acc ? { id: acc.id, name: acc.name, org62Id: org62IdFromUrl(acc.org62Url) } : null,
    opp: opp ? { id: opp.id, name: opp.name, stage: opp.stage, amount: opp.amount, closeDate: opp.closeDate, org62Id: org62IdFromUrl(opp.org62Url) } : null,
    initiative: ini ? { id: ini.id, title: ini.title, purpose: clean(ini.purpose, 300), summary: clean(ini.summary, 600) } : null,
    evidence,
    siblings: [],
    related,
    saidBefore: evidence.filter((e) => e.fromMe).map((e) => ({ text: e.text, at: e.at, source: e.source, commitment: false })),
    reply: null,
  };
}

/** Every URL the context pack shows the agent (the output may cite only these, plus tool results). */
export function contextUrls(c: ReadInContext): string[] {
  const out = new Set<string>();
  for (const e of c.evidence) if (e.source.url) out.add(e.source.url);
  for (const s of c.saidBefore) if (s.source.url) out.add(s.source.url);
  if (c.event?.url) out.add(c.event.url);
  if (c.reply?.kind === 'slack' && c.reply.permalink) out.add(c.reply.permalink);
  return [...out];
}
