import { describe, expect, it } from 'vitest';
import { normalizeDoc, parseEmailHtml, parseSlackMrkdwn, serializeEmailHtml, serializeSlackMrkdwn } from '@/lib/compose';
import { bq, br, cell, code, doc, li, link, mention, ol, p, t, table, ul, h } from './helpers';
import type { ComposeDoc } from '@/lib/compose';

const viaSlack = (d: ComposeDoc) => parseSlackMrkdwn(serializeSlackMrkdwn(d).payload.text);
const viaEmail = (d: ComposeDoc) => parseEmailHtml(serializeEmailHtml(d).payload.html);

const slackSubset: [string, ComposeDoc][] = [
  ['plain paragraphs', doc(p(t('Hello world')), p(t('second')))],
  ['marks', doc(p(t('a', 'bold'), t(' '), t('b', 'italic'), t(' '), t('c', 'strike'), t(' d '), t('e', 'code')))],
  ['nested marks', doc(p(t('a ', 'bold'), t('b', 'bold', 'italic'), t(' c', 'bold'), t(' '), t('z', 'strike')))],
  ['links', doc(p(t('see '), t('docs', link('https://a.com/x')), t(' and '), t('https://b.com', link('https://b.com'))))],
  ['bold link', doc(p(t('docs', 'bold', link('https://a.com'))))],
  ['special characters', doc(p(t('a & b < c > d')))],
  ['asterisks in words', doc(p(t('2*3*4 and snake_case_name')))],
  ['literal formatting chars', doc(p(t('*not bold* and _not italic_ and ~x~ and `y`')))],
  ['url with encoded pipe and ampersand', doc(p(t('x', link('https://a.com/a%7Cb?x=1&y=2'))))],
  ['hard breaks', doc(p(t('a'), br(), t('b')))],
  ['bullet list', doc(ul(li(p(t('a'))), li(p(t('b', 'bold')))))],
  ['ordered list', doc(ol([li(p(t('a'))), li(p(t('b')))]))],
  ['ordered list with start', doc(ol([li(p(t('a')))], 4))],
  ['nested lists', doc(ul(li(p(t('a')), ol([li(p(t('x')), ul(li(p(t('deep'))))), li(p(t('y')))])), li(p(t('b')))))],
  ['list between paragraphs', doc(p(t('before')), ul(li(p(t('a')))), p(t('after')))],
  ['blockquote', doc(bq(p(t('one')), p(t('two'))))],
  ['quote with list', doc(bq(p(t('intro')), ul(li(p(t('a'))))))],
  ['code block', doc(code('if (a < b) {\n  go();\n}'))],
  ['code between text', doc(p(t('x')), code('y'), p(t('z')))],
  ['mentions', doc(p(mention('U123', 'U123'), t(' in '), mention('C99', 'C99', { kind: 'channel' }), t(' '), mention('here', 'here', { kind: 'special' })))],
  ['mention in bold', doc(p(t('hey ', 'bold'), { ...mention('U1', 'U1'), marks: [{ type: 'bold' }] }))],
];

describe('TipTap -> mrkdwn -> TipTap round trip (supported subset)', () => {
  it.each(slackSubset)('%s', (_name, d) => {
    expect(viaSlack(d)).toEqual(normalizeDoc(d));
  });
  it('is stable: serialize(parse(serialize(d))) === serialize(d)', () => {
    for (const [, d] of slackSubset) {
      const once = serializeSlackMrkdwn(d).payload.text;
      expect(serializeSlackMrkdwn(parseSlackMrkdwn(once)).payload.text).toBe(once);
    }
  });
});

