/**
 * Domain 02 (sources): raw scanned inputs and everything derived from them: source_items (+refs, links), calendar,
 * meeting notes, assets and their snapshots, opportunity snapshots, VDP mirror, Org62 events.
 * Run: npx tsx sample-data/generators/02-sources.ts   (needs the domain 01 tables)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER, SAMPLE_DIR, day, flushRefs, readTable, ref, reservedFor, rng, uid, writeTable, type Row } from '../lib/kit';
import { assembleCalendar, calendarRows, EVI, NOTE_INFO } from './data/sources-asm-cal';
import { ALL_ASSETS, assembleDrive, diffCount, driveRows, ensureDriveItems, fixSampledAt, VERS } from './data/sources-asm-drive';
import { assembleClaude, assembleOrg62, assembleVdp, candidateAssetTags, candidateRows, o62Key, org62Rows, vdpRows } from './data/sources-asm-org62';
import { buildMail } from './data/sources-mail';
import { buildSlack } from './data/sources-slack';
import { ORG62_EVENTS, CANDIDATES, VDPS, CLAUDE_SESSIONS } from './data/sources-org62';
import { CHANNELS, CONNECTORS, ITEMS, NAME, OPP_BY_KEY, P, T_NOW, T_SCAN_END, T_START, aid, addMinutes, at, cid, fid, itemByTag, mail, oid, pid, scanN, sha, slack, slackOf, type Item, type LinkSpec } from './data/sources-lib';
import { ASSETS } from './data/sources-drive';
import { NOTES } from './data/sources-cal';

// ───────────────────────── templated and extra items ─────────────────────────
function extras(): void {
  // standup threads in #se-team (Mondays and Fridays): low-value FYI traffic
  const roots = ['Standup thread: post blockers here. Reminder that pipeline notes are due Friday.', 'Standup thread. Please put customer travel in the team calendar.', 'Standup thread: post blockers here.', 'Standup thread. Q4 planning doc is open for comments.'];
  const pool: Record<string, string[]> = {
    'se-ioana': ['No blockers. Finishing the retail demo kit refresh.', 'Heads down on the grocery chain demo prep today.', 'Out Thursday afternoon, back Friday.', 'Waiting on a customer to share sample data, otherwise clear.'],
    'se-tariq': ['Customer trip Tuesday and Wednesday, async only.', 'Working on demo kit release notes.', 'Harrowgate plant data call Thursday.', 'No blockers.'],
    'se-linnea': ['Ferrowpay dry run prep, then a Voltmere discovery call.', 'Reviewing two blueprints for peers today.', 'Out for an afternoon appointment.', 'No blockers.'],
    owner: ['Saltmere blueprint writing today, Elderglen demo prep tomorrow. No blockers.', 'Cascadia agenda review, then Ferrowpay mapping. No blockers.', 'Harrowgate demo wrap-up and time log for last week.', 'Oakhallow addendum redline, then blueprint section 4.'],
  };
  const days = [-30, -26, -23, -19, -16, -12, -9, -5, -2];
  days.forEach((d, i) => {
    const r = rng(`standup:${d}`);
    const tag = `sl-su-${i}`;
    slack({ tag, ch: 'se-team', d, t: '08:20', who: 'mgr', text: roots[i % roots.length]!, noise: true, gist: 'Standup thread root (Hana)' });
    const who = ['se-ioana', 'se-tariq', 'se-linnea', ...(d === -26 ? [] : ['owner'])];
    who.forEach((k, j) => {
      if (k !== 'owner' && !r.chance(0.8)) return;
      slack({ tag: `${tag}-r${j}`, ch: 'se-team', d, t: `08:${35 + j * 4}`, who: k, text: r.pick(pool[k]!), thread: tag, noise: true, toMe: false });
    });
  });
  // a rotated demo login shared in the team channel (redacted on ingest)
  slack({ tag: 'sl-redact-1', ch: 'se-team', d: -11, t: '10:05', who: 'se-tariq', text: 'Demo kit sandbox is refreshed. Login for the kit org: user: demo.admin@example.com / password: [REDACTED:password] (rotated weekly, ask me if it stops working).', redact: ['password'], gist: 'Tariq shares the demo kit login (password redacted on ingest)', toMe: false });
  slack({ tag: 'sl-redact-2', ch: 'dm-ae-harbor', d: -3 - 1, t: '16:15', who: 'ae-harbor', text: 'Dial-in for the Oakhallow legal call on Monday: 555-0142, PIN [REDACTED:password]. I will also put it on the invite.', redact: ['password'], acct: 'oakhallow', opp: 'oakhallow-claims-agent', gist: 'Theo shares a dial-in with a PIN (redacted on ingest)' });
  // canvases and links shared in conversation (VDP asset candidates)
  slack({ tag: 'sl-canvas-31', ch: 'saltmere-poc', d: -10, t: '14:00', who: 'ae-harbor', text: 'I put our decisions so far into a canvas so we have one place for them: https://workspace.slack.example/docs/F0SMPL031', acct: 'saltmere', opp: 'saltmere-data360-poc', gist: 'Theo shares the Saltmere POC decision log canvas' });
  slack({ tag: 'sl-canvas-32', ch: 'yarrowdale-team', d: -6, t: '17:20', who: 'owner', text: 'Canvas with what I know about BH identity handling (their identity system, consent): https://workspace.slack.example/docs/F0SMPL032', acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake', gist: 'Rafael shares a canvas on BH identity handling' });
  slack({ tag: 'sl-canvas-33', ch: 'ferrowpay-pursuit', d: -9, t: '11:30', who: 'se-linnea', text: 'The fraud case taxonomy I used in the dry run, as a canvas: https://workspace.slack.example/docs/F0SMPL033', acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', gist: 'Linnea shares the fraud case taxonomy canvas', toMe: true });
  mail({ tag: 'em-aw-bh-3', thread: 'awbh-diagram', d: -8, t: '09:10', from: 'awb-hugo', to: ['owner'], subject: 'Our intake workflow diagram', acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake', body: 'Rafael, here is the diagram our team uses for the intake workflow, it is on our portal: https://portal.yarrowdale-behavioral.example/intake/workflow\n\nHugo', gist: 'Hugo shares the BH intake workflow diagram link' });
  mail({ tag: 'em-pc-5', thread: 'pc-dash', d: -8, t: '11:00', from: 'pc-corwin', to: ['owner'], cc: ['ae-harbor'], subject: 'Pilot containment dashboard', acct: 'oakhallow', opp: 'oakhallow-claims-agent', body: 'Rafael, our containment dashboard for the pilot is here if you want to use it in the claims triage proposal: https://reports.oakhallowmutual.example/pilot/containment\n\nCorwin', gist: 'Corwin shares the pilot containment dashboard link' });
  // links the user (or a rule) rejected
  const rej = itemByTag('sl-sdr-02');
  if (rej) { rej.acct = undefined; rej.links = [{ to: 'account', key: 'elderglen-outdoors', role: 'about', method: 'llm', conf: 0.45, verdict: 'rejected' }]; }
  const rej2 = itemByTag('sl-alw-04');
  if (rej2) { rej2.links = [{ to: 'account', key: 'yarrowdale-mg', role: 'about', method: 'llm', conf: 0.52, verdict: 'rejected' }]; }
}

function noiseExtras(): void {
  // Gemini "notes are ready" notifications, partner digests, release radar, Org62 system mail, LMS promos
  const toDT = (iso: string) => { const ms = Date.parse(iso) - 7 * 3600_000; const d = new Date(ms); const base = Date.UTC(2026, 10, 18); const off = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - base) / 86400000); return { d: off, t: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }; };
  NOTE_INFO.filter((_, k) => k % 3 !== 2).forEach((n) => {
    const { d, t } = toDT(addMinutes(n.arrived, 2));
    mail({ tag: `em-gn-${n.key}`, thread: `gn-${n.key}`, d, t, from: 'Meet Notes <notes-noreply@example.com>', to: ['owner'], subject: `Notes by Gemini: ${n.title.split(' - ')[0]}`, noise: true, bulk: true, gist: 'Notification that Gemini notes are ready (the notes themselves are a gemini_note item)', body: `Meeting notes are ready for ${n.title.split(' - ')[0]}. Open the document: https://docs.example.com/document/d/${n.docId}/edit` });
  });
  [-25, -18, -11, -4].forEach((d, k) => mail({ tag: `em-pd-${k}`, thread: `pd-${k}`, d, t: '07:10', from: 'Partner Digest <partners@marketing.example>', to: ['owner'], subject: `Partner Digest: new integrations and certifications (week ${k + 1})`, noise: true, bulk: true, gist: 'Partner newsletter', body: 'New partner integrations, certification windows and co-sell updates for the quarter. Manage your subscription in the partner portal.' }));
  [-24, -17, -10, -3].forEach((d, k) => mail({ tag: `em-rr-${k}`, thread: `rr-${k}`, d, t: '08:00', from: 'Release Radar <releases@marketing.example>', to: ['owner'], subject: `Release Radar: what shipped this week (${k + 1})`, noise: true, bulk: true, gist: 'Product release newsletter', body: 'This week: agent testing batch runs, identity resolution fuzzy matching, new connectors. Full notes on the enablement portal.' }));
  [['saltmere-data360-poc', -22], ['elderglen-outdoors-renewal-expansion', -23], ['ferrowpay-data360-foundation', -13], ['oakhallow-claims-agent', -10], ['harrowgate-maintenance-agent', -9], ['halvergate-route-exceptions-agent', -24]].forEach(([o, d], k) => mail({ tag: `em-o62-${k}`, thread: `o62-${k}`, d: d as number, t: '11:20', from: 'Org62 Notifications <noreply@org62.example>', to: ['owner'], subject: `Opportunity updated: ${OPP_BY_KEY[o as string]!.name}`, acct: OPP_BY_KEY[o as string]!.acct, opp: o as string, noise: true, bulk: true, gist: 'Org62 system notification of an opportunity change (also seen as an org62 snapshot)', body: `The opportunity ${OPP_BY_KEY[o as string]!.name} was updated (stage, amount or close date). View the record in Org62.` }));
  [-21, -14, -7].forEach((d, k) => mail({ tag: `em-lp-${k}`, thread: `lp-${k}`, d, t: '06:20', from: 'Learning Platform <learning-noreply@learning.example>', to: ['owner'], subject: 'New courses this month in your role path', noise: true, bulk: true, gist: 'LMS promotional digest', body: 'Recommended courses for Solutions Engineers: Data 360 identity resolution, agent testing, consumption estimation.' }));
  // Slack bots
  [-27, -22, -17, -12, -7, -2].forEach((d, k) => slack({ tag: `sl-qbot-${k}`, ch: 'deal-desk-help', d, t: '09:05', who: 'bot:Quote Approval Bot', text: `Approval summary: ${3 + k} quotes approved, ${1 + (k % 2)} waiting on the second approver, 0 rejected this week.`, noise: true }));
  [-26, -20, -13, -6].forEach((d, k) => slack({ tag: `sl-news2-${k}`, ch: 'industry-news', d, t: '12:30', who: 'bot:Industry News Digest', text: `Midweek roundup: ${['payer prior authorization automation', 'logistics exception handling', 'retail loyalty data sharing', 'utility outage analytics'][k]} and two analyst notes.`, noise: true }));
  [-26, -19, -12].forEach((d, k) => slack({ tag: `sl-ann2-${k}`, ch: 'company-announcements', d, t: '10:00', who: 'bot:Company Announcements', text: ['Reminder: expense reports older than 60 days need manager approval.', 'IT maintenance window Saturday 22:00 to 02:00.', 'New hire welcome: please say hello to the Solutions team additions.'][k]!, noise: true }));
  [-16, -5].forEach((d, k) => slack({ tag: `sl-sdr2-${k}`, ch: 'se-demo-requests', d, t: '13:40', who: 'bot:Demo Request Form', text: ['New demo request: regional bank, fraud analytics overview. Unassigned.', 'New demo request: healthcare staffing firm, agent for credentialing. Unassigned.'][k]!, noise: true }));
  [-19, -4].forEach((d, k) => slack({ tag: `sl-rn-${k}`, ch: 'data-ai-specialists', d, t: '09:00', who: 'bot:Release Notes Bot', text: ['Data 360 release notes: calculated insights now support rolling windows.', 'Agentforce release notes: testing center adds scheduled runs.'][k]!, noise: true }));
}

// ───────────────────────── finalize items ─────────────────────────
type Run = { id: string; s: number; f: number };
const scanRunRows = readTable('scan_runs');
const RUNS: Record<string, Run[]> = {};
for (const k of CONNECTORS) {
  RUNS[k] = scanRunRows.filter((r) => r.connector_id === uid('connectors', k) && (r.status === 'succeeded' || r.status === 'partial')).map((r) => ({ id: r.id as string, s: Date.parse(r.started_at as string), f: Date.parse((r.finished_at ?? r.started_at) as string) })).sort((a, b) => a.s - b.s);
}
const BACKFILL = [Date.parse('2026-11-09T21:20:00Z'), Date.parse('2026-11-10T22:45:00Z')] as const;
function snapFirst(i: Item, desired: number, rr: ReturnType<typeof rng>): void {
  const runs = RUNS[i.connector]!;
  const occ = Date.parse(i.occurred);
  const early = i.source === 'calendar' || i.source === 'vdp';
  const lo = early ? desired : Math.max(desired, occ + 60000);
  let idx = runs.findIndex((r) => r.f >= lo);
  if (idx < 0) idx = runs.length - 1;
  let run = runs[idx]!;
  let t = lo >= run.s && lo <= run.f ? lo : run.s + Math.floor(rr.next() * Math.max(1, run.f - run.s));
  if (early && t > occ && i.source === 'calendar') {
    const j = runs.map((r) => r.s <= occ).lastIndexOf(true);
    if (j >= 0) { run = runs[j]!; t = run.s + Math.floor(rr.next() * Math.max(1, Math.min(run.f, occ) - run.s)); }
  }
  if (!early && t < occ + 60000) t = occ + 60000;
  i.firstSeen = new Date(Math.min(t, Date.parse(T_SCAN_END))).toISOString();
  i.firstRun = run.id;
}
function finalize(): void {
  for (const i of ITEMS) {
    const r = rng(`fin:${i.tag}`);
    const occ = Date.parse(i.occurred);
    let desired = i.firstSeen ? Date.parse(i.firstSeen) : occ + (i.source === 'slack' ? r.int(2, 28) : i.source === 'gmail' ? r.int(4, 45) : r.int(5, 40)) * 60000;
    if (!i.firstSeen && i.source === 'slack' && occ < Date.parse(at(-9, '08:00')) && r.chance(0.4)) desired = BACKFILL[0] + Math.floor(r.next() * (BACKFILL[1] - BACKFILL[0]));
    snapFirst(i, desired, r);
  }
  // last seen: threads are re-read when new replies appear (the run of the newest member); others sometimes re-read by a later run
  const threadKey = (i: Item) => (i.source === 'slack' || i.source === 'gmail' ? `${i.source}:${i.parent ?? i.ext.split(':')[1] ?? i.ext}` : null);
  const groups = new Map<string, Item[]>();
  for (const i of ITEMS) {
    const k = threadKey(i);
    if (k) (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }
  for (const i of ITEMS) {
    const r = rng(`last:${i.tag}`);
    const runs = RUNS[i.connector]!;
    const first = Date.parse(i.firstSeen!);
    const fixed = i.lastSeen ? Date.parse(i.lastSeen) : null;
    let t = fixed ?? first;
    let runId = i.firstRun!;
    const g = threadKey(i) ? groups.get(threadKey(i)!)! : null;
    if (g && g.length > 1 && fixed === null) {
      const newest = g.reduce((m, x) => (Date.parse(x.firstSeen!) > Date.parse(m.firstSeen!) ? x : m), g[0]!);
      t = Date.parse(newest.firstSeen!);
      runId = newest.firstRun!;
    } else if (fixed === null ? r.chance(0.3) : true) {
      const want = fixed ?? first + r.int(1, 4) * 1440 * 60000;
      const j = runs.map((x) => x.s <= want).lastIndexOf(true);
      if (j >= 0 && runs[j]!.s >= first - 1) { const run = runs[j]!; t = Math.min(Math.max(want, run.s), run.f); runId = run.id; }
      else t = first;
    }
    t = Math.min(Math.max(t, first), Date.parse(T_SCAN_END));
    i.lastSeen = new Date(t).toISOString();
    i.lastRun = runId;
    if (i.deletedUpstream && Date.parse(i.lastSeen) > Date.parse(i.deletedUpstream)) i.lastSeen = i.firstSeen!;
  }
  for (const i of ITEMS) if (i.source === 'slack' && i.srcUpdated) { i.revision = 2; i.changedAt = i.srcUpdated; }
  const del = itemByTag('sl-del-1');
  if (del) del.deletedUpstream = addMinutes(del.lastSeen!, 26 * 60);
}

// ───────────────────────── links and refs ─────────────────────────
const CHAN_ACCT_RULE: Record<string, string> = { 'saltmere-poc': 'chan-saltmere', 'saltmere-team': 'chan-saltmere', 'elderglen-outdoors-deal': 'chan-elderglen-outdoors', 'elderglen-outdoors-ext': 'chan-elderglen-outdoors', 'oakhallow-pursuit-2025': 'chan-oakhallow-old' };
const CHAN_OPP: Record<string, { method: LinkSpec['method']; conf: number; rule?: string; verdict?: 'confirmed' }> = {
  'saltmere-poc': { method: 'user', conf: 1, verdict: 'confirmed' }, 'elderglen-outdoors-deal': { method: 'rule', conf: 0.95, rule: 'chan-elderglen-outdoors' }, 'cascadia-onsite': { method: 'user', conf: 1, verdict: 'confirmed' },
  'yarrowdale-team': { method: 'llm', conf: 0.78, verdict: 'confirmed' }, 'halvergate-freight': { method: 'connector', conf: 0.9 }, 'ferrowpay-pursuit': { method: 'llm', conf: 0.82 },
};
const extractorRef = () => ref('extractors', 'link-resolver:1', 'LLM link resolver (kind llm, haiku tier) behind every source_item_links row with method llm');
const SLACK_ID_TO_KEY = Object.fromEntries(Object.keys(P).filter((k) => slackOf(k)).map((k) => [slackOf(k)!, k]));
const EMAIL_TO_KEY = Object.fromEntries(Object.keys(P).map((k) => [P[k]!.email, k]));
const ASSET_BY_FID = new Map(ALL_ASSETS.map((a) => [a.fileId ?? fid(a.tag), a.tag]));

function buildLinks(sid: (t: string) => string): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  const evId = (tag: string) => uid('calendar_events', tag);
  const add = (i: Item, spec: LinkSpec, extra: { method: LinkSpec['method']; conf: number; rule?: string; verdict?: 'confirmed' | 'rejected' }) => {
    const role = spec.role ?? 'about';
    const target = spec.to === 'account' ? aid(spec.key) : spec.to === 'opportunity' ? oid(spec.key) : spec.to === 'person' ? pid(spec.key) : spec.to === 'asset' ? uid('assets', spec.key) : evId(spec.key);
    const k = `${i.key}|${role}|${spec.to}|${target}`;
    if (seen.has(k)) return;
    seen.add(k);
    const r = rng(`lv:${k}`);
    let verdict = extra.verdict ?? null;
    if (!verdict && extra.method === 'llm') verdict = r.chance(0.14) ? 'confirmed' : null;
    out.push({
      id: uid('source_item_links', k), source_item_id: sid(i.tag), account_id: spec.to === 'account' ? target : null, opportunity_id: spec.to === 'opportunity' ? target : null, person_id: spec.to === 'person' ? target : null,
      asset_id: spec.to === 'asset' ? target : null, calendar_event_id: spec.to === 'event' ? target : null, role, method: extra.method, confidence: Math.round(extra.conf * 100) / 100,
      extractor_id: extra.method === 'llm' ? extractorRef() : null, mapping_rule_id: extra.rule ? uid('mapping_rules', extra.rule) : null, user_verdict: verdict, created_at: i.firstSeen, updated_at: verdict ? addMinutes(i.firstSeen!, 600) : i.firstSeen,
    });
  };
  for (const i of ITEMS) {
    if (i.noLinks) continue;
    const r = rng(`links:${i.tag}`);
    const chan = i.channel;
    // account + opportunity
    for (const spec of i.links ?? []) {
      if (spec.to === 'account' || spec.to === 'opportunity') add(i, spec, { method: spec.method ?? 'llm', conf: spec.conf ?? 0.6, rule: spec.rule, verdict: spec.verdict });
    }
    const hasExplicitAcct = (i.links ?? []).some((l) => l.to === 'account');
    if (i.acct && !hasExplicitAcct) {
      let method: LinkSpec['method'] = i.linkMethod ?? 'llm';
      let conf = i.linkConf ?? 0.6 + r.next() * 0.3;
      let rule = i.linkRule;
      if (i.source === 'slack') {
        if (chan && CHAN_ACCT_RULE[chan]) { method = 'rule'; conf = 0.95; rule = CHAN_ACCT_RULE[chan]; }
        else { method = 'llm'; conf = 0.6 + r.next() * 0.3; rule = undefined; }
      } else if (i.source === 'gmail') {
        const domainHit = ((i.meta['participants'] as Array<{ email: string }> | undefined) ?? []).some((p) => p.email.endsWith(i.acct === 'yarrowdale' ? 'yarrowdale-health.example' : '.example') && !p.email.includes('juniper-quay') && !p.email.includes('example.org'));
        if (domainHit && ((i.meta['participants'] as Array<{ isExternal: boolean }>) ?? []).some((p) => p.isExternal)) { method = 'rule'; conf = 1; rule = `dom-${i.acct}`; }
        else { method = 'llm'; conf = 0.65 + r.next() * 0.25; rule = undefined; }
      }
      if (method === 'rule' && !rule) method = 'llm';
      add(i, { to: 'account', key: i.acct }, { method, conf: method === 'rule' ? Math.max(conf, 0.9) : conf, rule });
    }
    if (i.opp && !(i.links ?? []).some((l) => l.to === 'opportunity')) {
      let method: LinkSpec['method'] = i.linkMethod ?? 'llm';
      let conf = (i.linkConf ?? 0.6 + r.next() * 0.3) - (i.linkConf ? 0.02 : 0);
      let rule = i.linkRule;
      let verdict: 'confirmed' | undefined;
      if (i.source === 'slack' && chan && CHAN_OPP[chan] && OPP_BY_KEY[i.opp] && (chan !== 'yarrowdale-team' || i.opp === 'yarrowdale-enterprise-data') && (chan !== 'ferrowpay-pursuit' || i.opp === 'ferrowpay-data360-foundation')) {
        const c = CHAN_OPP[chan]!; method = c.method; conf = c.conf; rule = c.rule; verdict = c.verdict;
      } else if (i.source === 'slack' || i.source === 'gmail') { method = 'llm'; conf = 0.55 + r.next() * 0.3; rule = undefined; }
      if (method === 'rule' && !rule) method = 'llm';
      add(i, { to: 'opportunity', key: i.opp }, { method, conf, rule, verdict });
    }
    // people
    if (i.actor && i.actor !== 'owner' && P[i.actor] && (i.source === 'gmail' || i.source === 'slack' || i.source === 'calendar') && r.chance(0.9)) add(i, { to: 'person', key: i.actor, role: 'from' }, { method: 'connector', conf: 1 });
    if (i.source === 'slack') for (const m of (i.body ?? '').matchAll(/<@(U0SMPL\d{3})>/g)) { const k = SLACK_ID_TO_KEY[m[1]!]; if (k && k !== 'owner') add(i, { to: 'person', key: k, role: 'mentions' }, { method: 'connector', conf: 1 }); }
    if (i.source === 'gmail') for (const p of ((i.meta['participants'] as Array<{ email: string; isMe: boolean }>) ?? []).slice(0, 2)) { const k = EMAIL_TO_KEY[p.email]; if (k && k !== 'owner') add(i, { to: 'person', key: k, role: 'to' }, { method: 'connector', conf: 1 }); }
    if (i.source === 'gemini_notes') for (const k of new Set(NOTES.find((n) => `gn-${n.key}` === i.tag)?.steps.flatMap((s) => s.who).filter((w) => w !== 'owner' && P[w]).slice(0, 3))) add(i, { to: 'person', key: k, role: 'mentions' }, { method: 'rule', conf: 0.9 });
    // events and assets
    for (const spec of i.links ?? []) if (spec.to === 'event' || spec.to === 'asset' || spec.to === 'person') add(i, spec, { method: spec.method ?? 'connector', conf: spec.conf ?? 1, rule: spec.rule, verdict: spec.verdict });
    if (i.source !== 'drive') for (const m of new Set([...(i.body ?? '').matchAll(/\/d\/(1smpl[A-Za-z0-9]+)\//g)].map((x) => x[1]!))) { const t = ASSET_BY_FID.get(m); if (t) add(i, { to: 'asset', key: t, role: i.source === 'gmail' && (i.links ?? []).some((l) => l.to === 'asset' && l.key === t) ? 'attachment' : 'mentions' }, { method: 'connector', conf: 1 }); }
  }
  return out;
}

function buildRefs(sid: (t: string) => string): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const i of ITEMS) {
    const put = (kind: string, value: string) => {
      const k = `${i.key}|${kind}|${value}`;
      if (!value || seen.has(k)) return;
      seen.add(k);
      out.push({ id: ++n, source_item_id: sid(i.tag), kind, value, created_at: i.firstSeen });
    };
    const text = `${i.body ?? ''}\n${i.title ?? ''}`;
    for (const u of text.matchAll(/https?:\/\/[^\s)>"']+/g)) {
      const url = u[0].replace(/[.,;]+$/, '');
      const fidm = /\/d\/(1smpl[A-Za-z0-9]+)\//.exec(url);
      if (fidm) put('drive_file', fidm[1]!);
      else if (/workspace\.slack\.example\/archives/.test(url)) put('slack_permalink', url);
      else if (!/mail\.example\.com|calendar\.example\.com|meet\.example\.com/.test(url)) put('url', url);
    }
    for (const f of (i.meta['fileRefs'] as string[] | undefined) ?? []) put('drive_file', f);
    for (const m of text.matchAll(/<@(U0SMPL\d{3})>/g)) put('person_mention', m[1]!);
    if (i.source === 'gmail') for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)) put('email_address', m[0].toLowerCase());
    for (const m of JSON.stringify(i.meta['oppHints'] ?? []).matchAll(/006SMPL\d{8}AAA/g)) put('org62_id', m[0]);
    if (i.source === 'org62' && i.meta['Id']) put('org62_id', String(i.meta['Id']));
    if (i.source === 'vdp') put('vdp_slug', String(i.meta['slug']));
    if (i.source === 'calendar' || i.source === 'gemini_notes') { if (i.meta['eventId']) put('calendar_event', String(i.meta['eventId'])); }
    if (i.source === 'claude') { put('repo_path', String(i.meta['cwd'])); for (const f of (i.meta['filesTouched'] as string[]) ?? []) put('file_path', f); }
  }
  return out;
}

// ───────────────────────── CAST addendum ─────────────────────────
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mt = (iso: string) => { const d = new Date(Date.parse(iso) - 7 * 3600_000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${DOW[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const trunc = (s: string, n: number) => ((s = s.replace(/https?:\/\/\S+/g, '[link]')).length > n ? s.slice(0, n - 1) + '…' : s).replace(/\|/g, '/').replace(/\n/g, ' ');
function castMd(counts: Record<string, number>, ncount: number, nlines: Record<string, number>): string {
  const L: string[] = [];
  L.push('# CAST addendum: domain 02 (sources)', '', 'Generated by `sample-data/generators/02-sources.ts`. Everything is invented. Row ids are `uid(<table>, <key>)` (kit.ts). Times are Mountain Time; "now" is Wed 2026-11-18 09:00.', '');
  L.push('## Counts', '', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '), '');
  L.push(`## source_items: keys \`si-001\`..\`si-${String(ncount).padStart(3, '0')}\` (contiguous, sorted by occurred_at then tag; \`uid('source_items', 'si-007')\`)`, '');
  L.push('Calendar items (kind calendar_event) are listed in the calendar table below with their `si-` key; Org62 snapshot items are in the Org62 section; noise items are listed compactly at the end of this section. The table here has the substantive Slack, Gmail, Gemini, Drive, VDP and Claude items.', '');
  L.push('| key | source/kind | when (MT) | account / opp | gist |', '|---|---|---|---|---|');
  for (const i of ITEMS) {
    if (i.source === 'calendar' || i.source === 'org62' || i.noise) continue;
    L.push(`| ${i.key} | ${i.source}/${i.kind.replace(/_/g, ' ')}${i.fromMe ? ' (from me)' : i.toMe ? ' (to me)' : ''} | ${mt(i.occurred)} | ${i.acct ?? ''}${i.opp ? ' / ' + i.opp : ''} | ${trunc(i.gist, 190)} |`);
  }
  L.push('', '### Noise items (bots, newsletters, standup chatter, digests, scratch files; never acted on)', '');
  const noise = ITEMS.filter((i) => i.noise && i.source !== 'calendar' && i.source !== 'org62');
  for (const g of ['slack', 'gmail', 'drive', 'claude']) {
    const xs = noise.filter((i) => i.source === g);
    if (xs.length) L.push(`- ${g}: ${xs.map((i) => i.key).join(', ')}`);
  }
  L.push('', '### Key slices for later domains', '');
  const k = (t: string) => itemByTag(t)?.key;
  L.push(`- Friday blueprint ask: ${k('sl-hvp-12')} (Priyanka asks, due Fri 11/20), commitment ${k('sl-hvp-14')}; SSO groups question ${k('sl-hvp-15')}; security questionnaire email ${k('em-hv-sec-1')} (due 11/24); denied-claim demo ask ${k('sl-hvp-17')}; week-4 status ask ${k('em-hv-st-4')}.`);
  L.push(`- Elderglen demo ask (storyline 2): ${k('sl-tod-06')} (Nadia), chasers ${k('sl-tod-09')}, ${k('sl-tod-10')}; OMS sandbox ${k('sl-toe-06')}, ${k('em-to-2')}; deal desk ${k('sl-tod-08')}.`);
  L.push(`- Gone quiet (storyline 3): last Anjali reply ${k('em-ns-1')} (10/25), my nudges ${k('em-ns-2')}, ${k('em-ns-3')}, Nadia's at-risk ping ${k('sl-nsf-07')}.`);
  L.push(`- Missed opp (storyline 5): ${k('sl-dmc-01')}, ${k('sl-dmc-06')}, ${k('sl-dmc-07')}, ${k('sl-dmc-08')}, demos ${k('cal-bw-demo1')} and ${k('cal-bw-demo2')}, sessions ${k('cs-01')}, ${k('cs-02')}, deck revisions ${k('dr-bw-demo-v1')}, ${k('dr-bw-demo-v2')}, ${k('dr-bw-demo-v3')}.`);
  L.push(`- Cascadia onsite/travel (storyline 6): ${k('sl-cco-01')}, flight ${k('em-cc-5')}, hotel ${k('em-cc-6')}, training reminders ${k('em-tr-1')}, ${k('em-tr-2')}, ${k('em-tr-3')}, ${k('em-tr-4')}, ${k('sl-ann-06')}, ${k('sl-dmm-02')}.`);
  L.push(`- Oakhallow order form (storyline 9: auto-close then reopen): ask ${k('sl-dmh-03')}, ${k('em-pc-1')}; my redline ${k('em-pc-2')}; late reply from Valentina ${k('em-pc-3')} (reopen trigger).`);
  L.push(`- Identity mess (storyline 10): Mari Q. alternate Slack identity ${k('sl-hvp-08')}; Tobias Reinhardt ${k('sl-con-03')}, ${k('em-al-1')}.`);
  L.push(`- Account family / VDP identity (storyline 4): ${k('sl-alw-06')}, ${k('sl-alw-07')}, VDP ${k('vdp-aw-bh')}.`);
  L.push(`- Redacted on ingest: ${ITEMS.filter((i) => i.redactCount).map((i) => i.key).join(', ')}.`);
  L.push('');
  L.push('## calendar_events: keys are the tags below, `uid(\'calendar_events\', tag)`; source item key in column si', '');
  L.push('| tag | si | when (MT) | title | organizer; attendees (person keys) | acct / opp | my resp / attendance | notes |', '|---|---|---|---|---|---|---|---|');
  for (const e of EVI) {
    const d = e.def;
    L.push(`| ${d.tag} | ${itemByTag(e.itemTag)!.key} | ${mt(e.start)}${d.allDay ? ' (all day)' : ` +${d.dur}m`} | ${trunc(d.title, 60)}${d.status && d.status !== 'confirmed' ? ` (${d.status})` : ''}${d.type && d.type !== 'default' ? ` [${d.type}]` : ''} | ${d.org}; ${[...d.att, ...(d.opt ?? []).map((x) => x + '?'), ...(d.ext ?? []).map((x) => 'ext:' + x)].join(', ')} | ${d.acct ?? ''}${d.opp ? ' / ' + d.opp : ''} | ${d.my ?? 'accepted'} / ${e.attendance} | ${e.noteKey ?? ''} |`);
  }
  L.push('', '## meeting_notes: `uid(\'meeting_notes\', key)`; Gemini items `gn-*`', '');
  L.push('| key | si | event tag | when (MT) | my next steps / total | what the owner must do |', '|---|---|---|---|---|---|');
  for (const n of NOTE_INFO) {
    const nd = NOTES.find((x) => x.key === n.key)!;
    L.push(`| ${n.key} | ${itemByTag(n.itemTag)!.key} | ${n.evi ? n.evi.def.tag : '(unmatched)'} | ${mt(n.end)} | ${n.mine}/${n.stepCount} | ${trunc(nd.steps.filter((s) => s.who.includes('owner')).map((s) => `${s.title}${s.due ? ' (' + s.due + ')' : ''}`).join('; ') || 'none for me', 170)} |`);
  }
  L.push('', '## assets: `uid(\'assets\', tag)` (Drive file id = `1smpl` + tag without punctuation); revision history for the starred ones', '');
  L.push('| tag | title | kind | acct / opp | modified (MT) by | history |', '|---|---|---|---|---|---|');
  for (const a of ALL_ASSETS) {
    if (a.tag.startsWith('gn-') || a.tag.startsWith('sc-')) continue;
    const v = VERS[a.tag];
    L.push(`| ${a.tag} | ${trunc(a.title, 60)} | ${a.kind}${a.tier === 'watched' ? ' (watched)' : ''} | ${a.acct ?? ''}${a.opp ? ' / ' + a.opp : ''} | ${mt(a.modIso ?? at(a.mod, a.modT ?? '11:00'))} ${a.by} | ${v ? `* ${v.length} snapshots v1..v${v.length} (\`asset_snapshots\` key \`<tag>:v<n>\`), status ${v[v.length - 1]!.status}` : ''} |`);
  }
  L.push('', `Gemini notes docs are assets \`gn-<meeting_notes key>\` (${NOTE_INFO.length}). \`sc-1\`..\`sc-8\` are scratch/copy files (noise). asset_snapshot_diffs: ${diffCount()} rows, key \`<tag>:<from>-<to>\`.`, '');
  L.push('## opportunity_snapshots', '', 'One per open opp: `uid(\'opportunity_snapshots\', \'<oppKey>:latest\')` (reserved by domain 01) plus history `<oppKey>:h<i>` for 12 opps (stage, amount, close-date changes). Source items `o62-opp-<oppKey>-latest` / `-h<i>`.', '');
  L.push('## vdp_records: `uid(\'vdp_records\', key)`; counts equal `detail` children and the `use_cases` table', '');
  L.push('| key | slug | company | opp | use cases (AI) | assets | AE | missing items |', '|---|---|---|---|---|---|---|---|');
  for (const v of VDPS) L.push(`| ${v.key} | ${v.slug} | ${v.company} | ${v.opp ?? ''} | ${v.uc.length} (${v.uc.filter((u) => u.ai).length}) | ${v.assets.length} | ${v.ae ? 'yes' : 'NO'} | ${trunc(v.missing.join('; ') || 'none', 150)}${v.archived ? ' [archived]' : ''}${v.gone ? ' [gone]' : ''} |`);
  L.push('', `vdp_asset_candidates: ${CANDIDATES.length} rows keyed \`<acctKey>:<asset tag>\` (target_key = account id). Status mix: ${['in_vdp', 'suggested', 'added', 'unsure', 'dismissed'].map((s) => `${s} ${CANDIDATES.filter((c) => c.status === s).length}`).join(', ')}. Saltmere POC missing assets that are suggested: hv-blueprint, hv-success, hv-demo-script, hv-demo-org.`, '');
  L.push('## org62_events: `uid(\'org62_events\', \'o62-NN\')`, Org62 id `sfId(\'00U\', NN)`, source item `o62-ev-NN`', '');
  L.push('| key | when (MT) | subject | h | task / meeting type | opp | logged | ccKey (activity entry) |', '|---|---|---|---|---|---|---|---|');
  for (const e of ORG62_EVENTS) L.push(`| ${o62Key(e.n)} | ${mt(at(e.d, e.t + ':00'))} | ${trunc(e.subject, 55)} | ${e.hours ?? 'null'} | ${e.task ?? ''}${e.meeting ? ' / ' + e.meeting : ''} | ${e.opp ?? ''} | ${mt(at(e.logged.d, e.logged.t + ':00'))}${e.deleted ? ', DELETED in Org62 ' + mt(at(e.deleted.d, e.deleted.t + ':00')) : ''} | ${e.cc ? `\`uid('activity_entries','act-${o62Key(e.n)}')\`` : 'logged by hand'} |`);
  L.push('', 'Domain 05: create `activity_entries` with keys `act-o62-NN` for every Org62 event above that has a ccKey (n = 22, 32..43 and 45); `act-o62-22` is the deleted-in-Org62 case; `o62-45` is a twin of hand-logged `o62-26` (same subject and start: the natural-duplicate case of the activity engine). Events 1..31 and 44 were logged by hand; match them to proposed entries by Subject + Start. Deal-contribution snapshot items `o62-dc-1..3`, team-member items `o62-tm-<oppKey>`.', '');
  L.push('## claude_sessions (source items, domain 05 builds `claude_sessions` on them)', '', CLAUDE_SESSIONS.map((s) => `\`${s.key}\` ${s.repo} ${mt(at(s.d, s.start + ':00'))} "${s.title}"`).join('; '), '');
  L.push('## Cross-domain refs reserved by domain 02', '', '- `activity_entries` keys `act-o62-NN` (see above), `extractors` key `link-resolver:1` (kind llm). Scan runs used: `uid(\'scan_runs\', n)` with n chosen by time (n = 1 + 159 * ((t - 2026-10-19 08:10) / (2026-11-18 08:52 - 2026-10-19 08:10)) ^ 0.88); domain 03 should make low n older. Items are tied to their connector\'s runs only by time, not by kind.', '');
  void nlines;
  return L.join('\n') + '\n';
}

// ───────────────────────── main ─────────────────────────
buildSlack();
buildMail();
extras();
assembleCalendar();
noiseExtras();
assembleDrive();
assembleOrg62();
assembleVdp();
assembleClaude();
ensureDriveItems(candidateAssetTags());
finalize();
fixSampledAt();

// number the items
ITEMS.sort((a, b) => Date.parse(a.occurred) - Date.parse(b.occurred) || (a.tag < b.tag ? -1 : 1));
ITEMS.forEach((i, n) => (i.key = `si-${String(n + 1).padStart(3, '0')}`));
const sid = (tag: string) => {
  const i = itemByTag(tag);
  if (!i) throw new Error(`no item ${tag}`);
  return uid('source_items', i.key!);
};

const itemRows: Row[] = ITEMS.map((i) => {
  const kinds = [...new Set(i.redactKinds ?? [])];
  const count = i.redactCount ?? 0;
  const content = [i.title ?? '', i.body ?? '', i.hashSeed ?? ''].join('\n');
  const changed = (i.revision ?? 1) > 1 ? i.changedAt ?? null : null;
  return {
    id: uid('source_items', i.key!), owner_user_id: OWNER, connector_id: uid('connectors', i.connector), source: i.source, kind: i.kind, external_id: i.ext, external_parent_id: i.parent ?? null, external_container_id: i.container ?? null,
    dedupe_key: i.dedupe, content_hash: sha(content), revision: i.revision ?? 1, occurred_at: i.occurred, source_updated_at: i.srcUpdated ?? null, first_seen_at: i.firstSeen, last_seen_at: i.lastSeen, content_changed_at: changed,
    first_scan_run_id: i.firstRun ?? uid('scan_runs', scanN(i.firstSeen!)), last_scan_run_id: i.lastRun ?? uid('scan_runs', scanN(i.lastSeen!)), actor_person_id: i.actor && P[i.actor] ? pid(i.actor) : null, actor_external_id: i.actorExt ?? null,
    from_me: !!i.fromMe, addressed_to_me: !!i.toMe, channel_id: i.channel ? cid(i.channel) : null, asset_id: i.asset ? uid('assets', i.asset) : null, repo_id: i.repo ? uid('repos', i.repo) : null, title: i.title ?? null, url: i.url ?? null,
    body: i.body ?? null, body_format: i.bodyFormat ?? 'plain', body_expires_at: i.body ? addMinutes(i.occurred, 90 * 1440) : null, body_purged_at: null, redacted: count > 0, redaction_count: count, redaction_kinds: kinds,
    meta: i.meta, deleted_upstream_at: i.deletedUpstream ?? null, created_at: i.firstSeen, updated_at: changed && Date.parse(changed) > Date.parse(i.lastSeen!) ? changed : i.lastSeen,
  };
});

const cal = calendarRows(sid);
const drive = driveRows(sid);
const o62 = org62Rows(sid);
const vdp = vdpRows(sid);
const cands = candidateRows();
const links = buildLinks(sid);
const refs = buildRefs(sid);

writeTable('source_items', itemRows);
writeTable('source_item_refs', refs);
writeTable('source_item_links', links);
writeTable('calendar_events', cal.events);
writeTable('calendar_event_attendees', cal.attendees);
writeTable('meeting_notes', cal.notes);
writeTable('assets', drive.assets);
writeTable('asset_snapshots', drive.snaps);
writeTable('asset_snapshot_sections', drive.sections);
writeTable('asset_snapshot_diffs', drive.diffs);
writeTable('opportunity_snapshots', o62.snaps);
writeTable('vdp_records', vdp);
writeTable('vdp_asset_candidates', cands);
writeTable('org62_events', o62.events);

// reserved rows must all exist
const have = new Set(o62.snaps.map((r) => r.id));
for (const r of reservedFor('opportunity_snapshots')) if (!have.has(uid('opportunity_snapshots', r.key))) throw new Error(`reserved opportunity_snapshots ${r.key} not created`);

const noiseCount = ITEMS.filter((i) => i.noise).length;
const counts = { source_items: itemRows.length, source_item_refs: refs.length, source_item_links: links.length, calendar_events: cal.events.length, calendar_event_attendees: cal.attendees.length, meeting_notes: cal.notes.length, assets: drive.assets.length, asset_snapshots: drive.snaps.length, asset_snapshot_sections: drive.sections.length, asset_snapshot_diffs: drive.diffs.length, opportunity_snapshots: o62.snaps.length, vdp_records: vdp.length, vdp_asset_candidates: cands.length, org62_events: o62.events.length };
writeFileSync(path.join(SAMPLE_DIR, 'CAST-sources.md'), castMd(counts, ITEMS.length, {}));
console.log(`noise items: ${noiseCount}/${ITEMS.length}`);
const bySource: Record<string, number> = {};
for (const i of ITEMS) bySource[i.source] = (bySource[i.source] ?? 0) + 1;
console.log(JSON.stringify(bySource));
flushRefs('sources');
void day; void T_NOW; void CHANNELS; void CONNECTORS; void NAME; void ASSETS; void VDPS;
