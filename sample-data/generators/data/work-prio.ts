/** Domain 04: priority runs, scores, rule hits and today's plan, computed from the work item states. */
import { OWNER, readTable, sha, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import type { Built } from './work-core';
import { calId, csNear, ms, mt, plus, wiId } from './work-lib';

interface Policy { id: string; version: number; w: Record<string, number>; activated: number; retired: number | null }
const POLICIES: Policy[] = (readTable('priority_policies') as Row[]).map((p) => ({
  id: p.id as string, version: p.version as number, activated: ms(p.activated_at as string), retired: p.retired_at ? ms(p.retired_at as string) : null,
  w: { dp: p.weight_deadline_proximity as number, cp: p.weight_calendar_pressure as number, lt: p.weight_lead_time as number, ef: p.weight_effort_fit as number, si: p.weight_stakeholder_importance as number, dv: p.weight_deal_value as number, cw: p.weight_commitment as number, st: p.weight_staleness as number, ob: p.weight_obligation as number },
}));
const RULES = readTable('priority_policy_rules') as Row[];
const PEOPLE = new Map((readTable('people') as Row[]).map((p) => [p.id as string, p]));
const OPPS = new Map((readTable('opportunities') as Row[]).map((o) => [o.id as string, o]));
const EVENTS = readTable('calendar_events') as Row[];
const policyAt = (t: number) => POLICIES.find((p) => t >= p.activated && (p.retired == null || t < p.retired))!;
const hrs = (a: number, b: number) => (a - b) / 3_600_000;

const LIVE: string[] = ['suggested', 'open', 'in_progress', 'waiting_on_others', 'waiting_on_me', 'likely_done'];
function statusAt(b: Built, t: number): string | null {
  let st: string | null = null;
  for (const s of b.steps) { if (!s.effective) continue; if (ms(s.at) <= t) st = s.to; else break; }
  return st;
}
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

interface RunDef { at: string; trigger: 'schedule' | 'new_info' | 'calendar_change' | 'user_reprioritize' | 'chat' | 'startup'; scored: boolean; considered?: number; changed?: number }
export function runDefs(): RunDef[] {
  const defs: RunDef[] = [];
  const cs = readTable('change_sets') as Row[];
  for (const c of cs.filter((x) => x.actor_ref === 'engine.priority@v3')) {
    const m = String(c.summary).match(/re-ranked (\d+)/);
    defs.push({ at: plus(c.created_at as string, 0, -20), trigger: 'schedule', scored: ms(c.created_at as string) >= ms(mt('11-11 00:00')), considered: m ? +m[1]! : 30 });
  }
  defs.push({ at: mt('11-06 15:58:40'), trigger: 'chat', scored: false, considered: 27 });
  defs.push({ at: mt('11-15 15:21:05'), trigger: 'user_reprioritize', scored: true });
  defs.push({ at: mt('11-18 08:58:10'), trigger: 'new_info', scored: true });
  return defs.sort((a, b) => ms(a.at) - ms(b.at));
}

function freeMinutes(startIso: string): { free: number; next: string | null } {
  const start = ms(startIso); const day = new Date(start - 7 * 3_600_000).toISOString().slice(0, 10);
  const end = ms(mt(`${day.slice(5)} 17:30`));
  const evs = EVENTS.filter((e) => e.local_day === day && !e.is_all_day && e.my_response !== 'declined' && !['focus_time', 'working_location'].includes(String(e.event_type)) && ms(e.ends_at as string) > start && ms(e.starts_at as string) < end)
    .sort((a, b) => ms(a.starts_at as string) - ms(b.starts_at as string));
  let busy = 0; for (const e of evs) busy += Math.max(0, Math.min(end, ms(e.ends_at as string)) - Math.max(start, ms(e.starts_at as string))) / 60_000;
  const next = evs.find((e) => ms(e.starts_at as string) > start);
  return { free: Math.max(0, Math.round((end - start) / 60_000 - busy)), next: next ? (next.starts_at as string) : null };
}

export function buildPriority(built: Built[]) {
  const defs = runDefs();
  const runs: Row[] = []; const scores: Row[] = []; const hits: Row[] = []; const plan: Row[] = [];
  let scoreId = 0; let hitId = 0;
  const lastScore = new Map<number, { id: number; total: number; lane: string; rank: number | null; at: string }>();
  const topByRun = new Map<number, number[]>();
  defs.forEach((d, i) => {
    const runId = i + 1; const t = ms(d.at);
    const pol = policyAt(t);
    const startedAt = d.at; const finishedAt = plus(d.at, 0, 2 + (i % 3));
    const fm = freeMinutes(d.at);
    let considered = d.considered ?? 0; let changed = 0;
    if (d.scored) {
      const rows: Array<{ b: Built; adj: number; comp: Record<string, number>; total: number; hitList: Array<{ rule: Row; effect: number | null; text: string }>; hidden: boolean; floor: boolean }> = [];
      for (const b of built) {
        const st = statusAt(b, t); if (!st || !LIVE.includes(st)) continue;
        const s = b.spec; const row = b.row;
        const due = row.due_at ? ms(row.due_at as string) : null;
        const dueH = due != null ? hrs(due, t) : null;
        const cp = s.cp ? PEOPLE.get(uid('people', s.cp)) : null;
        const tier = String(cp?.tier ?? 'normal');
        const opp = s.o ? OPPS.get(uid('opportunities', s.o)) : null;
        const amount = Number(opp?.amount ?? 0);
        const comp: Record<string, number> = {};
        comp.dp = dueH == null ? 0.3 : dueH < 0 ? 9 + Math.min(1, -dueH / 240) : 10 * Math.exp(-dueH / 60);
        if (Number(row.effort_minutes ?? 30) <= 15) comp.dp *= 0.45; else if (Number(row.effort_minutes ?? 30) <= 30) comp.dp *= 0.75;
        const evT = s.deadlineEvent ? ms(EVENTS.find((e) => e.id === calId(s.deadlineEvent!))!.starts_at as string) : null;
        comp.cp = evT != null && evT > t ? 6 * Math.exp(-hrs(evT, t) / 30) : 0;
        const lead = Number(row.lead_time_minutes ?? row.effort_minutes ?? 0);
        comp.lt = due != null && lead ? (dueH! * 60 - lead < 0 ? 5 : 5 * Math.exp(-(dueH! * 60 - lead) / 900)) : 0;
        const eff = Number(row.effort_minutes ?? 30);
        comp.ef = eff <= 15 ? 2 : eff <= 45 ? 1.2 : eff <= 90 ? 0.6 : 0;
        comp.si = ({ customer_exec: 5, customer: 3.5, manager: 5, ae: 3, leader: 4, teammate: 1.5, partner: 2, normal: 0.8 } as Record<string, number>)[tier] + (row.importance === 'critical' ? 2 : row.importance === 'high' ? 1 : row.importance === 'low' ? -1 : 0);
        comp.dv = amount >= 1_000_000 ? 4 : amount >= 500_000 ? 3 : amount >= 200_000 ? 2 : amount > 0 ? 1 : 0;
        if (opp && ['Negotiation', 'Technical Validation'].includes(String(opp.stage))) comp.dv += 0.5;
        comp.cw = s.k === 'commitment' ? (s.og === 'said_by_me' ? 4.5 : 4) : s.k === 'ask' ? 3 : s.k === 'training' ? 2 : s.k === 'travel' ? 2.5 : s.k === 'task' ? 1.5 : s.k === 'missed_meeting_followup' ? 1 : 0.5;
        const ageD = hrs(t, ms(row.created_at as string)) / 24;
        comp.st = st === 'waiting_on_others' ? 0 : Math.min(3, ageD / 8);
        comp.ob = s.n === 49 || (s.og === 'system_rule' && s.k === 'task' && /Org62/.test(s.title)) ? 3 : s.mgr ? 1.5 : 0;
        const penalty = (st === 'waiting_on_others' ? -2.5 : st === 'likely_done' ? -2 : st === 'suggested' ? -1.5 : 0) + (row.importance === 'low' ? -1 : 0);
        // the user pinned the day's three (chat 'plan the day', 11/17) and shrugged off two calendar-covered items
        const adj = ms(d.at) >= ms(mt('11-17 07:48')) ? ({ 3: 9, 31: 10, 60: 4, 93: -5, 61: -9 } as Record<number, number>)[s.n] ?? 0 : (s.lock?.length ? 5 : 0);
        let total = adj + pol.w.dp! * comp.dp + pol.w.cp! * comp.cp + pol.w.lt! * comp.lt + pol.w.ef! * comp.ef + pol.w.si! * comp.si + pol.w.dv! * comp.dv + pol.w.cw! * comp.cw + pol.w.st! * comp.st + pol.w.ob! * comp.ob + penalty;
        // rules
        const hitList: Array<{ rule: Row; effect: number | null; text: string }> = [];
        const pr = RULES.filter((r) => r.policy_id === pol.id && r.enabled);
        let hidden = false; let floor = false;
        for (const r of pr) {
          const key = String(r.rule_key);
          if (key === 'r_customer' && s.cust) { total += Number(r.effect_value); hitList.push({ rule: r, effect: Number(r.effect_value), text: 'Customer-facing work ranks above internal.' }); }
          if (key === 'r_manager' && s.mgr && dueH != null && dueH <= 24) { total += Number(r.effect_value); hitList.push({ rule: r, effect: Number(r.effect_value), text: 'My manager asked and it is due within 24 hours.' }); }
          if (key === 'r_admin' && s.k === 'task' && !s.cust) { total += Number(r.effect_value); hitList.push({ rule: r, effect: Number(r.effect_value), text: 'Admin chore: ranked down.' }); }
          if (key === 'r_mgr_sla' && s.mgr) hitList.push({ rule: r, effect: null, text: 'Manager ask: answer within 24 hours of the ask.' });
          if (key === 'r_blueprint_floor' && s.cust && dueH != null && dueH <= 72 && dueH > -24) { floor = true; hitList.push({ rule: r, effect: null, text: 'Customer deliverable due within 72 hours: never below Now.' }); }
          if (key === 'r_noise_exclude' && row.importance === 'low' && s.k !== 'commitment') { hidden = true; hitList.push({ rule: r, effect: null, text: 'Low importance and not a commitment: hidden.' }); }
        }
        total += 0;
        rows.push({ b, adj, comp, total, hitList, hidden, floor });
      }
      considered = rows.length;
      const ranked = rows.filter((r) => !r.hidden).sort((a, b) => b.total - a.total || a.b.spec.n - b.b.spec.n);
      const laneOf = (r: (typeof rows)[number], rank: number): string => {
        if (r.hidden) return 'hidden';
        if (r.b.spec.k === 'background_promise' || (r.b.row.backgroundable as boolean)) return 'background';
        if (rank <= 3) return 'top3';
        let lane = rank <= 9 ? 'now' : rank <= 18 ? 'next' : 'later';
        if (r.floor && (lane === 'next' || lane === 'later')) lane = 'now';
        return lane;
      };
      let rankN = 0; const top: number[] = [];
      for (const r of [...ranked, ...rows.filter((x) => x.hidden)]) {
        const rank = r.hidden ? null : ++rankN;
        const lane = laneOf(r, rank ?? 99);
        scoreId++;
        const due = r.b.row.due_at ? ms(r.b.row.due_at as string) : null;
        const eff = Number(r.b.row.effort_minutes ?? 0);
        const dueH = due != null ? hrs(due, t) : null;
        const reasons: string[] = [];
        if (dueH != null) reasons.push(dueH < 0 ? `overdue by ${Math.max(1, Math.round(-dueH / 24)) === 1 && -dueH < 24 ? Math.round(-dueH) + 'h' : Math.round(-dueH / 24) + 'd'}` : dueH < 24 ? `due in ${Math.round(dueH)}h` : `due in ${Math.round(dueH / 24)}d`);
        if (r.b.spec.cust) reasons.push('customer-facing');
        if (r.b.row.importance === 'critical') reasons.push('critical');
        if (r.hitList.length) reasons.push(`${r.hitList.length} rule${r.hitList.length > 1 ? 's' : ''} applied`);
        if (rank != null && rank <= 3) top.push(r.b.spec.n);
        const hash = sha(JSON.stringify([r.b.id, r.b.row.status, r.b.row.due_at, round(r.total, 2), pol.id]));
        const prev = lastScore.get(r.b.spec.n);
        if (!prev || prev.lane !== lane || prev.rank !== rank) changed++;
        const row: Row = {
          id: scoreId, run_id: runId, work_item_id: r.b.id, policy_id: pol.id, total: round(r.total), deadline_proximity: round(r.comp.dp!), calendar_pressure: round(r.comp.cp!), lead_time: round(r.comp.lt!), effort_fit: round(r.comp.ef!), stakeholder_importance: round(r.comp.si!), deal_value: round(r.comp.dv!),
          commitment_weight: round(r.comp.cw!), staleness: round(r.comp.st!), obligation_boost: round(r.comp.ob!), user_adjustment: r.adj, penalty: round(r.total - r.adj - (pol.w.dp! * r.comp.dp! + pol.w.cp! * r.comp.cp! + pol.w.lt! * r.comp.lt! + pol.w.ef! * r.comp.ef! + pol.w.si! * r.comp.si! + pol.w.dv! * r.comp.dv! + pol.w.cw! * r.comp.cw! + pol.w.st! * r.comp.st! + pol.w.ob! * r.comp.ob!) - r.hitList.reduce((a, h) => a + (h.effect ?? 0), 0)),
          lane, rank, latest_start_at: due && eff ? plus(new Date(due - Math.max(eff, Number(r.b.row.lead_time_minutes ?? eff)) * 60_000).toISOString(), 0, 0) : null, slack_minutes: due && eff ? Math.round((due - t) / 60_000 - eff) : null, inputs_hash: hash,
          explanation: `${lane === 'top3' ? 'Top 3: ' : ''}${reasons.join(', ') || 'no deadline'}; score ${round(r.total, 1)}.`, computed_at: finishedAt,
        };
        // the penalty column holds only the negative part
        row.penalty = round(Math.min(0, Number(row.penalty)));
        scores.push(row);
        for (const h of r.hitList) { hitId++; hits.push({ id: hitId, score_id: scoreId, rule_id: h.rule.id, effect: h.effect, explanation: h.text }); }
        lastScore.set(r.b.spec.n, { id: scoreId, total: round(r.total), lane, rank, at: finishedAt });
      }
      topByRun.set(runId, top);
    } else changed = Math.max(2, Math.round(considered * 0.2));
    runs.push({ id: runId, owner_user_id: OWNER, trigger: d.trigger, engine_version: 'priority/2.3.0', policy_id: pol.id, started_at: startedAt, finished_at: finishedAt, items_considered: considered, items_changed: changed, available_focus_minutes: d.trigger === 'chat' ? null : fm.free, next_meeting_at: fm.next });
  });
  return { runs, scores, hits, plan, lastScore, topByRun, runIds: defs.map((d, i) => ({ id: i + 1, at: d.at, trigger: d.trigger })) };
}

// ── today's plan (the last run, plus the 07:35 run before the new messages arrived) ─────────────
type Step = [string | null, string | null, 'kickoff_background' | 'meeting_prep' | 'focus' | 'quick_win' | 'meeting' | 'buffer', string, string, string];
const PLAN_LATE: Step[] = [
  ['wi-020', null, 'kickoff_background', '09:00', '09:05', 'Kick off the export load in the background; it runs while you do other work.'],
  ['wi-030', null, 'quick_win', '09:05', '09:15', 'Hana asked 8 minutes ago and has a 24-hour SLA; a two-line reply.'],
  ['wi-031', null, 'quick_win', '09:15', '09:25', 'Approve the Elderglen reply draft: Nadia needs a time today and the demo is tomorrow.'],
  ['wi-014', null, 'quick_win', '09:25', '09:30', 'Skim and send the week 4 status email draft before Thursday\'s sync.'],
  ['wi-015', 'focus-hv-blueprint-p0', 'focus', '09:30', '09:50', 'Blueprint sections 6 and 7 are due 13:17; start in the focus block before the team sync.'],
  ['wi-093', null, 'meeting_prep', '09:50', '10:00', 'Two lines of Q4 coverage notes for the SE team sync.'],
  [null, 'se-sync-p0', 'meeting', '10:00', '11:00', 'SE team sync overlaps the focus block; the blueprint work resumes at 11:00.'],
  ['wi-015', 'focus-hv-blueprint-p0', 'focus', '11:00', '12:00', 'Finish the data model and rollout plan; the blueprint is the gating item for Friday.'],
  ['wi-006', null, 'focus', '12:00', '12:45', 'IdP group mapping in writing, due before Thursday\'s 11:00 sync.'],
  ['wi-066', null, 'meeting_prep', '12:45', '13:00', 'Open the analyst workflow notes before the dry run.'],
  ['wi-066', 'qp-dry', 'meeting', '13:00', '14:00', 'Linnea\'s dry run of the Ferrowpay architecture session.'],
  ['wi-060', null, 'meeting_prep', '14:00', '14:30', 'Draft severity 2 wording for section 3 before the 14:30 call with Oakhallow.'],
  ['wi-061', 'pc-order', 'meeting', '14:30', '15:00', 'Oakhallow order form call (30 minutes max).'],
  [null, 'qp-sync-p0', 'meeting', '15:00', '15:30', 'Ferrowpay pursuit sync.'],
  ['wi-032', 'to-demoprep', 'focus', '15:30', '17:00', 'Wire up the OMS sandbox and rehearse the split-shipment scene for tomorrow\'s demo.'],
];
export function buildPlan(runs: Row[], built: Built[]): Row[] {
  const idOf = (k: string) => built.find((b) => `wi-${String(b.spec.n).padStart(3, '0')}` === k)!.id;
  const out: Row[] = []; let id = 0;
  const lateRun = runs[runs.length - 1]!;
  const add = (run: Row, steps: Step[]) => steps.forEach((s, i) => { id++; out.push({ id, run_id: run.id, ordinal: i + 1, work_item_id: s[0] ? idOf(s[0]) : null, calendar_event_id: s[1] ? calId(s[1]) : null, mode: s[2], planned_start_at: mt(`11-18 ${s[3]}`), planned_end_at: mt(`11-18 ${s[4]}`), reason: s[5] }); });
  add(lateRun, PLAN_LATE);
  void csNear; void wiId;
  return out;
}
