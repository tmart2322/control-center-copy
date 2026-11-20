/**
 * Display formatting for chat: times in the profile timezone (CONTRACT: never the browser's), and receipt /
 * proposal values as short before → after strings.
 */
import type { FieldChange, ReceiptChange } from '@/contract';

export function fmtTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
}

function dayKey(d: Date, tz?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "09:30" today, "Thu 14:00" another day. */
export function fmtWhen(iso: string, tz?: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (dayKey(d, tz) === dayKey(now, tz)) return fmtTime(iso, tz);
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d);
  return `${wd} ${fmtTime(iso, tz)}`;
}

export function fmtDate(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(new Date(iso));
}

/** "Thu 5 Nov" (thread titles and day separators). */
export function fmtDay(iso: string | Date, tz?: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Thursday 5 November". */
export function fmtDayLong(iso: string, tz?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** Thread label: the default thread reads "Today · Thu 5 Nov". */
export function threadTitle(t: { title: string; isDefault: boolean } | null | undefined, now: Date, tz?: string): string {
  if (!t) return 'Assistant';
  return t.isDefault ? `Today · ${fmtDay(now, tz)}` : t.title;
}

/** "08:24" today, "Wed" this week, "29 Oct" before. */
export function fmtAgoShort(iso: string, now: Date, tz?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  const key = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  if (key(d) === key(now)) return fmtTime(iso, tz);
  if (days < 6.5) return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month}`;
}

const FIELD_LABEL: Record<string, string> = {
  rank: 'Rank',
  startBy: 'Start by',
  due: 'Due',
  notes: 'Note',
  signals: 'Boost',
  state: 'State',
  snoozedUntil: 'Snoozed until',
  title: 'Title',
  purpose: 'Purpose',
  effort: 'Estimate',
  initiativeId: 'Initiative',
  accountId: 'Account',
  oppId: 'Opportunity',
  kind: 'Kind',
  policy: 'Policy',
  weights: 'Weights',
  version: 'Version',
};

const WEIGHT_LABEL: Record<string, string> = {
  customer_facing: 'Customer-facing weight',
  meeting_proximity: 'Meeting-soon weight',
  due_urgency: 'Due-soon weight',
  manager_ask: 'Manager-ask weight',
  deal_value: 'Deal-value weight',
  lead_time: 'Lead-time weight',
  age: 'Age weight',
  effort_fit: 'Quick-win weight',
};

const sentence = (s: string) => s.replace(/[_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

export function fieldLabel(field: string, label?: string): string {
  if (field.startsWith('weights.')) return WEIGHT_LABEL[field.slice(8)] ?? sentence(field.slice(8));
  if (label) return label.length > 2 && label === label.toLowerCase() ? sentence(label) : label;
  return FIELD_LABEL[field] ?? sentence(field);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const clip = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const minutes = (n: number) => (n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? String(n % 60).padStart(2, '0') + 'm' : ''}`);

function scalar(field: string, v: unknown, tz?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'rank' && typeof v === 'number') return `#${v}`;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'string') {
    if (ISO.test(v)) return fmtWhen(v, tz);
    if (field === 'state' || field === 'kind') return sentence(v);
    return clip(v.replace(/\s+/g, ' '));
  }
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('youMin' in o || 'agentMin' in o) return `you ${minutes(Number(o.youMin ?? 0))} · agent ${o.agentMin ? minutes(Number(o.agentMin)) : '—'}`;
    // A versioned record (a policy): its name and version, not every field.
    if ('version' in o && typeof o.name === 'string') return clip(`${o.name} v${String(o.version)}`);
    return clip(Object.entries(o).map(([k, x]) => `${sentence(k).toLowerCase()} ${scalar(k, x, tz)}`).join(', '));
  }
  return clip(String(v));
}

/** Before → after strings for one change, showing only what actually differs. */
export function formatChange(change: Pick<FieldChange, 'field' | 'before' | 'after'>, tz?: string): { before: string; after: string } {
  const { field, before, after } = change;
  // Appended text (notes): show the addition, not two near-identical paragraphs.
  if (typeof before === 'string' && typeof after === 'string' && !ISO.test(after)) {
    if (after.startsWith(before) && after.length > before.length) {
      const added = after.slice(before.length).replace(/^\s+/, '');
      return { before: before ? `…${clip(before.split('\n').at(-1) ?? '', 28).replace(/^…/, '')}` : '—', after: `+ ${clip(added, 72)}` };
    }
    if (before.startsWith(after) && before.length > after.length) {
      return { before: `+ ${clip(before.slice(after.length).replace(/^\s+/, ''), 72)}`, after: after ? 'removed' : '—' };
    }
  }
  // Objects (signals): only the keys that changed.
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    if (keys.length === 1 && !('youMin' in a)) return { before: scalar(keys[0], b[keys[0]], tz), after: scalar(keys[0], a[keys[0]], tz) };
    if (keys.length && keys.length <= 3 && !('youMin' in a)) {
      return {
        before: keys.map((k) => `${sentence(k).toLowerCase()} ${scalar(k, b[k], tz)}`).join(', '),
        after: keys.map((k) => `${sentence(k).toLowerCase()} ${scalar(k, a[k], tz)}`).join(', '),
      };
    }
  }
  return { before: scalar(field, before, tz), after: scalar(field, after, tz) };
}

/** FE-1b ReceiptCard line shape ({label, before, after, auditId}) plus what the chat card also shows. */
export interface ReceiptLine {
  key: string;
  auditId: string;
  label: string;
  before: string;
  after: string;
  entityLabel: string;
  entityHref?: string;
  field: string;
}

export function receiptLines(changes: ReceiptChange[], tz?: string): ReceiptLine[] {
  return changes.map((c, i) => {
    const v = formatChange(c, tz);
    return { key: `${c.auditId}:${c.entity.id}:${c.field}:${i}`, auditId: c.auditId, label: fieldLabel(c.field, c.label), before: v.before, after: v.after, entityLabel: c.entity.label, entityHref: c.entity.href, field: c.field };
  });
}

/** Order lines so the entity the receipt is about comes first and knock-on re-ranks trail. */
export function sortReceiptLines(lines: ReceiptLine[]): ReceiptLine[] {
  const primary = lines.find((l) => l.field !== 'rank')?.entityLabel ?? lines[0]?.entityLabel;
  return [...lines].sort((a, b) => Number(b.entityLabel === primary) - Number(a.entityLabel === primary) || Number(a.field === 'rank') - Number(b.field === 'rank'));
}
