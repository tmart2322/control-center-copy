/**
 * Chat prompt (BE-CHAT). Layout follows the scanner's caching rule:
 *   systemPrompt = [ skills/chat-assistant.md body            ← static, byte-stable
 *                  , SYSTEM_PROMPT_DYNAMIC_BOUNDARY
 *                  , now + context pack JSON + "Looking at" ]  ← per turn
 *   prompt       = thread so far (compact) + the message
 * Every dynamic string is credential-redacted.
 */
import type { ChatMessage, ContextRef } from '@/contract';
import { renderPersonaBlock, type ResolvedPersona } from '@/personas';
import { redactText } from '../redact';
import { SOQL_MAX_IN, SOQL_MAX_LIMIT, soqlObjectsFor } from './soql';
import { loadSkill } from '../skill-loader';

export const CHAT_SKILL_PATH = 'skills/chat-assistant.md';

export function loadChatSkill(repoRoot?: string, skillPath = CHAT_SKILL_PATH) {
  return loadSkill(skillPath, repoRoot);
}

/** "2026-11-05T09:12:00-08:00" in `tz` (the offset the model must use for times). */
export function localIso(d: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  const off = Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One line per card a message produced, so the model knows what is pending, applied or prepared. */
function partLines(m: ChatMessage): string[] {
  const out: string[] = [];
  for (const p of m.parts ?? []) {
    switch (p.type) {
      case 'proposal':
        out.push(`[proposal ${p.proposal.id} ${p.status ?? p.proposal.status}: ${cut(p.summary ?? p.proposal.reason, 160)}]`);
        // A6: the card's lines ride along, so "apply the rest" or "drop the third one" knows what the card holds
        for (const c of p.proposal.changes) out.push(`  - ${cut(`${c.label ?? c.field}: ${lineValue(c.before)} → ${lineValue(c.after)}`, 200)}`);
        break;
      case 'receipt': {
        const failed = p.receipt.failed ?? [];
        out.push(`[receipt: ${cut(p.receipt.summary, 200)}${p.receipt.changes.some((c) => c.undoneAt) ? ' (undone)' : ''}]`);
        for (const f of failed) out.push(`  - failed: ${cut(`${f.label}: ${f.reason}`, 240)}`);
        break;
      }
      case 'tool':
        if (/(^|\.)scan$/.test(p.name)) out.push(`[${p.name}: ${cut(p.summary, 120)}]`);
        break;
      case 'resource': {
        const c = p.card;
        if (c?.kind === 'draft') out.push(`[draft ${c.draft.draftId} to ${c.draft.to}: ${c.draft.status}, not sent]`);
        else if (c?.kind === 'session') out.push(`[session ${c.session.id} prepared in ${c.session.folder}, not opened]`);
        else out.push(`[link: ${cut(p.resource.label, 80)}]`);
        break;
      }
      case 'error':
        out.push(`[error: ${cut(p.error.message, 120)}]`);
        break;
      default:
        break;
    }
  }
  return out;
}

/** A card line's value in the history (short; objects as compact JSON). */
const lineValue = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * How much of one earlier message the next turn sees (A6, 2026-11-13). The user's own messages stay whole up to a
 * very long paste (a list pasted once lasts the thread); the Assistant's replies keep 8,000 characters (their tables
 * and what they staged), and the cards they produced carry their lines.
 */
export const HISTORY_USER_MAX = 120_000;
export const HISTORY_ASSISTANT_MAX = 8_000;
/**
 * The whole thread's budget: sized to the model's context (200k tokens) with headroom for the skill, the tools, the
 * context pack and this turn's own tool results. Older messages drop first.
 */
export const HISTORY_MAX_CHARS = 320_000;

/** The thread so far, newest last, bounded by `maxChars` (older messages drop first). */
export function renderHistory(messages: ChatMessage[], o: { maxMessages?: number; maxChars?: number } = {}): string {
  const maxMessages = o.maxMessages ?? 400;
  const maxChars = o.maxChars ?? HISTORY_MAX_CHARS;
  const blocks: string[] = [];
  let total = 0;
  for (const m of messages.slice(-maxMessages).reverse()) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? 'User' : 'Assistant';
    const body = [cut(redactText(m.text || (m.role === 'assistant' ? '(no text)' : '')), m.role === 'user' ? HISTORY_USER_MAX : HISTORY_ASSISTANT_MAX), ...partLines(m).map(redactText)].filter(Boolean).join('\n');
    const block = `${who}: ${body}`;
    if (total + block.length > maxChars && blocks.length) break;
    blocks.push(block);
    total += block.length;
  }
  return blocks.reverse().join('\n\n');
}

export function renderLookingAt(context: ContextRef[]): string | null {
  if (!context.length) return null;
  const auto = context.find((c) => c.via === 'auto');
  const lines = context.map((c) => `- ${c.type} ${c.id}: ${redactText(cut(c.label, 120))}${c === auto ? ' (looking at)' : ''}`);
  return lines.join('\n');
}

export interface ChatPromptInput {
  skillBody: string;
  pack: Record<string, unknown>;
  history: ChatMessage[];
  context: ContextRef[];
  text: string;
  now: Date;
  timezone: string;
  /** D-55: the user's persona (the Persona block, after the cache boundary). */
  persona?: ResolvedPersona | null;
  /** D-58: which live reads this turn has (the scanners' Slack / Org62 tools, Google), and what couldn't load. */
  reads?: { live: boolean; slack: string[]; org62: string[]; unavailable: string[] };
}

/** One line per live source the turn can read (or that it can't, and why). Deterministic. */
export function renderLiveReads(r: NonNullable<ChatPromptInput['reads']>, p: ResolvedPersona | null | undefined): string {
  if (!r.live) return "No live reads in this mode (the app's own data only): Slack, Org62, Gmail, Drive and Calendar tools answer \"not available here\". Say so when it matters.";
  const lines: string[] = [];
  if (r.slack.length) lines.push(`- Slack: ${r.slack.join(', ')}`);
  if (r.org62.length) lines.push(`- Org62 (SELECT only, LIMIT ≤ ${SOQL_MAX_LIMIT}, IN lists ≤ ${SOQL_MAX_IN}): ${r.org62.join(', ')} on ${soqlObjectsFor(p ?? null).join(', ')}`);
  lines.push('- Gmail, Drive, Calendar: chat_gmail_search, chat_gmail_thread, chat_drive_search, chat_drive_read, chat_calendar_events');
  if (r.unavailable.length) lines.push(`- Not connected this turn: ${r.unavailable.join(', ')}`);
  return lines.join('\n');
}

export function buildChatPrompt(i: ChatPromptInput, boundary: string): { systemPrompt: string[]; prompt: string } {
  const looking = renderLookingAt(i.context);
  const dynamic = [
    `## Now\n${localIso(i.now, i.timezone)} (${i.timezone})`,
    looking ? `## Looking at\n${looking}` : '## Looking at\n(nothing in focus)',
    `## Context pack (JSON)\n${JSON.stringify(i.pack)}`,
    ...(i.persona ? [renderPersonaBlock(i.persona)] : []),
    ...(i.reads ? [`## Live reads\n${renderLiveReads(i.reads, i.persona)}`] : []),
  ].join('\n\n');
  const history = renderHistory(i.history);
  const prompt = [history ? `## Thread so far\n${history}` : '', `## Message\n${redactText(i.text)}`].filter(Boolean).join('\n\n');
  return { systemPrompt: [i.skillBody, boundary, dynamic], prompt };
}
