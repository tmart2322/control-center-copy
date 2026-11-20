'use client';
/**
 * Health ▸ Spend ▸ Spend & decisions (D0, audit 2026-11-13): what the model calls cost and why, so spend can be defended.
 *
 *  - The period's totals: dollars, calls, tokens with cache reads and writes, the cache hit rate, identical repeats,
 *    dollars booked without tokens (rows from before the fix), and the decisions not to call the model.
 *  - A breakdown by day, skill, model or trigger. A day or a skill drills down: a day lists its calls (paged) and its
 *    decisions with their reasons; a skill lists its days first.
 *  - Settle's escalation: how often the stronger model changed the verdict (D4: the data for keeping it or not).
 *  - Export CSV: the period's call groups and decision groups, one line each.
 *
 * Color is state only (tenet; memory "Color is an indicator"): amber for dollars without tokens, nothing per skill.
 */
import { useMemo, useState } from 'react';
import { decisionLabel, modelReasonLabel, triggerLabel, type SpendAuditPayload, type SpendSlice } from '@/contract';
import { spendAuditCsv } from '@/engines/spend-audit/aggregate';
import { useApi } from '@/client/hooks';
import { Button, cn, EmptyState, PanelError, SegmentedToggle, Skeleton, usePanelState, useTimeZone } from '@/ui';
import { usd } from './derive';

type Period = '7' | '30' | '90';
type GroupBy = 'day' | 'skill' | 'model' | 'trigger';

