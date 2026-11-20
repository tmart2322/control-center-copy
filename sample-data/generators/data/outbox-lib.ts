/** Shared helpers for domain 05 (outbox, time logging, Claude sessions). Everything is deterministic. */
import { addMinutes, at, readTable, sha, slackUser, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';

export { addMinutes, sha, uid };
export const U = uid;

/** 'MM-DD HH:MM[:SS]' (Mountain Time, 2026) to an ISO instant. */
export function T(s: string): string {
  const m = /^(\d\d)-(\d\d) (\d\d:\d\d(?::\d\d)?)$/.exec(s);
  if (!m) throw new Error(`bad MT stamp ${s}`);
  const off = Math.round((Date.UTC(2026, Number(m[1]) - 1, Number(m[2])) - Date.UTC(2026, 10, 18)) / 86_400_000);
  return at(off, m[3]!);
}
/** ISO to 'MM-DD HH:MM' in MT (UTC-7). */
export const mtLabel = (iso: string) => new Date(new Date(iso).getTime() - 7 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');
export const mtDay = (iso: string) => new Date(new Date(iso).getTime() - 7 * 3600_000).toISOString().slice(0, 10);
export const plusMin = (iso: string, m: number) => addMinutes(iso, m);
/** Clock part 'HH:MM' on the same MT day as `base` (an MT stamp). */
export const sameDay = (base: string, hhmm: string) => `${base.slice(0, 5)} ${hhmm}`;

export const doc = (paras: string[]) => ({ type: 'doc', content: paras.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
export const docText = (d: { content: Array<{ content?: Array<{ text: string }> }> }) => d.content.map((p) => (p.content ?? []).map((x) => x.text).join('')).join('\n\n');
export const html = (paras: string[]) => paras.map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('\n');

/** Slack user number per person key (CAST.md). */
export const SLACK_N: Record<string, number> = {
  owner: 1, mgr: 2, 'ae-harbor': 3, 'ae-commercial': 4, 'se-ioana': 5, 'se-tariq': 6, 'se-linnea': 7, 'spec-gustavo': 8, 'dir-beatrix': 9, 'csm-femi': 10,
  'deskdesk-yuki': 11, 'ptr-ravindra': 12, 'hv-marisol': 21, 'hv-priyanka': 22, 'hv-soojin': 23, 'aw-lars': 24, 'awm-amara': 25, 'awb-hugo': 26, 'to-brendan': 27,
  'to-meiling': 28, 'th-dominic': 29, 'ns-anjali': 30, 'qp-folasade': 31, 'qp-renata': 32, 'bw-henrik': 33, 'bw-zainab': 34, 'cc-samir': 35, 'pc-corwin': 36, 'cm-ngozi': 37, 'ext-tobias': 38,
};
export const slackOf = (p: string) => slackUser(SLACK_N[p]!);

type Maps = {
  si: Map<string, Row>; siById: Map<string, string>; siByExt: Map<string, Row>; people: Map<string, Row>; peopleKeyById: Map<string, string>;
  wiNum: Map<string, number>; calendar: Map<string, Row>; calTagById: Map<string, string>; nba: Map<string, Row>; wi: Map<number, Row>; org62: Map<string, Row>;
  opp: Map<string, Row>; oppKeyById: Map<string, string>; acct: Map<string, Row>; acctKeyById: Map<string, string>;
};
let cache: Maps | null = null;
export function maps(): Maps {
  if (cache) return cache;
  const si = new Map<string, Row>(); const siById = new Map<string, string>(); const siByExt = new Map<string, Row>();
  const sis = readTable('source_items');
  const byId = new Map(sis.map((r) => [r.id as string, r]));
  for (let i = 1; i <= 751; i++) { const k = `si-${String(i).padStart(3, '0')}`; const r = byId.get(uid('source_items', k)); if (r) { si.set(k, r); siById.set(r.id as string, k); } }
  for (const r of sis) siByExt.set(`${r.source}:${r.external_id}`, r);
  const people = new Map<string, Row>(); const peopleKeyById = new Map<string, string>();
  const pRows = readTable('people'); const pById = new Map(pRows.map((r) => [r.id as string, r]));
  for (const k of Object.keys(SLACK_N).concat(['hv-gareth', 'hv-odalys', 'aw-constance', 'awm-kofi', 'awb-rosalind', 'tg-jasmine', 'to-kwame', 'ns-walter', 'qp-isak', 'bw-henrik', 'cc-dolores', 'cc-noor', 'pc-valentina', 'lg-abdullahi', 'lg-petra', 'cm-julien', 'hv-mari-dup', 'ptr-ines'])) {
    const r = pById.get(uid('people', k)); if (r) { people.set(k, r); peopleKeyById.set(r.id as string, k); }
  }
  const wiRows = readTable('work_items'); const wiNum = new Map<string, number>(); const wi = new Map<number, Row>();
  for (let i = 1; i <= wiRows.length; i++) { const r = wiRows.find((x) => x.id === uid('work_items', `wi-${String(i).padStart(3, '0')}`)); if (r) { wiNum.set(r.id as string, i); wi.set(i, r); } }
  const calendar = new Map<string, Row>(); const calTagById = new Map<string, string>();
  const ceRows = readTable('calendar_events'); const ceById = new Map(ceRows.map((r) => [r.id as string, r]));
  void ceById;
  const nba = new Map<string, Row>(); const nbaRows = readTable('next_best_actions'); const nbaById = new Map(nbaRows.map((r) => [r.id as string, r]));
  for (const w of wi.keys()) for (let v = 1; v <= 6; v++) { const k = `wi-${String(w).padStart(3, '0')}:v${v}`; const r = nbaById.get(uid('next_best_actions', k)); if (r) nba.set(k, r); }
  const org62 = new Map<string, Row>(); const oRows = readTable('org62_events'); const oById = new Map(oRows.map((r) => [r.id as string, r]));
  for (let i = 1; i <= 45; i++) { const k = `o62-${String(i).padStart(2, '0')}`; const r = oById.get(uid('org62_events', k)); if (r) org62.set(k, r); }
  const opp = new Map<string, Row>(); const oppKeyById = new Map<string, string>();
  const acct = new Map<string, Row>(); const acctKeyById = new Map<string, string>();
  cache = { si, siById, siByExt, people, peopleKeyById, wiNum, calendar, calTagById, nba, wi, org62, opp, oppKeyById, acct, acctKeyById };
  for (const r of readTable('opportunities')) { /* keyed lazily by uid below */ void r; }
  return cache;
}

export const OPP_KEYS = ['saltmere-data360-poc', 'saltmere-claims-copilot', 'saltmere-provider-directory', 'yarrowdale-enterprise-data', 'yarrowdale-platform-renewal', 'yarrowdale-mg-patient-engagement', 'yarrowdale-bh-intake', 'elderglen-outdoors-renewal-expansion', 'elderglen-outdoors-loyalty', 'elderglen-home-personalization', 'elderglen-enterprise-identity', 'halvergate-route-exceptions-agent', 'halvergate-dispatch-data', 'ferrowpay-fraud-agent', 'ferrowpay-data360-foundation', 'harrowgate-maintenance-agent', 'harrowgate-plant-data', 'cascadia-citizen-assistant', 'cascadia-permits-data', 'oakhallow-claims-agent', 'oakhallow-underwriting-assist', 'voltmere-outage-insights', 'voltmere-service-agent', 'contoso-seller-agent', 'contoso-realtime-recs', 'saltmere-care-mgmt', 'saltmere-member-portal', 'yarrowdale-platform-renewal-fy26', 'yarrowdale-mg-data-assessment', 'elderglen-outdoors-marketing', 'elderglen-home-commerce-sync', 'halvergate-shipment-visibility', 'ferrowpay-risk-score-pilot', 'harrowgate-quality-insights', 'cascadia-resident-portal', 'oakhallow-agentforce-pilot', 'voltmere-field-service', 'contoso-support-automation', 'halvergate-yard-optimization', 'ferrowpay-collections-assistant', 'harrowgate-supplier-portal', 'cascadia-benefits-chatbot', 'oakhallow-fnol-bot', 'elderglen-home-loyalty', 'voltmere-smart-meter-data', 'contoso-ads-measurement', 'saltmere-telehealth-nurse-line', 'yarrowdale-bh-wellness', 'elderglen-outdoors-pos', 'yarrowdale-mg-referral'];
/** Org62 opportunity id: sfId('006', 1-based position in the opportunities table). */
export const oppSf = (key: string) => { const n = OPP_KEYS.indexOf(key); if (n < 0) throw new Error(`unknown opp ${key}`); return `006SMPL${String(n + 1).padStart(8, '0')}AAA`; };
export const ACCT_KEYS = ['saltmere', 'yarrowdale', 'yarrowdale-mg', 'yarrowdale-bh', 'elderglen', 'elderglen-outdoors', 'elderglen-home', 'halvergate', 'ferrowpay', 'harrowgate', 'cascadia', 'oakhallow', 'voltmere', 'contoso'];
export const acctSf = (key: string) => `001SMPL${String(ACCT_KEYS.indexOf(key) + 1).padStart(8, '0')}AAA`;
/** account key of an opportunity key (longest account prefix). */
export const acctOfOpp = (opp: string) => {
  const rows = ACCT_KEYS.filter((a) => opp.startsWith(a + '-')).sort((a, b) => b.length - a.length);
  if (opp === 'yarrowdale-platform-renewal' || opp === 'yarrowdale-enterprise-data' || opp === 'yarrowdale-platform-renewal-fy26') return 'yarrowdale';
  if (opp === 'elderglen-enterprise-identity') return 'elderglen';
  return rows[0]!;
};
export const wiKey = (n: number) => `wi-${String(n).padStart(3, '0')}`;
