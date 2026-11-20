/** Time blocks (engaged time, never run time): calendar, Claude segments, Drive edits, Slack bursts, onsite/travel, manual and estimated. */
import { NOW, OWNER, readTable, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import { mtDay, plusMin, T } from './outbox-lib';
import type { SessionBuild } from './outbox-sessions';

type Raw = { source: string; start: string; end: string; attention: string; prec: number; dedupe: string; src?: string | null; cal?: string | null; seg?: string | null; asset?: string | null; repo?: string | null; acct?: string | null; opp?: string | null; method?: string | null; conf?: number | null; counts?: boolean; tag: string };
const ms = (iso: string) => new Date(iso).getTime();
const ENGINE = 'time-engine@1.6.0';

export type BlockBuild = { blocks: Row[]; byTag: Map<string, string[]>; byCal: Map<string, string[]> };

export function buildBlocks(sb: SessionBuild, forceCal: Set<string>, extraManual: Array<{ tag: string; source: 'manual' | 'estimate'; start: string; end: string; acct?: string; opp?: string; asset?: string }>): BlockBuild {
  const raws: Raw[] = [];
  const ce = readTable('calendar_events');
  const nowMs = ms(NOW);
  // calendar blocks: attended meetings, my accepted focus blocks and standups that already happened; future onsite and travel as planned blocks
  for (const e of ce) {
    if (e.status === 'cancelled' || e.is_all_day || e.my_response === 'declined') continue;
    const s = e.starts_at as string; const en = e.ends_at as string;
    const title = String(e.title); const type = String(e.event_type);
    if (type === 'out_of_office' || type === 'working_location') continue;
    const past = ms(en) <= nowMs;
    const isOnsite = /^Cascadia onsite workshop/.test(title); const isTravel = /^Travel:/.test(title);
    const counts = e.attendance === 'attended' || (past && type === 'focus_time' && e.my_response === 'accepted') || (past && title === 'SE team standup' && e.my_response === 'accepted');
    if (!counts && !(isOnsite || isTravel) && !forceCal.has(e.id as string)) continue;
    raws.push({
      source: isOnsite ? 'onsite' : isTravel ? 'travel' : 'calendar', start: s, end: en, attention: type === 'focus_time' ? 'focused' : isTravel ? 'ambient' : 'meeting', prec: type === 'focus_time' ? 20 : 30,
      dedupe: `cal|${e.calendar_id}|${e.external_event_id}|${s}`, src: e.source_item_id as string, cal: e.id as string, acct: e.account_id as string | null, opp: e.opportunity_id as string | null,
      method: e.mapping_method as string | null, conf: e.mapping_confidence as number | null, tag: `cal:${e.id}`,
    });
  }
  // Claude: hands-on per segment (engaged windows); background agents and scheduled runs as overlays that never count
  for (const [key, s] of sb.byKey) {
    const scheduled = s.row.entrypoint === 'scheduled_task';
    s.segs.forEach((g, i) => {
      if (!scheduled) raws.push({ source: 'claude_hands_on', start: g.started_at as string, end: g.ended_at as string, attention: 'focused', prec: 20, dedupe: `claude|${s.row.session_external_id}|${i + 1}`, seg: g.id as string, repo: s.row.repo_id as string, acct: g.account_id as string | null, opp: g.opportunity_id as string | null, method: g.mapping_method as string | null, conf: g.mapping_confidence as number | null, tag: `seg:${key}:${i + 1}` });
      if ((g.background_ms as number) > 0 || scheduled) {
        const dur = Math.max(1, Math.round(((g.background_ms as number) || (g.active_ms as number)) / 60000));
        raws.push({ source: 'claude_background', start: g.started_at as string, end: plusMin(g.started_at as string, dur), attention: 'background', prec: 5, dedupe: `claude-bg|${s.row.session_external_id}|${i + 1}`, seg: g.id as string, repo: s.row.repo_id as string, acct: g.account_id as string | null, opp: g.opportunity_id as string | null, counts: false, tag: `bg:${key}:${i + 1}` });
      }
    });
  }
  // Drive edits by the owner with a real timestamp: 30 minutes of editing up to the revision
  const sis = readTable('source_items'); const assets = new Map(readTable('assets').map((a) => [a.id as string, a]));
  const owner = uid('people', 'owner');
  for (const s of sis) {
    if (s.source !== 'drive' || s.actor_person_id !== owner) continue;
    const t = s.occurred_at as string; const hhmm = new Date(ms(t) - 7 * 3600_000).toISOString().slice(11, 16);
    if (hhmm === '11:00') continue;
    if (ms(t) > nowMs) continue;
    const a = assets.get(s.asset_id as string);
    raws.push({ source: 'doc_edit', start: plusMin(t, -30), end: t, attention: 'focused', prec: 20, dedupe: `drive|${(s.meta as Record<string, unknown>).fileId}|${t}`, src: s.id as string, asset: s.asset_id as string, acct: (a?.account_id as string) ?? null, opp: (a?.opportunity_id as string) ?? null, method: (a?.mapping_method as string) ?? null, conf: (a?.mapping_confidence as number) ?? null, tag: `doc:${(s.meta as Record<string, unknown>).fileId}:${t}` });
  }
  // Slack bursts: messages I wrote within 25 minutes of each other
  const mine = sis.filter((s) => s.source === 'slack' && s.from_me).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  let cur: Row[] = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0]!; const last = cur[cur.length - 1]!;
    raws.push({ source: 'slack_burst', start: plusMin(first.occurred_at as string, -4), end: plusMin(last.occurred_at as string, 2), attention: 'ambient', prec: 10, dedupe: `slack|${first.external_id}`, src: first.id as string, tag: `slack:${first.external_id}` });
    cur = [];
  };
  for (const m of mine) { if (cur.length && ms(m.occurred_at as string) - ms(cur[cur.length - 1]!.occurred_at as string) > 25 * 60_000) flush(); cur.push(m); }
  flush();
  // manual and estimated blocks
  for (const x of extraManual) raws.push({ source: x.source, start: x.start, end: x.end, attention: 'focused', prec: x.source === 'manual' ? 20 : 15, dedupe: `${x.source}|${x.tag}`, acct: x.acct ? uid('accounts', x.acct) : null, opp: x.opp ? uid('opportunities', x.opp) : null, asset: x.asset ? uid('assets', x.asset) : null, tag: `x:${x.tag}` });

  // precedence: a lower block is clipped around higher blocks; the overlapped part stays as an overlay that is shown and never counted
  raws.sort((a, b) => b.prec - a.prec || ms(a.start) - ms(b.start));
  const occupied: Array<[number, number]> = [];
  const blocks: Row[] = []; const byTag = new Map<string, string[]>(); const byCal = new Map<string, string[]>();
  const pieces = (s0: number, e0: number, occ: Array<[number, number]>) => {
    const clear: Array<[number, number]> = []; const over: Array<[number, number]> = [];
    let cursor = s0; const sorted = occ.filter(([a, b]) => b > s0 && a < e0).sort((x, y) => x[0] - y[0]);
    for (const [a, b] of sorted) { if (a > cursor) clear.push([cursor, Math.min(a, e0)]); const oa = Math.max(a, cursor, s0); const ob = Math.min(b, e0); if (ob > oa) over.push([oa, ob]); cursor = Math.max(cursor, b); if (cursor >= e0) break; }
    if (cursor < e0) clear.push([cursor, e0]);
    return { clear: clear.filter(([a, b]) => b - a >= 60_000), over: over.filter(([a, b]) => b - a >= 60_000) };
  };
  for (const r of raws) {
    const s0 = ms(r.start); const e0 = ms(r.end);
    const noOcc = r.source === 'claude_background' || r.source === 'onsite' || r.source === 'travel';
    const { clear, over } = noOcc ? { clear: r.source === 'claude_background' ? [] as Array<[number, number]> : [[s0, e0]] as Array<[number, number]>, over: r.source === 'claude_background' ? ([[s0, e0]] as Array<[number, number]>) : [] } : pieces(s0, e0, occupied);
    const emit = (a: number, b: number, overlay: boolean, suffix: string) => {
      const start = new Date(a).toISOString(); const end = new Date(b).toISOString();
      const id = uid('time_blocks', r.dedupe + suffix);
      blocks.push({
        id, owner_user_id: OWNER, source: r.source, starts_at: start, ends_at: end, local_day: mtDay(start), attention: r.attention, counts_as_human_hours: !overlay && r.source !== 'claude_background', precedence: r.prec, is_overlay: overlay,
        source_item_id: r.src ?? null, calendar_event_id: r.cal ?? null, claude_session_segment_id: r.seg ?? null, asset_id: r.asset ?? null, repo_id: r.repo ?? null, account_id: r.acct ?? null, opportunity_id: r.opp ?? null,
        mapping_method: r.method ?? null, mapping_confidence: r.conf ?? null, dedupe_key: r.dedupe + suffix, engine_version: ENGINE, created_at: plusMin(end, 20), updated_at: plusMin(end, 20),
      });
      const arr = byTag.get(r.tag) ?? []; arr.push(id); byTag.set(r.tag, arr);
      if (r.cal) { const c = byCal.get(r.cal) ?? []; c.push(id); byCal.set(r.cal, c); }
    };
    clear.forEach(([a, b], i) => { emit(a, b, false, clear.length > 1 || over.length ? `|p${i + 1}` : ''); });
    over.forEach(([a, b], i) => { emit(a, b, true, `|ov${i + 1}`); });
    if (r.source !== 'claude_background' && !noOcc) occupied.push([s0, e0]);
    else if (r.source === 'onsite' || r.source === 'travel') occupied.push([s0, e0]);
  }
  void T;
  blocks.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  return { blocks, byTag, byCal };
}
