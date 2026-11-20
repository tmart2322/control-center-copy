/**
 * The mock's thin adapter over the ONE serializer, `src/lib/compose` (CONTRACT-1). Previews, dispatch
 * payloads and stored renditions all come from `serialize` / `payloadFor` / `renderPreview`, so what the
 * user previews is byte-identical to what dispatch would post. Nothing here sends anything.
 *
 * Also: `docFromText` (engine text → a doc) and `textDiff` (proposal previews), which are not serialization.
 */
import type { Destination, DispatchMode, Draft, Rendition, TipTapDoc, TipTapNode } from '@/contract';
import { plainTextOf } from '@/lib/compose/plain';
import { actionPayloadFor } from '@/lib/actions';
import {
  payloadFor as composePayloadFor,
  renderPreview,
  serialize,
  serializeFor,
  toRenditionFormat,
  type Destination as ComposeDestination,
  type EmailPayload,
  type LossyNote,
  type PlainPayload,
  type SlackPayload,
} from '@/lib/compose';

/** Contract destination → compose destination. Slack `auto`: rich_text blocks when the doc has lists or code. */
export function composeDestination(dest: Destination): ComposeDestination {
  // A structured action's doc is its read-only summary: plain text.
  if (dest.kind === 'action') return { kind: 'plain' };
  if (dest.kind === 'slack') return { kind: 'slack', channelId: dest.channelId, ...(dest.threadTs ? { threadTs: dest.threadTs } : {}), format: 'auto' };
  return { kind: 'email', to: dest.to.map((a) => a.email), cc: dest.cc.map((a) => a.email), bcc: [], subject: dest.subject, ...(dest.inReplyTo ? { inReplyTo: dest.inReplyTo } : {}) };
}

/** Plain text of the doc (search, first lines). Same text the plain profile serializes. */
export function plainText(doc: TipTapDoc): string {
  return plainTextOf(doc);
}

const lossyLabel = (n: LossyNote) => `${n.from} → ${n.to}${n.count > 1 ? ` (×${n.count})` : ''}`;

/** The rendition dispatch would send for this destination (format picked by the compose profile). */
export function renditionFor(dest: Destination, doc: TipTapDoc): Rendition {
  const s = serialize(doc, composeDestination(dest));
  const lossy = s.lossy.map(lossyLabel);
  if (dest.kind === 'slack') {
    const p = s.payload as SlackPayload;
    return { format: toRenditionFormat(s.profile), body: p.blocks ? JSON.stringify(p.blocks) : p.text, text: p.text, lossy };
  }
  if (dest.kind === 'action') {
    const p = s.payload as PlainPayload;
    return { format: 'plain_text', body: p.text, text: p.text, lossy };
  }
  const p = s.payload as EmailPayload;
  return { format: toRenditionFormat(s.profile), body: p.html, text: p.text, lossy };
}

/** Stored renditions. Slack always keeps the mrkdwn rendition (older readers), plus blocks when auto picks them. */
export function renderAll(dest: Destination, doc: TipTapDoc): Draft['rendered'] {
  const main = renditionFor(dest, doc);
  if (dest.kind === 'action') return { plain_text: main };
  if (dest.kind !== 'slack') return { email_html: main };
  if (main.format === 'slack_mrkdwn') return { slack_mrkdwn: main };
  const m = serializeFor(doc, 'slack_mrkdwn');
  return { slack_mrkdwn: { format: 'slack_mrkdwn', body: m.payload.text, text: m.payload.text, lossy: m.lossy.map(lossyLabel) }, slack_blocks: main };
}

/**
 * The exact request a send adapter would make (Slack chat.postMessage / drafts, Gmail send / drafts):
 * transport fields + the compose payload (`text`/`blocks`, `html`/`text`) unchanged. Never sent by the mock.
 */
export function payloadFor(dest: Destination, doc: TipTapDoc, mode: DispatchMode): Record<string, unknown> {
  // A structured action: its structured input → the one tool call (src/lib/actions.ts). The doc and mode do not
  // change it (actions are read-only and have no drafts).
  if (dest.kind === 'action') return actionPayloadFor(dest);
  if (dest.kind === 'slack') {
    const p = composePayloadFor(doc, composeDestination(dest) as ComposeDestination & { kind: 'slack' });
    return {
      api: mode === 'draft' ? 'slack.drafts.create' : 'chat.postMessage',
      channel: dest.channelId,
      ...(dest.threadTs ? { thread_ts: dest.threadTs } : {}),
      ...p,
      mrkdwn: true,
      unfurl_links: false,
    };
  }
  const p = composePayloadFor(doc, composeDestination(dest) as ComposeDestination & { kind: 'email' });
  return {
    api: mode === 'draft' ? 'gmail.users.drafts.create' : 'gmail.users.messages.send',
    to: dest.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
    cc: dest.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
    subject: dest.subject,
    ...(dest.threadId ? { threadId: dest.threadId } : {}),
    ...(dest.inReplyTo ? { inReplyTo: dest.inReplyTo } : {}),
    ...p,
  };
}

/** "Preview as recipient" HTML, rendered by the compose library from the same payload (allowlist-sanitized). */
export function previewHtml(dest: Destination, doc: TipTapDoc, mentionLabels: Record<string, string> = {}): string {
  return renderPreview(doc, composeDestination(dest), { mentionLabels });
}

/** Build a simple doc from plain text: blank-line separated paragraphs, "- " lines become a bullet list. */
export function docFromText(text: string): TipTapDoc {
  const content: TipTapNode[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const lines = para.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: l.replace(/^\s*[-•]\s+/, '') }] }] })),
      });
    } else {
      const inner: TipTapNode[] = [];
      lines.forEach((l, i) => {
        if (i > 0) inner.push({ type: 'hardBreak' });
        if (l) inner.push({ type: 'text', text: l });
      });
      content.push({ type: 'paragraph', content: inner });
    }
  }
  return { type: 'doc', content };
}

/** Word-level diff (LCS) for proposal previews. */
export function textDiff(a: string, b: string): Array<{ op: 'equal' | 'insert' | 'delete'; text: string }> {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Array<{ op: 'equal' | 'insert' | 'delete'; text: string }> = [];
  const push = (op: 'equal' | 'insert' | 'delete', text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('equal', x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('delete', x[i++]);
    else push('insert', y[j++]);
  }
  while (i < n) push('delete', x[i++]);
  while (j < m) push('insert', y[j++]);
  return out;
}
