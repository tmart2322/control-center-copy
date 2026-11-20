/**
 * Placeholder Specialist Forecasts for the mock DataSource (CC_DATA=mock never calls Org62). Generated from the seed's
 * own placeholder accounts and opportunities at run time, not added to the seed, so the queue, the Deal Role audit
 * and missing-record detection run on the same rules as the db path. Dates are relative to the mock clock, so the
 * same story shows with a seed clock or a real one:
 *
 *   1st in-quarter Data 360 opp   notes 13 days old → overdue; Deal Role Lead
 *   2nd                           notes 6 days old → due by the next deadline; Deal Role Lead
 *   3rd                           notes from yesterday → fresh; Deal Role None → a fix
 *   4th (Flex, my 50% half)       no notes change on record → due; Deal Role None → a fix
 *   every further one             no record → "no Specialist Forecast" (a handoff)
 *   a next-quarter opp            under the notes minimum → not required
 *
 * Ids are fixed fake uuids and Org62 ids (`aDdXXMOCK…`, distinct in their first 15 characters); links point at a
 * `.test` host.
 */
import type { Account, Opportunity, SpecialistForecast } from '@/contract';
import { EMPTY_FORECAST_PENDING } from '@/contract';
import { classifyLineItems } from '@/engines/deals/classify';
import { quarterPair, sfrQuarterBounds, sfrQuarterOfDay } from '@/engines/forecast';

export const MOCK_ORG62_HOST = 'https://org62.example.test';
export const MOCK_OWNER_ORG62_ID = '005XX0000000MOCKAA';
const DAY = 86_400_000;

export const mockSfrUuid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
/** 18-character fake ids whose first 15 differ (Org62 ids compare on their first 15). */
export const mockSfrOrg62Id = (n: number) => `aDdXXMOCK0000${String(n).padStart(2, '0')}AAA`;
const mockOppOrg62Id = (n: number) => `006XXMOCK0000${String(n).padStart(2, '0')}AAA`;

const NOTES = [
  'Compelling event: phase 2 go-live before the fiscal year ends · In quarter: yes, pricing agreed · Next step (core AE, Fri): order form to procurement · Risk: legal review of the data terms',
  'Compelling event: renewal of the existing data contract · In quarter: yes, in negotiation · Next step (SE, Tue): revised SOW pricing · Risk: budget owner on leave',
  'Compelling event: patient 360 launch in Q1 · In quarter: yes, technical win · Next step (me, Thu): exec sponsor call · Risk: none new',
];
const MGR = [
  'Core AE: customer confirmed budget; paper process started. Keep in Commit.',
  'RVP: needs a signed mutual plan before it moves to Commit.',
  'Core AE: technical validation closed; pricing next week.',
];

/**
 * The record an AE creates from an opp's Forecast tab, as the mock's "I created it, check now" finds it: no notes
 * yet, Deal Role None, the opp's amount and close date (so it joins the notes queue and the Deal Role fixes).
 */
export function mockCreatedForecast(n: number, o: Opportunity, accountName: string | null, nowMs: number): SpecialistForecast {
  const iso = new Date(nowMs).toISOString();
  return {
    id: mockSfrUuid(n),
    org62Id: mockSfrOrg62Id(n),
    name: `SF-${String(1000 + n)}`,
    url: `${MOCK_ORG62_HOST}/lightning/r/SpecialistForecast__c/${mockSfrOrg62Id(n)}/view`,
    org62OpportunityId: mockOppOrg62Id(n),
    opportunityId: o.id,
    accountId: o.accountId,
    opportunityName: o.name,
    accountName,
    oppStage: o.stage,
    oppNextStep: o.nextStep,
    oppCloseDate: o.closeDate,
    notes: null,
    prevNotes: null,
    mgrNotes: null,
    dealRole: 'None',
    judgement: null,
    forecastStatus: 'Pipeline',
    amount: o.amount,
    stage: '02 - Determining Problem, Impact, Ideal',
    closeDate: o.closeDate,
    fiscalQuarter: o.closeDate ? sfrQuarterOfDay(o.closeDate) : null,
    ownerOrg62Id: MOCK_OWNER_ORG62_ID,
    lastModifiedAt: iso,
    notesUpdatedAt: null,
    syncedAt: iso,
    goneAt: null,
    pending: EMPTY_FORECAST_PENDING,
  };
}

