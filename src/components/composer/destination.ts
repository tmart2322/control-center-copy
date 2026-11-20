/**
 * Contract Destination ↔ compose-library Destination, plus the human labels the composer shows
 * ("Slack · #acme-ext · thread", "Gmail · reply-all · to Dana"). Pure; no React.
 */
import type { Destination, EmailAddress, Person, PersonRef, ThreadMessage } from '@/contract';
import { actionApp, changeLine } from '@/lib/actions';
import {
  lossyForSwitch,
  profileForDestination,
  serialize,
  type CapabilityProfile,
  type ComposeWarning,
  type Destination as ComposeDestination,
  type DocNode,
  type LossyNote,
  type ProfileId,
} from '@/lib/compose';

/** The compose library's destination for a contract destination (format `auto`: blocks when the doc has lists or code). */
export function toComposeDestination(d: Destination): ComposeDestination {
  // A structured action's doc is its read-only summary: plain text.
  if (d.kind === 'action') return { kind: 'plain' };
  if (d.kind === 'slack') {
    return { kind: 'slack', channelId: d.channelId, ...(d.threadTs ? { threadTs: d.threadTs } : {}), format: 'auto' };
  }
  return {
    kind: 'email',
    to: d.to.map((a) => a.email),
    cc: d.cc.map((a) => a.email),
    bcc: [],
    subject: d.subject,
    ...(d.inReplyTo ? { inReplyTo: d.inReplyTo } : {}),
  };
}

export function profileFor(d: Destination, doc: DocNode): CapabilityProfile {
  return profileForDestination(toComposeDestination(d), doc);
}

/** Library profile id → contract/DATA-MODEL rendition format (`plain` is `plain_text` there). */
export function renditionFormatFor(profile: ProfileId): 'slack_mrkdwn' | 'slack_blocks' | 'email_html' | 'plain_text' {
  return profile === 'plain' ? 'plain_text' : profile;
}

export const channelName = (d: Destination): string => (d.kind === 'slack' ? 'Slack' : d.kind === 'action' ? actionApp(d.action) : 'Gmail');

function firstName(a: EmailAddress): string {
  const n = a.name?.trim();
  if (n) return n.split(/\s+/)[0]!;
  return a.email.split('@')[0]!;
}

const EMAIL_TARGET: Record<'reply' | 'reply_all' | 'new' | 'forward', string> = {
  reply: 'reply',
  reply_all: 'reply-all',
  new: 'new',
  forward: 'forward',
};

/** Label parts, e.g. ['Slack', '#acme-ext', 'thread'] or ['Gmail', 'reply-all', 'to Dana +1']. */
export function destinationParts(d: Destination): string[] {
  if (d.kind === 'slack') {
    if (d.target === 'dm') return ['Slack', 'DM', d.channelName];
    if (d.target === 'thread' || d.threadTs) return ['Slack', d.channelName, 'thread'];
    return ['Slack', d.channelName];
  }
  if (d.kind === 'action') return [actionApp(d.action), d.target.label];
  const extra = d.to.length - 1 + d.cc.length;
  const to = `to ${firstName(d.to[0]!)}${extra > 0 ? ` +${extra}` : ''}`;
  return ['Gmail', EMAIL_TARGET[d.target], to];
}

export function destinationLabel(d: Destination): string {
  return destinationParts(d).join(' · ');
}

/** Short "where" for buttons and toasts: "#acme-ext", "@Priya Shah", "Marcus Webb". */
export function destinationShort(d: Destination): string {
  if (d.kind === 'slack') return d.channelName;
  if (d.kind === 'action') return d.target.label;
  const a = d.to[0]!;
  const extra = d.to.length - 1 + d.cc.length;
  return `${a.name ?? a.email}${extra > 0 ? ` +${extra}` : ''}`;
}

/** Stable identity used to compare destinations (switch menu, conflict checks). */
export function destinationKey(d: Destination): string {
  if (d.kind === 'slack') return `slack:${d.target}:${d.channelId}:${d.threadTs ?? ''}`;
  if (d.kind === 'action') return `action:${d.action}:${JSON.stringify(d.input)}`;
  return `email:${d.target}:${d.to.map((a) => a.email).join(',')}:${d.cc.map((a) => a.email).join(',')}:${d.threadId ?? ''}`;
}

export interface RecipientRow {
  label: string;
  value: string;
}

const fmtAddr = (a: EmailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email);

