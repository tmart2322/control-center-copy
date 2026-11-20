/**
 * Scripted chat responder for mock mode (UI-SPEC §6). FE-1d owns this file and extends it.
 *
 * Export contract: `chatScripts` (ordered; first match wins) and `pickChatScript(text, ctx)`.
 * Every script yields ChatSteps; mutations go through `ctx.ops` so receipts carry real audit ids.
 * Matching is deliberately loose (keywords), so natural phrasings land on the right demo.
 *
 * Demos (each a real, undoable change against the mock store where it changes anything):
 *   "move Globex prep after lunch and find the deck I made for them" → 2 changes (start by + note) + a resource
 *   "why is the ACME build first?" / "/why"                            → explanation citing policy + calendar
 *   "prioritize customer-facing over internal today"                   → policy preview proposal → Apply
 *   "/rescan slack 2d"                                                 → tool rows, then a receipt
 *   "what did I promise Ravi?"                                         → a resource to the background promise
 *   "/error" or "simulate an error"                                    → the error event
 *   plus /replan (re-prioritize), /find, /policy, /log last meeting, /capture <text>, and a default tour.
 *
 * Everything goes through `ctx.ops` (CONTRACT-1 ChatOps): reads (settings, calendar, Work lists) and
 * changes (field edits, capture, scans, notes, re-rank, policy). Changes are audited as actor `chat` and
 * never lock fields; a field you locked yourself comes back as a proposal (Apply / Keep mine).
 */
import type { PolicyPreview, Receipt, ReceiptChange, Settings, WorkItem } from '@/contract';
import type { ChatScript, ChatScriptContext, ChatStep } from '@/server/datasource/mock/chat-runtime';

// ───────────────────────── helpers ─────────────────────────

const STOP = new Set(['the', 'my', 'a', 'an', 'this', 'that', 'it', 'is', 'and', 'for', 'to', 'of', 'on', 'in', 'prep', 'task', 'item', 'thing', 'stuff', 'me', 'i']);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function tzOf(settings: Settings | null): string | undefined {
  return settings?.profile.timezone;
}

/** Settings through ctx.ops (null if the op fails, so a script still answers). */
function settingsOf(ctx: ChatScriptContext): Settings | null {
  try {
    return ctx.ops.settings();
  } catch {
    return null;
  }
}

function hm(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
}

function dayHm(iso: string, tz?: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d);
  return `${day} ${hm(iso, tz)}`;
}

/** Today at h:m in `tz`, as an instant. */
function zonedToday(now: Date, h: number, m: number, tz?: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const offset = wall - Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, h, m) - offset);
}

