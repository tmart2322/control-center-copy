/**
 * 2026-11-16 (owner: "make it clear that they're not in VDP and what the action is"; "I add them myself in VDP"): a
 * refused AE / TA list names who VDP doesn't know yet and the one action. VDP refused 9 owner items as "Delivery failed
 * for an unknown reason": each added an AE VDP had never shown. Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import type { Draft, VdpPushRun } from '../../src/contract';
import { explainOwnerRefusals, ownersCallOf, ownersRefusal, vdpPeople } from '../../src/engines/vdp/owners';
import { vdpCoverageAndQueue } from '../../src/server/vdp/coverage';

const P = (email: string, name: string) => ({ email, name, placeholder: false });
const vdp = (o: Partial<{ aes: ReturnType<typeof P>[]; tas: ReturnType<typeof P>[]; collaborators: ReturnType<typeof P>[] }>) => ({ aes: [], tas: [], collaborators: [], createdBy: null, ...o });

const people = vdpPeople({
  vdps: [vdp({ aes: [P('dc.ae@example.com', 'DC AE')], tas: [P('me@example.com', 'Me')], collaborators: [P('collab@example.com', 'Collab Placeholder')] })],
  applied: [{ field: 'account_executives', emails: ['took.ae@example.com'] }],
  names: [['af.ae@example.com', 'AF AE Placeholder'], ['af2.ae@example.com', 'AF Two Placeholder']],
});

describe('ownersRefusal', () => {
  it('someone VDP has never shown: "Not in VDP yet: <name>. Add them in VDP with a sales role, then push again."', () => {
    expect(ownersRefusal({ field: 'account_executives', emails: ['dc.ae@example.com', 'AF.AE@example.com'] }, people)).toBe('VDP refused the AE list. Not in VDP yet: AF AE Placeholder. Add them in VDP with a sales role, then push again.');
    expect(ownersRefusal({ field: 'account_executives', emails: ['af.ae@example.com', 'af2.ae@example.com', 'x@example.com'] }, people)).toBe('VDP refused the AE list. Not in VDP yet: AF AE Placeholder, AF Two Placeholder and x@example.com. Add each of them in VDP with a sales role, then push again.');
  });

  it('someone in VDP without the role: give them one; a TA needs a technical role', () => {
    expect(ownersRefusal({ field: 'account_executives', emails: ['collab@example.com'] }, people)).toBe('VDP refused the AE list. In VDP without a sales role: Collab Placeholder. Give them one in VDP, then push again.');
    expect(ownersRefusal({ field: 'technical_architects', emails: ['af.ae@example.com'] }, people)).toBe('VDP refused the TA list. Not in VDP yet: AF AE Placeholder. Add them in VDP with a technical role, then push again.');
  });

  it('everyone known (listed somewhere, or taken by a call that landed), or already on the list: says nothing', () => {
    expect(ownersRefusal({ field: 'account_executives', emails: ['dc.ae@example.com', 'took.ae@example.com'] }, people)).toBeNull();
    expect(ownersRefusal({ field: 'account_executives', emails: ['listed@example.com', 'dc.ae@example.com'], before: ['listed@example.com'] }, people)).toBeNull();
  });
});

const run = (detail: string, op = 'set_vdp_owners', state: 'failed' | 'applied' = 'failed'): VdpPushRun =>
  ({ id: 'push_1', at: '2026-11-16T16:38:00.000Z', dryRun: false, state: 'done', finishedAt: '2026-11-16T16:55:00.000Z', nodes: [{ key: 'acme:owners:ae', title: 'AE: DC AE, AF AE Placeholder', companyName: 'ACME Corp', op, requires: [], draftId: '00000000-0000-4000-8000-000000000001', state, detail, externalId: null, slug: null, at: null }] }) as VdpPushRun;
const GENERIC = 'Delivery failed for an unknown reason (unknown). Nothing was sent; retry from the Outbox';
const call = () => ({ field: 'account_executives' as const, emails: ['dc.ae@example.com', 'af.ae@example.com'] });

describe('explainOwnerRefusals', () => {
  it('a failed owners item with the generic detail reads why and what to do', () => {
    expect(explainOwnerRefusals([run(GENERIC)], call, people)[0]!.nodes[0]!.detail).toBe('VDP refused the AE list. Not in VDP yet: AF AE Placeholder. Add them in VDP with a sales role, then push again.');
  });

  it('another failure keeps its own words (sign-in, rate limit), and so does any other item', () => {
    const auth = 'Not signed in to the destination: re-auth, then retry (auth). Nothing was sent';
    expect(explainOwnerRefusals([run(auth)], call, people)[0]!.nodes[0]!.detail).toBe(auth);
    expect(explainOwnerRefusals([run(GENERIC, 'update_use_case')], call, people)[0]!.nodes[0]!.detail).toBe(GENERIC);
    expect(explainOwnerRefusals([run(GENERIC)], () => null, people)[0]!.nodes[0]!.detail).toBe(GENERIC);
  });
});

describe('the coverage payload', () => {
  it('Push runs and the item read the explained detail (a run recorded before this change too)', () => {
    const draft = { id: '00000000-0000-4000-8000-000000000001', status: 'failed', destination: { kind: 'action', action: 'vdp.set_vdp_owners', target: { label: 'ACME', url: null }, input: { field: 'account_executives', value: ['dc.ae@example.com', 'af.ae@example.com'], before: [], changes: [{ field: 'account_executives', value: ['dc.ae@example.com', 'af.ae@example.com'], before: [] }] } }, attempts: [] } as unknown as Draft;
    expect(ownersCallOf(draft)).toEqual({ field: 'account_executives', emails: ['dc.ae@example.com', 'af.ae@example.com'], before: [] });
    const aesByOpp = new Map([['o1', [{ email: 'af.ae@example.com', name: 'AF AE Placeholder', type: 'Agentforce' }]]]);
    const { coverage } = vdpCoverageAndQueue({ records: [], accounts: [], opps: [], me: { name: 'Me', email: 'me@example.com' }, now: '2026-11-16T18:00:00.000Z', drafts: [draft], pushes: [run(GENERIC)], aesByOpp });
    expect(coverage.pushes[0]!.nodes[0]!.detail).toBe('VDP refused the AE list. Not in VDP yet: dc.ae@example.com and AF AE Placeholder. Add each of them in VDP with a sales role, then push again.');
    expect(coverage.push?.nodes[0]!.detail).toBe(coverage.pushes[0]!.nodes[0]!.detail);
  });
});
