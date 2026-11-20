/** Tiny zone-aware formatters (pure). Same output as `@/ui` fmtClock / fmtDay; kept here so pure modules stay React-free. */
export function fmtClockIn(at: string | Date, tz?: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
}

export function fmtDayIn(at: string | Date, tz?: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d);
}
