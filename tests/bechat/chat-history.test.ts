/**
 * The thread history each Assistant turn sees (renderHistory): a list the user pasted once lasts the thread. Cut to
 * 1,200 characters, an 83-row paste showed 14 rows on the next turn, so the Assistant kept asking for the list in
 * pieces. A6 (2026-11-13): the user's messages stay whole up to 120,000 characters, the Assistant's replies keep
 * 8,000, the thread is sized to the model's context (older messages drop first), and a card carries its lines.
 */
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/contract';
import { HISTORY_ASSISTANT_MAX, HISTORY_MAX_CHARS, HISTORY_USER_MAX, renderHistory } from '@/llm/chat/prompt';
import { loadSkill } from '@/llm/skill-loader';

const msg = (role: ChatMessage['role'], text: string, n: number): ChatMessage => ({ id: `m${n}`, threadId: 't1', role, at: `2026-11-13T10:${String(n).padStart(2, '0')}:00.000Z`, text, parts: [], context: [], isMorningBrief: false });

/** A pasted sheet: one tab-separated row per opp (placeholder names). */
const rows = (n: number) => Array.from({ length: n }, (_, i) => `SAF-0${5_000_000 + i}\tPlaceholder Account ${i}\tPlaceholder Account ${i} - Data Cloud Expansion`).join('\n');

describe('renderHistory', () => {
  it('keeps a pasted list whole on later turns', () => {
    const paste = rows(83);
    expect(paste.length).toBeGreaterThan(5000);
    const h = renderHistory([msg('user', paste, 1), msg('assistant', 'I have the list, so I’ll check it against your DCs.', 2), msg('user', 'That DC comment is wrong. Only say SE support', 3)]);
    expect(h).toContain('Placeholder Account 82 - Data Cloud Expansion');
    expect(h.match(/SAF-0/g)).toHaveLength(83);
  });

  it('keeps a user message whole up to 120,000 characters and an Assistant reply up to 8,000', () => {
    expect(HISTORY_USER_MAX).toBeGreaterThanOrEqual(100_000);
    expect(HISTORY_ASSISTANT_MAX).toBe(8_000);
    expect(rows(1_000).length).toBeGreaterThan(80_000);
    const whole = renderHistory([msg('user', rows(1_000), 1), msg('assistant', 'z'.repeat(7_000), 2)]);
    expect(whole.match(/SAF-0/g)).toHaveLength(1_000);
    expect(whole).toContain('z'.repeat(7_000));
    const long = 'x'.repeat(HISTORY_USER_MAX + 500);
    const h = renderHistory([msg('user', long, 1), msg('assistant', 'y'.repeat(HISTORY_ASSISTANT_MAX + 500), 2)]);
    const [user, assistant] = h.split('\n\n');
    expect(user!.length).toBe('User: '.length + HISTORY_USER_MAX);
    expect(user!.endsWith('…')).toBe(true);
    expect(assistant!.length).toBe('Assistant: '.length + HISTORY_ASSISTANT_MAX);
  });

  it('drops the oldest messages first once the thread is over the total', () => {
    const many = Array.from({ length: 6 }, (_, i) => msg('user', `${i}:${rows(1_000)}`, i));
    const h = renderHistory(many);
    expect(h.length).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    expect(h).toContain('User: 5:');
    expect(h).not.toContain('User: 0:');
    // a smaller budget (a test's) still drops oldest first
    expect(renderHistory(many, { maxChars: 24_000 })).not.toContain('User: 4:');
  });

  it("carries a staged card's lines and an Apply's failed lines", () => {
    const card: ChatMessage = {
      ...msg('assistant', 'Staged the claims.', 2),
      parts: [
        { type: 'proposal', status: 'applied', summary: 'Claim DCs on 2 opportunities?', proposal: { id: 'p1', entity: { type: 'chat_thread', id: 't1', label: '2 changes' }, changes: [{ field: 'createDcRequest', label: 'DC claim · ACCOUNT_1 · Renewal', before: null, after: '100% · “SE support”' }, { field: 'createDcRequest', label: 'DC claim · ACCOUNT_2 · Pilot', before: null, after: '50%' }], reason: 'Claim DCs on 2 opportunities?', source: null, createdAt: '2026-11-13T10:02:00.000Z', status: 'applied', actor: 'chat', baseVersion: null, textDiff: null, resolvedAt: null } },
        { type: 'receipt', receipt: { id: 'r1', at: '2026-11-13T10:03:00.000Z', actor: 'chat', summary: 'Applied 1 of 2 · 1 failed: no such opp', changes: [], staged: false, total: 2, failed: [{ label: 'DC claim · ACCOUNT_2 · Pilot', reason: 'no such opp' }] } },
      ] as ChatMessage['parts'],
    };
    const h = renderHistory([msg('user', 'claim these', 1), card]);
    expect(h).toContain('- DC claim · ACCOUNT_1 · Renewal: — → 100% · “SE support”');
    expect(h).toContain('- DC claim · ACCOUNT_2 · Pilot: — → 50%');
    expect(h).toContain('- failed: DC claim · ACCOUNT_2 · Pilot: no such opp');
  });
});

describe('the Assistant skill on DC claims and lists (chat-assistant@10)', () => {
  const skill = loadSkill('skills/chat-assistant.md');

  it('never invents the work in a DC comment, and asks for one when there is no evidence', () => {
    expect(skill.versionTag).toBe('chat-assistant@10');
    expect(skill.body).toMatch(/The DC comment is true, and it's theirs/);
    expect(skill.body).toMatch(/Never invent work/);
    expect(skill.body).toMatch(/nothing about who approved the claim/);
    expect(skill.body).toMatch(/ask once for the comment, offering a plain one \("SE support"\), and use their wording exactly/);
  });

  it('claims on opps the app does not track go by Org62 id; lists come from the thread or every Drive page', () => {
    expect(skill.body).toMatch(/the claim reads it from Org62 and adds it with its account/);
    expect(skill.body).toMatch(/`addOrg62Opps \{org62Ids\}` adds opps without claiming/);
    expect(skill.body).toMatch(/A list they pasted earlier is in the thread above, whole: work from it, never ask for it again/);
    expect(skill.body).toMatch(/read every page \(`chat_drive_read` again with the offset/);
  });

  it('v10: reads page until nextOffset is null, any list is one card, Apply lands what works, ifVersion is filled', () => {
    expect(skill.body).toMatch(/Reads page, never cut/);
    expect(skill.body).toMatch(/While `nextOffset` is set, read again with `offset: nextOffset`/);
    expect(skill.body).toMatch(/a list of 55 claims is one card of 55 calls, never "\(1 of 2\)"/);
    expect(skill.body).toMatch(/the ones that work land, one that fails is listed on the receipt with its reason, and Undo all reverts every one that landed/);
    expect(skill.body).toMatch(/A PATCH's `ifVersion` can be left out/);
    expect(skill.body).not.toMatch(/up to 40 calls|chat_read\b|chat_get_|chat_search_items/);
    expect(skill.frontmatter.allowed_tools).not.toContain('chat_read');
  });
});
