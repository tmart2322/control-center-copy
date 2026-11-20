/** Accounts and opportunities for domain 01 (all invented). Amounts in USD, dates are day offsets from 2026-11-18. */
export type AccountDef = {
  key: string; name: string; industry: string; family: string | null; parent: string | null; size: string;
  book: boolean; watched: boolean; story: string; short: string[]; domains: string[]; ae: 'ae-harbor' | 'ae-commercial';
};
export const ACCOUNTS: AccountDef[] = [
  { key: 'saltmere', name: 'Saltmere Health Plan', industry: 'Healthcare - Payer', family: null, parent: null, size: '4,200 employees, 1.8M members', book: true, watched: false, ae: 'ae-harbor', short: ['Saltmere', 'HHP'], domains: ['saltmere-health.example'], story: 'Storyline 1: hot Data 360 + Agentforce POC for member services; blueprint due Fri; VDP exists but is missing items.' },
  { key: 'yarrowdale', name: 'Yarrowdale Health System', industry: 'Healthcare - Provider', family: 'yarrowdale', parent: null, size: '19,000 employees, 11 hospitals', book: true, watched: false, ae: 'ae-harbor', short: ['Yarrowdale', 'AHS'], domains: ['yarrowdale-health.example'], story: 'Storyline 4: family parent. Enterprise data foundation deal plus a platform renewal.' },
  { key: 'yarrowdale-mg', name: 'Yarrowdale Medical Group', industry: 'Healthcare - Provider', family: 'yarrowdale', parent: 'yarrowdale', size: '3,100 employees, 140 clinics', book: true, watched: false, ae: 'ae-harbor', short: ['Yarrowdale Medical', 'AMG'], domains: ['yarrowdale-medical.example'], story: 'Storyline 4: subsidiary; patient engagement agent; recent loss on referrals.' },
  { key: 'yarrowdale-bh', name: 'Yarrowdale Behavioral Health', industry: 'Healthcare - Provider', family: 'yarrowdale', parent: 'yarrowdale', size: '900 employees', book: true, watched: false, ae: 'ae-harbor', short: ['Yarrowdale Behavioral', 'ABH'], domains: ['yarrowdale-behavioral.example'], story: 'Storyline 4: subsidiary; early intake-triage idea; VDP company identity is ambiguous (parent vs this entity).' },
  { key: 'elderglen', name: 'Elderglen Retail Group', industry: 'Retail', family: 'elderglen', parent: null, size: '22,000 employees, 600 stores', book: true, watched: false, ae: 'ae-commercial', short: ['Elderglen', 'TRG'], domains: ['elderglengroup.example'], story: 'Storyline 4: second family parent; identity-resolution discovery.' },
  { key: 'elderglen-outdoors', name: 'Elderglen Outdoors', industry: 'Retail', family: 'elderglen', parent: 'elderglen', size: '5,500 employees', book: true, watched: false, ae: 'ae-commercial', short: ['Elderglen Outdoors', 'TOD'], domains: ['elderglen-outdoors.example'], story: 'Storyline 2: renewal + Agentforce expansion; AE asks the SE for a demo in Slack; reply draft waits unapproved.' },
  { key: 'elderglen-home', name: 'Elderglen Home & Living', industry: 'Retail', family: 'elderglen', parent: 'elderglen', size: '2,400 employees', book: true, watched: false, ae: 'ae-commercial', short: ['Elderglen Home', 'THL'], domains: ['elderglen-home.example'], story: 'Storyline 4: subsidiary; personalization engine technical validation.' },
  { key: 'halvergate', name: 'Halvergate Freight Lines', industry: 'Transportation & Logistics', family: null, parent: null, size: '7,800 employees', book: true, watched: false, ae: 'ae-commercial', short: ['Halvergate', 'NFL'], domains: ['halvergatefreight.example'], story: 'Storyline 3: gone quiet; overdue next steps, close date passed, at-risk signal.' },
  { key: 'ferrowpay', name: 'Ferrowpay Financial', industry: 'Financial Services', family: null, parent: null, size: '2,900 employees', book: true, watched: false, ae: 'ae-harbor', short: ['Ferrowpay'], domains: ['ferrowpay.example'], story: 'Steady fintech pursuit: fraud agent + Data 360 foundation; good Org62 time-logging material.' },
  { key: 'harrowgate', name: 'Harrowgate Manufacturing', industry: 'Manufacturing', family: null, parent: null, size: '12,500 employees, 38 plants', book: true, watched: false, ae: 'ae-commercial', short: ['Harrowgate', 'HGM'], domains: ['harrowgate-mfg.example'], story: 'Storyline 5: owner demoed the maintenance agent but is NOT on the opp team (missed opportunity).' },
  { key: 'cascadia', name: 'Cascadia County Services', industry: 'Public Sector', family: null, parent: null, size: '3,300 employees', book: true, watched: false, ae: 'ae-commercial', short: ['Cascadia County', 'CCS'], domains: ['cascadiacounty.example'], story: 'Storyline 6: customer onsite workshop Mon-Tue 2026-11-23/24 with travel; mandatory training due.' },
  { key: 'oakhallow', name: 'Oakhallow Mutual Insurance', industry: 'Insurance', family: null, parent: null, size: '6,100 employees', book: true, watched: false, ae: 'ae-harbor', short: ['Oakhallow', 'PMI'], domains: ['oakhallowmutual.example'], story: 'Claims triage agent in negotiation; recent Agentforce pilot win (storyline 7 logging material).' },
  { key: 'voltmere', name: 'Voltmere Utilities', industry: 'Energy & Utilities', family: null, parent: null, size: '8,900 employees', book: false, watched: true, ae: 'ae-commercial', short: ['Voltmere'], domains: ['voltmere.example'], story: 'Storyline 14: watched account (not my book); weekly brief highlights.' },
  { key: 'contoso', name: 'Contoso Marketplace', industry: 'Retail', family: null, parent: null, size: '1,700 employees', book: false, watched: true, ae: 'ae-commercial', short: ['Contoso'], domains: ['contoso-market.example'], story: 'Storyline 14/18: watched account; noisy channel traffic, relevance learning.' },
];

