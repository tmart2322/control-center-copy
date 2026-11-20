import { normalizeSlackText, scrubExemplar, words, type NormalizedText } from './normalize';
import { AUDIENCES, voiceProfileSchema, type Audience, type AudienceStats, type SentMessage, type VoiceProfile } from './types';

/**
 * Deterministic voice profile builder. Input: the user's sent Slack messages. Output: a compact,
 * explainable profile (scales, habits, phrases, per-audience stats, a few exemplars).
 * An optional LLM pass (./synthesize.ts) can refine the prose guides afterwards.
 */

export interface BuildVoiceOptions {
  userLabel: string;
  now?: string;
  /** Channel-name patterns that mark account/customer channels (team pack). */
  accountChannelPatterns?: RegExp[];
  /** Channel-name patterns that mark external (shared) channels. */
  externalChannelPatterns?: RegExp[];
  /** Terms never to show in phrases or exemplars (customer names, aliases). */
  scrubTerms?: string[];
  maxExemplarsPerAudience?: number;
}

const DEFAULT_ACCOUNT_PATTERNS = [/^zc:/i, /^acct-/i, /^oppty-/i, /^sic-/i, /^cust(omer)?-/i];
const DEFAULT_EXTERNAL_PATTERNS = [/-ext$/i, /^ext-/i, /-external$/i, /^shared-/i];

const STOP_STRICT = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'it', 'for', 'that', 'this', 'with', 'be', 'are', 'at', 'as', 'we', 'you', 'i', 'so', 'if', 'but', 'my', 'me', 'our', 'they', 'them', 'he', 'she', 'his', 'her', 'was', 'have', 'has', 'do', 'not', 'can', 'up', 'out', 'from', 'by', 'what', 'there', 'its', "it's", 'all', 'just', 'one', 'some', 'any']);

const ABBREVIATIONS = ['fyi', 'btw', 'imo', 'imho', 'lmk', 'lyk', 'eod', 'eow', 'asap', 'tbh', 'ooo', 'haha', 'lol', 'np', 'ty', 'thx', 'wfh', 'ooh'];

