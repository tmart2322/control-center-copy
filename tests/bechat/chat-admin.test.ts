/**
 * The assistant's admin tools (mock DataSource + pure parts). Placeholder data only.
 *
 *   edit_activities   one proposal for many Time-page rows: preview lines, refusals (logged rows, unknown opp),
 *                     apply in one change set (opp name, account, locks, the "needs opp" issue cleared), Undo
 *   chat_org62_lookup the query is built from words (escaped, fixed fields, no long text), rows parse, Org62 ids
 *                     match the app's opps and accounts; in mock mode it says it can't go live
 *   limits            Settings ▸ Budgets ▸ Assistant feeds the chat limits; env still overrides
 *   allow more        a capped message offers a one-time "allow more", and re-sending with it runs
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { callChatTool, newToolState, type ChatToolCtx } from '@/llm/chat/tools';
import { createChatHost } from '@/server/chat/host';
import { buildOrg62Query, matchInApp, Org62LookupError, parseOrg62Rows, soqlLike } from '@/server/chat/org62';
import { chatLimitsFromEnv } from '@/server/chat/outputs';
import { lookupRecordTypeId, parseRecordTypeId, RECORD_TYPE_SOQL } from '@/server/chat/record-type';
import type { MockDataSource } from '@/server/datasource/mock';
import { collect, mockWith, of, type Seen } from './helpers';

type G = { __ccDataSource?: unknown };
let ds: MockDataSource;
const envBefore = { ...process.env };

function useDs(d: MockDataSource) {
  ds?.dispose();
  ds = d;
  (globalThis as G).__ccDataSource = ds;
}
beforeEach(() => useDs(mockWith()));
afterEach(() => {
  delete (globalThis as G).__ccDataSource;
  ds.dispose();
  process.env = { ...envBefore };
});

const hostOf = () => createChatHost(ds, ds.be6.backend(), () => ds.now());
const threadId = async () => (await ds.listChatThreads({} as never)).threads.find((t) => t.isDefault)!.id;

describe('edit_activities', () => {
  it('previews many rows in one change and refuses logged rows and unknown opps', async () => {
    const host = hostOf();
    expect(
      (
        await host.previewChanges([
          {
            op: 'edit_activities',
            entryIds: ['ac_wed_hooli'],
            patch: { status: 'approved' },
          },
        ])
      ).errors[0],
    ).toMatch(/needs a task type/);
    expect(
      (
        await host.previewChanges([
          {
            op: 'edit_activities',
            entryIds: ['ac_wed_hooli'],
            patch: { taskType: 'Made Up Type' },
          },
        ])
      ).errors[0],
    ).toMatch(/unknown task type .*Solution Design/);
    const ok = await host.previewChanges([
      {
        op: 'edit_activities',
        entryIds: ['ac_wed_hooli', 'ac_wed_nce'],
        patch: {
          oppId: 'opp_acme_af',
          status: 'approved',
          taskType: 'Solution Design',
        },
      },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.entity).toMatchObject({
      type: 'chat_thread',
      label: '2 time entries from chat',
    });
    expect(ok.lines.filter((l) => l.field === 'activity.oppId').map((l) => l.after)).toEqual(['ACME · Agentforce Service', 'ACME · Agentforce Service']);
    expect(ok.lines.some((l) => l.field === 'activity.status' && l.after === 'approved')).toBe(true);

    const logged = await host.previewChanges([
      {
        op: 'edit_activities',
        entryIds: ['ac_mon_prep'],
        patch: { oppId: 'opp_acme_af' },
      },
    ]);
    expect(logged.errors[0]).toMatch(/already logged in Org62/);
    const unknown = await host.previewChanges([
      {
        op: 'edit_activities',
        entryIds: ['ac_wed_hooli'],
        patch: { oppId: 'opp_nope' },
      },
    ]);
    expect(unknown.errors[0]).toMatch(/unknown oppId/);
    const missing = await host.previewChanges([{ op: 'edit_activities', entryIds: ['ac_nope'], patch: { durationH: 1 } }]);
    expect(missing.errors[0]).toMatch(/no activity entry/);
  });

  it('applies as one change set (opp name, account, locks), shows a receipt, and Undo restores every row', async () => {
    const host = hostOf();
    const tid = await threadId();
    const before = (await ds.getTime({ query: { week: '2026-11-04' } } as never)).entries.filter((e) => e.id === 'ac_wed_hooli' || e.id === 'ac_wed_nce');
    const preview = await host.previewChanges(
      [
        {
          op: 'edit_activities',
          entryIds: ['ac_wed_hooli', 'ac_wed_nce'],
          patch: { oppId: 'opp_acme_af', durationH: 1.5 },
        },
      ],
      tid,
    );
    const p = await host.stageChanges({
      threadId: tid,
      messageId: 'msg_x',
      changes: preview.changes,
      lines: preview.lines,
      entity: preview.entity,
      reason: 'Put these two on the ACME Agentforce opp?',
    });
    const applied = await ds.applyProposal({
      params: { id: p.id },
      body: {},
    } as never);
    const after = (await ds.getTime({ query: { week: '2026-11-04' } } as never)).entries;
    for (const id of ['ac_wed_hooli', 'ac_wed_nce']) {
      const e = after.find((x) => x.id === id)!;
      expect(e).toMatchObject({
        oppId: 'opp_acme_af',
        oppName: 'ACME · Agentforce Service',
        durationH: 1.5,
      });
      expect(e.userLockedFields).toEqual(expect.arrayContaining(['oppId', 'durationH']));
      expect(e.issues.some((i) => /opp/i.test(i))).toBe(false);
    }
    const lines = applied.receipt!.changes.filter((c) => c.entity.type === 'activity_entry');
    expect(lines.map((c) => c.field)).toEqual(expect.arrayContaining(['oppId', 'durationH']));
    await ds.undoAudit({ params: { id: applied.auditId! }, body: {} } as never);
    const undone = (await ds.getTime({ query: { week: '2026-11-04' } } as never)).entries;
    for (const b of before)
      expect(undone.find((x) => x.id === b.id)).toMatchObject({
        oppId: b.oppId,
        durationH: b.durationH,
      });
  });
});

describe('chat_org62_lookup', () => {
  it('builds one SELECT from words: escaped, fixed fields, open only by default', () => {
    expect(soqlLike("O'Brien %_ Health; DROP")).toBe("'%O\\'Brien Health DROP%'");
    expect(() => soqlLike('%')).toThrow(Org62LookupError);
    const q = buildOrg62Query({ find: 'opportunities', account: 'ACME' });
    expect(q).toMatch(/^SELECT Id, Name, AccountId, Account\.Name, StageName/);
    expect(q).toContain("Account.Name LIKE '%ACME%'");
    expect(q).toContain('IsClosed = false');
    expect(q).not.toMatch(/Description|Comments/);
    expect(
      buildOrg62Query({
        find: 'opportunities',
        name: 'renewal',
        openOnly: false,
        limit: 99,
      }),
    ).toMatch(/Name LIKE '%renewal%' ORDER BY CloseDate DESC NULLS LAST LIMIT 25$/);
    expect(buildOrg62Query({ find: 'accounts', name: 'Globex' })).toBe("SELECT Id, Name, Type, Owner.Name FROM Account WHERE Name LIKE '%Globex%' ORDER BY Name LIMIT 10");
    expect(() => buildOrg62Query({ find: 'opportunities' })).toThrow(/account and\/or name/);
  });

  it('parses the soqlQuery output and matches Org62 ids to the app', () => {
    const raw = `Query result:\n${JSON.stringify({ records: [{ Id: '006XX000001AAAAAAA', Name: 'ACME renewal', AccountId: '001XX000001BBBBBBB', Account: { Name: 'ACME' }, StageName: '3 - Validate', CloseDate: '2026-12-15', Amount: 120000, IsClosed: false, IsWon: false, Owner: { Name: 'PERSON_A' } }, { Id: 'not-an-id' }] })}`;
    const rows = parseOrg62Rows(raw, 'opportunities');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org62Id: '006XX000001AAAAAAA',
      account: 'ACME',
      stage: '3 - Validate',
      open: true,
      owner: 'PERSON_A',
    });
    const matched = matchInApp(
      rows,
      [
        {
          id: 'opp_1',
          accountId: 'acc_1',
          org62Url: 'https://org62.example.com/lightning/r/Opportunity/006XX000001AAAA/view',
          isMine: false,
        },
      ],
      [
        {
          id: 'acc_1',
          org62Url: 'https://org62.example.com/lightning/r/Account/001XX000001BBBBBBB/view',
        },
      ],
    );
    // the team and my DC are two facts (D-58): no DC on it says so, never "on the team"
    expect(matched[0]!.inApp).toEqual({
      oppId: 'opp_1',
      onMyTeam: false,
      myDc: null,
      dcWords: 'No DC from you',
      accountId: 'acc_1',
    });
    expect(() => parseOrg62Rows('<html>', 'accounts')).toThrow(Org62LookupError);
  });

  it('in mock mode the tool says it cannot go live and points at the app data', async () => {
    const steps: unknown[] = [];
    const ctx: ChatToolCtx = {
      host: hostOf(),
      input: {
        threadId: 't',
        messageId: 'm',
        userMessageId: 'u',
        text: '',
        context: [],
        model: 'sonnet',
        signal: new AbortController().signal,
      },
      emit: (s) => steps.push(s),
      state: newToolState(),
      signal: new AbortController().signal,
    };
    const r = await callChatTool(ctx, 'chat_org62_lookup', {
      find: 'opportunities',
      account: 'ACME',
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text).notes[0]).toMatch(/not available here \(mock mode\)/);
    const bad = await callChatTool(ctx, 'chat_org62_lookup', {
      find: 'accounts',
    });
    expect(bad).toMatchObject({ ok: false, summary: 'Invalid lookup' });
  });
});

describe('VDP in chat', () => {
  const ctxOf = (): ChatToolCtx => ({ host: hostOf(), input: { threadId: 't', messageId: 'm', userMessageId: 'u', text: '', context: [], model: 'sonnet', signal: new AbortController().signal }, emit: () => undefined, state: newToolState(), signal: new AbortController().signal });

  // D-59: one status per VDP and its open items (who does each, and the item key to stage an app one), uncut
  it('the vdp page lists each VDP with its status and open items (app ones carry their item key), uncut', async () => {
    const r = await callChatTool(ctxOf(), 'chat_app_read', { route: 'vdp' });
    expect(r.ok).toBe(true);
    const j = JSON.parse(r.text) as { note?: string; data: { summary: { needYou: number }; vdps: Array<{ status: string; open?: Array<{ who: string; title: string; itemKey?: string }> }> } };
    expect(j.note).toBeUndefined();
    expect(j.data.vdps.length).toBeGreaterThan(0);
    expect(j.data.vdps.every((v) => typeof v.status === 'string')).toBe(true);
    const items = j.data.vdps.flatMap((v) => v.open ?? []);
    expect(items.some((i) => i.who === 'app' && i.itemKey)).toBe(true);
    expect(items.every((i) => (i.who === 'app' || i.who === 'you') && i.title)).toBe(true);
  });

  it('chat_vdp_update stages one ready Outbox item from an app-fixable gap; nothing reaches VDP', async () => {
    const cov = await ds.getVdpCoverage({} as never);
    const gap = cov.vdps.flatMap((v) => v.gaps).find((g) => g.fix.kind === 'app' && g.code === 'use_case_field')!;
    const fix = gap.fix as Extract<typeof gap.fix, { kind: 'app' }>;
    const emitted: unknown[] = [];
    const ctx = { ...ctxOf(), emit: (s: unknown) => emitted.push(s) } as ChatToolCtx;
    const r = await callChatTool(ctx, 'chat_vdp_update', { vdpSlug: gap.vdpSlug, op: fix.op, field: fix.field, value: 'Service operations lead', useCaseId: gap.useCaseId, gapId: gap.id });
    expect(r.ok).toBe(true);
    const j = JSON.parse(r.text) as { staged: boolean; draftId: string };
    expect(j.staged).toBe(true);
    const d = await ds.getDraft({ params: { id: j.draftId } } as never);
    expect(d).toMatchObject({ status: 'ready', destination: { kind: 'action', action: 'vdp.update_use_case' } });
    expect(emitted.some((e) => (e as { type: string }).type === 'resource')).toBe(true);
  });
});

describe('chat_reauth', () => {
  it('starts a connector sign-in the way Health does, and refuses an unknown name', async () => {
    const ctx: ChatToolCtx = { host: hostOf(), input: { threadId: 't', messageId: 'm', userMessageId: 'u', text: '', context: [], model: 'sonnet', signal: new AbortController().signal }, emit: () => undefined, state: newToolState(), signal: new AbortController().signal };
    const health = await ds.getHealth({} as never);
    const target = health.connectors.find((c) => c.reauth)!;
    const r = await callChatTool(ctx, 'chat_reauth', { connector: target.source });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ connector: target.label });
    expect((await callChatTool(ctx, 'chat_reauth', { connector: 'nope' })).summary).toBe('Unknown connector');
  });
});

describe('chat_log_batch', () => {
  it('in mock mode it says batches need the live database', async () => {
    const ctx: ChatToolCtx = { host: hostOf(), input: { threadId: 't', messageId: 'm', userMessageId: 'u', text: '', context: [], model: 'sonnet', signal: new AbortController().signal }, emit: () => undefined, state: newToolState(), signal: new AbortController().signal };
    const r = await callChatTool(ctx, 'chat_log_batch', {});
    expect(r).toMatchObject({ ok: false, summary: 'Logging batches not available here' });
  });

  it('finds the Solutions Event record type with one read-only query, and only accepts exactly one id', async () => {
    const calls: unknown[] = [];
    const r = await lookupRecordTypeId(async (look) => {
      calls.push(look);
      return { text: JSON.stringify({ records: [{ Id: '012XX0000000RTYAAA', Name: 'Solutions Event' }] }), code: 'ok', message: '', costUsd: 0.0005, inputTokens: 10, outputTokens: 2, model: 'claude-haiku-5-5', started: true };
    });
    expect(r.id).toBe('012XX0000000RTYAAA');
    expect(calls).toEqual([{ connector: 'org62', tool: 'soqlQuery', args: { q: RECORD_TYPE_SOQL } }]);
    expect(RECORD_TYPE_SOQL).toMatch(/^SELECT Id, Name FROM RecordType WHERE SobjectType = 'Event' AND Name = 'Solutions Event'/);
    expect(parseRecordTypeId(JSON.stringify({ records: [{ Id: '012XX0000000RTYAAA' }, { Id: '012XX0000000RTZAAA' }] }))).toBeNull();
    expect(parseRecordTypeId('<html>')).toBeNull();
    expect(parseRecordTypeId(null)).toBeNull();
  });
});

describe('assistant limits', () => {
  it('come from settings.chat, and env still overrides', () => {
    const chat = {
      dailyUsd: 7,
      messageUsd: { sonnet: 0.4, opus: 1 },
      maxSteps: 20,
    };
    expect(chatLimitsFromEnv({} as NodeJS.ProcessEnv, 'sonnet', chat)).toEqual({
      chatDailyUsd: 7,
      perMessageUsd: 0.4,
      maxTurns: 20,
      researchUsd: 0.5,
    });
    expect(chatLimitsFromEnv({} as NodeJS.ProcessEnv, 'opus', chat).perMessageUsd).toBe(1);
    expect(chatLimitsFromEnv({ CC_CHAT_MESSAGE_USD: '0.01' } as unknown as NodeJS.ProcessEnv, 'sonnet', chat).perMessageUsd).toBe(0.01);
    expect(chatLimitsFromEnv({} as NodeJS.ProcessEnv, 'sonnet')).toEqual({
      chatDailyUsd: 3,
      perMessageUsd: 0.25,
      maxTurns: 30, // D-58 list mode
      researchUsd: 0.5,
    });
  });

  it('Settings ▸ Budgets ▸ Assistant saves and the chat budget reads it', async () => {
    const s0 = await ds.getSettings({} as never);
    await ds.patchSettings({
      params: { section: 'chat' },
      body: {
        ifVersion: s0.chat.version,
        value: {
          dailyUsd: 6,
          messageUsd: { sonnet: 0.5, opus: 1.2 },
          maxSteps: 18,
        },
      },
    } as never);
    const b = await ds.be6.backend().budget('sonnet');
    expect(b).toMatchObject({
      chatDailyUsd: 6,
      perMessageUsd: 0.5,
      maxTurns: 18,
    });
  });
});

describe('allow more', () => {
  const send = (text: string, extra?: number) =>
    collect(
      ds.chat({
        body: { text, context: [], ...(extra ? { allowExtraUsd: extra } : {}) },
        signal: new AbortController().signal,
      } as never),
    );

  it('a message stopped at its cost limit offers allow more; re-sent with it, the message finishes', async () => {
    process.env.CC_CHAT_MESSAGE_USD = '0.01';
    useDs(
      mockWith({
        fake: { usage: { input_tokens: 20_000, output_tokens: 2_000 } },
      }),
    );
    const err = of(await send('snooze the Globex VDP update until 14:00'), 'error')[0]!.error;
    expect(err).toMatchObject({
      code: 'budget_exceeded',
      details: { allowMore: { usd: 0.05, scope: 'message' } },
    });
    const again = await send('snooze the Globex VDP update until 14:00', 5);
    expect(of(again, 'error')).toHaveLength(0);
    expect(of(again, 'done')).toHaveLength(1);
  });

  it("past the day's limit it offers allow more for this message, and the approval lets that one message run", async () => {
    process.env.CC_CHAT_DAILY_USD = '0';
    const seen: Seen = { calls: 0 };
    useDs(mockWith({ seen }));
    const err = of(await send('top 3 today'), 'error')[0]!.error;
    expect(err).toMatchObject({
      code: 'budget_exceeded',
      details: { allowMore: { scope: 'day' } },
    });
    expect(seen.calls).toBe(0);
    const again = await send('top 3 today', 0.25);
    expect(of(again, 'done')).toHaveLength(1);
    expect(seen.calls).toBe(1);
  });
});
