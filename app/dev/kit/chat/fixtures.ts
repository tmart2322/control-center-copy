/**
 * Placeholder fixtures for the chat kit gallery (ACME / Globex / Dana, as in UI-SPEC). Not seed data.
 */
import type { ChatThread, Proposal, Receipt, SearchHit } from '@/contract';
import type { ChatMessageView, ChatToolView } from '@/client/chat';

const day = '2026-11-05';
const at = (hm: string) => new Date(`${day}T${hm}:00-07:00`).toISOString();

export const KIT_TZ = 'America/Denver';

export const threads: ChatThread[] = [
  { id: 'th_today', title: 'Today', isDefault: true, createdAt: at('07:00'), updatedAt: at('09:14'), messageCount: 6, lastMessagePreview: 'Moved Globex prep after lunch.' },
  { id: 'th_hooli', title: 'Hooli NCE scoping', isDefault: false, createdAt: at('06:50'), updatedAt: at('07:00'), messageCount: 2, lastMessagePreview: 'Started a research session.' },
  { id: 'th_q4', title: 'Q4 forecast notes', isDefault: false, createdAt: at('06:30'), updatedAt: at('06:40'), messageCount: 2, lastMessagePreview: null },
];

const base = (p: Partial<ChatMessageView> & Pick<ChatMessageView, 'id' | 'role' | 'text'>): ChatMessageView => ({
  threadId: 'th_today',
  at: at('09:10'),
  context: [],
  isMorningBrief: false,
  tools: [],
  receipts: [],
  proposals: [],
  resources: [],
  streaming: false,
  error: null,
  stopped: false,
  pending: false,
  ...p,
});

const tool = (id: string, name: string, startSummary: string, summary: string, ok: boolean | null): ChatToolView => ({ id, name, startSummary, summary, ok });

export const receiptMove: Receipt = {
  id: 'rcpt_move',
  at: at('09:12'),
  actor: 'chat',
  summary: 'Rescheduled “Send Marcus the revised SOW pricing” after lunch and noted the deck',
  staged: false,
  changes: [
    { auditId: 'aud_start', entity: { type: 'work_item', id: 'w_sow', label: 'Send Marcus the revised SOW pricing', href: '/work/w_sow' }, field: 'startBy', label: 'Start by', before: at('09:30'), after: at('12:30') },
    { auditId: 'aud_note', entity: { type: 'work_item', id: 'w_sow', label: 'Send Marcus the revised SOW pricing', href: '/work/w_sow' }, field: 'notes', before: '', after: 'For the after-lunch block: Globex D360 consumption estimate' },
  ],
};

export const receiptRerank: Receipt = {
  id: 'rcpt_rerank',
  at: at('09:20'),
  actor: 'chat',
  summary: 'Reply to Dana: confirm today’s demo scope → #1 (asked in chat)',
  staged: false,
  changes: [
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_dana', label: 'Reply to Dana: confirm today’s demo scope' }, field: 'signals', before: { customerFacing: true, fromManager: false, boost: 0 }, after: { customerFacing: true, fromManager: false, boost: 6 } },
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_dana', label: 'Reply to Dana: confirm today’s demo scope' }, field: 'rank', before: 4, after: 1 },
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_build', label: 'Kick off the ACME Phase 2 demo-org build' }, field: 'rank', before: 1, after: 2 },
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_sow2', label: 'Send Marcus the revised SOW pricing' }, field: 'rank', before: 2, after: 3 },
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_onepager', label: 'Email ACME the architecture one-pager' }, field: 'rank', before: 3, after: 4 },
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_vdp', label: 'Update the VDP for the Globex expansion' }, field: 'rank', before: 5, after: 6 },
    { auditId: 'aud_rr', entity: { type: 'work_item', id: 'w_train', label: 'Complete the Agentforce Specialist refresher' }, field: 'rank', before: 6, after: 7 },
  ],
};

export const proposalPolicy: Proposal = {
  id: 'prop_policy',
  entity: { type: 'policy', id: 'pol_1', label: 'Priority policy' },
  changes: [
    { field: 'weights.customer_facing', label: 'customer facing', before: 3, after: 6 },
    { field: 'weights.manager_ask', label: 'manager ask', before: 2, after: 1 },
  ],
  reason: 'Customer-facing over internal work (from chat)',
  source: null,
  createdAt: at('09:16'),
  status: 'pending',
  actor: 'chat',
  baseVersion: 3,
  textDiff: null,
  resolvedAt: null,
};

