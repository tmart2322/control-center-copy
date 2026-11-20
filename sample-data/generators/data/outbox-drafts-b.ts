/** VDP updates, calendar holds and Org62 hand-off batches (the non-message drafts). Canvas drafts live in outbox-deals.ts. */
import type { DSpec } from './outbox-build';
import { doc } from './outbox-lib';

const VDP = (slug: string) => `https://vdp.example.com/vdp/${slug}`;
const SLUG = { hv: 'saltmere-health-plan-data-360-poc', qp: 'ferrowpay-financial-fraud-agent', pc: 'oakhallow-mutual-claims-agent', to: 'elderglen-outdoors-expansion', aw: 'yarrowdale-health-system-enterprise-data', awbh: 'yarrowdale-health-system-intake-triage', pcp: 'oakhallow-mutual-agentforce-pilot' };
const VDPID: Record<string, string> = { hv: 'vdp-smpl-001', aw: 'vdp-smpl-002', qp: 'vdp-smpl-003', pc: 'vdp-smpl-005', to: 'vdp-smpl-006', awbh: 'vdp-smpl-009', pcp: 'vdp-smpl-008' };

type Ch = { label: string; before: string | number | null; after: string | number; field?: string };
function vdp(p: { key: string; v: keyof typeof SLUG; label: string; item: string; changes: Ch[]; uc?: [string, string]; summary: string } & Partial<DSpec>): DSpec {
  const { key, v, label, item, changes, uc, summary, ...rest } = p;
  const payload = {
    action: item.startsWith('create') ? 'vdp.create' : 'vdp.update', kind: item, target: { label, url: VDP(SLUG[v]) }, text: null,
    changes: changes.map((c) => ({ label: c.label, before: c.before, after: c.after })),
    input: { vdpId: VDPID[v], vdpSlug: SLUG[v], itemKey: `${item}:${uc ? uc[0] : VDPID[v]}`, field: changes[0]!.field ?? item, value: changes[0]!.after, before: changes[0]!.before, candidateId: null, pending: null, track: null, useCaseId: uc ? uc[0] : null, useCaseTitle: uc ? uc[1] : null,
      changes: changes.map((c) => ({ field: c.field ?? c.label, value: c.after, before: c.before })) },
  };
  return { key, kind: 'vdp_update', status: 'ready', created: '11-10 10:25', title: summary, payload, docJson: doc([summary]), text: summary, model: null, voice: false, ...rest } as DSpec;
}

