/** Human formatting of before/after values in diffs and receipts. */
import { clock, dayLabel, sameDay } from './lib/time';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fmtValue(v: unknown, opts: { now?: string; tz?: string } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof v === 'string') {
    if (ISO_RE.test(v)) {
      const t = clock(v, opts.tz);
      return opts.now && sameDay(v, opts.now, opts.tz) ? t : `${dayLabel(v, opts.tz)} ${t}`;
    }
    if (DATE_RE.test(v)) return dayLabel(`${v}T12:00:00Z`, 'UTC');
    return v.replace(/_/g, ' ');
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtValue(x, opts)).join(', ') : '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.label === 'string') return o.label;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.youMin === 'number') return `you ${o.youMin}m · agent ${o.agentMin ?? 0}m`;
    return JSON.stringify(v);
  }
  return String(v);
}
