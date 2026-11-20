/** Display formatters for Deals (pure). */

/** 516000 → "$516k", 1250000 → "$1.25M", null → "—". */
export function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  // Whole millions from $10M up; below that two decimals, trailing zeros dropped. Never strip a whole number's zeros
  // ($50M, not "$5M": the stage-1 Deals header).
  if (abs >= 1_000_000) return `$${abs >= 10_000_000 ? Math.round(n / 1_000_000) : (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

/** "2027-01-15" → "15 Jan 2027" (calendar day, no timezone shift). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Whole days from `today` to `iso` (negative = past). Both are calendar days. */
export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/** "in 12d" / "3d ago" / "today". */
export function fmtRelativeDay(iso: string | null | undefined, today: string): string {
  if (!iso) return '';
  const n = daysUntil(iso, today);
  if (n === 0) return 'today';
  return n > 0 ? `in ${n}d` : `${-n}d ago`;
}

export function fmtHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** The calendar day (YYYY-MM-DD) of an instant in a zone. */
export function dayOf(instant: Date | string, timeZone?: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(d);
}
