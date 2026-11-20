/**
 * Domain 02: calendar events (series and one-offs) and the Gemini meeting notes tied to them.
 * Days are offsets from Wed 2026-11-18 (0). Everything is invented.
 */
export type Resp = 'accepted' | 'declined' | 'tentative' | 'needs_action' | 'none';
export type EvDef = {
  tag: string;
  title: string;
  d: number;
  t: string;
  dur: number; // minutes
  org: string; // person key
  att: string[]; // other attendees (person keys); organizer and owner are added automatically
  opt?: string[];
  ext?: string[]; // keys into EXT (people without a person row)
  resp?: Record<string, Resp>;
  my?: Resp;
  acct?: string;
  opp?: string;
  type?: 'default' | 'focus_time' | 'out_of_office' | 'working_location';
  status?: 'confirmed' | 'tentative' | 'cancelled';
  loc?: string;
  meet?: boolean;
  allDay?: boolean;
  series?: string; // recurring series id
  attach?: string[]; // asset tags
  desc?: string;
  attendance?: 'attended' | 'missed' | 'partial' | 'not_applicable' | 'unknown';
  attReason?: string;
  map?: 'rule' | 'llm' | 'user' | 'connector';
  conf?: number;
  rule?: string;
  locked?: boolean;
  gist?: string;
};
export const EXT: Record<string, { name: string; email: string }> = {
  imani: { name: 'Imani Okafor', email: 'imani.okafor@saltmere-health.example' },
  tamsin: { name: 'Tamsin Obuya', email: 'tamsin.obuya@saltmere-health.example' },
  rudy: { name: 'Rudy Castellanos', email: 'rudy.castellanos@saltmere-health.example' },
  ottoline: { name: 'Ottoline Ramaswamy', email: 'ottoline.ramaswamy@harrowgate-mfg.example' },
  bram: { name: 'Bram Kowalski', email: 'bram.kowalski@harrowgate-mfg.example' },
  fenella: { name: 'Fenella Ashworth', email: 'fenella.ashworth@cascadiacounty.example' },
  dario: { name: 'Dario Pellegrino', email: 'dario.pellegrino@cascadiacounty.example' },
  odette: { name: 'Odette Marchand', email: 'odette.marchand@ferrowpay.example' },
  kasimir: { name: 'Kasimir Jovanovic', email: 'kasimir.jovanovic@ferrowpay.example' },
  priscilla: { name: 'Priscilla Hoang', email: 'priscilla.hoang@yarrowdale-health.example' },
};

const days = (...n: number[]) => n;
export const evTag = (base: string, d: number) => `${base}-${d < 0 ? 'm' + -d : 'p' + d}`;
export const EVENTS: EvDef[] = [];
const add = (e: Omit<EvDef, 'tag'> & { tag: string }) => EVENTS.push(e);
function series(id: string, o: Omit<EvDef, 'tag' | 'd' | 'series'>, ds: number[], per?: (d: number) => Partial<EvDef>) {
  for (const d of ds) add({ ...o, ...(per ? per(d) : {}), tag: evTag(id, d), d, series: id });
}

