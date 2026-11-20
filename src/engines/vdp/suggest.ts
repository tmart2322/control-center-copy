/**
 * Suggested values for VDP's judgment fields (D-60, pure, deterministic: no model call, no spend). A person approves
 * them ("Suggested: Priority = 3 - High · Persona = CIO", one "Apply suggestions" per use case); they are never
 * auto-applied. Each value says where it came from.
 *
 *   Priority  the linked open opp's close quarter: this quarter → 3 - High, next → 2 - Medium, later → 1 - Low
 *   Persona   the one senior stakeholder title VDP records (CIO, VP of Marketing, Head of Data…), when exactly one
 *   Division  that title's function ("VP of Marketing" → Marketing), when it names one
 *   Title     a new use case: the opp's name without the account's
 * Details stay yours: free text the app would only guess. A looks-wrong check's fix (the opp's close quarter, the opps'
 * account id) is its suggestion too.
 */
import type { VdpStep, VdpSuggestion } from '@/contract';
import { VDP_FIELD_LABEL } from '@/lib/vdp/payload';
import type { VdpStakeholder, VdpUseCase } from '@/lib/vdp/types';

import { nextPeriod, periodRank, sfFiscalPeriod } from './gaps';

export interface SuggestContext {
  /** The use case the item is about (update_use_case), if any. */
  useCase?: Pick<VdpUseCase, 'priority' | 'persona' | 'division' | 'title'> | null;
  stakeholders: ReadonlyArray<Pick<VdpStakeholder, 'name' | 'title'>>;
  /** The VDP's linked opps (open ones count for the priority). */
  opps: ReadonlyArray<{ name: string; isOpen: boolean; closeDate: string | null }>;
  companyName: string;
  now: string;
}

const SENIOR = /\b(chief|cio|cto|cdo|cmo|cfo|coo|ceo|ciso|cdao|cro|svp|evp|vp|vice president|head of|director|general manager)\b/i;

/** "VP of Marketing" → "Marketing"; "Head of Data & Analytics" → "Data & Analytics"; else null. */
export function divisionOfTitle(title: string): string | null {
  const m = /\b(?:of|for)\s+([A-Za-z][A-Za-z&/,' -]{1,48})$/i.exec(title.trim());
  const d = m?.[1]?.replace(/[,\s]+$/, '').trim();
  return d && d.length >= 2 ? d : null;
}

/** The priority from the earliest open linked opp's close quarter, and why. */
export function priorityFromOpps(opps: SuggestContext['opps'], now: string): { value: string; why: string } | null {
  const open = opps.filter((o) => o.isOpen && o.closeDate).sort((a, b) => a.closeDate!.localeCompare(b.closeDate!));
  const o = open[0];
  const cur = sfFiscalPeriod(now);
  const p = o ? sfFiscalPeriod(o.closeDate!) : null;
  if (!o || !p || !cur) return null;
  const label = `FY${String(p.fiscalYear).padStart(2, '0')} Q${p.fiscalQuarter}`;
  if (periodRank(p) <= periodRank(cur)) return { value: '3 - High', why: `${o.name} closes this quarter (${label})` };
  if (periodRank(p) === periodRank(nextPeriod(cur))) return { value: '2 - Medium', why: `${o.name} closes next quarter (${label})` };
  return { value: '1 - Low', why: `${o.name} closes later (${label})` };
}

/** The one senior stakeholder title on the VDP (and who holds it), when exactly one distinct title is senior. */
export function seniorStakeholder(list: SuggestContext['stakeholders']): { name: string; title: string } | null {
  const senior = list.filter((s) => s.title && SENIOR.test(s.title));
  const titles = [...new Set(senior.map((s) => s.title!.trim()))];
  return titles.length === 1 ? { name: senior[0]!.name, title: titles[0]! } : null;
}

const shown = (field: string, v: string) => `${VDP_FIELD_LABEL[field] ?? field} = ${v}`;

function make(values: Record<string, string>, basis: string[]): VdpSuggestion | null {
  const keys = Object.keys(values);
  if (!keys.length) return null;
  return { values, line: keys.map((k) => shown(k, values[k]!)).join(' · '), basis, by: 'rules' };
}

/** A new use case's title from the opp's name, without the account's ("Acme - Data Cloud" → "Data Cloud"). */
export function titleFromOpp(oppName: string, companyName: string): string | null {
  const esc = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const t = oppName.replace(new RegExp(`^\\s*${esc}\\s*[-–—:|·]*\\s*`, 'i'), '').trim();
  return t.length >= 3 ? t : null;
}

/** The suggestion for one item, or null when the app has nothing better than a guess. */
export function suggestionFor(step: Pick<VdpStep, 'apply' | 'check' | 'gaps' | 'kind'>, ctx: SuggestContext): VdpSuggestion | null {
  const a = step.apply;
  if (!a) return null;
  if (step.check === 'wrong') {
    const values: Record<string, string> = {};
    for (const f of a.fields) if (f.suggested !== null && f.suggested !== undefined) values[f.field] = Array.isArray(f.suggested) ? f.suggested.join(', ') : String(f.suggested);
    return make(values, [...new Set(step.gaps.map((g) => g.why).filter((x): x is string => !!x))]);
  }
  if (a.op === 'update_use_case') {
    const want = new Set(a.fields.map((f) => f.field));
    const values: Record<string, string> = {};
    const basis: string[] = [];
    if (want.has('priority')) {
      const p = priorityFromOpps(ctx.opps, ctx.now);
      if (p) {
        values.priority = p.value;
        basis.push(`Priority: ${p.why}`);
      }
    }
    const s = seniorStakeholder(ctx.stakeholders);
    if (s && want.has('persona')) {
      values.persona = s.title;
      basis.push(`Persona: the stakeholder ${s.name} is ${s.title}`);
    }
    const d = s ? divisionOfTitle(s.title) : null;
    if (d && want.has('division')) {
      values.division = d;
      basis.push(`Division: from ${s!.title}`);
    }
    return make(values, basis);
  }
  if (a.op === 'create_use_case') {
    const open = ctx.opps.filter((o) => o.isOpen);
    const t = open.length === 1 ? titleFromOpp(open[0]!.name, ctx.companyName) : null;
    const p = priorityFromOpps(ctx.opps, ctx.now);
    const values: Record<string, string> = {};
    const basis: string[] = [];
    if (t) {
      values.title = t;
      basis.push(`Title: the opportunity's name`);
    }
    if (t && p) {
      values.priority = p.value;
      basis.push(`Priority: ${p.why}`);
    }
    return make(values, basis);
  }
  return null;
}