export const proposalBulk: Proposal = {
  ...proposalPolicy,
  id: 'prop_bulk',
  entity: { type: 'work_item', id: 'w_many', label: 'Replan: 7 tasks' },
  reason: 'Replan around the moved ACME demo',
  changes: [
    { field: 'startBy', label: 'Kick off the ACME build', before: at('09:05'), after: at('10:05') },
    { field: 'startBy', label: 'Reply to Dana', before: at('10:00'), after: at('09:05') },
    { field: 'due', label: 'Email ACME the one-pager', before: at('17:00'), after: at('15:00') },
    { field: 'startBy', label: 'Final ACME run-through', before: at('12:30'), after: at('13:30') },
    { field: 'rank', label: 'Send Marcus the SOW pricing', before: 3, after: 2 },
    { field: 'rank', label: 'Update the VDP for Globex', before: 5, after: 8 },
    { field: 'rank', label: 'Security training', before: 9, after: 6 },
  ],
};

/** A card of many route calls (DC claims on opps the app doesn't track yet): long labels, one line per claim. */
export const proposalDcClaims: Proposal = {
  ...proposalPolicy,
  id: 'prop_dc',
  actor: 'chat',
  entity: { type: 'chat_thread', id: 'th_dc', label: '6 changes from chat' },
  reason: 'Claim DCs Shad approved',
  changes: [
    ['Acme Health - (+1 Data Services) Data Cloud Expansion FY27', 'added from Org62'],
    ['Globex - Contract Rewrite', 'added from Org62'],
    ['Initech - Data Cloud', 'added from Org62'],
    ['Umbrella Corp · Agentforce Care', null],
    ['Stark Industries - Unified Profiles Phase 2', 'added from Org62'],
    ['Wayne Enterprises - D360 Renewal', 'added from Org62'],
  ].map(([name, tag]) => ({
    field: 'createDcRequest',
    label: tag ? `DC claim · ${name!.length > 30 ? `${name!.slice(0, 29)}…` : name} · ${tag}` : `DC claim · ${name}`,
    before: null,
    after: '100% · AI + Data Architect · “SE support”',
  })),
};

/** A list of 220 claims is ONE card (2026-11-13: no 40-call cap): the first lines, then 50 more at a time, scrolling. */
const PLACEHOLDER_ACCOUNTS = ['Acme Health', 'Globex', 'Initech', 'Umbrella Corp', 'Stark Industries', 'Wayne Enterprises', 'Hooli', 'Soylent', 'Vandelay', 'Cyberdyne', 'Tyrell', 'Wonka'];
const claimName = (i: number) => `${PLACEHOLDER_ACCOUNTS[i % PLACEHOLDER_ACCOUNTS.length]} ${Math.floor(i / PLACEHOLDER_ACCOUNTS.length) + 1} - Data Cloud Expansion FY27`;
export const proposalDcClaims220: Proposal = {
  ...proposalPolicy,
  id: 'prop_dc220',
  actor: 'chat',
  entity: { type: 'chat_thread', id: 'th_dc', label: '220 changes from chat' },
  reason: 'Claim DCs on these 220 opportunities?',
  changes: Array.from({ length: 220 }, (_, i) => ({ field: 'createDcRequest', label: `DC claim · ${claimName(i)}${i % 3 ? '' : ' · added from Org62'}`, before: null, after: '100% · AI + Data Architect · “SE support”' })),
};

/** Apply landed what worked: 54 of 55, one failed with its reason (Undo all reverts the 54). */
export const receiptPartial: Receipt = {
  id: 'rcpt_partial',
  at: at('09:30'),
  actor: 'chat',
  summary: 'Applied 54 of 55 · 1 failed: Org62 has no Opportunity "006XX0000NOPE99AAA" that you can see. Claim DCs on these 55 opportunities?',
  staged: false,
  total: 55,
  failed: [{ label: 'DC claim · Tyrell 5 - Data Cloud Expansion FY27', reason: 'Org62 has no Opportunity "006XX0000NOPE99AAA" that you can see: check the id (the 006… in the opp\'s Org62 link)', route: 'createDcRequest' }],
  changes: Array.from({ length: 54 }, (_, i) => ({ auditId: `aud_dc_${i}`, entity: { type: 'opportunity', id: `opp_${i}`, label: claimName(i) }, field: 'createDcRequest', label: 'DC claim', before: null, after: '100% · next logging canvas' })),
};

