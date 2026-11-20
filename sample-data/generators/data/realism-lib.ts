/** Shared helpers for the 92-realism post-pass (item numbers in the comments refer to the realism review). */
import { NOW, OWNER, sha, readTable, writeTable, uid, type Row } from '../../lib/kit';

export { NOW, OWNER, sha, readTable, writeTable, uid };
export type { Row };
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const ms = (iso: unknown) => new Date(String(iso)).getTime();
export const iso = (t: number) => new Date(t).toISOString();
export const plus = (i: unknown, m: number) => iso(ms(i) + m * MIN);
export const maxIso = (...xs: Array<unknown>) => xs.filter(Boolean).map(String).reduce((a, b) => (a > b ? a : b));
/** 'MM-DD HH:MM[:SS]' in Mountain Standard Time (UTC-7) → ISO UTC. The year is 2026 (Oct/Nov) */
export const mt = (md: string, hhmm = '09:00') => {
  const [m, d] = md.split('-').map(Number); const [h, mi, s] = hhmm.split(':').map(Number);
  return iso(Date.UTC(2026, m! - 1, d, h! + 7, mi ?? 0, s ?? 0));
};
export const maxId = (rows: Row[]) => rows.reduce((m, r) => Math.max(m, Number(r.id)), 0);
export const sha256 = sha;
export const byId = <T extends Row>(rows: T[]) => new Map(rows.map((r) => [String(r.id), r]));
