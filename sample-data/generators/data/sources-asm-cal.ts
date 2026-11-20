/** Domain 02 assembly: calendar events, attendees, calendar source items, Gemini notes (items, meeting_notes, note docs). */
import { OWNER, day, rng } from '../../lib/kit';
import { EVENTS, EXT, NOTES, evTag, type EvDef, type Resp } from './sources-cal';
import { ASSETS, KIND_OF, type AssetDef } from './sources-drive';
import { CAL_ID, D, FIRST, NAME, OWNER_EMAIL, P, T_NOW, T_SCAN_END, T_START, aid, addItem, addMinutes, at, fid, oid, pid, sha, uid, type Item, type LinkSpec } from './sources-lib';

type Row = Record<string, unknown>;
export type AttInfo = { key: string | null; email: string; name: string; optional: boolean; organizer: boolean; self: boolean; resp: Resp; external: boolean; domain: string };
export type EvI = { def: EvDef; id: string; extId: string; recId: string | null; start: string; end: string; atts: AttInfo[]; itemTag: string; noteKey?: string; noteDocTag?: string; attendance: string; attSource: string; attConf: number | null; actualStart: string | null; actualEnd: string | null };
export const EVI: EvI[] = [];
export const EVI_BY_TAG: Record<string, EvI> = {};
const iso8 = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const fmtMst = (iso: string) => {
  const dt = new Date(Date.parse(iso) - 7 * 3600_000);
  return `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')} ${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')} MST`;
};
const pickResp = (tag: string, key: string, past: boolean, external: boolean): Resp => {
  const r = rng(`resp:${tag}:${key}`).next();
  const t = external ? (past ? [0.75, 0.9, 0.96] : [0.45, 0.9, 0.97]) : past ? [0.8, 0.92, 0.96] : [0.6, 0.9, 0.95];
  return r < t[0]! ? 'accepted' : r < t[1]! ? 'needs_action' : r < t[2]! ? 'tentative' : 'declined';
};
export const noteDocId = (key: string) => `smplgn${sha(key).slice(0, 10)}`;
export const noteAssets: AssetDef[] = [];
export const NOTE_INFO: Array<{ key: string; itemTag: string; evi: EvI | null; title: string; docId: string; arrived: string; end: string; stepCount: number; mine: number; assetTag: string }> = [];

