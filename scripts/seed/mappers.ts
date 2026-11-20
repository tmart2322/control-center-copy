/**
 * Generic raw → seed mappers. These contain no personal data: every name, account, opp and excerpt is read
 * from the raw fixture files at run time. Curated narrative (work items, drafts, briefs…) comes from the
 * private overlay (see README).
 */
import type { In, EventIn } from './lib';
import { die, iso, mtDay, mtHM, plusMin, slug, x } from './lib';

// ---------------------------------------------------------------------------
// raw shapes (only the fields we read)
// ---------------------------------------------------------------------------
export interface RawEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  attendees: { email: string; name: string; external: boolean; response: string }[];
  has_external: boolean;
  my_response: string;
  location: string | null;
  video_links: string[];
  html_link: string;
  _kind: string;
  likely_missed: boolean;
  flags: string[];
  has_gemini_notes?: boolean;
  gemini_notes?: { url: string } | null;
}
export interface RawOpp {
  opp_id: string;
  name: string;
  account: string;
  amount: number;
  stage: string;
  close_date: string;
  on_opp_team: boolean;
  dc: { role: string; percentage: number } | null;
  is_closed: boolean;
  url: string;
}
export interface RawMissed {
  verdict: 'Claim' | 'Check';
  account: string;
  opportunity: string;
  amount: number;
  stage: string;
  close: string;
  evidence: string;
  slack_note?: string;
  other_ai_data_architect_dc?: string;
  url: string;
  id: string;
}
export interface RawOrg62 {
  user: { name: string; user_id: string; role: string; title: string; manager: string };
  open_opportunities: RawOpp[];
  closed_this_quarter_or_recent: RawOpp[];
  missed_candidates: RawMissed[];
}
export interface RawSolutionsEvent {
  subject: string;
  start_utc: string;
  end_utc: string;
  Duration__c: number;
  SE_Task_Type__c: string;
  WhatId: string;
  what_name: string;
}
export interface RawAutopilotItem {
  subject: string;
  start_utc: string;
  end_utc: string;
  hours: number;
  se_task_type: string;
  what_id: string;
  what_name: string;
  what_type: string;
  confidence: 'High' | 'Medium' | 'Low';
  status: 'handed_off' | 'overlap' | 'needs_input' | 'upcoming';
  status_note: string;
  source: string;
}
export interface RawActivity {
  org62_solutions_events: RawSolutionsEvent[];
  gap: string;
  autopilot: { last_run: string; items_since_10_26: RawAutopilotItem[] };
}
export interface RawSession {
  session_id: string;
  title: string;
  cwd: string;
  first_ts: string;
  last_ts: string;
  user_turns: number;
  status: string;
  live: boolean;
  summary: string;
  tags: string[];
}
export interface RawManifest {
  generated_at: string;
  counts: Record<string, Record<string, number>>;
  sources: Record<string, { status: string; note: string; tool?: string }>;
}
export interface RawDrive {
  owned_by_tristan: { title: string; link: string; modifiedTime: string; lastModifyingUser: string; account_guess: string | null }[];
  owned_html_exports: { title: string; link: string; modifiedTime: string; lastModifyingUser: string }[];
}
export interface Raw {
  calendar: { events: RawEvent[] };
  org62: RawOrg62;
  activity: RawActivity;
  sessions: { sessions: RawSession[] };
  manifest: RawManifest;
  drive: RawDrive;
  // read by the overlay only
  [k: string]: unknown;
}

export interface AccountRule {
  id: string;
  name: string;
  industry?: string | null;
  /** Regex source matched (case-insensitive) against org62 account/opp names, calendar titles, activity subjects. */
  rx: string;
  notes?: string;
}

export type AcctOf = (text: string | null | undefined) => string | null;
export function makeAcctOf(rules: AccountRule[]): AcctOf {
  const compiled = rules.map((r) => ({ id: r.id, re: new RegExp(r.rx, 'i') }));
  return (text) => {
    if (!text) return null;
    for (const c of compiled) if (c.re.test(text)) return c.id;
    return null;
  };
}

