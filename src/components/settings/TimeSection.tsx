'use client';
/**
 * Settings ▸ Time (onsite lane): onsite days and travel. Explicit save, like the other sections.
 *
 *   Detect onsite days       On     a trip, an onsite event or in-person customer meetings make the day an onsite day
 *   Onsite hours             08:00–17:00 in the trip's time zone: the frame that fills the gaps between sessions
 *   Airport buffer           before each flight (120 min) and after it lands (60 min), logged as Travel; two fields
 *                            (2026-11-14: the engine reads airportBufferBeforeMin / airportBufferAfterMin, and a legacy
 *                            symmetric airportBufferMin still applies to a side never set)
 *   Customer dinners         count as customer-facing (off: not counted)
 *   Overlapping meetings     Log every accepted meeting (default) / Count overlapping time once (D-18 amended)
 *   Dismissed sources        D-64: every "Dismiss all from <source>" rule (a repo, unmapped Drive docs, a recurring
 *                            series) with Remove (its rows come back as proposals; Undo in the toast). Saves at once.
 * Corrections on the Time and History day chips always apply, whatever is set here.
 */
import { DEFAULT_LOGGING_SETTINGS, type TimeDismissRule, type TimeOverlaps, type TimeSettings } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { Button, SegmentedToggle, Skeleton } from '@/ui';
import { airportBuffers } from '@/engines/activity/onsite';
import { Block, Row, Section, SaveActions, SaveFeedback, useSectionForm } from './form';
import { NumberInput, Select, Switch, TextInput } from './controls';
import s from './settings.module.css';

const Loading = () => <Skeleton variant="block" className="mt-6 h-48 w-full" />;
const TIME_KEYS = ['detectOnsite', 'onsiteHours', 'airportBufferMin', 'airportBufferBeforeMin', 'airportBufferAfterMin', 'dinnersCustomerFacing', 'overlaps', 'logging'] as const;

/** A buffer side is 0–360 minutes (the contract's bound). */
export function bufferError(n: number | undefined): string | null {
  return n === undefined || !Number.isFinite(n) || n < 0 || n > 360 ? 'Between 0 and 360 minutes.' : null;
}

/** Settings ▸ Time ▸ Overlapping meetings: the two choices, the default first. */
export const OVERLAP_OPTIONS: readonly { value: TimeOverlaps; label: string }[] = [
  { value: 'log_all_accepted', label: 'Log every accepted meeting (default)' },
  { value: 'count_once', label: 'Count overlapping time once' },
];

export function useTimeForm() {
  return useSectionForm('time', TIME_KEYS, 'Time', 'time');
}

/** "08:00–17:00", the label beside the nav item. */
export function timeSummary(t: Omit<TimeSettings, 'version'> | undefined): string {
  if (!t) return '';
  if (!t.detectOnsite) return 'Onsite detection off';
  const b = airportBuffers(t);
  return `Onsite ${t.onsiteHours.start}–${t.onsiteHours.end} · airport ${b.beforeMin} / ${b.afterMin} min`;
}