export const VDP_DRAFTS: DSpec[] = [
  vdp({ key: 'v-hv-uc-create', v: 'hv', label: 'Saltmere Health Plan: Data 360 POC (VDP)', item: 'create_use_case', uc: ['vdp-uc-smpl-003', 'Unified Member Profile'], summary: 'Create the use case "Unified Member Profile" (Data 360) with go-live 2027-02-01',
    changes: [{ label: 'Use case', before: null, after: 'Unified Member Profile', field: 'title' }, { label: 'Go-live date', before: null, after: '2027-02-01', field: 'go_live_date' }, { label: 'Product', before: null, after: 'Data 360', field: 'product' }],
    status: 'verified', created: '11-09 16:30', wi: 27, ap: '11-09 16:39:40', apm: 'click', se: '11-09 16:40:12', vf: '11-09 16:52', job: 262,
    atts: [{ at: '11-09 16:40:05', status: 'succeeded', dry: true, sec: 1, ext: null, adapter: 'vdp.create_use_case (dry run)' }, { at: '11-09 16:40:08', status: 'succeeded', job: 262, ext: 'vdp-uc-smpl-003', sec: 4, adapter: 'vdp.create_use_case' }],
    vers: [{ at: '11-09 16:52', method: 'vdp_read', status: 'matched', ext: 'vdp-uc-smpl-003', diff: 'Use case present with go-live 2027-02-01 and product Data 360', att: 1 }], resultUrl: VDP(SLUG.hv) }),
  vdp({ key: 'v-qp-golive', v: 'qp', label: 'Ferrowpay Financial: Fraud Investigation Agent (VDP)', item: 'update_use_case', uc: ['vdp-uc-smpl-005', 'Fraud Case Triage'], summary: 'Set go-live 2027-04-30 and stage U02 - Scoped on "Fraud Case Triage"',
    changes: [{ label: 'Go-live date', before: null, after: '2027-04-30', field: 'go_live_date' }, { label: 'Stage', before: 'U01 - Not Started', after: 'U02 - Scoped', field: 'stage' }],
    status: 'verified', created: '11-14 11:10', ap: '11-14 11:19:30', apm: 'click', se: '11-14 11:20:09', vf: '11-14 11:35', job: 395, resultUrl: VDP(SLUG.qp),
    vers: [{ at: '11-14 11:35', method: 'vdp_read', status: 'matched', ext: 'vdp-uc-smpl-005', diff: 'Go-live 2027-04-30 and stage U02 - Scoped read back' }] }),
  vdp({ key: 'v-pc-golive', v: 'pc', label: 'Oakhallow Mutual Insurance: Claims Triage Agent (VDP)', item: 'update_use_case', uc: ['vdp-uc-smpl-007', 'Claims Triage Agent'], summary: 'Set go-live 2026-12-15 and stage U03 - In Development on "Claims Triage Agent"',
    changes: [{ label: 'Go-live date', before: null, after: '2026-12-15', field: 'go_live_date' }, { label: 'Stage', before: 'U02 - Scoped', after: 'U03 - In Development', field: 'stage' }],
    status: 'verify_failed', created: '11-16 10:30', ap: '11-16 10:44:50', apm: 'click', se: '11-16 10:45:14', vf: '11-16 11:15', job: 431, resultUrl: VDP(SLUG.pc),
    vers: [{ at: '11-16 11:15', method: 'vdp_read', status: 'mismatch', ext: 'vdp-uc-smpl-007', diff: 'VDP kept the stage U03 but the go-live date is still empty (expected 2026-12-15). Push the date again on Activity ▸ VDP.' }] }),
  vdp({ key: 'v-to-owners', v: 'to', label: 'Elderglen Outdoors: Data 360 Renewal + Agentforce Expansion (VDP)', item: 'set_vdp_owners', summary: 'Set the AE list to Nadia Quraishi and the TA to me',
    changes: [{ label: 'AE', before: '(none)', after: 'Nadia Quraishi', field: 'ae' }, { label: 'TA', before: '(none)', after: 'Rafael Okonkwo', field: 'ta' }],
    status: 'failed', created: '11-17 09:25', wi: 37, ap: '11-17 09:32', apm: 'click',
    atts: [{ at: '11-17 09:32:05', status: 'failed', code: 'owner_unknown', msg: 'Not in VDP yet: Nadia Quraishi. Add them in VDP with a sales role, then push again.', sec: 2, adapter: 'vdp.set_owners' }] }),
  vdp({ key: 'v-hv-assets-v1', v: 'hv', label: 'Saltmere Health Plan: Data 360 POC (VDP)', item: 'add_vdp_asset', summary: 'Add the success criteria and the demo script to the Saltmere VDP',
    changes: [{ label: 'Asset', before: null, after: 'Saltmere POC Success Criteria', field: 'asset' }, { label: 'Asset', before: null, after: 'Saltmere Member Services Demo Script', field: 'asset' }],
    status: 'superseded', created: '11-10 10:25:30', wi: 27, nba: 'wi-027:v1', llm: 389, upd: '11-18 08:21', reason: 'Superseded by the draft of 11-18: the blueprint and the owners are part of the same push' }),
  vdp({ key: 'v-hv-owners-assets', v: 'hv', label: 'Saltmere Health Plan: Data 360 POC (VDP)', item: 'add_vdp_asset', summary: 'Add Theo as AE and the blueprint, success criteria and demo script to the Saltmere VDP',
    changes: [{ label: 'AE', before: '(none)', after: 'Theo Brandt', field: 'ae' }, { label: 'Asset', before: null, after: 'Saltmere POC Solution Blueprint', field: 'asset' }, { label: 'Asset', before: null, after: 'Saltmere POC Success Criteria', field: 'asset' }, { label: 'Asset', before: null, after: 'Saltmere Member Services Demo Script', field: 'asset' }],
    status: 'ready', created: '11-18 08:20:40', wi: 27, nba: 'wi-027:v2' }),
  vdp({ key: 'v-to-deck', v: 'to', label: 'Elderglen Outdoors: Data 360 Renewal + Agentforce Expansion (VDP)', item: 'add_vdp_asset', uc: ['vdp-uc-smpl-008', 'Order Status Agent'], summary: 'Add the order-status demo deck and set a go-live date on "Order Status Agent"',
    changes: [{ label: 'Asset', before: null, after: 'Elderglen Outdoors Agentforce Order Status Demo', field: 'asset' }, { label: 'Go-live date', before: null, after: '2027-01-15', field: 'go_live_date' }],
    status: 'ready', created: '11-10 10:25:35', wi: 37, nba: 'wi-037:v1', llm: 390 }),
  vdp({ key: 'v-qp-arch-deck', v: 'qp', label: 'Ferrowpay Financial: Fraud Investigation Agent (VDP)', item: 'add_vdp_asset', summary: 'Add the architecture deck to the Ferrowpay fraud agent VDP',
    changes: [{ label: 'Asset', before: null, after: 'Ferrowpay Fraud Agent Architecture', field: 'asset' }], status: 'ready', created: '11-10 10:25:40', wi: 72, nba: 'wi-072:v1', llm: 391 }),
  vdp({ key: 'v-hv-title', v: 'hv', label: 'Saltmere Health Plan: Data 360 POC (VDP)', item: 'update_use_case', uc: ['vdp-uc-smpl-003', 'Unified Member Profile'], summary: 'Rename the use case "Unified Profile" to "Unified Member Profile"',
    changes: [{ label: 'Title', before: 'Unified Profile', after: 'Unified Member Profile', field: 'title' }], status: 'ready', created: '11-15 14:36', by: 'user' }),
  vdp({ key: 'v-aw-bh-company', v: 'awbh', label: 'Yarrowdale Health System: Intake Triage (VDP)', item: 'set_company', summary: 'Move the intake triage VDP to the company "Yarrowdale Behavioral Health"',
    changes: [{ label: 'Company', before: 'Yarrowdale Health System', after: 'Yarrowdale Behavioral Health', field: 'company' }], status: 'discarded', created: '11-12 17:30', wi: 74, upd: '11-13 07:30', reason: 'Settled: the VDP stays under Yarrowdale Health System (decision recorded on the work item)' }),
  vdp({ key: 'v-hv-fiscal', v: 'hv', label: 'Saltmere Health Plan: Data 360 POC (VDP)', item: 'set_fiscal_period', summary: 'Set the fiscal period to FY27 Q4',
    changes: [{ label: 'Fiscal period', before: null, after: 'FY27 Q4', field: 'fiscal_period' }], status: 'discarded', created: '11-05 07:10', upd: '11-05 13:30', reason: 'Not needed: the read-back showed FY27 Q4 already set' }),
  vdp({ key: 'v-aw-uc-title', v: 'aw', label: 'Yarrowdale Health System: Enterprise Data Foundation (VDP)', item: 'update_use_case', uc: ['vdp-uc-smpl-004', 'Enterprise Patient Data Foundation'], summary: 'Rename "Patient Data Foundation" to "Enterprise Patient Data Foundation"',
    changes: [{ label: 'Title', before: 'Patient Data Foundation', after: 'Enterprise Patient Data Foundation', field: 'title' }], status: 'superseded', created: '11-02 07:10', upd: '11-06 07:15', reason: 'Superseded: the Org62 use case was renamed first and VDP picked up the new name' }),
  vdp({ key: 'v-pcp-recording', v: 'pcp', label: 'Oakhallow Mutual Insurance: Agentforce Pilot (VDP)', item: 'add_vdp_asset', summary: 'Add the pilot retro recording to the Agentforce pilot VDP',
    changes: [{ label: 'Asset', before: null, after: 'Pilot retro recording 10/23', field: 'asset' }], status: 'rejected', created: '11-02 07:10', rj: '11-02 09:20', reason: 'A recording does not belong in the VDP: a shared repository wants fewer, useful assets' }),
];

