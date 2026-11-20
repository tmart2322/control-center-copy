/**
 * Domain 06: chat threads, messages and tool calls (hand-written). The 14 assistant messages reserved by domain 03
 * (`llm-chat-01`..`14`) carry the llm_calls ids 284..693; their times, models and tokens come from llm_calls.json.
 * Thread T0 sits on 10-19..10-21, the first-scan days whose LLM calls were rolled up into llm_call_days (no llm_call_id).
 * Facts (titles, due dates, scores, scan runs) are read from the earlier domains' JSON, never retyped.
 */
import { dueText, evidenceOf, keyOfSi, mt, runRow, runNumber, wi, wiId, wiTitle } from './intel-lib';

export interface ToolSpec {
  name: string;
  input: Record<string, unknown>;
  summary: string;
  output?: unknown;
  /** staged change that waited for the user's Apply (requires_confirmation) */
  mutation?: boolean;
  cs?: number; // change_sets n
  status?: 'succeeded' | 'failed' | 'awaiting_confirmation' | 'rejected';
  error?: string;
  /** structured proposal card (chat_propose_changes) */
  proposal?: { entity: { type: string; id: string; label: string }; reason: string; changes: Array<{ field: string; label: string; before: unknown; after: unknown }>; status: 'applied' | 'pending'; summary: string; changesRaw: unknown[] };
  resource?: { kind: string; id: string; label: string; href: string };
  /** override the tool start/finish instants (ISO); default: inside the llm call's window */
  at?: [string, string];
  refDraft?: string; // reserved draft key for a chat_draft card
  entryRefs?: string[]; // reserved activity_entries keys
}
export interface Ctx { type: string; id: string; label: string; via: 'auto' | 'explicit' }
export interface TurnSpec {
  /** reserved message key (`llm-chat-NN`) of the assistant message, or a plain turn key */
  key: string;
  llm?: number;
  userAt: string; // ISO; for reserved turns derived from the llm call when omitted
  user: string;
  ctx?: Ctx[];
  assistantAt?: string; // ISO (turns without an llm call)
  assistant: string;
  tools: ToolSpec[];
  /** items quoted in the answer (provenance_links: chat_message → source items) */
  quotes?: string[];
}
export interface ThreadSpec {
  key: string;
  title: string;
  scope: 'global' | 'day' | 'work_item' | 'account' | 'opportunity';
  wi?: number; acct?: string; opp?: string;
  sdk: string;
  turns: TurnSpec[];
  archived?: boolean;
}

const rd = <T>(x: T) => x;
const L = (n: number, hhmm: string) => `@${n}|${hhmm}`;
const wctx = (n: number, via: 'auto' | 'explicit' = 'auto'): Ctx => ({ type: 'work_item', id: wiId(n), label: wiTitle(n), via });

/** "scan runs so far" text for T0 turn 1, from scan_runs.json. */
export function firstScanFacts(untilIso: string) {
  const runs = (globalThis as any).__scanRuns as Array<Record<string, any>>;
  const done = runs.filter((r) => String(r.started_at) <= untilIso);
  return { total: done.length, ok: done.filter((r) => r.status === 'succeeded').length, failed: done.filter((r) => r.status === 'failed').length };
}

const dueRow = (n: number) => ({ id: wiId(n), title: wiTitle(n), due: String(wi(n).due_at), status: String(wi(n).status) });
const dueLine = (n: number) => `- ${wiTitle(n)}: ${dueText(n)}`;

