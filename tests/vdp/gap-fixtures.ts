/** Shared placeholder fixtures for the VDP engine tests (gaps, items, status). Placeholders only. */
import type { GapAccount, GapOpp } from '../../src/engines/vdp/gaps';
import type { VdpSnapshot, VdpUseCase } from '../../src/lib/vdp/types';

/** FY27 Q4. */
export const NOW = '2026-11-10T17:00:00.000Z';

export const uc = (id: string, o: Partial<VdpUseCase> = {}): VdpUseCase => ({
  id,
  track: 'd360',
  displayOrder: 0,
  title: 'Use case',
  priority: '3 - High',
  division: 'Sales',
  persona: 'Data team',
  detailsInput: 'Details',
  executionPhase: 'Build',
  executionStartDate: null,
  executionTargetDate: '2027-01-15',
  executionDurationValue: null,
  executionDurationUnit: null,
  hasAi: true,
  generatedFields: {},
  painThemeId: null,
  sourceLibraryId: null,
  createdAt: null,
  updatedAt: null,
  detailLoaded: true,
  ...o,
});

export const vdp = (o: Partial<VdpSnapshot> = {}): VdpSnapshot => ({
  id: 'v1',
  slug: 'acme',
  url: 'https://vdp.example.test/vdp/acme',
  company: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Acme Placeholder', slug: 'acme', industry: null, segment: null },
  fiscalYear: 27,
  fiscalQuarter: 4,
  salesforceAccountId: '001AAAAAAAAAAAA',
  salesforceOpportunityId: '006AAAAAAAAAAAAXYZ',
  isSeed: false,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
  lastActivityAt: '2026-11-05T00:00:00.000Z',
  aes: [{ email: 'ae@example.com', name: 'AE', placeholder: false }],
  tas: [{ email: 'me@example.com', name: 'Me', placeholder: false }],
  createdBy: null,
  collaborators: [],
  useCases: [uc('u1')],
  stakeholders: [],
  assets: [{ id: 'a1', title: 'Deck', url: 'https://docs.example.com/d/1', type: 'Deck', description: null }],
  dcNoteCached: true,
  executiveSummary: null,
  ...o,
});

export const accounts: GapAccount[] = [
  { id: 'A1', name: 'Acme Placeholder, Inc.', org62AccountId: '001AAAAAAAAAAAAQQQ' },
  { id: 'A2', name: 'Globex Placeholder', org62AccountId: '001BBBBBBBBBBBB' },
  { id: 'A3', name: 'Quiet Placeholder', org62AccountId: '001CCCCCCCCCCCC' },
];
export const opp = (o: Partial<GapOpp> & Pick<GapOpp, 'id'>): GapOpp => ({ accountId: 'A1', name: `Opp ${o.id}`, org62OpportunityId: null, isOpen: true, dcSplit: 100, closeDate: '2026-12-15', owner: { name: 'Owner Placeholder', email: 'owner@example.com' }, ...o });
export const opps: GapOpp[] = [
  opp({ id: 'O1', org62OpportunityId: '006AAAAAAAAAAAA' }), // the 15-char form of the VDP's 18-char id
  opp({ id: 'O2', accountId: 'A2', org62OpportunityId: '006BBBBBBBBBBBB' }),
  opp({ id: 'O3', accountId: 'A3', dcSplit: null, org62OpportunityId: '006CCCCCCCCCCCC' }),
];
