/**
 * Domain 02 (sources) shared helpers: people/channel/account lookups, the source-item registry and the Slack/Gmail
 * builders the hand-written data modules use. Everything is invented; ids carry the SMPL/smpl marker.
 */
import { addMinutes, at, readTable, sha, slackTs, uid } from '../../lib/kit';
import { ACCOUNTS, OPPS } from './core-deals';
import { PEOPLE } from './core-people';

export { at, addMinutes, sha, uid };
export const OWNER_EMAIL = 'rafael.okonkwo@example.com';
export const OWNER_SLACK = 'U0SMPL001';
export const CAL_ID = OWNER_EMAIL;

// ── lookups ─────────────────────────────────────────────────────────────────────────────────────
export const P = Object.fromEntries(PEOPLE.map((p) => [p.key, p]));
export const pid = (k: string) => uid('people', k);
export const aid = (k: string) => uid('accounts', k);
export const oid = (k: string) => uid('opportunities', k);
export const cid = (k: string) => uid('channels', k);
export const slackOf = (k: string): string | null => (P[k]?.slack ? `U0SMPL${String(P[k]!.slack).padStart(3, '0')}` : null);
export const OPP_SF = (key: string) => `006SMPL${String(OPPS.findIndex((o) => o.key === key) + 1).padStart(8, '0')}AAA`;
export const ACCT_SF = (key: string) => `001SMPL${String(ACCOUNTS.findIndex((a) => a.key === key) + 1).padStart(8, '0')}AAA`;
export const OPP_BY_KEY = Object.fromEntries(OPPS.map((o) => [o.key, o]));
export const acctOfOpp = (k: string) => OPP_BY_KEY[k]!.acct;
const chRows = readTable('channels');
export const CHANNELS = Object.fromEntries(
  chRows.map((r) => [r.id as string, { id: r.id as string, ext: r.external_id as string, name: r.name as string | null, kind: r.kind as string }]),
);
export const CH = (key: string) => {
  const c = CHANNELS[cid(key)];
  if (!c) throw new Error(`unknown channel ${key}`);
  return c;
};
export const CONNECTORS = ['slack', 'gmail-work', 'gmail-shared', 'drive', 'calendar', 'gemini-notes', 'org62', 'claude', 'vdp'] as const;
export const NAME = (k: string) => P[k]?.name ?? k;
export const FIRST = (k: string) => NAME(k).split(' ')[0]!;
export const EMAIL = (k: string) => P[k]!.email;
export const M = (k: string) => `<@${slackOf(k)}>`; // slack @mention
export const ME = M('owner');

// ── time ────────────────────────────────────────────────────────────────────────────────────────
export const D = (off: number, hhmm: string) => at(off, hhmm);
export const T_START = at(-30, '08:10'); // first scan
export const T_NOW = at(0, '09:00');
export const T_SCAN_END = at(0, '08:58');
/** Scan run number 1..160 for an instant (domain 03: runs are ordered by time, low = oldest). */
export function scanN(iso: string): number {
  const f = Math.min(1, Math.max(0, (Date.parse(iso) - Date.parse(T_START)) / (Date.parse(T_SCAN_END) - Date.parse(T_START))));
  return Math.min(160, Math.max(1, 1 + Math.round(159 * Math.pow(f, 0.88))));
}

// ── file ids (Drive) ────────────────────────────────────────────────────────────────────────────
export type FileKind = 'doc' | 'deck' | 'sheet';
export const fid = (tag: string) => `1smpl${tag.replace(/[^a-zA-Z0-9]/g, '')}`;
export const furl = (tag: string, kind: FileKind = 'doc') =>
  kind === 'deck' ? `https://slides.example.com/presentation/d/${fid(tag)}/edit` : kind === 'sheet' ? `https://sheets.example.com/spreadsheets/d/${fid(tag)}/edit` : `https://docs.example.com/document/d/${fid(tag)}/edit`;

