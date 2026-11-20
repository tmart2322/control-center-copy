import { describe, expect, it } from 'vitest';
import { serializeSlackMrkdwn } from '@/lib/compose';
import { bq, br, code, doc, h, li, link, mention, ol, p, t, table, cell, ul } from './helpers';

const mk = (...c: Parameters<typeof doc>) => serializeSlackMrkdwn(doc(...c));
const text = (...c: Parameters<typeof doc>) => mk(...c).payload.text;

describe('slack mrkdwn serializer: marks', () => {
  it('bold / italic / strike / code', () => {
    expect(text(p(t('a', 'bold')))).toBe('*a*');
    expect(text(p(t('a', 'italic')))).toBe('_a_');
    expect(text(p(t('a', 'strike')))).toBe('~a~');
    expect(text(p(t('a', 'code')))).toBe('`a`');
  });
  it('nests marks with a delimiter stack', () => {
    expect(text(p(t('a', 'bold'), t('b', 'bold', 'italic'), t('c', 'bold')))).toBe('*a_b_c*');
    expect(text(p(t('x', 'bold', 'italic', 'strike')))).toBe('~_*x*_~');
  });
  it('keeps delimiters hugging text (whitespace moves outside)', () => {
    expect(text(p(t(' hi ', 'bold')))).toBe(' *hi* ');
    expect(text(p(t('   ', 'bold')))).toBe('   ');
  });
  it('code wins over other marks and notes it', () => {
    const r = mk(p(t('x', 'bold', 'code')));
    expect(r.payload.text).toBe('`x`');
    expect(r.lossy).toContainEqual({ kind: 'mark', from: 'bold on code', to: 'code', count: 1 });
  });
  it('links become <url|text>, bare when label equals url', () => {
    expect(text(p(t('docs', link('https://a.com/x'))))).toBe('<https://a.com/x|docs>');
    expect(text(p(t('https://a.com', link('https://a.com'))))).toBe('<https://a.com>');
    expect(text(p(t('docs', 'bold', link('https://a.com'))))).toBe('*<https://a.com|docs>*');
  });
  it('encodes | in URLs and escapes & in them', () => {
    expect(text(p(t('x', link('https://a.com/a|b?x=1&y=2'))))).toBe('<https://a.com/a%7Cb?x=1&amp;y=2|x>');
  });
  it('drops unsafe link schemes with a warning', () => {
    const r = mk(p(t('click', link('javascript:alert(1)'))));
    expect(r.payload.text).toBe('click');
    expect(r.warnings.map((w) => w.code)).toContain('unsafe_link');
    expect(r.lossy[0]).toMatchObject({ kind: 'link' });
  });
});

describe('slack mrkdwn serializer: escaping', () => {
  it('escapes & < >', () => {
    expect(text(p(t('a & b < c > d')))).toBe('a &amp; b &lt; c &gt; d');
  });
  it('a literal "<@U1>" typed by the user cannot become a mention', () => {
    expect(text(p(t('<@U1>')))).toBe('&lt;@U1&gt;');
  });
  it('guards literal formatting characters but leaves intraword ones alone', () => {
    expect(text(p(t('2*3*4 and snake_case_name')))).toBe('2*3*4 and snake_case_name');
    expect(text(p(t('*not bold*')))).toBe('*\u200bnot bold*\u200b');
    expect(text(p(t('a `b`')))).toBe('a `\u200bb`\u200b');
  });
  it('escapes inside code and links too', () => {
    expect(text(p(t('a<b', 'code')))).toBe('`a&lt;b`');
    expect(text(p(t('a<b', link('https://x.com'))))).toBe('<https://x.com|a&lt;b>');
  });
  it('a line starting with > is escaped, not a quote', () => {
    expect(text(p(t('> hi')))).toBe('&gt; hi');
  });
});