function minutes(n: number): string {
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}m` : `${h}h`;
}

/** Best open item for a loose phrase ("Globex prep", "the ACME build"); the focused item for "this/it". */
function findTarget(ctx: ChatScriptContext, phrase: string): WorkItem | null {
  const focused = ctx.context.find((c) => c.type === 'work_item');
  const focusedItem = focused ? ctx.ops.findItem(focused.id) : null;
  const toks = tokens(phrase);
  if (!toks.length) return focusedItem;
  const wantsPrep = /\bprep|prepare|ready\b/i.test(phrase);
  let best: { item: WorkItem; score: number } | null = null;
  ctx.ops.topItems(60).forEach((item, i) => {
    const hay = `${item.title} ${item.refs.account?.label ?? ''} ${item.refs.initiative?.label ?? ''} ${item.purpose ?? ''}`.toLowerCase();
    let score = 0;
    for (const t of toks) if (hay.includes(t)) score += item.title.toLowerCase().includes(t) ? 3 : 2;
    if (!score) return;
    if (wantsPrep && (item.servesEventId || /prep|demo|review|ready/i.test(item.title))) score += 1;
    if (focusedItem && item.id === focusedItem.id) score += 1;
    score -= i * 0.01; // stable: higher rank wins ties
    if (!best || score > best.score) best = { item, score };
  });
  return (best as { item: WorkItem } | null)?.item ?? ctx.ops.findItem(phrase.replace(/["“”‘’'?!.]/g, '').trim()) ?? focusedItem;
}

function combine(summary: string, receipts: Array<Receipt | null | undefined>, extra: ReceiptChange[] = []): Receipt {
  const parts = receipts.filter(Boolean) as Receipt[];
  return {
    id: parts[0]?.id ?? `rcpt_chat_${Date.now().toString(36)}`,
    at: parts[0]?.at ?? new Date().toISOString(),
    actor: 'chat',
    summary,
    changes: [...extra, ...parts.flatMap((r) => r.changes)],
    staged: false,
  };
}

const SOURCE_ALIASES: Record<string, { id: string; label: string }> = {
  slack: { id: 'slack', label: 'Slack' },
  gmail: { id: 'gmail', label: 'Gmail' },
  email: { id: 'gmail', label: 'Gmail' },
  mail: { id: 'gmail', label: 'Gmail' },
  calendar: { id: 'calendar', label: 'Calendar' },
  drive: { id: 'drive', label: 'Drive' },
  gemini: { id: 'gemini', label: 'Gemini notes' },
  notes: { id: 'gemini', label: 'Gemini notes' },
  org62: { id: 'org62', label: 'Org62' },
  vdp: { id: 'vdp', label: 'VDP' },
  claude: { id: 'claude', label: 'Claude sessions' },
};

// ───────────────────────── scripts ─────────────────────────

const reprioritize: ChatScript = {
  id: 'reprioritize',
  description: 'Move an item to the top of NOW (real, undoable change with a receipt)',
  match: (t) => /\b(re-?prioriti[sz]e|replan|move .* (up|top|first)|do .* first|\/replan)\b/i.test(t),
  async *run(ctx) {
    yield { type: 'tool-start', name: 'priority.inspect', summary: 'Reading your Top 10 and priority policy' };
    const top = ctx.ops.topItems(10);
    yield { type: 'tool-result', summary: `${top.length} ranked items`, ok: true };
    const phrase = ctx.text.replace(/^\/replan\s*/i, '').replace(/\b(re-?prioriti[sz]e|move|do|first|up|top|to the|please)\b/gi, ' ');
    const named = tokens(phrase).length ? findTarget(ctx, phrase) : null;
    const focused = ctx.context.find((c) => c.type === 'work_item');
    const target = (focused && ctx.ops.findItem(focused.id)) ?? named ?? top[3] ?? top[top.length - 1];
    if (!target) {
      yield { type: 'text', text: 'There is nothing ranked right now, so there is nothing to move.' };
      return;
    }
    yield { type: 'tool-start', name: 'priority.move', summary: `Moving "${target.title}" to #1` };
    const receipt = ctx.ops.moveToTop(target.id, 'Asked in chat');
    yield { type: 'tool-result', summary: 'Re-ranked', ok: true };
    yield { type: 'receipt', receipt };
    yield {
      type: 'text',
      text: `Done. **${target.title}** is now #1 in NOW. Everything else kept its relative order. Undo from the receipt if that was wrong.`,
    };
  },
};

