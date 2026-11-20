import { oneLine } from './budget';
import { redactSecrets } from './redact';
import type { PersonInput } from './types';

/** Shared rendering helpers for prompt context lines. */

export function clean(text: string | undefined, max = 600): string {
  if (!text) return '';
  return oneLine(redactSecrets(text).text, max);
}

export function person(p: PersonInput | undefined): string {
  if (!p) return 'unknown';
  const bits: string[] = [];
  if (p.role) bits.push(p.role);
  if (p.isMe) bits.push('me');
  if (p.isExternal) bits.push('external');
  if (p.slackId) bits.push(`slack:${p.slackId}`);
  if (p.email) bits.push(`email:${p.email}`);
  return bits.length ? `${p.name} (${bits.join(', ')})` : p.name;
}

/** "Thu 2026-11-05 09:12 MST" in the user's zone, so the model never has to do zone math. */
export function localStamp(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('weekday')} ${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')} ${get('timeZoneName')}`;
}

export function ageDays(fromIso: string, nowIso: string): number {
  const ms = new Date(nowIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function minutesBetween(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60_000);
}
