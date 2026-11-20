/**
 * Feedback obfuscation (D-56): every account, person and opportunity the app's database knows, by name, email, Slack
 * id, Org62 id or app id, becomes a stable placeholder (CUSTOMER_1, PERSON_2, OPP_3). Then leftover email, Slack id,
 * Org62 id, phone and UUID patterns go, ids inside URLs and routes go, and credentials are masked (src/llm/redact.ts).
 *
 * It runs on the user's text before the diagnose agent sees it, on every app-data tool result the agent reads, on
 * the agent's report, and again on the message the user edited before it is staged. Placeholders are numbered by the
 * entity's position in the term list sorted by name (then id), not by where it first appears, so CUSTOMER_4 means the same account in
 * every pass (a second scrub of edited text never renumbers or collides).
 *
 * Pure: the term list comes from the DataSource (`scrubTermsFrom` for mock collections, src/server/feedback/terms.ts
 * for Postgres). Placeholders and counts leave this module; real values never do.
 */
import { redact } from '@/llm/redact';

export type ScrubKind = 'account' | 'person' | 'opp';

export interface ScrubEntity {
  /** The app's own id (a placeholder replaces it too, so "/deals/<id>" reads "/deals/CUSTOMER_1"). */
  id: string;
  /** Names and aliases ("ACME Corporation", "ACME"). */
  names: string[];
  /** External ids: Org62 ids, Slack user ids, identity ids. */
  ids?: string[];
  emails?: string[];
}

export interface ScrubTerms {
  accounts: ScrubEntity[];
  people: ScrubEntity[];
  opps: ScrubEntity[];
}

export const EMPTY_TERMS: ScrubTerms = { accounts: [], people: [], opps: [] };

const PREFIX: Record<ScrubKind, string> = { account: 'CUSTOMER', person: 'PERSON', opp: 'OPP' };

/**
 * Words never scrubbed on their own (a person called "Will", an account called "Data"): product, app and common
 * words. A full multi-word name is always scrubbed, stop word or not.
 */
const STOP = new Set(
  (
    'a an and the of for to in on at by with from or not new old my me you we our your team sales service services group global ' +
    'data cloud ai app apps api web platform labs lab tech technology technologies systems solutions partners international holdings ' +
    'company co corp corporation inc llc ltd plc gmbh ag sa bank health energy capital consulting digital media software ' +
    'slack gmail google calendar drive gemini org62 vdp claude anthropic salesforce tableau mulesoft agentforce einstein ' +
    'home time deals work outbox settings assistant feedback bug idea report page today week log deal opp opportunity account person customer ' +
    'will may june april august march mark bill art grant chase hope faith joy rose summer page case lane park young king long ' +
    'white black brown green gray grey hall wood ward rich sharp little small cook north south east west'
  ).split(/\s+/),
);

const CORP_SUFFIX = /[,.]?\s+(?:inc\.?|incorporated|corp\.?|corporation|co\.?|company|llc|l\.l\.c\.|ltd\.?|limited|plc|gmbh|ag|s\.?a\.?|group|holdings)$/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Name variants worth matching: the full name, the name without its corporate suffix, a person's name parts. */
function variants(kind: ScrubKind, name: string): string[] {
  const full = norm(name);
  if (!full) return [];
  const out = new Set<string>([full]);
  if (kind === 'account') {
    const core = full.replace(CORP_SUFFIX, '').trim();
    if (core && core !== full) out.add(core);
  }
  if (kind === 'person') {
    for (const part of full.split(/[\s,]+/)) if (part.length >= 3) out.add(part);
  }
  return [...out].filter((v) => v.length >= 3 && (v.includes(' ') || !STOP.has(v.toLowerCase())));
}