// ── the registry ────────────────────────────────────────────────────────────────────────────────
export type LinkSpec = {
  to: 'account' | 'opportunity' | 'person' | 'asset' | 'event';
  key: string;
  role?: 'about' | 'from' | 'to' | 'mentions' | 'attachment' | 'container';
  method?: 'connector' | 'rule' | 'llm' | 'user' | 'chat';
  conf?: number;
  rule?: string;
  verdict?: 'confirmed' | 'rejected';
};
export type Item = {
  key?: string; // si-NNN, assigned after sorting
  tag: string;
  source: 'slack' | 'gmail' | 'calendar' | 'drive' | 'gemini_notes' | 'org62' | 'vdp' | 'claude';
  kind: 'slack_message' | 'email_message' | 'calendar_event' | 'drive_file_revision' | 'gemini_note' | 'org62_record_snapshot' | 'vdp_record_snapshot' | 'claude_session';
  connector: (typeof CONNECTORS)[number];
  ext: string;
  parent?: string | null;
  container?: string | null;
  dedupe: string;
  occurred: string;
  srcUpdated?: string | null;
  firstSeen?: string;
  lastSeen?: string;
  changedAt?: string | null;
  revision?: number;
  actor?: string | null; // person key
  actorExt?: string | null;
  fromMe?: boolean;
  toMe?: boolean;
  channel?: string; // channel key
  asset?: string; // asset tag
  repo?: string;
  title?: string | null;
  url?: string | null;
  body?: string | null;
  bodyFormat?: 'plain' | 'markdown' | 'slack_mrkdwn' | 'html';
  redactKinds?: string[];
  redactCount?: number;
  meta: Record<string, unknown>;
  acct?: string;
  opp?: string;
  links?: LinkSpec[];
  gist: string;
  noise?: boolean;
  deletedUpstream?: string | null;
  bodyPurged?: boolean;
  hashSeed?: string;
  linkMethod?: LinkSpec['method'];
  linkRule?: string;
  linkConf?: number;
  noLinks?: boolean;
  firstRun?: string; // scan_runs id (domain 03) that first read it
  lastRun?: string;
};
export const ITEMS: Item[] = [];
const TAGS = new Set<string>();
export function addItem(i: Item): Item {
  if (TAGS.has(i.tag)) throw new Error(`duplicate item tag ${i.tag}`);
  TAGS.add(i.tag);
  ITEMS.push(i);
  return i;
}
export const itemByTag = (tag: string) => ITEMS.find((i) => i.tag === tag);

