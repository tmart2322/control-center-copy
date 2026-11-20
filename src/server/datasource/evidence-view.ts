/**
 * GET /items/:id/evidence and the item detail's mention names, shared by both DataSources (pure).
 *
 *  - Evidence: newest first, snippets and summaries redacted again here (ingest already redacted them; the Outbox's
 *    source block does the same), and the names of the Slack users their texts mention.
 *  - Mention names resolve the same way the Outbox source block does: the people directory (a person whose Slack
 *    handle is a user id) wins, then the names the item's own Slack rows carry (db only), then the names the texts
 *    carry themselves (Slack writes most mentions as `<@U…|Dana Reyes>`), so a bare `<@U…>` elsewhere in the same
 *    payload (a cut snippet, a summary, the why line) is named too. Only the ids the texts mention travel; an id
 *    with no name anywhere stays out and the renderer shows "@someone".
 */
import type { Evidence, EvidencePayload, MentionNames } from '@/contract';
import { redact } from '@/connectors/redact';
import { closeCutMarkup, sourceMentionIds } from '@/lib/compose';

type Text = string | null | undefined;

/** The Slack user ids these texts mention, once each. */
export function mentionIdsOf(texts: Iterable<Text>): string[] {
  const out = new Set<string>();
  // a body cut inside a mention (`<@U…` at the end) still names it: the renderer closes it the same way
  for (const t of texts) if (t) for (const id of sourceMentionIds(closeCutMarkup(t))) out.add(id);
  return [...out];
}

const INLINE_RE = /<@([UW][A-Z0-9]+)\|([^<>]+)>/g;

/**
 * The names the texts carry themselves: `<@U…|Dana Reyes>` → U… → "Dana Reyes" (a leading "@" dropped). Only complete
 * mentions: a label cut short by the stored body's cap is not a name.
 */
export function inlineNames(texts: Iterable<Text>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(INLINE_RE)) {
      const [, id, raw] = m;
      const name = raw!.trim().replace(/^@/, '').trim();
      if (name && name !== id && !out[id!]) out[id!] = name;
    }
  }
  return out;
}

/** Names for the ids the texts mention, from the sources in priority order (the first that knows an id wins). */
export function mentionNames(texts: Iterable<Text>, ...sources: ReadonlyArray<Readonly<Record<string, string>>>): MentionNames {
  const out: MentionNames = {};
  for (const id of mentionIdsOf(texts)) {
    const name = sources.map((s) => s[id]).find((n) => !!n?.trim());
    if (name) out[id] = name.trim();
  }
  return out;
}

/** Ids the texts mention that none of the sources name (the db then reads the item's own rows). */
export function unnamedMentions(texts: Iterable<Text>, ...sources: ReadonlyArray<Readonly<Record<string, string>>>): string[] {
  return mentionIdsOf(texts).filter((id) => !sources.some((s) => !!s[id]?.trim()));
}

/** The texts of a work item's evidence that can carry mentions. */
export function evidenceTexts(evidence: readonly Evidence[]): Text[] {
  return evidence.flatMap((e) => [e.snippet, e.summary]);
}

/** The why line and its full reasoning, from the item and its NBA (what the detail's Why section shows). */
export function whyTexts(item: { why: string; whyDetail: string | null }, nba: { why: string; whyDetail: string | null } | null): Text[] {
  return [item.why, item.whyDetail, nba?.why, nba?.whyDetail];
}

const redacted = (s: string) => redact(s).text;

/** GET /items/:id/evidence: newest first, redacted again, with the names its mentions need (the texts' own last). */
export function buildEvidencePayload(workItemId: string, evidence: readonly Evidence[], ...names: ReadonlyArray<Readonly<Record<string, string>>>): EvidencePayload {
  const list = [...evidence]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => ({ ...e, summary: redacted(e.summary), snippet: e.snippet == null ? null : redacted(e.snippet) }));
  const texts = evidenceTexts(list);
  return { workItemId, evidence: list, newCount: list.filter((e) => e.isNew).length, mentions: mentionNames(texts, ...names, inlineNames(texts)) };
}

/**
 * The item detail's names for its why line: the sources given (directory, then rows), then the names the why texts
 * and the item's evidence carry inline (a why that quotes a bare `<@U…>` its evidence names).
 */
export function whyMentionNames(texts: readonly Text[], evidence: readonly Evidence[], ...names: ReadonlyArray<Readonly<Record<string, string>>>): MentionNames {
  return mentionNames(texts, ...names, inlineNames([...texts, ...evidenceTexts(evidence)]));
}
