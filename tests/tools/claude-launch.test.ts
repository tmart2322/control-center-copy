import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_CHARS, LaunchError, assertOpenAllowed, buildContextPack, ccTag, continueUrl, desktopSessionId,
  needsInputUrl, newSessionUrl, packPrompt, parseCcTag, prepareKickoff, resumeUrl, type ContextPackInput,
} from '@/tools/claude-launch';

// NOTE: open() is deliberately never called here. assertOpenAllowed is the pure gate it uses.

const input: ContextPackInput = {
  workItem: { id: 'wi_123', title: 'Package Beacon app for Ravi', summary: 'Ravi needs a distributable desktop build of the Beacon app.', task: 'Produce a packaged build and a short README.', doneWhen: ['Build runs on a clean Mac', 'README lists prerequisites'], dueAt: '2026-11-12' },
  initiative: { name: 'Beacon enablement', summary: 'Hand the tool to the team' },
  assets: [
    { kind: 'drive', title: 'Beacon notes', url: 'https://docs.google.com/document/d/DOC_1' },
    { kind: 'slack', title: 'Ravi thread', url: 'https://example.slack.com/archives/C1/p1' },
  ],
  sessions: [{ id: 'local_abc', title: 'Earlier Beacon session', summary: 'Node-only variant' }],
  people: [{ name: 'Ravi', role: 'requester' }],
  opp: { name: 'Beacon rollout', stage: 'Discovery', account: 'ACCOUNT_1' },
  repoPath: '/Users/test/Projects/beacon-app',
  branchHint: 'cc/wi_123-package',
};

describe('tag', () => {
  it('formats and parses', () => {
    expect(ccTag('wi_123')).toBe('[cc:wi_123]');
    expect(parseCcTag('hello [cc:wi_123] there')).toBe('wi_123');
    expect(parseCcTag('no tag')).toBeUndefined();
  });
  it('rejects ids that could break the tag', () => {
    for (const bad of ['', 'a b', 'a]b', 'x'.repeat(65), 'a\nb']) expect(() => ccTag(bad)).toThrow(LaunchError);
  });
});

describe('context pack', () => {
  const pack = buildContextPack(input);

  it('begins with the tag on the very first characters', () => {
    expect(pack.prompt.startsWith('[cc:wi_123]\n\n')).toBe(true);
    expect(pack.trimmed).toBe(false);
  });

  it('snapshot', () => {
    expect(pack.prompt).toMatchInlineSnapshot(`
      "[cc:wi_123]

      ## Goal
      Package Beacon app for Ravi

      Ravi needs a distributable desktop build of the Beacon app.
      Initiative: Beacon enablement: Hand the tool to the team

      ## What done looks like
      Produce a packaged build and a short README.
      - Build runs on a clean Mac
      - README lists prerequisites
      Due: 2026-11-12

      ## Links
      Drive and docs:
      - [Beacon notes](https://docs.google.com/document/d/DOC_1)
      Slack permalinks:
      - [Ravi thread](https://example.slack.com/archives/C1/p1)
      Prior sessions:
      - Earlier Beacon session (local_abc): Node-only variant

      ## Opportunity
      - Beacon rollout (ACCOUNT_1)
      - Stage: Discovery

      ## People
      - Ravi (requester)

      ## Constraints
      - Work only in /Users/test/Projects/beacon-app.
      - Commit on a branch (suggested: cc/wi_123-package); never commit to main.
      - Do not send, post, or write to any external system (Slack, Gmail, Calendar, Drive, Org62, VDP). Stop at drafts.
      - Do not print or copy tokens, cookies, or passwords.
      - Ask me before anything destructive or irreversible."
    `);
  });

  it('trims to the limit, keeping tag, summary, task and constraints; drops low priority first', () => {
    const big: ContextPackInput = {
      ...input,
      assets: Array.from({ length: 400 }, (_, i) => ({ kind: 'drive' as const, title: `Doc ${i}`, url: `https://docs.google.com/document/d/${'x'.repeat(60)}${i}` })),
      people: Array.from({ length: 300 }, (_, i) => ({ name: `Person ${i}`, role: 'stakeholder' })),
    };
    const p = buildContextPack(big);
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(p.prompt.length).toBe(p.length);
    expect(p.trimmed).toBe(true);
    expect(p.prompt.startsWith('[cc:wi_123]')).toBe(true);
    expect(p.prompt).toContain('## Goal');
    expect(p.prompt).toContain('## What done looks like');
    expect(p.prompt).toContain('## Constraints');
    expect(p.prompt).toContain('Do not send, post, or write to any external system');
    expect(p.truncated).toContain('links');
    expect(p.dropped).toEqual(expect.arrayContaining(['people']));
  });

  it('keeps summary and task when the budget is tiny, and drops links first', () => {
    const p = packPrompt(
      [
        { id: 'tag', text: '[cc:x]', priority: 0, required: true, order: 0 },
        { id: 'summary', text: 'S'.repeat(300), priority: 1, order: 1 },
        { id: 'task', text: 'T'.repeat(300), priority: 2, order: 2 },
        { id: 'links', text: 'L'.repeat(300), priority: 3, order: 3 },
      ],
      700,
    );
    expect(p.prompt).toContain('S'.repeat(300));
    expect(p.prompt).toContain('T'.repeat(300));
    expect(p.dropped).toContain('links');
    expect(p.length).toBeLessThanOrEqual(700);
  });
});