export const toolsDone: ChatToolView[] = [
  tool('t1', 'items.find', 'Finding "Globex prep" in your plan', 'Send Marcus the revised SOW pricing', true),
  tool('t2', 'calendar.today', 'Checking when lunch ends', 'Lunch & learn: Nimbus Context Engine ends 12:30', true),
  tool('t3', 'items.reschedule', 'Start by 09:30 → 12:30', 'Rescheduled', true),
  tool('t4', 'drive.search', 'Searching Drive for Globex decks you made', '2 Globex files; best: Globex D360 consumption estimate', true),
  tool('t5', 'items.note', 'Noting "Globex D360 consumption estimate" on the item', 'Linked as a note', true),
];

export const toolsLive: ChatToolView[] = [
  tool('l1', 'slack.scan', 'Re-reading Slack since Tue 09:14 (2d)', 'Scan started; it shows in the Health ledger', true),
  tool('l2', 'linker.match', 'Matching Slack messages to your open items', '', null),
];

export const toolsFailed: ChatToolView[] = [tool('f1', 'slack.search', 'Searching Slack', 'Slack MCP needs re-auth', false)];

const brief = base({
  id: 'm_brief',
  role: 'assistant',
  at: at('07:00'),
  isMorningBrief: true,
  text: '**Good morning.** Seven meetings today; the big one is the **ACME Phase 2 demo at 13:00**.\n\n1. **Kick off the ACME demo-org build** first: it needs ~1h40m of agent time.\n2. **Reply to Dana** about demo scope (5 min, before 11:00).\n3. **Send Marcus the revised SOW pricing**: you missed the 08:30 pricing sync.\n\nOvernight I closed 2 items for you, and VDP needs re-auth.',
  resources: [
    { kind: 'brief', id: 'b1', label: '#team-updates brief', href: '/briefs?brief=b1' },
    { kind: 'brief', id: 'b2', label: 'Globex opp brief', href: '/briefs?brief=b2' },
  ],
});

export const userMove = base({
  id: 'm_u1',
  role: 'user',
  at: at('09:11'),
  text: 'move Globex prep after lunch and find the deck I made for them',
  context: [{ type: 'work_item', id: 'w_sow', label: 'Send Marcus the revised SOW pricing', via: 'auto' }],
});

export const assistantMove = base({
  id: 'm_a1',
  role: 'assistant',
  at: at('09:12'),
  text: "Done: **Send Marcus the revised SOW pricing** now starts at **12:30**, after Lunch & learn, instead of 09:30.\n\nThere's no Globex deck in Drive. The closest thing you made for them is **Globex D360 consumption estimate** (sheet).\n\nBoth changes are on the receipt, and you can undo either one on its own.",
  tools: toolsDone,
  receipts: [receiptMove],
  resources: [
    { kind: 'asset', id: 'as_est', label: 'Globex D360 consumption estimate', href: 'https://docs.google.com/spreadsheets/d/example-globex-estimate' },
    { kind: 'work_item', id: 'w_sow', label: 'Send Marcus the revised SOW pricing', href: '/work/w_sow' },
  ],
});

export const userPolicy = base({ id: 'm_u2', role: 'user', at: at('09:15'), text: 'prioritize customer-facing over internal today' });

export const assistantPolicy = base({
  id: 'm_a2',
  role: 'assistant',
  at: at('09:16'),
  text: "Here's the re-rank preview. **4 of your Top 10** would move:\n\n- ↑ **Reply to Dana: confirm today’s demo scope**: #4 → #2\n- ↑ **Share the D360 estimate with Globex**: #7 → #5\n- ↓ **Send Priya the Q4 forecast notes**: #5 → #8\n\nNothing changes until you **Apply**. It becomes policy v4.",
  tools: [tool('p1', 'policy.read', 'Reading your priority policy', 'v3: customer-facing 3, manager ask 2', true), tool('p2', 'policy.preview', 'Previewing customer-facing +3, manager ask −1', '4 items move', true)],
  proposals: [{ proposal: proposalPolicy, summary: 'Customer-facing work ranks above internal work: 4 of your Top 10 move' }],
});

