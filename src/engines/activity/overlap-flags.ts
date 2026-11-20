/**
 * The note an accepted meeting carries when it overlaps another accepted meeting that also logs (D-18 amended
 * 2026-11-11): "overlaps '<other>' 12:30–13:00 (both log)". Information, not a problem: it never makes a row need
 * input, and the Time page shows it muted, not as a warning (color is an indicator). Pure; shared with the UI.
 */
import { localHm } from './time';

export const OVERLAP_INFO_RE = /^overlaps '.*' \d{2}:\d{2}–\d{2}:\d{2} \(both log\)$/;

export const overlapInfo = (otherTitle: string, from: number, to: number, tz: string): string => `overlaps '${otherTitle}' ${localHm(from, tz)}–${localHm(to, tz)} (both log)`;

export const isOverlapInfo = (flag: string): boolean => OVERLAP_INFO_RE.test(flag);
