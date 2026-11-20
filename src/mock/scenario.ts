/**
 * Scenario clock (UI-SPEC §15): replays timed engine/connector events against the mock store so the
 * cockpit feels alive. Driven by GET/POST /api/v1/dev/scenario (play · pause · reset · seek) and
 * auto-plays when CC_SCENARIO=1.
 *
 * The seed may carry its own `scenario`; otherwise `buildDefaultScenario` derives the seven UI-SPEC
 * events from whatever the store holds (so the private real-data seed needs no scenario block).
 */
import type { ScenarioAction, ScenarioEvent, ScenarioStatus } from '@/contract';
import { storedOrder } from '@/server/datasource/mock/rank';
import type { Store } from '@/server/datasource/mock/store';

export interface ScenarioHost {
  /** Mutate the store as an engine/connector would and publish live events. */
  applyScenarioAction(action: ScenarioAction, stepId: string): void;
  /** Restore the store to the seed snapshot and reset the clock to seed time + offsetSec. */
  resetForScenario(offsetSec: number): void;
  /** Announce a scenario status change (topic `scenario`). */
  scenarioChanged(status: ScenarioStatus): void;
}

const TICK_MS = 250;

export class ScenarioPlayer {
  private state: ScenarioStatus['state'] = 'idle';
  private t = 0;
  private fired = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;

  constructor(
    private readonly host: ScenarioHost,
    private events: ScenarioEvent[],
    private readonly source: 'seed' | 'default',
    private readonly autoplay: boolean,
  ) {
    this.events = [...events].sort((a, b) => a.at - b.at);
  }

  status(): ScenarioStatus {
    return {
      state: this.state,
      t: Math.round(this.t * 10) / 10,
      durationSec: this.events.length ? this.events[this.events.length - 1].at : 0,
      autoplay: this.autoplay,
      source: this.source,
      events: this.events.map((e) => ({ id: e.id, at: e.at, label: e.label, exercises: e.exercises, fired: this.fired.has(e.id) })),
      fired: [...this.fired],
    };
  }

  play(): ScenarioStatus {
    if (this.state === 'finished') this.reset();
    if (this.state !== 'playing') {
      this.state = 'playing';
      this.lastTickMs = Date.now();
      this.timer = setInterval(() => this.tick(), TICK_MS);
      (this.timer as { unref?: () => void }).unref?.();
    }
    return this.changed();
  }

  pause(): ScenarioStatus {
    this.stopTimer();
    if (this.state === 'playing') this.state = 'paused';
    return this.changed();
  }

  reset(): ScenarioStatus {
    this.stopTimer();
    this.t = 0;
    this.fired.clear();
    this.state = 'idle';
    this.host.resetForScenario(0);
    return this.changed();
  }

  /** Reset, then fire every event with at ≤ seconds instantly, and pause there (deterministic screenshots). */
  seek(seconds: number): ScenarioStatus {
    this.stopTimer();
    this.fired.clear();
    this.host.resetForScenario(seconds);
    this.t = seconds;
    for (const e of this.events) if (e.at <= seconds) this.fire(e);
    this.state = this.fired.size === this.events.length && this.events.length > 0 ? 'finished' : 'paused';
    return this.changed();
  }

  dispose(): void {
    this.stopTimer();
  }

  private tick() {
    const nowMs = Date.now();
    this.t += (nowMs - this.lastTickMs) / 1000;
    this.lastTickMs = nowMs;
    for (const e of this.events) if (e.at <= this.t && !this.fired.has(e.id)) this.fire(e);
    if (this.fired.size === this.events.length) {
      this.stopTimer();
      this.state = 'finished';
      this.changed();
    }
  }

