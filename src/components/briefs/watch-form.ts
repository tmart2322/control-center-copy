/**
 * Watch form rules (pure): what the user typed becomes the stored `target` + `label`, and when Save is
 * allowed. Kept apart from the sheet so it is unit-tested.
 */
import type { WatchSubscription } from '@/contract';

export type WatchKind = WatchSubscription['targetKind'];
export type WatchCadence = WatchSubscription['cadence'];
export type WatchStyle = WatchSubscription['style'];

export interface WatchDraft {
  targetKind: WatchKind;
  target: string;
  label: string;
  cadence: WatchCadence;
  style: WatchStyle;
  enabled: boolean;
}

export const BLANK_WATCH: WatchDraft = { targetKind: 'channel', target: '', label: '', cadence: 'daily_0730', style: 'brief', enabled: true };

export const CADENCE_LABEL: Record<WatchCadence, string> = {
  daily_0730: 'Daily 7:30',
  every_4h: 'Every 4 h',
  since_last_open: 'Since last open',
};

export const cadenceLabel = (c: WatchCadence): string => CADENCE_LABEL[c] ?? c;

export function watchToDraft(w: WatchSubscription): WatchDraft {
  return { targetKind: w.targetKind, target: w.target, label: w.label, cadence: w.cadence, style: w.style, enabled: w.enabled };
}

/** The stored target and label for what was typed. Null while the form isn't valid (Save stays disabled). */
export function normaliseWatch(d: Pick<WatchDraft, 'targetKind' | 'target' | 'label'>, accountName?: string): { target: string; label: string } | null {
  const raw = d.target.trim();
  if (!raw) return null;
  switch (d.targetKind) {
    case 'channel': {
      const name = raw.replace(/^#+/, '').trim();
      return name ? { target: `#${name}`, label: `#${name}` } : null;
    }
    case 'account':
      return { target: raw, label: accountName ?? (d.label || raw) };
    default:
      return { target: raw, label: raw };
  }
}
