import { redactSecrets } from '../nba/prompt/redact';

/**
 * Slack text → plain text for style analysis. Mentions keep the first name only, links become
 * their label (or "<link>"), entities are decoded, and credential-like text is masked.
 */

export function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export interface NormalizedText {
  text: string;
  mentionCount: number;
  startsWithMention: boolean;
  linkCount: number;
  emoji: string[];
  hadSecret: boolean;
}

export function normalizeSlackText(raw: string): NormalizedText {
  // Mask secrets on the raw text first, so a credential inside a link label or URL is caught too.
  const pre = redactSecrets(raw);
  let t = pre.text;
  const startsWithMention = /^\s*<@[A-Z0-9]+/.test(t);
  let mentionCount = 0;
  let linkCount = 0;
  t = t.replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_m, _id: string, label?: string) => {
    mentionCount++;
    const first = (label ?? 'someone').trim().split(/\s+/)[0] ?? 'someone';
    return `@${first}`;
  });
  t = t.replace(/<!(channel|here|everyone)>/g, () => {
    mentionCount++;
    return '@channel';
  });
  t = t.replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_m, label?: string) => {
    mentionCount++;
    return label ? `@${label.replace(/^@/, '')}` : '@team';
  });
  t = t.replace(/<#[A-Z0-9]+(?:\|([^>]*))?>/g, (_m, label?: string) => `#${label || 'channel'}`);
  t = t.replace(/<((?:https?|mailto):[^>|]+)(?:\|([^>]*))?>/g, (_m, _url: string, label?: string) => {
    linkCount++;
    const l = (label ?? '').trim();
    return l && !/^(https?:|www\.|[\w.-]+\.(com|app|net|io)\b)/i.test(l) ? l : '<link>';
  });
  t = t.replace(/https?:\/\/\S+/g, () => {
    linkCount++;
    return '<link>';
  });
  t = decodeEntities(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const emoji = [...t.matchAll(/:([a-z0-9_+-]{2,40}):/g)].map((m) => m[1] ?? '').filter(Boolean);
  const r = redactSecrets(t);
  return { text: r.text.trim(), mentionCount, startsWithMention, linkCount, emoji, hadSecret: pre.redacted || r.redacted };
}

/** Mask emails and long digit runs in exemplars (they're stored locally, but keep them tidy). */
export function scrubExemplar(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b\d{6,}\b/g, '<number>')
    .replace(/\b[a-zA-Z0-9]{15,18}\b(?=[^a-zA-Z0-9]|$)/g, (m) => (/\d/.test(m) && /[A-Z]/.test(m) ? '<id>' : m));
}

export function words(text: string): string[] {
  return text
    .replace(/<link>|@\w+|#[\w-]+|:[a-z0-9_+-]+:/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9'$%.-]+/)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter((w) => w.length > 0);
}