export function buildThreads(): ThreadSpec[] {
  const slackRuns = [111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121].map((n) => runRow(n));
  const runLines = slackRuns
    .filter((r) => String(r.scope ?? '').startsWith('slack') || r.scope === null)
    .map((r) => ({ run: runNumber(String(r.id)), at: mt(r.started_at).time, scope: r.scope, status: r.status, error: r.error_code, newItems: r.items_new }));

  // top 3 of the priority runs the chat reads (23 = Tue 11-17 morning, 25 = today)
  const prioTop = (run: number) => {
    const scores = (globalThis as any).__prioScores as Array<Record<string, any>>;
    const wk = (globalThis as any).__wiKey as Map<string, number>;
    return scores.filter((s) => Number(s.run_id) === run && s.rank !== null && s.lane === 'top3').sort((a, b) => Number(a.rank) - Number(b.rank)).map((s) => ({ n: wk.get(String(s.work_item_id))!, rank: Number(s.rank), total: Number(s.total), why: String(s.explanation) }));
  };
  const top17 = prioTop(23);
  const top18 = prioTop(25);

  const week = [15, 60, 31, 32, 14, 6, 66, 29, 3, 53, 90, 21];
  const clean = (why: string) => why.replace(/^Top 3: /, '').replace(/,? \d+ rules? applied/, '').replace(/;? score [\d.]+\.?$/, '').replace(/[,;]\s*$/, '');
  const grouped = (nums: number[]) => {
    const byDay = new Map<string, number[]>();
    for (const n of [...nums].sort((a, b) => String(wi(a).due_at).localeCompare(String(wi(b).due_at)))) {
      const m = mt(wi(n).due_at); const k = `${m.dow} ${m.md}`; byDay.set(k, [...(byDay.get(k) ?? []), n]);
    }
    return [...byDay.entries()].map(([k, ns]) => `${k}\n${ns.map(dueLine).join('\n')}`).join('\n\n');
  };
  const openDue = (globalThis as any).__openDueThisWeek as number;

  return [
    // ── T0: first week (rolled-up LLM days: no llm_call ids) ───────────────────────────────────────
    {
      key: 'first-week', title: 'Getting started: what is the app watching, and what first?', scope: 'global', sdk: 'sdk-smpl-0001',
      turns: [
        {
          key: 't0-01', userAt: L(-30, '10:41'), assistantAt: L(-30, '10:41:31'),
          user: 'What are you watching for me right now?',
          assistant: 'Nine connections, all read-only: Slack, Gmail (work), Gmail (customer alias), Drive, Calendar, Gemini notes, Org62, your Claude sessions and VDP. The first scan starts with the last 24 hours and widens to 30 days over the next few runs, so older items will be sparse today. Nothing is sent or written anywhere; replies and logs stay drafts until you approve them.',
          tools: [{ name: 'chat_app_read', input: { route: 'scans', query: { since: '2026-10-19T00:00:00-06:00' } }, summary: 'First-scan runs so far today', output: { page: { list: 'runs', total: firstScanFacts('2026-10-19T17:41:00.000Z').total }, ok: firstScanFacts('2026-10-19T17:41:00.000Z').ok, failed: firstScanFacts('2026-10-19T17:41:00.000Z').failed } }],
        },
        {
          key: 't0-02', userAt: L(-30, '10:46'), assistantAt: L(-30, '10:46:24'),
          user: 'Which accounts are mine?',
          assistant: 'Twelve accounts are in your book: Saltmere Health Plan; the Yarrowdale family (Yarrowdale Health System, Medical Group, Behavioral Health); the Elderglen family (Elderglen Retail Group, Outdoors, Home & Living); Halvergate Freight Lines; Ferrowpay Financial; Harrowgate Manufacturing; Cascadia County Services; and Oakhallow Mutual Insurance. Voltmere Utilities and Contoso Marketplace show as watched, not yours.',
          tools: [{ name: 'chat_app_read', input: { route: 'deals', query: { mine: true } }, summary: '12 accounts in your book, 2 watched', output: { page: { total: 14 }, mine: 12, watched: 2 } }],
        },
        {
          key: 't0-03', userAt: L(-30, '11:20'), assistantAt: L(-30, '11:20:19'),
          user: 'Why are Voltmere and Contoso "watched" and not mine?',
          assistant: 'You are not on the team of any of their opportunities, so the app keeps them out of your work list. Watching gives you a weekly brief on each (what moved, what is worth a look) without creating tasks. If you ever join a deal team, the account moves into your book on the next Org62 read.',
          tools: [],
        },
        {
          key: 't0-04', userAt: L(-30, '14:05'), assistantAt: L(-30, '14:05:40'),
          user: 'Show me what you found so far that needs me.',
          assistant: 'The first scan is still running, so this is early: one item so far. "Follow up with Anjali on the route exceptions proposal" is yours (Nadia asked, and the proposal has been in Anjali\'s hands since this morning), and I marked it as waiting on others. Everything else is still being linked to opportunities; I will not rank anything until the scan settles.',
          tools: [{ name: 'chat_app_read', input: { route: 'find_items', query: { q: 'Anjali' } }, summary: '1 item', output: { rows: [{ id: wiId(8), title: wiTitle(8), due: null, status: String(wi(8).status) }] } }],
          quotes: ['si-036'],
        },
        {
          key: 't0-07', userAt: L(-29, '09:30'), assistantAt: L(-29, '09:30:12'),
          user: 'What does "waiting on others" mean on the Anjali follow-up?',
          assistant: 'You committed to follow up and the next move is hers: she said she would review the proposal with ops leadership this week. The item stays open but drops out of Top 3 until she replies or a few days pass; then I will suggest a nudge draft. It comes back sooner if the close date gets close.',
          tools: [],
          quotes: ['si-036'],
        },
        {
          key: 't0-08', userAt: L(-29, '13:15'), assistantAt: L(-29, '13:15:27'),
          user: 'Can you stop showing me #industry-news? It is noise.',
          assistant: 'It is already on Ignore, along with #company-announcements: messages there are recorded but never become work. They can still show up in a brief if you watch a search topic like "prior authorization automation". Want me to set up that kind of watch?',
          tools: [{ name: 'chat_app_read', input: { route: 'settings', query: { section: 'channels' } }, summary: 'Channel modes', output: { ignore: ['#industry-news', '#company-announcements'], digest: ['#se-demo-requests', '#deal-desk-help', '#data-ai-specialists'] } }],
        },
        {
          key: 't0-05', userAt: L(-28, '07:55'), assistantAt: L(-28, '07:55:41'),
          user: "What's my Top 3 today?",
          assistant: 'Only two items are ranked so far, and I would rather show two honest items than pad the list. (1) "Draft the POC success criteria document for Saltmere", due Tue Oct 27, 17:00: it is customer-facing and came out of Tuesday\'s sync. (2) "Log last week\'s time to Org62 (week of 10/19)", due Fri Oct 23, 16:00. The Gmail and Drive scans are still catching up.',
          tools: [{ name: 'chat_app_read', input: { route: 'home' }, summary: 'Home: 2 ranked items, scan still ramping', output: { top3: [{ id: wiId(1), title: wiTitle(1) }, { id: wiId(85), title: wiTitle(85) }] } }],
          quotes: ['si-050'],
        },
        {
          key: 't0-06', userAt: L(-28, '08:10'), assistantAt: L(-28, '08:10:21'),
          user: 'Why is the Saltmere one first?',
          assistant: 'Three reasons from the rank breakdown: it is customer-facing (the "customer-facing beats internal" rule adds +2), it is due in six days, and the opportunity it belongs to is the largest in your book at $1.25M. The weekly log is internal admin, so it carries a small penalty.',
          tools: [{ name: 'chat_app_read', input: { route: 'item_trace', params: { id: wiId(1) } }, summary: 'Rank reasons for the success criteria item', output: { rank: 1, reasons: ['customer-facing', 'due in 6d', 'deal value'] } }],
        },
        {
          key: 't0-10', userAt: L(-28, '08:30'), assistantAt: L(-28, '08:30:44'),
          user: 'Anything I should know before the Saltmere sync on Thursday?',
          assistant: 'From Tuesday\'s notes: you committed to draft the POC success criteria document by Oct 27; Marisol will share the member-contact data map; and the group agreed to pick the first journey (member services) before the security review. I would walk in with the draft criteria outline.',
          tools: [{ name: 'chat_search_sources', input: { query: 'Saltmere weekly sync notes', kinds: ['gemini_notes'] }, summary: '1 meeting note', output: { hits: [{ source: 'gemini_notes', title: 'Notes by Gemini: Saltmere weekly sync' }] } }],
          quotes: ['si-050'],
        },
        {
          key: 't0-11', userAt: L(-28, '08:50'), assistantAt: L(-28, '08:50:14'),
          user: 'Who is Gustavo?',
          assistant: 'Gustavo Bernal is the Data 360 and Agentforce specialist paired with you on Saltmere, Yarrowdale and Ferrowpay. He owns the consumption model and the sizing sheets.',
          tools: [{ name: 'chat_app_read', input: { route: 'people', query: { q: 'Gustavo' } }, summary: '1 person', output: { people: [{ name: 'Gustavo Bernal', title: 'Specialist, Data 360 and Agentforce', affiliation: 'internal' }] } }],
        },
        {
          key: 't0-12', userAt: L(-28, '12:05'), assistantAt: L(-28, '12:05:29'),
          user: 'Is Gmail scanning my customer alias too?',
          assistant: 'Yes. "Gmail (customer alias)" is a separate connection with its own cursor, and it is healthy. Mail sent to the alias that is about one of your accounts links to the same opportunity as your work mailbox.',
          tools: [],
        },
        {
          key: 't0-09', userAt: L(-28, '14:00'), assistantAt: L(-28, '14:00:36'),
          user: 'What did I promise Saltmere so far?',
          assistant: 'Three things: draft the POC success criteria document (due Tue Oct 27, 17:00), send a consumption sizing estimate for the unified member profile (no date; you said it in Slack, so it is waiting on volumes from the customer), and explain production consumption pricing to Priyanka (due Thu Nov 5, 13:00).',
          tools: [{ name: 'chat_app_read', input: { route: 'find_items', query: { q: 'Saltmere', status: 'open' } }, summary: '3 items', output: { rows: [dueRow(1), { id: wiId(7), title: wiTitle(7), due: null, status: String(wi(7).status) }, dueRow(33)] } }],
          quotes: ['si-050'],
        },
        {
          key: 't0-13', userAt: L(-28, '14:10'), assistantAt: L(-28, '14:10:44'),
          user: 'What changed in Org62 on my opportunities since yesterday?',
          assistant: 'Nothing yet: the first Org62 read was Monday, so there is nothing to compare against. From the next read on I flag stage, amount, close date and next-step changes, and they show up in the opportunity brief.',
          tools: [{ name: 'chat_app_read', input: { route: 'since' }, summary: 'No Org62 changes recorded', output: { org62Changes: 0 } }],
        },
        {
          key: 't0-14', userAt: L(-28, '15:30'), assistantAt: L(-28, '15:30:18'),
          user: 'Also read #voltmere-account since I am watching the account.',
          assistant: '#voltmere-account is already on Digest: its messages are scanned and show up in the Voltmere brief, but they do not create tasks. No change needed.',
          tools: [],
        },
      ],
    },
    // ── T1: policy v2 (11-06) ──────────────────────────────────────────────────────────────────────
    {
      key: 'policy', title: 'Raise manager asks and deal value (policy v2)', scope: 'global', sdk: 'thread-smpl-policy',
      turns: [
        {
          key: 'llm-chat-01', llm: 284, userAt: '', assistantAt: '',
          user: 'I keep missing things Hana asks for in DMs. Can you weigh her asks higher? Bigger deals should float up too.',
          assistant: 'Your current policy (v1, from the SE role template) boosts manager asks by +3 and weighs deal value at 1.0. I would raise the manager rule to +4, deal value to 1.2 and stakeholder importance from 1.5 to 1.8, so a DM from Hana outranks an internal chore and a $1M+ deal outranks a small one. I can show how today\'s ranking would move before you apply anything.',
          tools: [{ name: 'chat_app_read', input: { route: 'settings', query: { section: 'priorities' } }, summary: 'Active policy v1', output: { version: 1, rules: [{ key: 'r_customer', effect: 2 }, { key: 'r_manager', effect: 3 }, { key: 'r_admin', effect: -1 }], weights: { deal_value: 1, stakeholder_importance: 1.5, obligation: 2 } } }],
        },
        {
          key: 'llm-chat-02', llm: 285, userAt: '', assistantAt: '',
          user: 'Yes, show me. Also add a task to prep the Saltmere data-flow diagram for the architecture board, due the 19th. I do not want admin chores to vanish completely.',
          assistant: 'Done on both. Admin chores keep their -1 penalty, so they sink but stay visible, and I will show the re-rank once you apply the weights. I staged the new task "Prep the Saltmere data-flow diagram" (due Thu Nov 19, 17:00); apply it from the card.',
          tools: [{
            name: 'chat_propose_changes', mutation: true, cs: 237,
            input: { summary: 'Create "Prep the Saltmere data-flow diagram"?', changes: [{ op: 'create_item', title: 'Prep the Saltmere data-flow diagram', kind: 'task', due: String(wi(39).due_at), accountId: 'saltmere' }] },
            summary: 'Staged 1 change: create item', output: { proposalId: 'prop-smpl-0001', status: 'applied', created: [{ id: wiId(39), title: wiTitle(39) }] },
            proposal: { entity: { type: 'work_item', id: wiId(39), label: wiTitle(39) }, reason: 'Created from your request in chat', status: 'applied', summary: 'Create "Prep the Saltmere data-flow diagram"?', changes: [{ field: 'title', label: 'Title', before: null, after: wiTitle(39) }, { field: 'due', label: 'Due', before: null, after: String(wi(39).due_at) }], changesRaw: [{ op: 'create_item', title: wiTitle(39), kind: 'task', due: String(wi(39).due_at) }] },
          }],
        },
        {
          key: 'llm-chat-03', llm: 286, userAt: '',  assistantAt: '',
          user: 'Apply the new weights. And move the Yarrowdale trust domain write-up to Sunday, I cannot do it Friday.',
          assistant: 'Staged both. Policy v2 raises the manager rule to +4, deal value to 1.2, stakeholder importance to 1.8, deadline proximity to 1.8, commitment to 2.0 and calendar pressure to 1.4, and re-ranks 27 open items. The "Write up the Behavioral Health trust domain approach for Yarrowdale" item moves from Friday to Sunday Nov 8, 16:00. Apply the policy to make it live; Undo reverts it in one click.',
          tools: [
            {
              name: 'chat_propose_changes', mutation: true, cs: 238,
              input: { summary: 'Move the Yarrowdale trust domain write-up to Sunday?', changes: [{ op: 'edit_fields', itemId: wiId(88), patch: { dueAt: String(wi(88).due_at) } }] },
              summary: 'Staged 1 change: move due date', output: { proposalId: 'prop-smpl-0002', status: 'applied' },
              proposal: { entity: { type: 'work_item', id: wiId(88), label: wiTitle(88) }, reason: 'You cannot do it Friday', status: 'applied', summary: 'Move the Yarrowdale trust domain write-up to Sunday?', changes: [{ field: 'due', label: 'Due', before: '2026-11-06T23:00:00.000Z', after: String(wi(88).due_at) }], changesRaw: [{ op: 'edit_fields', itemId: wiId(88), patch: { due: String(wi(88).due_at) } }] },
            },
            {
              name: 'chat_update_priority_policy', mutation: true, cs: 64,
              input: { summary: 'Raise manager asks and deal value (policy v2)?', changes: [{ op: 'policy_weights', deltas: { deal_value: 0.2, stakeholder_importance: 0.3, deadline_proximity: 0.3, commitment: 0.5, calendar_pressure: 0.2 }, note: 'Raised manager asks and deal value after chatting about missed asks' }, { op: 'policy_rule', action: 'add', rule: { key: 'r_manager', effect: 4 } }] },
              summary: 'Policy v2 created, 27 open items re-ranked', output: { policyVersion: 2, based_on: 1, reranked: 27, runTrigger: 'chat' },
              proposal: { entity: { type: 'policy', id: 'policy-v2', label: 'Priority policy v2' }, reason: 'Raised manager asks and deal value after chatting about missed asks', status: 'applied', summary: 'Raise manager asks and deal value (policy v2)?', changes: [{ field: 'r_manager', label: 'Manager asks boost', before: 3, after: 4 }, { field: 'deal_value', label: 'Deal value weight', before: 1, after: 1.2 }, { field: 'stakeholder_importance', label: 'Stakeholder importance', before: 1.5, after: 1.8 }], changesRaw: [{ op: 'policy_weights', deltas: { deal_value: 0.2 } }] },
            },
          ],
        },
      ],
    },
    // ── T2: log last week (11-09) ──────────────────────────────────────────────────────────────────
    {
      key: 'logging', title: 'Log last week (week of 11/02)', scope: 'global', sdk: 'thread-smpl-logging',
      turns: [
        {
          key: 'llm-chat-04', llm: 355, userAt: '', assistantAt: '',
          ctx: [wctx(87, 'explicit')],
          user: 'Can you log last week? The week of 11/02.',
          assistant: 'The weekly item "Log last week\'s time to Org62 (week of 11/02)" was due Fri Nov 6, 16:00. Most of that week is already in Org62: you logged 11 events by hand on Nov 6 (8.25 hours) and the check found all of them. Two calendar events did not take: Elderglen Home on 11/03 and the 11/06 technical validation kickoff failed read-back, so those need a fix on your side. I proposed one new row, Data 360 office hours (Gustavo) on 11/06 for 1 hour, and dismissed the Referral agent decision call because that opportunity closed lost on 11/06. I can stage the row for your Apply on Time; it would go out on the next logging canvas. While I was in the Saltmere VDP I also set the stage of the "Claims Status Lookup" use case; that is staged for your Apply on Time ▸ VDP too.',
          tools: [
            { name: 'chat_log_batch', input: { weeks: ['2026-11-02'], stage: false }, summary: '1 new row, 1 h; 11 events already in Org62', output: { rows: 1, hours: 1, ready: 1, needsInput: 0, dismissed: 1, canvases: 0, org62Check: '11 matching Events found (8.25 h), 2 failed read-back' } },
            { name: 'chat_vdp_update', mutation: true, cs: 290, input: { key: 'saltmere-health-plan-data-360-poc', useCaseId: 'vdp-uc-smpl-002', op: 'set_field', field: 'stage', value: 'Technical Validation' }, summary: 'Staged 1 VDP field change for Apply', output: { staged: true, outboxKind: 'vdp', autonomy: 'L2_stage' } },
          ],
          quotes: [],
        },
      ],
    },
    // ── T3: identity merge (11-12) ─────────────────────────────────────────────────────────────────
    {
      key: 'identity', title: 'Are Mari Q. and Marisol Quintero the same person?', scope: 'account', acct: 'saltmere', sdk: 'thread-smpl-slack',
      turns: [
        {
          key: 'llm-chat-05', llm: 518, userAt: '',
          assistantAt: '',
          ctx: [{ type: 'person', id: 'hv-marisol', label: 'Marisol Quintero', via: 'explicit' }],
          user: 'In #saltmere-poc I see "Mari Q." and Marisol Quintero as two people. Same person? And turn on the Friday missed-DC sweep reminder while you are here.',
          assistant: 'Very likely the same person. "Mari Q." is the Slack display name on the revised KPI list from Nov 6, her email mari.q@saltmere-health.example is the same domain as Marisol\'s, and both use the title Member Experience; the mapping rule for that sender (created yesterday) already points the address at Marisol. I turned on the missed-DC sweep reminder. Want me to merge the two identities so new messages land on one person?',
          tools: [
            { name: 'chat_app_read', input: { route: 'people', query: { q: 'Mari' } }, summary: '2 people: Mari Q., Marisol Quintero', output: { people: [{ name: 'Mari Q.', via: 'slack', archived: false }, { name: 'Marisol Quintero', via: 'email+slack', archived: false }] } },
            { name: 'chat_update_settings', mutation: true, cs: 375, input: { section: 'closing', patch: { missedDcSweepReminder: true } }, summary: 'Missed-DC sweep reminder is on (Fridays)', output: { section: 'closing', changed: ['missedDcSweepReminder'] } },
          ],
          quotes: ['si-348'],
        },
        {
          key: 'llm-chat-06', llm: 522, userAt: '', assistantAt: '',
          user: 'Yes, merge them. And snooze the KPI item until tomorrow morning.',
          assistant: 'Merged: Mari Q. is archived under Marisol Quintero and her Slack handle stays as an alternate identity, so new messages map to Marisol. The two KPI items (one under each name) now read as one; I snoozed "Fold Marisol\'s revised KPIs and baseline into the POC success criteria" until tomorrow 08:00.',
          tools: [
            { name: 'chat_app_change', mutation: true, input: { calls: [{ route: 'mergePeople', params: { survivor: 'Marisol Quintero', merged: 'Mari Q.' }, label: 'Merge Mari Q. into Marisol Quintero' }], summary: 'Merge two identities?' }, summary: '1 identity merged', output: { merged: 1, survivor: 'Marisol Quintero', alternateIdentity: 'slack mari.q' } },
            { name: 'chat_propose_changes', mutation: true, cs: 376, input: { summary: 'Snooze the KPI item until tomorrow 08:00?', changes: [{ op: 'snooze', itemId: wiId(54), until: '2026-11-13T08:00:00-07:00' }] }, summary: 'Snoozed until Fri 08:00', output: { proposalId: 'prop-smpl-0003', status: 'applied' },
              proposal: { entity: { type: 'work_item', id: wiId(54), label: wiTitle(54) }, reason: 'You asked to look at it tomorrow morning', status: 'applied', summary: 'Snooze the KPI item until tomorrow 08:00?', changes: [{ field: 'snoozedUntil', label: 'Snoozed until', before: null, after: '2026-11-13T08:00:00-07:00' }], changesRaw: [{ op: 'snooze', itemId: wiId(54), until: '2026-11-13T08:00:00-07:00' }] } },
          ],
        },
      ],
    },
    // ── T4: late Slack items (11-14) ───────────────────────────────────────────────────────────────
    {
      key: 'late-slack', title: 'Why Slack items were late on Nov 12', scope: 'global', sdk: 'thread-smpl-week',
      turns: [
        {
          key: 'llm-chat-07', llm: 577, userAt: '', assistantAt: '',
          user: 'Why were some Slack items late on Thursday? I only saw the Cascadia thread at noon.',
          assistant: 'Slack rate-limited us that morning. The inbox scans at 08:20, 08:35, 08:50 and 09:05 all failed with rate_limited (the connector went degraded at 08:35 and error at 09:05) and a queued Slack job was dead-lettered after it ran out of attempts. It recovered at 10:12 (a run that found 9 new items) and healthy was recorded at 10:15. The #cascadia-onsite message about the accessibility checklist was posted at 11:20 and only picked up at 11:31: the channel scan at 11:08 had ended partial with a transient error, so the 11:30 reconcile run was the first to see it. That run also flagged the 08:05 to 10:12 gap, and the gap is resolved. I renamed this thread so you can find it again.',
          tools: [
            { name: 'chat_app_read', input: { route: 'scans', query: { connector: 'slack', from: '2026-11-12T00:00:00-07:00', to: '2026-11-13T00:00:00-07:00' } }, summary: '11 runs on Nov 12, 4 rate-limited', output: { runs: runLines } },
            { name: 'chat_rename_thread', mutation: true, cs: 406, input: { title: 'Why Slack items were late on Nov 12' }, summary: 'Renamed the thread', output: { title: 'Why Slack items were late on Nov 12' } },
          ],
          quotes: ['si-516'],
        },
      ],
    },
    // ── T5: Saltmere blueprint (11-16) ───────────────────────────────────────────────────────────
    {
      key: 'blueprint', title: 'Saltmere blueprint: sections 6 and 7', scope: 'work_item', wi: 3, acct: 'saltmere', opp: 'saltmere-data360-poc', sdk: 'thread-smpl-blueprint',
      turns: [
        {
          key: 'llm-chat-08', llm: 622, userAt: '', assistantAt: '',
          ctx: [wctx(3), wctx(15, 'explicit')],
          user: 'Help me outline sections 6 and 7 of the Saltmere blueprint (data model and rollout plan). Sections 1 to 5 are in the doc. And log my Monday morning writing block.',
          assistant: 'Section 6, data model: (a) the unified member profile with identity resolution rulesets (exact on member ID, fuzzy on name, date of birth and address as fallback); (b) the objects that feed it: member and plan data, claims status from the warehouse ingest (Ravindra\'s estimate is 6 to 8 weeks), the 90-day contact-center export; (c) calculated insights behind the four success KPIs: containment rate for status questions, deflection of claim-status calls, average handle time delta and member satisfaction. Section 7, rollout: phase 0 sandbox, SSO and permission sets (waits on the IdP group answer); phase 1 member services agent on status questions; phase 2 claims status lookup with the denied-claim handoff; phase 3 measure against the KPIs and harden before the architecture board on Dec 1. Section 8 stays with Gustavo. I staged your Monday writing block (3 h) for the logging canvas; it waits for your Apply.',
          tools: [
            { name: 'chat_app_read', input: { route: 'item_evidence', params: { id: wiId(3) } }, summary: `${evidenceOf(3).length} pieces of evidence`, output: { evidence: evidenceOf(3).slice(0, 5).map((id) => keyOfSi(id)), total: evidenceOf(3).length } },
            { name: 'chat_log_batch', mutation: true, cs: 441, entryRefs: ['nba-wi003-focus-log'], input: { stage: true, entries: [{ opp: 'saltmere-data360-poc', subject: 'Saltmere POC blueprint writing', durationH: 3, day: '2026-11-16' }] }, summary: 'Staged 1 row (3.0 h) for the logging canvas', output: { rows: 1, hours: 3, status: 'proposed' } },
          ],
          quotes: ['si-348', 'si-180', 'si-483'],
        },
        {
          key: 'llm-chat-09', llm: 623, userAt: '', assistantAt: '',
          ctx: [wctx(15)],
          user: 'Good. Add a note to the sections 6 and 7 item that the rollout plan depends on the IdP group answer, and draft the intro paragraph for section 7.',
          assistant: 'Added the note to "Finish blueprint sections 6 and 7 (data model and rollout plan)". Draft intro for section 7: "Rollout proceeds in four phases over roughly ten weeks, gated by evidence rather than dates. Phase 0 prepares the sandbox, single sign-on and permission sets; phase 1 puts the member services agent in front of status questions; phase 2 adds claims status lookup and the denied-claim handoff; phase 3 measures containment, deflection, handle time and member satisfaction against the success criteria before the architecture board on December 1." It is text in this chat, not a Drive edit.',
          tools: [{ name: 'chat_propose_changes', mutation: true, cs: 442, input: { summary: 'Add a note to the sections 6 and 7 item?', changes: [{ op: 'edit_fields', itemId: wiId(15), patch: { notes: 'Rollout plan (section 7) depends on the IdP group to permission set answer for Soo-jin.' } }] }, summary: 'Note added', output: { proposalId: 'prop-smpl-0004', status: 'applied' },
            proposal: { entity: { type: 'work_item', id: wiId(15), label: wiTitle(15) }, reason: 'You asked to record the dependency', status: 'applied', summary: 'Add a note to the sections 6 and 7 item?', changes: [{ field: 'notes', label: 'Notes', before: null, after: 'Rollout plan (section 7) depends on the IdP group to permission set answer for Soo-jin.' }], changesRaw: [{ op: 'edit_fields', itemId: wiId(15), patch: { notes: 'Rollout plan (section 7) depends on the IdP group to permission set answer for Soo-jin.' } }] } }],
        },
      ],
    },
    // ── T6: plan the day (11-17) ───────────────────────────────────────────────────────────────────
    {
      key: 'plan-1117', title: 'Plan the day (Tue Nov 17)', scope: 'day', sdk: 'thread-smpl-daily',
      turns: [
        {
          key: 'llm-chat-10', llm: 643, userAt: '', assistantAt: '',
          user: 'Plan my day. And rescan Slack for the last 12 hours, I think I am missing DMs from last night.',
          assistant: `Your Top 3 for this morning: ${top17.map((t, i) => `(${i + 1}) "${wiTitle(t.n)}" (${clean(t.why)})`).join('; ')}. The next meeting is at 11:00 and you have 518 focus minutes today. I queued a Slack rescan for the last 12 hours (the card shows progress); if the connector is rate-limited it will wait for its window.`,
          tools: [
            { name: 'chat_app_read', input: { route: 'home' }, summary: 'Home: Top 3, 518 focus minutes', output: { top3: top17.map((t) => ({ id: wiId(t.n), title: wiTitle(t.n), score: t.total })), availableFocusMinutes: 518 } },
            { name: 'chat_rescan', mutation: true, cs: 460, input: { connector: 'slack', windowHours: 12 }, summary: 'Slack rescan queued (12 h)', output: { queued: true, connector: 'slack', windowHours: 12 } },
          ],
        },
        {
          key: 'llm-chat-11', llm: 644, userAt: '', assistantAt: '',
          user: 'Constance\'s one-pager went out yesterday through Lars. Mark that one done.',
          assistant: 'Marked "Send Constance Okeke a non-technical one-page view of the data foundation phases" as done. The email to Lars with the one-page phases view was sent on Monday, so I recorded that as your reason. It drops off Today; Undo is on the receipt.',
          tools: [{ name: 'chat_propose_changes', mutation: true, cs: 461, input: { summary: 'Mark the Constance one-pager done?', changes: [{ op: 'done', itemId: wiId(75), note: 'Sent via Lars on Monday' }] }, summary: 'Marked done', output: { proposalId: 'prop-smpl-0005', status: 'applied' },
            proposal: { entity: { type: 'work_item', id: wiId(75), label: wiTitle(75) }, reason: 'You said it went out yesterday through Lars', status: 'applied', summary: 'Mark the Constance one-pager done?', changes: [{ field: 'status', label: 'Status', before: 'open', after: 'done' }], changesRaw: [{ op: 'done', itemId: wiId(75), note: 'Sent via Lars on Monday' }] } }],
        },
      ],
    },
    // ── T7: what is due this week (11-18) ──────────────────────────────────────────────────────────
    {
      key: 'due-week', title: 'What is due this week', scope: 'global', sdk: 'thread-smpl-due',
      turns: [
        {
          key: 'llm-chat-12', llm: 676, userAt: '', assistantAt: '',
          user: 'What is due this week? And anything new on Voltmere before Nadia\'s sync?',
          assistant: `Due through Saturday, the ones that matter most:\n\n${grouped(week)}\n\nThe Saturday one is the mandatory training; a hold is on Thursday 16:00. Next Monday and Tuesday are the Cascadia onsite, so the agenda and prep block on Friday afternoon matter. On Voltmere: your weekly brief from 07:30 says Outage Insights moved its close date from Jan 15 to Feb 1; one new message since then (the date in #voltmere-account) lands in the next brief.`,
          tools: [
            { name: 'chat_app_read', input: { route: 'work', query: { tab: 'open', due: 'this_week' }, limit: 25 }, summary: `${openDue} open items due through Saturday`, output: { page: { list: 'items', total: openDue, count: week.length }, rows: week.map(dueRow) } },
            { name: 'chat_brief_refresh', mutation: true, cs: 487, input: { subscription: 'Voltmere Utilities (watched account)' }, summary: 'Brief unchanged; 1 new item since 07:30', output: { briefGeneratedAt: '2026-11-18T14:31:20.000Z', refreshed: false, newSinceGeneration: 1, marked: 'seen' } },
          ],
        },
        {
          key: 'llm-chat-13', llm: 677, userAt: '',
          assistantAt: '',
          user: 'Why is the Oakhallow addendum above the blueprint today?',
          assistant: `Because it is due today, with a call at 14:30, and it is customer-facing: "${wiTitle(top18[0]!.n)}" scores ${top18[0]!.total.toFixed(1)} (${clean(top18[0]!.why)}). The blueprint is third at ${top18[2]!.total.toFixed(1)}; it is due Friday, so its customer-deliverable floor keeps it in Now but it does not need you before the call. Policy v3 and the Now floor for customer deliverables due within 72 hours explain the rest.`,
          tools: [{ name: 'chat_app_read', input: { route: 'item_trace', params: { id: wiId(top18[0]!.n) } }, summary: 'Rank reasons', output: { rank: 1, total: top18[0]!.total, lane: 'top3' } }],
        },
        {
          key: 'llm-chat-14', llm: 693, userAt: '', assistantAt: '',
          ctx: [wctx(30, 'explicit')],
          user: 'Draft a short reply to Hana: yes, Gustavo can run the 11/24 Saltmere sync while I am onsite.',
          assistant: 'Drafted. It is a Slack reply to Hana in your DM thread with a short confirmation and an offer to brief Gustavo on Friday; open it in the Outbox to edit or approve. Nothing was sent.',
          tools: [{ name: 'chat_draft', input: { channel: 'slack', to: '@Hana Lindqvist', body: 'Yes, Gustavo can run the 11/24 sync. I will brief him on Friday so the Yarrowdale and Saltmere threads are covered while I am onsite.', workItemId: wiId(30) }, summary: 'Draft created in the Outbox', refDraft: 'wi030-reply-hana', output: { channel: 'slack', status: 'ready', to: '@Hana Lindqvist' } }],
        },
      ],
    },
  ].map((t) => rd(t as ThreadSpec));
}
