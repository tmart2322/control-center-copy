/**
 * Domain 02: Drive assets (docs, decks, sheets, recordings) and the ~11 key deliverables that have a revision history
 * (snapshots, per-section digests, diffs). Names and text are invented.
 */
import { type FileKind, furl } from './sources-lib';

export type AssetKind = 'deck' | 'doc' | 'sheet' | 'pdf' | 'demo_org' | 'repo_artifact' | 'recording' | 'talk_track' | 'estimate' | 'link' | 'other';
export type AssetDef = {
  tag: string;
  title: string;
  kind: AssetKind;
  acct?: string;
  opp?: string;
  owner: string | null; // person key
  mod: number; // last modified: day offset
  modT?: string;
  by: string; // last modifier person key
  mine?: boolean; // last modified by me at the same instant
  map?: 'rule' | 'llm' | 'user' | 'connector';
  conf?: number;
  locked?: boolean;
  system?: 'drive' | 'slack_file' | 'vdp' | 'tool' | 'local_fs';
  archived?: number; // day offset
  tier?: 'inventory' | 'watched';
  note?: string; // Gemini notes doc: meeting-note key
  mime?: string;
  modIso?: string; // exact last-modified instant (overrides mod/modT)
  fileId?: string; // external id override (Gemini docs)
  url?: string;
  createdIso?: string;
};
const A = (tag: string, title: string, kind: AssetKind, owner: string | null, mod: number, by: string, o: Partial<AssetDef> = {}): AssetDef => ({ tag, title, kind, owner, mod, by, ...o });

