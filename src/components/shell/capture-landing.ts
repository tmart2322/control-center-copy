/**
 * 2026-11-13 audit C8: Capture's toast says where the item landed (it always said "Added to Today", even for a to-do
 * with no date, which Today never shows). Home and Today show work due or starting today; Think ahead the next 14
 * days; everything else open is in Work ▸ All open. Pure.
 */
import type { WorkItem } from '@/contract';

const dayIn = (iso: string, tz?: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const label = (iso: string, tz?: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));

export function captureLanding(item: Pick<WorkItem, 'due' | 'startBy'> & { refs?: { account: { label?: string | null } | null } }, nowIso: string, tz?: string): string {
  const today = dayIn(nowIso, tz);
  const when = item.startBy && (!item.due || item.startBy < item.due) ? item.startBy : item.due;
  const account = item.refs?.account?.label ? ` · on ${item.refs.account.label}` : '';
  if (!when) return `Added to Work ▸ All open (no date, so not on Today)${account}`;
  const day = dayIn(when, tz);
  if (day <= today) return `Added to Today${account}`;
  const days = (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
  return days <= 14 ? `Added to Think ahead, ${item.startBy === when ? 'start by' : 'due'} ${label(when, tz)}${account}` : `Added to Work ▸ All open, ${item.startBy === when ? 'start by' : 'due'} ${label(when, tz)}${account}`;
}
