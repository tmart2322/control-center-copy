/**
 * Incremental Claude Code transcript parser (brief 10 §1.4–1.6).
 * Pure: feed it JSONL text chunks; it returns the updated derived state. Main chain only (isSidechain != true).
 * Customer data lives in transcripts, so only short redacted snippets are kept (brief 10 §1.6).
 */
import { redact } from '../redact';

export interface TranscriptState {
  /** Byte offset up to which the file has been consumed (always at a line boundary). */
  offset: number;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  entrypoint?: string;
  version?: string;
  firstTs?: string;
  lastTs?: string;
  /** tool_use id -> tool name, for calls without a result yet. */
  pending: Record<string, string>;
  /** First human prompt (cap 2000, redacted). Used for the [cc:<id>] tag and a fallback title. */
  firstPrompt?: string;
  lastHumanPrompt?: string;
  lastHumanTs?: string;
  humanPromptCount: number;
  /**
   * Every human prompt with the end of the turn after it (the last main-chain record before the next prompt):
   * `[promptAt, turnEndAt]`, ISO, oldest first, the last MAX_TURNS. The time engine counts engaged time from the
   * prompts and Claude's run only in part (src/engines/activity/engaged.ts). Timestamps only, never text.
   */
  turns?: [string, string][];
  /** Version of `turns`: a state without it (from before 2026-11-14) is re-derived from 0 once. */
  turnsV?: number;
  titles: { custom?: string; ai?: string; agentName?: string };
  /** Type of the last main-chain conversational record. */
  lastConv?: 'assistant' | 'human' | 'tool_result' | 'other_user';
  lastAssistantText?: string;
  lastAssistantStop?: string | null;
  lastAssistantUuid?: string;
  /** A system/api_error with no assistant record after it. */
  trailingApiError: boolean;
  awaySummary?: string;
  scheduled: boolean;
  filesTouched: string[];
  compactions: number;
  costUsd?: number;
}

/** `turns` version (bump to re-derive every transcript's turns once). */
export const TURNS_V = 1;
/** At most this many turns per session are kept (the newest). */
export const MAX_TURNS = 1000;

export const emptyTranscriptState = (): TranscriptState => ({
  offset: 0,
  pending: {},
  humanPromptCount: 0,
  turns: [],
  turnsV: TURNS_V,
  titles: {},
  trailingApiError: false,
  scheduled: false,
  filesTouched: [],
  compactions: 0,
});

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}
interface Rec {
  type?: string;
  subtype?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
  entrypoint?: string;
  version?: string;
  origin?: { kind?: string; subkind?: string } | null;
  message?: { role?: string; content?: string | Block[]; stop_reason?: string | null };
  content?: string;
  customTitle?: string;
  aiTitle?: string;
  agentName?: string;
  cost?: { totalCostUsd?: number } | number;
  totalCostUsd?: number;
}

const textOf = (c: string | Block[] | undefined): string => {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!).join('\n');
};

function isHumanPrompt(r: Rec): boolean {
  if (r.type !== 'user' || r.isMeta || r.isCompactSummary) return false;
  const c = r.message?.content;
  if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) return false;
  if (r.origin?.kind) return r.origin.kind === 'human';
  const t = textOf(c).trimStart();
  return t.length > 0 && !t.startsWith('<');
}