// ---------------------------------------------------------------------------
// accounts / opps / missed
// ---------------------------------------------------------------------------
const productsFor = (name: string): string[] => {
  const p: string[] = [];
  if (/agent|\bAF\b|agentforce|coworker/i.test(name)) p.push('Agentforce');
  if (/data\s?(cloud|360)|d360|\bDC\b/i.test(name)) p.push('Data 360');
  if (/flex/i.test(name)) p.push('Flex Credits');
  if (/tableau|\btab\b/i.test(name)) p.push('Tableau Next');
  if (/\bMC\b|marketing cloud/i.test(name)) p.push('Marketing Cloud');
  if (/private connect/i.test(name)) p.push('Private Connect');
  return p.length ? p : ['Data 360'];
};

export function mapOpps(raw: Raw, acctOf: AcctOf, nextSteps: Record<string, string>, hoursByOpp: Map<string, number>, readAt: string): In['opps'] {
  const all = [...raw.org62.open_opportunities, ...raw.org62.closed_this_quarter_or_recent];
  return all.map((o) => {
    const accountId = acctOf(`${o.account} ${o.name}`);
    if (!accountId) die(`no account rule matches opp "${o.name}" (${o.account}). Add a rule to the overlay's accountRules.`);
    return {
      id: o.opp_id,
      accountId,
      name: x(o.name, 140),
      stage: o.stage,
      amount: o.amount,
      closeDate: o.close_date,
      isOpen: !o.is_closed,
      isMine: o.on_opp_team,
      dcAssigned: o.dc !== null,
      vdpLinked: false, // VDP is unreadable (cookie expired 10/26), so linkage is unverified
      hoursQtd: hoursByOpp.get(o.opp_id) ?? 0,
      nextStep: nextSteps[o.opp_id] ?? null,
      products: productsFor(o.name),
      owner: null,
      org62Url: o.url,
      updatedAt: iso(readAt),
    };
  });
}

export function mapAccounts(rules: AccountRule[], opps: In['opps'], hoursByAcct: Map<string, number>): In['accounts'] {
  return rules
    .map((r) => {
      const mine = opps.filter((o) => o.accountId === r.id && o.isOpen && o.dcAssigned);
      return {
        id: r.id,
        name: r.name,
        industry: r.industry ?? null,
        dcStatus: mine.length ? ('assigned' as const) : ('none' as const),
        vdpStatus: mine.length ? ('stale' as const) : ('none' as const), // unverifiable while VDP auth is down
        hoursQtd: hoursByAcct.get(r.id) ?? 0,
        team: [],
        org62Url: null,
        notes: r.notes ?? '',
      };
    });
}

export function mapMissed(raw: Raw, foundAt: string): In['missedOpps'] {
  return raw.org62.missed_candidates.map((m) => {
    const evidence = [...m.evidence.split(';').map((s) => x(s, 120)).filter(Boolean)];
    if (m.slack_note) evidence.push(x(m.slack_note, 240));
    const closed = /closed/i.test(m.stage);
    return {
      id: `mo_${m.id}`,
      verdict: m.verdict === 'Claim' ? ('claim' as const) : ('check' as const),
      oppId: null,
      oppName: x(m.opportunity, 160),
      accountName: x(m.account.replace(/\s+\d{2}D3\w+$/, ''), 120),
      amount: m.amount,
      stage: m.stage,
      closeDate: m.close,
      evidence,
      otherDcs: (m.other_ai_data_architect_dc ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean),
      status: closed ? ('dismissed' as const) : ('new' as const),
      dismissReason: closed ? `Already closed (${m.stage}, ${m.close})` : null,
      claimedWorkItemId: null,
      foundAt,
    };
  });
}

// ---------------------------------------------------------------------------
// calendar
// ---------------------------------------------------------------------------
export interface CalendarOpts {
  asOf: string;
  acctOf: AcctOf;
  nameFixes: Record<string, string>;
  meName: string;
}

/** Meeting links can carry passcodes (?pwd=…). Drop the query string from anything that looks like a join URL. */
const cleanUrl = (u: string): string => u.replace(/([?&])(pwd|passcode|password|token|tk)=[^&\s]*/gi, '$1').replace(/[?&]+$/, '').replace(/\?&/, '?');