describe('slack mrkdwn serializer: nodes', () => {
  it('paragraphs are separated by a blank line; hardBreak is a newline', () => {
    expect(text(p(t('a')), p(t('b'), br(), t('c')))).toBe('a\n\nb\nc');
  });
  it('drops empty paragraphs', () => {
    expect(text(p(t('a')), p(), p(t('b')))).toBe('a\n\nb');
  });
  it('bullet and ordered lists', () => {
    expect(text(ul(li(p(t('a'))), li(p(t('b')))))).toBe('• a\n• b');
    expect(text(ol([li(p(t('a'))), li(p(t('b')))]))).toBe('1. a\n2. b');
    expect(text(ol([li(p(t('a')))], 5))).toBe('5. a');
  });
  it('nested lists indent by four spaces', () => {
    expect(text(ul(li(p(t('a')), ol([li(p(t('x'))), li(p(t('y')))])), li(p(t('b')))))).toBe('• a\n    1. x\n    2. y\n• b');
  });
  it('multi-paragraph list items continue on indented lines', () => {
    expect(text(ul(li(p(t('a')), p(t('more')))))).toBe('• a\n  more');
  });
  it('heading becomes a bold line and is reported', () => {
    const r = mk(h(2, t('Title')), p(t('body')));
    expect(r.payload.text).toBe('*Title*\n\nbody');
    expect(r.lossy).toEqual([{ kind: 'node', from: 'heading', to: 'bold line', count: 1 }]);
  });
  it('heading with an inner bold does not double the delimiters', () => {
    expect(text(h(1, t('a', 'bold'), t(' b')))).toBe('*a b*');
  });
  it('blockquote becomes > lines', () => {
    expect(text(bq(p(t('one')), p(t('two'))))).toBe('> one\n>\n> two');
  });
  it('code block is fenced and escaped', () => {
    expect(text(code('if (a < b) {\n  x();\n}', 'ts'))).toBe('```\nif (a &lt; b) {\n  x();\n}\n```');
  });
  it('a fence inside code is defused', () => {
    const r = mk(code('a ``` b'));
    expect(r.payload.text).not.toContain('a ``` b');
    expect(r.lossy.length).toBe(1);
  });
  it('table becomes bullets and is reported', () => {
    const r = mk(table([cell('Name', true), cell('Role', true)], [cell('Dana'), cell('SE')], [cell('Raj'), cell('AE')]));
    expect(r.payload.text).toBe('• Name: Dana; Role: SE\n• Name: Raj; Role: AE');
    expect(r.lossy).toEqual([{ kind: 'node', from: 'table', to: 'bullets', count: 1 }]);
  });
  it('headerless table uses pipes', () => {
    expect(text(table([cell('a'), cell('b')]))).toBe('• a | b');
  });
  it('lossy counts accumulate', () => {
    expect(mk(h(1, t('a')), h(2, t('b'))).lossy).toEqual([{ kind: 'node', from: 'heading', to: 'bold line', count: 2 }]);
  });
});

describe('slack mrkdwn serializer: mentions', () => {
  it('user, channel, usergroup', () => {
    expect(text(p(mention('U123', 'Dana'), t(' in '), mention('C99', 'general', { kind: 'channel' })))).toBe('<@U123> in <#C99>');
    expect(text(p(mention('S77', 'se-team', { kind: 'usergroup' })))).toBe('<!subteam^S77>');
  });
  it('@here / @channel serialize with a warning', () => {
    const r = mk(p(mention('here', 'here', { kind: 'special' }), t(' look')));
    expect(r.payload.text).toBe('<!here> look');
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'broadcast_mention' })]);
    expect(mk(p(mention('channel'))).payload.text).toBe('<!channel>');
  });
  it('no warning for normal mentions', () => {
    expect(mk(p(mention('U1'))).warnings).toEqual([]);
  });
});

describe('slack mrkdwn size', () => {
  it('warns past 40k', () => {
    const r = mk(p(t('x'.repeat(40_001))));
    expect(r.warnings.map((w) => w.code)).toContain('size_exceeded');
  });
});
