/**
 * Mock onboarding (B-079): reachable at /onboarding for development, never required. The draft lives in memory;
 * finishing updates the mock's profile, persona (D-55) and policy through its own Settings writers and records the
 * first-scan request. Nothing scans for real: the first scan's progress is simulated on the wall clock (Health's
 * `firstScan`, so the banner and the "Filling in" states show as they would on a real install), at the measured pace
 * of that lookback. `restart: true` on a step starts over after finishing.
 */
import { firstScanMinutes, type Connector, type FirstScanProgress, type OnboardingCompleteResult, type OnboardingSourcesPayload, type OnboardingState, type PriorityPolicy, type RouteInput, type RouteOutput, type SaveOnboardingStepRequest, type Settings } from '@/contract';
import { personaOf } from '@/personas';
import type { ConnectorId } from '@/scanner/types';
import { applyDetections, applyStep, bootstrapInput, buildState, finalChoices, freshStored, personaPatch, prefillPersona, prefillYou, rolePacks, same } from '@/server/onboarding/core';
import { onboardingCost } from '@/server/onboarding/cost';
import { MemoryDraftStore, type StoredOnboarding } from '@/server/onboarding/drafts';
import { recordOnlyFirstScan, startFirstScan, type FirstScanStarter } from '@/server/onboarding/first-scan';
import { simulatedDetector } from '@/server/onboarding/identity';
import { simulatedSources } from '@/server/onboarding/sources';

export interface MockOnboardingHost {
  now(): Date;
  settings(): Settings;
  connectors(): Connector[];
  patchSettings(i: RouteInput<'patchSettings'>): Promise<RouteOutput<'patchSettings'>>;
  applyPolicy(i: RouteInput<'applyPolicy'>): Promise<RouteOutput<'applyPolicy'>>;
}

const DB = 'mock';
const MIN = 60_000;

/**
 * The simulated first scan's scopes, with the share of the whole run each takes to finish (Slack is the long pole on
 * a real install; Calendar and Drive are done in minutes). Only the persona's active sources take part.
 */
const SIM_SCOPES: Array<{ scope: string; connector: ConnectorId; share: number }> = [
  { scope: 'slack:inbox', connector: 'slack', share: 1 },
  { scope: 'org62:opps', connector: 'org62', share: 0.55 },
  { scope: 'org62:events', connector: 'org62', share: 0.4 },
  { scope: 'gmail:inbox', connector: 'gmail', share: 0.3 },
  { scope: 'gemini_notes:notes', connector: 'gemini_notes', share: 0.25 },
  { scope: 'drive:tracked', connector: 'drive', share: 0.12 },
  { scope: 'calendar:primary', connector: 'calendar', share: 0.08 },
];

/** Pure: the simulated progress `elapsedMs` into a first scan of `lookbackDays` over these sources. */
export function simulatedFirstScan(p: { lookbackDays: number; budgetUsd: number; startedAt: string; elapsedMs: number; connectors: readonly ConnectorId[]; spendUsd?: number }): FirstScanProgress {
  const total = firstScanMinutes(p.lookbackDays) * MIN;
  const start = Date.parse(p.startedAt);
  const floorAt = new Date(start - p.lookbackDays * 86_400_000).toISOString();
  const scopes = SIM_SCOPES.filter((s) => p.connectors.includes(s.connector)).map((s) => {
    const pct = Math.min(100, Math.round((Math.max(0, p.elapsedMs) / (total * s.share)) * 1000) / 10);
    return { scope: s.scope, connector: s.connector, status: pct >= 100 ? ('done' as const) : ('pending' as const), floorAt, coveredPct: p.elapsedMs > 0 ? pct : null, replans: 0, joinedAt: null, spentUsd: 0 };
  });
  const done = scopes.every((s) => s.status === 'done');
  const longest = Math.max(0, ...SIM_SCOPES.filter((s) => p.connectors.includes(s.connector)).map((s) => s.share));
  const frac = Math.min(1, Math.max(0, p.elapsedMs) / total);
  return {
    status: done ? 'done' : 'active',
    lookbackDays: p.lookbackDays,
    startedAt: new Date(start).toISOString(),
    floorAt,
    budgetUsd: p.budgetUsd,
    spentUsd: Math.round((p.spendUsd ?? 0) * frac * 100) / 100,
    doneAt: done ? new Date(start + total * longest).toISOString() : null,
    scopes,
  };
}

export class MockOnboarding {
  private readonly drafts = new MemoryDraftStore();
  /** Wall-clock start of the simulated first scan (the mock's own clock may be pinned to the seed's time). */
  private simStart: number | null = null;
  constructor(
    private readonly host: MockOnboardingHost,
    private readonly starter: FirstScanStarter = recordOnlyFirstScan,
    private readonly wall: () => number = Date.now,
  ) {}

  private prefill() {
    const p = this.host.settings().profile;
    return prefillYou({ setupProfile: { name: p.name, email: p.email, role: p.role, timezone: p.timezone, workingHours: p.workingHours } });
  }

  /** The mock's own persona is what "this machine already knows" (the db reads profile.json instead). */
  private prefillPersona() {
    const s = this.host.settings();
    return prefillPersona({ persona: s.persona.id, role: s.profile.role });
  }

