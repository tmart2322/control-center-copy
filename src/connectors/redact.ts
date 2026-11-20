/**
 * Credential and sensitive-data redaction for everything a connector hands to the scanner.
 * Runs BEFORE text is placed in an excerpt, payload or log line (SCANNER.md §4.6, CLAUDE.md invariant 3).
 *
 * Replacement shape is `[REDACTED:<kind>]` so the skill agent can tell something was there without seeing it.
 */

export interface RedactResult {
  text: string;
  redacted: boolean;
  /** Redaction kinds applied, de-duplicated. */
  kinds: string[];
  count: number;
}

interface Rule {
  kind: string;
  re: RegExp;
  /** Keep the first capture group (a label such as `password:`) and replace only the secret. */
  keepPrefix?: boolean;
  validate?: (m: string) => boolean;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const RULES: Rule[] = [
  { kind: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxs-, xoxr-, xapp-)
  { kind: 'slack_token', re: /\bxox[abprsc]-[A-Za-z0-9-]{8,}\b/g },
  { kind: 'slack_token', re: /\bxapp-[A-Za-z0-9-]{8,}\b/g },
  // Anthropic / OpenAI style keys
  { kind: 'api_key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g },
  // GitHub
  { kind: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: 'github_token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  // VDP personal access tokens (vdp-app-fir) and the Okta gateway session cookie, even without a header label
  { kind: 'vdp_pat', re: /\bvdp_pat_[A-Za-z0-9_-]{16,}/g },
  { kind: 'cookie', re: /\b(central_proxy_session=)[^;\s"'&]{8,}/g, keepPrefix: true },
  // AWS access key id
  { kind: 'aws_key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // Google OAuth access tokens / API keys
  { kind: 'google_token', re: /\bya29\.[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'google_api_key', re: /\bAIza[A-Za-z0-9_-]{30,}\b/g },
  // JWTs
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g },
  // Salesforce session id: 00D<12|15 chars>!<token>
  { kind: 'sf_session', re: /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]{20,}/g },
  // Authorization headers and Bearer tokens
  { kind: 'bearer', re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, keepPrefix: true },
  { kind: 'auth_header', re: /\b(Authorization\s*:\s*(?:Basic|Token|Negotiate)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, keepPrefix: true },
  { kind: 'cookie', re: /\b((?:Set-)?Cookie\s*:\s*)[^\r\n]{8,}/gi, keepPrefix: true },
  // Tokens in URL query strings
  { kind: 'url_token', re: /([?&](?:access_token|token|key|api_key|apikey|sig|signature|code|auth|session|sid|qs)=)[^&\s#"'<>)]{8,}/gi, keepPrefix: true },
  // RED-1: a password-manager share link IS the credential (1Password, Bitwarden Send, Keeper, One-Time Secret, …).
  { kind: 'password_share', re: /\bhttps?:\/\/(?:share\.1password\.(?:com|eu|ca)|[a-z0-9-]+\.1password\.(?:com|eu|ca)\/(?:s|share)\b|send\.bitwarden\.com|vault\.bitwarden\.(?:com|eu)\/#\/send|(?:www\.)?keepersecurity\.(?:com|eu)\/vault\/share|(?:[a-z]+\.)?onetimesecret\.com\/(?:secret|private)|pwpush\.com\/(?:[a-z]{2}\/)?p\/|privnote\.com\/|(?:www\.)?lastpass\.com\/(?:share|s)\/|app\.dashlane\.com\/share)[^\s|>"'`)\]]*/gi },
  // "user: x / pw: y" demo-login pairs. Must run before the generic password rule.
  { kind: 'login_pair', re: /\b((?:user(?:name)?|login|email)\s*[:=]\s*\S+\s*(?:[/,|;]|\band\b)\s*(?:pass(?:word)?|pw|pwd)\s*[:=]\s*)\S+/gi, keepPrefix: true },
  // RED-1: "login: x@y.com / Secret1" (no password label), and "username: x" with "p: y" on the next line.
  { kind: 'login_pair', re: /\b((?:user(?:name)?|login|creds?|credentials)\s*[:=]\s*\S+\s*[/|]\s*)(?!\[REDACTED)(?!(?:pass(?:word)?|pw|pwd)\s*[:=])[^\s"'`<>,;]{4,}/gi, keepPrefix: true },
  { kind: 'login_pair', re: /\b((?:user(?:name)?|login|u)\s*[:=]\s*\S+[ \t]*\r?\n[ \t]*(?:p|pw|pwd|pass(?:word)?)\s*[:=]\s*)(?!\[REDACTED)\S+/gi, keepPrefix: true },
  // password: xyz / passwd=xyz / pwd is xyz / secret: xyz / client_secret=...
  { kind: 'password', re: /\b((?:pass(?:word|wd|phrase)?|pwd|pw|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?key|private[_ -]?key|token)\s*(?:[:=]|\bis\b)\s*["'`]?)(?!\[REDACTED)[^\s"'`<>,;]{4,}/gi, keepPrefix: true },
  // US SSN
  { kind: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // IBAN
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){3,7}[A-Z0-9]{1,4}\b/g, validate: (m) => /\d/.test(m) && m.replace(/\s/g, '').length >= 15 },
  // Payment cards (Luhn-validated)
  {
    kind: 'card',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => {
      const d = m.replace(/[ -]/g, '');
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
  },
];

export function redact(input: string | undefined | null): RedactResult {
  if (!input) return { text: input ?? '', redacted: false, kinds: [], count: 0 };
  let text = input;
  const kinds = new Set<string>();
  let count = 0;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    text = text.replace(rule.re, (...args: unknown[]) => {
      const match = args[0] as string;
      if (rule.validate && !rule.validate(match)) return match;
      kinds.add(rule.kind);
      count++;
      if (rule.keepPrefix) {
        const prefix = typeof args[1] === 'string' ? (args[1] as string) : '';
        return `${prefix}[REDACTED:${rule.kind}]`;
      }
      return `[REDACTED:${rule.kind}]`;
    });
  }
  return { text, redacted: count > 0, kinds: [...kinds], count };
}

/** Convenience: redact and truncate to `max` chars (excerpt limit is 1000). */
export function redactExcerpt(input: string | undefined | null, max = 1000): { text: string; redacted: boolean } {
  const r = redact(input);
  const t = r.text.length > max ? r.text.slice(0, max - 1) + '…' : r.text;
  return { text: t, redacted: r.redacted };
}

/** Recursively redact every string in a JSON-like payload. Returns a new structure. */
export function redactDeep<T>(value: T): { value: T; redacted: boolean } {
  let any = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redact(v);
      if (r.redacted) any = true;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, redacted: any };
}