const holdPayload = (label: string, events: Array<{ title: string; start: string; end: string }>) => ({ action: 'calendar.create_hold', kind: 'calendar_hold', target: { label, url: null }, text: null, changes: events.map((e) => ({ label: e.title, before: null, after: `${e.start} to ${e.end}` })), input: { events } });
export const HOLD_DRAFTS: DSpec[] = [
  { key: 'ch-blueprint-focus', kind: 'calendar_hold', status: 'verified', created: '11-13 10:00:20', wi: 3, title: 'Hold two focus blocks for the blueprint', payload: holdPayload('Calendar: Focus: blueprint writing (2 holds)', [{ title: 'Focus: blueprint writing', start: '2026-11-13T13:00', end: '2026-11-13T17:00' }, { title: 'Focus: blueprint writing', start: '2026-11-16T09:00', end: '2026-11-16T12:00' }]),
    docJson: null, text: 'Two focus holds: Fri 11-13 13:00-17:00 and Mon 11-16 09:00-12:00', model: null, voice: false, ap: '11-13 10:04', apm: 'click', handoff: '11-13 10:05', handoffUrl: 'https://calendar.example.com/event/new?smpl=focus-blueprint', vf: '11-13 10:40', mode: 'handoff', level: 'L1_draft', policy: 'calendar_hold:all', st: undefined,
    vers: [{ at: '11-13 10:40', method: 'calendar_read', status: 'matched', diff: 'Both events found on the primary calendar' }] },
  { key: 'ch-cc-prep', kind: 'calendar_hold', status: 'verified', created: '11-13 10:00:40', wi: 53, title: 'Hold Friday 2-4pm to prepare the Cascadia onsite', payload: holdPayload('Calendar: Prep: Cascadia onsite', [{ title: 'Prep: Cascadia onsite', start: '2026-11-20T14:00', end: '2026-11-20T16:00' }]),
    docJson: null, text: 'Hold Fri 11-20 14:00-16:00 to prepare the onsite agenda', model: null, voice: false, ap: '11-13 10:08', apm: 'click', handoff: '11-13 10:09', handoffUrl: 'https://calendar.example.com/event/new?smpl=cc-prep', vf: '11-13 10:41', mode: 'handoff', level: 'L1_draft', policy: 'calendar_hold:all',
    vers: [{ at: '11-13 10:41', method: 'calendar_read', status: 'matched', diff: 'Event found on the primary calendar' }] },
  { key: 'ch-training-hold', kind: 'calendar_hold', status: 'verified', created: '11-13 13:41:00', wi: 21, title: 'Hold Thursday 4pm for the privacy refresh', payload: holdPayload('Calendar: Training: Data Handling and Privacy Refresh', [{ title: 'Training: Data Handling and Privacy Refresh (45 min)', start: '2026-11-19T16:00', end: '2026-11-19T16:45' }]),
    docJson: null, text: 'Hold Thu 11-19 16:00-16:45 for the mandatory training', model: null, voice: false, ap: '11-13 13:44', apm: 'click', handoff: '11-13 13:45', handoffUrl: 'https://calendar.example.com/event/new?smpl=training-hold', vf: '11-13 14:10', mode: 'handoff', level: 'L1_draft', policy: 'calendar_hold:all',
    vers: [{ at: '11-13 14:10', method: 'calendar_read', status: 'matched', diff: 'Event found on the primary calendar' }] },
];