describe('newSessionUrl', () => {
  it('builds claude://code/new with an absolute folder and encoded q', () => {
    const url = newSessionUrl({ folder: '/Users/test/My Projects/app', prompt: '[cc:wi_1]\n\nDo a & b? 100%' });
    expect(url.startsWith('claude://code/new?folder=')).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get('folder')).toBe('/Users/test/My Projects/app');
    expect(u.searchParams.get('q')).toBe('[cc:wi_1]\n\nDo a & b? 100%');
  });

  it('refuses relative folders', () => {
    expect(() => newSessionUrl({ folder: 'beacon-app', prompt: 'x' })).toThrow(/absolute/);
  });

  it('puts the tag first when workItemId is given and the prompt lacks it', () => {
    const q = new URL(newSessionUrl({ folder: '/a', prompt: 'hello', workItemId: 'wi_9' })).searchParams.get('q');
    expect(q).toBe('[cc:wi_9]\n\nhello');
  });

  it('never exceeds 14336 decoded chars and keeps the tag', () => {
    const q = new URL(newSessionUrl({ folder: '/a', prompt: 'x'.repeat(50_000), workItemId: 'wi_9' })).searchParams.get('q')!;
    expect(q.length).toBe(MAX_PROMPT_CHARS);
    expect(q.startsWith('[cc:wi_9]')).toBe(true);
  });

  it('prepareKickoff ties pack and url together', () => {
    const k = prepareKickoff(input);
    const q = new URL(k.url).searchParams.get('q')!;
    expect(q).toBe(k.pack.prompt);
    expect(new URL(k.url).searchParams.get('folder')).toBe(input.repoPath);
    expect(parseCcTag(q)).toBe('wi_123');
  });
});

describe('deep links', () => {
  it('continue accepts last and local_ ids only', () => {
    expect(continueUrl()).toBe('claude://code/continue?session=last');
    expect(continueUrl('local_ced6bafd-55af-4a1c-9487-5725a444b28e')).toBe('claude://code/continue?session=local_ced6bafd-55af-4a1c-9487-5725a444b28e');
    expect(() => continueUrl('5c3c3624-4385-4b33-aa6a-c0ab96e8bb70')).toThrow(/CLI session UUID/);
    expect(() => continueUrl('local_x&y')).toThrow(LaunchError);
  });
  it('needs-input with and without a session', () => {
    expect(needsInputUrl()).toBe('claude://code/needs-input');
    expect(needsInputUrl('local_abc-1')).toBe('claude://code/needs-input?session=local_abc-1');
    expect(() => needsInputUrl('nope')).toThrow(LaunchError);
  });
  it('resume imports CLI uuids', () => {
    expect(resumeUrl('5c3c3624-4385-4b33-aa6a-c0ab96e8bb70')).toBe('claude://resume?session=5c3c3624-4385-4b33-aa6a-c0ab96e8bb70');
    expect(() => resumeUrl('local_abc')).toThrow(LaunchError);
  });
  it('desktopSessionId reads hostSessionId from a registry entry', () => {
    expect(desktopSessionId({ hostSessionId: 'local_ced6bafd-55af' })).toBe('local_ced6bafd-55af');
    expect(desktopSessionId({ hostSessionId: 'bad' })).toBeUndefined();
    expect(desktopSessionId({})).toBeUndefined();
  });
});

describe('open() gate (pure; open itself is never invoked)', () => {
  it('requires confirm === true', () => {
    for (const c of [undefined, false, 'true', 1]) expect(() => assertOpenAllowed('claude://code/new', c)).toThrow(/confirm/);
  });
  it('only claude:// and loopback http', () => {
    expect(() => assertOpenAllowed('claude://code/new?folder=%2Fa', true)).not.toThrow();
    expect(() => assertOpenAllowed('http://localhost:4320/', true)).not.toThrow();
    expect(() => assertOpenAllowed('https://example.com', true)).toThrow(/refusing/);
    expect(() => assertOpenAllowed('file:///etc/passwd', true)).toThrow(/refusing/);
    expect(() => assertOpenAllowed('not a url', true)).toThrow(LaunchError);
  });
});
