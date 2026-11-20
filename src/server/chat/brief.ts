/**
 * The morning brief's one-line summary (BE-CHAT), filled on read as `ChatMessage.summary`: the first
 * sentence after the greeting, plus how many priorities it lists. Same rule as the client's
 * `briefSummary` (src/components/chat/thread-model.ts), so a client can switch to the server's line.
 */
import type { ChatMessage } from '@/contract';

const stripMd = (s: string) => s.replace(/\*\*|__|`|\[([^\]]*)\]\([^)]*\)/g, (_m, l?: string) => l ?? '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function briefSummaryOf(markdown: string): string {
  const paras = markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const first = stripMd(paras.find((p) => !/^(\d+\.|[-*])\s/.test(p)) ?? '');
  const sentences = first.split(/(?<=[.!?])\s+/).filter(Boolean);
  const greeting = sentences[0] && /^(good (morning|afternoon|evening)|hi|hello)\b/i.test(sentences[0]) ? 1 : 0;
  const lead = clip(sentences[greeting] ?? sentences[0] ?? '', 120);
  const items = markdown.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length;
  const tail = items ? `${items} ${items === 1 ? 'priority' : 'priorities'}.` : '';
  return [lead, tail].filter(Boolean).join(' ');
}

/** The message with `summary` set when it is the morning brief (and has none yet). */
export function withBriefSummary(m: ChatMessage): ChatMessage {
  if (!m.isMorningBrief || m.summary || !m.text) return m;
  const summary = briefSummaryOf(m.text);
  return summary ? { ...m, summary } : m;
}
