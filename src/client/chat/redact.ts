/**
 * Credential redaction for anything the chat shows raw (expanded tool args/results). Invariant 3: never
 * print tokens, cookies or passwords, even when a source contained one.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, 'xox?-[redacted]'],
  [/\b(sk|pk|rk)-(?:ant-|live-|test-|proj-)?[A-Za-z0-9_-]{12,}/g, '$1-[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh_[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'AIza[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._]{20,}/g, '[redacted-sf-session]'],
  [/((?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|cookie|session(?:id)?|sid)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1[redacted]'],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/([^:/\s]+):([^@/\s]+)@/gi, '$1://$2:[redacted]@'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]'],
];

export function redactCredentials(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