/** Rows for the confirm dialog: who receives this, exactly. */
export function recipientRows(d: Destination): RecipientRow[] {
  if (d.kind === 'slack') {
    const rows: RecipientRow[] = [
      { label: d.target === 'dm' ? 'Direct message' : 'Channel', value: d.channelName + (d.workspace ? ` (${d.workspace})` : '') },
    ];
    if (d.threadTs) rows.push({ label: 'Thread', value: 'Reply in thread, not sent to the channel' });
    else if (d.target === 'channel') rows.push({ label: 'Posts', value: 'Top-level message, visible to everyone in the channel' });
    return rows;
  }
  if (d.kind === 'action') {
    return [{ label: actionApp(d.action), value: d.target.label }, ...d.changes.map((c) => ({ label: 'Change', value: changeLine(c) }))];
  }
  const rows: RecipientRow[] = [{ label: 'To', value: d.to.map(fmtAddr).join(', ') }];
  if (d.cc.length) rows.push({ label: 'Cc', value: d.cc.map(fmtAddr).join(', ') });
  rows.push({ label: 'Subject', value: d.subject || '(no subject)' });
  return rows;
}

// ---------------------------------------------------------------------------
// Switching the destination chip
// ---------------------------------------------------------------------------

export interface SwitchOption {
  destination: Destination;
  label: string;
  /** Formatting that changes or drops (from `lossyForSwitch`, plus mentions with no id there). Empty = no change. */
  lossy: LossyNote[];
  warnings: ComposeWarning[];
  current: boolean;
  /** The doc to apply with the switch: mentions re-resolved to the target's ids. */
  doc: DocNode;
}

type MentionPerson = Pick<Person, 'id' | 'name'> & Partial<Pick<Person, 'email' | 'slackHandle'>>;

/**
 * Re-resolve user mentions for another destination: Slack needs a Slack id, email needs an address.
 * Mentions that can't be resolved become the plain name (and are reported as lossy).
 */