export const userError = base({ id: 'm_u3', role: 'user', at: at('09:18'), text: 'what did Dana say in #acme-ext?' });
export const assistantError = base({
  id: 'm_a3',
  role: 'assistant',
  at: at('09:18'),
  tools: toolsFailed,
  error: { code: 'upstream_unavailable', message: 'Slack is disconnected. Re-auth from Health, then ask again.', retryable: true },
  text: '',
});

export const userRescan = base({ id: 'm_u4', role: 'user', at: at('09:20'), text: '/rescan slack 2d' });
export const assistantStreaming = base({
  id: 'm_a4',
  role: 'assistant',
  at: at('09:20'),
  streaming: true,
  status: 'streaming',
  tools: toolsLive,
  text: 'Re-read **Slack** for the last 2d. Two threads touch open items, and I',
});

export const userWhy = base({ id: 'm_u5', role: 'user', at: at('09:22'), text: 'why is the ACME build first?' });
export const assistantWhy = base({
  id: 'm_a5',
  role: 'assistant',
  at: at('09:22'),
  text: '**Kick off the ACME Phase 2 demo-org build** is **#1** in NOW (score 9.4). Under your priority policy (v3), this is what puts it there:\n\n- **ACME Phase 2 demo in 4h** (+2.5): the meeting it serves starts at 13:00\n- **Long lead time** (+2): it needs about 1h40m of agent time\n- **Customer-facing** (+3)\n\n**Start by 09:05** leaves enough time before the demo.',
  tools: [tool('w1', 'priority.explain', 'Reading the rank reasons', '#1 · score 9.4 · 3 reasons', true), tool('w2', 'policy.read', 'Reading your priority policy', 'Default v3', true), tool('w3', 'calendar.today', 'Checking the meeting it serves', 'ACME Phase 2 demo at 13:00', true)],
  resources: [
    { kind: 'policy', id: 'pol_1', label: 'Default policy v3', href: '/settings?section=policy' },
    { kind: 'calendar_event', id: 'ev_demo', label: 'ACME Phase 2 demo · 13:00', href: '/' },
  ],
});

export const userPromise = base({ id: 'm_u6', role: 'user', at: at('09:24'), text: 'what did I promise Ravi?' });
export const assistantPromise = base({
  id: 'm_a6',
  role: 'assistant',
  at: at('09:24'),
  text: "You promised Ravi Menon to **Package the Beacon app**, 70 days ago. It's a background promise, so it stays out of your Top 10 until it's due or someone asks about it.",
  tools: [tool('s1', 'work.search', 'Searching promises and commitments for Ravi', '1 open promise · oldest 70d', true)],
  resources: [{ kind: 'work_item', id: 'w_beacon', label: 'Package the Beacon app for Ravi', href: '/work/w_beacon' }],
});

/** The 560 px fixture dock: a settled conversation ending in a pending proposal. */
export const dockConversation: ChatMessageView[] = [brief, userMove, assistantMove, userPolicy, assistantPolicy];

export const mentionHits: SearchHit[] = [
  { ref: { type: 'account', id: 'acc_globex', label: 'Globex' }, title: 'Globex', subtitle: 'Manufacturing', kind: null, state: null, score: 2 },
  { ref: { type: 'opportunity', id: 'opp_globex', label: 'Globex D360 expansion' }, title: 'Globex D360 expansion', subtitle: 'Negotiation', kind: null, state: null, score: 1.5 },
  { ref: { type: 'person', id: 'p_marcus', label: 'Marcus Webb' }, title: 'Marcus Webb', subtitle: 'Globex · VP Platform', kind: null, state: null, score: 1 },
  { ref: { type: 'asset', id: 'as_sow', label: 'Globex SOW v3 (pricing)' }, title: 'Globex SOW v3 (pricing)', subtitle: 'doc', kind: null, state: null, score: 1 },
  { ref: { type: 'asset', id: 'as_est', label: 'Globex D360 consumption estimate' }, title: 'Globex D360 consumption estimate', subtitle: 'sheet', kind: null, state: null, score: 1 },
];