// ───────────── recurring series ─────────────
series('standup', { title: 'SE team standup', t: '08:30', dur: 15, org: 'mgr', att: ['se-ioana', 'se-tariq', 'se-linnea'], my: 'accepted', meet: true, attendance: 'not_applicable' }, days(-30, -28, -26, -23, -21, -19, -16, -14, -12, -9, -7, -5, -2, 0, 2, 5, 7), (d) => (d === 5 || d === -26 ? { my: 'declined' } : {}));
series('se-sync', { title: 'SE team sync', t: '10:00', dur: 60, org: 'mgr', att: ['se-ioana', 'se-tariq', 'se-linnea', 'spec-gustavo', 'csm-femi'], my: 'accepted', meet: true, map: 'rule', conf: 0.9, rule: 'kw-1on1' }, days(-28, -21, -14, -7, 0, 7));
series('one-on-one', { title: '1:1 with Hana', t: '14:00', dur: 30, org: 'mgr', att: [], my: 'accepted', meet: true }, days(-27, -20, -13, -6, 1));
series('hv-sync', { title: 'Saltmere weekly sync', t: '11:00', dur: 45, org: 'ae-harbor', att: ['hv-marisol', 'hv-soojin'], opt: ['spec-gustavo', 'hv-priyanka', 'ptr-ravindra'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.97, rule: 'meet-saltmere-sync' }, days(-29, -27, -22, -20, -15, -13, -8, -6, -1, 1, 6), (d) => ({ ...(d === -20 ? { my: 'declined', attendance: 'missed' as const, attReason: 'Declined (customer training), notes arrived' } : {}), ...(d === 6 ? { opt: ['spec-gustavo', 'hv-priyanka', 'ptr-ravindra', 'dir-beatrix'], my: 'tentative' as const } : {}) }));
series('aw-arch', { title: 'Yarrowdale architecture review', t: '13:00', dur: 60, org: 'ae-harbor', att: ['spec-gustavo', 'aw-lars'], opt: ['aw-constance'], ext: ['priscilla'], my: 'accepted', meet: true, acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'llm', conf: 0.82 }, days(-23, -16, -9, -2, 5), (d) => (d === 5 ? { my: 'declined' } : {}));
series('qp-sync', { title: 'Ferrowpay pursuit sync', t: '15:00', dur: 30, org: 'ae-harbor', att: ['qp-folasade', 'qp-renata'], opt: ['se-linnea'], my: 'accepted', meet: true, acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation', map: 'llm', conf: 0.8 }, days(-21, -14, -7, 0, 7));
series('pc-sync', { title: 'Oakhallow negotiation sync', t: '15:30', dur: 30, org: 'ae-harbor', att: ['pc-corwin'], opt: ['pc-valentina'], my: 'accepted', meet: true, acct: 'oakhallow', opp: 'oakhallow-claims-agent', map: 'rule', conf: 0.9 }, days(-23, -16, -9, -2));
series('to-sync', { title: 'Elderglen Outdoors renewal sync', t: '15:00', dur: 30, org: 'ae-commercial', att: ['to-brendan'], opt: ['to-meiling', 'csm-femi'], my: 'accepted', meet: true, acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.95, rule: 'title-tod-renewal' }, days(-20, -13, -6, 1));


// extra recurring: pipeline review, weekly time log, Saltmere debrief
series('pipeline-review', { title: 'Pipeline review (SE + AEs)', t: '09:00', dur: 30, org: 'mgr', att: ['ae-harbor', 'ae-commercial', 'se-ioana', 'se-tariq', 'se-linnea'], my: 'accepted', meet: true }, days(-23, -16, -9, -2, 5), (d) => (d === 5 ? { my: 'declined' } : {}));
series('weekly-log', { title: 'Weekly time log (Org62)', t: '16:00', dur: 30, org: 'owner', att: [], my: 'accepted', type: 'focus_time' }, days(-26, -19, -12, -5, 2));
series('hv-debrief', { title: 'Saltmere debrief with Theo', t: '12:00', dur: 20, org: 'owner', att: ['ae-harbor'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.85 }, days(-15, -8, -1));

// ───────────── Saltmere (storyline 1) ─────────────
add({ tag: 'hv-kickoff', title: 'Saltmere POC kickoff', d: -30, t: '10:00', dur: 60, org: 'ae-harbor', att: ['spec-gustavo', 'hv-marisol', 'hv-priyanka', 'hv-soojin', 'ptr-ravindra'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.97, rule: 'title-saltmere-poc' });
add({ tag: 'hv-datamodel', title: 'Saltmere data model workshop', d: -28, t: '13:00', dur: 120, org: 'owner', att: ['ae-harbor', 'spec-gustavo', 'hv-marisol', 'hv-soojin'], ext: ['tamsin'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.96, rule: 'title-saltmere-poc', attach: ['hv-dm'] });
add({ tag: 'hv-pricing', title: 'Saltmere: production pricing walkthrough', d: -13, t: '11:45', dur: 30, org: 'ae-harbor', att: ['hv-priyanka'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.9, attach: ['se-flex'] });
add({ tag: 'hv-claimsdemo', title: 'Saltmere claims status demo for contact-center leads', d: -6, t: '13:00', dur: 45, org: 'owner', att: ['ae-harbor', 'hv-marisol'], ext: ['tamsin', 'rudy'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'rule', conf: 0.95, attach: ['hv-demo-script'] });
add({ tag: 'hv-execprep', title: 'Saltmere executive readout prep (internal)', d: -12, t: '14:00', dur: 45, org: 'ae-harbor', att: ['spec-gustavo'], opt: ['mgr'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.88 });
add({ tag: 'hv-readout-outline', title: 'Readout outline working session', d: -9, t: '15:00', dur: 60, org: 'owner', att: ['ae-harbor'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.7, desc: 'Outline the December executive readout; conflicts with the Oakhallow sync at 15:30.' });
add({ tag: 'hv-dryrun', title: 'Dry run: Saltmere blueprint walkthrough', d: 2, t: '10:00', dur: 60, org: 'ae-harbor', att: ['spec-gustavo', 'se-linnea'], opt: ['mgr'], my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.92, attach: ['hv-blueprint'] });
add({ tag: 'hv-security', title: 'Saltmere security review walkthrough', d: 7, t: '13:00', dur: 60, org: 'owner', att: ['hv-soojin', 'ae-harbor'], ext: ['imani'], resp: { 'hv-soojin': 'accepted', 'ae-harbor': 'accepted' }, my: 'accepted', meet: true, acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.9, attach: ['hv-sec-q'] });
add({ tag: 'hv-prep-cancel', title: 'Prep: Saltmere sync', d: -8, t: '10:30', dur: 20, org: 'owner', att: ['spec-gustavo'], my: 'accepted', status: 'cancelled', acct: 'saltmere', opp: 'saltmere-data360-poc', map: 'llm', conf: 0.7 });

// ───────────── Yarrowdale family (storyline 4) ─────────────
add({ tag: 'aw-kickoff', title: 'Yarrowdale enterprise data foundation kickoff', d: -30, t: '14:00', dur: 60, org: 'ae-harbor', att: ['spec-gustavo', 'aw-lars'], opt: ['aw-constance'], my: 'accepted', meet: true, acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'llm', conf: 0.83 });
add({ tag: 'aw-mg-disc', title: 'Yarrowdale Medical Group patient engagement discovery', d: -14, t: '11:00', dur: 60, org: 'ae-harbor', att: ['awm-amara', 'awm-kofi'], my: 'accepted', meet: true, acct: 'yarrowdale-mg', opp: 'yarrowdale-mg-patient-engagement', map: 'llm', conf: 0.84 });
add({ tag: 'aw-mg-decision', title: 'Referral agent decision call', d: -12, t: '15:00', dur: 30, org: 'ae-harbor', att: ['awm-amara'], my: 'accepted', meet: true, acct: 'yarrowdale-mg', opp: 'yarrowdale-mg-referral', map: 'llm', conf: 0.8 });
add({ tag: 'aw-bh-intro', title: 'Behavioral Health intake triage intro', d: -6, t: '16:00', dur: 30, org: 'owner', att: ['awb-hugo', 'aw-lars'], my: 'accepted', meet: true, acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake', map: 'llm', conf: 0.74, gist: 'Intro call where VDP company identity (parent vs BH) came up' });
add({ tag: 'aw-phases', title: 'Phases one-pager review (internal)', d: -8, t: '15:00', dur: 30, org: 'owner', att: ['ae-harbor', 'spec-gustavo'], my: 'accepted', meet: true, acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data', map: 'llm', conf: 0.8, attach: ['aw-proposal'] });

// ───────────── Elderglen family (storylines 2, 4) ─────────────
add({ tag: 'to-kickoff', title: 'Elderglen Outdoors renewal kickoff', d: -30, t: '11:00', dur: 30, org: 'ae-commercial', att: ['to-brendan', 'csm-femi'], my: 'accepted', meet: true, acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.95, rule: 'title-tod-renewal' });
add({ tag: 'to-legal', title: 'Renewal terms call', d: -9, t: '11:00', dur: 30, org: 'ae-commercial', att: ['to-brendan'], opt: ['to-meiling'], resp: {}, my: 'tentative', meet: true, acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.95, attendance: 'missed', attReason: 'Tentative; no notes and Gemini did not join' });
add({ tag: 'to-demo', title: 'Elderglen Outdoors order status demo', d: 1, t: '10:00', dur: 60, org: 'ae-commercial', att: ['to-brendan', 'to-meiling'], my: 'tentative', status: 'tentative', meet: true, acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'rule', conf: 0.96, attach: ['to-demo'], resp: { 'to-brendan': 'needs_action', 'to-meiling': 'needs_action' }, desc: 'Hold for the Agentforce order status demo requested in #elderglen-outdoors-deal; not yet confirmed by the owner.' });
add({ tag: 'to-demoprep', title: 'Prep: order status demo', d: 0, t: '15:30', dur: 90, org: 'owner', att: [], my: 'accepted', type: 'focus_time', acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', map: 'llm', conf: 0.7, attach: ['to-demo'] });
add({ tag: 'th-kick', title: 'Elderglen Home technical validation kickoff', d: -12, t: '10:30', dur: 60, org: 'ae-commercial', att: ['th-dominic'], my: 'accepted', meet: true, acct: 'elderglen-home', opp: 'elderglen-home-personalization', map: 'llm', conf: 0.86 });
add({ tag: 'th-valid', title: 'Personalization validation working session', d: -15, t: '14:00', dur: 60, org: 'owner', att: ['th-dominic', 'ae-commercial'], my: 'accepted', meet: true, acct: 'elderglen-home', opp: 'elderglen-home-personalization', map: 'llm', conf: 0.85, attach: ['th-persona'] });
add({ tag: 'tg-identity', title: 'Elderglen identity resolution discovery', d: -14, t: '14:00', dur: 60, org: 'ae-commercial', att: ['tg-jasmine', 'th-dominic'], opt: ['to-brendan'], resp: { 'tg-jasmine': 'tentative' }, my: 'accepted', meet: true, acct: 'elderglen', opp: 'elderglen-enterprise-identity', map: 'llm', conf: 0.72, attach: ['tg-identity'] });

// ───────────── Halvergate (storyline 3) ─────────────
add({ tag: 'ns-walk', title: 'Halvergate route exceptions proposal walkthrough', d: -28, t: '15:00', dur: 60, org: 'ae-commercial', att: ['ns-anjali'], my: 'accepted', meet: true, acct: 'halvergate', opp: 'halvergate-route-exceptions-agent', map: 'rule', conf: 0.95, attach: ['ns-proposal'], gist: 'Last customer meeting with Anjali before she went quiet' });
add({ tag: 'ns-checkin', title: 'Halvergate route exceptions check-in', d: -9, t: '15:00', dur: 30, org: 'owner', att: ['ns-anjali', 'ae-commercial'], resp: { 'ns-anjali': 'declined' }, my: 'accepted', meet: true, acct: 'halvergate', opp: 'halvergate-route-exceptions-agent', map: 'rule', conf: 0.95, attendance: 'missed', attReason: 'Customer declined; nobody joined' });
add({ tag: 'ns-nudge-cancel', title: 'Halvergate nudge call with Nadia', d: -2, t: '11:00', dur: 30, org: 'ae-commercial', att: [], my: 'accepted', status: 'cancelled', acct: 'halvergate', opp: 'halvergate-route-exceptions-agent', map: 'llm', conf: 0.75 });
add({ tag: 'ns-review', title: 'Halvergate close-date review (internal)', d: -5, t: '11:00', dur: 30, org: 'ae-commercial', att: [], my: 'accepted', meet: true, acct: 'halvergate', opp: 'halvergate-route-exceptions-agent', map: 'llm', conf: 0.78 });

// ───────────── Ferrowpay ─────────────
add({ tag: 'qp-data', title: 'Ferrowpay Data 360 foundation proposal review', d: -13, t: '16:00', dur: 60, org: 'ae-harbor', att: ['qp-folasade', 'qp-renata'], opt: ['qp-isak'], resp: { 'qp-isak': 'declined' }, my: 'accepted', meet: true, acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation', map: 'llm', conf: 0.82, attach: ['qp-estimate'] });
add({ tag: 'qp-procure', title: 'Ferrowpay procurement walkthrough', d: -6, t: '16:30', dur: 30, org: 'ae-harbor', att: ['qp-folasade'], ext: ['kasimir'], my: 'accepted', meet: true, acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation', map: 'llm', conf: 0.8 });
add({ tag: 'qp-arch-session', title: 'Ferrowpay architecture session with fraud analysts', d: 1, t: '14:00', dur: 90, org: 'ae-harbor', att: ['qp-folasade', 'qp-renata'], ext: ['odette', 'kasimir'], opt: ['se-linnea'], resp: { 'qp-folasade': 'accepted', 'qp-renata': 'needs_action' }, my: 'accepted', meet: true, acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', map: 'llm', conf: 0.9, attach: ['qp-arch'] });
add({ tag: 'qp-dry', title: 'Dry run: Ferrowpay architecture session', d: 0, t: '13:00', dur: 60, org: 'se-linnea', att: [], my: 'accepted', meet: true, acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', map: 'llm', conf: 0.88, attach: ['qp-arch'] });

// ───────────── Harrowgate (storyline 5) ─────────────
add({ tag: 'bw-prep', title: 'Prep: Harrowgate demo', d: -21, t: '08:00', dur: 90, org: 'owner', att: [], my: 'accepted', type: 'focus_time', acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'llm', conf: 0.7 });
add({ tag: 'bw-demo1', title: 'Harrowgate predictive maintenance demo', d: -21, t: '10:00', dur: 60, org: 'ae-commercial', att: ['bw-zainab', 'se-tariq'], my: 'accepted', meet: true, acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'rule', conf: 0.94, attach: ['bw-demo'], resp: { 'se-tariq': 'tentative' } });
add({ tag: 'bw-demo2', title: 'Harrowgate plant managers demo', d: -8, t: '13:00', dur: 60, org: 'ae-commercial', att: ['bw-zainab'], opt: ['bw-henrik', 'se-tariq'], ext: ['ottoline', 'bram'], resp: { 'se-tariq': 'declined', 'bw-henrik': 'needs_action' }, my: 'accepted', meet: true, acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', map: 'rule', conf: 0.94, attach: ['bw-demo', 'bw-dash'] });

// ───────────── Cascadia (storyline 6) ─────────────
add({ tag: 'cc-plan1', title: 'Cascadia workshop planning call', d: -13, t: '13:00', dur: 45, org: 'ae-commercial', att: ['cc-samir'], my: 'accepted', meet: true, acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.95, rule: 'meet-cascadia-onsite' });
add({ tag: 'cc-plan2', title: 'Cascadia workshop agenda review', d: -8, t: '10:00', dur: 30, org: 'owner', att: ['cc-samir', 'ae-commercial'], opt: ['cc-noor'], my: 'accepted', meet: true, acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.95, rule: 'meet-cascadia-onsite', attach: ['cc-agenda'] });
add({ tag: 'cc-travel-out', title: 'Travel: Denver to Cascadia (SA 1142)', d: 4, t: '12:35', dur: 210, org: 'owner', att: [], my: 'accepted', acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'user', conf: 1, locked: true, loc: 'Denver (DEN) to Cascadia Regional', desc: 'Airport buffer 120 min. Hotel: Larkspur Suites Cascadia.' });
add({ tag: 'cc-onsite1', title: 'Cascadia onsite workshop day 1', d: 5, t: '08:00', dur: 540, org: 'ae-commercial', att: ['cc-samir', 'spec-gustavo'], opt: ['cc-noor'], ext: ['fenella', 'dario'], resp: { 'spec-gustavo': 'accepted', 'cc-samir': 'accepted' }, my: 'accepted', acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.96, rule: 'meet-cascadia-onsite', loc: 'County Services Building, Training Room 2B, Cascadia', attach: ['cc-agenda'] });
add({ tag: 'cc-onsite2', title: 'Cascadia onsite workshop day 2', d: 6, t: '08:00', dur: 540, org: 'ae-commercial', att: ['cc-samir', 'spec-gustavo'], opt: ['cc-noor', 'cc-dolores'], ext: ['fenella', 'dario'], resp: { 'cc-dolores': 'tentative' }, my: 'accepted', acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'rule', conf: 0.96, rule: 'meet-cascadia-onsite', loc: 'County Services Building, Training Room 2B, Cascadia', attach: ['cc-agenda'] });
add({ tag: 'cc-travel-back', title: 'Travel: Cascadia to Denver (SA 1155)', d: 6, t: '17:15', dur: 295, org: 'owner', att: [], my: 'accepted', acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'user', conf: 1, locked: true, loc: 'Cascadia Regional to Denver (DEN)' });
add({ tag: 'cc-prep', title: 'Prep: Cascadia onsite', d: 2, t: '14:00', dur: 120, org: 'owner', att: [], my: 'accepted', type: 'focus_time', acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'llm', conf: 0.8, attach: ['cc-agenda'] });

// ───────────── Oakhallow ─────────────
add({ tag: 'pc-retro', title: 'Oakhallow pilot retro', d: -26, t: '13:00', dur: 60, org: 'ae-harbor', att: ['pc-valentina', 'pc-corwin'], my: 'accepted', meet: true, acct: 'oakhallow', opp: 'oakhallow-agentforce-pilot', map: 'rule', conf: 0.93, attach: ['pc-pilot'] });
add({ tag: 'pc-order', title: 'Oakhallow order form call', d: 0, t: '14:30', dur: 30, org: 'ae-harbor', att: ['pc-valentina', 'pc-corwin'], my: 'accepted', meet: true, acct: 'oakhallow', opp: 'oakhallow-claims-agent', map: 'rule', conf: 0.96, attach: ['pc-order-form'] });

// ───────────── watched accounts (owner declined / not involved) ─────────────
add({ tag: 'lg-disc', title: 'Voltmere outage insights discovery', d: -10, t: '13:00', dur: 60, org: 'se-linnea', att: ['ae-commercial', 'lg-petra'], opt: ['owner'], my: 'declined', meet: true, acct: 'voltmere', opp: 'voltmere-outage-insights', map: 'llm', conf: 0.8, attendance: 'not_applicable', desc: 'Weekend slot: Petra\'s grid operations team is on outage-response rotation during the week, so Linnea agreed to Sunday afternoon.' });
add({ tag: 'cm-walk', title: 'Contoso seller support agent proposal walkthrough', d: -5, t: '13:00', dur: 45, org: 'ae-commercial', att: ['cm-ngozi', 'cm-julien'], opt: ['owner'], my: 'declined', meet: true, acct: 'contoso', opp: 'contoso-seller-agent', map: 'llm', conf: 0.78, attendance: 'not_applicable' });

// ───────────── internal, enablement and personal ─────────────
add({ tag: 'staff-call', title: 'Regional SE staff call', d: -9, t: '10:00', dur: 30, org: 'dir-beatrix', att: ['mgr', 'ae-harbor', 'ae-commercial', 'se-ioana', 'se-tariq', 'se-linnea', 'spec-gustavo', 'csm-femi'], resp: { 'ae-commercial': 'declined', 'csm-femi': 'tentative', 'se-tariq': 'accepted' }, my: 'accepted', meet: true });
add({ tag: 'q4-planning', title: 'Q4 pursuit planning workshop', d: -19, t: '10:00', dur: 90, org: 'mgr', att: ['se-ioana', 'se-tariq', 'se-linnea', 'spec-gustavo', 'ae-harbor', 'ae-commercial'], my: 'accepted', meet: true });
add({ tag: 'office-hours-1', title: 'Data 360 office hours (Gustavo)', d: -26, t: '15:00', dur: 60, org: 'spec-gustavo', att: ['se-ioana', 'se-tariq'], opt: ['owner'], my: 'tentative', meet: true });
add({ tag: 'office-hours-2', title: 'Data 360 office hours (Gustavo)', d: -12, t: '15:00', dur: 60, org: 'spec-gustavo', att: ['se-ioana', 'se-tariq', 'se-linnea'], opt: ['owner'], my: 'accepted', meet: true, attendance: 'attended' });
add({ tag: 'testing-ws', title: 'Agentforce testing center workshop (enablement)', d: -15, t: '14:00', dur: 120, org: 'spec-gustavo', att: ['se-ioana', 'se-tariq', 'se-linnea'], my: 'accepted', meet: true, attendance: 'missed', attReason: 'Overlapped with the Elderglen Home validation session' });
add({ tag: 'team-lunch', title: 'Team lunch', d: -12, t: '12:00', dur: 60, org: 'mgr', att: ['se-ioana', 'se-tariq', 'se-linnea'], my: 'tentative', loc: 'Corner Table Cafe, downtown' });
add({ tag: 'training-hold', title: 'Training: Data Handling and Privacy Refresh (45 min)', d: 1, t: '16:00', dur: 45, org: 'owner', att: [], my: 'accepted', type: 'focus_time', desc: 'Mandatory, due Sat 11/21. 40% complete.' });
add({ tag: 'training-due', title: 'Due: Data Handling and Privacy Refresh', d: 3, t: '00:00', dur: 1440, org: 'owner', att: [], my: 'accepted', allDay: true, desc: 'Mandatory training deadline.' });
add({ tag: 'rafael-ooo-fam', title: 'Out of office: family event', d: -26, t: '00:00', dur: 1440, org: 'owner', att: [], my: 'accepted', allDay: true, type: 'out_of_office', attendance: 'not_applicable' });
add({ tag: 'rafael-dentist', title: 'Out of office: appointment', d: -19, t: '13:00', dur: 240, org: 'owner', att: [], my: 'accepted', type: 'out_of_office', attendance: 'not_applicable' });
for (const [d, loc] of [[-30, 'Home'], [-21, 'Office - Denver'], [-14, 'Home'], [-7, 'Office - Denver'], [-5, 'Home'], [0, 'Home'], [2, 'Home']] as Array<[number, string]>)
  add({ tag: evTag('wl', d), title: loc, d, t: '00:00', dur: 1440, org: 'owner', att: [], my: 'accepted', allDay: true, type: 'working_location', attendance: 'not_applicable' });
for (const d of [5, 6]) add({ tag: evTag('wl-onsite', d), title: 'Cascadia County (onsite)', d, t: '00:00', dur: 1440, org: 'owner', att: [], my: 'accepted', allDay: true, type: 'working_location', acct: 'cascadia', opp: 'cascadia-citizen-assistant', map: 'user', conf: 1, locked: true, attendance: 'unknown' });
for (const [d, t, dur, ti, o] of [[-5, '13:00', 240, 'Focus: blueprint writing', 'hv-blueprint'], [-2, '09:00', 180, 'Focus: blueprint writing', 'hv-blueprint'], [-1, '14:30', 150, 'Focus: demo build (Elderglen)', 'to-demo'], [0, '09:30', 150, 'Focus: blueprint sections 6 and 7', 'hv-blueprint'], [2, '11:00', 150, 'Focus: finish and send blueprint', 'hv-blueprint'], [-9, '13:30', 90, 'Focus: Harrowgate plant dashboards', 'bw-dash']] as Array<[number, string, number, string, string]>)
  add({ tag: evTag(`focus-${o}`, d), title: ti, d, t, dur, org: 'owner', att: [], my: 'accepted', type: 'focus_time', attach: [o], acct: o.startsWith('hv') ? 'saltmere' : o.startsWith('to') ? 'elderglen-outdoors' : 'harrowgate', opp: o.startsWith('hv') ? 'saltmere-data360-poc' : o.startsWith('to') ? 'elderglen-outdoors-renewal-expansion' : 'harrowgate-maintenance-agent', map: 'llm', conf: 0.7, attendance: d > 0 || (d === 0 && t > '09:00') ? 'unknown' : 'not_applicable' });

// ───────────── Gemini notes (storyline 12) ─────────────
export type NoteStep = { who: string[]; title: string; due?: string };
export type NoteDef = { key: string; ev: string | null; title?: string; d?: number; t?: string; summary: string; decisions: string[]; steps: NoteStep[]; dur?: number; lag?: number };
const N = (key: string, ev: string | null, summary: string, decisions: string[], steps: NoteStep[], o: Partial<NoteDef> = {}): NoteDef => ({ key, ev, summary, decisions, steps, ...o });
const st = (who: string | string[], title: string, due?: string): NoteStep => ({ who: Array.isArray(who) ? who : [who], title, due });
export const NOTES: NoteDef[] = [
  N('mn-hv-m29', evTag('hv-sync', -29), 'First weekly sync with Saltmere. The group walked through the three member journeys (eligibility, claim status, find-a-provider) and agreed to prove claim status first. Marisol will share the contact-center data map; Soo-jin raised identity and SSO as the main security topic.', ['Claim status is the first POC journey', 'Weekly syncs stay Tuesday and Thursday at 11:00 MT'], [st('hv-marisol', 'Share the contact-center data map', 'Thursday'), st('owner', 'Draft POC success criteria document', 'next Tuesday'), st('ae-harbor', 'Create the shared folder for agendas and notes', 'today')]),
  N('mn-hv-m27', evTag('hv-sync', -27), 'Reviewed the data map Marisol shared. Three systems hold member contact data and none shares a key. Discussed what synthetic members the POC needs and who can supply an export.', ['Use synthetic members in the POC org'], [st('owner', 'Propose the member key strategy for identity resolution', 'next Tuesday'), st('hv-soojin', 'Confirm whether a replica of the claims warehouse is available', 'next week')]),
  N('mn-hv-m22', evTag('hv-sync', -22), 'Soo-jin asked how identities enter the POC org. Rafael proposed synthetic members plus staff SSO only. Priyanka asked about timeline to the architecture board.', ['Staff users via SAML, members are synthetic'], [st('owner', 'Add the identity approach to blueprint section 5', 'Friday'), st('ptr-ravindra', 'Send the claims warehouse ingest estimate', 'Monday')]),
  N('mn-hv-m20', evTag('hv-sync', -20), 'Notes only (Rafael was on the privacy training call). The group reviewed the partner ingest estimate: 6 to 8 weeks for batch. Marisol raised KPIs for the POC and asked for a list by next week.', ['Keep the KPI list short (four measures)'], [st('owner', 'Send the SSO approach summary to Soo-jin', 'Friday'), st('hv-marisol', 'Send the draft KPI list', 'next Thursday')], { dur: 2310 }),
  N('mn-hv-m15', evTag('hv-sync', -15), 'Priyanka confirmed a go/no-go checkpoint at the architecture board. Discussion on what the demo must show. Marisol is preparing the revised KPI list.', ['Blueprint plus working demo are required for the board'], [st('ae-harbor', 'Confirm the board date with Priyanka', 'this week'), st('owner', 'Share blueprint outline', 'next Wednesday')]),
  N('mn-hv-m13', evTag('hv-sync', -13), 'Reviewed the revised KPI list. Agreed that containment and handle time are measurable from the contact-center export. Priyanka asked about production pricing; a separate call after the sync is set.', ['KPI list v2 accepted'], [st('owner', 'Join the pricing call with Priyanka after the sync', 'today'), st('hv-marisol', 'Ask the contact-center team for a 90-day export', 'Friday')]),
  N('mn-hv-m8', evTag('hv-sync', -8), 'Recap: claims status first, 90-day export due Friday, blueprint outline Monday, blueprint by 11/20. Soo-jin asked whether data residency needs a separate section.', ['Data residency gets its own subsection in the blueprint'], [st('owner', 'Send blueprint outline', 'Monday'), st('hv-marisol', 'Send the 90-day export', 'Friday'), st('hv-soojin', 'Send IdP group list', 'next Tuesday')]),
  N('mn-hv-m6', evTag('hv-sync', -6), 'Walked through the claims status demo for the contact-center leads. Leads liked the plain-language explanation; asked to see a denied claim next time. Export received and scrubbed.', ['Next demo includes a denied-claim handoff'], [st('owner', 'Add a denied-claim scenario to the demo script', 'next week'), st('hv-marisol', 'Confirm which leads attend the next demo', 'Tuesday')]),
  N('mn-hv-m1', evTag('hv-sync', -1), 'Discussed the escalation path from agent to human rep and the case summary content. Marisol asked for the denied-claim scenario in the demo. Priyanka will ask infosec to send the vendor questionnaire; due 11/24. SSO groups needed in writing before Thursday.', ['Handoff includes the full conversation and case summary', 'Security questionnaire due 11/24'], [st('owner', 'Confirm IdP groups to permission sets mapping in writing', 'before Thursday'), st('hv-soojin', 'Send the vendor security questionnaire', 'today'), st('owner', 'Send week 4 status email to Marisol', 'Thursday'), st('hv-marisol', 'Send contact-center leads feedback', 'Thursday')]),
  N('mn-aw-m16', evTag('aw-arch', -16), 'Yarrowdale architecture review: three EHR instances across eleven hospitals. Lars wants to know how Behavioral Health is treated. Discussion of consent rules and whether BH records link to the enterprise individual.', ['Treat Behavioral Health as a separate trust domain'], [st('owner', 'Write up BH trust domain approach', 'next Monday'), st('aw-lars', 'Send EHR instance inventory', 'Friday')]),
  N('mn-aw-m9', evTag('aw-arch', -9), 'Reviewed the EHR inventory. Third instance needs a partner-built connector. Constance wants a one-page view of phases before the budget review.', ['Partner connector for the third EHR is in scope'], [st(['owner', 'spec-gustavo'], 'Draft the one-page phases view', 'Wednesday'), st('aw-lars', 'Confirm budget review date', 'this week')]),
  N('mn-aw-m2', evTag('aw-arch', -2), 'Reviewed the phases one-pager. Lars asked for explicit treatment of Behavioral Health on its own slide. Gustavo flagged phase 2 sizing as light.', ['Add a BH slide; add 20% integration buffer'], [st('owner', 'Update the phases deck with BH slide', 'Tuesday'), st('spec-gustavo', 'Revise phase 2 sizing', 'Wednesday')]),
  N('mn-to-m13', evTag('to-sync', -13), 'Renewal sync. Usage is up 31% quarter over quarter. Brendan confirmed the renewal intent and asked whether order status can handle split shipments.', ['Renewal intent confirmed'], [st('owner', 'Send the order-status agent topic list', 'next week'), st('ae-commercial', 'Get legal redlines back by the 20th')]),
  N('mn-to-m6', evTag('to-sync', -6), 'Brendan wants a working demo of order status before signing. Mei-Ling will confirm sandbox access. Deal desk approval for expansion pending.', ['Demo before signature'], [st('owner', 'Schedule the order status demo', 'this week'), st('to-meiling', 'Confirm OMS sandbox access', 'next week')]),
  N('mn-qp-m14', evTag('qp-sync', -14), 'Ferrowpay pursuit sync. Renata sent schemas; merchant hierarchy is the open modeling question. Folasade confirmed the proof of concept scope for the fraud agent.', ['Merchant hierarchy modeled as a self-referencing DMO'], [st('owner', 'Update the mapping doc with the hierarchy approach', 'Friday'), st('qp-folasade', 'Share 500 de-identified cases', 'next week')]),
  N('mn-qp-m7', evTag('qp-sync', -7), 'Proposal sent to procurement. Deal desk corrected the third-year uplift to 5%. Architecture session with fraud analysts to be scheduled.', ['Uplift is 5% in year three'], [st('owner', 'Propose architecture session times', 'Monday'), st('ae-harbor', 'Confirm procurement timeline')]),
  N('mn-pc-m9', evTag('pc-sync', -9), 'Oakhallow negotiation sync. Order form is with legal; technical addendum needs support language review. Corwin shared pilot containment at 62%.', ['Addendum goes to Rafael for section 3'], [st('owner', 'Review addendum section 3', 'next week'), st('pc-corwin', 'Send pilot feedback in writing', 'Friday')]),
  N('mn-pc-m2', evTag('pc-sync', -2), 'Order form status: waiting on the technical addendum. Valentina wants to sign next week. Theo will be out Wednesday; Rafael to cover.', ['Rafael covers the Wednesday order form call'], [st('owner', 'Send the section 3 redline', 'tomorrow')]),
  N('mn-se-m21', evTag('se-sync', -21), 'SE team sync. Q4 coverage planning, demo kit v2.3 release, and Thanksgiving week coverage. Tariq out Wednesday; Rafael covers Harrowgate.', ['Rafael covers Harrowgate demo for Tariq'], [st('owner', 'Add top 5 pursuits to the planning doc', 'Friday'), st('se-tariq', 'Publish demo kit v2.3', 'Friday')]),
  N('mn-se-m7', evTag('se-sync', -7), 'SE team sync. Pipeline review, training reminder (privacy refresh due 11/21), and staffing for the Cascadia onsite.', ['Cascadia onsite staffed by Rafael and Gustavo'], [st('owner', 'Complete the privacy refresh training', 'before 11/21'), st('mgr', 'Approve Cascadia travel')]),
  N('mn-hana-m13', evTag('one-on-one', -13), '1:1: Saltmere momentum, Harrowgate demo work, training deadline, travel for Cascadia. Hana suggested getting onto the Harrowgate team roster if the work continues.', ['Raise Harrowgate roster question with Nadia'], [st('owner', 'Book Cascadia travel', 'by Friday'), st('owner', 'Finish privacy training', 'before Saturday')]),
  N('mn-hana-m6', evTag('one-on-one', -6), '1:1: logging canvas review, Ferrowpay dry run, and a check on workload before the onsite.', ['Prioritize Saltmere blueprint over Ferrowpay dry run'], [st('owner', 'Review the logging canvas draft', 'Friday'), st('mgr', 'Ask Nadia about the Harrowgate roster')]),
  N('mn-bw-m21', 'bw-demo1', 'Harrowgate demo of the predictive maintenance agent. Zainab asked about sensor coverage and how work orders are approved. Positive reaction to the work order flow.', ['Second session with plant managers'], [st('ae-commercial', 'Schedule plant manager session', 'week of Nov 9'), st('bw-zainab', 'Send sensor inventory', 'next week')]),
  N('mn-bw-m8', 'bw-demo2', 'Plant managers demo. Questions on scaling to 38 plants and on per-plant thresholds. Zainab will push for budget by month end.', ['Rollout in waves of five plants'], [st('owner', 'Send the deck to Zainab', 'today'), st('ae-commercial', 'Update Org62 with next steps')]),
  N('mn-cc-m13', 'cc-plan1', 'Planning call for the onsite workshop. Samir confirmed the room, badges and a 14 person attendee list. Topics: service channels, data inventory, assistant design.', ['Two-day onsite on 11/23-24'], [st('owner', 'Draft the workshop agenda', 'next week'), st('cc-samir', 'Send badge registration instructions', 'today')]),
  N('mn-cc-m8', 'cc-plan2', 'Agenda review with Samir. He wants an accessibility session added and time for the county CIO on day 2.', ['Add accessibility session'], [st('owner', 'Update the agenda doc', 'tomorrow'), st('cc-samir', 'Send final attendee list', 'next week')]),
  N('mn-th-m12', 'th-kick', 'Technical validation kickoff for the personalization engine. Dominic described the product catalog and event feeds. Agreed on a two-week validation plan.', ['Two-week technical validation'], [st('owner', 'Write the validation plan', 'next week'), st('th-dominic', 'Provide sample catalog and event data', 'Friday')]),
  N('mn-hv-pricing', 'hv-pricing', 'Priyanka walked through production pricing questions: what a credit is, how consumption scales, avoiding overages. Rafael explained Flex Credits and the ramp model.', ['Use a committed ramp with quarterly true-up'], [st('owner', 'Send the Flex Credits one-pager to Priyanka', 'today'), st('spec-gustavo', 'Share the consumption model', 'next week')]),
  N('mn-hv-datamodel', 'hv-datamodel', 'Data model workshop. Mapped member, claim, provider and encounter entities; identified the claim key as the best candidate for the unified profile join.', ['Claim key is the join candidate'], [st('owner', 'Write up the data model sketch', 'Friday'), st('hv-marisol', 'Confirm field definitions for claim status codes', 'next week')]),
  N('mn-pc-retro', 'pc-retro', 'Pilot retro. Policy FAQ agent went live; containment 58% in the first week. Customer asked for follow-up question support and a digest of unanswered questions.', ['Plan phase 2 on claims triage'], [st('ae-harbor', 'Draft the claims triage proposal', 'next month'), st('owner', 'Document the pilot topic definitions', 'Friday')]),
  N('mn-unmatched-1', null, 'Quick sync between Tariq and Rafael about the Harrowgate opp team roster and who owns the follow-up demo script. No calendar invite; started from a call.', ['Tariq will raise the roster with Nadia'], [st('se-tariq', 'Ask Nadia to review the Harrowgate team roster', 'this week')], { title: 'Impromptu call: Tariq and Rafael', d: -9, t: '09:20', dur: 1020 }),
  N('mn-unmatched-2', null, 'Ad hoc call with Linnea on the Ferrowpay dry-run format. Agreed to lead with the analyst workflow.', ['Lead with the analyst workflow'], [st('owner', 'Reorder the Ferrowpay deck', 'Friday')], { title: 'Untitled meeting', d: -5, t: '15:20', dur: 900 }),
];
void evTag;
