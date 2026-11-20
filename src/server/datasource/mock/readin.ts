/**
 * Mock read-ins (CC_DATA=mock): deterministic, never calls out.
 *
 * Demo set: for each Slack destination shape (thread, channel, DM), the best-ranked item whose next best action is a
 * Slack message (send / nudge). With the private real seed that picks the three asks the mockups show; with the
 * example seed it picks the placeholder ones. No item ids or names are hard-coded here, so no real data lands in the
 * repo: every word of a mock read-in comes from the loaded seed (its evidence, initiative, related items, drafts).
 *
 * Content goes through the same context builder and output mapper as the real engine, so the UI sees real shapes.
 * An item with evidence newer than its read-in is stale; "Read me in" / Regenerate plays queued → researching
 * (six steps) → ready on the mock clock's delays.
 */
import type { Draft, Evidence, ReadIn, ReadInEntity, ReadInPayload, ReadInState, ReadInTrigger, WorkItemRecord } from '@/contract';
import { buildReadInContext, contextUrls, type ReadInRecords } from '@/llm/readin/context';
import { destinationLabel, previewOf, toReadIn } from '@/llm/readin/map';
import { deriveReadIn, emptyReadIn, PLAN_STEPS, type ReadInJobSnap, type StoredReadIn } from '@/llm/readin/state';
import type { ReadInContext, ReadInOutput } from '@/llm/readin/types';
import { hasSlackMarkup, renderSourceBody } from '@/lib/compose';
import { notFound } from '@/server/errors';

import { slackLabels } from '../draft-source';

import type { MemoryEventBus } from './bus';
import { plainText } from './render';
import type { Store } from './store';

export interface MockReadInHost {
  readonly store: Store;
  readonly bus: MemoryEventBus;
  readonly delays: { stepMs: number };
  now(): Date;
}

const STEPS: Array<{ step: NonNullable<ReadIn['progress']>['step']; label: string }> = [
  { step: 'ledger', label: 'Checking what you said before' },
  { step: 'slack', label: 'Reading the Slack thread' },
  { step: 'gmail', label: 'Searching email' },
  { step: 'drive', label: 'Looking for related docs' },
  { step: 'org62', label: 'Checking the opportunity in Org62' },
  { step: 'writing', label: 'Writing the read-in' },
];

