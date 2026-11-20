import { describe, expect, it } from 'vitest';
import { serializeEmailHtml, serializePlain } from '@/lib/compose';
import { bq, br, cell, code, doc, h, li, link, mention, ol, p, t, table, ul } from './helpers';

const html = (...c: Parameters<typeof doc>) => serializeEmailHtml(doc(...c)).payload.html;
const inner = (...c: Parameters<typeof doc>) => html(...c).replace(/^<div style="[^"]*">/, '').replace(/<\/div>$/, '');
const plain = (...c: Parameters<typeof doc>) => serializePlain(doc(...c)).payload.text;

describe('email html', () => {
  it('wraps in one styled div and uses inline styles only', () => {
    const out = html(p(t('hi')));
    expect(out.startsWith('<div style="font-family:Arial')).toBe(true);
    expect(out).not.toMatch(/<style|class=|display:\s*(flex|grid)|border-radius/);
  });
  it('paragraph, marks', () => {
    expect(inner(p(t('a', 'bold'), t('b', 'italic'), t('c', 'strike')))).toBe(
      '<p style="margin:0 0 12px 0;"><strong>a</strong><em>b</em><s>c</s></p>',
    );
    expect(inner(p(t('x', 'code')))).toContain('<code style="font-family:Menlo');
  });
  it('escapes HTML', () => {
    expect(inner(p(t('<script>alert("x")</script> & co')))).toBe(
      '<p style="margin:0 0 12px 0;">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co</p>',
    );
  });
  it('links are <a href> with escaped attribute', () => {
    expect(inner(p(t('go', link('https://a.com/?a=1&b="2"'))))).toContain('<a href="https://a.com/?a=1&amp;b=%222%22" style="color:#1155cc;">go</a>');
  });
  it('unsafe links degrade to text', () => {
    const r = serializeEmailHtml(doc(p(t('x', link('javascript:alert(1)')))));
    expect(r.payload.html).not.toContain('href');
    expect(r.lossy[0]).toMatchObject({ kind: 'link' });
  });
  it('headings, lists, quote, code, hr, br', () => {
    expect(inner(h(2, t('T')))).toBe('<h2 style="margin:0 0 12px 0;font-size:18px;line-height:1.3;">T</h2>');
    expect(inner(ul(li(p(t('a'))), li(p(t('b')))))).toBe(
      '<ul style="margin:0 0 12px 0;padding-left:24px;"><li style="margin:0 0 4px 0;">a</li><li style="margin:0 0 4px 0;">b</li></ul>',
    );
    expect(inner(ol([li(p(t('a')))], 3))).toContain('<ol start="3"');
    expect(inner(bq(p(t('q'))))).toContain('<blockquote style="margin:0 0 12px 0;padding:0 0 0 12px;border-left');
    expect(inner(code('a<b'))).toContain('<pre style=');
    expect(inner(code('a<b'))).toContain('<code>a&lt;b</code>');
    expect(inner(p(t('a'), br(), t('b')))).toContain('a<br>b');
  });
  it('nested list is inside the li', () => {
    expect(inner(ul(li(p(t('a')), ul(li(p(t('x')))))))).toMatch(/<li[^>]*>a<ul[^>]*><li[^>]*>x<\/li><\/ul><\/li>/);
  });
  it('tables use real table markup with no flex/grid', () => {
    const out = inner(table([cell('H', true)], [cell('v')]));
    expect(out).toContain('<table cellpadding="0" cellspacing="0" border="0"');
    expect(out).toContain('<th style=');
    expect(out).toContain('<td style=');
  });
  it('mentions become plain names or mailto links', () => {
    const r = serializeEmailHtml(doc(p(mention('U1', 'Dana'), t(' / '), mention('U2', 'Raj', { email: 'raj@example.com' }))));
    expect(r.payload.html).toContain('Dana /');
    expect(r.payload.html).toContain('<a href="mailto:raj@example.com"');
    expect(r.lossy).toEqual([{ kind: 'mention', from: 'user mention', to: 'plain name', count: 1 }]);
  });
  it('includes a text/plain alternative', () => {
    expect(serializeEmailHtml(doc(p(t('hi', 'bold')), ul(li(p(t('a')))))).payload.text).toBe('hi\n\n- a');
  });
  it('warns when the HTML passes 102 KB', () => {
    const small = serializeEmailHtml(doc(p(t('x'.repeat(1000)))));
    expect(small.warnings).toEqual([]);
    const big = serializeEmailHtml(doc(p(t('x'.repeat(103 * 1024)))));
    expect(big.warnings.map((w) => w.code)).toEqual(['size_exceeded']);
  });
  it('counts bytes, not characters', () => {
    const r = serializeEmailHtml(doc(p(t('é'.repeat(52 * 1024)))));
    expect(r.warnings.map((w) => w.code)).toEqual(['size_exceeded']);
  });
});

describe('plain text', () => {
  it('paragraphs, breaks, lists, quotes', () => {
    expect(plain(p(t('a')), p(t('b'), br(), t('c')), ul(li(p(t('x')), ol([li(p(t('y')))]))), bq(p(t('q'))))).toBe(
      'a\n\nb\nc\n\n- x\n  1. y\n\n> q',
    );
  });
  it('links show url; mentions show @name', () => {
    expect(plain(p(t('docs', link('https://a.com')), t(' '), mention('U1', 'Dana')))).toBe('docs (https://a.com) @Dana');
  });
  it('reports formatting it drops', () => {
    const r = serializePlain(doc(h(1, t('T')), p(t('x', 'bold'), t('y', 'bold'))));
    expect(r.payload.text).toBe('T\n\nxy');
    expect(r.lossy).toEqual([
      { kind: 'node', from: 'heading', to: 'text', count: 1 },
      { kind: 'mark', from: 'bold', to: 'plain text', count: 2 },
    ]);
  });
  it('table becomes pipe rows', () => {
    expect(plain(table([cell('a'), cell('b')], [cell('c'), cell('d')]))).toBe('a | b\nc | d');
  });
});
