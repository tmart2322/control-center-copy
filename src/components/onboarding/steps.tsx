'use client';
/**
 * The six onboarding steps (B-079) and the explanation pane beside each. Controlled: the page owns the values and
 * saves them. Rows, inputs and the policy weights and rules are the Settings pieces (src/components/settings/**).
 * The role step (D-55) picks the persona and level; the copy of the later steps follows it.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IdentityKind, OnboardingHistory, OnboardingPersonaDraft, OnboardingPriorities, OnboardingRolePack, OnboardingSource, OnboardingSourceId, OnboardingSourcesPayload, OnboardingState, OnboardingStep, OnboardingYouDraft, PersonaId, PersonaLevel, PolicyWeightKey } from '@/contract';
import { BACKFILL_BUDGET_RANGE, durationText as durationLabel } from '@/contract';
import { api, queryKey } from '@/client/api';
import { toast } from '@/client/toast/store';
import { DaysPicker, NumberInput, Select, Switch, TextInput } from '@/components/settings/controls';
import { COMMON_TIMEZONES, hoursPerDay, WEIGHT_KEYS, WEIGHT_META } from '@/components/settings/derive';
import { Block, css as s, Row } from '@/components/settings/form';
import { PolicyRulesTable, PolicyWeightRows } from '@/components/settings/PolicySection';
import { PERSONAS, selectablePersonas } from '@/personas';
import { Button, cn, fmtAgo, SegmentedToggle, Skeleton, Spinner, StatePill, useWallClock, type Tone } from '@/ui';
import { activatedLabels, daysText, editedCount, groupSources, org62IdHint, readsFor, readSources, resolvedPersona, roleLabel, sourcesLine, STEP_META, usd, usdRange, type PersonaChoice } from './derive';
import o from './onboarding.module.css';

type Errors = Record<string, string>;

export function StepHead({ step, actions, headingRef }: { step: OnboardingStep; actions?: ReactNode; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <header className={o.head}>
      <h1 ref={headingRef} tabIndex={-1} data-testid="onboarding-step-title">
        {STEP_META[step].title}
      </h1>
      {actions ? <div className={o.headActs}>{actions}</div> : <span />}
      <p>{STEP_META[step].blurb}</p>
    </header>
  );
}

// ── 1. Role ─────────────────────────────────────────────────────────────────────────────────

/** Persona cards (a radio group) and, when the persona has more than one, its levels. */
export function RoleStep({ value, onChange, errors }: { value: PersonaChoice; onChange: (v: { id: PersonaId; level: PersonaLevel }) => void; errors: Errors }) {
  const personas = selectablePersonas();
  const def = value.id ? PERSONAS[value.id] : null;
  const levels = def ? (Object.entries(def.levels) as Array<[PersonaLevel, { label: string }]>) : [];
  const pick = (id: PersonaId) => {
    const lv = Object.keys(PERSONAS[id].levels) as PersonaLevel[];
    onChange({ id, level: id === value.id ? value.level : (lv[0] ?? 'ic') });
  };
  return (
    <>
      <div className={o.personas} role="radiogroup" aria-label="Your role" aria-invalid={!!errors.id} data-testid="persona-options">
        {personas.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === value.id} className={o.opt} data-testid={`persona-${p.id}`} onClick={() => pick(p.id)}>
            <span className={o.optDays}>
              {p.label}
              {p.status === 'preview' ? <span className={o.preview}>Preview</span> : null}
            </span>
            <span className={o.optSub}>{p.summary}</span>
          </button>
        ))}
      </div>
      {errors.id ? (
        <p className={o.errLine} role="alert">
          {errors.id}
        </p>
      ) : null}
      {def && levels.length > 1 ? (
        <Block>
          <Row label="Level" labelId="ob-l-level" help="It picks your starter priorities: a manager’s put their leader’s asks first." error={errors.level}>
            <SegmentedToggle size="md" label="Level" value={value.level} onChange={(level) => onChange({ id: def.id, level })} options={levels.map(([k, v]) => ({ value: k, label: v.label }))} />
          </Row>
        </Block>
      ) : errors.level ? (
        <p className={o.errLine} role="alert">
          {errors.level}
        </p>
      ) : null}
    </>
  );
}