const SIGNATURES: Array<{ phrase: string; re: RegExp }> = [
  { phrase: 'Mind <doing X>?', re: /\bmind (sending|reaching|giving|taking|sharing|looping|adding|checking|joining|looking)\b/i },
  { phrase: 'Happy to …', re: /\bhappy to\b/i },
  { phrase: "I'll … (commitment)", re: /\bi'?ll (get|send|make|take|have|do|put|set|follow|look|share|review|check|reach)\b/i },
  { phrase: 'by EOD', re: /\bby eod\b/i },
  { phrase: 'Let me know', re: /\blet me know\b/i },
  { phrase: 'lmk / lyk', re: /\b(lmk|lyk)\b/i },
  { phrase: 'Ping me', re: /\bping me\b/i },
  { phrase: 'fyi', re: /\bfyi\b/i },
  { phrase: 'btw', re: /\bbtw\b/i },
  { phrase: 'imo', re: /\bimo\b/i },
  { phrase: 'haha', re: /\bhaha\b/i },
  { phrase: "Let's go!", re: /\blet'?s go\b/i },
  { phrase: 'Nice work …!', re: /\bnice work\b/i },
  { phrase: 'Looks great / awesome', re: /\blooks? (great|awesome|good)\b/i },
  { phrase: 'Thank you / thanks', re: /\b(thank you|thanks)\b/i },
  { phrase: 'Will do / will make sure', re: /\bwill (do|make sure)\b/i },
  { phrase: 'Sounds good', re: /\bsounds good\b/i },
  { phrase: 'Make sure …', re: /\bmake sure\b/i },
  { phrase: 'Just let me know', re: /\bjust let me know\b/i },
  { phrase: 'Worth …', re: /\bworth (reading|a look|checking)\b/i },
];

const OPENER_SKIP = new Set(['@', '<link>']);

interface Analyzed {
  m: SentMessage;
  n: NormalizedText;
  w: string[];
  audience: Audience;
  longForm: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(((sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo)) * 10) / 10;
}

const shareOf = <T>(xs: T[], pred: (x: T) => boolean) => (xs.length ? Math.round((xs.filter(pred).length / xs.length) * 1000) / 1000 : 0);

export function classifyAudience(m: SentMessage, opts: BuildVoiceOptions): Audience {
  const name = m.channelName ?? '';
  if ((opts.externalChannelPatterns ?? DEFAULT_EXTERNAL_PATTERNS).some((re) => re.test(name))) return 'external';
  if (m.channelType === 'dm') return 'dm';
  if (m.channelType === 'group_dm') return 'group';
  if ((opts.accountChannelPatterns ?? DEFAULT_ACCOUNT_PATTERNS).some((re) => re.test(name))) return 'account_channel';
  return 'channel';
}

/** Long pasted material (AI output, docs) isn't his conversational voice. */
export function isLongForm(text: string): boolean {
  const len = text.length;
  if (len > 1200) return true;
  if (len < 600) return false;
  const emDashes = (text.match(/—/g) ?? []).length;
  const headerLines = text.split('\n').filter((l) => /^[^\s•◦-].{2,60}:\s*$/.test(l.trim()) || /^:[a-z_]+:\s/.test(l.trim())).length;
  return emDashes >= 2 || headerLines >= 2 || /\bThe Math:/.test(text);
}

const GREETING_RE = /^(hey|hi|hello|morning|good morning|afternoon)\b[,!.]?\s*(@?[A-Za-z]+)?/i;

function greetingForm(text: string): string | null {
  const m = GREETING_RE.exec(text.trim());
  if (!m) return null;
  const g = (m[1] ?? '').toLowerCase();
  const w = (m[2] ?? '').replace(/^@/, '');
  const head = g.charAt(0).toUpperCase() + g.slice(1);
  if (!w) return head;
  if (/^(guys|all|everyone|team|folks|there)$/i.test(w)) return `${head} ${w.toLowerCase()}`;
  if (/^[A-Z]/.test(w)) return `${head} <first name>`;
  return head;
}

const SIGNOFF_RE = /\n\s*(thanks|thank you|best|cheers|regards|thx)[,!.]?\s*\n?\s*[A-Z][a-z]+\s*$/i;

function phraseCounts(items: Analyzed[], properNouns: Set<string>): Array<{ phrase: string; count: number }> {
  const counts = new Map<string, number>();
  for (const a of items) {
    const seen = new Set<string>();
    const ws = a.w;
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const gram = ws.slice(i, i + n);
        if (gram.every((g) => STOP_STRICT.has(g))) continue;
        if (gram.some((g) => properNouns.has(g) || /\d/.test(g))) continue;
        if (STOP_STRICT.has(gram[0] ?? '') && STOP_STRICT.has(gram[gram.length - 1] ?? '') && n === 2) continue;
        // "the demo", "a couple": content nouns, not voice
        if (n === 2 && ['the', 'a', 'an'].includes(gram[0] ?? '')) continue;
        const key = gram.join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const ranked = [...counts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  // prefer the longer phrase when it carries most of the shorter one's uses
  const kept: Array<{ phrase: string; count: number }> = [];
  for (const [phrase, count] of ranked) {
    const covered = ranked.some(([p, c]) => p !== phrase && p.includes(phrase) && c >= count * 0.8);
    if (!covered) kept.push({ phrase, count });
    if (kept.length >= 25) break;
  }
  return kept;
}

function collectProperNouns(items: Analyzed[], scrub: string[]): Set<string> {
  const counts = new Map<string, { cap: number; total: number }>();
  for (const a of items) {
    const tokens = a.n.text.replace(/@\w+/g, ' ').split(/[^A-Za-z0-9']+/).filter(Boolean);
    tokens.forEach((tok, i) => {
      const low = tok.toLowerCase();
      const c = counts.get(low) ?? { cap: 0, total: 0 };
      c.total++;
      if (i > 0 && /^[A-Z]/.test(tok) && low !== 'i' && !/^i'/.test(low)) c.cap++;
      counts.set(low, c);
    });
  }
  const set = new Set<string>();
  for (const [w, c] of counts) if (c.cap > 0 && c.cap / c.total >= 0.5) set.add(w);
  for (const s of scrub) for (const part of s.toLowerCase().split(/\s+/)) set.add(part);
  return set;
}

function audienceStats(items: Analyzed[]): AudienceStats {
  const wc = items.map((a) => a.w.length).sort((x, y) => x - y);
  return {
    count: items.length,
    medianWords: quantile(wc, 0.5),
    p75Words: quantile(wc, 0.75),
    shareEmoji: shareOf(items, (a) => a.n.emoji.length > 0),
    shareQuestion: shareOf(items, (a) => a.n.text.includes('?')),
    shareGreeting: shareOf(items, (a) => greetingForm(a.n.text) !== null),
    shareBullets: shareOf(items, (a) => /^\s*[•◦\-*]\s/m.test(a.n.text)),
  };
}

const ALLOWED_CAPS = new Set(['I', 'OK', 'Okay', 'Slack', 'Claude', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'MT', 'ET', 'PT', 'EOD']);

function exemplarCandidate(a: Analyzed, properNouns: Set<string>): boolean {
  const t = a.n.text;
  if (a.n.hadSecret || a.n.linkCount > 0 || a.longForm) return false;
  if (a.w.length < 6 || a.w.length > 45) return false;
  // avoid customer/product names leaking across drafts: only sentence-initial caps, acronyms and a small allowlist
  const sentences = t.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    const toks = s.replace(/@\w+/g, '').split(/[^A-Za-z0-9']+/).filter(Boolean);
    for (let i = 1; i < toks.length; i++) {
      const tok = toks[i] ?? '';
      if (/^[A-Z][a-z]/.test(tok) && !ALLOWED_CAPS.has(tok)) return false;
    }
  }
  return !a.w.some((w) => properNouns.has(w) && w.length > 3 && !ALLOWED_CAPS.has(w.charAt(0).toUpperCase() + w.slice(1)));
}

function pickExemplars(items: Analyzed[], properNouns: Set<string>, perAudience: number): VoiceProfile['exemplars'] {
  const out: VoiceProfile['exemplars'] = [];
  for (const aud of AUDIENCES) {
    const pool = items.filter((a) => a.audience === aud && exemplarCandidate(a, properNouns));
    if (!pool.length) continue;
    const med = quantile(pool.map((a) => a.w.length).sort((x, y) => x - y), 0.5);
    const scored = pool
      .map((a) => ({ a, score: Math.abs(a.w.length - med) - SIGNATURES.filter((s) => s.re.test(a.n.text)).length * 4 }))
      .sort((x, y) => x.score - y.score);
    const chosen: string[] = [];
    for (const { a } of scored) {
      const text = scrubExemplar(a.n.text).replace(/\s+\n/g, '\n').slice(0, 280);
      if (chosen.some((c) => c.slice(0, 30) === text.slice(0, 30))) continue;
      chosen.push(text);
      out.push({ audience: aud, text });
      if (chosen.length >= perAudience) break;
    }
  }
  return out.slice(0, 15);
}

function scales(conv: Analyzed[], stats: VoiceProfile['stats'], greetingShare: number, hasSignoff: boolean) {
  const med = stats.words.median;
  const verbosity = med <= 6 ? 1 : med <= 14 ? 2 : med <= 28 ? 3 : med <= 50 ? 4 : 5;
  let formality = 3;
  const abbrevPerMsg = stats.abbreviations.reduce((s, a) => s + a.count, 0) / Math.max(1, conv.length);
  if (stats.contractionsPer100Words >= 2) formality--;
  if (abbrevPerMsg >= 0.05 || stats.shareLowercaseStart >= 0.15 || stats.shareEndsWithPeriod < 0.4) formality--;
  if (greetingShare >= 0.3 && hasSignoff) formality++;
  formality = Math.min(5, Math.max(1, formality));
  const e = stats.shareEmoji;
  const emojiUse = e < 0.02 ? 0 : e < 0.1 ? 1 : e < 0.25 ? 2 : 3;
  return { verbosity, formality, emojiUse };
}

function toneFrom(stats: VoiceProfile['stats'], sigs: Array<{ phrase: string; count: number }>, n: number): string {
  const has = (p: string) => (sigs.find((s) => s.phrase === p)?.count ?? 0) / Math.max(1, n);
  const parts: string[] = [];
  parts.push(stats.words.median <= 15 ? 'Direct and brief' : 'Direct');
  if (has('Thank you / thanks') + has('Nice work …!') + has('Looks great / awesome') + has("Let's go!") >= 0.05 || stats.shareExclamation >= 0.06) parts.push('warm and upbeat with teammates');
  if (has('Happy to …') + has("I'll … (commitment)") + has('Will do / will make sure') >= 0.06) parts.push('helpful, owns next steps');
  if (stats.shareLongForm >= 0.05 || stats.shareNumbered >= 0.04) parts.push('goes deep and structured on technical questions');
  if (has('haha') > 0 || stats.shareEmoji >= 0.05) parts.push('light humor');
  return parts.join('; ');
}

export function buildVoiceProfile(messages: SentMessage[], opts: BuildVoiceOptions): VoiceProfile {
  const now = opts.now ?? new Date().toISOString();
  const excluded = { empty: 0, linkOnly: 0, longForm: 0, secrets: 0 };
  const analyzed: Analyzed[] = [];
  for (const m of messages) {
    const n = normalizeSlackText(m.text);
    const w = words(n.text);
    if (!n.text || n.text.replace(/<link>|@\w+|\s|[.,!?]/g, '').length === 0) {
      if (n.linkCount > 0 || n.mentionCount > 0) excluded.linkOnly++;
      else excluded.empty++;
      continue;
    }
    if (w.length === 0) {
      excluded.empty++;
      continue;
    }
    if (n.hadSecret) excluded.secrets++;
    const longForm = isLongForm(n.text);
    analyzed.push({ m, n, w, audience: classifyAudience(m, opts), longForm });
  }
  const conv = analyzed.filter((a) => !a.longForm);
  excluded.longForm = analyzed.length - conv.length;

  const wc = conv.map((a) => a.w.length).sort((a, b) => a - b);
  const totalWords = conv.reduce((s, a) => s + a.w.length, 0) || 1;
  const abbreviations = ABBREVIATIONS.map((term) => ({ term, count: conv.filter((a) => a.w.includes(term)).length }))
    .filter((a) => a.count > 0)
    .sort((a, b) => b.count - a.count);
  const emojiCounts = new Map<string, number>();
  for (const a of conv) for (const e of a.n.emoji) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);

  const stats: VoiceProfile['stats'] = {
    words: { p25: quantile(wc, 0.25), median: quantile(wc, 0.5), p75: quantile(wc, 0.75), p90: quantile(wc, 0.9) },
    shareOneLine: shareOf(conv, (a) => !a.n.text.includes('\n')),
    shareMultiParagraph: shareOf(conv, (a) => /\n\s*\n/.test(a.n.text)),
    shareBullets: shareOf(conv, (a) => /^\s*[•◦\-*]\s/m.test(a.n.text)),
    shareNumbered: shareOf(conv, (a) => /^\s*\d+[.)]\s/m.test(a.n.text)),
    shareMention: shareOf(conv, (a) => a.n.mentionCount > 0),
    shareStartsWithMention: shareOf(conv, (a) => a.n.startsWithMention),
    shareEmoji: shareOf(conv, (a) => a.n.emoji.length > 0),
    topEmoji: [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e]) => `:${e}:`),
    shareLinks: shareOf(analyzed, (a) => a.n.linkCount > 0),
    shareQuestion: shareOf(conv, (a) => a.n.text.includes('?')),
    shareExclamation: shareOf(conv, (a) => a.n.text.includes('!')),
    shareLowercaseStart: shareOf(conv, (a) => /^[a-z]/.test(a.n.text.replace(/^@\w+\s*/, ''))),
    shareEndsWithPeriod: shareOf(conv, (a) => /\.\s*$/.test(a.n.text)),
    semicolonsPer100Words: Math.round((conv.reduce((s, a) => s + (a.n.text.match(/;/g) ?? []).length, 0) / totalWords) * 1000) / 10,
    shareParenthetical: shareOf(conv, (a) => /\([^)]{3,}\)/.test(a.n.text)),
    contractionsPer100Words: Math.round((conv.reduce((s, a) => s + a.w.filter((w) => /'(ll|re|ve|d|s|t|m)$/.test(w)).length, 0) / totalWords) * 1000) / 10,
    shareLongForm: shareOf(analyzed, (a) => a.longForm),
    abbreviations: abbreviations.slice(0, 15),
  };

  const greetingCounts = new Map<string, number>();
  for (const a of conv) {
    const g = greetingForm(a.n.text.replace(/^@\w+\s*/, ''));
    if (g) greetingCounts.set(g, (greetingCounts.get(g) ?? 0) + 1);
  }
  const greetings = [...greetingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([form, count]) => ({ form, count }));
  const greetingShare = shareOf(conv, (a) => greetingForm(a.n.text.replace(/^@\w+\s*/, '')) !== null);
  const signoffs = conv.filter((a) => SIGNOFF_RE.test(a.n.text)).length;
  const hasSignoff = signoffs / Math.max(1, conv.length) >= 0.2;

  const openerCounts = new Map<string, number>();
  for (const a of conv) {
    const first = a.n.text.replace(/^(@\w+[\s,]*)+/, '').trim().split(/[\s,.!?;:]+/)[0]?.toLowerCase().replace(/[^a-z']/g, '');
    if (first && !OPENER_SKIP.has(first)) openerCounts.set(first, (openerCounts.get(first) ?? 0) + 1);
  }
  const openers = [...openerCounts.entries()]
    .filter(([w, c]) => c >= 3 && !STOP_STRICT.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word, c]) => ({ word, share: Math.round((c / Math.max(1, conv.length)) * 1000) / 1000 }));

  const signatures = SIGNATURES.map((s) => ({ phrase: s.phrase, count: conv.filter((a) => s.re.test(a.n.text)).length }))
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count);

  const properNouns = collectProperNouns(analyzed, opts.scrubTerms ?? []);
  const commonPhrases = phraseCounts(conv, properNouns);

  const audiences: Record<string, AudienceStats> = {};
  for (const aud of AUDIENCES) {
    const items = conv.filter((a) => a.audience === aud);
    if (items.length) audiences[aud] = audienceStats(items);
  }
  const sc = scales(conv, stats, greetingShare, hasSignoff);
  const topGreeting = greetings[0];
  const greeting = topGreeting && greetingShare >= 0.03 ? `${topGreeting.form} (only when opening a thread or DM; replies start with the answer)` : null;
  const tone = toneFrom(stats, signatures, conv.length);

  const sigList = signatures.slice(0, 8).map((s) => s.phrase);
  const habit = (cond: boolean, text: string) => (cond ? [text] : []);
  const styleGuide = [
    `Median message is ${stats.words.median} words (p75 ${stats.words.p75}); ${Math.round(stats.shareOneLine * 100)}% are one line.`,
    'Leads with the answer or the ask; context after, if any.',
    ...habit(stats.semicolonsPer100Words >= 0.3, 'Often joins clauses with semicolons.'),
    ...habit(stats.shareParenthetical >= 0.08, 'Uses parenthetical asides for caveats and pointers "(script is at /script)".'),
    ...habit(stats.shareLowercaseStart >= 0.1, 'Sometimes starts lowercase; fine for quick internal replies.'),
    ...habit(stats.contractionsPer100Words >= 2, 'Uses contractions throughout.'),
    ...habit(abbreviations.length > 0, `Casual abbreviations: ${abbreviations.slice(0, 5).map((a) => a.term).join(', ')}.`),
  ].join(' ');
  const slackGuide = [
    `Mentions the person first in group threads (${Math.round(stats.shareStartsWithMention * 100)}% of messages start with a mention).`,
    `Bullets for lists of links/options (${Math.round(stats.shareBullets * 100)}%), numbered lists for multi-part questions or recommendations (${Math.round(stats.shareNumbered * 100)}%).`,
    `Emoji level ${sc.emojiUse}/3${stats.topEmoji.length ? ` (e.g. ${stats.topEmoji.slice(0, 3).join(' ')})` : ''}; none in serious or customer messages.`,
    'No sign-off on Slack.',
    sigList.length ? `Signature moves: ${sigList.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const emailGuide =
    'Rarely emails, so infer from Slack: keep his directness, add "Hi <first name>," and a one-line opener, use complete sentences, no abbreviations or emoji, close with one forward-looking line and "Thanks," + first name.';
  const ext = audiences.external ?? audiences.account_channel;
  const customerGuide = ext
    ? `Account and customer channels: median ${ext.medianWords} words; more complete sentences, answers technical questions in structured detail, routes commercial questions to the AE.`
    : 'Little customer-facing Slack in the sample: use complete sentences, no internal shorthand, friendly-professional, answer first, route commercial questions to the AE.';

  const profile: VoiceProfile = {
    schemaVersion: 1,
    userLabel: opts.userLabel,
    source: 'slack_sent',
    builtAt: now,
    window: { from: analyzed[0]?.m.at ?? now, to: analyzed[analyzed.length - 1]?.m.at ?? now },
    learnedFromMessageCount: conv.length,
    excluded,
    tone,
    formality: sc.formality,
    verbosity: sc.verbosity,
    emojiUse: sc.emojiUse,
    greeting,
    signoff: hasSignoff ? 'Thanks, <first name>' : null,
    phrasesToUse: signatures.filter((s) => !['Thank you / thanks'].includes(s.phrase)).slice(0, 10).map((s) => s.phrase),
    phrasesToAvoid: ['just circling back', 'gentle reminder', 'I hope this finds you well', 'per my last message', 'I wanted to reach out'],
    styleGuide: styleGuide.slice(0, 1500),
    slackGuide: slackGuide.slice(0, 1500),
    emailGuide,
    customerGuide,
    stats,
    greetings,
    openers,
    signatures: signatures.slice(0, 20),
    commonPhrases,
    audiences,
    exemplars: pickExemplars(conv, properNouns, opts.maxExemplarsPerAudience ?? 3),
    synthesized: null,
  };
  return voiceProfileSchema.parse(profile);
}
