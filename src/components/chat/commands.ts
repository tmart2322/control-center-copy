/**
 * Composer affordances: `/` commands (UI-SPEC §6), `@` mention groups, and follow-up chips.
 */
import type { EntityType, SearchHit } from '@/contract';
import type { ChatMessageView } from '@/client/chat';

export interface SlashCommand {
  name: string;
  args: string;
  hint: string;
  /** Text placed in the composer; `select` marks the argument placeholder to type over. */
  insert: string;
  select?: [number, number];
}

const cmd = (name: string, args: string, hint: string, defaults = ''): SlashCommand => {
  const insert = `${name} ${defaults}`.trimEnd() + (defaults ? '' : args && !args.startsWith('[') ? ' ' : '');
  return { name, args, hint, insert, select: defaults ? [name.length + 1, insert.length] : undefined };
};

export const SLASH_COMMANDS: SlashCommand[] = [
  cmd('/replan', '', 'Re-rank Do now around what changed'),
  cmd('/rescan', '<source> [2d]', 'Re-read Slack, Gmail, Drive… for a window', 'slack 2d'),
  cmd('/find', '<query>', 'Find a file, thread or item the app missed'),
  cmd('/log', 'last meeting', 'Open the activity row for your last meeting', 'last meeting'),
  cmd('/why', '[item]', 'Explain a rank: policy, calendar, signals'),
  cmd('/policy', '<change>', 'Preview a priority-policy change'),
  cmd('/capture', '<text>', 'Capture a task; enrichment follows'),
];

export function matchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(q) || (q.length > 1 && c.hint.toLowerCase().includes(q)));
}

export const MENTION_GROUPS: Array<{ type: EntityType; label: string; icon: { set: 'standard' | 'utility'; name: string; tile?: string } }> = [
  { type: 'account', label: 'Accounts', icon: { set: 'standard', name: 'account', tile: 'bg-std-account' } },
  { type: 'opportunity', label: 'Opportunities', icon: { set: 'standard', name: 'opportunity', tile: 'bg-std-opportunity' } },
  { type: 'person', label: 'People', icon: { set: 'standard', name: 'user', tile: 'bg-std-user' } },
  { type: 'initiative', label: 'Initiatives', icon: { set: 'standard', name: 'campaign', tile: 'bg-std-report' } },
  { type: 'agent_run', label: 'Sessions', icon: { set: 'utility', name: 'agent_session' } },
  { type: 'asset', label: 'Files', icon: { set: 'utility', name: 'file' } },
];

const MENTIONABLE = new Set(MENTION_GROUPS.map((g) => g.type));

export function groupMentionHits(hits: SearchHit[]): Array<{ type: EntityType; label: string; hits: SearchHit[] }> {
  return MENTION_GROUPS.map((g) => ({ type: g.type, label: g.label, hits: hits.filter((h) => h.ref.type === g.type).slice(0, 5) })).filter((g) => g.hits.length && MENTIONABLE.has(g.type));
}

/** Trigger under the caret: `@que` anywhere after a space, `/cmd` only at the very start. */
export function triggerAt(text: string, caret: number): { kind: 'mention' | 'command'; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\w-]*)$/.exec(before);
  if (slash) return { kind: 'command', query: slash[1], start: 0 };
  const at = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (at) return { kind: 'mention', query: at[2], start: before.length - at[2].length - 1 };
  return null;
}

/** Up to three next prompts under the latest answer, each one the scripts (and a real model) can act on. */
export function followUpsFor(m: ChatMessageView): string[] {
  if (m.role !== 'assistant' || m.streaming || m.error) return [];
  const out: string[] = [];
  const item = m.resources.find((r) => r.kind === 'work_item');
  const short = (s: string) => (s.length > 26 ? `${s.slice(0, 25).trimEnd()}…` : s);
  if (m.proposals.length) out.push('Why is my #1 first?');
  if (item && !m.tools.some((t) => t.name === 'priority.explain')) out.push(`Why is “${short(item.label)}” ranked there?`);
  if (m.receipts.length) out.push('/rescan slack 2d');
  if (m.isMorningBrief) out.push('Why is my #1 first?', 'Prioritize customer-facing over internal today', '/rescan slack 2d');
  if (!out.length) out.push('Why is my #1 first?', '/rescan slack 2d', 'Prioritize customer-facing over internal today');
  return [...new Set(out)].slice(0, 3);
}

export const EMPTY_SUGGESTIONS = ['Why is my #1 first?', 'Prioritize customer-facing over internal today', '/rescan slack 2d', '/log last meeting'];