export function remapMentions(doc: DocNode, to: Destination, people: MentionPerson[] = []): { doc: DocNode; unresolved: string[] } {
  const unresolved: string[] = [];
  const find = (id: string, label: string, email?: string) =>
    people.find((p) => p.slackHandle === id || (p.email && (p.email === id || p.email === email)) || p.id === id) ?? people.find((p) => p.name === label);
  const walk = (n: DocNode): DocNode => {
    if (n.type === 'mention') {
      const a = n.attrs ?? {};
      const kind = String(a.kind ?? 'user');
      if (kind !== 'user') return n;
      const id = String(a.id ?? '');
      const label = String(a.label ?? id);
      const email = typeof a.email === 'string' ? a.email : undefined;
      const p = find(id, label, email);
      if (to.kind === 'slack') {
        const sid = p?.slackHandle ?? (/^[UW][A-Z0-9]+$/.test(id) ? id : undefined);
        if (sid) return { ...n, attrs: { id: sid, label: p?.name ?? label, kind: 'user' } };
      } else {
        const addr = p?.email ?? email;
        if (addr) return { ...n, attrs: { id: addr, label: p?.name ?? label, kind: 'user', email: addr } };
      }
      unresolved.push(label);
      return { type: 'text', text: label, ...(n.marks ? { marks: n.marks } : {}) };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { doc: walk(doc), unresolved };
}

/** Plain-language line for one lossy note: "Heading → bold line (×2)". */
export function lossyLine(n: LossyNote): string {
  // Library ids ("bulletList", "heading") read as words; composed phrases (with spaces) are kept as written.
  const nice = (s: string) => (/\s/.test(s) ? s : s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  const from = nice(n.from);
  const to = nice(n.to);
  const head = from.charAt(0).toUpperCase() + from.slice(1);
  return `${head} → ${to}${n.count > 1 ? ` (×${n.count})` : ''}`;
}

type PersonLike = Pick<Person, 'id' | 'name'> & Partial<Pick<Person, 'email' | 'slackHandle' | 'isExternal'>>;

/**
 * Candidate destinations for the switch menu. Explicit `extra` wins; otherwise derive from the current
 * destination (thread ↔ top-level) and from the people on this work (Gmail to anyone with an email,
 * Slack DM to anyone with a Slack id).
 */
export function switchCandidates(current: Destination, people: PersonLike[] = [], extra: Destination[] = [], subjectHint = ''): Destination[] {
  // A structured action has one target: there is nowhere else to send it.
  if (current.kind === 'action') return [current];
  const out: Destination[] = [current, ...extra];
  if (current.kind === 'slack' && current.threadTs) {
    out.push({ ...current, target: 'channel', threadTs: null });
  } else if (current.kind === 'slack' && current.target === 'channel') {
    // No thread to go back to; keep the channel only.
  }
  if (current.kind === 'email' && current.target === 'reply' && current.cc.length === 0) {
    // reply ↔ reply-all differ only in cc; nothing to derive without more people.
  }
  for (const p of people) {
    if (p.slackHandle && !(current.kind === 'slack' && current.target === 'dm' && current.channelId === p.slackHandle)) {
      out.push({ kind: 'slack', target: 'dm', channelId: p.slackHandle, channelName: `@${p.name}`, threadTs: null });
    }
    if (p.email && !(current.kind === 'email' && current.to.length === 1 && current.to[0]!.email === p.email)) {
      out.push({
        kind: 'email',
        target: 'new',
        to: [{ name: p.name, email: p.email }],
        cc: [],
        subject: current.kind === 'email' ? current.subject : subjectHint,
        threadId: null,
        inReplyTo: null,
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = destinationKey(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function switchOptions(current: Destination, doc: DocNode, candidates: Destination[], people: MentionPerson[] = []): SwitchOption[] {
  const curKey = destinationKey(current);
  return candidates.map((d) => {
    const isCurrent = destinationKey(d) === curKey;
    if (isCurrent) return { destination: d, label: destinationLabel(d), lossy: [], warnings: serialize(doc, toComposeDestination(d)).warnings, current: true, doc };
    const remap = remapMentions(doc, d, people);
    const target = toComposeDestination(d);
    const lossy = lossyForSwitch(remap.doc, target);
    if (remap.unresolved.length) {
      lossy.push({ kind: 'mention', from: `Mention of ${remap.unresolved.join(', ')}`, to: `plain name (no ${d.kind === 'slack' ? 'Slack id' : 'email address'} on file)`, count: 1 });
    }
    return { destination: d, label: destinationLabel(d), lossy, warnings: serialize(remap.doc, target).warnings, current: false, doc: remap.doc };
  });
}

/** Broadcast mentions (@here, @channel, @everyone) and other serializer warnings for a destination. */
export function warningsFor(d: Destination, doc: DocNode): ComposeWarning[] {
  return serialize(doc, toComposeDestination(d)).warnings;
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

export type MentionKind = 'user' | 'channel' | 'usergroup' | 'special';

export interface MentionCandidate {
  /** Destination-native id: Slack user id (U…) or the special name (here, channel, everyone). */
  id: string;
  label: string;
  kind: MentionKind;
  email?: string;
  detail?: string;
  /** Present when the person can't be resolved to an id for this destination. */
  unresolved?: string;
}

const SPECIALS: MentionCandidate[] = [
  { id: 'here', label: 'here', kind: 'special', detail: 'Notifies everyone active in the conversation' },
  { id: 'channel', label: 'channel', kind: 'special', detail: 'Notifies everyone in the conversation' },
];

/**
 * Mention candidates for a destination. Slack mentions need a Slack id; email mentions need an address
 * (they serialize as mailto links). People without one are listed but disabled, so a pill always
 * resolves to a real id.
 */
export function mentionCandidates(d: Destination, people: PersonLike[], query: string): MentionCandidate[] {
  if (d.kind === 'action') return [];
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const p of people) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (q && !p.name.toLowerCase().includes(q)) continue;
    if (d.kind === 'slack') {
      out.push(
        p.slackHandle
          ? { id: p.slackHandle, label: p.name, kind: 'user', detail: p.isExternal ? 'External' : undefined }
          : { id: p.id, label: p.name, kind: 'user', unresolved: 'No Slack id on file' },
      );
    } else {
      out.push(
        p.email
          ? { id: p.email, label: p.name, kind: 'user', email: p.email, detail: p.email }
          : { id: p.id, label: p.name, kind: 'user', unresolved: 'No email address on file' },
      );
    }
  }
  if (d.kind === 'slack' && d.target !== 'dm') out.push(...SPECIALS.filter((s) => !q || s.label.startsWith(q)));
  return out.slice(0, 8);
}

/** People known from the thread context (PersonRef only: no ids for Slack or email). */
export function threadPeople(messages: ThreadMessage[]): PersonRef[] {
  const seen = new Map<string, PersonRef>();
  for (const m of messages) if (!m.isMe && !seen.has(m.author.id)) seen.set(m.author.id, m.author);
  return [...seen.values()];
}

/** id → label for every mention in a doc (payloads carry ids only; previews need names). */
export function mentionLabels(doc: DocNode, people: PersonLike[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of people) {
    if (p.slackHandle) out[p.slackHandle] = p.name;
  }
  const walk = (n: DocNode) => {
    if (n.type === 'mention') {
      const id = String(n.attrs?.id ?? '');
      const label = n.attrs?.label;
      if (id && typeof label === 'string' && label) out[id] = label;
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}
