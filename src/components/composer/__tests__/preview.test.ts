import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Destination, DraftPreview, TipTapDoc } from '@/contract';
import { payloadFor, renderPreview } from '@/lib/compose';
import { remapMentions, switchOptions, toComposeDestination } from '../destination';
import { payloadView, previewHtml, purify, serverPreviewHtml } from '../preview';

const SLACK: Destination = { kind: 'slack', target: 'thread', channelId: 'C0ACME', channelName: '#acme-ext', threadTs: '1.1' };
const EMAIL: Destination = { kind: 'email', target: 'reply_all', to: [{ name: 'Marcus Webb', email: 'marcus@globex.example' }], cc: [], subject: 'Re: SOW', threadId: null, inReplyTo: null };

const listDoc: TipTapDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Notes for ' }, { type: 'mention', attrs: { id: 'U0RAJ', label: 'Raj Mehta', kind: 'user' } }, { type: 'text', text: ':' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Globex ', marks: [] }, { type: 'text', text: 'commit', marks: [{ type: 'bold' }] }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ACME best case' }] }] },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Risks' }] },
  ],
};

const serverPreview = (destination: Destination, payload: Record<string, unknown>): DraftPreview => ({
  draftId: 'dr_1',
  version: 2,
  destination,
  mode: 'send',
  rendition: { format: destination.kind === 'slack' ? 'slack_mrkdwn' : 'email_html', body: String(payload.text ?? payload.html ?? ''), text: '', lossy: [] },
  payload,
  confirmToken: 'ct_x',
  dryRun: true,
});

// Record every DOMPurify.sanitize call (delegating to the real one unless a test overrides the output).
const purifyCalls = vi.hoisted(() => ({ inputs: [] as string[], override: null as string | null }));
vi.mock('isomorphic-dompurify', async (importOriginal) => {
  const real = ((await importOriginal()) as { default: { sanitize: (h: string, c?: unknown) => unknown; addHook: (...a: unknown[]) => void } }).default;
  return {
    default: {
      sanitize: (html: string, cfg?: unknown) => {
        purifyCalls.inputs.push(String(html));
        return purifyCalls.override ?? real.sanitize(html, cfg);
      },
      addHook: (...a: unknown[]) => real.addHook(...a),
    },
  };
});

afterEach(() => {
  purifyCalls.inputs.length = 0;
  purifyCalls.override = null;
});

describe('preview equals payload', () => {
  it('Slack: the preview is renderPreview(payloadFor) through DOMPurify, and View payload shows payloadFor bytes', () => {
    const cd = toComposeDestination(SLACK);
    expect(previewHtml(listDoc, SLACK)).toBe(purify(renderPreview(listDoc, cd)));
    const view = payloadView(listDoc, SLACK);
    expect(view.parts[0]!.bytes).toBe(JSON.stringify(payloadFor(listDoc, cd), null, 2));
    // lists → rich_text blocks (+ mrkdwn fallback), as the format label says
    expect(view.format).toMatch(/rich_text blocks/);
    expect(JSON.parse(view.parts[0]!.bytes).blocks[0].type).toBe('rich_text');
  });

  it('Email: View payload is the exact html + text from payloadFor; preview renders that html', () => {
    const cd = toComposeDestination(EMAIL);
    const p = payloadFor(listDoc, cd) as { html: string; text: string };
    const view = payloadView(listDoc, EMAIL);
    expect(view.parts.find((x) => x.id === 'html')!.bytes).toBe(p.html);
    expect(view.parts.find((x) => x.id === 'text')!.bytes).toBe(p.text);
    expect(previewHtml(listDoc, EMAIL)).toBe(purify(renderPreview(listDoc, cd)));
    expect(previewHtml(listDoc, EMAIL)).toContain('Risks');
  });

  it('every word in the Slack preview comes from the payload text (labels only add names to ids)', () => {
    const html = previewHtml(listDoc, SLACK, { U0RAJ: 'Raj Mehta' });
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).toContain('@Raj Mehta');
    expect(text).toContain('commit');
    expect(text).toContain('Risks'); // heading → bold line in Slack, still present
  });
});

describe('DOMPurify is applied before injection', () => {
  const evil =
    '<p onclick="steal()">Hi</p><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><iframe src="https://evil.example"></iframe><style>*{}</style>';

  it('client preview path calls DOMPurify.sanitize and returns its output', () => {
    purifyCalls.override = '<p>PURIFIED</p>';
    expect(previewHtml(listDoc, SLACK)).toBe('<p>PURIFIED</p>');
    expect(purifyCalls.inputs).toHaveLength(1);
    expect(purifyCalls.inputs[0]).toContain('cc-preview-slack');
  });

  it('server preview path (email html from the backend) calls DOMPurify and strips active content', () => {
    const out = serverPreviewHtml(serverPreview(EMAIL, { api: 'gmail.users.messages.send', html: evil, text: 'Hi' }));
    expect(purifyCalls.inputs).toHaveLength(1);
    for (const bad of ['onclick', 'onerror', '<script', 'javascript:', '<iframe', '<style', '<img']) expect(out).not.toContain(bad);
    expect(out).toContain('Hi');
  });

  it('purify removes handlers and scripts that slip past the first sanitizer', () => {
    const out = purify(evil);
    for (const bad of ['onclick', 'onerror', '<script', 'javascript:', '<iframe', '<style', '<img']) expect(out).not.toContain(bad);
  });

  it('links in previews never open in place', () => {
    expect(purify('<a href="https://example.com">x</a>')).toContain('rel="noopener noreferrer nofollow"');
  });
});

describe('switching destination', () => {
  it('lists lossy conversions and re-resolves mentions for the target', () => {
    const people = [{ id: 'p_raj', name: 'Raj Mehta', slackHandle: 'U0RAJ', email: 'raj@example.com' }];
    const [cur, email] = switchOptions(SLACK, listDoc, [SLACK, EMAIL], people);
    expect(cur!.current).toBe(true);
    expect(email!.lossy).toEqual([]); // email renders headings, lists and (with an address) mentions
    const m = JSON.stringify(email!.doc);
    expect(m).toContain('"email":"raj@example.com"');

    const toSlack = switchOptions(EMAIL, listDoc, [EMAIL, SLACK], []);
    expect(toSlack[1]!.lossy.some((n) => /heading/i.test(n.from))).toBe(true);
  });

  it('a mention with no id on the target becomes the plain name and is reported', () => {
    const emailMention: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'dana@acme.example', label: 'Dana Reyes', kind: 'user', email: 'dana@acme.example' } }] }] };
    const r = remapMentions(emailMention, SLACK, []);
    expect(r.unresolved).toEqual(['Dana Reyes']);
    expect(JSON.stringify(r.doc)).not.toContain('mention');
  });
});
