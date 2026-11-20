/**
 * D-63: the VDP's specialist AE from the opp's Org62 Specialist Forecast (pure parts): the fixed read-only SOQL (only
 * ids, at most 200, only the four VDP forecast types), the parser (owners by opp, other types dropped), the cache
 * (a read replaces only the opps it asked about), and the local-opp view the gap engine reads. Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import { aeBatches, aeCacheOf, aesByLocalOpp, aeTargets, EMPTY_AE_CACHE, nextAeCache, parseSpecialistAes, SpecialistAeSoqlError, specialistAesSoql } from '../../src/server/vdp/specialist-aes';

const ID = (n: number) => `006XX${String(n).padStart(10, '0')}AAA`;

describe('the SOQL', () => {
  it('a fixed SELECT on SpecialistForecast__c, the opps by id, the four VDP types only', () => {
    expect(specialistAesSoql([ID(1), ID(2)])).toBe(
      `SELECT Opportunity__c, ForecastType__c, OwnerId, Owner.Name, Owner.Email FROM SpecialistForecast__c WHERE Opportunity__c IN ('${ID(1)}', '${ID(2)}') AND ForecastType__c IN ('Data Cloud', 'BtL Data Cloud', 'Agentforce', 'BtL Agentforce') ORDER BY Opportunity__c LIMIT 2000`,
    );
  });

  it('refuses anything but Org62 opportunity ids, and more than 200 per query', () => {
    expect(() => specialistAesSoql(["006XX0000000001AAA' OR Id != '"])).toThrow(SpecialistAeSoqlError);
    expect(() => specialistAesSoql(['001XX0000000001AAA'])).toThrow(SpecialistAeSoqlError);
    expect(() => specialistAesSoql([])).toThrow(SpecialistAeSoqlError);
    expect(() => specialistAesSoql(Array.from({ length: 201 }, (_, i) => ID(i)))).toThrow(SpecialistAeSoqlError);
  });

  it('batches of at most 200, 15-character forms deduplicated, non-ids dropped', () => {
    const ids = [...Array.from({ length: 450 }, (_, i) => ID(i)), ID(3).slice(0, 15), 'cc:placeholder'];
    const b = aeBatches(ids);
    expect(b.map((x) => x.length)).toEqual([200, 200, 50]);
  });

  it('the targets: my open opps where my DC is 100%, by Org62 id', () => {
    expect(aeTargets([{ org62OpportunityId: ID(1), isOpen: true, dcSplit: 100 }, { org62OpportunityId: ID(2), isOpen: true, dcSplit: 50 }, { org62OpportunityId: ID(3), isOpen: false, dcSplit: 100 }, { org62OpportunityId: null, isOpen: true, dcSplit: 100 }])).toEqual([ID(1)]);
  });
});

describe('the parser and the cache', () => {
  const answer = JSON.stringify({
    totalSize: 4,
    done: true,
    records: [
      { Opportunity__c: ID(1), ForecastType__c: 'BtL Agentforce', OwnerId: '005XX0000000001AAA', Owner: { Name: 'AF Placeholder', Email: 'AF.Placeholder@example.com' } },
      { Opportunity__c: ID(1), ForecastType__c: 'Data Cloud', OwnerId: '005XX0000000002AAA', Owner: { Name: 'DC Placeholder', Email: 'dc.placeholder@example.com' } },
      { Opportunity__c: ID(2), ForecastType__c: 'Service Cloud', OwnerId: '005XX0000000003AAA', Owner: { Name: 'Svc', Email: 'svc@example.com' } },
      { Opportunity__c: ID(2), ForecastType__c: 'Data Cloud', OwnerId: '005XX0000000004AAA', Owner: { Name: 'No email' } },
    ],
  });

  it('owners per opp (15 characters), emails lowercased; other types and rows with no email dropped', () => {
    const m = parseSpecialistAes(`Here is the result:\n${answer}`);
    expect([...m.keys()]).toEqual([ID(1).slice(0, 15)]);
    expect(m.get(ID(1).slice(0, 15))).toEqual([
      { email: 'af.placeholder@example.com', name: 'AF Placeholder', type: 'BtL Agentforce' },
      { email: 'dc.placeholder@example.com', name: 'DC Placeholder', type: 'Data Cloud' },
    ]);
    expect(() => parseSpecialistAes('no json here')).toThrow(/could not read/);
  });

  it('a read replaces only the opps it asked about; one read with no record is "none", not "not read"', () => {
    const a = nextAeCache(EMPTY_AE_CACHE, [ID(1), ID(2)], parseSpecialistAes(answer), '2026-11-12T07:00:00.000Z');
    expect(Object.keys(a.byOpp)).toEqual([ID(1).slice(0, 15)]);
    expect(a.read.sort()).toEqual([ID(1).slice(0, 15), ID(2).slice(0, 15)].sort());
    const b = nextAeCache(a, [ID(2)], new Map([[ID(2).slice(0, 15), [{ email: 'new@example.com', name: null, type: 'Agentforce' }]]]), '2026-11-12T08:00:00.000Z');
    expect(Object.keys(b.byOpp).sort()).toEqual([ID(1).slice(0, 15), ID(2).slice(0, 15)].sort());
    expect(aeCacheOf(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(aeCacheOf(null)).toEqual(EMPTY_AE_CACHE);
    // the gap engine's view, by local opp id through each opp's Org62 id
    expect(aesByLocalOpp(b, [{ id: 'o1', org62OpportunityId: ID(1) }, { id: 'o9', org62OpportunityId: null }]).get('o1')!.map((x) => x.email)).toEqual(['af.placeholder@example.com', 'dc.placeholder@example.com']);
  });
});
