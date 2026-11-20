/** Domain 02: hand-written Gmail traffic (customer asks, scheduling, internal, training, travel, newsletters, calendar notices). */
import { mail, type MailOpts, sig, FIRST } from './sources-lib';
import { L } from './sources-drive';

const X = (o: MailOpts) => mail(o);
const HV = { acct: 'saltmere', opp: 'saltmere-data360-poc' };
const TO = { acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion' };
const AW = { acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data' };
const NS = { acct: 'halvergate', opp: 'halvergate-route-exceptions-agent' };
const QP = { acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation' };
const BW = { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent' };
const CC = { acct: 'cascadia', opp: 'cascadia-citizen-assistant' };
const PC = { acct: 'oakhallow', opp: 'oakhallow-claims-agent' };

export function buildMail(): void {
  // ───────── Saltmere ─────────
  X({ tag: 'em-hv-sec-1', thread: 'hv-sec', d: -1, t: '14:25', from: 'hv-soojin', to: ['owner'], cc: ['ae-harbor'], subject: 'Saltmere POC: vendor security review questionnaire', ...HV, attach: ['hv-sec-q'], hasAttachment: true,
    body: `Hi Rafael,\n\nPer Priyanka's note in the channel, attached is our vendor security review questionnaire (a standard lite questionnaire plus our data residency addendum): ${L('hv-sec-q')}\n\nOur infosec lead, Imani Okafor, would like responses by Tuesday, November 24 so she can schedule the review before the December 1 architecture board. Please include your SOC report summary and a short description of how the POC org is isolated from production.\n\nLet me know if anything is unclear.\n\nSoo-jin`, gist: 'Soo-jin sends the vendor security questionnaire; responses due Tue 11/24 (SOC summary, POC isolation)' });
  X({ tag: 'em-hv-st-1', thread: 'hv-status3', d: -8, t: '16:30', from: 'owner', to: ['hv-marisol', 'hv-priyanka'], cc: ['ae-harbor'], subject: 'Saltmere POC: week 3 status', ...HV,
    body: `Marisol, Priyanka,\n\nWeek 3 status.\n\nDone: claims status journey agreed as the first scenario; synthetic member set loaded; SSO approach (staff only, SAML) agreed with Soo-jin.\nNext: blueprint outline Monday; 90-day contact-center export from your team by Friday; demo of the claims status flow Thursday.\nRisks: ingest schedule for the claims warehouse depends on the partner's availability; I will confirm dates this week.\n\nHappy to adjust format if there is something you would rather see weekly.${sig('owner')}` });
  X({ tag: 'em-hv-st-2', thread: 'hv-status3', d: -7, t: '08:50', from: 'hv-marisol', to: ['owner'], cc: ['hv-priyanka', 'ae-harbor'], subject: 'Re: Saltmere POC: week 3 status', ...HV,
    body: `Thanks Rafael, this is helpful. Priyanka and I have a question on the claim denial scenario: will the agent explain the reason for a denial, or only hand off? Our compliance group will care about the wording.\n\nMarisol`, threadSize: 2 });
  X({ tag: 'em-hv-st-3', thread: 'hv-status3', d: -7, t: '10:05', from: 'owner', to: ['hv-marisol'], cc: ['hv-priyanka', 'ae-harbor'], subject: 'Re: Saltmere POC: week 3 status', ...HV,
    body: `Good question. In the POC the agent explains the denial reason code in plain language using wording your compliance group approves, and always offers a handoff. I will send the proposed wording list Friday so compliance can review it ahead of the demo.${sig('owner')}`, threadSize: 3 });
  X({ tag: 'em-hv-st-4', thread: 'hv-status4', d: -2, t: '17:40', from: 'hv-marisol', to: ['owner'], cc: ['ae-harbor'], subject: 'Week 4 status before Thursday?', ...HV,
    body: `Hi Rafael, could you send the week 4 status before Thursday's sync? Priyanka is forwarding it to her leadership team and would like the blueprint progress called out.\n\nThanks,\nMarisol`, gist: 'Marisol asks for the week 4 status email before Thursday sync, with blueprint progress' });
  X({ tag: 'em-hv-price-1', thread: 'hv-pricing', d: -14, t: '09:55', from: 'hv-priyanka', to: ['ae-harbor'], cc: ['owner'], subject: 'Production pricing structure', ...HV,
    body: `Theo,\n\nBefore we go to our CFO, I want to understand how the production commercials would work: what is a credit, how does consumption scale with member volume, and how do we avoid surprise overages? Could Rafael walk me through it?\n\nPriyanka`, gist: 'Priyanka asks how production pricing/consumption works; asks for Rafael to explain' });
  X({ tag: 'em-hv-ptr-1', thread: 'hv-ingest', d: -21, t: '13:00', from: 'ptr-ravindra', to: ['owner'], cc: ['ae-harbor', 'se-linnea'], subject: 'Saltmere claims warehouse ingest estimate', ...HV,
    body: `Rafael,\n\nBased on the schema walkthrough, our team estimates 6 to 8 weeks for batch ingest of the claims warehouse with change capture for the last 24 months. Assumptions: read access to a replica, a named data steward on the customer side, and no more than 40 tables in scope.\n\nIf the scope grows beyond that, add roughly one week per ten tables.\n\nRavindra Kulkarni\nJuniper Quay Partners`, gist: 'Partner estimates 6-8 weeks for claims warehouse ingest (40 tables, change capture)' });
  X({ tag: 'em-hv-ptr-2', thread: 'hv-ingest', d: -21, t: '15:30', from: 'owner', to: ['ptr-ravindra'], cc: ['ae-harbor', 'se-linnea'], subject: 'Re: Saltmere claims warehouse ingest estimate', ...HV,
    body: `Thanks Ravindra. I will use 6 to 8 weeks in the blueprint and call out the assumptions. Can you confirm your team's availability for the first two weeks of December if we get a go on the board date?${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-hv-ptr-3', thread: 'hv-ingest2', d: -9, t: '11:05', from: 'ptr-ravindra', to: ['owner'], cc: ['spec-gustavo'], subject: 'Updated ingest estimate', ...HV, attach: ['hv-sizing'], hasAttachment: true,
    body: `Rafael, attached is the updated estimate with the change-capture option split out. The faster option adds cost but removes the nightly window risk. Gustavo, this feeds your consumption model.\n\nRavindra` });
  X({ tag: 'em-hv-phi', thread: 'hv-phi', d: -7, t: '14:05', from: 'hv-marisol', to: ['owner'], cc: ['hv-soojin'], subject: 'Contact-center export: a data note', ...HV, redact: ['ssn', 'ssn', 'ssn'],
    body: `Rafael, a heads-up before the export arrives: our scrub found three rows in the free-text column with a member identifier like [REDACTED:ssn] typed by a rep. Soo-jin's team is removing them before the file leaves our network. Please do not load any earlier copy you may have received.\n\nMarisol`, gist: 'Marisol warns the contact-center export had 3 rows with typed identifiers (redacted); do not load earlier copy' });
  X({ tag: 'em-hv-gareth', thread: 'hv-cio', d: -11, t: '09:30', from: 'ae-harbor', to: ['owner', 'spec-gustavo'], subject: 'Gareth (CIO) wants a 30 minute exec preview', ...HV,
    body: `Team, Gareth Llewellyn heard about the POC from Priyanka and asked for a 30 minute preview before the board. I told him we would have something concrete once the blueprint is further along. Let's plan it for the week of the 23rd or after Thanksgiving.\n\nTheo`, gist: 'Theo: Saltmere CIO Gareth wants a 30-minute exec preview before the board', toMeOverride: true });

  // ───────── Elderglen Outdoors ─────────
  X({ tag: 'em-to-1', thread: 'to-renewal', d: -23, t: '10:15', from: 'to-brendan', to: ['ae-commercial'], cc: ['owner'], subject: 'Re: Renewal and expansion proposal', ...TO,
    body: `Nadia,\n\nThanks for the proposal. We are comfortable with the renewal. On the order-status piece, my team needs to see it working before we commit, ideally with the split-shipment cases that cause most of our calls. Can Rafael show us?\n\nBrendan`, gist: 'Brendan: OK with renewal, wants to see order-status agent working (split shipments) before committing' });
  X({ tag: 'em-to-2', thread: 'to-oms', d: -1, t: '17:10', from: 'to-meiling', to: ['owner'], subject: 'OMS sandbox access for the demo', ...TO,
    body: `Hi Rafael,\n\nThe sandbox is live. Base URL: https://oms-sandbox.elderglen-outdoors.example/api/v2 (read-only scope). I will send the access details separately through our secure channel (for reference, the header format is Authorization: Bearer [REDACTED:bearer]). The endpoints you asked about are order lookup, shipment events and return status; partial refunds are not exposed in the sandbox yet.\n\nMei-Ling`, gist: 'Mei-Ling: OMS sandbox live (read-only); endpoints for orders, shipments, returns; refunds not exposed', redact: ['bearer'] });
  X({ tag: 'em-to-3', thread: 'to-oms', d: -1, t: '17:30', from: 'owner', to: ['to-meiling'], subject: 'Re: OMS sandbox access for the demo', ...TO, attach: ['to-oms'],
    body: `Thanks Mei-Ling. I will test the endpoints tonight and tomorrow morning, and confirm the integration notes here: ${L('to-oms')}\n\nPartial refunds are fine as a handoff for the demo.${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-to-4', thread: 'to-legal', d: -10, t: '09:20', from: 'ae-commercial', to: ['owner'], subject: 'FYI: renewal redlines and demo timing', ...TO,
    body: `Heads up: Brendan's legal team returned minor redlines; we are targeting signature before 11/30. He still wants the demo before they sign, so the demo is on the critical path.\n\nNadia`, gist: 'Nadia: renewal redlines minor; demo is on the critical path for signature before 11/30' });
  X({ tag: 'em-to-5', thread: 'to-yuki', d: -1, t: '09:30', from: 'deskdesk-yuki', to: ['ae-commercial'], cc: ['owner'], subject: 'Approval: Elderglen Outdoors renewal + expansion', ...TO,
    body: `Nadia, the second approval cleared this morning. The paper can go out as soon as you confirm the expansion scope. No change needed on the discount.\n\nYuki`, noise: false });

  // ───────── Yarrowdale family ─────────
  X({ tag: 'em-aw-1', thread: 'aw-followups', d: -17, t: '10:20', from: 'aw-lars', to: ['ae-harbor', 'owner'], cc: ['spec-gustavo'], subject: 'Architecture review follow-ups', ...AW,
    body: `Theo, Rafael,\n\nThank you for the session on Monday. Three follow-ups from our side: (1) how the unified individual would treat Behavioral Health, which keeps its own identity system and consent rules; (2) which EHR connectors are supported out of the box for our three instances; (3) a rough view of phasing so Constance can see sequencing before the budget review.\n\nLars`, gist: 'Lars asks 3 follow-ups: BH identity treatment, EHR connector coverage, phasing for Constance' });
  X({ tag: 'em-aw-2', thread: 'aw-followups', d: -17, t: '14:40', from: 'owner', to: ['aw-lars'], cc: ['ae-harbor', 'spec-gustavo'], subject: 'Re: Architecture review follow-ups', ...AW,
    body: `Lars,\n\n(1) We would model Behavioral Health as its own trust domain with separate consent rules; records link to the enterprise individual only with explicit consent. (2) Two of your three EHR instances have standard connectors; the third needs a partner-built one. (3) A one-page phasing view is coming next week.\n\nHappy to go deeper on any of these on Monday's call.${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-aw-3', thread: 'aw-phases', d: -9, t: '09:15', from: 'aw-constance', to: ['ae-harbor'], cc: ['owner', 'aw-lars'], subject: 'Request: one-page view of data foundation phases', ...AW,
    body: `Theo,\n\nBefore our budget review I would like a one-page view of the data foundation phases and what each delivers. Please keep it non-technical.\n\nConstance Okeke`, gist: 'Constance asks for a non-technical one-page phases view before the budget review' });
  X({ tag: 'em-aw-4', thread: 'aw-phases2', d: -2, t: '12:40', from: 'owner', to: ['aw-lars'], cc: ['ae-harbor', 'spec-gustavo'], subject: 'Yarrowdale data foundation: phases overview', ...AW, attach: ['aw-proposal'], hasAttachment: true,
    body: `Lars,\n\nAttached is the phases overview we discussed: ${L('aw-proposal')}. Please send me anything that is unclear before we share it with Constance. Slide 5 (Behavioral Health) is the one I would most like your reaction on.${sig('owner')}` });
  X({ tag: 'em-aw-mg', thread: 'awmg-referral', d: -12, t: '11:30', from: 'awm-amara', to: ['ae-harbor'], cc: ['owner'], subject: 'Referral management: our decision', acct: 'yarrowdale-mg', opp: 'yarrowdale-mg-referral',
    body: `Theo,\n\nWe have decided to build referral management in-house with our existing team and will not move forward with the agent. We appreciate the work on the pilot and the clarity from Rafael's demos. We would like to keep talking about patient engagement.\n\nAmara Diallo`, gist: 'Amara (Medical Group) declines the referral agent (lost 11/06), open to patient engagement' });
  X({ tag: 'em-aw-bh-1', thread: 'awbh-volumes', d: -9, t: '13:00', from: 'awb-hugo', to: ['owner'], subject: 'Intake triage: question about call volumes', acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake',
    body: `Rafael,\n\nBefore we go further on the intake triage idea, can you tell me what volumes the assistant is sized for? We handle about 600 intake calls a week, with a clinical review on every one.\n\nHugo Lindahl`, gist: 'Hugo (BH) asks what call volumes the intake triage assistant is sized for (600 calls/week)' });
  X({ tag: 'em-aw-bh-2', thread: 'awbh-volumes', d: -9, t: '14:20', from: 'owner', to: ['awb-hugo'], subject: 'Re: Intake triage: question about call volumes', acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake',
    body: `Hugo, 600 calls a week is well within range. The assistant would pre-sort and summarize; clinical review stays on every call. I can bring a sizing note to a call with you and Lars if useful.${sig('owner')}`, threadSize: 2 });

  // ───────── Halvergate (gone quiet) ─────────
  X({ tag: 'em-ns-1', thread: 'ns-reply', d: -24, t: '09:40', from: 'ns-anjali', to: ['owner'], cc: ['ae-commercial'], subject: 'Re: Route exceptions agent proposal', ...NS,
    body: `Rafael,\n\nThank you for the integration diagram. We have our ops summit this week and will come back to you afterwards.\n\nAnjali`, gist: 'Anjali: ops summit this week, will come back afterwards (last customer reply 10/25)' });
  X({ tag: 'em-ns-2', thread: 'ns-nudge1', d: -16, t: '09:00', from: 'owner', to: ['ns-anjali'], cc: ['ae-commercial'], subject: 'Checking in on route exceptions', ...NS,
    body: `Hi Anjali,\n\nI hope the ops summit went well. Whenever you have a moment, I would love to hear whether the route exceptions proposal landed with your leadership and whether a 30-minute call would help.${sig('owner')}`, gist: 'Rafael nudges Anjali (no reply)', lastFromMe: true });
  X({ tag: 'em-ns-3', thread: 'ns-nudge2', d: -9, t: '09:10', from: 'owner', to: ['ns-anjali'], cc: ['ae-commercial'], subject: 'Is route exceptions still on your 2026 plan?', ...NS,
    body: `Anjali, one question: is the route exceptions agent still on your 2026 plan, or should we revisit timing in Q1?\n\nEither answer is fine, I just want to plan my time well. If it helps, I can send a one-page recap of what it would change for dispatch.${sig('owner')}`, gist: 'Rafael second nudge; asks if project is still on plan, offers a one-page recap (no reply)', lastFromMe: true });
  X({ tag: 'em-ns-4', thread: 'ns-budget', d: -14, t: '12:00', from: 'ae-commercial', to: ['owner'], subject: 'Halvergate: path through ops', ...NS,
    body: `FYI, I have a call with their VP Operations assistant on Thursday to find another path in. If you have a technical angle that would resonate with Walter, tell me.\n\nNadia`, toMeOverride: true });

  // ───────── Ferrowpay ─────────
  X({ tag: 'em-qp-1', thread: 'qp-cases', d: -15, t: '14:00', from: 'qp-folasade', to: ['owner'], cc: ['ae-harbor'], subject: 'Fraud agent: sample case data', acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent',
    body: `Rafael,\n\nWe can share 500 de-identified closed cases for the fraud agent prototype, with the analyst resolution notes included. Where should our team upload them, and what format do you want?\n\nFolasade`, gist: 'Folasade offers 500 de-identified closed fraud cases for the prototype' });
  X({ tag: 'em-qp-2', thread: 'qp-cases', d: -15, t: '16:10', from: 'owner', to: ['qp-folasade'], cc: ['ae-harbor'], subject: 'Re: Fraud agent: sample case data', acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent',
    body: `Thanks Folasade. CSV or JSON lines is fine; one row per case with the resolution note as free text. I will send a secure upload link from our side tomorrow.${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-qp-3', thread: 'qp-schema', d: -13, t: '10:30', from: 'qp-renata', to: ['owner'], subject: 'Data 360 ingestion mapping questions', ...QP, attach: ['qp-schema'],
    body: `Rafael,\n\nA few questions on the transaction mapping: how do you want us to model the merchant hierarchy (parent, child, location)? And should refunds land in the same DMO as purchases with a type flag? Our draft mapping is here: ${L('qp-schema')}\n\nRenata`, gist: 'Renata asks how to model merchant hierarchy and refunds in the transaction mapping' });
  X({ tag: 'em-qp-4', thread: 'qp-schema', d: -13, t: '12:00', from: 'owner', to: ['qp-renata'], subject: 'Re: Data 360 ingestion mapping questions', ...QP,
    body: `Renata, merchant hierarchy as a self-referencing DMO (parent merchant id), and yes: refunds in the same DMO with a transaction type flag keeps analytics simpler. I updated your mapping doc with suggestions.${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-qp-5', thread: 'qp-sched', d: -3 + -1, t: '10:00', from: 'owner', to: ['qp-folasade'], cc: ['ae-harbor'], subject: 'Architecture session: Thursday or Friday?', acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent',
    body: `Folasade, we would like to run the architecture session with your fraud analysts on Thursday at 2pm MT or Friday at 10am MT. Which works better for your team?${sig('owner')}` });
  X({ tag: 'em-qp-6', thread: 'qp-sched', d: -2, t: '09:05', from: 'qp-folasade', to: ['owner'], cc: ['ae-harbor'], subject: 'Re: Architecture session: Thursday or Friday?', acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent',
    body: `Thursday at 2pm works well. Three analysts will join and I will bring two real cases to walk through.\n\nFolasade`, threadSize: 2 });
  X({ tag: 'em-qp-7', thread: 'qp-sched', d: -1, t: '07:55', from: 'owner', to: ['qp-folasade'], cc: ['ae-harbor'], subject: 'Re: Architecture session: Thursday or Friday?', acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent',
    body: `Confirmed for Thursday 2pm MT. I will send the calendar invite and a short agenda today.${sig('owner')}`, threadSize: 3 });

  // ───────── Harrowgate (storyline 5) ─────────
  X({ tag: 'em-bw-1', thread: 'bw-thanks', d: -21, t: '15:10', from: 'bw-zainab', to: ['ae-commercial'], cc: ['owner', 'se-tariq'], subject: 'Thank you for the demo', ...BW,
    body: `Nadia, Rafael,\n\nThank you for the demonstration this morning. The work order flow was exactly what my team asked for. I would like to bring in our plant managers for a second session.\n\nZainab Farouk`, gist: 'Zainab thanks for the maintenance agent demo; wants second session with plant managers' });
  X({ tag: 'em-bw-2', thread: 'bw-deck', d: -8, t: '15:50', from: 'bw-zainab', to: ['owner'], cc: ['ae-commercial'], subject: 'Could you send the deck from today?', ...BW,
    body: `Rafael, my plant managers asked for a copy of the deck from today's session, especially the plant dashboard slides. Could you send it?\n\nZainab`, gist: 'Zainab asks Rafael for the deck from the Nov 10 session' });
  X({ tag: 'em-bw-3', thread: 'bw-deck', d: -8, t: '16:20', from: 'owner', to: ['bw-zainab'], cc: ['ae-commercial'], subject: 'Re: Could you send the deck from today?', ...BW, attach: ['bw-demo'], hasAttachment: true,
    body: `Zainab, here is the deck: ${L('bw-demo')}. The dashboard slides are 7 and 8. Nadia will follow up on next steps.${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-bw-4', thread: 'bw-roster', d: -20, t: '09:00', from: 'se-tariq', to: ['owner'], subject: 'Thanks for covering Harrowgate', ...BW,
    body: `Rafael, thanks for stepping in on the Harrowgate demo. I saw the feedback from Zainab. I will mention to Nadia that you did the heavy lifting; I am not sure the opp team roster reflects it.\n\nTariq`, gist: 'Tariq thanks Rafael for the Harrowgate demo; roster may not show it', toMeOverride: true });

  // ───────── Cascadia (storyline 6) ─────────
  X({ tag: 'em-cc-1', thread: 'cc-logistics', d: -13, t: '09:35', from: 'cc-samir', to: ['ae-commercial', 'owner'], subject: 'Onsite workshop logistics', ...CC,
    body: `Nadia, Rafael,\n\nLogistics for the workshop on November 23 and 24: we have booked the training room on the second floor of the county services building, 8:00 to 17:00 both days. We will need names for badges by the 16th. Lunch is provided. Parking is available behind the building.\n\nSamir Banerjee`, gist: 'Samir confirms onsite logistics: training room 8-17 on 11/23-24, badge names by the 16th' });
  X({ tag: 'em-cc-2', thread: 'cc-logistics', d: -13, t: '11:00', from: 'owner', to: ['cc-samir'], cc: ['ae-commercial'], subject: 'Re: Onsite workshop logistics', ...CC,
    body: `Samir, thank you. Nadia sent the badge names. I will bring a laptop and a portable display; please let me know if the room has HDMI. I will send a draft agenda next week.${sig('owner')}`, threadSize: 2 });
  X({ tag: 'em-cc-3', thread: 'cc-badge', d: -6, t: '13:20', from: 'cc-samir', to: ['owner'], subject: 'Badge registration confirmation', ...CC,
    body: `Rafael, badges for you, Nadia and Gustavo are registered. Please bring a photo ID on Monday; visitors check in at the front desk.\n\nSamir` });
  X({ tag: 'em-cc-4', thread: 'cc-access', d: -2, t: '10:00', from: 'cc-samir', to: ['owner'], cc: ['ae-commercial'], subject: 'Agenda feedback and accessibility session', ...CC, attach: ['cc-agenda'],
    body: `Rafael, the agenda reads well. Two changes: add the accessibility session before lunch on Monday, and please leave 30 minutes on Tuesday for the county CIO to ask questions. ${L('cc-agenda')}\n\nSamir`, gist: 'Samir feedback on agenda: accessibility session Monday, 30 min for the county CIO Tuesday' });
  X({ tag: 'em-cc-5', thread: 'cc-flight', d: -1, t: '16:50', from: 'Skerrin Air Reservations <confirmations@skerrinair.example>', to: ['owner'], subject: 'Your itinerary: Denver to Cascadia, Sun Nov 22', ...CC, label: 'travel',
    body: `Booking reference SMPL7Q2. Passenger: Rafael Okonkwo.\nOutbound Sun Nov 22: Skerrin Air SA 1142, depart Denver 14:35, arrive Cascadia Regional 16:05.\nReturn Tue Nov 24: Skerrin Air SA 1155, depart Cascadia Regional 18:50, arrive Denver 22:10.\nFare: 412.80 USD, economy. Manage your booking on the Skerrin Air website.`, extra: { system: 'travel', status: 'booked', statusAsOf: '2026-11-17T23:50:00.000Z', itemKey: 'travel:SMPL7Q2' }, gist: 'Flight confirmation: Sun 11/22 SA1142 DEN 14:35, return Tue 11/24 SA1155 18:50' });
  X({ tag: 'em-cc-6', thread: 'cc-hotel', d: -1, t: '17:05', from: 'Larkspur Suites Reservations <reservations@larkspur-suites.example>', to: ['owner'], subject: 'Reservation confirmed: Larkspur Suites Cascadia', ...CC, label: 'travel',
    body: `Your reservation is confirmed. Check-in Sunday November 22, check-out Tuesday November 24 (2 nights). King room, 189.00 USD per night plus tax. Free cancellation until 18:00 on November 20. Confirmation SMPL-RS-4471.`, extra: { system: 'travel', status: 'booked', statusAsOf: '2026-11-18T00:05:00.000Z', itemKey: 'travel:SMPL-RS-4471' }, gist: 'Hotel confirmation: Larkspur Suites 11/22-11/24, free cancel until 11/20 18:00' });

  // ───────── Oakhallow ─────────
  X({ tag: 'em-pc-1', thread: 'pc-addendum', d: -2, t: '17:45', from: 'ae-harbor', to: ['owner'], subject: 'Oakhallow order form: addendum needs your sign-off', ...PC, attach: ['pc-order-form'],
    body: `Rafael, legal has the order form addendum ready except for section 3 (support and SLA language), which Valentina wants a technical read on: ${L('pc-order-form')}. Can you review first thing tomorrow?\n\nTheo`, gist: 'Theo: addendum section 3 (support/SLA) needs Rafael technical sign-off before Oakhallow legal' });
  X({ tag: 'em-pc-2', thread: 'pc-addendum2', d: -1, t: '08:40', from: 'owner', to: ['pc-valentina'], cc: ['ae-harbor', 'pc-corwin'], subject: 'Section 3 redline: support hours and severity 1 coverage', ...PC, attach: ['pc-order-form'], hasAttachment: true,
    body: `Valentina,\n\nI reviewed section 3 and made one change: severity 1 incidents are covered 24x7, with business-hours coverage for lower severities. Redline attached. Everything else on the technical side is fine.${sig('owner')}`, lastFromMe: true });
  X({ tag: 'em-pc-3', thread: 'pc-addendum2', d: -1, t: '17:20', from: 'pc-valentina', to: ['owner'], cc: ['ae-harbor', 'pc-corwin'], subject: 'Re: Section 3 redline: support hours and severity 1 coverage', ...PC,
    body: `Thanks Rafael. Legal has one more change to section 3: they want severity 2 response times written into the addendum, not only in Schedule B. Can you propose wording? We would like to sign next week.\n\nValentina Moretti`, threadSize: 2, gist: 'Valentina: legal wants severity 2 response times in the addendum body; proposes signing next week (reopens the order-form item)' });
  X({ tag: 'em-pc-4', thread: 'pc-pilot', d: -9, t: '10:00', from: 'pc-corwin', to: ['owner'], cc: ['ae-harbor'], subject: 'Pilot go-live feedback', acct: 'oakhallow', opp: 'oakhallow-agentforce-pilot',
    body: `Rafael,\n\nThe policy FAQ agent has been live for four weeks. Containment is at 62% and our service team likes the handoff summaries. Two requests: support for follow-up questions on policy endorsements, and a weekly digest of unanswered questions.\n\nCorwin`, gist: 'Corwin: pilot live 4 weeks, 62% containment; asks for endorsement follow-ups and a weekly unanswered digest' });

  // ───────── Watched accounts / alias / identity ─────────
  X({ tag: 'em-lg-1', thread: 'lg-brief', d: -10, t: '10:00', from: 'ae-commercial', to: ['owner', 'se-linnea'], subject: 'FYI: Voltmere outage insights status', acct: 'voltmere', opp: 'voltmere-outage-insights', noise: true,
    body: `For awareness: Petra's team shared the outage event schema and Abdullahi will join the December readout. No action needed from you, Rafael, unless Linnea needs a second SE.\n\nNadia`, toMeOverride: true });
  X({ tag: 'em-al-1', thread: 'alias-tobias', d: -5, t: '12:15', from: 'Tobias Reinhardt <tobias.reinhardt@example.org>', to: ['Solutions Desk <solutions-desk@example.com>'], subject: 'Data 360 sandbox for consultants?', conn: 'gmail-shared', label: 'alias', toMeOverride: false, noise: false,
    body: `Hello,\n\nI am an independent data consultant helping a retail marketplace client with their recommendations pipeline. Is there a way for consultants to get a Data 360 sandbox without being a customer employee? Happy to jump on a call.\n\nTobias Reinhardt`, gist: 'Tobias Reinhardt (external consultant, no account) asks the shared alias for a Data 360 sandbox' });
  X({ tag: 'em-al-2', thread: 'alias-hv', d: -4 - 1, t: '16:00', from: 'hv-soojin', to: ['Solutions Desk <solutions-desk@example.com>'], subject: 'Question on supported SAML attribute mapping', conn: 'gmail-shared', label: 'alias', acct: 'saltmere', opp: 'saltmere-data360-poc', toMeOverride: false,
    body: `Hi team,\n\nWe are preparing the SSO configuration for the Saltmere POC. Is there documentation on which SAML attributes are used to populate permission set assignments? Rafael is aware, I am asking here as well so it is not lost.\n\nSoo-jin Baek`, gist: 'Soo-jin asks the shared alias about SAML attribute to permission set mapping' });
  X({ tag: 'em-al-3', thread: 'alias-th', d: -7, t: '09:10', from: 'th-dominic', to: ['Solutions Desk <solutions-desk@example.com>'], subject: 'Technical validation plan: who owns it?', conn: 'gmail-shared', label: 'alias', acct: 'elderglen-home', opp: 'elderglen-home-personalization', toMeOverride: false,
    body: `Hello, we agreed with Nadia on a technical validation for the personalization engine. Could someone confirm who on your side owns the plan and the test data we should prepare?\n\nDominic Vasquez`, gist: 'Dominic (Elderglen Home) asks who owns the technical validation plan' });
  X({ tag: 'em-al-4', thread: 'alias-cm', d: -3 - 1, t: '15:30', from: 'cm-ngozi', to: ['Solutions Desk <solutions-desk@example.com>'], subject: 'Catalog event sample access for our contractor', conn: 'gmail-shared', label: 'alias', acct: 'contoso', toMeOverride: false, noise: true,
    body: `Hi, please grant our contractor Tobias read access to the catalog events sample we shared last week. Thanks.\n\nNgozi Eze` });

  // ───────── internal ─────────
  X({ tag: 'em-int-1', thread: 'int-q4', d: -26, t: '08:20', from: 'mgr', to: ['owner', 'se-ioana', 'se-tariq', 'se-linnea'], subject: 'Q4 SE planning: please add your top pursuits', noise: false,
    body: `Team,\n\nPlease add your top five pursuits and the help you need to the Q4 planning doc by Friday: ${L('se-planning')}. I will use it to line up coverage over Thanksgiving week.\n\nHana`, gist: 'Hana: add top 5 pursuits to Q4 SE planning doc by Friday' });
  X({ tag: 'em-int-2', thread: 'int-staff', d: -12, t: '12:00', from: 'dir-beatrix', to: ['mgr'], cc: ['owner', 'ae-harbor'], subject: 'Saltmere story for Monday staff call', ...HV,
    body: `Hana, please have Theo and Rafael prepare three slides on Saltmere for Monday: the problem, what the POC proves, and what we need from leadership. Keep it under five minutes.\n\nBeatrix`, gist: 'Beatrix asks for 3 slides on Saltmere for Monday staff call' });
  X({ tag: 'em-int-3', thread: 'int-expense', d: -9, t: '07:30', from: 'Expense Tool <expenses-noreply@finance.example>', to: ['owner'], subject: 'Reminder: 2 expense reports are open', noise: true, bulk: true,
    body: `You have 2 expense reports in draft. Reports older than 60 days cannot be submitted without manager approval.` });
  X({ tag: 'em-int-4', thread: 'int-launch', d: -15, t: '09:00', from: 'Product Updates <product-updates@marketing.example>', to: ['owner'], subject: 'What is new in Agentforce this month', noise: true, bulk: true,
    body: `This month: testing center batch runs, Data 360 fuzzy matching for addresses, and new topic templates for service agents. Read the full release notes on the enablement portal.` });
  X({ tag: 'em-int-5', thread: 'int-recruit', d: -17, t: '08:15', from: 'Talent Team <talent@recruiting.example>', to: ['owner'], subject: 'Referral bonus: Solutions Engineer openings', noise: true, bulk: true,
    body: `We are hiring Solutions Engineers in the Mountain region. Refer a candidate and earn a referral bonus.` });

  // training (mandatory)
  const lms = 'Learning Platform <learning-noreply@learning.example>';
  X({ tag: 'em-tr-1', thread: 'tr-privacy', d: -20, t: '06:05', from: lms, to: ['owner'], subject: 'Assigned: Data Handling and Privacy Refresh (due Nov 21)', bulk: true,
    body: `You have been assigned a mandatory course: Data Handling and Privacy Refresh. Estimated time: 45 minutes. Due date: November 21, 2026. Start now from your learning dashboard.`, extra: { mandatory: true, system: 'lms', status: 'assigned', statusAsOf: '2026-10-29T12:05:00.000Z', itemKey: 'training:privacy-refresh-2026' }, gist: 'LMS assigns mandatory Data Handling and Privacy Refresh, due 11/21 (45 min)' });
  X({ tag: 'em-tr-2', thread: 'tr-privacy-r1', d: -10, t: '06:05', from: lms, to: ['owner'], subject: 'Reminder: Data Handling and Privacy Refresh due in 11 days', bulk: true,
    body: `Your mandatory course Data Handling and Privacy Refresh is not complete. Due date: November 21, 2026.`, extra: { mandatory: true, system: 'lms', status: 'in_progress', statusAsOf: '2026-11-08T13:05:00.000Z', itemKey: 'training:privacy-refresh-2026' } });
  X({ tag: 'em-tr-3', thread: 'tr-privacy-r2', d: -3 - 1, t: '06:05', from: lms, to: ['owner'], subject: 'Final reminder: Data Handling and Privacy Refresh due Nov 21', bulk: true,
    body: `Your mandatory course Data Handling and Privacy Refresh is still incomplete (progress 40%). It is due November 21, 2026. After the due date your manager will be notified.`, extra: { mandatory: true, system: 'lms', status: 'in_progress', statusAsOf: '2026-11-14T13:05:00.000Z', itemKey: 'training:privacy-refresh-2026' }, gist: 'LMS final reminder: privacy refresh at 40%, due 11/21' });
  X({ tag: 'em-tr-4', thread: 'tr-privacy-r3', d: 0, t: '06:05', from: lms, to: ['owner'], subject: 'Due in 3 days: Data Handling and Privacy Refresh', bulk: true,
    body: `Your mandatory course Data Handling and Privacy Refresh is due November 21, 2026 (progress 40%).`, extra: { mandatory: true, system: 'lms', status: 'in_progress', statusAsOf: '2026-11-18T13:05:00.000Z', itemKey: 'training:privacy-refresh-2026' } });
  X({ tag: 'em-tr-5', thread: 'tr-cert', d: -16, t: '11:00', from: 'Certification Program <certs-noreply@learning.example>', to: ['owner'], subject: 'Your Data 360 specialist certification renews in 60 days', noise: true, bulk: true,
    body: `Your Data 360 Specialist certification expires on January 14, 2027. Complete the release exam before then to renew.` });

  // newsletters / bot noise
  const news = 'Industry News Digest <digest@industry-news.example>';
  for (const [i, d] of [-26, -19, -12, -5, 0].entries()) X({ tag: `em-nl-${i + 1}`, thread: `nl-${i}`, d, t: '06:30', from: news, to: ['owner'], subject: `Weekly Data and AI Digest: issue ${40 + i}`, noise: true, bulk: true, gist: 'Industry newsletter (ignored sender)',
    body: `This week: retail media consolidation, payer automation rules, logistics exception handling, and a roundup of conference talks. Unsubscribe anytime.` });
  const subjects = ['Webinar: Building trusted agents with your data', 'Partner summit registration is open', 'Your weekly team digest', 'Invitation: Data 360 customer showcase', 'Reminder: SE community call tomorrow', 'New enablement course: agent testing fundamentals'];
  for (const [i, s] of subjects.entries()) X({ tag: `em-mk-${i + 1}`, thread: `mk-${i}`, d: -27 + i * 5, t: '10:10', from: 'Enablement Updates <enablement@marketing.example>', to: ['owner'], subject: s, noise: true, bulk: true, gist: `Marketing/enablement mail: ${s}`,
    body: `${s}. Register or read more on the enablement portal. This message was sent to the Solutions Engineering mailing list.` });
  for (const [i, d] of [-22, -11, -2].entries()) X({ tag: `em-tp-${i + 1}`, thread: `tp-${i}`, d, t: '07:00', from: 'Travel Portal <noreply@travel-portal.example>', to: ['owner'], subject: 'Your travel profile: upcoming trip suggestions', noise: true, bulk: true, gist: 'Travel portal bulk notice (ignored sender)',
    body: `Plan your next trip with exclusive fares. Update your preferences to receive fewer messages.` });

  // Gemini notes notifications and calendar notices (noise from the inbox's point of view)
  const calNotices: Array<[string, number, string, string]> = [
    ['Invitation: Dry run: Saltmere blueprint walkthrough @ Fri Nov 20, 10:00am - 11:00am (MST)', -3 - 1 - 1, '14:00', 'Theo Brandt invited you to Dry run: Saltmere blueprint walkthrough.'],
    ['Updated invitation: Saltmere weekly sync @ Tue Nov 24, 11:00am - 11:45am (MST)', -2, '09:12', 'Theo Brandt changed the time of Saltmere weekly sync.'],
    ['Invitation: Cascadia onsite workshop day 1 @ Mon Nov 23, 8:00am - 5:00pm (MST)', -12, '10:40', 'Nadia Quraishi invited you to Cascadia onsite workshop day 1.'],
    ['Accepted: 1:1 with Hana @ Thu Nov 19, 2:00pm - 2:30pm (MST)', -6, '08:00', 'Hana Lindqvist accepted this invitation.'],
    ['Invitation: Elderglen Outdoors order status demo @ Thu Nov 19, 10:00am - 11:00am (MST)', 0, '07:52', 'Nadia Quraishi invited you to Elderglen Outdoors order status demo (tentative hold).'],
    ['Declined: Halvergate route exceptions check-in @ Mon Nov 9, 3:00pm - 3:30pm (MST)', -9, '16:30', 'Anjali Rao declined this invitation.'],
    ['Updated invitation: Ferrowpay architecture session @ Thu Nov 19, 2:00pm - 3:00pm (MST)', -1, '08:03', 'Theo Brandt added Folasade Adeyemi and 2 guests.'],
  ];
  for (const [i, [subject, d, t, body]] of calNotices.entries()) X({ tag: `em-cal-${i + 1}`, thread: `cal-${i}`, d, t, from: 'Calendar <calendar-notification@example.com>', to: ['owner'], subject, noise: true, bulk: true, calendarNotice: true, gist: `Calendar notice: ${subject.slice(0, 70)}`, body });
  void FIRST;
}
