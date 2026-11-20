/**
 * D-56 · the feedback scrub: every DB-known account, person and opp (names, emails, Slack ids, Org62 ids, app ids)
 * becomes a stable placeholder, leftovers are stripped, and it runs on the user's input AND on the report (mock
 * DataSource, placeholder seed). Fixtures are placeholders only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routes, Seed } from '../../src/contract';
import { MockDataSource } from '../../src/server/datasource/mock';
import { Scrubber, scrubTermsFrom, type ScrubTerms } from '../../src/server/feedback/scrub';

const TERMS: ScrubTerms = {
  accounts: [
    { id: 'acc-b', names: ['Globex Corporation', 'globex.example'], ids: ['001000000000001AAA'] },
    { id: 'acc-a', names: ['Initech'], ids: [] },
  ],
  people: [
    { id: 'p-1', names: ['Dana Reyes'], ids: ['U0DANA12345'], emails: ['dana.reyes@globex.example'] },
    { id: 'p-2', names: ['Will Okafor'], ids: [], emails: [] },
  ],
  opps: [{ id: 'opp-1', names: ['Globex - Data Cloud Expansion'], ids: ['006000000000002AAA'] }],
};

describe('Scrubber', () => {
  it('replaces every DB-known name, email and id with a stable placeholder', () => {
    const sc = new Scrubber(TERMS);
    const out = sc.scrub('Dana Reyes (dana.reyes@globex.example, <@U0DANA12345>) said Globex Corporation and Initech lost the Globex - Data Cloud Expansion opp 006000000000002AAA on account 001000000000001AAA.');
    expect(out).not.toMatch(/Dana|Reyes|Globex|globex|Initech|U0DANA|0060000|0010000/);
    expect(out).toContain('PERSON_1 (PERSON_1, @PERSON_1) said CUSTOMER_1 and CUSTOMER_2 lost the OPP_1 opp OPP_1 on account CUSTOMER_1.');
    expect(sc.stats.count).toBeGreaterThanOrEqual(8);
  });

  it('numbers by entity (sorted by name), not by appearance: a second scrubber (the edited message) means the same thing', () => {
    const a = new Scrubber(TERMS).scrub('Initech, then Globex');
    const b = new Scrubber(TERMS).scrub('Globex, then Initech');
    expect(a).toBe('CUSTOMER_2, then CUSTOMER_1');
    expect(b).toBe('CUSTOMER_1, then CUSTOMER_2');
  });

  it('matches name parts and corporate suffixes, never product or common words on their own', () => {
    const sc = new Scrubber(TERMS);
    expect(sc.scrub('Reyes pinged; Globex wants it')).toBe('PERSON_1 pinged; CUSTOMER_1 wants it');
    // "Will" is a stop word on its own; the full name still goes
    expect(sc.scrub('It will fail when Will Okafor opens Data Cloud')).toBe('It will fail when PERSON_2 opens Data Cloud');
  });

  it('strips leftover emails, Slack ids, Org62 ids, phones, UUIDs and ids in URLs and routes; masks credentials', () => {
    const sc = new Scrubber(TERMS);
    const out = sc.scrub(
      'mail someone@else.example or call 303-555-0142; <@U0OTHER9876> in C0ABCDEF12; record 0015g00000XyZabAAB; item 3f2a9c1e-7b4d-4c3e-9a1f-0123456789ab; https://x.slack.com/archives/C0ABCDEF12/p1730812345123456?thread_ts=1730812345.123456 token xoxb-1234567890-abcdefghijkl',
    );
    expect(out).not.toMatch(/someone@|303-555|U0OTHER|C0ABCDEF12|0015g00000|3f2a9c1e|1730812345|xoxb-1234/);
    expect(out).toContain('EMAIL');
    expect(out).toContain('PHONE');
    expect(out).toContain('@SLACK_USER');
    expect(out).toContain('https://x.slack.com/archives/ID/ID?thread_ts=ID');
    expect(sc.scrubRoute('/deals/acc-b?item=3f2a9c1e-7b4d-4c3e-9a1f-0123456789ab&tab=log')).toBe('/deals/CUSTOMER_1?item=ID&tab=log');
  });

  it('is idempotent and leaves plain text alone', () => {
    const sc = new Scrubber(TERMS);
    const once = sc.scrub('Dana Reyes at Globex: the Time page shows 0 h on 2026-11-11 at 09:40, version 0.1.0');
    expect(sc.scrub(once)).toBe(once);
    expect(new Scrubber(TERMS).scrub('The Time page shows 0 h on 2026-11-11 at 09:40, version 0.1.0 (sha abc1234)')).toBe('The Time page shows 0 h on 2026-11-11 at 09:40, version 0.1.0 (sha abc1234)');
  });

  it('builds terms from contract collections, Slack ids from handles that are ids', () => {
    const t = scrubTermsFrom({ accounts: [{ id: 'a', name: 'Initech' }], opps: [], people: [{ id: 'p', name: 'Dana Reyes', email: 'd@x.example', slackHandle: 'U0DANA12345' }] });
    expect(t.people[0]).toEqual({ id: 'p', names: ['Dana Reyes'], ids: ['U0DANA12345'], emails: ['d@x.example'] });
  });
});

describe('the scrub runs on input and output (mock DataSource, placeholder seed)', () => {
  const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
  let ds: MockDataSource;
  beforeEach(() => {
    ds = new MockDataSource({ seed: structuredClone(seed), delays: { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 }, autoplay: false, clockMode: 'seed' });
  });
  afterEach(() => ds.dispose());

  /** Every name and email the DB knows (the reporter's first name is allowed on its own line only). */
  const known = () => [...seed.accounts.map((a) => a.name), ...seed.opps.map((o) => o.name), ...seed.people.flatMap((p) => [p.name, ...(p.email ? [p.email] : [])])].filter((n) => n.length >= 4);
  const withoutReporter = (m: string) => m.replace(/\n*_Reported by [^\n]*_\s*$/, '');
  /** Bodies parsed through the route schemas, like the route handler does. */
  const body = <K extends 'diagnoseFeedback' | 'stageFeedback'>(k: K, b: unknown) => ({ body: routes[k].body.parse(b) }) as never;

  it('diagnose: the agent input, the report and the message carry no DB-known name', async () => {
    const acct = seed.accounts[0]!;
    const opp = seed.opps.find((o) => o.accountId === acct.id) ?? seed.opps[0]!;
    const person = seed.people.find((p) => p.email) ?? seed.people[0]!;
    const text = `${person.name} (${person.email ?? 'x'}) says the ${opp.name} row for ${acct.name} shows 0 h but it should show 2 h`;
    const r = await ds.diagnoseFeedback(body('diagnoseFeedback', { kind: 'bug', text, context: { page: 'Time', route: `/deals/${acct.id}`, lookingAt: { kind: 'account', id: acct.id, label: acct.name }, version: '0.1.0', sha: null, persona: 'SE', clientErrors: [`TypeError at ${acct.name}`], viewport: '1440×900' } }));
    const blob = JSON.stringify(r.report) + withoutReporter(r.message);
    for (const n of known()) expect(blob.toLowerCase(), n).not.toContain(n.toLowerCase());
    expect(r.report.context.page).toContain('/deals/CUSTOMER_');
    expect(r.report.summary).toMatch(/PERSON_\d+ \(PERSON_\d+\) says the OPP_\d+ row for CUSTOMER_\d+/);
    expect(r.scrubbed).toBeGreaterThan(4);
    expect(r.diagnosedBy).toBe('fallback');
  });

  it('stage: a name typed into the edited message is scrubbed again; the reporter line is first name only', async () => {
    const s = await ds.getSettings({} as never);
    await ds.patchSettings({ params: { section: 'feedback' }, body: { ifVersion: s.feedback.version, value: { channelId: 'C0FEEDBACK01', channelName: '#cc-feedback' } } } as never);
    const d = await ds.diagnoseFeedback(body('diagnoseFeedback', { kind: 'idea', text: 'Show the week total on Time' }));
    const acct = seed.accounts[1] ?? seed.accounts[0]!;
    const me = (await ds.getFeedback({} as never)).reporter;
    const r = await ds.stageFeedback(body('stageFeedback', { report: { ...d.report, title: `Week total for ${acct.name}` }, message: `${d.message}\nAlso for ${acct.name}.\n\n_Reported by Someone Else Entirely_` }));
    const text = String(r.entity.preview.payload.text);
    for (const n of known()) expect(withoutReporter(text).toLowerCase(), n).not.toContain(n.toLowerCase());
    expect(text).toMatch(/Also for CUSTOMER_\d+\./);
    expect(text.endsWith(`_Reported by ${me}_`)).toBe(true);
    expect(me).not.toContain(' ');
    expect(r.entity.draft.destination.kind === 'action' && JSON.stringify(r.entity.draft.destination.input)).not.toContain(acct.name);
  });
});