const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n)}%`);
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function localToday(tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="min-w-0">
      <div className="text-caption text-muted">{label}</div>
      <div className={cn('text-body-lg font-bold tabular-nums', tone === 'warn' ? 'text-warning-700' : 'text-fg-heading')}>{value}</div>
      {sub ? <div className="text-caption text-muted">{sub}</div> : null}
    </div>
  );
}

const TH = 'py-1 pr-3 text-left text-caption font-bold text-muted';
const TD = 'py-1 pr-3 tabular-nums';

function SliceTable({ rows, label, keyLabel, onPick, picked }: { rows: SpendSlice[]; label: string; keyLabel: (k: string) => string; onPick?: (k: string) => void; picked?: string | null }) {
  if (!rows.length) return <p className="text-body text-muted">No calls in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-body" aria-label={label}>
        <thead>
          <tr className="border-b border-line">
            <th className={TH}>{label}</th>
            <th className={cn(TH, 'text-right')}>Spend</th>
            <th className={cn(TH, 'text-right')}>Calls</th>
            <th className={cn(TH, 'text-right')}>Input</th>
            <th className={cn(TH, 'text-right')}>Output</th>
            <th className={cn(TH, 'text-right')}>Cache read / write</th>
            <th className={cn(TH, 'text-right')}>Cache hit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn('border-b border-line last:border-b-0', picked === r.key && 'bg-surface-muted')}>
              <td className="py-1 pr-3">
                {onPick && r.calls ? (
                  <button type="button" className="text-left text-link hover:underline" onClick={() => onPick(r.key)} aria-pressed={picked === r.key}>
                    {keyLabel(r.key)}
                  </button>
                ) : (
                  <span className={r.calls ? 'text-fg' : 'text-muted'}>{keyLabel(r.key)}</span>
                )}
              </td>
              <td className={cn(TD, 'text-right')}>{usd(r.usd)}</td>
              <td className={cn(TD, 'text-right')}>{r.calls}</td>
              <td className={cn(TD, 'text-right')}>{tok(r.inputTokens)}</td>
              <td className={cn(TD, 'text-right')}>{tok(r.outputTokens)}</td>
              <td className={cn(TD, 'text-right')}>
                {tok(r.cacheReadTokens)} / {tok(r.cacheWriteTokens)}
              </td>
              <td className={cn(TD, 'text-right')}>{pct(r.cacheHitPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Decisions({ p }: { p: SpendAuditPayload }) {
  const groups = useMemo(() => {
    const m = new Map<string, { skill: string; kind: string; reason: string; count: number; usd: number; saved: number }>();
    for (const d of p.decisions) {
      const k = `${d.skill}|${d.kind}|${d.reason}`;
      const g = m.get(k) ?? { skill: d.skill, kind: d.kind, reason: d.reason, count: 0, usd: 0, saved: 0 };
      g.count += d.count;
      g.usd += d.usd;
      g.saved += d.estSavedUsd;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [p.decisions]);
  if (!groups.length) return <p className="text-body text-muted">No decisions recorded in this period. Skips, budget holds and escalations show here as they happen.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-body" aria-label="Decisions not to call the model, holds and escalations">
        <thead>
          <tr className="border-b border-line">
            <th className={TH}>Why</th>
            <th className={TH}>Skill</th>
            <th className={cn(TH, 'text-right')}>Times</th>
            <th className={cn(TH, 'text-right')}>Est. saved</th>
            <th className={cn(TH, 'text-right')}>Extra cost</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={`${g.skill}|${g.kind}|${g.reason}`} className="border-b border-line last:border-b-0">
              <td className="py-1 pr-3 text-fg">{decisionLabel(g.reason)}</td>
              <td className="py-1 pr-3 text-muted">{g.skill}</td>
              <td className={cn(TD, 'text-right')}>{g.count}</td>
              <td className={cn(TD, 'text-right')}>{g.kind === 'escalate' ? '–' : usd(g.saved)}</td>
              <td className={cn(TD, 'text-right')}>{g.kind === 'escalate' ? usd(g.usd) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayDetail({ day, skill, onClose }: { day: string; skill: string | null; onClose: () => void }) {
  const tz = useTimeZone();
  const [limit, setLimit] = useState(50);
  const q = useApi('getSpendAuditDetail', { query: { day, ...(skill ? { skill } : {}), offset: 0, limit } });
  const d = q.data;
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  return (
    <section className="rounded-md border border-line bg-surface px-4 py-3" aria-label={`Calls and decisions on ${day}`} data-spend-audit-detail>
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-body font-bold text-fg-heading">
          {shortDay(day)}
          {skill ? ` · ${skill}` : ' · every skill'}
        </h4>
        {d ? <span className="text-caption text-muted tabular-nums">{d.totalCalls} calls · {d.decisions.reduce((a, x) => a + x.count, 0)} decisions</span> : null}
        <Button variant="quiet" size="xs" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      {q.error ? (
        <PanelError title="Couldn’t load this day" error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton variant="row" count={4} />
      ) : (
        <div className="space-y-3">
          {d.decisions.length ? (
            <div>
              <h5 className="mb-1 text-caption font-bold text-muted">Decisions</h5>
              <ul className="space-y-1 text-body">
                {d.decisions.map((x) => (
                  <li key={x.id} className="flex flex-wrap gap-x-2">
                    <span className="text-fg">{decisionLabel(x.reason)}</span>
                    <span className="text-muted">
                      {x.skill} · {triggerLabel(x.trigger || null)} · ×{x.count}
                      {x.subject ? ` · ${x.subject}` : ''}
                      {x.usd > 0 ? ` · ${usd(x.usd)}` : ''} · {time(x.firstAt)}
                      {x.lastAt !== x.firstAt ? `–${time(x.lastAt)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {d.calls.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-body" aria-label="Calls">
                <thead>
                  <tr className="border-b border-line">
                    <th className={TH}>Time</th>
                    <th className={TH}>Skill</th>
                    <th className={TH}>Model, and why</th>
                    <th className={TH}>Started by</th>
                    <th className={TH}>Outcome</th>
                    <th className={cn(TH, 'text-right')}>Spend</th>
                    <th className={cn(TH, 'text-right')}>In / out</th>
                    <th className={cn(TH, 'text-right')}>Cache r / w</th>
                  </tr>
                </thead>
                <tbody>
                  {d.calls.map((c) => {
                    const none = c.inputTokens + c.outputTokens + c.cacheReadTokens + c.cacheWriteTokens === 0 && c.usd > 0;
                    return (
                      <tr key={c.id} className="border-b border-line align-top last:border-b-0">
                        <td className={TD}>{time(c.at)}</td>
                        <td className="py-1 pr-3 text-fg">{c.skill}</td>
                        <td className="py-1 pr-3">
                          <div className="text-fg">{c.model.replace(/^claude-/, '')}</div>
                          <div className="text-caption text-muted">{modelReasonLabel(c.modelReason)}</div>
                        </td>
                        <td className="py-1 pr-3 text-muted">{triggerLabel(c.trigger)}</td>
                        <td className="py-1 pr-3 text-muted">
                          {c.outcome ?? c.status}
                          {c.repeatOf ? <div className="text-caption">identical to an earlier call</div> : null}
                        </td>
                        <td className={cn(TD, 'text-right')}>{usd(c.usd)}</td>
                        <td className={cn(TD, 'text-right', none && 'text-warning-700')}>{none ? 'not recorded' : `${tok(c.inputTokens)} / ${tok(c.outputTokens)}`}</td>
                        <td className={cn(TD, 'text-right')}>
                          {tok(c.cacheReadTokens)} / {tok(c.cacheWriteTokens)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-body text-muted">No calls{skill ? ` of ${skill}` : ''} on this day.</p>
          )}
          {d.totalCalls > d.calls.length ? (
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted tabular-nums">
                Showing {d.calls.length} of {d.totalCalls}
              </span>
              <Button variant="secondary" size="xs" onClick={() => setLimit((l) => Math.min(500, l + 100))} disabled={limit >= 500}>
                Show more
              </Button>
              {limit >= 500 ? <span className="text-caption text-muted">The rest is in the CSV export.</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function SpendAudit() {
  const tz = useTimeZone();
  const [period, setPeriod] = useState<Period>('7');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [day, setDay] = useState<string | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const to = localToday(tz);
  const from = shift(to, -(Number(period) - 1));
  const q = useApi('getSpendAudit', { query: { from, to } });
  const p = q.data;
  const state = usePanelState('health.spendAudit', { loading: q.isLoading, error: q.data ? null : q.error, empty: !!p && p.totals.calls === 0 && p.decisions.length === 0 });

  const breakdown: Record<GroupBy, SpendSlice[]> = p ? { day: [...p.byDay].reverse(), skill: p.bySkill, model: p.byModel, trigger: p.byTrigger } : { day: [], skill: [], model: [], trigger: [] };
  const skillDays = useMemo(() => {
    if (!p || !skill) return [];
    const m = new Map<string, SpendSlice>();
    for (const r of p.rows.filter((x) => x.skill === skill)) {
      const s = m.get(r.day) ?? { key: r.day, usd: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitPct: null };
      s.usd += r.usd;
      s.calls += r.calls;
      s.inputTokens += r.inputTokens;
      s.outputTokens += r.outputTokens;
      s.cacheReadTokens += r.cacheReadTokens;
      s.cacheWriteTokens += r.cacheWriteTokens;
      m.set(r.day, s);
    }
    return [...m.values()].map((s) => ({ ...s, cacheHitPct: s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens ? (s.cacheReadTokens / (s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens)) * 100 : null })).sort((a, b) => b.key.localeCompare(a.key));
  }, [p, skill]);

  const pick = (k: string) => {
    if (groupBy === 'day') {
      setDay(k);
      setSkill(null);
    } else if (groupBy === 'skill') {
      setSkill(k);
      setDay(null);
    }
  };

  return (
    <section className="space-y-3" data-spend-audit aria-labelledby="spend-audit-title">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="spend-audit-title" className="text-body font-bold text-fg-heading">
          Spend &amp; decisions
        </h3>
        <span className="text-caption text-muted">every call, what started it and why its model, and every call not made</span>
        <div className="ml-auto flex items-center gap-2">
          <SegmentedToggle size="xs" label="Period" value={period} onChange={(v) => { setPeriod(v); setDay(null); setSkill(null); }} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          <Button variant="secondary" size="xs" disabled={!p} onClick={() => p && download(`spend-and-decisions-${p.from}-to-${p.to}.csv`, spendAuditCsv(p))} data-testid="spend-audit-csv">
            Export CSV
          </Button>
        </div>
      </div>
      {state === 'error' ? (
        <PanelError title="Couldn’t load spend & decisions" error={q.error ?? new Error('Forced error state (dev toolbar)')} onRetry={() => void q.refetch()} />
      ) : state === 'loading' || !p ? (
        <Skeleton variant="block" className="h-40" />
      ) : state === 'empty' ? (
        <EmptyState title="Nothing in this period" body="Model calls and the decisions not to make one show here, by day, skill, model and trigger." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface px-4 py-3 @min-[44rem]/pane:grid-cols-4 @min-[68rem]/pane:grid-cols-6" data-testid="spend-audit-totals">
            <Stat label={`${shortDay(p.from)} – ${shortDay(p.to)}`} value={usd(p.totals.usd)} sub={`${p.totals.calls} calls`} />
            <Stat label="Tokens in / out" value={`${tok(p.totals.inputTokens)} / ${tok(p.totals.outputTokens)}`} sub={`cache ${tok(p.totals.cacheReadTokens)} read · ${tok(p.totals.cacheWriteTokens)} written`} />
            <Stat label="Cache hit rate" value={pct(p.totals.cacheHitPct)} sub="cache reads of all prompt tokens" />
            <Stat label="Identical repeats" value={String(p.totals.repeatCalls)} sub={`${usd(p.totals.repeatUsd)} on calls seen before`} />
            <Stat label="Calls not made" value={String(p.decisionTotals.skips + p.decisionTotals.blocks)} sub={`about ${usd(p.decisionTotals.estSavedUsd)} not spent`} />
            {p.totals.untokenizedUsd > 0 ? (
              <Stat label="Dollars without tokens" value={usd(p.totals.untokenizedUsd)} sub={`${p.totals.untokenizedCalls} calls booked before the Nov 13 fix`} tone="warn" />
            ) : (
              <Stat label="Dollars without tokens" value="none" sub="every call has its tokens" />
            )}
          </div>
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="text-body font-bold text-fg-heading">Where it went</h4>
              <span className="text-caption text-muted">{groupBy === 'day' || groupBy === 'skill' ? `pick a ${groupBy} to see its calls and decisions` : ''}</span>
              <SegmentedToggle className="ml-auto" size="xs" label="Group by" value={groupBy} onChange={setGroupBy} options={[{ value: 'day', label: 'Day' }, { value: 'skill', label: 'Skill' }, { value: 'model', label: 'Model' }, { value: 'trigger', label: 'Trigger' }]} />
            </div>
            <SliceTable
              rows={breakdown[groupBy]}
              label={groupBy === 'day' ? 'Day' : groupBy === 'skill' ? 'Skill' : groupBy === 'model' ? 'Model' : 'Started by'}
              keyLabel={(k) => (groupBy === 'day' ? shortDay(k) : groupBy === 'trigger' ? triggerLabel(k === 'unrecorded' ? null : k) : groupBy === 'model' ? k.replace(/^claude-/, '') : k)}
              {...(groupBy === 'day' || groupBy === 'skill' ? { onPick: pick, picked: groupBy === 'day' ? day : skill } : {})}
            />
          </div>
          {skill && !day ? (
            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="mb-2 flex items-baseline gap-2">
                <h4 className="text-body font-bold text-fg-heading">{skill} by day</h4>
                <span className="text-caption text-muted">pick a day to see its calls</span>
                <Button variant="quiet" size="xs" className="ml-auto" onClick={() => setSkill(null)}>
                  Close
                </Button>
              </div>
              <SliceTable rows={skillDays} label="Day" keyLabel={shortDay} onPick={(d) => setDay(d)} />
            </div>
          ) : null}
          {day ? <DayDetail day={day} skill={skill} onClose={() => (skill ? setDay(null) : (setDay(null), setSkill(null)))} /> : null}
          <div className="grid gap-3 @min-[68rem]/pane:grid-cols-[2fr_1fr]">
            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <h4 className="mb-2 text-body font-bold text-fg-heading">Calls not made, holds and escalations</h4>
              <Decisions p={p} />
            </div>
            <div className="rounded-md border border-line bg-surface px-4 py-3" data-testid="settle-escalation">
              <h4 className="mb-2 text-body font-bold text-fg-heading">Settle: does the stronger model change the verdict?</h4>
              {p.settleEscalation.escalated ? (
                <p className="text-body text-fg">
                  It changed <b className="tabular-nums">{p.settleEscalation.changed}</b> of <b className="tabular-nums">{p.settleEscalation.escalated}</b> escalated verdicts ({pct(p.settleEscalation.changedPct)})
                  {p.settleEscalation.invalid ? `, and gave no usable answer ${p.settleEscalation.invalid} times` : ''}, for {usd(p.settleEscalation.extraUsd)} more.
                </p>
              ) : (
                <p className="text-body text-muted">No escalations in this period.</p>
              )}
              <p className="mt-2 text-caption text-muted">Kept for the decision whether the escalation earns its price. Nothing changes until you decide.</p>
            </div>
          </div>
          <p className="text-caption text-muted">
            {p.simulated ? 'Mock mode: placeholder numbers made from the sample spend; nothing was called. ' : ''}
            These rows are the audit trail: calls and decisions are kept {p.retention.keepDays} days, then rolled up to daily totals. Times and days are {p.timezone}.
            {p.totals.unattributedCalls ? ` ${p.totals.unattributedCalls} calls in this period were booked before Nov 13 and have no trigger or model reason.` : ''}
          </p>
        </>
      )}
    </section>
  );
}
