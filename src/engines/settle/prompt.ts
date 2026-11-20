/**
 * The Settle prompt (skills/settle-item.md) and its one-object reply. The system prompt is the skill body only
 * (static, byte-stable, cached across calls); the user prompt is the context pack as JSON with short line aliases,
 * so a reply can only cite a line of this item.
 */
import { extractJsonObject } from '@/engines/nba/prompt/json';

import { linesById } from './context';
import { SettleReply, type SettleContext, type SettleLine, type SettleResult } from './types';

const minute = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : (iso ?? null);
};

const view = (l: SettleLine) => ({
  id: l.id,
  at: minute(l.at),
  by: l.by,
  ...(l.where ? { where: l.where } : {}),
  text: l.text,
  ...(l.passed !== undefined ? { passed: l.passed } : {}),
});

export function renderSettlePrompt(c: SettleContext): string {
  return JSON.stringify({
    now: minute(c.now),
    timezone: c.timezone,
    me: c.me,
    item: { ...c.item, due: minute(c.item.due), firstSeen: minute(c.item.firstSeen) },
    hints: c.hints,
    ask: c.ask ? view(c.ask) : null,
    before: c.before.map(view),
    after: c.after.map(view),
    elsewhere: c.elsewhere.map(view),
    events: c.events.map(view),
    siblings: c.siblings.map(view),
    ...(c.corrections.length ? { corrections: c.corrections } : {}),
    ...(c.rules ? { rules: c.rules } : {}),
  });
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * A line of mine that only promises later delivery ("yes I'll get that over tonight", "will send tomorrow", "let me
 * check") and shows nothing delivered. The skill already says a promise is not done; this backs it in code because the
 * model still closed on one (a 0.55 done_by_you whose own reason said nothing reached the person).
 */
// The promise must be about doing or sending something: "I'll be remote" answers a question, it promises nothing.
const DO = '(?:send|get|share|do|look|review|follow|circle|update|ping|try|check|put|write|draft|build|make|reach|set|grab|forward|loop|dig|find|ask|work|take|pull|add|fix|answer|reply|respond|email|call|confirm)';
const PROMISE = new RegExp(`\\b(?:(?:i['’]?ll|i will|i['’]?m going to|i am going to|gonna|will) (?:\\w+ )?${DO}|let me ${DO}|when i['’]?m back)\\b`, 'i');
const DELIVERED = /(?:\bhere(?:['’]s| is| are| you go)\b|\battached\b|\b(?:i |just |i just )?(?:sent|shared|uploaded|forwarded|posted|published|deployed)\b|\bi (?:just )?(?:added|updated|fixed|merged|submitted|did|answered)\b|\bdone\b|https?:\/\/)/i;
export const onlyPromises = (text: string | null | undefined) => !!text && PROMISE.test(text) && !DELIVERED.test(text);

export type ParsedSettle = Pick<SettleResult, 'verdict' | 'confidence' | 'reason' | 'owner' | 'needs' | 'cite' | 'duplicateOf' | 'valid' | 'invalidWhy'>;

/**
 * Parse one reply and check its citation against the rules: done_by_you cites my line after the ask, resolved_by_other
 * someone else's line after the ask, duplicate names a sibling. A broken rule keeps the verdict but marks it invalid
 * (the policy never closes on an invalid verdict).
 */
export function parseSettleReply(text: string, c: SettleContext): ParsedSettle | { error: string } {
  const raw = extractJsonObject(text);
  if (raw.error) return { error: raw.error };
  const p = SettleReply.safeParse(raw.value);
  if (!p.success) return { error: 'reply does not match the settle-item object' };
  const r = p.data;
  const lines = linesById(c);
  const cite = r.cite ? lines.get(r.cite) : undefined;
  const dup = r.duplicate_of ? lines.get(r.duplicate_of) : undefined;
  const askMs = c.ask?.at ? Date.parse(c.ask.at) : NaN;
  const afterAsk = (l: SettleLine | undefined) => !!l && l.kind !== 'before' && l.kind !== 'sibling' && (!Number.isFinite(askMs) || !l.at || Date.parse(l.at) >= askMs - 60_000);
  let invalidWhy: string | undefined;
  if (r.cite && !cite) invalidWhy = `cited ${r.cite}, which is not a line of this item`;
  else if (r.verdict === 'done_by_you' && !(cite && cite.fromMe && afterAsk(cite))) invalidWhy = 'done_by_you must cite my line after the ask';
  else if (r.verdict === 'done_by_you' && onlyPromises(cite?.text)) invalidWhy = 'done_by_you cites a promise, not a delivery';
  else if (r.verdict === 'resolved_by_other' && !(cite && !cite.fromMe && cite.kind !== 'event' && afterAsk(cite))) invalidWhy = "resolved_by_other must cite someone else's line after the ask";
  else if (r.verdict === 'handed_off' && !(cite && cite.fromMe)) invalidWhy = 'handed_off must cite my hand-off line';
  else if (r.verdict === 'waiting_on_them' && !(cite && cite.fromMe && afterAsk(cite))) invalidWhy = 'waiting_on_them must cite my question after the ask';
  else if (r.verdict === 'duplicate' && !(dup && dup.kind === 'sibling')) invalidWhy = 'duplicate must name a sibling';
  else if (r.verdict === 'moment_passed' && cite?.kind === 'event' && !cite.passed) invalidWhy = 'moment_passed cites an event that has not happened';
  return {
    verdict: r.verdict,
    confidence: r.confidence,
    reason: clip(r.reason, 180),
    ...(r.owner ? { owner: r.owner } : {}),
    ...(r.needs ? { needs: clip(r.needs, 120) } : {}),
    ...(cite ? { cite } : {}),
    ...(dup?.workItemId ? { duplicateOf: dup.workItemId } : {}),
    valid: !invalidWhy,
    ...(invalidWhy ? { invalidWhy } : {}),
  };
}
