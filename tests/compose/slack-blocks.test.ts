import { describe, expect, it } from 'vitest';
import { serializeSlackBlocks } from '@/lib/compose';
import { bq, br, cell, code, doc, h, li, link, mention, ol, p, t, table, ul } from './helpers';

const mk = (...c: Parameters<typeof doc>) => serializeSlackBlocks(doc(...c));
const els = (...c: Parameters<typeof doc>) => mk(...c).payload.blocks![0]!.elements;

describe('slack rich_text blocks', () => {
  it('wraps in a single rich_text block with mrkdwn fallback text', () => {
    const r = mk(p(t('hi ', 'bold'), t('there')));
    expect(r.payload).toEqual({
      text: '*hi* there',
      blocks: [
        {
          type: 'rich_text',
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                { type: 'text', text: 'hi ', style: { bold: true } },
                { type: 'text', text: 'there' },
              ],
            },
          ],
        },
      ],
    });
  });
  it('does not escape text (rich_text is raw)', () => {
    expect(els(p(t('a < b & c')))[0]).toEqual({ type: 'rich_text_section', elements: [{ type: 'text', text: 'a < b & c' }] });
  });
  it('styles: italic, strike, code', () => {
    expect(els(p(t('x', 'italic', 'strike', 'code')))[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'x', style: { italic: true, strike: true, code: true } }],
    });
  });
  it('links keep | untouched (no wrapper syntax in blocks)', () => {
    expect(els(p(t('go', link('https://a.com/a|b'))))[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'link', url: 'https://a.com/a%7Cb', text: 'go' }],
    });
  });
  it('bullet list is a real rich_text_list', () => {
    expect(els(ul(li(p(t('a'))), li(p(t('b')))))).toEqual([
      {
        type: 'rich_text_list',
        style: 'bullet',
        indent: 0,
        elements: [
          { type: 'rich_text_section', elements: [{ type: 'text', text: 'a' }] },
          { type: 'rich_text_section', elements: [{ type: 'text', text: 'b' }] },
        ],
      },
    ]);
  });
  it('nested lists flatten by indent, ordered continues with offset', () => {
    const e = els(ol([li(p(t('a')), ul(li(p(t('x'))))), li(p(t('b')))]));
    expect(e.map((x) => (x.type === 'rich_text_list' ? [x.style, x.indent, x.offset ?? 0, x.elements.length] : x.type))).toEqual([
      ['ordered', 0, 0, 1],
      ['bullet', 1, 0, 1],
      ['ordered', 0, 1, 1],
    ]);
  });
  it('code block is rich_text_preformatted with raw text', () => {
    expect(els(code('a < b'))).toEqual([{ type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'a < b' }] }]);
  });
  it('blockquote is rich_text_quote', () => {
    expect(els(bq(p(t('q', 'bold'))))).toEqual([{ type: 'rich_text_quote', elements: [{ type: 'text', text: 'q', style: { bold: true } }] }]);
  });
  it('paragraph before a list ends with a newline; paragraphs merge', () => {
    const e = els(p(t('a')), p(t('b')), ul(li(p(t('x')))));
    expect(e[0]).toEqual({ type: 'rich_text_section', elements: [{ type: 'text', text: 'a\n\nb\n' }] });
    expect(e[1]!.type).toBe('rich_text_list');
  });
  it('hardBreak is a newline text', () => {
    expect(els(p(t('a'), br(), t('b')))[0]).toEqual({ type: 'rich_text_section', elements: [{ type: 'text', text: 'a\nb' }] });
  });
  it('mentions map to user / channel / broadcast elements, with a warning for broadcast', () => {
    const r = mk(p(mention('U1'), mention('C1', 'x', { kind: 'channel' }), mention('here', 'here', { kind: 'special' })));
    expect(r.payload.blocks![0]!.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [
        { type: 'user', user_id: 'U1' },
        { type: 'channel', channel_id: 'C1' },
        { type: 'broadcast', range: 'here' },
      ],
    });
    expect(r.warnings.map((w) => w.code)).toEqual(['broadcast_mention']);
  });
  it('heading -> bold line and table -> bullet list, both reported', () => {
    const r = mk(h(1, t('T')), table([cell('H', true)], [cell('v')]));
    expect(r.lossy).toEqual([
      { kind: 'node', from: 'heading', to: 'bold line', count: 1 },
      { kind: 'node', from: 'table', to: 'bullets', count: 1 },
    ]);
    expect(r.payload.blocks![0]!.elements[0]).toEqual({
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'T', style: { bold: true } }, { type: 'text', text: '\n' }],
    });
  });
  it('has no random ids anywhere (deterministic)', () => {
    const d = doc(ul(li(p(t('a')))), p(t('b')));
    expect(JSON.stringify(serializeSlackBlocks(d))).toBe(JSON.stringify(serializeSlackBlocks(d)));
    expect(JSON.stringify(serializeSlackBlocks(d))).not.toContain('block_id');
  });
  it('empty doc yields text only', () => {
    expect(mk().payload).toEqual({ text: '' });
  });
});