// ── Slack builder ───────────────────────────────────────────────────────────────────────────────
let slackSeq = 0;
const slackRoots = new Map<string, { ts: string; ch: string }>();
const slackTsByTag = new Map<string, string>();
export type SlackOpts = {
  tag: string;
  ch: string; // channel key
  d: number; // day offset
  t: string; // HH:MM[:SS]
  who: string; // person key | 'bot:<name>' | 'ext:<name>'
  text: string;
  thread?: string; // tag of the thread root
  acct?: string;
  opp?: string;
  toMe?: boolean;
  noise?: boolean;
  gist?: string;
  files?: Array<{ name: string; mimetype: string }>;
  triage?: { v: 'act' | 'noise' | 'unsure'; why: string };
  altSlack?: boolean; // posted under the duplicate Slack identity (Mari Q.)
  asset?: string;
  edited?: boolean;
  query?: 'mentions' | 'dm' | 'channel' | 'thread' | 'watch';
  redact?: string[];
};
export function slack(o: SlackOpts): Item {
  const chan = CH(o.ch);
  const iso = at(o.d, o.t.length === 5 ? o.t + ':00' : o.t);
  const ts = slackTs(iso, ++slackSeq);
  slackTsByTag.set(o.tag, ts);
  let parentTs: string | null = null;
  if (o.thread) {
    const r = slackRoots.get(o.thread) ?? { ts: slackTsByTag.get(o.thread)!, ch: o.ch };
    if (!r.ts) throw new Error(`thread root ${o.thread} not defined before ${o.tag}`);
    parentTs = r.ts;
  } else slackRoots.set(o.tag, { ts, ch: o.ch });
  const isDm = chan.kind === 'dm' || chan.kind === 'group_dm';
  const bot = o.who.startsWith('bot:');
  const ext = o.who.startsWith('ext:');
  const key = bot || ext ? null : o.who;
  const authorName = bot ? o.who.slice(4) : ext ? o.who.slice(4) : o.altSlack ? 'Mari Q.' : NAME(o.who);
  const authorId = bot ? `B0SMPL${String(100 + [...o.who].reduce((s, c) => s + c.charCodeAt(0), 0) % 800).padStart(3, '0')}` : ext ? 'U0SMPL099' : o.altSlack ? 'U0SMPL039' : slackOf(o.who);
  const email = key ? (o.altSlack ? 'mari.q@saltmere-health.example' : P[key]?.email) : undefined;
  const fromMe = o.who === 'owner';
  const mentionsMe = o.text.includes(`<@${OWNER_SLACK}`);
  const toMe = !fromMe && (o.toMe ?? (chan.kind === 'dm' || mentionsMe));
  const threadRoot = parentTs ?? ts;
  const participants =
    chan.kind === 'dm' || chan.kind === 'group_dm'
      ? chan.kind === 'dm'
        ? [{ externalId: OWNER_SLACK, isMe: true, name: NAME('owner') }, ...(o.ch === 'dm-mgr' ? [{ externalId: slackOf('mgr')!, isMe: false, name: NAME('mgr') }] : o.ch === 'dm-ae-harbor' ? [{ externalId: slackOf('ae-harbor')!, isMe: false, name: NAME('ae-harbor') }] : [{ externalId: slackOf('ae-commercial')!, isMe: false, name: NAME('ae-commercial') }])]
        : ['owner', 'ae-harbor', 'mgr'].map((k) => ({ externalId: slackOf(k)!, isMe: k === 'owner', name: NAME(k) }))
      : undefined;
  const meta: Record<string, unknown> = {
    connector: 'slack',
    itemKind: 'message',
    rec: 'auto',
    channelId: chan.ext,
    ...(chan.name ? { channelName: chan.name } : {}),
    channelType: chan.kind === 'dm' ? 'im' : chan.kind === 'group_dm' ? 'mpim' : 'channel',
    ts,
    ...(parentTs ? { threadTs: parentTs } : {}),
    isReply: !!parentTs,
    threadRef: `slack:${chan.ext}:${threadRoot}`,
    query: o.query ?? (isDm ? 'dm' : mentionsMe ? 'mentions' : 'channel'),
    author: { name: authorName, ...(email ? { email } : {}), externalId: authorId, isMe: fromMe },
    ...(toMe ? { toMe: true } : {}),
    ...(participants ? { participants } : {}),
    ...(o.files ? { hasFile: true, files: o.files.map((f, i) => ({ id: `F0SMPL${String(10 + i + slackSeq % 80).padStart(3, '0')}`, name: f.name, mimetype: f.mimetype })) } : {}),
    ...(o.triage ? { triage: { ...o.triage, v: o.triage.v, at: addMinutes(iso, 6) } } : {}),
  };
  const permalink = `https://workspace.slack.example/archives/${chan.ext}/p${ts.replace('.', '')}${parentTs ? `?thread_ts=${parentTs}&cid=${chan.ext}` : ''}`;
  return addItem({
    tag: o.tag,
    source: 'slack',
    kind: 'slack_message',
    connector: 'slack',
    ext: `${chan.ext}:${ts}`,
    parent: parentTs,
    container: chan.ext,
    dedupe: `slack:${chan.ext}:${ts}`,
    occurred: iso,
    actor: key && !o.altSlack ? key : o.altSlack ? 'hv-marisol' : null,
    actorExt: authorId,
    fromMe,
    toMe,
    channel: o.ch,
    asset: o.asset,
    url: permalink,
    body: o.text,
    meta,
    acct: o.acct,
    opp: o.opp,
    gist: o.gist ?? `${authorName}: ${o.text.replace(/<@(U0SMPL\d{3})>/g, (_m, id: string) => '@' + (Object.keys(P).find((k) => slackOf(k) === id) ? FIRST(Object.keys(P).find((k) => slackOf(k) === id)!) : 'someone')).replace(/https?:\/\/\S+/g, '[link]').replace(/\s+/g, ' ').slice(0, 110)}`,
    noise: o.noise,
    redactKinds: o.redact,
    redactCount: o.redact?.length,
    srcUpdated: o.edited ? addMinutes(iso, 20) : null,
  });
}

