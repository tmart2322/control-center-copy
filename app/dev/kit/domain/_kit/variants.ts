/**
 * Kit variants: pick real items by state from the mock payloads, and synthesize the few states the seed
 * doesn't hold at t=0 (touched-draft proposal, waiting Claude session, receipts, a 409 conflict).
 * Synthesized objects are parsed through the contract's zod schemas, so they stay real-shaped.
 */
import { AgentRun, NbaCard, Proposal, Receipt, type WorkItemDetail } from '@/contract';
import type { KitData } from './load';

export type CardProps = {
  item: WorkItemDetail['item'];
  nba: WorkItemDetail['nba'];
  draft: WorkItemDetail['draft'];
  run: WorkItemDetail['runs'][number] | null;
  proposals: WorkItemDetail['proposals'];
};

export function asCard(d: WorkItemDetail | undefined | null): CardProps | null {
  if (!d) return null;
  const run = d.runs.find((r) => r.state === 'waiting_on_you') ?? d.runs.find((r) => r.state === 'running') ?? d.runs[0] ?? null;
  return { item: d.item, nba: d.nba, draft: d.draft, run, proposals: d.proposals };
}

const addMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

export function buildVariants(data: KitData) {
  const find = (pred: (d: WorkItemDetail) => boolean) => data.details.find(pred) ?? null;
  const [c1, c2, c3] = data.today.nowStack.cards;
  const now = data.now;

  const picks = {
    likely: asCard(find((d) => d.item.state === 'likely_done')),
    waitingApp: asCard(find((d) => d.item.state === 'waiting_on_me' && d.runs.some((r) => r.state === 'waiting_on_you' && r.kind !== 'claude_session'))),
    reopened: asCard(find((d) => d.item.state === 'reopened' && !d.item.loopedBackIn)),
    looped: asCard(find((d) => !!d.item.loopedBackIn)),
    stale: asCard(find((d) => !!d.item.stale)),
    suggested: asCard(find((d) => d.item.state === 'suggested')),
    guess: asCard(find((d) => d.nba?.confidence === 'guess' && (d.nba?.alternatives.length ?? 0) > 0)),
    runTool: asCard(find((d) => d.nba?.verb === 'run_tool')),
    log: asCard(find((d) => d.nba?.verb === 'log')),
    deliverable: asCard(find((d) => !!d.item.deliverable && d.nba?.verb === 'review')),
    fieldProposal: asCard(find((d) => d.proposals.some((p) => p.status === 'pending' && p.entity.type === 'work_item'))),
    emailNew: asCard(find((d) => d.draft?.destination.kind === 'email' && d.draft.destination.target === 'new')),
  };

  // Touched draft + new info → proposal (update.kind = 'proposal').
  let touched: CardProps | null = null;
  if (c3?.draft && c3.nba) {
    const before = c3.draft.plainText;
    const added = 'The 18% discount is approved through Q4 if we sign by Nov 20.';
    const after = before.replace('Elena will confirm the discount approval today.', added);
    const proposal = Proposal.parse({
      id: 'prop_kit_draft',
      entity: { type: 'draft', id: c3.draft.id, label: `Draft · ${c3.nba.title}` },
      changes: [{ field: 'doc', label: 'Draft body', before, after }],
      reason: 'Elena confirmed the 18% discount in #globex-deal',
      source: { kind: 'slack', label: '#globex-deal · Elena Cruz' },
      createdAt: addMin(now, -4),
      status: 'pending',
      actor: 'engine',
      baseVersion: c3.draft.version,
      textDiff: [
        { op: 'equal', text: '…matches the volumes from your team’s estimate. ' },
        { op: 'delete', text: 'Elena will confirm the discount approval today.' },
        { op: 'insert', text: added },
      ],
    });
    const nba = NbaCard.parse({ ...c3.nba, update: { at: proposal.createdAt, reason: proposal.reason, kind: 'proposal', proposalId: proposal.id, diffSummary: null, source: proposal.source } });
    touched = { item: c3.item, nba, draft: { ...c3.draft, userTouched: true }, run: null, proposals: [proposal] };
  }

  // The ACME build session pauses on a question → waiting_on_me with Open in Claude.
  let claudeWaiting: CardProps | null = null;
  if (c1?.run) {
    const run = AgentRun.parse({
      ...c1.run,
      state: 'waiting_on_you',
      lastEvent: 'Paused: needs an org alias',
      waiting: { reason: 'input needed', question: 'Deploy to acme-demo or acme-demo-2?', choices: [], since: addMin(now, -6) },
    });
    claudeWaiting = {
      item: { ...c1.item, state: 'waiting_on_me', waiting: { on: 'me', reason: 'Session asked: which org alias?', since: run.waiting!.since, runId: run.id } },
      nba: c1.nba,
      draft: null,
      run,
      proposals: [],
    };
  }

  // A chat re-prioritize receipt (real ids/labels from Today).
  const top = data.today.nowStack.cards.map((c) => c.item);
  const more = data.today.moreToday.items;
  const receipt = Receipt.parse({
    id: 'rcpt_kit',
    at: addMin(now, -2),
    actor: 'chat',
    summary: `Moved “${more[0]?.title ?? 'Send Priya the Q4 forecast notes'}” to #1 and pushed the rest down`,
    changes: [
      { auditId: 'aud_kit_1', entity: { type: 'work_item', id: more[0]?.id ?? 'w1', label: more[0]?.title ?? 'Item' }, field: 'rank', label: 'Rank', before: more[0]?.rank ?? 4, after: 1 },
      { auditId: 'aud_kit_2', entity: { type: 'work_item', id: top[0]?.id ?? 'w2', label: top[0]?.title ?? 'Item' }, field: 'rank', label: 'Rank', before: 1, after: 2 },
      { auditId: 'aud_kit_3', entity: { type: 'work_item', id: more[0]?.id ?? 'w1', label: more[0]?.title ?? 'Item' }, field: 'due', label: 'Due', before: more[0]?.due ?? now, after: addMin(more[0]?.due ?? now, -15) },
    ],
  });
  const acct = top[2]?.refs.account?.label ?? top[0]?.refs.account?.label ?? '';
  const staged = Receipt.parse({
    id: 'rcpt_kit_staged',
    at: addMin(now, -1),
    actor: 'chat',
    summary: `Snooze every ${acct} item until Monday`,
    staged: true,
    changes: data.details
      .filter((d) => d.item.refs.account?.label === acct && d.item.state !== 'done' && d.item.state !== 'dismissed')
      .slice(0, 6)
      .map((d, i) => ({ auditId: `aud_kit_s${i}`, entity: { type: 'work_item', id: d.item.id, label: d.item.title }, field: 'state', label: 'State', before: d.item.state, after: 'snoozed' })),
  });

  // 409 rebase: a work item's due changed elsewhere while you edited it.
  const conflictItem = c2?.item ?? top[0];
  const conflict = conflictItem
    ? Proposal.parse({
        id: 'prop_kit_conflict',
        entity: { type: 'work_item', id: conflictItem.id, label: conflictItem.title },
        changes: [{ field: 'due', label: 'Due', before: conflictItem.due ?? now, after: addMin(conflictItem.due ?? now, 60) }],
        reason: 'Changed by chat while you were editing',
        createdAt: addMin(now, -1),
        status: 'pending',
        actor: 'chat',
        baseVersion: conflictItem.version,
      })
    : null;

  return {
    now1: c1 ? { item: c1.item, nba: c1.nba, draft: c1.draft, run: c1.run, proposals: c1.proposals } : null,
    now2: c2 ? { item: c2.item, nba: c2.nba, draft: c2.draft, run: c2.run, proposals: c2.proposals } : null,
    now3: c3 ? { item: c3.item, nba: c3.nba, draft: c3.draft, run: c3.run, proposals: c3.proposals } : null,
    ...picks,
    touched,
    claudeWaiting,
    receipt,
    staged,
    conflict,
  };
}