export function mapEvents(raw: Raw, o: CalendarOpts): EventIn[] {
  const now = Date.parse(o.asOf);
  const seen = new Set<string>();
  const out: EventIn[] = [];
  for (const e of raw.calendar.events) {
    if (e.all_day || e._kind !== 'meeting' || seen.has(e.id)) continue;
    seen.add(e.id);
    const start = iso(e.start);
    const end = iso(e.end);
    let attendance: EventIn['attendance'];
    if (Date.parse(end) <= now) {
      if (e.my_response === 'declined') attendance = e.likely_missed ? 'missed' : 'declined';
      else attendance = e.likely_missed ? 'missed' : 'attended';
    } else if (Date.parse(start) <= now) {
      attendance = e.my_response === 'declined' ? 'declined' : 'in_progress';
    } else attendance = e.my_response === 'declined' ? 'declined' : 'upcoming';
    const attendees = e.attendees
      .filter((a) => a.name !== o.meName && !/^datajedais$/i.test(a.name))
      .slice(0, 8)
      .map((a) => {
        const name = o.nameFixes[a.name] ?? a.name;
        return { id: `p_${slug(name)}`, name, ...(a.external ? { isExternal: true } : {}) };
      });
    out.push({
      id: `ev_${e.id}`,
      title: x(e.title, 140),
      start,
      end,
      attendance,
      isCustomerFacing: e.has_external,
      accountId: o.acctOf(e.title),
      oppId: null,
      attendees,
      location: e.location ? cleanUrl(x(e.location, 140)) : null,
      meetingUrl: e.video_links[0] ? cleanUrl(e.video_links[0]) : null,
      prep: null,
      takeaways: null,
      source: { kind: 'calendar', label: `Calendar · ${x(e.title, 60)}`, url: e.html_link, externalId: e.id, at: start },
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---------------------------------------------------------------------------
// activity log
// ---------------------------------------------------------------------------
const CF_TYPES = /presentation|discovery|workshop|demo|briefing/i;
const conf = { High: 'sure', Medium: 'likely', Low: 'guess' } as const;

export function mapActivity(raw: Raw, oppIds: Set<string>, readAt: string): In['activity'] {
  const rows: In['activity'] = [];
  const mk = (id: string, subject: string, start: string, end: string, hours: number, type: string | null, whatId: string, whatName: string, status: In['activity'][number]['status'], c: 'sure' | 'likely' | 'guess', srcKind: 'org62' | 'calendar' | 'claude', issues: string[]) => {
    const isAccount = whatId.startsWith('001');
    rows.push({
      id,
      version: 1,
      date: mtDay(start),
      start: iso(start),
      end: iso(end),
      durationH: hours,
      taskType: type,
      oppId: whatId || null,
      oppName: whatName ? x(whatName.replace(/\s*\(account\)$/, ''), 120) : null,
      accountName: whatName && (isAccount || !oppIds.has(whatId)) ? x(whatName.replace(/\s*\(account\)$/, ''), 120) : null,
      meetingType: type === 'Travel' || !type ? null : CF_TYPES.test(type) ? 'CF' : 'CR',
      description: x(subject, 200),
      status,
      confidence: c,
      sources: [{ kind: srcKind, label: srcKind === 'org62' ? 'Org62 · Solutions Event' : srcKind === 'claude' ? 'Claude sessions · off-calendar' : `Calendar · ${x(subject, 60)}`, at: iso(start) }],
      userLockedFields: [],
      issues,
      updatedAt: iso(readAt),
    });
  };
  raw.activity.org62_solutions_events.forEach((e, i) => mk(`ac_o62_${i + 1}`, e.subject, e.start_utc, e.end_utc, e.Duration__c, e.SE_Task_Type__c, e.WhatId, e.what_name, 'verified', 'sure', 'org62', []));
  raw.activity.autopilot.items_since_10_26.forEach((a, i) => {
    const status = a.status === 'handed_off' ? 'synced_to_canvas' : a.status === 'overlap' ? 'dismissed' : a.status === 'needs_input' ? 'needs_input' : 'upcoming';
    const issues = a.status === 'overlap' ? [x(a.status_note, 120) || 'Overlaps another row'] : a.status === 'needs_input' ? ['Needs an opp or account (WhatId)'] : [];
    mk(`ac_ap_${i + 1}`, a.subject, a.start_utc, a.end_utc, a.hours, a.se_task_type, a.what_id, a.what_name, status, conf[a.confidence], a.source === 'evidence' ? 'claude' : 'calendar', issues);
  });
  return rows;
}

export function hoursBy(raw: Raw, acctOf: AcctOf): { byAcct: Map<string, number>; byOpp: Map<string, number> } {
  const byAcct = new Map<string, number>();
  const byOpp = new Map<string, number>();
  for (const e of raw.activity.org62_solutions_events) {
    const a = acctOf(e.what_name);
    if (a) byAcct.set(a, (byAcct.get(a) ?? 0) + e.Duration__c);
    byOpp.set(e.WhatId, (byOpp.get(e.WhatId) ?? 0) + e.Duration__c);
  }
  return { byAcct, byOpp };
}

// ---------------------------------------------------------------------------
// Claude sessions → agent runs
// ---------------------------------------------------------------------------
export function mapRuns(raw: Raw, host: Map<string, string>, links: Record<string, string>, asOf: string): In['agentRuns'] {
  const now = Date.parse(asOf);
  const H36 = 36 * 3_600_000;
  return raw.sessions.sessions.map((s) => {
    const last = Date.parse(s.last_ts);
    const scheduled = s.tags.includes('autopilot');
    let state: In['agentRuns'][number]['state'];
    if (s.status === 'busy') state = 'running';
    else if (s.status === 'waiting' || s.status === 'waiting_user') state = 'waiting_on_you';
    else if (s.status === 'idle' && s.live) state = s.user_turns > 0 && now - last < H36 ? 'done_review' : 'stale';
    else state = 'done';
    const hostId = host.get(s.session_id);
    const linkKey = Object.keys(links).find((k) => s.session_id.startsWith(k));
    const finished = state === 'done' || state === 'done_review';
    return {
      id: `run_${s.session_id.slice(0, 8)}`,
      kind: 'claude_session' as const,
      title: x(s.title, 100),
      workItemId: linkKey ? links[linkKey] : null,
      state,
      startedAt: iso(s.first_ts),
      updatedAt: iso(s.last_ts),
      finishedAt: finished && !s.live ? iso(s.last_ts) : null,
      lastEvent: state === 'running' ? 'Running now' : x(s.summary, 150) || 'Session ended',
      waiting: null,
      deepLink: `claude://code/continue?session=${encodeURIComponent(hostId ?? s.session_id)}`,
      sessionId: s.session_id,
      cwd: s.cwd,
      bgAgents: 0,
      scheduled,
      toolRunId: null,
      progress: null,
      resultUrl: null,
      error: null,
      costUsd: null,
    };
  });
}

// ---------------------------------------------------------------------------
// connectors, scans, jobs, event log
// ---------------------------------------------------------------------------
const CONNECTOR_META: Record<string, { id: string; label: string; source: In['connectors'][number]['source']; affects: string[]; reauth: In['connectors'][number]['reauth'] }> = {
  slack: { id: 'slack', label: 'Slack', source: 'slack', affects: ['today', 'items', 'briefs'], reauth: { kind: 'terminal_command', label: 'Re-auth Slack', command: 'claude mcp login slack', instructions: 'Or in any Claude session: /mcp → slack → Authenticate' } },
  gmail: { id: 'gmail', label: 'Gmail', source: 'gmail', affects: ['today', 'items', 'outbox'], reauth: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null } },
  calendar: { id: 'calendar', label: 'Calendar', source: 'calendar', affects: ['today', 'calendar', 'time'], reauth: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null } },
  drive: { id: 'drive', label: 'Drive', source: 'drive', affects: ['items'], reauth: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null } },
  gemini: { id: 'gemini', label: 'Gemini notes', source: 'gemini', affects: ['items'], reauth: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null } },
  org62: { id: 'org62', label: 'Org62', source: 'org62', affects: ['deals'], reauth: { kind: 'terminal_command', label: 'Re-auth Org62', command: 'claude mcp login Org62-Sobject-Read', instructions: null } },
  vdp: { id: 'vdp', label: 'VDP', source: 'vdp', affects: ['deals', 'items'], reauth: { kind: 'refresh_script', label: 'Re-auth VDP', command: '~/.claude/scripts/refresh_vdp_fir_cookie.py', instructions: 'Opens a browser for Okta MFA (up to 5 minutes)' } },
  claude_sessions: { id: 'claude', label: 'Claude sessions', source: 'claude', affects: ['today', 'agents'], reauth: null },
};