describe('mrkdwn edge cases', () => {
  it('| in a URL is percent-encoded (the only normalization), so <url|label> stays parseable', () => {
    const d = viaSlack(doc(p(t('x', link('https://a.com/a|b')))));
    expect(d.content[0]!.content![0]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://a.com/a%7Cb' } }]);
  });
  it('whitespace at the edge of a styled run moves outside the delimiters', () => {
    const d = viaSlack(doc(p(t(' b ', 'italic'))));
    expect(d.content[0]!.content).toEqual([{ type: 'text', text: ' ' }, { type: 'text', text: 'b', marks: [{ type: 'italic' }] }, { type: 'text', text: ' ' }]);
    expect(serializeSlackMrkdwn(doc(p(t(' b ', 'italic')))).payload.text).toBe(' _b_ ');
  });
});

describe('parseSlackMrkdwn on Slack-native text', () => {
  it('parses what Slack itself produces', () => {
    const d = parseSlackMrkdwn('*Status:* all _good_ ~old~\n• one\n• two\n\n> quoted &amp; escaped\n```\ncode\n```\nsee <https://x.com|site> cc <@U1> <#C2|general> <!channel>');
    expect(d.content.map((n) => n.type)).toEqual(['paragraph', 'bulletList', 'blockquote', 'codeBlock', 'paragraph']);
    const last = d.content[4]!.content!;
    expect(last.find((n) => n.type === 'mention' && n.attrs?.kind === 'channel')?.attrs?.label).toBe('general');
    expect(d.content[2]!.content![0]!.content![0]!.text).toBe('quoted & escaped');
  });
  it('resolves mention labels', () => {
    const d = parseSlackMrkdwn('hi <@U1>', { labels: { U1: 'Dana' } });
    expect(d.content[0]!.content![1]!.attrs?.label).toBe('Dana');
  });
  it('keeps "- " lines as text (Slack shows hyphens literally); • bullets and indentation are lists', () => {
    const dash = parseSlackMrkdwn('- a\n  - b\n- c');
    expect(dash.content.map((n) => n.type)).toEqual(['paragraph']);
    expect(dash.content[0]!.content!.filter((n) => n.type === 'text').map((n) => n.text)).toEqual(['- a', '  - b', '- c']);
    const d = parseSlackMrkdwn('• a\n    • b\n• c');
    expect(d.content).toHaveLength(1);
    expect(d.content[0]!.content).toHaveLength(2);
  });
  it('does not treat intraword or spaced delimiters as formatting', () => {
    const d = parseSlackMrkdwn('a*b*c and 2 * 3 * 4');
    expect(d.content[0]!.content).toEqual([{ type: 'text', text: 'a*b*c and 2 * 3 * 4' }]);
  });
  it('unknown <...> tokens stay literal text', () => {
    expect(parseSlackMrkdwn('a <b> c').content[0]!.content![0]!.text).toBe('a <b> c');
  });
  it('empty input -> empty doc', () => {
    expect(parseSlackMrkdwn('').content).toEqual([]);
  });
});

const emailSubset: [string, ComposeDoc][] = [
  ['paragraphs and marks', doc(p(t('a', 'bold'), t(' b ', 'italic'), t('c', 'strike'), t(' '), t('d', 'code')), p(t('second')))],
  ['combined marks', doc(p(t('x', 'bold', 'italic', 'strike')))],
  ['links', doc(p(t('docs', link('https://a.com/?a=1&b=2')), t(' '), t('mail', 'bold', link('mailto:x@example.com'))))],
  ['entities', doc(p(t('<b> & "q" \'s\'')))],
  ['hard break', doc(p(t('a'), br(), t('b')))],
  ['heading', doc(h(1, t('One')), h(3, t('Three', 'bold')))],
  ['lists', doc(ul(li(p(t('a')), ol([li(p(t('x')))], 2)), li(p(t('b')))), ol([li(p(t('n')))], 7))],
  ['blockquote', doc(bq(p(t('q1')), p(t('q2'))))],
  ['code block', doc(code('a < b\n  c'))],
  ['table', doc(table([cell('H1', true), cell('H2', true)], [cell('a'), cell('b')]))],
];

describe('TipTap -> email HTML -> TipTap round trip (supported subset)', () => {
  it.each(emailSubset)('%s', (_name, d) => {
    expect(viaEmail(d)).toEqual(normalizeDoc(d));
  });
});

describe('parseEmailHtml on foreign HTML', () => {
  it('handles typical Gmail markup', () => {
    const d = parseEmailHtml(
      '<div dir="ltr">Hi Dana,<div><br></div><div>Thanks <b>so</b> much!</div><div><a href="https://x.com">link</a></div></div>',
    );
    expect(d.content.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(d.content[0]!.content![0]!.text).toBe('Hi Dana,');
  });
  it('drops script/style and unsafe links', () => {
    const d = parseEmailHtml('<style>p{}</style><p>a <a href="javascript:x()">b</a><script>evil()</script></p>');
    expect(JSON.stringify(d)).not.toMatch(/evil|javascript|p\{\}/);
    expect(d.content[0]!.content![0]!.text).toBe('a b');
  });
  it('collapses source whitespace', () => {
    expect(parseEmailHtml('<p>a\n   b</p>').content[0]!.content![0]!.text).toBe('a b');
  });
  it('implied </p> and </li>', () => {
    expect(parseEmailHtml('<p>a<p>b').content).toHaveLength(2);
    expect(parseEmailHtml('<ul><li>a<li>b</ul>').content[0]!.content).toHaveLength(2);
  });
});