export type OppDef = {
  key: string; acct: string; name: string; stage: string; amount: number; close: number; type: 'New Business' | 'Upsell' | 'Renewal';
  fc: 'Pipeline' | 'Best Case' | 'Commit' | 'Closed' | 'Omitted'; mine: boolean; lastAct: number | null; watched?: boolean; story?: string;
  seRole?: 'Solutions Engineer' | 'Solution Engineer'; extra?: string[]; // extra team members: person keys
};
const O = (key: string, acct: string, name: string, stage: string, amount: number, close: number, type: OppDef['type'], fc: OppDef['fc'], mine: boolean, lastAct: number | null, more: Partial<OppDef> = {}): OppDef =>
  ({ key, acct, name, stage, amount, close, type, fc, mine, lastAct, ...more });

export const OPPS: OppDef[] = [
  // ---- open (25) ----
  O('saltmere-data360-poc', 'saltmere', 'Saltmere Health Plan - Data 360 + Agentforce Member Services POC', 'Technical Validation', 1_250_000, 24, 'New Business', 'Best Case', true, -1, { extra: ['spec-gustavo', 'ptr-ravindra'], story: 'Storyline 1 anchor. Blueprint due Fri 2026-11-20. Weekly sync Tue/Thu. VDP exists, missing assets/owners.' }),
  O('saltmere-claims-copilot', 'saltmere', 'Saltmere Health Plan - Claims Intake Copilot Phase 2', 'Discovery', 640_000, 95, 'Upsell', 'Pipeline', false, -9),
  O('saltmere-provider-directory', 'saltmere', 'Saltmere Health Plan - Provider Directory Data Quality', 'Qualification', 95_000, 60, 'New Business', 'Pipeline', false, -14),
  O('yarrowdale-enterprise-data', 'yarrowdale', 'Yarrowdale Health System - Enterprise Data Foundation', 'Proposal', 1_850_000, 40, 'New Business', 'Best Case', true, -3, { extra: ['spec-gustavo'], story: 'Storyline 4 anchor: account-family judgment for VDP; team meets weekly.' }),
  O('yarrowdale-platform-renewal', 'yarrowdale', 'Yarrowdale Health System - Service Platform Renewal FY27', 'Proposal', 410_000, 46, 'Renewal', 'Commit', false, -5, { story: 'Renewal; SE not on team.' }),
  O('yarrowdale-mg-patient-engagement', 'yarrowdale-mg', 'Yarrowdale Medical Group - Patient Engagement Agent', 'Solution Design', 420_000, 55, 'New Business', 'Pipeline', true, -4, { seRole: 'Solution Engineer' }),
  O('yarrowdale-bh-intake', 'yarrowdale-bh', 'Yarrowdale Behavioral Health - Intake Triage Assistant', 'Qualification', 180_000, 100, 'New Business', 'Pipeline', false, -20),
  O('elderglen-outdoors-renewal-expansion', 'elderglen-outdoors', 'Elderglen Outdoors - Data 360 Renewal + Agentforce Expansion', 'Negotiation', 780_000, 12, 'Renewal', 'Commit', true, -1, { story: 'Storyline 2 anchor: demo request in Slack; reply draft in the Outbox.' }),
  O('elderglen-outdoors-loyalty', 'elderglen-outdoors', 'Elderglen Outdoors - Loyalty Insights Pilot', 'Discovery', 125_000, 80, 'New Business', 'Pipeline', false, -11),
  O('elderglen-home-personalization', 'elderglen-home', 'Elderglen Home & Living - Personalization Engine', 'Technical Validation', 360_000, 35, 'New Business', 'Best Case', true, -2),
  O('elderglen-enterprise-identity', 'elderglen', 'Elderglen Retail Group - Enterprise Identity Resolution', 'Discovery', 950_000, 120, 'New Business', 'Pipeline', false, -17),
  O('halvergate-route-exceptions-agent', 'halvergate', 'Halvergate Freight Lines - Route Exceptions Agent', 'Proposal', 520_000, -6, 'New Business', 'Best Case', true, -24, { story: 'Storyline 3 anchor: close date passed, no activity 24 days, next steps overdue, nudge draft expired.' }),
  O('halvergate-dispatch-data', 'halvergate', 'Halvergate Freight Lines - Dispatch Data Unification', 'Qualification', 210_000, 70, 'New Business', 'Pipeline', false, -30),
  O('ferrowpay-fraud-agent', 'ferrowpay', 'Ferrowpay Financial - Fraud Investigation Agent', 'Solution Design', 890_000, 62, 'New Business', 'Best Case', true, -2),
  O('ferrowpay-data360-foundation', 'ferrowpay', 'Ferrowpay Financial - Data 360 Foundation', 'Proposal', 1_100_000, 28, 'New Business', 'Commit', true, -1, { seRole: 'Solution Engineer' }),
  O('harrowgate-maintenance-agent', 'harrowgate', 'Harrowgate Manufacturing - Predictive Maintenance Agent', 'Technical Validation', 730_000, 33, 'New Business', 'Best Case', false, -3, { extra: ['se-tariq'], story: 'Storyline 5 anchor: owner demoed it twice but is not on the team -> missed-opp finding, DC request on a logging canvas.' }),
  O('harrowgate-plant-data', 'harrowgate', 'Harrowgate Manufacturing - Plant Data Lakehouse Integration', 'Discovery', 310_000, 88, 'New Business', 'Pipeline', false, -18),
  O('cascadia-citizen-assistant', 'cascadia', 'Cascadia County Services - Citizen Services Assistant', 'Solution Design', 460_000, 50, 'New Business', 'Pipeline', true, -2, { story: 'Storyline 6 anchor: onsite workshop 2026-11-23/24.' }),
  O('cascadia-permits-data', 'cascadia', 'Cascadia County Services - Permits Data Modernization', 'Qualification', 150_000, 110, 'New Business', 'Pipeline', false, -26),
  O('oakhallow-claims-agent', 'oakhallow', 'Oakhallow Mutual Insurance - Claims Triage Agent', 'Negotiation', 970_000, 20, 'New Business', 'Commit', true, -1, { extra: ['deskdesk-yuki'] }),
  O('oakhallow-underwriting-assist', 'oakhallow', 'Oakhallow Mutual Insurance - Underwriting Assist', 'Discovery', 280_000, 85, 'New Business', 'Pipeline', false, -15),
  O('voltmere-outage-insights', 'voltmere', 'Voltmere Utilities - Outage Insights on Data 360', 'Discovery', 600_000, 75, 'New Business', 'Pipeline', false, -6, { watched: true, story: 'Storyline 14: watched opp.' }),
  O('voltmere-service-agent', 'voltmere', 'Voltmere Utilities - Customer Service Agent', 'Qualification', 240_000, 130, 'New Business', 'Pipeline', false, -12, { watched: true }),
  O('contoso-seller-agent', 'contoso', 'Contoso Marketplace - Seller Support Agent', 'Proposal', 340_000, 45, 'New Business', 'Best Case', false, -4, { watched: true }),
  O('contoso-realtime-recs', 'contoso', 'Contoso Marketplace - Real-time Recommendations', 'Discovery', 520_000, 99, 'New Business', 'Pipeline', false, -13),
  // ---- closed won (13) ----
  O('saltmere-care-mgmt', 'saltmere', 'Saltmere Health Plan - Care Management Data Foundation', 'Closed Won', 2_100_000, -270, 'New Business', 'Closed', true, -240, { story: 'Largest win; reference for the POC.' }),
  O('saltmere-member-portal', 'saltmere', 'Saltmere Health Plan - Member Portal Service Add-on', 'Closed Won', 380_000, -42, 'Upsell', 'Closed', true, -35),
  O('yarrowdale-platform-renewal-fy26', 'yarrowdale', 'Yarrowdale Health System - Service Platform Renewal FY26', 'Closed Won', 395_000, -330, 'Renewal', 'Closed', false, -320),
  O('yarrowdale-mg-data-assessment', 'yarrowdale-mg', 'Yarrowdale Medical Group - Data Readiness Assessment', 'Closed Won', 85_000, -61, 'New Business', 'Closed', true, -55),
  O('elderglen-outdoors-marketing', 'elderglen-outdoors', 'Elderglen Outdoors - Marketing Personalization Rollout', 'Closed Won', 1_420_000, -120, 'New Business', 'Closed', true, -100, { story: 'The deal behind the renewal in storyline 2.' }),
  O('elderglen-home-commerce-sync', 'elderglen-home', 'Elderglen Home & Living - Commerce Data Sync', 'Closed Won', 275_000, -90, 'New Business', 'Closed', false, -80),
  O('halvergate-shipment-visibility', 'halvergate', 'Halvergate Freight Lines - Shipment Visibility Data', 'Closed Won', 640_000, -150, 'New Business', 'Closed', true, -140),
  O('ferrowpay-risk-score-pilot', 'ferrowpay', 'Ferrowpay Financial - Risk Scoring Pilot', 'Closed Won', 230_000, -75, 'New Business', 'Closed', true, -70),
  O('harrowgate-quality-insights', 'harrowgate', 'Harrowgate Manufacturing - Quality Inspection Insights', 'Closed Won', 510_000, -180, 'New Business', 'Closed', true, -170),
  O('cascadia-resident-portal', 'cascadia', 'Cascadia County Services - Resident Portal Modernization', 'Closed Won', 890_000, -210, 'New Business', 'Closed', false, -200),
  O('oakhallow-agentforce-pilot', 'oakhallow', 'Oakhallow Mutual Insurance - Agentforce Pilot', 'Closed Won', 160_000, -33, 'New Business', 'Closed', true, -28),
  O('voltmere-field-service', 'voltmere', 'Voltmere Utilities - Field Service Analytics', 'Closed Won', 430_000, -240, 'New Business', 'Closed', false, -230),
  O('contoso-support-automation', 'contoso', 'Contoso Marketplace - Support Chat Automation', 'Closed Won', 195_000, -300, 'New Business', 'Closed', false, -290),
  // ---- closed lost (12) ----
  O('halvergate-yard-optimization', 'halvergate', 'Halvergate Freight Lines - Yard Optimization Assistant', 'Closed Lost', 380_000, -55, 'New Business', 'Omitted', true, -50),
  O('ferrowpay-collections-assistant', 'ferrowpay', 'Ferrowpay Financial - Collections Assistant', 'Closed Lost', 270_000, -105, 'New Business', 'Omitted', true, -98),
  O('harrowgate-supplier-portal', 'harrowgate', 'Harrowgate Manufacturing - Supplier Portal', 'Closed Lost', 150_000, -130, 'New Business', 'Omitted', false, -125),
  O('cascadia-benefits-chatbot', 'cascadia', 'Cascadia County Services - Benefits Chatbot', 'Closed Lost', 210_000, -165, 'New Business', 'Omitted', true, -160),
  O('oakhallow-fnol-bot', 'oakhallow', 'Oakhallow Mutual Insurance - FNOL Bot', 'Closed Lost', 340_000, -200, 'New Business', 'Omitted', false, -195),
  O('elderglen-home-loyalty', 'elderglen-home', 'Elderglen Home & Living - Loyalty Program Analytics', 'Closed Lost', 120_000, -20, 'New Business', 'Omitted', false, -18),
  O('voltmere-smart-meter-data', 'voltmere', 'Voltmere Utilities - Smart Meter Data Platform', 'Closed Lost', 780_000, -260, 'New Business', 'Omitted', false, -255),
  O('contoso-ads-measurement', 'contoso', 'Contoso Marketplace - Ads Measurement', 'Closed Lost', 90_000, -140, 'New Business', 'Omitted', false, -135),
  O('saltmere-telehealth-nurse-line', 'saltmere', 'Saltmere Health Plan - Nurse Line Assistant', 'Closed Lost', 310_000, -95, 'New Business', 'Omitted', true, -90),
  O('yarrowdale-bh-wellness', 'yarrowdale-bh', 'Yarrowdale Behavioral Health - Wellness Outreach', 'Closed Lost', 140_000, -45, 'New Business', 'Omitted', false, -40),
  O('elderglen-outdoors-pos', 'elderglen-outdoors', 'Elderglen Outdoors - POS Data Integration', 'Closed Lost', 560_000, -310, 'New Business', 'Omitted', false, -305),
  O('yarrowdale-mg-referral', 'yarrowdale-mg', 'Yarrowdale Medical Group - Referral Management Agent', 'Closed Lost', 180_000, -12, 'New Business', 'Omitted', true, -10),
];
