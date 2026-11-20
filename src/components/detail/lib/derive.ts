/**
 * Pure view logic for the item detail and initiative pages (no React). Kept here so it can be unit
 * tested against the placeholder seed (tests/p2).
 */
import type {
  Actor,
  AgentRun,
  Asset,
  AuditEntry,
  DeliverableInfo,
  Effort,
  Evidence,
  EvidenceRole,
  Involvement,
  NbaCard,
  Person,
  PersonRef,
  SourceRef,
  Tone,
  WorkItem,
  WorkState,
} from '@/contract';

// ── Evidence ────────────────────────────────────────────────────────────────────────────────

export const ROLE_ORDER: EvidenceRole[] = ['origin', 'progress', 'completion', 'context', 'contradiction'];

export const ROLE_META: Record<EvidenceRole, { label: string; tone: Tone; hint: string }> = {
  origin: { label: 'Origin', tone: 'brand', hint: 'Where the task came from' },
  progress: { label: 'Progress', tone: 'brand', hint: 'Signals that work moved forward' },
  completion: { label: 'Completion', tone: 'ok', hint: 'Signals that it is done' },
  context: { label: 'Context', tone: 'neutral', hint: 'Background that changes nothing on its own' },
  contradiction: { label: 'Contradiction', tone: 'risk', hint: 'Signals that disagree with the current state' },
};

export interface EvidenceGroup {
  role: EvidenceRole;
  label: string;
  tone: Tone;
  items: Evidence[];
}

/** Group by role in the fixed role order (empty roles dropped), newest first inside each group. */
export function groupEvidence(evidence: Evidence[]): EvidenceGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_META[role].label,
    tone: ROLE_META[role].tone,
    items: evidence.filter((e) => e.role === role).sort((a, b) => b.at.localeCompare(a.at)),
  })).filter((g) => g.items.length > 0);
}

// ── Actors and audit ────────────────────────────────────────────────────────────────────────

/** "you · chat · engine · scanner" (UI-SPEC §12 History). */
export function actorLabel(actor: Actor): string {
  switch (actor) {
    case 'user':
      return 'You';
    case 'chat':
      return 'Chat';
    case 'engine':
      return 'Engine';
    case 'connector':
    case 'scenario':
      return 'Scanner';
    case 'system':
      return 'System';
  }
}

export function actorTone(actor: Actor): Tone {
  return actor === 'user' ? 'brand' : actor === 'chat' || actor === 'engine' ? 'ai' : 'neutral';
}

/** Undo is offered only for undoable, not-yet-undone entries that aren't undos of something already undone. */
export function canUndo(e: AuditEntry): boolean {
  return e.undoable && !e.undoneAt;
}

/** The most recent live (undoable) audit entry for one of `actions`, e.g. the loop-back that reopened the item. */
export function latestUndoable(entries: AuditEntry[], actions: string[]): AuditEntry | null {
  return [...entries].sort((a, b) => b.at.localeCompare(a.at)).find((e) => actions.includes(e.action) && canUndo(e)) ?? null;
}

// ── People and involvement ──────────────────────────────────────────────────────────────────

export const INVOLVEMENT_LABEL: Record<Involvement, string> = {
  owner: 'Owner',
  contributor: 'Contributor',
  watcher: 'Watching',
  not_involved: 'Not involved',
};

export type PersonLike = PersonRef & Partial<Pick<Person, 'email' | 'slackHandle' | 'title'>>;

/** Merge people lists by id; earlier lists win for role/flags, later ones fill gaps. */
export function mergePeople(...lists: Array<ReadonlyArray<PersonLike | null | undefined> | null | undefined>): PersonLike[] {
  const map = new Map<string, PersonLike>();
  for (const list of lists) {
    for (const p of list ?? []) {
      if (!p) continue;
      const prev = map.get(p.id);
      map.set(p.id, prev ? { ...p, ...prev, role: prev.role ?? p.role, email: prev.email ?? p.email, slackHandle: prev.slackHandle ?? p.slackHandle } : { ...p });
    }
  }
  return [...map.values()];
}

// ── Deliverables (R-UI-15) ─────────────────────────────────────────────────────────────────

export interface JudgmentWord {
  word: 'Yes' | 'Partial' | 'No' | 'Unknown';
  tone: Tone;
  label: string;
}

/** "Were the requested updates made?" as yes · partial · no · unknown. */
export function judgmentWord(d: DeliverableInfo): JudgmentWord {
  const j = d.judgment;
  if (!j) return { word: 'Unknown', tone: 'neutral', label: d.changedSinceCreated ? 'Changed, not yet judged' : 'No edits yet' };
  switch (j.verdict) {
    case 'complete':
      return { word: 'Yes', tone: 'ok', label: 'Requested updates made' };
    case 'partial':
      return { word: 'Partial', tone: 'warn', label: 'Some updates made' };
    case 'in_progress':
      return j.made > 0 ? { word: 'Partial', tone: 'warn', label: 'Updates in progress' } : { word: 'Unknown', tone: 'brand', label: 'Edits in progress, not judged yet' };
    case 'not_started':
      return { word: 'No', tone: 'warn', label: 'Not started' };
    case 'regressed':
      return { word: 'No', tone: 'risk', label: 'Regressed since the request' };
    case 'unclear':
      return { word: 'Unknown', tone: 'neutral', label: "Can't tell from the file" };
  }
}