export type BatchSpec = { key: string; label: string; events: number[]; wi: number; nba?: string; created: string; ap: string; handoff: string; url: string };
export const ORG62_BATCHES: BatchSpec[] = [
  { key: 'oh-week-1019', label: 'Org62 Solutions Events: week of 10/19 (9 events)', events: [1, 2, 3, 4, 5, 6, 7, 8, 9], wi: 85, created: '10-23 16:30', ap: '10-23 16:34', handoff: '10-23 16:36', url: 'https://org62.example.com/lightning/o/Event/new?smplBatch=1019' },
  { key: 'oh-week-1026', label: 'Org62 Solutions Events: week of 10/26 (9 events)', events: [10, 11, 12, 13, 14, 15, 16, 17, 18], wi: 86, nba: 'wi-086:v1', created: '10-29 14:19:30', ap: '10-30 09:28', handoff: '10-30 09:29', url: 'https://org62.example.com/lightning/o/Event/new?smplBatch=1026' },
  { key: 'oh-week-1102', label: 'Org62 Solutions Events: week of 11/02 (13 events)', events: [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], wi: 87, created: '11-06 09:50', ap: '11-06 10:08', handoff: '11-06 10:09', url: 'https://org62.example.com/lightning/o/Event/new?smplBatch=1102' },
];