export function TimeSection() {
  const f = useTimeForm();
  const d = f.draft;
  const hours = d.onsiteHours ?? { start: '08:00', end: '17:00' };
  const hoursErr = hours.end <= hours.start ? 'The end has to be after the start.' : null;
  // What the engine uses now (a side never set falls back to the legacy symmetric value, else 120 / 60).
  const buf = airportBuffers(d);
  const beforeErr = bufferError(buf.beforeMin);
  const afterErr = bufferError(buf.afterMin);
  const bufferErr = beforeErr ?? afterErr;
  // Editing one side pins both, so the other never changes under you when the legacy value is dropped later.
  const setBuffer = (side: 'before' | 'after', n: number) => {
    f.set('airportBufferBeforeMin', side === 'before' ? n : buf.beforeMin);
    f.set('airportBufferAfterMin', side === 'after' ? n : buf.afterMin);
  };
  const log = d.logging ?? DEFAULT_LOGGING_SETTINGS;
  const setLog = (patch: Partial<typeof log>) => f.set('logging', { ...log, ...patch });
  const canvasUrl = log.workOrderCanvasUrl ?? '';
  const canvasErr: string | null = canvasUrl && !/^https:\/\/\S+$/.test(canvasUrl.trim()) ? 'A link starts with https:// (copy it from Slack: Copy link).' : null;
  return (
    <Section
      id="time"
      title="Time"
      meta="Onsite days, travel and overlapping meetings. Every session keeps its own row; one onsite frame per day, never overnight."
      actions={<SaveActions dirty={f.dirty} onSave={() => void f.save()} onDiscard={f.discard} mutation={f.mutation} savedAt={f.savedAt} saveDisabled={!!hoursErr || !!bufferErr || !!canvasErr} testId="save-time" />}
      feedback={<SaveFeedback mutation={f.mutation} />}
    >
      {!f.server ? (
        <Loading />
      ) : (
        <Block>
          <Row label="Detect onsite days" htmlFor="t-detect" help="From your trips (hotel and flights), onsite events and in-person customer meetings. Your corrections on a day always apply." edited={f.changed('detectOnsite')}>
            <Switch id="t-detect" label="Detect onsite days" checked={d.detectOnsite ?? true} onChange={(v) => f.set('detectOnsite', v)} testId="t-detect" />
          </Row>
          <Row label="Onsite hours" htmlFor="t-start" help="In the trip's time zone. On the day you fly in or home, the frame starts at your first session or ends at your last." edited={f.changed('onsiteHours')} error={hoursErr}>
            <TextInput id="t-start" type="time" width="sm" value={hours.start} onChange={(e) => f.set('onsiteHours', { ...hours, start: e.target.value })} aria-label="Onsite hours from" />
            <span className={s.unit}>to</span>
            <TextInput id="t-end" type="time" width="sm" value={hours.end} onChange={(e) => f.set('onsiteHours', { ...hours, end: e.target.value })} aria-label="Onsite hours until" aria-invalid={!!hoursErr} />
          </Row>
          <Row label="Airport buffer before a flight" htmlFor="t-buffer-before" help="Travel before each departure (getting to the airport, security), logged as Travel on the trip's account. Duplicate flight entries count once." edited={f.changed('airportBufferBeforeMin')} error={beforeErr}>
            <NumberInput id="t-buffer-before" min={0} max={360} step={15} width={88} value={buf.beforeMin} onValue={(n) => setBuffer('before', n)} data-testid="t-buffer-before" />
            <span className={s.unit}>min</span>
          </Row>
          <Row label="Airport buffer after landing" htmlFor="t-buffer-after" help="Travel after each flight lands (bags, the ride out), logged as Travel on the trip's account." edited={f.changed('airportBufferAfterMin')} error={afterErr}>
            <NumberInput id="t-buffer-after" min={0} max={360} step={15} width={88} value={buf.afterMin} onValue={(n) => setBuffer('after', n)} data-testid="t-buffer-after" />
            <span className={s.unit}>min</span>
          </Row>
          <Row label="Customer dinners count as customer-facing" htmlFor="t-dinner" help="A dinner with customers at the table. Off: it is not counted." edited={f.changed('dinnersCustomerFacing')}>
            <Switch id="t-dinner" label="Customer dinners count as customer-facing" checked={d.dinnersCustomerFacing ?? true} onChange={(v) => f.set('dinnersCustomerFacing', v)} testId="t-dinner" />
          </Row>
          <Row
            label="Overlapping meetings"
            htmlFor="t-overlaps"
            help="Every meeting you accepted logs, even when two overlap (each row says what it overlaps), and an onsite day logs in full with the meetings during it, so a day can total more than the clock. Count once: the meeting that ranks higher keeps the time and onsite hours fill only the gaps. Estimated time (Claude, Drive, Slack) never overlaps either way."
            edited={f.changed('overlaps')}
          >
            <Select id="t-overlaps" value={d.overlaps ?? 'log_all_accepted'} onChange={(e) => f.set('overlaps', e.target.value as TimeOverlaps)} data-testid="t-overlaps">
              {OVERLAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Row>
        </Block>
      )}
      {!f.server ? null : (
        <Block title="Logging to Org62">
          <Row label="When to log" htmlFor="t-log-mode" help="On demand: a batch only when you start one (Log to Slackbot on Activity, or ask the Assistant). Automatic: every weekday at 17:30 the batch is staged by itself, ready for your one-click Apply on Activity. Either way the app checks Org62 and flags anything that didn't land." edited={f.changed('logging')}>
            <SegmentedToggle label="When to log" value={log.mode} onChange={(v) => setLog({ mode: v })} options={[{ value: 'on_demand', label: 'On demand' }, { value: 'automatic', label: 'Automatic' }]} />
          </Row>
          <Row label="Canvas" htmlFor="t-log-canvas" help="Each batch becomes a new private canvas Slackbot runs as a work order: Apply it on Activity, open it in Slack and tell Slackbot &ldquo;Execute this canvas&rdquo;. Applied canvases are listed on Activity with their link." edited={f.changed('logging')}>
            <span className={s.unit}>A new private canvas per batch</span>
          </Row>
          <Row label="Work-order canvas link" htmlFor="t-log-canvas-url" help="Your Slackbot work-order canvas, so Time can link to it before your first batch (and build a canvas link when Slack returns only its id). In Slack: open the canvas, Copy link. Empty: no link." edited={f.changed('logging')} error={canvasErr}>
            <TextInput id="t-log-canvas-url" type="url" placeholder="https://your-workspace.slack.com/docs/…" value={canvasUrl} onChange={(e) => setLog({ workOrderCanvasUrl: e.target.value.trim() ? e.target.value : null })} aria-invalid={!!canvasErr} data-testid="t-log-canvas-url" />
          </Row>
          <Row label="Include complete proposed rows" htmlFor="t-log-approve" help="A batch also takes proposed rows that have a task type and an opportunity (or account), and approves them. Rows that need input are listed, never guessed. Internal rows (no opportunity) always wait for your Log on Activity." edited={f.changed('logging')}>
            <Switch id="t-log-approve" label="Include complete proposed rows" checked={log.approveComplete} onChange={(v) => setLog({ approveComplete: v })} testId="t-log-approve" />
          </Row>
        </Block>
      )}
      {!f.server ? null : <DismissedSources />}
    </Section>
  );
}

const KIND_WORD: Record<TimeDismissRule['kind'], string> = { repo: 'Repo', docs: 'Drive docs', series: 'Recurring meeting' };

/**
 * D-64: Settings ▸ Time ▸ Dismissed sources: the remembered "Dismiss all from <source>" rules. Remove brings the
 * source's rows back as proposals (one change, Undo in the toast); nothing else here needs Save.
 */
function DismissedSources() {
  const q = useApi('listTimeDismissRules');
  const remove = useOptimisticMutation({
    route: 'removeTimeDismissRule',
    topics: ['time', 'settings'],
    toast: (_r, input) => ({ title: 'Rule removed: its rows are back', body: `Rows from ${q.data?.rules.find((r) => r.key === input.body?.key)?.label ?? 'that source'} are proposed again on Activity.` }),
  });
  const rules = q.data?.rules ?? [];
  return (
    <Block title="Dismissed sources">
      {!rules.length ? (
        <p className="px-1 text-caption text-muted" data-testid="t-dismissed-none">
          None. On Time, More ▸ Dismiss all from… on an internal row sets aside every row of its repo, its unmapped Drive docs or its recurring meeting, now and later.
        </p>
      ) : (
        <ul className="grid gap-1" data-testid="t-dismissed">
          {rules.map((r) => (
            <li key={r.key} className="flex min-w-0 items-center gap-3 rounded-md px-1 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-fg">{r.label}</span>
                <span className="block text-caption text-muted">
                  {KIND_WORD[r.kind]} · {r.rows === 1 ? '1 row set aside' : `${r.rows} rows set aside`} · since {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </span>
              <Button size="xs" variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate({ body: { key: r.key } })} data-testid="t-dismissed-remove">
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/** The effect pane: what the saved values do to an onsite day. */
export function TimeEffect() {
  const f = useTimeForm();
  const d = f.draft;
  if (!f.server) return null;
  const h = d.onsiteHours ?? { start: '08:00', end: '17:00' };
  return (
    <div className="grid gap-3 p-4 text-body" data-testid="time-effect">
      <h3 className="text-body-lg font-bold text-fg-heading">On an onsite day</h3>
      {d.detectOnsite === false ? (
        <p className="text-muted">Nothing is detected. Days you mark on Activity or History (a day chip, or Mark trip) still log onsite hours.</p>
      ) : (
        <ul className="grid gap-1.5 text-fg">
          <li>
            Onsite {h.start}–{h.end} in the trip&rsquo;s time zone, customer-facing, on the trip&rsquo;s one account and opp.
          </li>
          <li>
            {d.overlaps === 'count_once'
              ? 'Your sessions keep their own rows; the onsite frame fills only the gaps (counted once).'
              : 'The whole day logs as onsite, and your meetings during it log as their own rows too.'}
          </li>
          <li>Each flight: {d.airportBufferMin ?? 60} min before and after counts as Travel.</li>
          <li>Customer dinners: {d.dinnersCustomerFacing === false ? 'not counted' : 'customer-facing'}.</li>
        </ul>
      )}
    </div>
  );
}