// Leftover patterns (after the DB-known terms).
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SLACK_MENTION = /<@([UW][A-Z0-9]{6,})(?:\|[^>]*)?>/g;
const SLACK_ID = /\b[UWCGD](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/g;
const ORG62_ID = /\b(?:00[1-9A-Za-z]|0[1-9A-Za-z]{2}|500|a0[0-9A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PHONE = /(?<![\w.])(?:\+\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w])/g;
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/g;
/** An id-looking URL segment or query value: UUIDs, Slack and Org62 ids, permalink stamps, long digit or token runs. */
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[UWCGDFT](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}|p\d{10,}|\d{6,}(?:\.\d+)?|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{15,})$/;
const PLACEHOLDER = /^(?:CUSTOMER|PERSON|OPP)_\d+$/;

export interface ScrubStats {
  /** Replacements made by this scrubber so far (every pass). */
  count: number;
}

export class Scrubber {
  private readonly exact = new Map<string, string>();
  private readonly nameRe: RegExp | null;
  private readonly nameMap = new Map<string, string>();
  readonly stats: ScrubStats = { count: 0 };

  constructor(terms: ScrubTerms = EMPTY_TERMS) {
    const names: string[] = [];
    const add = (kind: ScrubKind, list: ScrubEntity[]) => {
      // By name, then id: the same numbering on the mock and on Postgres (their ids differ), and in every pass.
      const key = (e: ScrubEntity) => (e.names[0] ?? '').trim().toLowerCase();
      const sorted = [...list].sort((a, b) => key(a).localeCompare(key(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      sorted.forEach((e, i) => {
        const ph = `${PREFIX[kind]}_${i + 1}`;
        for (const x of [e.id, ...(e.ids ?? [])]) if (x && x.length >= 4) this.exact.set(x, ph);
        for (const m of e.emails ?? []) if (m.includes('@')) this.exact.set(m.toLowerCase(), ph);
        for (const n of e.names) {
          for (const v of variants(kind, n)) {
            const key = v.toLowerCase();
            // The first owner keeps a shared variant (two people called "Sam": the full names still differ).
            if (!this.nameMap.has(key)) {
              this.nameMap.set(key, ph);
              names.push(v);
            }
          }
        }
      });
    };
    // Opps first so their numbering is independent; matching is longest-first anyway.
    add('opp', terms.opps);
    add('account', terms.accounts);
    add('person', terms.people);
    names.sort((a, b) => b.length - a.length);
    this.nameRe = names.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'giu') : null;
  }

  /** The placeholder for one exact value the database knows (an id or an email), if any. */
  private exactFor(v: string): string | undefined {
    return this.exact.get(v) ?? this.exact.get(v.toLowerCase());
  }

  private bump<T>(v: T): T {
    this.stats.count += 1;
    return v;
  }

  /** One id-looking URL or route segment → its placeholder, or `ID`. */
  private segment(seg: string): string {
    if (!seg || PLACEHOLDER.test(seg)) return seg;
    let dec = seg;
    try {
      dec = decodeURIComponent(seg);
    } catch {
      /* keep raw */
    }
    const known = this.exactFor(dec);
    if (known) return this.bump(known);
    return ID_SEGMENT.test(dec) ? this.bump('ID') : seg;
  }

  /** A path ("/deals/<id>?item=<id>") with its ids replaced; the rest of the scrub runs on it too. */
  scrubRoute(route: string): string {
    const [path, query] = route.split('?', 2) as [string, string | undefined];
    const p = path
      .split('/')
      .map((s) => this.segment(s))
      .join('/');
    const q = query
      ? query
          .split('&')
          .map((kv) => {
            const [k, v] = kv.split('=', 2) as [string, string | undefined];
            return v === undefined ? kv : `${k}=${this.segment(v)}`;
          })
          .join('&')
      : null;
    return this.scrub(q !== null ? `${p}?${q}` : p);
  }

  private url(u: string): string {
    const m = /^(https?:\/\/[^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(u);
    if (!m) return u;
    const host = m[1]!;
    const path = (m[2] ?? '')
      .split('/')
      .map((s) => this.segment(s))
      .join('/');
    const query = m[3]
      ? `?${m[3]
          .slice(1)
          .split('&')
          .map((kv) => {
            const [k, v] = kv.split('=', 2) as [string, string | undefined];
            return v === undefined ? kv : `${k}=${this.segment(v)}`;
          })
          .join('&')}`
      : '';
    return `${host}${path}${query}`;
  }

  /** The whole scrub, in order. Idempotent: scrubbing a scrubbed text changes nothing. */
  scrub(input: string): string {
    if (!input) return input;
    const r = redact(input);
    let t = r.text;
    this.stats.count += r.count;
    // 1. Slack mentions of known people keep their placeholder ("@PERSON_2"); unknown ones lose the id.
    t = t.replace(SLACK_MENTION, (_m, id: string) => this.bump(`@${this.exactFor(id) ?? 'SLACK_USER'}`));
    // 2. URLs: ids in paths and query values.
    t = t.replace(URL, (u) => this.url(u));
    // 3. Known exact values: emails, Org62 ids, Slack ids, app ids.
    t = t.replace(EMAIL, (m) => this.bump(this.exactFor(m) ?? 'EMAIL'));
    t = t.replace(UUID, (m) => this.bump(this.exactFor(m) ?? 'ID'));
    t = t.replace(ORG62_ID, (m) => this.bump(this.exactFor(m) ?? 'ORG62_ID'));
    t = t.replace(SLACK_ID, (m) => this.bump(this.exactFor(m) ?? 'SLACK_ID'));
    // 4. Names the database knows, longest first.
    if (this.nameRe) t = t.replace(this.nameRe, (m) => this.bump(this.nameMap.get(m.toLowerCase()) ?? m));
    // 5. Leftover phone numbers.
    t = t.replace(PHONE, () => this.bump('PHONE'));
    return t;
  }

  /** Scrub every string in a JSON-ish value (tool results). */
  scrubValue<T>(v: T): T {
    if (typeof v === 'string') return this.scrub(v) as T;
    if (Array.isArray(v)) return v.map((x) => this.scrubValue(x)) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.scrubValue(x)])) as T;
    return v;
  }
}

/** The term list from contract collections (the mock store, or any read model with the same rows). */
export function scrubTermsFrom(c: {
  accounts: ReadonlyArray<{ id: string; name: string; org62Url?: string | null }>;
  people: ReadonlyArray<{ id: string; name: string; email?: string | undefined; slackHandle?: string | undefined }>;
  opps: ReadonlyArray<{ id: string; name: string; org62Url?: string | null }>;
  slackIds?: ReadonlyMap<string, string>;
}): ScrubTerms {
  const org62 = (u: string | null | undefined) => {
    const m = u ? /\/([0-9A-Za-z]{15,18})(?:\/|$|\?)/.exec(u) : null;
    return m ? [m[1]!] : [];
  };
  return {
    accounts: c.accounts.map((a) => ({ id: a.id, names: [a.name], ids: org62(a.org62Url) })),
    opps: c.opps.map((o) => ({ id: o.id, names: [o.name], ids: org62(o.org62Url) })),
    people: c.people.map((p) => {
      const handle = p.slackHandle?.replace(/^@/, '') ?? '';
      const handleIsId = /^[UW][A-Z0-9]{6,}$/.test(handle);
      return {
        id: p.id,
        names: [p.name, ...(handle && !handleIsId ? [handle] : [])],
        ids: [...(handleIsId ? [handle] : []), ...(c.slackIds?.get(p.id) ? [c.slackIds.get(p.id)!] : [])],
        emails: p.email ? [p.email] : [],
      };
    }),
  };
}
