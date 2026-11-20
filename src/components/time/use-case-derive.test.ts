/** D-67: Time ▸ Log it ▸ Use cases in Org62: only what you settle on the Org62 side, with its choices. Placeholders only. */
import { describe, expect, it } from 'vitest';

import type { UseCaseSyncItem } from '@/contract';
import { ucRows } from './use-case-derive';

const item = (o: Partial<UseCaseSyncItem>): UseCaseSyncItem => ({ key: 'uc:1', vdpSlug: 'customer-1', vdpUrl: null, companyName: 'CUSTOMER_1', vdpUseCaseId: '1', title: 'Use case', track: 'd360', oppName: 'CUSTOMER_1 – Data 360', org62OpportunityId: null, state: 'in_org62', why: 'why', org62UseCaseId: null, org62Url: null, canvasDraftId: null, updates: [], drift: [], options: [], decided: null, question: null, ...o });

describe('ucRows', () => {
  it('lists deleted, duplicate, Org62-only (before a VDP lists its opp), by-hand drift and left ones; never what VDP or the canvas fixes', () => {
    const rows = ucRows({
      items: [
        item({ key: 'uc:gone', title: 'Gone one', state: 'gone', options: ['readd', 'leave'] }),
        item({ key: 'rec:dup', title: 'Dup', state: 'duplicate' }),
        item({ key: 'rec:o1', title: 'Org62 only, no VDP', state: 'org62_only', vdpSlug: null, options: ['leave'] }),
        item({ key: 'rec:o2', title: 'Org62 only, VDP item', state: 'org62_only', options: ['leave'] }),
        item({ key: 'uc:d1', title: 'By hand', state: 'drift', drift: [{ field: 'Use_Case_Name__c', vdp: 'a', org62: 'b', fix: 'org62_by_hand' }], options: ['leave'] }),
        item({ key: 'uc:d2', title: 'VDP follows', state: 'drift', drift: [{ field: 'Stage__c', vdp: 'Discovery', org62: 'Build', fix: 'vdp' }], options: ['leave'] }),
        item({ key: 'uc:l', title: 'Left', state: 'left', decided: 'leave' }),
        item({ key: 'uc:c', title: 'Create', state: 'create' }),
      ],
    });
    expect(rows.map((r) => r.key)).toEqual(['uc:d1', 'rec:dup', 'uc:gone', 'rec:o1', 'uc:l']);
    expect(rows.find((r) => r.key === 'uc:gone')!.actions.map((a) => [a.label, a.rule])).toEqual([
      ['Add it again', 'use_case_readd'],
      ['Leave it', 'use_case'],
    ]);
    expect(rows.find((r) => r.key === 'uc:l')).toMatchObject({ quiet: true, actions: [{ kind: 'undo', rule: 'use_case' }] });
  });

  it('nothing to show: no rows', () => {
    expect(ucRows({ items: [item({})] })).toEqual([]);
    expect(ucRows(null)).toEqual([]);
  });
});
