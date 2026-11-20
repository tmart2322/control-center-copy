/**
 * Credential-like text detection and masking (tenet: Local data, privacy-safe logs).
 *
 * Used on two sides of the judgment layer:
 *  - inputs: excerpts and thread text are masked before they reach a prompt;
 *  - outputs: a draft that contains anything credential-shaped fails validation.
 *
 * Research found plaintext demo passwords and password-manager share links in sent DMs,
 * so these patterns err on the side of masking.
 */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // key: value / key=value where the key names a secret
  {
    name: 'labeled_secret',
    re: /\b(pass(word|wd|code)?|pwd|pw|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|token|private[_ -]?key)\b\s*[:=]\s*["']?[^\s"'<>,;]{4,}/gi,
  },
  // "password is X" / "pw: X"
  { name: 'password_phrase', re: /\b(password|pw|passcode)\s+(is|was|=)\s+\S{4,}/gi },
  // password-manager share links carry the secret in the fragment
  { name: 'share_link', re: /https?:\/\/(share\.1password\.com|[a-z0-9-]+\.1password\.com\/share|vault\.bitwarden\.com\/#\/send|send\.bitwarden\.com)\S*/gi },
  // common token shapes
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g },
  { name: 'openai_like_key', re: /\bsk-[A-Za-z0-9]{20,}/g },
  { name: 'slack_token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  { name: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // Salesforce session ids (00D…!…)
  { name: 'sf_session', re: /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._]{20,}/g },
  // connection strings with inline credentials
  { name: 'conn_string', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi },
];

export interface RedactionResult {
  text: string;
  redacted: boolean;
  kinds: string[];
}

export function redactSecrets(text: string): RedactionResult {
  let out = text;
  const kinds = new Set<string>();
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      kinds.add(name);
      re.lastIndex = 0;
      out = out.replace(re, `[redacted:${name}]`);
    }
  }
  return { text: out, redacted: kinds.size > 0, kinds: [...kinds] };
}

/** True when the text contains anything credential-shaped. */
export function containsSecret(text: string): boolean {
  return redactSecrets(text).redacted;
}
