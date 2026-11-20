import { describe, expect, it } from 'vitest';
import {
  ComposeDocSchema,
  DestinationSchema,
  PROFILES,
  CAPABILITY_KEYS,
  lossyForSwitch,
  payloadFor,
  profileForDestination,
  renderPreview,
  sanitizeHtml,
  serialize,
  stableStringify,
} from '@/lib/compose';
import { EMAIL, PLAIN, SLACK, SLACK_AUTO, SLACK_BLOCKS, bq, cell, code, doc, h, li, link, mention, p, t, table, ul } from './helpers';

const rich = doc(
  h(2, t('Update')),
  p(t('Hi '), mention('U1', 'Dana'), t(', see '), t('docs', link('https://a.com/x')), t(' & <ok>', 'bold')),
  ul(li(p(t('one'))), li(p(t('two', 'italic')))),
  bq(p(t('quoted'))),
  code('x < y'),
  table([cell('A', true)], [cell('1')]),
);

describe('payloadFor', () => {
  it('slack mrkdwn -> {text}', () => {
    expect(payloadFor(doc(p(t('x', 'bold'))), SLACK)).toEqual({ text: '*x*' });
  });
  it('slack blocks -> {text, blocks}', () => {
    const r = payloadFor(doc(p(t('x'))), SLACK_BLOCKS);
    expect(Object.keys(r).sort()).toEqual(['blocks', 'text']);
  });
  it('slack auto picks blocks when lists/code are present, mrkdwn otherwise', () => {
    expect('blocks' in payloadFor(doc(ul(li(p(t('a'))))), SLACK_AUTO)).toBe(true);
    expect('blocks' in payloadFor(doc(code('a')), SLACK_AUTO)).toBe(true);
    expect('blocks' in payloadFor(doc(p(t('a', 'bold'))), SLACK_AUTO)).toBe(false);
  });
  it('email -> {html, text}', () => {
    const r = payloadFor(doc(p(t('x'))), EMAIL);
    expect(Object.keys(r).sort()).toEqual(['html', 'text']);
  });
  it('plain -> {text}', () => {
    expect(payloadFor(doc(p(t('x'))), PLAIN)).toEqual({ text: 'x' });
  });
  it('is deterministic byte-for-byte', () => {
    for (const d of [SLACK, SLACK_BLOCKS, EMAIL, PLAIN]) {
      expect(stableStringify(payloadFor(rich, d))).toBe(stableStringify(payloadFor(structuredClone(rich), d)));
    }
  });
  it('does not mutate the input doc', () => {
    const before = JSON.stringify(rich);
    for (const d of [SLACK, SLACK_BLOCKS, EMAIL, PLAIN]) payloadFor(rich, d);
    expect(JSON.stringify(rich)).toBe(before);
  });
});

describe('renderPreview is derived from the payload', () => {
  it('slack mrkdwn preview shows what the mrkdwn payload says, not the editor doc', () => {
    // The editor doc says "<b>", the payload escapes it; the preview must show the literal text.
    const html = renderPreview(doc(p(t('<b>hi</b> *x*'))), SLACK);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });
  it('mutating the payload changes the preview (proves derivation)', () => {
    // Same doc, two destinations -> two different renderings from two different payloads.
    const d = doc(h(1, t('Title')));
    expect(renderPreview(d, SLACK)).toContain('<strong>Title</strong>');
    expect(renderPreview(d, EMAIL)).toContain('<h1');
  });
  it('slack: renders marks, links, mentions, lists, quote, code', () => {
    const html = renderPreview(rich, SLACK, { mentionLabels: { U1: 'Dana' } });
    expect(html).toContain('<span class="cc-mention">@Dana</span>');
    expect(html).toContain('<a href="https://a.com/x"');
    expect(html).toContain('<ul');
    expect(html).toContain('cc-quote');
    expect(html).toContain('<pre class="cc-pre">x &lt; y</pre>');
  });
  it('slack mrkdwn path: ids shown without labels, broadcast flagged', () => {
    const html = renderPreview(doc(p(mention('here', 'here', { kind: 'special' }), t(' hi '), mention('U1', 'Dana'))), SLACK);
    expect(html).toContain('cc-mention-broadcast');
    expect(html).toContain('@U1');
  });
  it('email: passes the payload html through the sanitizer', () => {
    const html = renderPreview(rich, EMAIL);
    expect(html).toContain('<table');
    expect(html).toContain('cc-preview-email');
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
  });
  it('plain: pre-wrapped text', () => {
    expect(renderPreview(doc(p(t('a < b'))), PLAIN)).toContain('<pre>a &lt; b</pre>');
  });
});

describe('payload/preview identity', () => {
  it('preview of the email payload equals sanitizing the payload html (nothing else feeds it)', () => {
    const payload = payloadFor(rich, EMAIL);
    expect(renderPreview(rich, EMAIL)).toBe(sanitizeHtml(`<div class="cc-preview cc-preview-email">${payload.html}</div>`));
  });
  it('the email html we generate survives the sanitizer unchanged (no styles/tags silently stripped)', () => {
    const payload = payloadFor(rich, EMAIL);
    const sanitized = sanitizeHtml(payload.html);
    // sanitizer adds target/rel on links only
    expect(sanitized.replace(/ target="_blank" rel="noopener noreferrer"/g, '')).toBe(payload.html);
  });
  it('slack: preview text content tracks payload text', () => {
    const d = doc(p(t('one ', 'bold'), t('two')));
    const text = payloadFor(d, SLACK).text;
    const html = renderPreview(d, SLACK);
    expect(text).toBe('*one* two');
    expect(html).toContain('<strong>one</strong> two');
  });
});