/** Applies one parsed record to the state. Exported for tests. */
export function applyRecord(s: TranscriptState, r: Rec): void {
  const t = r.type;
  if (t === 'custom-title' && r.customTitle) s.titles.custom = r.customTitle;
  else if (t === 'ai-title' && r.aiTitle) s.titles.ai = r.aiTitle;
  else if (t === 'agent-name' && r.agentName) s.titles.agentName = r.agentName;
  else if (t === 'cost-state') {
    const c = typeof r.cost === 'object' && r.cost ? r.cost.totalCostUsd : (r.totalCostUsd ?? (typeof r.cost === 'number' ? r.cost : undefined));
    if (typeof c === 'number') s.costUsd = c;
  }
  if (r.isSidechain === true) return;
  if (!(t === 'user' || t === 'assistant' || t === 'system' || t === 'attachment')) return;

  if (r.sessionId && !s.sessionId) s.sessionId = r.sessionId;
  if (r.cwd) s.cwd = r.cwd;
  if (r.gitBranch) s.gitBranch = r.gitBranch;
  if (r.entrypoint && !s.entrypoint) s.entrypoint = r.entrypoint;
  if (r.version) s.version = r.version;
  if (r.timestamp) {
    if (!s.firstTs || r.timestamp < s.firstTs) s.firstTs = r.timestamp;
    if (!s.lastTs || r.timestamp > s.lastTs) s.lastTs = r.timestamp;
    // the open turn runs to the last main-chain record before the next prompt (never to the next prompt itself)
    const open = s.turns?.[s.turns.length - 1];
    if (open && r.timestamp > open[1] && !isHumanPrompt(r)) open[1] = r.timestamp;
  }

  if (t === 'system') {
    if (r.subtype === 'compact_boundary') {
      s.pending = {};
      s.compactions++;
    } else if (r.subtype === 'api_error') s.trailingApiError = true;
    else if (r.subtype === 'away_summary' && r.content) s.awaySummary = redact(r.content).text.slice(0, 600);
    else if (r.subtype === 'scheduled_task_fire') s.scheduled = true;
    return;
  }
  if (t === 'attachment') return;

  if (t === 'assistant') {
    s.trailingApiError = false;
    s.lastConv = 'assistant';
    s.lastAssistantUuid = r.uuid;
    s.lastAssistantStop = r.message?.stop_reason ?? null;
    const content = r.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use' && b.id) {
          s.pending[b.id] = b.name ?? '';
          const key = b.name ? FILE_TOOLS[b.name] : undefined;
          const fp = key ? (b.input?.[key] as string | undefined) : undefined;
          if (fp && !s.filesTouched.includes(fp) && s.filesTouched.length < 60) s.filesTouched.push(fp);
        }
      }
      const txt = textOf(content);
      if (txt) s.lastAssistantText = redact(txt.slice(-600)).text;
    } else if (typeof content === 'string' && content) s.lastAssistantText = redact(content.slice(-600)).text;
    return;
  }

  // user
  const content = r.message?.content;
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) {
    for (const b of content) if (b.type === 'tool_result' && b.tool_use_id) delete s.pending[b.tool_use_id];
    s.lastConv = 'tool_result';
    return;
  }
  if (r.origin?.kind === 'task-notification' && r.origin.subkind === 'scheduled-trigger') s.scheduled = true;
  if (isHumanPrompt(r)) {
    s.trailingApiError = false;
    s.lastConv = 'human';
    s.humanPromptCount++;
    const txt = redact(textOf(content)).text;
    if (s.firstPrompt === undefined) s.firstPrompt = txt.slice(0, 2000);
    s.lastHumanPrompt = txt.slice(0, 400);
    if (r.timestamp) {
      s.lastHumanTs = r.timestamp;
      s.turns ??= [];
      s.turns.push([r.timestamp, r.timestamp]);
      if (s.turns.length > MAX_TURNS) s.turns.splice(0, s.turns.length - MAX_TURNS);
    }
  } else s.lastConv = 'other_user';
}

/**
 * Consumes `chunk` (bytes already decoded) that starts at `state.offset`. Only complete lines are applied; the
 * returned `consumed` is the number of BYTES applied so the caller can advance the offset exactly.
 */
export function applyChunk(s: TranscriptState, chunk: Buffer): number {
  const lastNl = chunk.lastIndexOf(0x0a);
  if (lastNl < 0) return 0;
  const text = chunk.subarray(0, lastNl + 1).toString('utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      applyRecord(s, JSON.parse(line) as Rec);
    } catch {
      /* partial or corrupt line: skip it (counted by the caller via parseErrors if needed) */
    }
  }
  s.offset += lastNl + 1;
  return lastNl + 1;
}

/** A whole transcript's human turns (the re-derive's read-only stand-in when a session's item has none yet). */
export function turnsOfTranscript(text: string): [string, string][] {
  const s = emptyTranscriptState();
  applyChunk(s, Buffer.from(text.endsWith('\n') ? text : `${text}\n`, 'utf8'));
  return s.turns ?? [];
}

export const CC_TAG_RE = /\[cc:([A-Za-z0-9_.-]+)\]/;

export function findCcTag(prompt: string | undefined): string | undefined {
  return prompt?.match(CC_TAG_RE)?.[1];
}