/** Split a diff summary ("+2 slides · −1 slide · pricing changed" or multi-line +/−) into lines. */
export function diffLines(summary: string | null | undefined): Array<{ sign: '+' | '-' | '~'; text: string }> {
  if (!summary) return [];
  return summary
    .split(/\n|\s·\s|;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (/^(\+|added\b)/i.test(s)) return { sign: '+' as const, text: s.replace(/^\+\s*/, '') };
      if (/^(-|−|removed\b|deleted\b)/i.test(s)) return { sign: '-' as const, text: s.replace(/^[-−]\s*/, '') };
      return { sign: '~' as const, text: s.replace(/^~\s*/, '') };
    });
}

export function doctypeIcon(kind: string): string {
  switch (kind) {
    case 'slides':
      return 'gpres';
    case 'sheet':
      return 'gsheet';
    case 'pdf':
      return 'pdf';
    case 'folder':
      return 'folder';
    case 'canvas':
      return 'slack_canvas';
    default:
      return 'gdoc';
  }
}

// ── Assets and runs (Related tab) ──────────────────────────────────────────────────────────

export interface AssetGroups {
  files: Asset[];
  demoOrgs: Asset[];
  sessions: { runs: AgentRun[]; assets: Asset[] };
  toolOutputs: { runs: AgentRun[]; assets: Asset[] };
  links: Asset[];
}

export function groupAssets(assets: Asset[], runs: AgentRun[]): AssetGroups {
  const seen = new Set<string>();
  const uniq = assets.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  return {
    files: uniq.filter((a) => ['slides', 'doc', 'sheet', 'pdf', 'folder', 'canvas'].includes(a.kind)),
    demoOrgs: uniq.filter((a) => a.kind === 'demo_org'),
    sessions: { runs: runs.filter((r) => r.kind === 'claude_session'), assets: uniq.filter((a) => a.kind === 'claude_session') },
    toolOutputs: { runs: runs.filter((r) => r.kind !== 'claude_session'), assets: uniq.filter((a) => a.kind === 'tool_output') },
    links: uniq.filter((a) => a.kind === 'link'),
  };
}

// ── Item state ─────────────────────────────────────────────────────────────────────────────

export const LIVE_STATES: ReadonlySet<WorkState> = new Set(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'reopened', 'snoozed', 'suggested']);
export const CLOSED_STATES: ReadonlySet<WorkState> = new Set(['done', 'dismissed']);

/** Group order for an initiative's child tasks (UI-SPEC §11 vocabulary). */
export const STATE_GROUPS: Array<{ id: string; label: string; states: WorkState[] }> = [
  { id: 'needs_you', label: 'Needs you', states: ['waiting_on_me', 'reopened', 'likely_done'] },
  { id: 'doing', label: 'In progress', states: ['in_progress'] },
  { id: 'open', label: 'Open', states: ['open'] },
  { id: 'waiting', label: 'Waiting on others', states: ['waiting_on_others'] },
  { id: 'suggested', label: 'Suggested', states: ['suggested'] },
  { id: 'snoozed', label: 'Snoozed', states: ['snoozed'] },
  { id: 'done', label: 'Done', states: ['done', 'dismissed'] },
];

export function groupByState(items: WorkItem[]): Array<{ id: string; label: string; items: WorkItem[] }> {
  return STATE_GROUPS.map((g) => ({ id: g.id, label: g.label, items: items.filter((i) => g.states.includes(i.state)) })).filter((g) => g.items.length > 0);
}

/**
 * Keep rows where they were (UI-SPEC §10: nothing moves under the cursor). Known ids keep their
 * previous position; new ids append in server order. Returns the ordered list and the new ids.
 */
export function stableOrder<T extends { id: string }>(prevIds: readonly string[], next: readonly T[]): { list: T[]; order: string[]; added: string[] } {
  const byId = new Map(next.map((x) => [x.id, x]));
  const kept = prevIds.filter((id) => byId.has(id));
  const known = new Set(kept);
  const added = next.filter((x) => !known.has(x.id)).map((x) => x.id);
  const order = [...kept, ...added];
  return { list: order.map((id) => byId.get(id)!), order, added: prevIds.length ? added : [] };
}

/** The source `o` opens: the first one with a URL, item sources before NBA sources. */
export function openableSource(item: Pick<WorkItem, 'sources'>, nba?: Pick<NbaCard, 'sources'> | null): SourceRef | null {
  return [...item.sources, ...(nba?.sources ?? [])].find((s) => !!s.url) ?? null;
}

/** Strip the routing tag the launcher appends ("[cc:w_123]"). */
export function stripCcTag(text: string): string {
  return text.replace(/\s*\[cc:[^\]]+\]\s*/g, ' ').trim();
}

/** Minutes → "45m" / "1h30m" / "—". */
export function fmtMin(min: number | null | undefined): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h}h${String(m).padStart(2, '0')}m` : `${h}h`) : `${m}m`;
}

/** Parse "45", "45m", "1h", "1h30", "1.5h" → minutes (null when unreadable). */
export function parseMinutes(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t || t === '—' || t === '-') return 0;
  const hm = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/.exec(t);
  if (hm) return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));
  const m = /^(\d+)\s*m?$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/** Field equality in the shape the fields edit (purpose without its "For:" prefix, instants by time). */
export function sameField(field: string, a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined || v === '') return null;
    if (field === 'purpose' && typeof v === 'string') return v.replace(/^For:\s*/i, '').trim() || null;
    if ((field === 'due' || field === 'startBy') && typeof v === 'string') return Date.parse(v);
    if (field === 'effort' && typeof v === 'object') return `${(v as Effort).youMin}/${(v as Effort).agentMin}`;
    return typeof v === 'string' ? v.trim() : JSON.stringify(v);
  };
  return norm(a) === norm(b);
}


/** Opportunity amounts: "$2.55M", "$850K", "$12,000". */
export function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const big = n >= 100_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: big ? 'compact' : 'standard', maximumFractionDigits: big ? 2 : 0 }).format(n);
}