const moveAfterLunch: ChatScript = {
  id: 'move-after-lunch',
  description: 'Reschedule an item after lunch, and find the file you made for that account (2 undoable changes + a resource)',
  match: (t) => /\bafter\s+(the\s+)?lunch\b/i.test(t) && /\b(move|push|shift|put|bump|do|slide|reschedule)\b/i.test(t),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    const phrase = /\b(?:move|push|shift|put|bump|do|slide|reschedule)\s+(.+?)\s+(?:to\s+|until\s+)?after\b/i.exec(ctx.text)?.[1] ?? '';
    yield { type: 'tool-start', name: 'items.find', summary: `Finding "${phrase || 'the item in view'}" in your plan` };
    const target = findTarget(ctx, phrase);
    if (!target) {
      yield { type: 'tool-result', summary: 'No open item matches', ok: false };
      yield { type: 'text', text: `I couldn't find an open item matching "${phrase}". Focus the card you mean and ask again, or name it differently.` };
      return;
    }
    yield { type: 'tool-result', summary: target.title, ok: true };

    const settings = settingsOf(ctx);
    const tz = tzOf(settings);

    yield { type: 'tool-start', name: 'calendar.today', summary: 'Checking when lunch ends' };
    const events = ctx.ops.calendarToday();
    const lunch = events.find((e) => /\blunch\b/i.test(e.title));
    const after = lunch ? new Date(lunch.end) : zonedToday(ctx.now, 13, 0, tz);
    yield { type: 'tool-result', summary: lunch ? `${lunch.title} ends ${hm(lunch.end, tz)}` : `No lunch on the calendar; using ${hm(after.toISOString(), tz)}`, ok: true };

    // Change 1: start by → after lunch (the real field, audited as chat, not locked). If you set the start
    // time yourself, it comes back as a proposal instead; if the edit fails, record it as a note.
    let moved: Receipt | null = null;
    let staged = false;
    let failed = false;
    yield { type: 'tool-start', name: 'items.reschedule', summary: `Start by ${hm(target.startBy, tz)} → ${hm(after.toISOString(), tz)}`, args: { itemId: target.id, startBy: after.toISOString() } };
    try {
      const r = ctx.ops.patchItem(target.id, { startBy: after.toISOString() }, 'Rescheduled after lunch');
      moved = r.receipt;
      for (const p of r.proposals) {
        staged = true;
        yield { type: 'proposal', proposal: p, summary: `Start ${target.title} at ${hm(after.toISOString(), tz)}? You set its start time yourself.` };
      }
      yield { type: 'tool-result', summary: moved ? 'Rescheduled' : staged ? 'Staged: you set this start time yourself' : 'Already starts then', ok: true };
    } catch (err) {
      failed = true;
      yield { type: 'tool-result', summary: (err as Error).message, ok: false };
    }
    if (failed) {
      yield { type: 'tool-start', name: 'items.note', summary: 'Recording the new start time on the item' };
      moved = ctx.ops.addNote(target.id, `After lunch: start at ${hm(after.toISOString(), tz)} (asked in chat).`);
      yield { type: 'tool-result', summary: 'Noted', ok: true };
    }
    const rescheduled = !!moved?.changes.some((c) => c.field === 'startBy');

    // The "find" half: a file for the same account, preferring the asked-for kind and files you made.
    const wantsFind = /\b(find|look ?up|where('s| is)|grab|pull up|dig up)\b/i.test(ctx.text);
    const account = target.refs.account?.label ?? tokens(phrase)[0] ?? '';
    const kindWanted = /\b(deck|slides?|presentation)\b/i.test(ctx.text) ? 'slides' : /\b(sheet|spreadsheet|estimate)\b/i.test(ctx.text) ? 'sheet' : /\bdoc(ument)?\b/i.test(ctx.text) ? 'doc' : null;
    const kindWord = kindWanted === 'slides' ? 'deck' : kindWanted ?? 'file';
    let noted: Receipt | null = null;
    let findLine = '';
    if (wantsFind && account) {
      yield { type: 'tool-start', name: 'drive.search', summary: `Searching Drive for ${account} ${kindWord}s you made` };
      const me = settings?.profile.name ?? null;
      const assets = ctx.ops
        .findAssets(account)
        .filter((a) => (target.accountId && a.accountId === target.accountId) || a.title.toLowerCase().includes(account.toLowerCase()))
        .sort((a, b) => Number(b.kind === kindWanted) - Number(a.kind === kindWanted) || Number(b.updatedBy === me) - Number(a.updatedBy === me) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      const hit = assets[0];
      yield { type: 'tool-result', summary: hit ? `${assets.length} ${account} file${assets.length === 1 ? '' : 's'}; best: ${hit.title}` : 'no matches', ok: true };
      if (hit) {
        const exact = !kindWanted || hit.kind === kindWanted;
        const byMe = me && hit.updatedBy === me;
        findLine = exact
          ? `Found **${hit.title}**${hit.updatedAt ? `, last edited ${byMe ? 'by you' : `by ${hit.updatedBy ?? 'someone'}`} ${dayHm(hit.updatedAt, tz)}` : ''}.`
          : `There's no ${account} ${kindWord} in Drive. The closest thing ${byMe ? 'you made' : 'there is'} for them is **${hit.title}** (${hit.kind}).`;
        yield { type: 'tool-start', name: 'items.note', summary: `Noting "${hit.title}" on the item` };
        noted = ctx.ops.addNote(target.id, `For the after-lunch block: ${hit.title}${hit.url ? ` (${hit.url})` : ''}`);
        yield { type: 'tool-result', summary: 'Linked as a note', ok: true };
        yield { type: 'receipt', receipt: combine(`Rescheduled “${target.title}” after lunch and noted the ${kindWord}`, [moved, noted]) };
        yield { type: 'resource', resource: ctx.ops.resourceForAsset(hit) };
      } else {
        findLine = `I couldn't find a ${kindWord} for ${account} in Drive, Slack or your sessions.`;
      }
    }
    if (!noted && moved) yield { type: 'receipt', receipt: combine(`Rescheduled “${target.title}” after lunch`, [moved]) };
    yield { type: 'resource', resource: ctx.ops.resourceForItem(target) };

    const when = `**${hm(after.toISOString(), tz)}**${lunch ? `, after ${lunch.title}` : ''}`;
    yield {
      type: 'text',
      text: [
        rescheduled
          ? `Done: **${target.title}** now starts at ${when}, instead of ${hm(target.startBy, tz)}.`
          : staged
            ? `You set the start time on **${target.title}** yourself, so I didn't change it. **Apply** the proposal to start at ${when}, or keep yours.`
            : failed
              ? `Noted on **${target.title}**: start at ${when}.`
              : `**${target.title}** already starts at ${when}.`,
        findLine,
        noted && moved ? 'Both changes are on the receipt, and you can undo either one on its own.' : moved || noted ? 'Undo from the receipt if that was wrong.' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  },
};

const WHY_TEXT: Record<string, (item: WorkItem, tz?: string) => string> = {
  lead_time: (i) => `it needs about ${minutes(i.effort.agentMin)} of agent time, so it has to start well before it's due`,
  meeting_proximity: (i, tz) => (i.refs.meeting ? `the meeting it serves, **${i.refs.meeting.label}**, starts at ${hm(i.refs.meeting.start, tz)}` : 'a meeting it serves is coming up'),
  customer_facing: () => 'it is for a customer, and customer-facing work carries the most weight in your policy',
  due_urgency: (i, tz) => `it is due ${hm(i.due, tz)}`,
  manager_ask: () => 'your manager asked for it',
  deal_value: () => 'it sits on a large open opportunity',
  age: (i) => `it has been waiting ${i.ageDays} days`,
  effort_fit: (i) => `it takes only ${minutes(i.effort.youMin)} of your time`,
  boost: () => 'you bumped it up yourself',
};

const why: ChatScript = {
  id: 'why',
  description: 'Explain a rank, citing the policy weights and the calendar',
  match: (t) => /^\/why\b/i.test(t.trim()) || /\bwhy\b.*\b(first|top|#\s?\d|ranked|rank|number one|above|ahead|before|priority|high)\b/i.test(t),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    const phrase = /\bwhy\s+(?:is|are|does|do)?\s*(?:the|my)?\s*(.+?)\s*(?:#\s?\d|first|top|ranked|rank|number one|above|ahead|before|so high|high|priority|\?|$)/i.exec(ctx.text.replace(/^\/why\s*/i, 'why '))?.[1] ?? '';
    const top = ctx.ops.topItems(10);
    const target = (tokens(phrase).length ? findTarget(ctx, phrase) : null) ?? (ctx.context.find((c) => c.type === 'work_item') ? findTarget(ctx, '') : null) ?? top[0];
    if (!target) {
      yield { type: 'text', text: 'Nothing is ranked right now.' };
      return;
    }
    const settings = settingsOf(ctx);
    const tz = tzOf(settings);
    const rank = top.findIndex((t) => t.id === target.id) + 1 || target.rank;

    yield { type: 'tool-start', name: 'priority.explain', summary: `Reading the rank reasons for "${target.title}"` };
    yield { type: 'tool-result', summary: `${rank ? `#${rank}` : 'unranked'}${target.score !== null ? ` · score ${target.score}` : ''} · ${target.rankReasons.length} reasons`, ok: true };
    yield { type: 'tool-start', name: 'policy.read', summary: 'Reading your priority policy' };
    const pol = settings?.policy ?? null;
    yield { type: 'tool-result', summary: pol ? `${pol.name} v${pol.version}: customer-facing ${pol.weights.customer_facing}, meeting soon ${pol.weights.meeting_proximity}, lead time ${pol.weights.lead_time}` : 'Policy weights from the ranking', ok: true };
    yield { type: 'tool-start', name: 'calendar.today', summary: 'Checking the meeting it serves' };
    yield { type: 'tool-result', summary: target.refs.meeting ? `${target.refs.meeting.label} at ${hm(target.refs.meeting.start, tz)}` : 'Not tied to a meeting', ok: true };

    if (!rank) {
      const bg = target.isBackground ? 'a background promise, so it stays out of the ranking until it is due or someone asks about it' : `in state "${target.state.replace(/_/g, ' ')}", which the ranking skips`;
      yield { type: 'text', text: `**${target.title}** isn't ranked: it's ${bg}. Give it a due date to bring it into NOW, or hand it off.` };
      yield { type: 'resource', resource: ctx.ops.resourceForItem(target) };
      return;
    }
    const lines = target.rankReasons.map((r) => {
      const explain = WHY_TEXT[r.key]?.(target, tz) ?? (r.key.startsWith('rule:') ? 'one of your rules matches it' : '');
      return `- **${r.label}** (+${r.contribution})${explain ? `: ${explain}` : ''}`;
    });
    const startBy = target.startBy ? `\n\n**Start by ${hm(target.startBy, tz)}**${target.refs.meeting ? ` leaves enough time before ${target.refs.meeting.label} at ${hm(target.refs.meeting.start, tz)}` : ''}.` : '';
    yield {
      type: 'text',
      text: `**${target.title}** is **#${rank}** in NOW${target.score !== null ? ` (score ${target.score})` : ''}. Under your priority policy${pol ? ` (v${pol.version})` : ''}, this is what puts it there:\n\n${lines.join('\n') || '- No single strong signal; it ranks on its due time.'}${startBy}\n\nIf that's wrong, tell me what matters more (for example "prioritize customer-facing over internal today") and I'll preview the re-rank before anything changes.`,
    };
    if (pol) yield { type: 'resource', resource: { kind: 'policy', id: pol.id, label: `${pol.name} v${pol.version}`, href: '/settings?section=policy' } };
    if (target.refs.meeting) yield { type: 'resource', resource: { kind: 'calendar_event', id: target.refs.meeting.id, label: `${target.refs.meeting.label} · ${hm(target.refs.meeting.start, tz)}`, href: target.refs.meeting.href ?? '/' } };
    yield { type: 'resource', resource: ctx.ops.resourceForItem(target) };
  },
};

function moversText(preview: PolicyPreview): string {
  const movers = preview.after.filter((r) => r.moved !== 0).slice(0, 4);
  if (!movers.length) return 'None of your Top 10 would move.';
  return movers.map((r) => `- ${r.moved > 0 ? '↑' : '↓'} **${r.title}**: #${r.rank - r.moved} → #${r.rank}`).join('\n');
}

const prioritizeCustomer: ChatScript = {
  id: 'prioritize-customer',
  description: 'Customer-facing over internal: a staged policy change with a re-rank preview (Apply to commit)',
  match: (t) => /\b(customer|external)[- ]?(facing|work|asks?|stuff)?\b.*\b(over|before|above|ahead of|first|higher than|more than)\b/i.test(t) || /\bprioriti[sz]e\s+(customer|external)/i.test(t),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    yield { type: 'tool-start', name: 'policy.read', summary: 'Reading your priority policy' };
    const settings = settingsOf(ctx);
    const cur = settings?.policy.weights;
    yield { type: 'tool-result', summary: cur ? `v${settings?.policy.version}: customer-facing ${cur.customer_facing}, manager ask ${cur.manager_ask}` : 'Current weights', ok: true };
    yield { type: 'tool-start', name: 'policy.preview', summary: 'Previewing customer-facing +3, manager ask −1 on your Top 10' };
    const { proposal, preview } = ctx.ops.proposePolicy({ customer_facing: 3, manager_ask: -1 }, 'Customer-facing over internal work (from chat)');
    yield { type: 'tool-result', summary: preview.summary, ok: true };
    yield { type: 'proposal', proposal, summary: `Customer-facing work ranks above internal work: ${preview.changedCount} of your Top 10 move` };
    yield {
      type: 'text',
      text: `Here's the re-rank preview. **${preview.changedCount} of your Top 10** would move:\n\n${moversText(preview)}\n\nNothing changes until you **Apply**. It becomes policy v${preview.basedOnVersion + 1} and stays until you change it back; I can't limit a policy to today yet. Apply comes with its own Undo.`,
    };
  },
};

const rescan: ChatScript = {
  id: 'rescan',
  description: 'Re-read a source for a window ("/rescan slack 2d"): tool rows, then a receipt for what got linked',
  match: (t) => /^\/rescan\b/i.test(t.trim()) || /\b(re-?scan|scan again|re-?read)\b/i.test(t),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    const word = /\b(slack|gmail|email|mail|calendar|drive|gemini|notes|org62|vdp|claude)\b/i.exec(ctx.text)?.[1]?.toLowerCase() ?? 'slack';
    const src = SOURCE_ALIASES[word] ?? SOURCE_ALIASES.slack;
    const w = /\b(\d+)\s*(d|days?|h|hrs?|hours?)\b/i.exec(ctx.text);
    const hours = w ? Number(w[1]) * (w[2].toLowerCase().startsWith('d') ? 24 : 1) : 24;
    const windowLabel = w ? `${w[1]}${w[2].toLowerCase().startsWith('d') ? 'd' : 'h'}` : '1d';
    const since = new Date(ctx.now.getTime() - hours * 3_600_000);
    const tz = tzOf(settingsOf(ctx));

    yield { type: 'tool-start', name: `${src.id}.scan`, summary: `Re-reading ${src.label} since ${dayHm(since.toISOString(), tz)} (${windowLabel})`, args: { connector: src.id, scope: `chat:${windowLabel}`, since: since.toISOString() } };
    const scan = ctx.ops.scan(src.id, `chat:${windowLabel}`);
    yield { type: 'tool-result', summary: scan.summary, ok: scan.ok, result: scan.run ? { runId: scan.run.id, status: scan.run.status } : null };
    if (!scan.ok) {
      yield { type: 'text', text: `${src.label} couldn't be re-read: ${scan.summary}. Re-auth it from Health, then ask again.` };
      return;
    }

    yield { type: 'tool-start', name: 'linker.match', summary: `Matching ${src.label} messages to your open items` };
    const touched = ctx.ops.topItems(40).filter((i) => i.sources.some((s) => s.kind === src.id || (src.id === 'gmail' && s.kind === ('email' as never))));
    const recent = touched.filter((i) => i.sources.some((s) => !s.at || Date.parse(s.at) >= since.getTime()));
    const linked = (recent.length ? recent : touched).slice(0, 2);
    yield { type: 'tool-result', summary: `${touched.length} open item${touched.length === 1 ? '' : 's'} cite ${src.label}; ${linked.length} with new activity`, ok: true };
    if (!linked.length) {
      yield { type: 'text', text: `Re-read ${src.label} for the last ${windowLabel}. Nothing new touches your open items.` };
      return;
    }
    yield { type: 'tool-start', name: 'items.link', summary: `Linking ${linked.length} thread${linked.length === 1 ? '' : 's'} as evidence notes` };
    const receipts = linked.map((i) => {
      const s = i.sources.find((x) => x.kind === src.id) ?? i.sources[0];
      return ctx.ops.addNote(i.id, `Rescan (${src.label}, ${windowLabel}): re-linked ${s?.label ?? src.label}; nothing missed.`);
    });
    yield { type: 'tool-result', summary: 'Linked', ok: true };
    yield { type: 'receipt', receipt: combine(`Rescan linked ${linked.length} ${src.label} thread${linked.length === 1 ? '' : 's'} to your items`, receipts) };
    yield {
      type: 'text',
      text: `Re-read **${src.label}** for the last ${windowLabel}. ${linked.length === 1 ? 'One thread touches' : `${linked.length} threads touch`} open items, and I linked ${linked.length === 1 ? 'it' : 'them'} as notes:\n\n${linked.map((i) => `- **${i.title}**`).join('\n')}\n\nNo new asks beyond what's already in NOW. Undo either line if a link is wrong.`,
    };
  },
};

const promises: ChatScript = {
  id: 'promises',
  description: 'What did I promise <person>? → the background promise, as a resource',
  match: (t) => /\bpromis(e|ed|es)\b/i.test(t) || /\bwhat do i owe\b/i.test(t),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    const name = /\b(?:promis(?:e|ed)|owe)\s+(?:to\s+)?([A-Za-z][\w'-]+)/i.exec(ctx.text)?.[1]?.replace(/[?.!,]+$/, '') ?? '';
    const who = name && !/^(them|you|him|her|anyone|everyone)$/i.test(name) ? name : '';
    yield { type: 'tool-start', name: 'work.search', summary: who ? `Searching promises and commitments for ${who}` : 'Listing your open promises' };
    const all = ctx.ops.listItems({ tab: 'promises' });
    let found: WorkItem[] = who ? all.filter((i) => `${i.title} ${i.counterparty?.name ?? ''} ${i.people.map((p) => p.name).join(' ')}`.toLowerCase().includes(who.toLowerCase())) : all;
    if (!found.length && who) {
      const hit = ctx.ops.findItem(who);
      if (hit) found = [hit];
    }
    yield { type: 'tool-result', summary: found.length ? `${found.length} open promise${found.length === 1 ? '' : 's'}${found[0] ? ` · oldest ${Math.max(...found.map((f) => f.ageDays))}d` : ''}` : 'none found', ok: true };
    if (!found.length) {
      yield { type: 'text', text: who ? `I don't see anything you promised ${who}. If it came up in a meeting, try "/rescan gemini 7d".` : 'You have no open background promises.' };
      return;
    }
    for (const f of found.slice(0, 3)) yield { type: 'resource', resource: ctx.ops.resourceForItem(f) };
    const first = found[0];
    const person = first.counterparty?.name ?? who;
    yield {
      type: 'text',
      text:
        found.length === 1
          ? `You promised ${person} to **${first.title.replace(/\s+for\s+\S+$/i, '')}**, ${first.ageDays} days ago. It's a background promise, so it stays out of your Top 10 until it's due or someone asks about it. Open it to set a date or hand it off.`
          : `You have ${found.length} open promises${who ? ` involving ${who}` : ''}:\n\n${found.map((f) => `- **${f.title}** (${f.ageDays}d)`).join('\n')}`,
    };
  },
};

const logMeeting: ChatScript = {
  id: 'log',
  description: '/log last meeting → points at the activity row in Activity (never submits to Org62)',
  match: (t) => /^\/log\b/i.test(t.trim()) || /\blog (my |the )?(last|previous) meeting\b/i.test(t),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    yield { type: 'tool-start', name: 'calendar.recent', summary: 'Finding your last meeting' };
    const tz = tzOf(settingsOf(ctx));
    const events = ctx.ops.calendarToday();
    const last = events.filter((e) => Date.parse(e.end) <= ctx.now.getTime()).at(-1);
    yield { type: 'tool-result', summary: last ? `${last.title}, ${hm(last.start, tz)}–${hm(last.end, tz)}` : 'No finished meeting today', ok: true };
    yield { type: 'resource', resource: { kind: 'url', id: 'time', label: 'Activity · log', href: '/activity' } };
    yield {
      type: 'text',
      text: last
        ? `Your last meeting was **${last.title}** (${hm(last.start, tz)}–${hm(last.end, tz)}). Its activity row is in **Time**: review it there and hand it off. I never submit to Org62 from chat.`
        : 'No meeting has finished yet today. Yesterday’s rows are in **Time**.',
    };
  },
};

const capture: ChatScript = {
  id: 'capture',
  description: '/capture <text> → a real, undoable quick capture',
  match: (t) => /^\/capture\b/i.test(t.trim()),
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    const text = ctx.text.trim().replace(/^\/capture\s*/i, '');
    if (!text) {
      yield { type: 'text', text: 'Add what to capture, for example `/capture Send Dana the SSO doc ~10m`.' };
      return;
    }
    yield { type: 'tool-start', name: 'items.capture', summary: `Capturing "${text}"` };
    const r = ctx.ops.capture(text);
    yield { type: 'tool-result', summary: 'Captured; enriching in the background', ok: true, result: { itemId: r.item.id } };
    yield { type: 'receipt', receipt: r.receipt };
    yield { type: 'resource', resource: ctx.ops.resourceForItem(r.item) };
    yield { type: 'text', text: `Captured **${r.item.title}**. I'll attach related threads and files as they turn up.` };
  },
};

const find: ChatScript = {
  id: 'find',
  description: 'Find a file or item the app missed and link it',
  match: (t) => /\b(find|look ?up|where('| i)s|\/find)\b/i.test(t),
  async *run(ctx) {
    const q = ctx.text.replace(/^\/?find\s*/i, '').replace(/\b(find|look ?up|where('| i)s|the|my|a)\b/gi, ' ').trim() || ctx.text;
    yield { type: 'tool-start', name: 'drive.search', summary: `Searching Drive for "${q}"` };
    const assets = ctx.ops.findAssets(q);
    yield { type: 'tool-result', summary: assets.length ? `${assets.length} match${assets.length === 1 ? '' : 'es'}` : 'no matches', ok: true };
    if (!assets.length) {
      yield { type: 'text', text: `I could not find anything matching "${q}" in Drive, Slack or your sessions.` };
      return;
    }
    for (const a of assets.slice(0, 2)) yield { type: 'resource', resource: ctx.ops.resourceForAsset(a) };
    yield { type: 'text', text: `Found **${assets[0].title}**${assets[0].updatedBy ? `, last edited by ${assets[0].updatedBy}` : ''}. Want me to link it to the item in view?` };
  },
};

const policy: ChatScript = {
  id: 'policy',
  description: 'Change the priority policy (staged proposal with a re-rank preview)',
  match: (t) => /\b(policy|weight|matter(s)? more|care more|\/policy)\b/i.test(t),
  async *run(ctx) {
    yield { type: 'tool-start', name: 'policy.preview', summary: 'Previewing: customer-facing weight +2' };
    const { proposal, preview } = ctx.ops.proposePolicy({ customer_facing: 2 }, 'Customer-facing work matters more (from chat)');
    yield { type: 'tool-result', summary: preview.summary, ok: true };
    yield { type: 'proposal', proposal, summary: preview.summary };
    yield {
      type: 'text',
      text: `Here is the re-rank preview: ${preview.changedCount} of your Top 10 would move. Nothing changes until you **Apply**; it becomes policy v${preview.basedOnVersion + 1}.`,
    };
  },
};

const failure: ChatScript = {
  id: 'error',
  description: 'Demonstrates the error event ("/error" or "simulate an error")',
  match: (t) => /^\/error\b/i.test(t.trim()) || /\bsimulate (an |a )?(error|failure|outage)\b/i.test(t),
  async *run() {
    yield { type: 'tool-start', name: 'slack.search', summary: 'Searching Slack' };
    yield { type: 'tool-result', summary: 'Slack MCP needs re-auth', ok: false };
    yield { type: 'error', code: 'upstream_unavailable', message: 'Slack is disconnected. Re-auth from Health, then ask again.' };
  },
};

/** Default: one of every event type (text, tool-start/result, receipt, proposal, resource, done). */
const tour: ChatScript = {
  id: 'default',
  description: 'Morning check-in that shows every event type',
  match: () => true,
  async *run(ctx): AsyncGenerator<ChatStep, void, void> {
    const top = ctx.ops.topItems(3);
    yield { type: 'text', text: top.length ? `Your Top 3 right now:\n\n${top.map((t, i) => `${i + 1}. **${t.title}**${t.purpose ? ` (${t.purpose})` : ''}`).join('\n')}\n\n` : 'Nothing is ranked yet.\n\n' };
    yield { type: 'tool-start', name: 'calendar.today', summary: 'Checking your next meetings' };
    yield { type: 'tool-result', summary: 'Next meeting found', ok: true };
    const target = top[2] ?? top[0];
    if (target) {
      yield { type: 'tool-start', name: 'items.note', summary: `Noting this check-in on "${target.title}"` };
      const receipt = ctx.ops.addNote(target.id, `Discussed in chat: ${ctx.text.slice(0, 80)}`);
      yield { type: 'tool-result', summary: 'Note added', ok: true };
      yield { type: 'receipt', receipt };
      const proposal = ctx.ops.proposeItemPatch(target.id, { effort: { youMin: Math.max(5, target.effort.youMin - 5), agentMin: target.effort.agentMin } }, 'Chat suggests a smaller estimate');
      yield { type: 'proposal', proposal, summary: 'Shave 5 minutes off the estimate?' };
      yield { type: 'resource', resource: ctx.ops.resourceForItem(target) };
    }
    yield { type: 'text', text: 'I can re-prioritize ("do X first"), find files ("find the ACME deck"), or change your policy ("customer work matters more"). I never send anything.' };
  },
};

export const chatScripts: ChatScript[] = [failure, capture, logMeeting, moveAfterLunch, why, rescan, promises, reprioritize, find, policy, prioritizeCustomer, tour];

export function pickChatScript(text: string, ctx: ChatScriptContext): ChatScript {
  return chatScripts.find((s) => s.match(text, ctx)) ?? tour;
}