export function mapConnectors(raw: Raw, o: { asOf: string; vdpExpiredAt: string }): { connectors: In['connectors']; scanRuns: In['scanRuns']; eventLog: In['eventLog'] } {
  const read = iso(raw.manifest.generated_at);
  const c = raw.manifest.counts;
  const items: Record<string, number> = {
    slack: (c.slack_asks?.asks ?? 0) + (c.slack_asks?.commitments ?? 0) + (c.slack_watch?.['#data-jedais'] ?? 0) + (c.slack_watch?.['#data-jedais-hls-can'] ?? 0),
    gmail: c.gmail?.threads ?? 0,
    calendar: c.calendar?.events ?? 0,
    drive: (c.drive?.owned ?? 0) + (c.drive?.other ?? 0),
    gemini: c.gemini?.meetings ?? 0,
    org62: (c.org62?.open ?? 0) + (c.org62?.closed ?? 0),
    vdp: 0,
    claude_sessions: c.sessions?.sessions ?? 0,
  };
  const connectors: In['connectors'] = [];
  const scanRuns: In['scanRuns'] = [];
  const eventLog: In['eventLog'] = [];
  let n = 0;
  for (const [key, meta] of Object.entries(CONNECTOR_META)) {
    const src = raw.manifest.sources[key];
    if (!src) continue;
    const down = src.status === 'skipped';
    const at = down ? o.vdpExpiredAt : read;
    connectors.push({
      id: meta.id,
      label: meta.label,
      source: meta.source,
      state: down ? 'auth_needed' : 'ok',
      since: at,
      lastSuccessAt: at,
      cursor: { label: down ? `${meta.label} through ${mtDay(at).slice(5)}` : `${meta.label} through ${mtHM(read)}`, at },
      backlog: 0,
      itemsToday: items[key] ?? 0,
      catchUpPct: null,
      lastError: down ? { class: 'auth', message: 'vdp-app-fir: unexpected content type text/html (gateway cookie lapsed)', at: read, count: 1 } : null,
      impact: down ? 'VDP linkage and value plans are unverified since 10/26; Q3 VDP updates cannot be checked' : null,
      reauth: meta.reauth,
      affects: meta.affects,
    });
    scanRuns.push({
      id: `scan_${++n}`,
      connectorId: meta.id,
      scope: key === 'slack' ? 'asks_and_promises' : key === 'gmail' ? 'inbox' : key === 'calendar' ? 'primary' : key === 'drive' ? 'owned + recent' : key === 'gemini' ? 'meeting notes' : key === 'org62' ? 'my opps + DC sweep' : key === 'vdp' ? 'my VDPs' : 'sessions',
      kind: 'poll',
      windowStart: down ? o.vdpExpiredAt : plusMin(read, -60 * 24 * 14),
      windowEnd: read,
      status: down ? 'auth_failed' : /partial/.test(src.status) ? 'partial' : 'ok',
      startedAt: read,
      endedAt: plusMin(read, 1),
      itemsSeen: items[key] ?? 0,
      itemsNew: down ? 0 : Math.round((items[key] ?? 0) / 3),
      itemsChanged: 0,
      costUsd: down ? 0 : key === 'org62' || key === 'slack' ? 0.004 : 0,
      model: down ? null : key === 'slack' || key === 'org62' ? 'haiku' : null,
      error: down ? 'Unexpected content type: text/html' : null,
    });
    if (down) eventLog.push({ id: 'evt_vdp', at: read, level: 'error', source: 'vdp', code: 'auth_needed', message: 'VDP cookie expired 10/26; vdp-app-fir returns the SSO login page', count: 1, lastSeenAt: read, suggestedAction: 'Re-auth VDP', acknowledged: false, acknowledgedAt: null });
    else if (/partial/.test(src.status)) eventLog.push({ id: `evt_${meta.id}`, at: read, level: 'warn', source: meta.id, code: 'partial_scan', message: x(src.note, 200), count: 1, lastSeenAt: read, suggestedAction: null, acknowledged: false, acknowledgedAt: null });
  }
  // the Org62 gap the activity gatherer found
  eventLog.push({ id: 'evt_activity_gap', at: read, level: 'warn', source: 'org62', code: 'activity_gap', message: x(raw.activity.gap, 240), count: 1, lastSeenAt: read, suggestedAction: 'Confirm the handed-off rows', acknowledged: false, acknowledgedAt: null });
  return { connectors, scanRuns, eventLog };
}