const LIVE = new Set(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done']);
const MODEL = 'claude-sonnet-5-5';
const SKILL = 'readin-ask@1';
const key = (e: ReadInEntity) => `${e.type}:${e.id}`;
const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const first = (name: string) => name.split(/\s+/)[0] ?? name;

export function mockRecords(store: Store, now: Date): ReadInRecords {
  const meta = store.meta();
  const evidenceBy = new Map<string, Evidence[]>();
  for (const e of store.all('evidence')) evidenceBy.set(e.workItemId, [...(evidenceBy.get(e.workItemId) ?? []), e]);
  return {
    me: { id: meta.user.id, name: meta.user.name, ...(meta.user.email ? { email: meta.user.email } : {}) },
    timezone: store.settings().profile.timezone,
    now,
    workItem: (id) => store.get('workItems', id),
    workItems: () => store.all('workItems'),
    evidence: (id) => [...(evidenceBy.get(id) ?? [])],
    initiative: (id) => store.get('initiatives', id),
    account: (id) => store.get('accounts', id),
    opp: (id) => store.get('opps', id),
    event: (id) => store.get('events', id),
    person: (id) => store.get('people', id),
    drafts: (id) => store.all('drafts').filter((d) => d.workItemId === id),
    generation: () => 0,
    voice: null,
  };
}

/** The demo items: one per Slack destination shape, best rank first. */
export function demoItems(store: Store): WorkItemRecord[] {
  const byTarget = new Map<string, WorkItemRecord>();
  const rank = (w: WorkItemRecord) => w.rank ?? 1000;
  for (const n of store.all('nbas')) {
    if (n.verb !== 'send' && n.verb !== 'nudge') continue;
    const w = store.get('workItems', n.workItemId);
    const d = n.draftId ? store.get('drafts', n.draftId) : undefined;
    if (!w || !d || d.destination.kind !== 'slack' || !LIVE.has(w.state)) continue;
    const cur = byTarget.get(d.destination.target);
    if (!cur || rank(w) < rank(cur)) byTarget.set(d.destination.target, w);
  }
  return [...byTarget.values()].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

/**
 * A deterministic "research result" built only from what the context pack holds. `mentions` (Slack id → name) turns a
 * quoted Slack message into prose: "@Raj Mehta said…", no `<@U…>` or `*bold*` markers, as a written read-in reads.
 */
export function synthesizeOutput(ctx: ReadInContext, mentions: Record<string, string> = {}): ReadInOutput {
  const ev = ctx.evidence;
  const others = ev.filter((e) => !e.fromMe);
  const origin = ev.find((e) => e.role === 'origin') ?? ev[0];
  const who = ctx.item?.counterparty?.name ?? origin?.author ?? 'They';
  const prose = (t: string) => (hasSlackMarkup(t) ? renderSourceBody(t, 'slack_mrkdwn', { labels: mentions }).text.replace(/\s+/g, ' ').trim() : t);
  // Evidence summaries often start with the speaker ("You: …", "Dana: …"); a read-in states it once.
  const said = (t: string) => prose(t).replace(/^(you|[A-Z][\w.'-]*(?: [A-Z][\w.'-]*)?):\s*/, '').replace(/^"|"$/g, '');
  const tldr = origin
    ? origin.fromMe
      ? cap(`You asked ${first(who)}: ${said(origin.text)} Still open.`, 240)
      : cap(`${first(who)} is asking: ${said(origin.text)}`, 240)
    : cap(ctx.item?.title ?? ctx.event?.title ?? 'Read-in', 240);
  const background: ReadInOutput['background'] = [];
  for (const e of others.filter((x) => x !== origin).slice(-3)) background.push({ text: cap(said(e.text), 180), source: e.source.kind, label: e.source.label, ...(e.source.url ? { permalink: e.source.url } : {}) });
  if (ctx.initiative?.summary) background.push({ text: cap(ctx.initiative.summary, 180), source: 'ledger', label: `Initiative · ${ctx.initiative.title}` });
  for (const s of ctx.siblings.filter((w) => LIVE.has(w.state)).slice(0, 2)) background.push({ text: cap(`Same initiative: ${s.title}${s.due ? ` (due ${s.due.slice(5, 10)})` : ''}`, 300), workItemId: s.id });
  if (ctx.opp) background.push({ text: cap(`Opportunity ${ctx.opp.name}${ctx.opp.stage ? ` is at ${ctx.opp.stage}` : ''}${ctx.opp.closeDate ? `, closing ${ctx.opp.closeDate}` : ''}.`, 300), source: 'org62', label: `Opp · ${ctx.opp.name}` });
  const history: ReadInOutput['history'] = ctx.saidBefore.slice(0, 4).map((s) => ({
    text: cap(said(s.text), 200),
    at: s.at,
    commitment: s.commitment,
    source: s.workItemId ? 'ledger' : s.source.kind,
    label: s.source.label,
    ...(s.source.url ? { permalink: s.source.url } : {}),
    ...(s.workItemId ? { workItemId: s.workItemId } : {}),
  }));
  const openQuestions: ReadInOutput['openQuestions'] = [];
  for (const c of ev.filter((e) => e.role === 'contradiction').slice(0, 2)) openQuestions.push({ text: cap(`Does this change the ask? ${prose(c.text)}`, 240), to: 'you' });
  if (ctx.item && !ctx.item.due) openQuestions.push({ text: 'When do they need it by?', to: ctx.item.counterparty?.name ?? 'you' });
  if (ctx.item?.state === 'waiting_on_others') openQuestions.push({ text: `Still waiting on ${who}; nudge or decide without it?`, to: 'you' });
  return { tldr, background: background.slice(0, 6), history, openQuestions: openQuestions.slice(0, 3), suggestedReply: null, confidence: others.length >= 2 ? 'likely' : 'guess' };
}

interface Rec {
  stored: StoredReadIn | null;
  job: ReadInJobSnap | null;
}

export class MockReadIns {
  private recs = new Map<string, Rec>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 1;
  private storeRef: Store | null = null;

  constructor(
    private readonly host: MockReadInHost,
    private readonly opts: { demo: boolean } = { demo: false },
  ) {}

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Re-seed after a store reset (scenario reset / seek). Demo read-ins only when `demo` is on. */
  reset(): void {
    this.dispose();
    this.recs.clear();
    this.storeRef = this.host.store;
    const now = this.host.now();
    for (const w of this.opts.demo ? demoItems(this.host.store) : []) {
      const entity: ReadInEntity = { type: 'work_item', id: w.id };
      const ev = this.host.store.all('evidence').filter((e) => e.workItemId === w.id);
      const latest = ev.reduce((a, e) => (e.at > a ? e.at : a), w.createdAt);
      const contradiction = ev.filter((e) => e.role === 'contradiction').sort((a, b) => a.at.localeCompare(b.at))[0];
      // Ready a few minutes after the newest evidence; an item with a contradiction after its ask is stale (demo).
      const genAt = contradiction ? new Date(Date.parse(contradiction.at) - 60_000) : new Date(Math.min(now.getTime() - 60_000, Date.parse(latest) + 4 * 60_000));
      const readIn = this.compose(entity, 'direct_ask', genAt);
      if (readIn) this.recs.set(key(entity), { stored: { v: 1, outcome: 'ready', readIn, jobId: this.seq++ }, job: null });
    }
    this.syncStates();
  }

  private ensure(): void {
    if (this.storeRef !== this.host.store) this.reset();
  }

  private compose(entity: ReadInEntity, trigger: ReadInTrigger, at: Date): ReadIn | null {
    const store = this.host.store;
    const ctx = buildReadInContext(mockRecords(store, at), entity, { trigger });
    if (!ctx) return null;
    const out = synthesizeOutput(ctx, slackLabels(store.all('people')));
    const draft = this.replyDraft(entity);
    const suggestedReply = draft ? { draftId: draft.id, channel: draft.destination.kind, destinationLabel: destinationLabel(draft.destination), preview: previewOf(plainText(draft.doc) || draft.plainText) } : null;
    const costUsd = Math.round((0.06 + 0.012 * out.background.length + 0.008 * out.history.length) * 10000) / 10000;
    return toReadIn(out, ctx, { trigger, generatedAt: at.toISOString(), costUsd, model: MODEL, skillVersion: SKILL, seenUrls: new Set(contextUrls(ctx)), suggestedReply });
  }

  /** The item's Outbox draft (the NBA's message draft); the mock never creates or sends one. */
  private replyDraft(entity: ReadInEntity): Draft | null {
    if (entity.type !== 'work_item') return null;
    const store = this.host.store;
    const w = store.get('workItems', entity.id);
    const nba = w?.nbaId ? store.get('nbas', w.nbaId) : undefined;
    const d = nba?.draftId ? store.get('drafts', nba.draftId) : undefined;
    if (d && d.status !== 'sent' && d.status !== 'discarded') return d;
    return store.all('drafts').find((x) => x.workItemId === entity.id && (x.status === 'ready' || x.status === 'drafting')) ?? null;
  }

  private freshness(entity: ReadInEntity) {
    if (entity.type !== 'work_item') return { generation: 0, lastNewInfoAt: null };
    const ev = this.host.store.all('evidence').filter((e) => e.workItemId === entity.id);
    const last = ev.reduce<string | null>((a, e) => (!a || e.at > a ? e.at : a), null);
    return { generation: 0, lastNewInfoAt: last, newSince: 0 };
  }

  private exists(entity: ReadInEntity): boolean {
    return entity.type === 'work_item' ? !!this.host.store.get('workItems', entity.id) : !!this.host.store.get('events', entity.id);
  }

  private derive(entity: ReadInEntity): ReadIn | null {
    const r = this.recs.get(key(entity));
    if (!r) return null;
    const f = this.freshness(entity);
    const stored = r.stored;
    const newSince = stored?.readIn.generatedAt && f.lastNewInfoAt ? this.host.store.all('evidence').filter((e) => e.workItemId === entity.id && e.at > stored.readIn.generatedAt!).length : 0;
    return deriveReadIn(entity, stored, r.job, { ...f, newSince }, this.host.store.settings().profile.timezone);
  }

  get(entity: ReadInEntity): ReadInPayload {
    this.ensure();
    if (!this.exists(entity)) throw notFound(entity.type === 'work_item' ? 'Work item' : 'Event', entity.id);
    return { entity, readIn: this.derive(entity) };
  }

  stateOf(itemId: string): ReadInState | undefined {
    return this.derive({ type: 'work_item', id: itemId })?.state;
  }

  /** Writes readInState onto the item records (no audit: it is derived), so every view carries it. */
  syncStates(ids?: string[]): void {
    const store = this.host.store;
    for (const w of ids ? ids.map((id) => store.get('workItems', id)).filter((x): x is WorkItemRecord => !!x) : store.all('workItems')) {
      const s = this.stateOf(w.id);
      if (s !== w.readInState) {
        const next = { ...w };
        if (s) next.readInState = s;
        else delete next.readInState;
        store._set('workItems', next);
      }
    }
  }

  private publish(entity: ReadInEntity, reason: string) {
    const topics = entity.type === 'work_item' ? (['readin', 'item', 'items', 'today'] as const) : (['readin', 'calendar'] as const);
    if (entity.type === 'work_item') this.syncStates([entity.id]);
    for (const topic of topics) this.host.bus.publish({ topic, ids: [entity.id], reason, ...(entity.type === 'work_item' ? { entityType: 'work_item' as const } : {}) });
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      try {
        fn();
      } catch (err) {
        console.error('[mock] read-in step failed:', (err as Error).message);
      }
    }, Math.max(0, ms));
    (t as { unref?: () => void }).unref?.();
    this.timers.add(t);
  }

  /** "Read me in" / Regenerate: queued → researching (six steps) → ready. Deduped per entity. */
  request(entity: ReadInEntity, force: boolean): { entity: ReadIn; auditId: null } {
    this.ensure();
    if (!this.exists(entity)) throw notFound(entity.type === 'work_item' ? 'Work item' : 'Event', entity.id);
    const k = key(entity);
    const cur = this.recs.get(k) ?? { stored: null, job: null };
    const shown = this.derive(entity);
    if (cur.job && (cur.job.status === 'queued' || cur.job.status === 'running')) return { entity: shown!, auditId: null };
    if (!force && shown?.state === 'ready') return { entity: shown, auditId: null };
    const at = this.host.now().toISOString();
    const job: ReadInJobSnap = { id: this.seq++, status: 'queued', generation: 0, trigger: 'on_demand', progress: null, cancelRequested: false, skipped: null, lastErrorCode: null, updatedAt: at };
    this.recs.set(k, { stored: cur.stored, job });
    this.publish(entity, 'readin.queued');
    const step = Math.max(20, Math.round(this.host.delays.stepMs / 2));
    STEPS.forEach((s, i) => {
      this.later(step * (i + 1), () => {
        const r = this.recs.get(k);
        if (!r?.job || r.job.id !== job.id) return;
        r.job = { ...r.job, status: 'running', progress: { step: s.step, label: s.label, done: i, total: PLAN_STEPS }, updatedAt: this.host.now().toISOString() };
        this.publish(entity, 'readin.progress');
      });
    });
    this.later(step * (STEPS.length + 1), () => {
      const r = this.recs.get(k);
      if (!r?.job || r.job.id !== job.id) return;
      const readIn = this.compose(entity, 'on_demand', this.host.now());
      r.stored = readIn ? { v: 1, outcome: 'ready', readIn, jobId: job.id } : r.stored;
      r.job = { ...r.job, status: 'succeeded', progress: null, updatedAt: this.host.now().toISOString() };
      this.publish(entity, 'readin.ready');
    });
    return { entity: this.derive(entity) ?? emptyReadIn(entity, at), auditId: null };
  }
}