  state(): OnboardingState {
    const stored = this.drafts.load();
    const done = !!stored?.completedAt;
    return buildState({
      mode: 'mock',
      required: false,
      status: done ? 'complete' : stored ? 'in_progress' : 'not_started',
      reason: 'mock',
      stored,
      prefill: this.prefill(),
      prefillPersona: this.prefillPersona(),
      packs: rolePacks(this.host.now()),
      cost: onboardingCost(this.host.settings().budgets.hardUsd),
      completedAt: stored?.completedAt ?? null,
      firstScan: stored?.firstScan ?? null,
      detection: 'simulated',
    });
  }

  async save(req: SaveOnboardingStepRequest): Promise<OnboardingState> {
    const now = this.host.now();
    let cur: StoredOnboarding | null = this.drafts.load();
    if (cur?.completedAt) {
      if (!req.restart) return this.state();
      cur = null;
      this.simStart = null;
    }
    const base = cur ?? freshStored(DB, this.prefill(), now, this.prefillPersona());
    if (req.step === 'sources' && req.value.detect?.length) {
      // placeholders for a connected source, no calls (the seed's connectors decide what is connected)
      const connected = new Map(this.sources().sources.map((x) => [x.id, x.state === 'ok']));
      const detector = simulatedDetector(); // wall-clock time: the page says "just now" against the browser's clock
      const results = await Promise.all(
        [...new Set(req.value.detect)].map(async (kind) =>
          connected.get(kind)
            ? { kind, ...(await detector.detect(kind, { email: base.draft.you.email ?? '', name: base.draft.you.name ?? null })) }
            : { kind, detection: { status: 'not_connected' as const, id: null, name: null, message: `${kind === 'slack' ? 'Slack' : 'Org62'} is not connected in the sample data.`, at: now.toISOString(), costUsd: 0, simulated: true }, spend: null },
        ),
      );
      this.drafts.save(applyDetections(base, results, now));
      return this.state();
    }
    this.drafts.save(applyStep(base, req, { now, packs: rolePacks(now) }));
    return this.state();
  }

  sources(): OnboardingSourcesPayload {
    return simulatedSources(this.host.connectors(), this.host.now());
  }

  /** Health's `firstScan` in mock mode: the simulated run after you finished here; null before. */
  firstScanProgress(): FirstScanProgress | null {
    const fs = this.drafts.load()?.firstScan;
    if (!fs || this.simStart === null) return null;
    const connectors = personaOf(this.host.settings()).connectors;
    const est = onboardingCost(null).options.find((o) => o.days === fs.lookbackDays);
    return simulatedFirstScan({ lookbackDays: fs.lookbackDays, budgetUsd: fs.budgetUsd, startedAt: new Date(this.simStart).toISOString(), elapsedMs: this.wall() - this.simStart, connectors, spendUsd: est ? (est.lowUsd + est.highUsd) / 2 : 0 });
  }

  async complete(): Promise<OnboardingCompleteResult> {
    const now = this.host.now();
    const packs = rolePacks(now);
    const cur = this.drafts.load() ?? freshStored(DB, this.prefill(), now, this.prefillPersona());
    if (cur.completedAt && cur.firstScan) {
      return { state: this.state(), bootstrap: 'mock', wrote: [], policyVersion: this.host.settings().policy.version, firstScan: cur.firstScan, redirect: '/' };
    }
    const { role, you, priorities, history } = finalChoices(cur.draft, packs);
    const wrote: string[] = [];
    const s = this.host.settings();
    const p = bootstrapInput(you, role);
    const profile = { name: p.name, email: p.email, role: you.role, timezone: you.timezone, workingHours: you.workingHours };
    const changed = Object.fromEntries(Object.entries(profile).filter(([k, v]) => !same(v, (s.profile as Record<string, unknown>)[k])));
    if (Object.keys(changed).length) {
      await this.host.patchSettings({ params: { section: 'profile' }, body: { ifVersion: s.profile.version, value: changed } });
      wrote.push('settings.profile');
    }
    const pp = personaPatch(this.host.settings().persona, role);
    if (Object.keys(pp).length) {
      await this.host.patchSettings({ params: { section: 'persona' }, body: { ifVersion: this.host.settings().persona.version, value: pp } });
      wrote.push('settings.persona');
    }
    const pol: PriorityPolicy = this.host.settings().policy;
    if (!same(pol.weights, priorities.weights) || !same(pol.rules, priorities.rules)) {
      await this.host.applyPolicy({ body: { weights: priorities.weights, rules: priorities.rules, note: 'Set during onboarding', ifVersion: pol.version } });
      wrote.push('policy');
    }
    const firstScan = await startFirstScan({ lookbackDays: history.lookbackDays, budgetUsd: history.budgetUsd, at: now }, this.starter);
    this.drafts.save({ ...cur, step: 'review', reached: 'review', completedAt: now.toISOString(), firstScan, updatedAt: now.toISOString() });
    this.simStart = this.wall();
    return { state: this.state(), bootstrap: 'mock', wrote, policyVersion: this.host.settings().policy.version, firstScan, redirect: '/' };
  }
}