  private fire(e: ScenarioEvent) {
    this.fired.add(e.id);
    for (const a of e.actions) {
      try {
        this.host.applyScenarioAction(a, e.id);
      } catch (err) {
        console.error(`[scenario] ${e.id} action ${a.op} failed:`, (err as Error).message);
      }
    }
    this.changed();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private changed(): ScenarioStatus {
    const s = this.status();
    this.host.scenarioChanged(s);
    return s;
  }
}

/**
 * Live pass (docs/UX.md "Live updates"): what "real things coming in" looks like while you sit on a page. Copies of
 * seeded records (placeholders) arrive early in the clock, so Home, the Outbox, Triage, Activity ▸ Needs you and
 * Agents each show an arrival within the first minute; then a draft is sent elsewhere and a logging canvas is applied
 * in Slack, so an open panel says "Sent or applied elsewhere" and Log it's run moves on, without a toast.
 */
export function liveArrivals(store: Store): ScenarioEvent[] {
  const out: ScenarioEvent[] = [];
  const later = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString();
  const isMessage = (d: { destination: { kind: string } }) => d.destination.kind !== 'action';
  const ready = store.all('drafts').filter((d) => d.status === 'ready' && isMessage(d) && d.workItemId);
  const draft = ready[0];
  const item = draft?.workItemId ? store.get('workItems', draft.workItemId) : undefined;
  if (draft && item) {
    out.push({
      id: 'live-draft-arrives',
      at: 10,
      label: 'A new reply draft comes in',
      exercises: 'Outbox: the new draft lands above, the selected one stays selected (Home: Reply & approve)',
      actions: [
        { op: 'arrive', collection: 'workItems', fromId: item.id, newId: 'w_live_arrival', patch: { title: 'Reply: send the integration checklist (placeholder)', state: 'open', nbaId: null }, reason: 'A new ask came in on Slack' },
        { op: 'arrive', collection: 'drafts', fromId: draft.id, newId: 'd_live_arrival', patch: { workItemId: 'w_live_arrival', nbaId: null }, reason: 'The app drafted a reply' },
      ],
    });
  }
  const suggested = store.all('workItems').find((i) => i.state === 'suggested');
  if (suggested) {
    out.push({
      id: 'live-suggestion-arrives',
      at: 22,
      label: 'A new suggestion lands in Triage',
      exercises: 'Triage: marked in the AI color at its place, nothing else moves',
      actions: [{ op: 'arrive', collection: 'workItems', fromId: suggested.id, newId: 'w_live_suggestion', patch: { title: 'Asked of you: share the sandbox login steps (placeholder)' }, reason: 'An ask was detected' }],
    });
  }
  const needs = store.all('activity').find((e) => (e.status === 'needs_input' || e.status === 'proposed') && !e.oppId);
  if (needs) {
    out.push({
      id: 'live-needs-row-arrives',
      at: 30,
      label: 'A new Activity row needs you',
      exercises: 'Activity ▸ Needs you: the row arrives with its suggestion, marked; rows being edited never move',
      // an hour after the row it copies, so it never reads as a duplicate of it
      actions: [{ op: 'arrive', collection: 'activity', fromId: needs.id, newId: 'act_live_arrival', patch: { description: 'Follow-up call (placeholder)', start: later(needs.start), end: later(needs.end) }, reason: 'A meeting ended with no opportunity' }],
    });
  }
  const run = store.all('agentRuns').find((r) => r.state === 'done' || r.state === 'done_review') ?? store.all('agentRuns')[0];
  if (run) {
    out.push({
      id: 'live-run-starts',
      at: 36,
      label: 'An agent run starts',
      exercises: 'Agents: the run appears live; a run you are hovering never moves',
      actions: [{ op: 'arrive', collection: 'agentRuns', fromId: run.id, newId: 'run_live_arrival', patch: { title: 'Build the demo data set (placeholder)', state: 'running', finishedAt: null, waiting: null, lastEvent: 'Started' }, reason: 'A run started' }],
    });
    out.push({
      id: 'live-run-progresses',
      at: 52,
      label: 'The new run finishes and waits for review',
      exercises: 'Agents: its state changes in place',
      actions: [{ op: 'run_state', runId: 'run_live_arrival', state: 'done_review', lastEvent: 'Finished: ready for review' }],
    });
  }
  const other = ready.find((d) => d.id !== draft?.id);
  if (other) {
    out.push({
      id: 'live-draft-sent-elsewhere',
      at: 46,
      label: 'A draft is sent from another tab',
      exercises: 'Outbox: it fades out of Approve; open in the panel, the panel says "Sent or applied elsewhere" (no toast)',
      actions: [{ op: 'elsewhere', collection: 'drafts', id: other.id, patch: { status: 'sent', sentAt: '__now__' }, reason: 'Sent elsewhere' }],
    });
  }
  const canvas = store.all('drafts').find((d) => d.destination.kind === 'action' && d.destination.action === 'slack_canvas.create' && d.status === 'ready');
  if (canvas) {
    out.push({
      id: 'live-canvas-applied',
      at: 58,
      label: 'A logging canvas is applied in Slack',
      exercises: 'Activity ▸ Log it: the run moves to its next step live',
      actions: [{ op: 'elsewhere', collection: 'drafts', id: canvas.id, patch: { status: 'sent', sentAt: '__now__' }, reason: 'Applied in Slack' }],
    });
  }
  return out;
}

/** The scenario to play: the seed's (or the default seven) plus the live-pass arrivals it does not already have. */
export function withLiveArrivals(events: ScenarioEvent[], store: Store): ScenarioEvent[] {
  const have = new Set(events.map((e) => e.id));
  return [...events, ...liveArrivals(store).filter((e) => !have.has(e.id))];
}

/** Derive the seven UI-SPEC §15 events from the current store (used when the seed has no scenario). */
export function buildDefaultScenario(store: Store): ScenarioEvent[] {
  const out: ScenarioEvent[] = [];
  const ordered = storedOrder(store);
  const withDraft = ordered.filter((i) => {
    const nba = i.nbaId ? store.get('nbas', i.nbaId) : undefined;
    return !!nba?.draftId;
  });
  const card2 = ordered[1] && withDraft.includes(ordered[1]) ? ordered[1] : withDraft[1] ?? withDraft[0];
  if (card2?.nbaId) {
    out.push({
      id: 'slack-reply-updates-draft',
      at: 20,
      label: 'A Slack reply updates NBA #2’s draft',
      exercises: 'Update strip',
      actions: [{ op: 'nba_update', nbaId: card2.nbaId, reason: 'New reply in thread: "please include pricing"', appendText: 'I will include the pricing summary as well.', source: { kind: 'slack', label: 'Slack · thread reply' } }],
    });
  }
  const sessions = store.all('agentRuns').filter((r) => r.kind === 'claude_session' && (r.state === 'running' || r.state === 'queued'));
  const card1 = ordered[0];
  const session = sessions.find((s) => s.workItemId === card1?.id) ?? sessions[0];
  if (session) {
    out.push({
      id: 'session-goes-waiting',
      at: 40,
      label: 'The Claude session for card #1 goes waiting',
      exercises: 'Rail lane + promotion',
      actions: [{ op: 'run_state', runId: session.id, state: 'waiting_on_you', lastEvent: 'Asked a question', waiting: { reason: 'input needed', question: 'Which org alias should I deploy to?', choices: [] } }],
    });
  }
  const live = store.all('workItems').filter((i) => ['open', 'in_progress', 'waiting_on_others'].includes(i.state));
  const commitment = live.find((i) => i.kind === 'commitment' && i.sources.some((s) => s.kind === 'gmail' || s.kind === 'slack') && !i.isBackground) ?? live.find((i) => i.kind === 'commitment');
  if (commitment) {
    out.push({
      id: 'email-closes-commitment',
      at: 60,
      label: 'An email you sent auto-closes a commitment',
      exercises: 'Closed for you',
      actions: [{ op: 'close_item', itemId: commitment.id, reason: 'You sent the email this commitment promised', evidence: { kind: 'gmail', label: 'Gmail · sent' } }],
    });
  }
  const deliverable = live.find((i) => i.kind === 'deliverable' && i.state === 'open') ?? live.find((i) => i.kind === 'deliverable');
  if (deliverable) {
    out.push({
      id: 'deck-edit-moves-deliverable',
      at: 80,
      label: 'A deck edit moves a deliverable to in progress',
      exercises: 'Drive signal',
      actions: [{ op: 'engine_patch', itemId: deliverable.id, patch: {}, state: 'in_progress', reason: 'You edited the deck', evidence: { kind: 'drive', label: 'Drive · deck edited by you' } }],
    });
  }
  const gmail = store.get('connectors', 'gmail') ?? store.all('connectors').find((c) => c.source === 'gmail');
  if (gmail) {
    out.push({
      id: 'gmail-breaks',
      at: 100,
      label: 'The Gmail connector breaks',
      exercises: 'Banner, stale marks, health dot',
      actions: [{ op: 'connector_state', connectorId: gmail.id, state: 'auth_needed', error: 'invalid_grant: token expired', impact: 'Email items after now may be missing' }],
    });
  }
  const done = store.all('workItems').find((i) => i.state === 'done' && i.doneBy !== 'engine') ?? store.all('workItems').find((i) => i.state === 'done');
  if (done) {
    out.push({
      id: 'requirements-reopen-task',
      at: 120,
      label: 'New requirements reopen a done task',
      exercises: 'Reopened',
      actions: [{ op: 'reopen', itemId: done.id, reason: 'New requirement: add the data-flow slide', source: { kind: 'slack', label: 'Slack · new requirement' } }],
    });
  }
  const mover = ordered[5] ?? ordered[ordered.length - 1];
  if (mover) {
    out.push({
      id: 'rerank-available',
      at: 140,
      label: 'A re-rank becomes available',
      exercises: 'Pill',
      actions: [{ op: 'rerank_ready', itemId: mover.id, boost: 12, reason: 'Customer moved the meeting earlier' }],
    });
  }
  const handedOff = store.all('workItems').find((i) => i.state === 'done' && i.resolution === 'handed_off');
  if (handedOff) {
    out.push({
      id: 'looped-back-in',
      at: 160,
      label: 'A handed-off item gets a direct ask',
      exercises: 'Looped back in (R-UI-22)',
      actions: [{ op: 'loop_back', itemId: handedOff.id, byPersonName: handedOff.counterparty?.name ?? 'A customer', reason: 'Direct ask of you on a handed-off item', source: { kind: 'slack', label: 'Slack · direct mention' } }],
    });
  }
  return out;
}