export function assembleCalendar(): void {
  for (const def of EVENTS) {
    const allDay = !!def.allDay;
    const start = at(def.d, def.t.length === 5 ? def.t + ':00' : def.t);
    const end = allDay ? at(def.d + 1, '00:00') : addMinutes(start, def.dur);
    const past = Date.parse(end) <= Date.parse(T_NOW);
    const extId = def.series ? `smplser${def.series.replace(/[^a-z0-9]/g, '')}_${iso8(start)}` : `smplevt${def.tag.replace(/[^a-z0-9]/g, '')}`;
    const atts: AttInfo[] = [];
    const orgKey = def.org;
    const push = (key: string | null, email: string, name: string, o: Partial<AttInfo>) => {
      if (atts.some((a) => a.email === email)) return;
      const domain = email.split('@')[1]!;
      const external = domain !== 'example.com';
      atts.push({ key, email, name, optional: false, organizer: false, self: false, resp: 'accepted', external, domain, ...o });
    };
    push(orgKey, P[orgKey]!.email, NAME(orgKey), { organizer: true, self: orgKey === 'owner', resp: orgKey === 'owner' ? def.my ?? 'accepted' : 'accepted' });
    if (orgKey !== 'owner') push('owner', OWNER_EMAIL, NAME('owner'), { self: true, resp: def.my ?? 'accepted' });
    else if (!atts.some((a) => a.self)) atts[0]!.self = true;
    for (const k of def.att) push(k, P[k]!.email, NAME(k), { resp: def.resp?.[k] ?? pickResp(def.tag, k, past, P[k]!.aff !== 'internal') });
    for (const k of def.opt ?? []) push(k, P[k]!.email, NAME(k), { optional: true, resp: def.resp?.[k] ?? pickResp(def.tag, k, past, P[k]!.aff !== 'internal') });
    for (const k of def.ext ?? []) push(null, EXT[k]!.email, EXT[k]!.name, { resp: pickResp(def.tag, k, past, true) });
    EVI.push({ def, id: uid('calendar_events', def.tag), extId, recId: def.series ? `smplser${def.series.replace(/[^a-z0-9]/g, '')}` : null, start, end, atts, itemTag: `cal-${def.tag}`, attendance: 'unknown', attSource: 'calendar_inference', attConf: null, actualStart: null, actualEnd: null });
    EVI_BY_TAG[def.tag] = EVI[EVI.length - 1]!;
  }

  // ── notes: link to events, decide attendance ──
  for (const n of NOTES) {
    if (n.ev) {
      const e = EVI_BY_TAG[n.ev];
      if (!e) throw new Error(`note ${n.key}: unknown event ${n.ev}`);
      e.noteKey = n.key;
      e.noteDocTag = `gn-${n.key}`;
    }
  }
  // attendance + actuals
  for (const e of EVI) {
    const d = e.def;
    const past = Date.parse(e.end) <= Date.parse(T_NOW);
    const r = rng(`att:${d.tag}`);
    let a: string;
    if (d.status === 'cancelled' || d.allDay && d.type !== 'default' && d.type !== undefined) a = 'not_applicable';
    else if (!past) a = d.type && d.type !== 'default' ? 'unknown' : 'unknown';
    else if (d.attendance) a = d.attendance;
    else if (d.my === 'declined') a = 'not_applicable';
    else if (d.type && d.type !== 'default') a = 'not_applicable';
    else a = e.noteKey ? 'attended' : r.chance(0.88) ? 'attended' : 'unknown';
    if (d.my === 'declined' && !d.attendance) a = past ? 'not_applicable' : 'unknown';
    e.attendance = a;
    e.attSource = e.noteKey ? 'notes_attendees' : 'calendar_inference';
    e.attConf = a === 'unknown' ? null : e.noteKey ? 0.95 : Math.round((0.6 + r.next() * 0.25) * 100) / 100;
    if (e.noteKey && past) {
      const note = NOTES.find((n) => n.key === e.noteKey)!;
      e.actualStart = addMinutes(e.start, r.int(0, 3));
      e.actualEnd = addMinutes(e.actualStart, Math.round((note.dur ?? (d.dur - r.int(0, 8)) * 60) / 60));
    }
  }
  // user-corrected attendance on one event (storyline: attendance source "user")
  const q = EVI_BY_TAG[evTag('to-sync', -13)];
  if (q) { q.attSource = 'user'; q.attConf = 1; }

  // ── overlaps (accepted default events) ──
  const live = EVI.filter((e) => !e.def.allDay && e.def.status !== 'cancelled' && e.def.my !== 'declined' && (e.def.type ?? 'default') === 'default');
  const overlap = (e: EvI) => live.filter((o) => o !== e && Date.parse(o.start) < Date.parse(e.end) && Date.parse(e.start) < Date.parse(o.end)).map((o) => o.extId);

  // ── calendar source items ──
  for (const e of EVI) {
    const d = e.def;
    const r = rng(`calitem:${d.tag}`);
    const org = P[d.org]!;
    const meetUrl = d.meet ? `https://meet.example.com/smpl-${sha(d.tag).slice(0, 3)}-${sha(d.tag).slice(3, 7)}-${sha(d.tag).slice(7, 10)}` : null;
    const attachments = [
      ...(d.attach ?? []).map((t) => ({ fileId: fid(t), mimeType: KIND_OF[t] === 'deck' ? 'application/vnd.google-apps.presentation' : KIND_OF[t] === 'sheet' ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document', title: ASSETS.find((a) => a.tag === t)!.title })),
      ...(e.noteKey ? [{ fileId: noteDocId(e.noteKey), mimeType: 'application/vnd.google-apps.document', title: 'Notes by Gemini' }] : []),
    ];
    const ended = Date.parse(e.end) <= Date.parse(T_NOW);
    const hints: string[] = [];
    if (ended && e.noteKey) hints.push('notes-poll');
    if (e.attendance === 'missed') hints.push('missed-meeting');
    const ext = e.atts.some((a) => a.external);
    const body = [d.desc, meetUrl ? `Join: ${meetUrl}` : null].filter(Boolean).join('\n\n') || null;
    const meta: Record<string, unknown> = {
      connector: 'calendar',
      itemKind: 'calendar_event',
      eventId: e.extId,
      start: e.start,
      end: e.end,
      allDay: !!d.allDay,
      status: d.status ?? 'confirmed',
      ...(d.loc ? { location: d.loc } : {}),
      ...(meetUrl ? { meetingLink: meetUrl, conferencing: 'meet' } : {}),
      organizerEmail: org.email,
      iAmOrganizer: d.org === 'owner',
      author: { name: org.name, email: org.email, isMe: d.org === 'owner' },
      attendeeCount: e.atts.length,
      external: ext,
      participants: e.atts.map((a) => ({ email: a.email, isExternal: a.external, isMe: a.self })),
      responses: e.atts.slice(0, 15).map((a) => ({ email: a.email, response: a.resp, optional: a.optional, organizer: a.organizer })),
      myResponse: d.my ?? 'accepted',
      attachments,
      ...(attachments.length ? { fileRefs: attachments.map((x) => x.fileId) } : {}),
      ...(e.noteKey ? { geminiNotesDocId: noteDocId(e.noteKey) } : {}),
      ended,
      ...(ended ? { minutesSinceEnd: Math.round((Date.parse(T_SCAN_END) - Date.parse(e.end)) / 60000) } : {}),
      attendance: e.attendance,
      attendanceReason: d.attReason ?? (e.noteKey ? 'Attended per Gemini notes participants' : e.attendance === 'attended' ? 'Accepted and no conflicting event' : e.attendance === 'not_applicable' ? 'Not a meeting I attend (focus, declined, or location)' : 'Not yet started'),
      ...(overlap(e).length ? { overlapWith: overlap(e) } : {}),
      hints,
      threadRef: `calendar:${e.extId}`,
    };
    // first seen: shortly after the event was created; series ones early
    const lead = d.series ? r.int(3, 9) * 1440 : r.int(1, 6) * 1440 + r.int(0, 600);
    const firstSeen = new Date(Math.min(Math.max(Date.parse(e.start) - lead * 60000, Date.parse(T_START) + 25 * 60000), Date.parse(T_SCAN_END) - 3 * 3600_000)).toISOString();
    const recent = Date.parse(e.start) > Date.parse(at(-7, '00:00'));
    const lastSeen = recent ? addMinutes(T_SCAN_END, -r.int(0, 240)) : addMinutes(e.end, r.int(60, 600));
    const rev = r.chance(0.16) ? r.int(2, 3) : 1;
    const cancelled = d.status === 'cancelled';
    const links: LinkSpec[] = [{ to: 'event', key: d.tag, role: 'about', method: 'connector', conf: 1 }];
    addItem({
      tag: e.itemTag,
      source: 'calendar',
      kind: 'calendar_event',
      connector: 'calendar',
      ext: e.extId,
      parent: e.recId,
      container: CAL_ID,
      dedupe: cancelled ? `cal:${e.extId}:cancelled` : `cal:${e.extId}`,
      occurred: e.start,
      srcUpdated: rev > 1 ? addMinutes(firstSeen, r.int(1, 4) * 1440) : null,
      firstSeen,
      lastSeen: Date.parse(lastSeen) < Date.parse(firstSeen) ? firstSeen : lastSeen,
      revision: rev,
      changedAt: rev > 1 ? addMinutes(firstSeen, r.int(1, 4) * 1440) : null,
      actor: d.org,
      actorExt: org.email,
      fromMe: d.org === 'owner',
      toMe: d.org !== 'owner' && (d.my ?? 'accepted') !== 'declined',
      title: d.title,
      url: `https://calendar.example.com/event?eid=${e.extId}`,
      body,
      meta,
      acct: d.acct,
      opp: d.opp,
      linkMethod: d.map,
      linkConf: d.conf,
      linkRule: d.rule,
      links,
      gist: d.gist ?? `${d.title}${cancelled ? ' (cancelled)' : ''} (${d.org === 'owner' ? 'I organize' : 'organizer ' + FIRST(d.org)})`,
      noise: d.series === 'standup' || d.series === 'weekly-log' || d.type === 'working_location' || d.type === 'out_of_office' || d.type === 'focus_time',
      deletedUpstream: d.tag === 'hv-prep-cancel' ? at(-8, '10:40') : null,
    });
  }

  // ── Gemini notes ──
  for (const n of NOTES) {
    const e = n.ev ? EVI_BY_TAG[n.ev]! : null;
    const rr = rng(`note:${n.key}`);
    const start = e ? e.start : at(n.d!, n.t! + ':00');
    const end = e ? e.end : addMinutes(start, Math.round((n.dur ?? 1800) / 60));
    const title0 = e ? e.def.title : n.title!;
    const title = `${title0} - ${fmtMst(start)} - Notes by Gemini`;
    const docId = noteDocId(n.key);
    const lag = n.lag ?? rr.int(6, 35);
    const arrived = addMinutes(end, lag);
    const firstSeen = addMinutes(arrived, rr.int(6, 18));
    const durSec = n.dur ?? (e ? (e.def.dur - rr.int(0, 6)) * 60 : 1800);
    const hh = String(Math.floor(durSec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((durSec % 3600) / 60)).padStart(2, '0');
    const ss = String(durSec % 60).padStart(2, '0');
    const nameOf = (k: string) => NAME(k);
    const steps = n.steps.map((s) => `- [${s.who.map(nameOf).join(', ')}] ${s.title}${s.due ? ` (${s.due})` : ''}`);
    const body = `# ${title}\n\n## Summary\n${n.summary}\n\n## Decisions\n${n.decisions.map((x) => `- ${x}`).join('\n')}\n\n## Suggested next steps\n${steps.join('\n')}\n\nTranscription ended after ${hh}:${mm}:${ss}`;
    const mine = n.steps.filter((s) => s.who.includes('owner')).length;
    const attendance = e ? e.attendance : 'attended';
    const meta: Record<string, unknown> = {
      connector: 'gemini_notes',
      itemKind: 'meeting_notes',
      ...(e ? { eventId: e.extId, eventStart: e.start, eventEnd: e.end, threadRef: `calendar:${e.extId}` } : { eventStart: start, eventEnd: end, threadRef: `gemini:${docId}` }),
      attendance,
      attendanceReason: e?.def.attReason ?? (attendance === 'missed' ? 'Declined the invite; notes arrived anyway' : 'Present in the Gemini participant list'),
      missedMeeting: attendance === 'missed',
      myResponse: e ? e.def.my ?? 'accepted' : 'accepted',
      notesAgeMinutes: Math.round((Date.parse(T_SCAN_END) - Date.parse(end)) / 60000),
      fileRefs: [docId],
      participants: e ? e.atts.filter((a) => a.resp !== 'declined').map((a) => ({ email: a.email, isExternal: a.external, isMe: a.self })) : [{ email: OWNER_EMAIL, isExternal: false, isMe: true }, ...n.steps.flatMap((s) => s.who).filter((k) => k !== 'owner' && P[k]).slice(0, 2).map((k) => ({ email: P[k]!.email, isExternal: P[k]!.aff !== 'internal', isMe: false }))],
      transcriptUrl: `https://docs.example.com/document/d/${docId}/edit?tab=t.transcript`,
    };
    const itemTag = `gn-${n.key}`;
    addItem({
      tag: itemTag,
      source: 'gemini_notes',
      kind: 'gemini_note',
      connector: 'gemini-notes',
      ext: docId,
      parent: e ? e.extId : null,
      container: 'drive',
      dedupe: `gemini:${docId}`,
      occurred: end,
      srcUpdated: arrived,
      firstSeen,
      lastSeen: addMinutes(firstSeen, rr.chance(0.5) ? rr.int(60, 3000) : 0),
      actor: e ? e.def.org : null,
      actorExt: e ? P[e.def.org]!.email : null,
      fromMe: false,
      toMe: !!e && e.def.my !== 'declined' || attendance === 'missed',
      title,
      url: `https://docs.example.com/document/d/${docId}/edit`,
      body,
      bodyFormat: 'markdown',
      meta,
      acct: e?.def.acct,
      opp: e?.def.opp,
      linkMethod: e?.def.rule?.startsWith('meet-') ? 'rule' : e?.def.map ?? 'llm',
      linkConf: e?.def.conf ?? 0.7,
      linkRule: e?.def.rule?.startsWith('meet-') ? e.def.rule : undefined,
      links: e ? [{ to: 'event', key: e.def.tag, role: 'about', method: 'connector', conf: 0.98 }] : [],
      asset: `gn-${n.key}`,
      gist: `Gemini notes: ${title0} (${fmtMst(start).slice(0, 10)}): ${n.steps.length} next steps, ${mine} for me${attendance === 'missed' ? '; I missed it' : ''}`,
    });
    noteAssets.push({ tag: `gn-${n.key}`, title, kind: 'doc', owner: e ? e.def.org : 'owner', mod: 0, by: e ? e.def.org : 'owner', modIso: arrived, createdIso: arrived, acct: e?.def.acct, opp: e?.def.opp, map: e ? 'rule' : undefined, conf: e ? 0.95 : undefined, fileId: docId, url: `https://docs.example.com/document/d/${docId}/edit`, mime: 'application/vnd.google-apps.document', system: 'drive' });
    KIND_OF[`gn-${n.key}`] = 'doc';
    NOTE_INFO.push({ key: n.key, itemTag, evi: e, title, docId, arrived, end, stepCount: n.steps.length, mine, assetTag: `gn-${n.key}` });
  }
}

/** Rows for calendar_events, calendar_event_attendees and meeting_notes (after source items are numbered). */
export function calendarRows(sid: (tag: string) => string): { events: Row[]; attendees: Row[]; notes: Row[] } {
  const events: Row[] = [];
  const attendees: Row[] = [];
  const notes: Row[] = [];
  for (const e of EVI) {
    const d = e.def;
    const org = P[d.org]!;
    const item = sidItem(e.itemTag);
    const extDomains = [...new Set(e.atts.filter((a) => a.external).map((a) => a.domain))].sort();
    events.push({
      id: e.id, owner_user_id: OWNER, connector_id: uid('connectors', 'calendar'), calendar_id: CAL_ID, external_event_id: e.extId, recurring_event_id: e.recId,
      ical_uid: `${e.extId}@example.com`, source_item_id: sid(e.itemTag), title: d.title, starts_at: e.start, ends_at: e.end, local_day: day(d.allDay ? d.d : d.d),
      is_all_day: !!d.allDay, timezone: 'America/Denver', event_type: d.type ?? 'default', status: d.status ?? 'confirmed', organizer_person_id: pid(d.org),
      i_am_organizer: d.org === 'owner', my_response: d.my ?? 'accepted', attendance: e.attendance, attendance_source: e.attendance === 'unknown' ? null : e.attSource,
      attendance_confidence: e.attConf, actual_started_at: e.actualStart, actual_ended_at: e.actualEnd, has_external_attendees: extDomains.length > 0, external_domains: extDomains,
      conference_url: d.meet ? ((item.meta as { meetingLink?: string }).meetingLink ?? null) : null, html_link: `https://calendar.example.com/event?eid=${e.extId}`,
      account_id: d.acct ? aid(d.acct) : null, opportunity_id: d.opp ? oid(d.opp) : null, mapping_method: d.acct ? d.map ?? 'llm' : null, mapping_confidence: d.acct ? d.conf ?? 0.8 : null,
      mapping_locked: !!d.locked, deleted_upstream_at: item.deletedUpstream ?? null, created_at: item.firstSeen, updated_at: item.lastSeen, location: d.loc ?? null,
    });
    void org;
    for (const a of e.atts) {
      attendees.push({
        id: uid('calendar_event_attendees', `${d.tag}:${a.email}`), calendar_event_id: e.id, person_id: a.key ? pid(a.key) : null, email: a.email, display_name: a.name,
        response_status: a.resp, is_organizer: a.organizer, is_optional: a.optional, is_self: a.self, is_external: a.external, domain: a.domain,
      });
    }
  }
  for (const n of NOTE_INFO) {
    const item = sidItem(n.itemTag);
    const nd = NOTES.find((x) => x.key === n.key)!;
    notes.push({
      id: uid('meeting_notes', n.key), owner_user_id: OWNER, calendar_event_id: n.evi ? n.evi.id : null, source_item_id: sid(n.itemTag), kind: 'gemini_notes', doc_external_id: n.docId,
      url: `https://docs.example.com/document/d/${n.docId}/edit`, arrived_at: n.arrived, match_method: n.evi ? 'calendar_attachment' : null, match_confidence: n.evi ? 0.98 : null,
      actual_duration_seconds: nd.dur ?? (n.evi ? (n.evi.def.dur - 2) * 60 : null), next_steps_parsed_at: addMinutes(item.firstSeen!, 2), next_step_count: n.stepCount, my_next_step_count: n.mine,
      created_at: item.firstSeen, updated_at: addMinutes(item.firstSeen!, 2),
    });
  }
  return { events, attendees, notes };
}
import { itemByTag } from './sources-lib';
function sidItem(tag: string): Item {
  const i = itemByTag(tag);
  if (!i) throw new Error(`item ${tag} missing`);
  return i;
}
void D;