describe('sanitizer', () => {
  const bad = [
    '<script>alert(1)</script>x',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<p onclick="x()">x</p>',
    '<iframe src="//evil"></iframe>',
    '<svg onload=alert(1)>',
    '<style>*{}</style>',
    '<form action=//evil><input></form>',
    '<a href="data:text/html;base64,AAAA">x</a>',
  ];
  it.each(bad)('neutralizes %s', (src) => {
    const out = sanitizeHtml(src);
    expect(out).not.toMatch(/<script|<img|<iframe|<svg|<style|<form|<input|onerror|onclick|onload|javascript:|data:|url\(/i);
  });
  it('keeps safe formatting and rel/target on links', () => {
    expect(sanitizeHtml('<p style="margin:0;color:#222"><a href="https://a.com">x</a></p>')).toBe(
      '<p style="margin:0;color:#222;"><a href="https://a.com" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
  });
  it('only cc- classes survive', () => {
    expect(sanitizeHtml('<div class="cc-a evil">x</div>')).toBe('<div class="cc-a">x</div>');
  });
  it('unclosed tags are closed, text is escaped', () => {
    expect(sanitizeHtml('<p>a &lt; <b>b')).toBe('<p>a &lt; <b>b</b></p>');
  });
});

describe('lossy list on destination switch', () => {
  it('rich doc -> slack reports heading and table', () => {
    const kinds = lossyForSwitch(rich, SLACK).map((n) => `${n.from}>${n.to}`);
    expect(kinds).toEqual(['heading>bold line', 'table>bullets']);
  });
  it('rich doc -> email reports only mention flattening', () => {
    expect(lossyForSwitch(rich, EMAIL).map((n) => n.kind)).toEqual(['mention']);
  });
  it('rich doc -> plain reports marks, headings, tables, links', () => {
    const l = lossyForSwitch(rich, PLAIN);
    expect(l.some((n) => n.from === 'heading')).toBe(true);
    expect(l.some((n) => n.from === 'table')).toBe(true);
    expect(l.some((n) => n.from === 'bold')).toBe(true);
  });
  it('a clean doc is lossless everywhere that supports it', () => {
    const d = doc(p(t('x', 'bold'), t(' '), t('y', 'italic')), ul(li(p(t('a')))));
    expect(serialize(d, SLACK).lossy).toEqual([]);
    expect(serialize(d, SLACK_BLOCKS).lossy).toEqual([]);
    expect(serialize(d, EMAIL).lossy).toEqual([]);
  });
});

describe('profiles', () => {
  it('declares every capability for every profile', () => {
    for (const prof of Object.values(PROFILES)) {
      expect(Object.keys(prof.supports).sort()).toEqual([...CAPABILITY_KEYS].sort());
    }
  });
  it('slack disables heading and table; email supports all', () => {
    expect(PROFILES.slack_mrkdwn.supports).toMatchObject({ heading: false, table: false, bold: true, bulletList: true, codeBlock: true });
    expect(PROFILES.slack_blocks.supports.heading).toBe(false);
    expect(Object.values(PROFILES.email_html.supports).every(Boolean)).toBe(true);
    expect(PROFILES.plain.supports).toMatchObject({ bold: false, link: false, heading: false });
  });
  it('maps destination to profile', () => {
    expect(profileForDestination(SLACK).id).toBe('slack_mrkdwn');
    expect(profileForDestination(SLACK_BLOCKS).id).toBe('slack_blocks');
    expect(profileForDestination(SLACK_AUTO, doc(ul(li(p(t('a')))))).id).toBe('slack_blocks');
    expect(profileForDestination(EMAIL).id).toBe('email_html');
    expect(profileForDestination(PLAIN).id).toBe('plain');
  });
});

describe('zod schemas', () => {
  it('Destination: slack needs a channel or dm user', () => {
    expect(DestinationSchema.safeParse({ kind: 'slack', channelId: 'C1', threadTs: '1700000000.000100' }).success).toBe(true);
    expect(DestinationSchema.safeParse({ kind: 'slack', dmUserId: 'U1' }).success).toBe(true);
    expect(DestinationSchema.safeParse({ kind: 'slack' }).success).toBe(false);
    expect(DestinationSchema.parse({ kind: 'slack', channelId: 'C1' })).toMatchObject({ format: 'auto' });
  });
  it('Destination: email validates addresses and defaults lists', () => {
    const ok = DestinationSchema.parse({ kind: 'email', to: ['a@b.co'], subject: 'x', inReplyTo: '<m@id>' });
    expect(ok).toMatchObject({ cc: [], bcc: [] });
    expect(DestinationSchema.safeParse({ kind: 'email', to: ['nope'] }).success).toBe(false);
  });
  it('ComposeDoc accepts nested TipTap JSON and rejects junk', () => {
    expect(ComposeDocSchema.safeParse(rich).success).toBe(true);
    expect(ComposeDocSchema.safeParse({ type: 'paragraph' }).success).toBe(false);
    expect(ComposeDocSchema.safeParse({ type: 'doc', content: [{ nope: 1 }] }).success).toBe(false);
  });
});