export const ASSETS: AssetDef[] = [
  // ── Saltmere ──
  A('hv-blueprint', 'Saltmere POC Solution Blueprint', 'doc', 'owner', 0, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.98, tier: 'watched', modT: '07:45', mine: true }),
  A('hv-success', 'Saltmere POC Success Criteria', 'doc', 'owner', -6, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.97, mine: true, modT: '14:10' }),
  A('hv-demo-script', 'Saltmere Member Services Demo Script', 'doc', 'owner', 0, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.95, mine: true, modT: '07:50', tier: 'watched' }),
  A('hv-kpi', 'Saltmere POC KPI Baseline', 'sheet', 'hv-marisol', -12, 'hv-marisol', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.86 }),
  A('hv-sizing', 'Saltmere Consumption Sizing', 'sheet', 'owner', -9, 'spec-gustavo', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.9 }),
  A('hv-sec-q', 'Saltmere Vendor Security Review Questionnaire', 'sheet', 'hv-soojin', -1, 'hv-soojin', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.93 }),
  A('hv-workshop-readout', 'Saltmere Data 360 Workshop Readout', 'doc', 'owner', -22, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.95, mine: true }),
  A('hv-arch', 'Saltmere Architecture Overview', 'deck', 'owner', -15, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.9, mine: true }),
  A('hv-exec-deck', 'Saltmere Executive Readout (draft)', 'deck', 'owner', -4, 'ae-harbor', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.8 }),
  A('hv-journey', 'Saltmere Member Journey Map', 'deck', 'hv-marisol', -20, 'hv-marisol', { acct: 'saltmere', map: 'llm', conf: 0.84 }),
  A('hv-dm', 'Saltmere Member Contact Data Map', 'doc', 'hv-marisol', -27, 'hv-marisol', { acct: 'saltmere', map: 'rule', conf: 0.9 }),
  A('hv-talk', 'Saltmere Executive Talk Track', 'talk_track', 'owner', -12, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.78, mine: true }),
  A('hv-demo-org', 'Saltmere POC Demo Org (sandbox)', 'demo_org', 'owner', -3, 'owner', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'user', conf: 1, system: 'tool', locked: true }),
  A('hv-repo', 'saltmere-poc-demo README', 'repo_artifact', 'owner', -3, 'owner', { acct: 'saltmere', map: 'rule', conf: 0.95, system: 'local_fs', mine: true }),
  A('hv-rec-1103', 'Saltmere weekly sync recording 11/03', 'recording', 'ae-harbor', -15, 'ae-harbor', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.9, mime: 'video/mp4' }),
  A('hv-care-case', 'Care Management Data Foundation Case Study', 'deck', 'ae-harbor', -60, 'ae-harbor', { acct: 'saltmere', map: 'rule', conf: 0.9 }),
  A('hv-claims-co', 'Claims Intake Copilot Phase 2 Concept', 'deck', 'ae-harbor', -9, 'ae-harbor', { acct: 'saltmere', opp: 'saltmere-claims-copilot', map: 'llm', conf: 0.82 }),
  A('hv-provdir', 'Provider Directory Data Quality Assessment', 'doc', 'se-ioana', -14, 'se-ioana', { acct: 'saltmere', opp: 'saltmere-provider-directory', map: 'llm', conf: 0.7 }),
  // ── Yarrowdale family ──
  A('aw-proposal', 'Yarrowdale Enterprise Data Foundation Proposal', 'deck', 'owner', -1, 'spec-gustavo', { acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'rule', conf: 0.96, tier: 'watched', modT: '10:10' }),
  A('aw-arch', 'Yarrowdale Architecture Review Notes', 'doc', 'owner', -2, 'owner', { acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'rule', conf: 0.9, mine: true }),
  A('aw-ehr', 'Yarrowdale EHR Instance Inventory', 'sheet', 'aw-lars', -23, 'aw-lars', { acct: 'yarrowdale', map: 'llm', conf: 0.88 }),
  A('aw-bh-intake', 'Behavioral Health Intake Triage Discovery Notes', 'doc', 'owner', -11, 'owner', { acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake', map: 'llm', conf: 0.74, mine: true }),
  A('aw-mg-retro', 'Medical Group Referral Agent Retro', 'doc', 'ae-harbor', -11, 'ae-harbor', { acct: 'yarrowdale-mg', map: 'llm', conf: 0.81 }),
  A('aw-mg-engage', 'Yarrowdale Medical Group Patient Engagement Concept', 'deck', 'owner', -10, 'owner', { acct: 'yarrowdale-mg', opp: 'yarrowdale-mg-patient-engagement', map: 'rule', conf: 0.9, mine: true }),
  A('aw-consump', 'Yarrowdale Consumption Estimate v1', 'estimate', 'spec-gustavo', -7, 'spec-gustavo', { acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'llm', conf: 0.8 }),
  A('aw-renewal', 'Yarrowdale Service Platform Renewal FY27 Summary', 'doc', 'ae-harbor', -6, 'ae-harbor', { acct: 'yarrowdale', opp: 'yarrowdale-platform-renewal', map: 'rule', conf: 0.92 }),
  // ── Elderglen family ──
  A('to-demo', 'Elderglen Outdoors Agentforce Order Status Demo', 'deck', 'owner', -1, 'owner', { acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.96, tier: 'watched', modT: '16:55', mine: true }),
  A('to-renewal-order', 'Elderglen Outdoors Renewal Order Form Summary', 'doc', 'ae-commercial', -4, 'ae-commercial', { acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.94 }),
  A('to-usage', 'Elderglen Outdoors Data 360 Usage Trend', 'sheet', 'csm-femi', -16, 'csm-femi', { acct: 'elderglen-outdoors', map: 'rule', conf: 0.9 }),
  A('to-oms', 'Elderglen Outdoors OMS Integration Notes', 'doc', 'owner', -1, 'owner', { acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.92, mine: true }),
  A('to-mkt-case', 'Marketing Personalization Rollout Case Study', 'deck', 'ae-commercial', -75, 'ae-commercial', { acct: 'elderglen-outdoors', map: 'rule', conf: 0.9 }),
  A('th-persona', 'Elderglen Home Personalization Technical Validation Plan', 'doc', 'owner', -5, 'owner', { acct: 'elderglen-home', opp: 'elderglen-home-personalization', map: 'rule', conf: 0.93, mine: true }),
  A('th-loyalty', 'Elderglen Home Loyalty Analytics Post-mortem', 'doc', 'ae-commercial', -19, 'ae-commercial', { acct: 'elderglen-home', map: 'llm', conf: 0.8 }),
  A('tg-identity', 'Elderglen Retail Group Identity Resolution Discovery Brief', 'doc', 'owner', -13, 'owner', { acct: 'elderglen', opp: 'elderglen-enterprise-identity', map: 'llm', conf: 0.77, mine: true }),
  // ── Halvergate ──
  A('ns-proposal', 'Halvergate Route Exceptions Agent Proposal', 'deck', 'owner', -27, 'owner', { acct: 'halvergate', opp: 'halvergate-route-exceptions-agent', map: 'rule', conf: 0.95, mine: true, modT: '16:00' }),
  A('ns-recap', 'Halvergate Value Recap (draft)', 'doc', 'owner', -5, 'owner', { acct: 'halvergate', opp: 'halvergate-route-exceptions-agent', map: 'llm', conf: 0.85, mine: true }),
  A('ns-ops', 'Halvergate Dispatch Discovery Notes', 'doc', 'owner', -28, 'owner', { acct: 'halvergate', opp: 'halvergate-dispatch-data', map: 'llm', conf: 0.8, mine: true }),
  // ── Ferrowpay ──
  A('qp-arch', 'Ferrowpay Fraud Agent Architecture', 'deck', 'owner', -5, 'se-linnea', { acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', map: 'rule', conf: 0.96, modT: '15:30' }),
  A('qp-estimate', 'Ferrowpay Data 360 Consumption Estimate', 'sheet', 'owner', -7, 'deskdesk-yuki', { acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation', map: 'rule', conf: 0.95, modT: '09:28' }),
  A('qp-demo', 'Ferrowpay Fraud Agent Demo Walkthrough', 'deck', 'owner', -4, 'owner', { acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', map: 'rule', conf: 0.9, mine: true }),
  A('qp-schema', 'Ferrowpay Transaction Schema Mapping', 'doc', 'qp-renata', -13, 'owner', { acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation', map: 'rule', conf: 0.9, mine: true }),
  A('qp-workflow', 'Ferrowpay Fraud Analyst Workflow Notes', 'doc', 'owner', -15, 'owner', { acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', map: 'llm', conf: 0.83, mine: true }),
  A('qp-risk', 'Risk Scoring Pilot Results Readout', 'deck', 'ae-harbor', -42, 'ae-harbor', { acct: 'ferrowpay', map: 'rule', conf: 0.9 }),
  // ── Harrowgate (storyline 5) ──
  A('bw-demo', 'Harrowgate Predictive Maintenance Agent Demo', 'deck', 'owner', -9, 'owner', { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'rule', conf: 0.94, mine: true, modT: '21:15' }),
  A('bw-brief', 'Harrowgate Account Brief', 'doc', 'ae-commercial', -22, 'ae-commercial', { acct: 'harrowgate', map: 'rule', conf: 0.9 }),
  A('bw-sensors', 'Harrowgate Plant Sensor Inventory', 'sheet', 'bw-zainab', -20, 'bw-zainab', { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'llm', conf: 0.84 }),
  A('bw-dash', 'Plant Reliability Dashboard Walkthrough', 'deck', 'owner', -9, 'owner', { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'llm', conf: 0.82, mine: true }),
  A('bw-rec', 'Harrowgate demo recording 11/10', 'recording', 'ae-commercial', -8, 'ae-commercial', { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'llm', conf: 0.8, mime: 'video/mp4' }),
  A('bw-lakehouse', 'Harrowgate Plant Data Lakehouse Notes', 'doc', 'se-tariq', -18, 'se-tariq', { acct: 'harrowgate', opp: 'harrowgate-plant-data', map: 'llm', conf: 0.75 }),
  // ── Cascadia (storyline 6) ──
  A('cc-agenda', 'Cascadia Onsite Workshop Agenda', 'doc', 'owner', -1, 'owner', { acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.95, tier: 'watched', modT: '16:30', mine: true }),
  A('cc-logistics', 'Cascadia Onsite Logistics', 'doc', 'ae-commercial', -13, 'ae-commercial', { acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.9 }),
  A('cc-concept', 'Citizen Services Assistant Concept', 'deck', 'owner', -14, 'owner', { acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.92, mine: true }),
  A('cc-permits', 'Permits Data Inventory', 'sheet', 'cc-noor', -21, 'cc-noor', { acct: 'cascadia', opp: 'cascadia-permits-data', map: 'llm', conf: 0.83 }),
  A('cc-access', 'Accessibility Requirements Checklist', 'doc', 'se-ioana', -6, 'se-ioana', { acct: 'cascadia', map: 'llm', conf: 0.7 }),
  // ── Oakhallow ──
  A('pc-order-form', 'Oakhallow Claims Triage Agent Order Form Addendum', 'doc', 'ae-harbor', -1, 'owner', { acct: 'oakhallow', opp: 'oakhallow-claims-agent', map: 'rule', conf: 0.96, mine: true, modT: '08:35', tier: 'watched' }),
  A('pc-pilot', 'Agentforce Pilot Results Readout', 'deck', 'owner', -26, 'owner', { acct: 'oakhallow', opp: 'oakhallow-agentforce-pilot', map: 'rule', conf: 0.9, mine: true }),
  A('pc-arch', 'Claims Triage Agent Architecture', 'deck', 'owner', -17, 'owner', { acct: 'oakhallow', opp: 'oakhallow-claims-agent', map: 'rule', conf: 0.93, mine: true }),
  A('pc-topics', 'Policy FAQ Agent Topic Definitions', 'doc', 'owner', -24, 'pc-corwin', { acct: 'oakhallow', opp: 'oakhallow-agentforce-pilot', map: 'llm', conf: 0.82 }),
  A('pc-pilot-rec', 'Oakhallow pilot go-live walkthrough recording', 'recording', 'ae-harbor', -29, 'ae-harbor', { acct: 'oakhallow', opp: 'oakhallow-agentforce-pilot', map: 'llm', conf: 0.78, mime: 'video/mp4' }),
  // ── watched accounts ──
  A('lg-schema', 'Voltmere Outage Event Schema', 'doc', 'lg-petra', -24, 'lg-petra', { acct: 'voltmere', opp: 'voltmere-outage-insights', map: 'llm', conf: 0.75 }),
  A('cm-seller', 'Contoso Seller Support Agent Proposal', 'deck', 'ae-commercial', -6, 'ae-commercial', { acct: 'contoso', opp: 'contoso-seller-agent', map: 'rule', conf: 0.9 }),
  // ── internal enablement ──
  A('se-demokit', 'Agentforce Demo Kit v2.3', 'doc', 'se-tariq', -12, 'se-tariq', {}),
  A('se-planning', 'Q4 SE Planning', 'doc', 'mgr', -22, 'mgr', {}),
  A('se-flex', 'Flex Credits One-Pager', 'doc', 'spec-gustavo', -14, 'spec-gustavo', {}),
  A('se-template', 'Solution Blueprint Template', 'doc', 'se-linnea', -40, 'owner', { mine: true }),
  A('se-calc', 'Consumption Calculator v4', 'sheet', 'spec-gustavo', -14, 'spec-gustavo', {}),
  A('se-privacy', 'Data Handling and Privacy Refresh Slides', 'pdf', 'mgr', -20, 'mgr', { mime: 'application/pdf' }),
  A('se-zerocopy', 'Zero-copy Warehouse Access Reference Diagram', 'deck', 'owner', -18, 'owner', { mine: true }),
  A('se-weeklylog', 'Weekly Log Tracker', 'sheet', 'owner', -5, 'owner', { mine: true }),
  A('se-onboard', 'SE Onboarding Checklist', 'doc', 'mgr', -70, 'mgr', {}),
  A('se-roadmap', 'Agentforce Roadmap Readout (internal)', 'deck', 'spec-gustavo', -28, 'spec-gustavo', {}),
  A('hv-plan', 'Saltmere POC Project Plan', 'doc', 'ae-harbor', -26, 'ae-harbor', { acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.9 }),
  A('to-faq', 'Order Status Agent FAQ', 'doc', 'owner', -10, 'owner', { acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.88, mine: true }),
  A('qp-commercial', 'Ferrowpay Commercial Notes (deal desk)', 'doc', 'deskdesk-yuki', -9, 'deskdesk-yuki', { acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation', map: 'llm', conf: 0.8 }),
  A('pc-kickoff', 'Oakhallow Agentforce Pilot Kickoff Deck', 'deck', 'ae-harbor', -38, 'ae-harbor', { acct: 'oakhallow', opp: 'oakhallow-agentforce-pilot', map: 'rule', conf: 0.9 }),
  A('aw-governance', 'Yarrowdale Data Governance Model (draft)', 'doc', 'owner', -8, 'owner', { acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'llm', conf: 0.82, mine: true }),
  A('se-checklist', 'Demo Readiness Checklist', 'doc', 'se-ioana', -33, 'se-ioana', {}),
  A('cc-brief', 'Cascadia County Account Brief', 'doc', 'ae-commercial', -30, 'ae-commercial', { acct: 'cascadia', map: 'rule', conf: 0.9 }),
  A('th-sample', 'Elderglen Home Sample Catalog Data', 'sheet', 'th-dominic', -11, 'th-dominic', { acct: 'elderglen-home', opp: 'elderglen-home-personalization', map: 'llm', conf: 0.85 }),
  A('cm-recs', 'Contoso Real-time Recommendations Concept', 'deck', 'ae-commercial', -4, 'ae-commercial', { acct: 'contoso', opp: 'contoso-realtime-recs', map: 'llm', conf: 0.78 }),
  A('bw-roi', 'Harrowgate Downtime Savings Model', 'sheet', 'owner', -9, 'owner', { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'llm', conf: 0.84, mine: true }),
  // ── low-value inventory (scratch and copies) ──
  A('sc-1', 'Untitled document', 'doc', 'owner', -26, 'owner', { mine: true }),
  A('sc-2', 'Copy of Saltmere Architecture Overview', 'deck', 'owner', -21, 'owner', { acct: 'saltmere', map: 'llm', conf: 0.6, mine: true }),
  A('sc-3', 'scratch: sizing assumptions', 'doc', 'owner', -28, 'owner', { mine: true }),
  A('sc-4', 'Notes - Oakhallow call', 'doc', 'owner', -19, 'owner', { acct: 'oakhallow', map: 'llm', conf: 0.55, mine: true }),
  A('sc-5', 'Copy of Solution Blueprint Template', 'doc', 'owner', -20, 'owner', { mine: true }),
  A('sc-6', 'Demo data - retail orders (sample)', 'sheet', 'owner', -33, 'owner', { mine: true }),
  A('sc-7', 'Ideas for Q4', 'doc', 'owner', -31, 'owner', { mine: true }),
  A('sc-8', 'Untitled presentation', 'deck', 'owner', -17, 'owner', { mine: true }),
];

/** Deliverables with a revision history: base sections plus per-version edits. */
type Sec = { key: string; title: string; text: string };
type Op = ['mod', string, string, string?] | ['add', string, string, string, string | null] | ['del', string] | ['mv', string, string | null];
export type Version = { d: number; t: string; who: string; ops?: Op[]; mult?: number };
export type Deliv = { tag: string; fkind: FileKind; extractor: string; mult: number; base: Sec[]; versions: Version[] };
const sec = (key: string, title: string, text: string): Sec => ({ key, title, text });

export const DELIVERABLES: Deliv[] = [
  {
    tag: 'hv-blueprint', fkind: 'doc', extractor: 'docs.get_doc_as_markdown@2', mult: 14,
    base: [
      sec('overview#1', '1. Overview', 'Purpose of the Saltmere POC: prove that an Agentforce member services agent on a Data 360 unified profile can answer claim-status questions and hand off to a human rep with a case summary.'),
      sec('scope#1', '2. Scope and success criteria', 'In scope: the claim status journey for active members. Out of scope: eligibility changes and payments. Success criteria are tracked in the separate success criteria document.'),
      sec('landscape#1', '3. Current-state landscape', 'Member data lives in the claims warehouse, the CRM and the contact-center platform. No shared member key exists across the three.'),
      sec('architecture#1', '4. Target architecture', 'TBD: architecture diagram and data flows.'),
      sec('identity#1', '5. Identity and access', 'TBD.'),
      sec('datamodel#1', '6. Data model', 'TBD.'),
      sec('rollout#1', '7. Rollout plan', 'TBD.'),
    ],
    versions: [
      { d: -13, t: '16:20', who: 'owner' },
      { d: -8, t: '17:40', who: 'owner', ops: [
        ['mod', 'overview#1', 'Purpose of the Saltmere POC: prove that an Agentforce member services agent on a Data 360 unified profile can answer claim-status questions and hand off to a human rep with a case summary. Business owner: Marisol Quintero. Sponsor: Priyanka Deshmukh.'],
        ['mod', 'scope#1', 'In scope: the claim status journey for roughly 1.2M active members. Out of scope: eligibility changes and payments. Targets: at least 45% containment on status questions and a 20% handle-time reduction on escalated calls.'],
        ['mod', 'landscape#1', 'Member data lives in the claims warehouse, the CRM and the contact-center platform. No shared member key exists across the three. The partner estimates 6 to 8 weeks for batch ingest of the claims warehouse with change capture for the last 24 months.'],
      ] },
      { d: -5, t: '11:15', who: 'spec-gustavo', ops: [
        ['mod', 'architecture#1', 'Batch ingest of the claims warehouse through the partner-built connector; CRM and contact-center platform through standard connectors; identity resolution with an exact and a fuzzy ruleset producing one unified individual per member.'],
        ['add', 'consumption#1', '8. Consumption model', 'Draft numbers pending from the specialist.', 'rollout#1'],
      ] },
      { d: -1, t: '15:20', who: 'hv-soojin', ops: [
        ['mod', 'landscape#1', 'Member data lives in the claims warehouse (managed cloud warehouse), the CRM (in-house) and the contact-center platform. No shared member key exists across the three. The partner estimates 6 to 8 weeks for batch ingest of the claims warehouse with change capture for the last 24 months.'],
      ] },
      { d: -1, t: '19:30', who: 'owner', ops: [
        ['mod', 'identity#1', 'Staff users authenticate through the Saltmere IdP with SAML SSO; IdP groups map to Agentforce permission sets (see 5.2). Test members are synthetic records; no real member data enters the POC org.'],
        ['mod', 'datamodel#1', 'Core DMOs: Individual, Contact Point Email, Contact Point Phone, Claim, Provider, Encounter. Claim status is read from the claim DMO; the agent never writes back to the warehouse.'],
        ['add', 'risks#1', '9. Risks and assumptions', 'Risks: warehouse ingest schedule, SSO group mapping sign-off, availability of the 90-day contact-center export.', 'consumption#1'],
      ] },
      { d: 0, t: '07:45', who: 'owner', ops: [
        ['mod', 'rollout#1', 'Draft: weeks 1-2 foundation (ingest, identity), weeks 3-4 agent topics and handoff, weeks 5-6 pilot with 25 service reps, week 7 readout against success criteria.'],
        ['mod', 'consumption#1', 'Waiting on the specialist consumption model; placeholders below the 12 month ramp.'],
      ] },
    ],
  },
  {
    tag: 'hv-success', fkind: 'doc', extractor: 'docs.get_doc_as_markdown@2', mult: 10,
    base: [
      sec('goals#1', 'Goals', 'Show that an agent on a unified member profile resolves claim-status questions without a human and escalates cleanly when it cannot.'),
      sec('kpis#1', 'KPIs', 'Containment rate, deflected claim-status calls, handle-time delta, member satisfaction.'),
      sec('baseline#1', 'Baseline', 'Baseline to be taken from the contact-center export.'),
      sec('testplan#1', 'Test plan', 'Scripted scenarios plus 25 service reps in a controlled pilot.'),
      sec('acceptance#1', 'Acceptance', 'Go/no-go decision at the architecture board.'),
    ],
    versions: [
      { d: -29, t: '15:00', who: 'owner' },
      { d: -12, t: '10:05', who: 'owner', ops: [['mod', 'kpis#1', 'Containment rate for status questions, deflection of claim-status calls, average handle time delta, member satisfaction on the new flow (list supplied by Marisol, revised 11/06).']] },
      { d: -6, t: '14:10', who: 'owner', ops: [['mod', 'baseline#1', 'Baseline from a 90-day contact-center export, scrubbed for PHI by the customer; two free-text columns carry no member identifiers.']] },
    ],
  },
  {
    tag: 'hv-demo-script', fkind: 'doc', extractor: 'docs.get_doc_as_markdown@2', mult: 8,
    base: [
      sec('setup#1', 'Setup', 'Demo org seeded with 40 synthetic members; service console open on the left, member chat on the right.'),
      sec('scene1#1', 'Scene 1: claim status', 'A member asks where a claim stands; the agent finds the claim, explains the status and offers next steps.'),
      sec('scene3#1', 'Scene 3: rep view', 'The service rep sees the conversation and the case summary on one screen.'),
      sec('close#1', 'Close', 'Return to success criteria and the proposed 7-week plan.'),
    ],
    versions: [
      { d: -6, t: '16:45', who: 'owner' },
      { d: 0, t: '07:50', who: 'owner', ops: [['add', 'scene2#1', 'Scene 2: denied claim handoff', 'A member asks about a denied claim; the agent explains the denial in plain language and hands off to a human rep with a case summary.', 'scene1#1']] },
    ],
  },
  {
    tag: 'to-demo', fkind: 'deck', extractor: 'slides.read_presentation@1', mult: 4,
    base: [
      sec('s_title', 'Order Status Agent', 'Elderglen Outdoors: Agentforce order status for ecommerce and the contact center.'),
      sec('s_today', 'Order status today', 'About a third of contact-center volume asks where an order is. Customers wait on hold for tracking numbers.'),
      sec('s_topics', 'Agent topics', 'Order lookup, shipment tracking, return status, address change before shipment.'),
      sec('s_results', 'Expected results', 'Target 40% deflection of order-status contacts in the first quarter.'),
      sec('s_next', 'Next steps', 'Confirm scope, sandbox access, pilot plan.'),
    ],
    versions: [
      { d: -23, t: '14:30', who: 'owner' },
      { d: -9, t: '15:05', who: 'owner', ops: [
        ['add', 's_split', 'Split shipments', 'One order, two parcels: the agent tracks each parcel and explains why the second one is late.', 's_topics'],
        ['add', 's_refund', 'Partial refunds', 'Partial refunds hand off to a human with the order context attached.', 's_split'],
      ] },
      { d: -1, t: '16:55', who: 'owner', ops: [
        ['add', 's_oms', 'OMS integration', 'The agent reads orders and shipment events through the OMS API sandbox; no write access in the first release.', 's_refund'],
        ['mod', 's_results', 'Target 40% deflection of order-status contacts in the first quarter; measure with the same baseline Brendan\'s team already reports.'],
      ] },
    ],
  },
  {
    tag: 'aw-proposal', fkind: 'deck', extractor: 'slides.read_presentation@1', mult: 4,
    base: [
      sec('s_title', 'Enterprise Data Foundation', 'Yarrowdale Health System: a unified data foundation across eleven hospitals.'),
      sec('s_summary', 'Executive summary', 'One governed patient and provider data layer, built in three phases.'),
      sec('s_phase1', 'Phase 1: Foundation', 'Ingest the three EHR instances; identity resolution; governance model.'),
      sec('s_phase2', 'Phase 2: Integration', 'Connect scheduling, billing and the patient portal.'),
      sec('s_invest', 'Investment', 'Placeholder pending the consumption model.'),
    ],
    versions: [
      { d: -16, t: '11:00', who: 'owner' },
      { d: -9, t: '17:30', who: 'owner', ops: [['add', 's_phase3', 'Phase 3: Activation', 'Agent use cases on the foundation: patient access, referral management, care-gap outreach.', 's_phase2']] },
      { d: -2, t: '13:05', who: 'owner', ops: [
        ['add', 's_bh', 'Behavioral Health trust domain', 'Behavioral Health keeps its own identity system and consent rules; the foundation treats it as a separate trust domain.', 's_phase1'],
        ['mod', 's_invest', 'Indicative range per phase; detailed consumption model to follow from the specialist.'],
      ] },
      { d: -1, t: '10:10', who: 'spec-gustavo', ops: [['mod', 's_phase2', 'Connect scheduling, billing and the patient portal. Add a 20% integration buffer to the sizing.']] },
    ],
  },
  {
    tag: 'qp-arch', fkind: 'deck', extractor: 'slides.read_presentation@1', mult: 4,
    base: [
      sec('s_title', 'Fraud Investigation Agent', 'Ferrowpay Financial: architecture for the fraud case triage agent.'),
      sec('s_sources', 'Data sources', 'Card transactions, device signals, dispute history, merchant reference data.'),
      sec('s_dmo', 'Data 360 mapping', 'Transactions, accounts, merchants and cases map to DMOs; merchant hierarchy still open.'),
      sec('s_topics', 'Agent topics', 'Case summary, similar-case lookup, recommended action, escalation.'),
      sec('s_guard', 'Guardrails', 'No account actions without analyst approval; every recommendation cites its evidence.'),
    ],
    versions: [
      { d: -20, t: '16:00', who: 'owner' },
      { d: -13, t: '15:00', who: 'owner', ops: [['add', 's_merchant', 'Merchant hierarchy', 'Parent-child merchant relationships modeled as a self-referencing DMO so chargeback patterns roll up.', 's_dmo']] },
      { d: -5, t: '15:30', who: 'se-linnea', ops: [
        ['mv', 's_topics', 's_title'],
        ['mod', 's_topics', 'Lead with the analyst workflow: case summary, similar-case lookup, recommended action, escalation.'],
      ] },
    ],
  },
  {
    tag: 'qp-estimate', fkind: 'sheet', extractor: 'sheets.read_sheet_values@1', mult: 6,
    base: [
      sec('t_assump', 'Assumptions', 'Year 1 volume 1.2M cases; 5 agent actions per case; ingest 40M transaction rows per month.'),
      sec('t_y1', 'Year 1 ramp', 'Monthly credits ramp from 12% to 100% of steady state over six months.'),
      sec('t_y2', 'Year 2-3', 'Uplift applied on the committed credits in years two and three.'),
      sec('t_sum', 'Summary', 'Third-year uplift 3%. Total commitment shown against list.'),
    ],
    versions: [
      { d: -13, t: '17:00', who: 'owner' },
      { d: -9, t: '17:20', who: 'owner', ops: [['mod', 't_assump', 'Year 1 volume 1.4M cases after Folasade\'s revised forecast; 5 agent actions per case; ingest 40M transaction rows per month.']] },
      { d: -7, t: '09:28', who: 'deskdesk-yuki', ops: [['mod', 't_sum', 'Third-year uplift 5%. Total commitment shown against list.']] },
    ],
  },
  {
    tag: 'pc-order-form', fkind: 'doc', extractor: 'docs.get_doc_as_markdown@2', mult: 12,
    base: [
      sec('parties#1', '1. Parties and term', 'Order form addendum between Oakhallow Mutual Insurance and the vendor for the Claims Triage Agent, 24 month term.'),
      sec('scope#1', '2. Scope', 'Claims triage agent for auto and property claims; two environments (sandbox, production).'),
      sec('sla#1', '3. Support and service levels', 'Support hours Monday to Friday 8:00 to 18:00 ET. Target response times per severity are listed in Schedule B.'),
      sec('pricing#1', '4. Pricing', 'Committed credits per the quote; true-up annually.'),
      sec('sign#1', '5. Signatures', 'Signature block.'),
    ],
    versions: [
      { d: -2, t: '12:00', who: 'ae-harbor' },
      { d: -1, t: '08:35', who: 'owner', ops: [['mod', 'sla#1', 'Support hours Monday to Friday 8:00 to 18:00 ET; severity 1 incidents covered 24x7. Target response times per severity are listed in Schedule B.']] },
    ],
  },
  {
    tag: 'cc-agenda', fkind: 'doc', extractor: 'docs.get_doc_as_markdown@2', mult: 9,
    base: [
      sec('d1am#1', 'Day 1 morning: service channels', 'Walk through how residents reach county services today: phone, web, counter. Capture volumes and pain points.'),
      sec('d1pm#1', 'Day 1 afternoon: data inventory', 'Inventory systems holding resident and permit data; identify owners and refresh cadence.'),
      sec('d2am#1', 'Day 2 morning: assistant design', 'Design the citizen services assistant: top 15 questions, handoff rules, languages.'),
      sec('d2pm#1', 'Day 2 afternoon: demo and readout', 'Prototype demo and readout to the county CIO.'),
      sec('logistics#1', 'Logistics', 'Badge registration, guest Wi-Fi, room setup.'),
    ],
    versions: [
      { d: -9, t: '15:20', who: 'owner' },
      { d: -8, t: '09:50', who: 'owner', ops: [['add', 'access#1', 'Day 1 afternoon: accessibility requirements', '30-minute session on accessibility and language access requirements for the assistant.', 'd1pm#1']] },
      { d: -1, t: '16:30', who: 'owner', ops: [['mod', 'logistics#1', 'Badge registration done for 14 attendees; guest Wi-Fi; room with two screens; county CIO joins day 2 for the readout.']] },
    ],
  },
  {
    tag: 'bw-demo', fkind: 'deck', extractor: 'slides.read_presentation@1', mult: 4,
    base: [
      sec('s_title', 'Predictive Maintenance Agent', 'Harrowgate Manufacturing: from sensor drift to a scheduled work order.'),
      sec('s_problem', 'Unplanned downtime', 'Unplanned stops on the packaging lines cost more than scheduled maintenance windows.'),
      sec('s_agent', 'Agent overview', 'The agent reads sensor trends, predicts failures and drafts a work order for the reliability lead to approve.'),
      sec('s_predict', 'Failure prediction', 'Vibration and temperature features feed a model scored every 15 minutes.'),
      sec('s_wo', 'Work order creation', 'Approved predictions create a work order with parts and a recommended window.'),
    ],
    versions: [
      { d: -22, t: '20:00', who: 'owner' },
      { d: -21, t: '07:40', who: 'owner', ops: [['mod', 's_wo', 'Approved predictions create a work order with parts, a recommended window and the failure history of that asset.']] },
      { d: -9, t: '21:15', who: 'owner', ops: [
        ['add', 's_plant', 'Plant manager dashboard', 'One screen per plant: open predictions, approved work orders, avoided downtime hours.', 's_wo'],
        ['add', 's_scale', 'Scaling to 38 plants', 'Rollout in waves of five plants; shared model, per-plant thresholds.', 's_plant'],
      ] },
    ],
  },
  {
    tag: 'ns-proposal', fkind: 'deck', extractor: 'slides.read_presentation@1', mult: 4,
    base: [
      sec('s_title', 'Route Exceptions Agent', 'Halvergate Freight Lines: exception handling for dispatch.'),
      sec('s_problem', 'Exceptions today', 'Dispatchers resolve delays, missed pickups and capacity issues manually across three systems.'),
      sec('s_solution', 'Solution', 'An agent triages exceptions, proposes a resolution and updates the customer.'),
      sec('s_timeline', 'Timeline', 'Eight-week pilot, then phased rollout.'),
    ],
    versions: [
      { d: -30, t: '08:20', who: 'owner' },
      { d: -27, t: '16:00', who: 'owner', ops: [['add', 's_integration', 'Integration diagram', 'Dispatch system and telematics feeds land in Data 360; the agent acts through approved dispatch APIs.', 's_solution']] },
    ],
  },
];

export const KIND_OF: Record<string, FileKind> = {};
for (const a of ASSETS) KIND_OF[a.tag] = a.kind === 'deck' ? 'deck' : a.kind === 'sheet' || a.kind === 'estimate' ? 'sheet' : 'doc';
/** A Drive link to an asset by tag, in the right editor path. */
export const L = (tag: string): string => {
  const k = KIND_OF[tag];
  if (!k) throw new Error(`unknown asset tag ${tag}`);
  return furl(tag, k);
};
