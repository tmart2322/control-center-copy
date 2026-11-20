/**
 * `renderSourceBody`: a source message (the Slack message or email a draft replies to) → sanitized rich HTML + text.
 * Placeholders only.
 */
import { describe, expect, it } from 'vitest';
import { closeCutMarkup, renderSourceBody, sourceMentionIds } from '@/lib/compose';

const LABELS = { U0RAJ: 'Raj Mehta', U0DANA: 'Dana Reyes' };

describe('renderSourceBody: Slack mrkdwn', () => {
  const body =
    'Are we still showing the *service-agent handoff* today? <@U0RAJ> and <@U0NOBODY> said _maybe_ ~not~, see <https://example.com/plan|the Phase 2 plan> :eyes: in <#C0ACME|acme-ext>\n• Agenda\n• `demo-env` access\n&gt; a quoted line\n```\nnpm run demo\n```';
  const r = renderSourceBody(body, 'slack_mrkdwn', { labels: LABELS });

  it('renders bold, italics, strike, links, code, code blocks, lists and quotes', () => {
    expect(r.html).toContain('<strong>service-agent handoff</strong>');
    expect(r.html).toContain('<em>maybe</em>');
    expect(r.html).toContain('<s>not</s>');
    expect(r.html).toContain('<a href="https://example.com/plan" target="_blank" rel="noopener noreferrer">the Phase 2 plan</a>');
    expect(r.html).toContain('<ul><li>Agenda</li><li><code class="cc-code">demo-env</code> access</li></ul>');
    expect(r.html).toContain('<blockquote class="cc-quote"><p>a quoted line</p></blockquote>');
    expect(r.html).toContain('<pre class="cc-pre">npm run demo</pre>');
  });

  it('shows mentions by name; an unknown id reads "@someone", never the raw id; channels by name', () => {
    expect(r.html).toContain('<span class="cc-mention">@Raj Mehta</span>');
    expect(r.html).toContain('<span class="cc-mention">@someone</span>');
    expect(r.html).toContain('<span class="cc-mention">#acme-ext</span>');
    expect(r.html).not.toContain('U0NOBODY');
    expect(r.text).toContain('@Raj Mehta and @someone said maybe');
    expect(sourceMentionIds(body)).toEqual(['U0RAJ', 'U0NOBODY']);
  });

  it('leaves emoji shortcodes readable and keeps an inline mention label', () => {
    expect(r.html).toContain(':eyes:');
    expect(renderSourceBody('cc <@U0ZED|zed>', 'slack_mrkdwn').html).toContain('@zed');
    expect(renderSourceBody('cc <@U0ZED|zed>', 'slack_mrkdwn').html).not.toContain('someone');
  });

  it('plain text carries the link targets and the list markers', () => {
    expect(r.text).toContain('the Phase 2 plan (https://example.com/plan)');
    expect(r.text).toMatch(/- Agenda\n- demo-env access/);
  });

  it('shows a date token by its fallback', () => {
    expect(renderSourceBody('Due <!date^1793893334^{date_short}|Nov 5>', 'slack_mrkdwn').text).toBe('Due Nov 5');
  });

  it('is sanitized: markup and script-ish links in the text stay text', () => {
    const evil = renderSourceBody('<script>alert(1)</script> <javascript:alert(1)|click> <img src=x onerror=alert(1)> *ok*', 'slack_mrkdwn');
    expect(evil.html).not.toMatch(/<script|<img|href="javascript/i); // markup in the text is escaped text, never a tag
    expect(evil.html).toContain('&lt;script&gt;');
    expect(evil.html).toContain('<strong>ok</strong>');
  });
});

describe('renderSourceBody: email', () => {
  it('HTML goes through the allowlist sanitizer: no scripts, handlers, images or javascript: links', () => {
    const r = renderSourceBody('<p onclick="x()">Hi <b>Jordan</b></p><img src=x onerror=alert(1)><script>steal()</script><a href="javascript:alert(1)">bad</a> <a href="https://ok.example/doc">the doc</a><style>p{}</style>', 'html');
    expect(r.html).toContain('<p>Hi <b>Jordan</b></p>');
    expect(r.html).toContain('<a href="https://ok.example/doc" target="_blank" rel="noopener noreferrer">the doc</a>');
    expect(r.html).not.toMatch(/onclick|<img|<script|steal|javascript:|<style/i);
    expect(r.text).toContain('Hi Jordan');
  });

  it('plain text keeps paragraphs and line breaks, links URLs, quotes ">" lines, escapes markup', () => {
    const r = renderSourceBody('Hi Jordan,\nsee https://example.com/x.\n\n> On Tue you wrote:\n> <b>old</b>', 'plain');
    expect(r.html).toContain('<p>Hi Jordan,<br>see <a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a>.</p>');
    expect(r.html).toContain('<blockquote class="cc-quote">On Tue you wrote:<br>&lt;b&gt;old&lt;/b&gt;</blockquote>');
    expect(r.text).toBe('Hi Jordan,\nsee https://example.com/x.\n\n> On Tue you wrote:\n> <b>old</b>');
  });

  it('markdown adds links, bold, italics and code; only http(s) links', () => {
    const r = renderSourceBody('**Bold** and [a link](https://x.example) and *it* and `c` and [bad](javascript:alert(1))', 'markdown');
    expect(r.html).toContain('<strong>Bold</strong>');
    expect(r.html).toContain('<a href="https://x.example" target="_blank" rel="noopener noreferrer">a link</a>');
    expect(r.html).toContain('<em>it</em>');
    expect(r.html).toContain('<code class="cc-code">c</code>');
    expect(r.html).not.toContain('href="javascript');
  });

  it('an empty body renders nothing; a very long one is cut', () => {
    expect(renderSourceBody('', 'plain')).toEqual({ html: '', text: '' });
    expect(renderSourceBody(null, 'slack_mrkdwn')).toEqual({ html: '', text: '' });
    expect(renderSourceBody('x'.repeat(50), 'plain', { maxChars: 10 }).text).toBe(`${'x'.repeat(10)}…`);
  });
});

describe('renderSourceBody: a Slack body cut inside its markup (ingest caps stored bodies)', () => {
  const html = (s: string) => renderSourceBody(s, 'slack_mrkdwn', { labels: LABELS }).html;

  it('closes a cut mention, channel or labelled link, and says the text goes on', () => {
    expect(closeCutMarkup('ask <@U0DANA|dana')).toBe('ask <@U0DANA|dana>…');
    expect(html('ask <@U0DANA|dana')).toContain('ask <span class="cc-mention">@Dana Reyes</span>…');
    expect(html('ask <@U0DA')).toContain('<span class="cc-mention">@someone</span>…'); // the id itself was cut
    expect(html('in <#C0ACME|acme-e')).toContain('<span class="cc-mention">#acme-e</span>…');
    expect(html('see <https://example.com/plan|the Pha')).toContain('<a href="https://example.com/plan" target="_blank" rel="noopener noreferrer">the Pha</a>…');
  });

  it('a bare URL cut short stays text (its address is incomplete); a closed body is untouched', () => {
    expect(html('see <https://example.com/very/lo')).toContain('<p>see https://example.com/very/lo…</p>');
    expect(html('see <https://example.com/very/lo…')).toContain('<p>see https://example.com/very/lo…</p>'); // no double ellipsis
    for (const s of ['ok <@U0RAJ> and 3 < 4', 'fine <https://example.com/x>', 'a <@']) expect(closeCutMarkup(s)).toBe(s);
    for (const s of ['ask <@U0DANA|dana', 'see <https://example.com/very/lo', 'see <https://example.com/plan|the Pha']) expect(html(s)).not.toMatch(/&lt;(@|https?:)/);
  });

  it('the cut mention still counts as mentioned (so its name can be looked up)', () => {
    expect(sourceMentionIds(closeCutMarkup('ask <@U0DANA'))).toEqual(['U0DANA']);
  });
});