// ── Gmail builder ───────────────────────────────────────────────────────────────────────────────
export type MailOpts = {
  tag: string;
  thread: string; // thread slug
  d: number;
  t: string;
  from: string; // person key | raw email "Name <a@b.example>"
  to: string[]; // person keys or raw "Name <email>"
  cc?: string[];
  subject: string;
  body: string;
  acct?: string;
  opp?: string;
  noise?: boolean;
  gist?: string;
  conn?: 'gmail-work' | 'gmail-shared';
  bulk?: boolean;
  calendarNotice?: boolean;
  attach?: string[]; // asset tags attached / linked
  hasAttachment?: boolean;
  toMeOverride?: boolean;
  redact?: string[];
  extra?: Record<string, unknown>;
  label?: string;
  threadSize?: number;
  repliedByMe?: boolean;
  lastFromMe?: boolean;
};
const parseAddr = (s: string) => {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(s);
  return m ? { name: m[1]!.trim(), email: m[2]!.trim() } : { name: NAME(s) === s ? s.split('@')[0]! : NAME(s), email: P[s]?.email ?? s };
};
export function mail(o: MailOpts): Item {
  const iso = at(o.d, o.t.length === 5 ? o.t + ':00' : o.t);
  const hex = sha(o.tag).slice(0, 12);
  const id = `smplm${hex}`;
  const threadId = `smplthr${sha('thr:' + o.thread).slice(0, 10)}`;
  const from = parseAddr(o.from);
  const toL = o.to.map(parseAddr);
  const ccL = (o.cc ?? []).map(parseAddr);
  const fromMe = from.email === OWNER_EMAIL;
  const toMe = !fromMe && (o.toMeOverride ?? toL.some((x) => x.email === OWNER_EMAIL));
  const ccMe = !fromMe && ccL.some((x) => x.email === OWNER_EMAIL);
  const myDomain = 'example.com';
  const isExt = (e: string) => e.split('@')[1] !== myDomain;
  const urls = [...o.body.matchAll(/https?:\/\/[^\s)>"]+/g)].map((m) => m[0]);
  const fileRefs = [...new Set(urls.map((u) => /\/d\/([^/]+)\//.exec(u)?.[1]).filter((x): x is string => !!x))];
  const parts = [...toL, ...ccL].map((x) => ({ email: x.email, name: x.name, isExternal: isExt(x.email), isMe: x.email === OWNER_EMAIL }));
  const messageIdHeader = `<${id}@mail.example>`;
  const meta: Record<string, unknown> = {
    connector: 'gmail',
    itemKind: 'email',
    direction: fromMe ? 'outbound' : 'inbound',
    scope: fromMe ? 'sent' : toMe ? 'inbox' : 'cc',
    subject: o.subject,
    title: o.subject,
    from: `${from.name} <${from.email}>`,
    to: toL.map((x) => `${x.name} <${x.email}>`).join(', '),
    ...(ccL.length ? { cc: ccL.map((x) => `${x.name} <${x.email}>`).join(', ') } : {}),
    toMe,
    ccMe,
    bulk: !!o.bulk,
    calendarNotice: !!o.calendarNotice,
    hasAttachment: !!o.hasAttachment || !!o.attach?.length,
    mentionsAttachment: /attached|attaching|see attached/i.test(o.body),
    messageIdHeader,
    threadRef: `gmail-thread:${threadId}`,
    threadSize: o.threadSize ?? 1,
    repliedByMe: o.repliedByMe ?? fromMe,
    ...(o.lastFromMe !== undefined ? { lastMessageFromMe: o.lastFromMe } : {}),
    author: { name: from.name, email: from.email, isExternal: isExt(from.email), isMe: fromMe },
    participants: parts,
    urls: urls.slice(0, 15),
    ...(fileRefs.length ? { fileRefs } : {}),
    ...(o.extra ?? {}),
  };
  const actorKey = Object.keys(P).find((k) => P[k]!.email === from.email) ?? null;
  return addItem({
    tag: o.tag,
    source: 'gmail',
    kind: 'email_message',
    connector: o.conn ?? 'gmail-work',
    ext: id,
    parent: threadId,
    container: o.label ?? (fromMe ? 'SENT' : 'INBOX'),
    dedupe: `gmail:${id}`,
    occurred: iso,
    actor: actorKey,
    actorExt: from.email,
    fromMe,
    toMe: toMe || !!ccMe && false,
    title: o.subject,
    url: `https://mail.example.com/mail/u/0/#all/${threadId}`,
    body: o.body,
    meta,
    acct: o.acct,
    opp: o.opp,
    gist: o.gist ?? `${from.name}${fromMe ? ' (me)' : ''} → ${toL[0]?.name ?? ''}: ${o.subject}`,
    noise: o.noise,
    redactKinds: o.redact,
    redactCount: o.redact?.length,
    links: (o.attach ?? []).map((a) => ({ to: 'asset' as const, key: a, role: 'attachment' as const, method: 'connector' as const, conf: 1 })),
  });
}

export const sig = (k: string) => `\n\n${k === 'owner' ? 'Rafael' : FIRST(k)}`;