export function RoleAside({ value }: { value: PersonaChoice }) {
  const p = resolvedPersona(value);
  if (!p)
    return (
      <>
        <h2>Why it matters</h2>
        <p>Your role decides what counts as yours: which sources are read, how your list is ranked to start with, and which duties the app keeps an eye on.</p>
        <h3>Nothing is taken away</h3>
        <p>A role only preconfigures. Anything outside it stays available, and you can turn it on here (Sources) or later in Settings ▸ Role &amp; rules.</p>
      </>
    );
  const on = p.duties.filter((d) => d.active);
  const off = p.duties.filter((d) => !d.active);
  return (
    <>
      <h2>{roleLabel(value)}</h2>
      {p.status === 'preview' ? <p>In preview: the forecast workflow is new. Report what’s missing with Feedback in the top bar.</p> : null}
      <h3>Preconfigured for you</h3>
      <ul data-testid="role-duties">
        {on.map((d) => (
          <li key={d.id}>{d.text}</li>
        ))}
      </ul>
      {off.length ? (
        <>
          <h3>Available, not preconfigured</h3>
          <ul>
            {off.map((d) => (
              <li key={d.id}>{d.text}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-3 text-caption">Change any of it later in Settings ▸ Role &amp; rules.</p>
    </>
  );
}

// ── 2. You ──────────────────────────────────────────────────────────────────────────────────

export function YouStep({ value, onChange, errors, locked }: { value: OnboardingYouDraft; onChange: (v: OnboardingYouDraft) => void; errors: Errors; locked: Array<'email'> }) {
  const set = <K extends keyof OnboardingYouDraft>(k: K, v: OnboardingYouDraft[K]) => onChange({ ...value, [k]: v });
  const wh = value.workingHours ?? { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
  const tz = value.timezone ?? 'America/Denver';
  const zones = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES];
  const hoursErr = errors['workingHours.start'] ?? errors['workingHours.end'] ?? errors['workingHours.days'] ?? errors.workingHours ?? null;
  const perDay = hoursPerDay(wh.start, wh.end);
  return (
    <Block>
      <Row label="Name" htmlFor="ob-name" error={errors.name}>
        <TextInput id="ob-name" autoComplete="name" aria-invalid={!!errors.name} value={value.name ?? ''} onChange={(e) => set('name', e.target.value)} />
      </Row>
      <Row label="Work email" htmlFor="ob-email" help={locked.includes('email') ? 'This database already has your user; the email stays.' : 'The Google account the Gmail, Calendar and Drive scans read.'} error={errors.email}>
        <TextInput id="ob-email" type="email" autoComplete="email" aria-invalid={!!errors.email} readOnly={locked.includes('email')} value={value.email ?? ''} onChange={(e) => set('email', e.target.value)} />
      </Row>
      <Row label="Time zone" htmlFor="ob-tz" help="Every time in the app shows in this zone." error={errors.timezone}>
        <Select id="ob-tz" className={s.wMd} value={tz} onChange={(e) => set('timezone', e.target.value)}>
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </Select>
      </Row>
      <Row label="Working hours" labelId="ob-l-hours" top help="Your day plan and free time use these. 24-hour times." error={hoursErr}>
        <div className={`${s.ctrl} ${s.stack}`}>
          <div className={s.ctrl}>
            <TextInput width="xs" className={s.alignR} aria-label="Start" aria-invalid={!!hoursErr} value={wh.start} onChange={(e) => set('workingHours', { ...wh, start: e.target.value })} />
            <span className={s.unit}>to</span>
            <TextInput width="xs" className={s.alignR} aria-label="End" aria-invalid={!!hoursErr} value={wh.end} onChange={(e) => set('workingHours', { ...wh, end: e.target.value })} />
            {perDay ? <span className={s.unit}>· {perDay}</span> : null}
          </div>
          <DaysPicker days={wh.days} onChange={(days) => set('workingHours', { ...wh, days })} />
        </div>
      </Row>
    </Block>
  );
}

export function YouAside() {
  return (
    <>
      <h2>Why these</h2>
      <p>
        The scanners look for <b>your</b> messages, meetings and deals. Your work email is how the Google scans and Org62 find you; your Slack and Org62 ids come next, on the Sources step, read from each source once it is signed in.
      </p>
      <h3>Working hours</h3>
      <p>Today plans your day inside these hours, and free time is counted from them. Agent work runs in the background and never counts against them.</p>
      <h3>Stays on this Mac</h3>
      <p>Everything you enter is saved in your local database. Nothing is sent anywhere, and you can change any of it later in Settings ▸ Profile &amp; role.</p>
    </>
  );
}

// ── 3. Priorities ───────────────────────────────────────────────────────────────────────────

/** One plain sentence per weight, for someone who has never seen the ranking. */
export const WEIGHT_SENTENCE: Record<PolicyWeightKey, string> = {
  customer_facing: 'Work that touches a customer ranks above internal work.',
  meeting_proximity: 'Prep for a meeting that is coming up soon moves up.',
  due_urgency: 'Things due soon, or already overdue, move up.',
  manager_ask: 'Asks from your manager move up.',
  deal_value: 'Work on bigger opportunities ranks higher.',
  lead_time: 'Long agent jobs with a meeting ahead start first, so they finish in time.',
  age: 'Old items rise slowly, so nothing sits forever.',
  effort_fit: 'Small items that fit a gap between meetings move up.',
};

export function PrioritiesStep({ value, pack, onChange, errors }: { value: OnboardingPriorities; pack: OnboardingRolePack; onChange: (v: OnboardingPriorities) => void; errors: Errors }) {
  const ruleErr = Object.entries(errors).find(([k]) => k.startsWith('rules.'))?.[1];
  return (
    <>
      <Block title="Weights" help={`${pack.name} starter. 0 ignores a signal, 10 lets it dominate.`}>
        <div className={o.weightGrid}>
          <PolicyWeightRows weights={value.weights} was={pack.weights} onChange={(weights) => onChange({ ...value, weights })} help={(k) => WEIGHT_SENTENCE[k]} />
        </div>
      </Block>
      <Block title="Rules" help="Applied after the weights. A positive boost lifts what matches; a negative one holds it back." feedback={ruleErr ? <p className={o.errLine}>{ruleErr}</p> : null}>
        <div className={o.rulesCompact}>
          <PolicyRulesTable rules={value.rules} saved={pack.rules} onChange={(rules) => onChange({ ...value, rules })} />
        </div>
      </Block>
    </>
  );
}

export function PrioritiesAside({ value, pack }: { value: OnboardingPriorities; pack: OnboardingRolePack }) {
  const top = [...WEIGHT_KEYS].sort((a, b) => value.weights[b] - value.weights[a]).slice(0, 3);
  const n = editedCount(value, pack);
  return (
    <>
      <h2>How your list is ranked</h2>
      <p>Every open item gets a score: each signal it shows (from 0 to 1) times its weight, plus the boosts of the rules it matches. The highest scores become Do now on Home.</p>
      <h3>What counts most for you</h3>
      <ul>
        {top.map((k) => (
          <li key={k}>
            <b>{WEIGHT_META[k].label}</b> ({value.weights[k]})
          </li>
        ))}
      </ul>
      <h3>{n ? `${n} change${n === 1 ? '' : 's'} from the ${pack.name} starter` : `The ${pack.name} starter, unchanged`}</h3>
      <p>Your list stays empty until the first scan finds work. Nothing re-ranks on its own later: you change this in Settings ▸ Priority policy, with a preview first.</p>
    </>
  );
}

// ── 4. Sources ──────────────────────────────────────────────────────────────────────────────

const SOURCE_TONE: Record<OnboardingSource['state'], { tone: Tone; label: string }> = {
  ok: { tone: 'ok', label: 'Connected' },
  auth_needed: { tone: 'warn', label: 'Needs sign-in' },
  offline: { tone: 'risk', label: 'Not reachable' },
  unknown: { tone: 'neutral', label: 'Not checked' },
};

export function useOnboardingSources() {
  return useQuery<OnboardingSourcesPayload>({
    queryKey: queryKey('getOnboardingSources', { query: { refresh: '0' } }),
    queryFn: ({ signal }) => api('getOnboardingSources', { query: { refresh: '0' } }, { signal }),
    networkMode: 'always',
    staleTime: 2 * 60_000,
    retry: 0,
  });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ key: 'onboarding:copy', title: 'Command copied', body: 'Paste it in your Terminal.', tone: 'success', durationMs: 2500 });
  } catch {
    toast({ key: 'onboarding:copy', title: 'Couldn’t copy', body: 'Select the command and copy it yourself.', tone: 'warning' });
  }
}

/** What the Sources step needs to show and edit the two ids. */
export interface IdentityProps {
  ids: { slackUserId: string; org62UserId: string };
  onIds: (ids: { slackUserId: string; org62UserId: string }) => void;
  identities: OnboardingState['draft']['identities'];
  detecting: ReadonlySet<IdentityKind>;
  onDetect: (kinds: IdentityKind[]) => void;
  detection: OnboardingState['detection'];
  errors: Errors;
  /** The persona: the Org62 hint follows it. */
  persona: PersonaId | null;
}

/** The persona and your activations, for the Sources step's two groups. */
export interface ActivationProps {
  role: PersonaChoice;
  overrides: Pick<OnboardingPersonaDraft, 'features' | 'connectors'>;
  onToggle: (id: OnboardingSourceId, on: boolean) => void;
}

const ID_META: Record<IdentityKind, { field: 'slackUserId' | 'org62UserId'; label: string; source: string; placeholder: string; hint: ReactNode }> = {
  slack: {
    field: 'slackUserId',
    label: 'Your Slack member ID',
    source: 'Slack',
    placeholder: 'U0123ABCD',
    hint: (
      <>
        In Slack, open your profile, click <b>⋯</b> (More), then <b>Copy member ID</b>. It starts with U or W.
      </>
    ),
  },
  org62: { field: 'org62UserId', label: 'Your Org62 user ID', source: 'Org62', placeholder: '005… (optional)', hint: org62IdHint('se') },
};

/** "just now" under a minute, then "3m ago". */
function sinceText(at: string, now: number): string {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t < 60_000 ? 'just now' : fmtAgo(at, now);
}

/** The id of one source: prefilled from a lookup when the source is connected, always editable, never blocking. */
export function IdentityRow({ kind, connected, p }: { kind: IdentityKind; connected: boolean; p: IdentityProps }) {
  const m = ID_META[kind];
  const value = p.ids[m.field];
  const det = p.identities[kind];
  const busy = p.detecting.has(kind);
  const found = det?.status === 'found' && det.id ? det : null;
  const err = p.errors[m.field];
  const canDetect = p.detection !== 'off' && connected && !busy;
  const wall = useWallClock(30_000);
  const when = found ? sinceText(found.at, wall) : '';
  // where the value came from (the app's derived-value treatment: muted text, the AI mark as the only colour)
  const note = busy ? (
    <span className={o.idBusy}>
      <Spinner size="xs" /> Looking up your {m.source} id…
    </span>
  ) : found && found.id === value.trim() ? (
    <span data-testid={`id-${kind}-found`} title={found.name ? `${m.source} account: ${found.name}` : undefined}>
      <span className={s.spark} aria-hidden>
        ✦
      </span>{' '}
      {found.simulated ? `Mock placeholder for your ${m.source} connection` : kind === 'slack' ? `Found from your Slack connection${found.name ? ` (${found.name})` : ''}` : `From Org62, matched on your email${found.name ? ` (${found.name})` : ''}`} · {when}
    </span>
  ) : found ? (
    <span data-testid={`id-${kind}-edited`}>
      Edited by you ·{' '}
      <button type="button" className={s.linkBtn} onClick={() => p.onIds({ ...p.ids, [m.field]: found.id! })}>
        Use the detected {found.id}
      </button>
    </span>
  ) : det && connected && det.status !== 'not_connected' ? (
    <span data-testid={`id-${kind}-miss`} title={det.message}>
      Couldn’t find it automatically
    </span>
  ) : det?.status === 'not_connected' ? (
    <span>{det.message}</span>
  ) : null;
  return (
    <div className={o.idRow} data-identity={kind}>
      <label htmlFor={`ob-${kind}`} className={o.idLabel}>
        {m.label}
      </label>
      <TextInput id={`ob-${kind}`} width={kind === 'slack' ? 'sm' : 'md'} spellCheck={false} autoComplete="off" placeholder={m.placeholder} aria-invalid={!!err} value={value} onChange={(e) => p.onIds({ ...p.ids, [m.field]: e.target.value })} />
      <span className={o.idNote}>
        {note}
        {canDetect ? (
          <button type="button" className={s.linkBtn} onClick={() => p.onDetect([kind])} data-testid={`detect-${kind}`}>
            {det ? 'Detect again' : 'Detect'}
          </button>
        ) : null}
      </span>
      {err ? (
        <p className={o.idErr} role="alert">
          {err}
        </p>
      ) : found && found.id === value.trim() ? null : (
        <p className={o.idHint}>{kind === 'org62' ? org62IdHint(p.persona) : m.hint}</p>
      )}
    </div>
  );
}

function SourceRow({ src, persona, children }: { src: OnboardingSource; persona: PersonaId | null; children?: ReactNode }) {
  const t = SOURCE_TONE[src.state];
  return (
    <div className={o.src} data-source={src.id} data-state={src.state}>
      <div className={o.srcName}>
        {src.label}
        {src.via ? <span className={o.srcVia}> · rides on Google</span> : null}
      </div>
      <div className={o.srcState}>
        <StatePill tone={t.tone} label={t.label} size="md" />
        <span className={o.srcMsg}>{src.message}</span>
      </div>
      <div className={o.srcReads}>{readsFor(src, persona)}</div>
      {src.command ? (
        <div className={o.cmd}>
          <code title={src.instructions ?? undefined}>{src.command}</code>
          <Button size="sm" variant="secondary" onClick={() => void copy(src.command!)} aria-label={`Copy the ${src.label} command`}>
            Copy
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A source outside your role's preconfiguration: off, a quiet row with its toggle; on, the full row (state, command). */
function AvailableRow({ src, on, persona, onToggle }: { src: OnboardingSource; on: boolean; persona: PersonaId | null; onToggle: (on: boolean) => void }) {
  const toggle = (
    <label className={o.activate}>
      <Switch checked={on} onChange={onToggle} label={`Activate ${src.label}`} testId={`activate-${src.id}`} />
      <span>{on ? 'Activated' : 'Activate'}</span>
    </label>
  );
  if (on)
    return (
      <SourceRow src={src} persona={persona}>
        <div className={o.srcToggle}>{toggle}</div>
      </SourceRow>
    );
  return (
    <div className={o.src} data-source={src.id} data-available="true">
      <div className={o.srcName}>{src.label}</div>
      <div className={o.srcState}>{toggle}</div>
      <div className={o.srcReads}>{readsFor(src, persona)}</div>
    </div>
  );
}

export function SourcesStep({
  query,
  onRefresh,
  refreshing,
  mode,
  identity,
  activation,
}: {
  query: ReturnType<typeof useOnboardingSources>;
  onRefresh: () => void;
  refreshing: boolean;
  mode: OnboardingState['mode'];
  identity: IdentityProps;
  activation: ActivationProps;
}) {
  const d = query.data;
  if (!d)
    return (
      <Block title={query.isError ? 'Couldn’t check your sources' : 'Checking your sources…'} help={query.isError ? 'You can carry on; Health shows them once they scan.' : 'Slack and Org62 take up to 40 seconds.'} actions={query.isError ? <Button onClick={onRefresh}>Try again</Button> : null}>
        <div className="flex flex-col gap-4 py-2" aria-hidden>
          <Skeleton variant="row" count={5} />
        </div>
        <div className={o.srcList}>
          <IdentityRow kind="slack" connected={false} p={identity} />
          <IdentityRow kind="org62" connected={false} p={identity} />
        </div>
      </Block>
    );
  const groups = groupSources(d.sources, activation.role, activation.overrides);
  const read = readSources(groups);
  const need = read.filter((x) => x.state !== 'ok').length;
  const unchecked = read.every((x) => x.state === 'unknown');
  const at = new Date(d.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const persona = activation.role.id;
  return (
    <>
      <Block
        title={unchecked ? `${read.length} sources` : need ? `${read.length - need} of ${read.length} ready` : `All ${read.length} ready`}
        help={mode === 'mock' ? 'Mock mode: states come from the sample data; nothing on this Mac was checked.' : d.simulated ? 'Not checked on this server. Each source shows the command it needs.' : `Checked at ${at}.`}
        actions={
          <Button variant="secondary" loading={refreshing} onClick={onRefresh} data-testid="sources-refresh">
            Check again
          </Button>
        }
      >
        <div className={o.srcList} data-testid="sources-list">
          {groups.active.map((src) => (
            <SourceRow key={src.id} src={src} persona={persona}>
              {src.id === 'slack' || src.id === 'org62' ? <IdentityRow kind={src.id} connected={src.state === 'ok'} p={identity} /> : null}
            </SourceRow>
          ))}
        </div>
      </Block>
      {groups.available.length ? (
        <Block title="Available · Not in your role's preconfiguration" help="Not read unless you activate it. You can change this later in Settings ▸ Role & rules.">
          <div className={o.srcList} data-testid="sources-available">
            {groups.available.map(({ src, on }) => (
              <AvailableRow key={src.id} src={src} on={on} persona={persona} onToggle={(v) => activation.onToggle(src.id, v)} />
            ))}
          </div>
        </Block>
      ) : null}
    </>
  );
}

export function SourcesAside() {
  return (
    <>
      <h2>Read-only, always</h2>
      <p>Command Center only reads your sources. Replies it drafts wait in the Outbox until you approve them; logging and VDP changes wait on Activity until you Apply them.</p>
      <h3>It never signs in for you</h3>
      <p>Where a source needs a sign-in, copy its command and run it in your own Terminal (a browser window opens for the sign-in), then click Check again. No password or token passes through this app.</p>
      <h3>You can finish now</h3>
      <p>A source that isn’t signed in yet is skipped until it is. Health shows each one and its re-auth button.</p>
      <h3>Not in your role’s preconfiguration</h3>
      <p>Sources your role doesn’t use are listed under Available. Activate one and it is read too, with its pages and drafts.</p>
    </>
  );
}

// ── 5. History ──────────────────────────────────────────────────────────────────────────────

export function HistoryStep({ value, onChange, cost, errors }: { value: OnboardingHistory; onChange: (v: OnboardingHistory) => void; cost: OnboardingState['cost']; errors: Errors }) {
  const sel = cost.options.find((x) => x.days === value.lookbackDays) ?? cost.options[0]!;
  const over = Number.isFinite(value.budgetUsd) && sel.highUsd > value.budgetUsd;
  return (
    <>
      <div className={o.options} role="radiogroup" aria-label="History to read">
        {cost.options.map((opt) => (
          <button
            key={opt.days}
            type="button"
            role="radio"
            aria-checked={opt.days === value.lookbackDays}
            className={o.opt}
            data-testid={`lookback-${opt.days}`}
            onClick={() => onChange({ ...value, lookbackDays: opt.days })}
          >
            <span className={o.optDays}>{opt.days} days</span>
            <span className={o.optCost}>about {usdRange(opt)}</span>
            <span className={o.optSub}>
              {opt.days === cost.defaultDays ? 'Recommended · one-time' : 'One-time'}
              {opt.minutes ? ` · ${durationLabel(opt.minutes)}` : ''}
            </span>
          </button>
        ))}
      </div>
      <Block>
        <Row label="Backfill budget" htmlFor="ob-budget" help={`A ceiling for this first scan only ($${BACKFILL_BUDGET_RANGE.min}–${BACKFILL_BUDGET_RANGE.max}). Daily scanning keeps its own cap.`} error={errors.budgetUsd}>
          <span className={s.unit}>$</span>
          <NumberInput id="ob-budget" value={value.budgetUsd} min={BACKFILL_BUDGET_RANGE.min} max={BACKFILL_BUDGET_RANGE.max} step={5} width={120} aria-invalid={!!errors.budgetUsd} onValue={(n) => onChange({ ...value, budgetUsd: n })} />
          {/* D6: the estimate for the chosen history sits next to the ceiling it has to fit under. */}
          <span className={over ? o.optWarn : o.optSub} data-testid="backfill-estimate">
            {sel.days} days is about {usdRange(sel)}.{over ? ' The high estimate is above this budget; the oldest days may be left for the daily scans.' : ' This budget covers it.'}
          </span>
        </Row>
      </Block>
    </>
  );
}

export function HistoryAside({ value, cost }: { value: OnboardingHistory; cost: OnboardingState['cost'] }) {
  return (
    <>
      <h2>What it costs</h2>
      <p>
        One day of history costs about <b>{usdRange(cost.perDay)}</b> to read across every source.
      </p>
      <table className={o.costTbl} aria-label="Estimated cost by history length">
        <thead>
          <tr>
            <th>History</th>
            <th>Estimate</th>
            <th>Takes</th>
          </tr>
        </thead>
        <tbody>
          {cost.options.map((opt) => (
            <tr key={opt.days} data-on={opt.days === value.lookbackDays ? 'true' : undefined}>
              <td>{opt.days} days</td>
              <td>{usdRange(opt)}</td>
              <td>{opt.minutes ? durationLabel(opt.minutes) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-caption">{cost.basis}</p>
      <h3>While it runs</h3>
      <p>You can use the app from the start. Until the first scan finishes, some items may be missing or look undone; a banner on every page shows how far it got.</p>
      <h3>Older than that</h3>
      <p>Anything older you know about can be added by hand at any time, with Capture.</p>
      {cost.dailyHardUsd !== null ? (
        <>
          <h3>After the first scan</h3>
          <p>Scanning keeps up as things happen, under your daily cap ({usd(cost.dailyHardUsd)} a day, Settings ▸ Budgets).</p>
        </>
      ) : null}
    </>
  );
}

// ── 6. Review ───────────────────────────────────────────────────────────────────────────────

export function ReviewStep({
  role,
  overrides,
  you,
  priorities,
  pack,
  history,
  cost,
  sources,
  mode,
  onEdit,
}: {
  role: PersonaChoice;
  overrides: Pick<OnboardingPersonaDraft, 'features' | 'connectors'>;
  you: OnboardingYouDraft;
  priorities: OnboardingPriorities;
  pack: OnboardingRolePack;
  history: OnboardingHistory;
  cost: OnboardingState['cost'];
  sources: OnboardingSourcesPayload | undefined;
  mode: OnboardingState['mode'];
  onEdit: (s: OnboardingStep) => void;
}) {
  const est = cost.options.find((x) => x.days === history.lookbackDays);
  const n = editedCount(priorities, pack);
  const edit = (s: OnboardingStep) => (
    <Button size="sm" variant="quiet" onClick={() => onEdit(s)} aria-label={`Edit ${STEP_META[s].label}`}>
      Edit
    </Button>
  );
  const wh = you.workingHours;
  const def = role.id ? PERSONAS[role.id] : null;
  const activated = activatedLabels(sources?.sources, role, overrides);
  const read = sources ? readSources(groupSources(sources.sources, role, overrides)) : undefined;
  return (
    <div className={o.sum} data-testid="onboarding-review">
      <section className={o.card}>
        <div className={o.cardHead}>
          <h2>Role</h2>
          {edit('role')}
        </div>
        <dl className={o.kv}>
          <dt>Role</dt>
          <dd data-testid="review-role">
            {roleLabel(role)}
            {def?.status === 'preview' ? ' (Preview)' : ''}
          </dd>
          <dt>Logs as</dt>
          <dd>{def ? (def.logging.recordType.value === 'SalesEvents' ? 'Sales Events' : def.logging.recordType.value) : ''}</dd>
          <dt>Activated</dt>
          <dd>{activated.length ? activated.join(', ') : 'Nothing beyond your role'}</dd>
        </dl>
      </section>
      <section className={o.card}>
        <div className={o.cardHead}>
          <h2>You</h2>
          {edit('you')}
        </div>
        <dl className={o.kv}>
          <dt>Name</dt>
          <dd>{you.name}</dd>
          <dt>Email</dt>
          <dd>{you.email}</dd>
          <dt>Hours</dt>
          <dd>{wh ? `${wh.start}–${wh.end} · ${daysText(wh.days)} · ${you.timezone}` : ''}</dd>
        </dl>
      </section>
      <section className={o.card}>
        <div className={o.cardHead}>
          <h2>Priorities</h2>
          {edit('priorities')}
        </div>
        <dl className={o.kv}>
          <dt>Starter</dt>
          <dd>{pack.name}</dd>
          <dt>Changes</dt>
          <dd>{n ? `${n} (saved as policy v2, “Set during onboarding”)` : 'None'}</dd>
          <dt>Rules</dt>
          <dd>
            {priorities.rules.filter((r) => r.enabled).length} on, {priorities.rules.filter((r) => !r.enabled).length} off
          </dd>
        </dl>
      </section>
      <section className={o.card}>
        <div className={o.cardHead}>
          <h2>Sources</h2>
          {edit('sources')}
        </div>
        <dl className={o.kv}>
          <dt>Slack</dt>
          <dd>{you.slackUserId}</dd>
          <dt>Org62</dt>
          <dd>{you.org62UserId?.trim() || 'Not set (optional)'}</dd>
        </dl>
        <p className={o.hint}>{sourcesLine(sources, read)}</p>
      </section>
      <section className={o.card}>
        <div className={o.cardHead}>
          <h2>History</h2>
          {edit('history')}
        </div>
        <dl className={o.kv}>
          <dt>Reads</dt>
          <dd>{history.lookbackDays} days back</dd>
          <dt>Estimate</dt>
          <dd>{est ? `about ${usdRange(est)}, one-time${est.minutes ? `, ${durationLabel(est.minutes)}` : ''}` : ''}</dd>
          <dt>Ceiling</dt>
          <dd>{usd(history.budgetUsd)}</dd>
        </dl>
      </section>
      <section className={cn(o.card, o.wide)}>
        <div className={o.cardHead}>
          <h2>When you start</h2>
        </div>
        <ol className={o.next}>
          {mode === 'mock' ? (
            <li>Mock mode: the sample data’s profile and policy take your choices. Nothing is scanned.</li>
          ) : (
            <li>Your user, settings, role and starter policy are created in this database. Sending stays in dry run; replies are drafted, never sent.</li>
          )}
          <li>
            The first scan reads {history.lookbackDays} days of history, up to {usd(history.budgetUsd)}
            {est?.minutes ? `, in ${durationLabel(est.minutes)}` : ''}. It starts when the worker picks it up, within a minute.
          </li>
          <li>Home opens. Until the first scan finishes, items may be missing or look undone; a banner shows how far it got.</li>
        </ol>
      </section>
    </div>
  );
}

export function ReviewAside() {
  return (
    <>
      <h2>Change it later</h2>
      <ul>
        <li>
          <b>Settings ▸ Role &amp; rules</b>: your role, what it preconfigures, and what you activate.
        </li>
        <li>
          <b>Settings ▸ Profile &amp; role</b>: name, hours, time zone.
        </li>
        <li>
          <b>Settings ▸ Priority policy</b>: weights and rules, with a preview first.
        </li>
        <li>
          <b>Settings ▸ Budgets</b>: the daily scanning cap.
        </li>
      </ul>
      <h3>Nothing leaves without approval</h3>
      <p>Every reply is a draft in the Outbox until you approve it, and every log entry or VDP change waits on Activity until you Apply it. Dry run is on.</p>
    </>
  );
}