export function mockSpecialistForecasts(accounts: readonly Account[], opps: readonly Opportunity[], nowMs: number, tz: string): SpecialistForecast[] {
  const q = quarterPair(nowMs, tz);
  const cur = sfrQuarterBounds(q.current)!;
  const nxt = sfrQuarterBounds(q.next)!;
  const acc = new Map(accounts.map((a) => [a.id, a] as const));
  const d360 = (o: Opportunity) => classifyLineItems(o, o.products.map((p) => ({ oppId: o.id, productName: p, totalPrice: 0 }))).signal !== 'none';
  const inQ = opps.filter((o) => o.isOpen && o.isMine && o.closeDate && o.closeDate >= cur.start && o.closeDate <= cur.end && d360(o)).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.id.localeCompare(b.id));
  const nextQ = opps.filter((o) => o.isOpen && o.closeDate && o.closeDate >= nxt.start && o.closeDate <= nxt.end && d360(o)).sort((a, b) => a.id.localeCompare(b.id));
  const iso = (ms: number) => new Date(ms).toISOString();
  const syncedAt = iso(nowMs - 2 * 3_600_000);
  const out: SpecialistForecast[] = [];
  const make = (n: number, o: Opportunity, x: Partial<SpecialistForecast>): SpecialistForecast => ({
    id: mockSfrUuid(n),
    org62Id: mockSfrOrg62Id(n),
    name: `SF-${String(1000 + n)}`,
    url: `${MOCK_ORG62_HOST}/lightning/r/SpecialistForecast__c/${mockSfrOrg62Id(n)}/view`,
    org62OpportunityId: mockOppOrg62Id(n),
    opportunityId: o.id,
    accountId: o.accountId,
    opportunityName: o.name,
    accountName: acc.get(o.accountId)?.name ?? null,
    oppStage: o.stage,
    oppNextStep: o.nextStep,
    oppCloseDate: o.closeDate,
    notes: null,
    prevNotes: null,
    mgrNotes: null,
    dealRole: 'Lead',
    judgement: 'IN',
    forecastStatus: 'Pipeline',
    amount: o.amount,
    stage: '03 - Validating Benefits & Value',
    closeDate: o.closeDate,
    fiscalQuarter: o.closeDate ? sfrQuarterOfDay(o.closeDate) : null,
    ownerOrg62Id: MOCK_OWNER_ORG62_ID,
    lastModifiedAt: iso(nowMs - 3 * DAY),
    notesUpdatedAt: null,
    syncedAt,
    goneAt: null,
    pending: EMPTY_FORECAST_PENDING,
    ...x,
  });
  const [a, b, c, d] = inQ;
  if (a) out.push(make(1, a, { notes: NOTES[0]!, prevNotes: 'Compelling event: phase 2 go-live · In quarter: yes, awaiting pricing · Next step: pricing review · Risk: timeline', mgrNotes: MGR[0]!, forecastStatus: 'Commit', stage: '05 - Negotiating $$ & Mutual Plan', notesUpdatedAt: iso(nowMs - 13 * DAY) }));
  if (b) out.push(make(2, b, { notes: NOTES[1]!, mgrNotes: MGR[1]!, forecastStatus: 'Best Case', stage: '04 - Confirming Value With Power', judgement: 'UP+', notesUpdatedAt: iso(nowMs - 6 * DAY) }));
  if (c) out.push(make(3, c, { notes: NOTES[2]!, mgrNotes: MGR[2]!, dealRole: 'None', notesUpdatedAt: iso(nowMs - 1 * DAY) }));
  // Flex splits 50/50 into two records: this is my half
  if (d) out.push(make(4, d, { name: `SF-1004 (Flex 50%)`, amount: d.amount === null ? null : Math.round(d.amount / 2), dealRole: null, forecastStatus: 'Pipeline', stage: '02 - Determining Problem, Impact, Ideal' }));
  const n = nextQ[0];
  if (n) out.push(make(5, n, { amount: Math.min(n.amount ?? 0, 90_000), notes: 'Compelling event: data add-on with the renewal · In quarter: no, next quarter', forecastStatus: 'Pipeline', stage: '01 - Identifying an Opportunity', notesUpdatedAt: iso(nowMs - 20 * DAY) }));
  return out;
}
