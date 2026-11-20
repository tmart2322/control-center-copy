/** Domain 02: hand-written Slack traffic (channels, DMs, threads). All people, accounts and files are invented. */
import { D, ME, M, slack, type SlackOpts } from './sources-lib';
import { L } from './sources-drive';

const S = (tag: string, ch: string, d: number, t: string, who: string, text: string, o: Partial<SlackOpts> = {}) => slack({ tag, ch, d, t, who, text, ...o });
const HV = { acct: 'saltmere', opp: 'saltmere-data360-poc' };
const TO = { acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion' };
const AW = { acct: 'yarrowdale', opp: 'yarrowdale-enterprise-data' };
const NS = { acct: 'halvergate', opp: 'halvergate-route-exceptions-agent' };
const QP = { acct: 'ferrowpay', opp: 'ferrowpay-data360-foundation' };
const BW = { acct: 'harrowgate', opp: 'harrowgate-maintenance-agent' };
const CC = { acct: 'cascadia', opp: 'cascadia-citizen-assistant' };

export function buildSlack(): void {
  // ───────────── #saltmere-poc (shared with the customer; storyline 1 and 10) ─────────────
  S('sl-hvp-01', 'saltmere-poc', -30, '17:40', 'ae-harbor', `Welcome to the Saltmere POC channel, everyone. Marisol, Priyanka, Soo-jin: Rafael is your solutions engineer and your day-to-day contact for the technical work. Weekly syncs are Tuesday and Thursday at 11:00 MT, agenda and notes go in the shared folder.`, { ...HV, gist: 'Theo opens the shared POC channel; Rafael is the SE; syncs Tue/Thu 11:00 MT' });
  S('sl-hvp-02', 'saltmere-poc', -30, '17:58', 'hv-marisol', `Thanks Theo! Looking forward to it. Rafael, I will share our current member-contact data map before Tuesday so you can see where things live.`, { ...HV, thread: 'sl-hvp-01' });
  S('sl-hvp-03', 'saltmere-poc', -30, '18:20', 'owner', `Thanks Marisol, the data map will help a lot. In the first session I would like to walk through the three member journeys you listed (eligibility, claim status, find-a-provider) and agree which one the POC proves first.`, { ...HV, thread: 'sl-hvp-01' });
  S('sl-hvp-04', 'saltmere-poc', -22, '16:40', 'hv-soojin', `${ME} question for you: for the POC org, will member identities come in through our IdP, or do we create test members manually? Security will ask me this week.`, { ...HV, gist: 'Soo-jin asks how member identities enter the POC org (IdP vs manual test members)' });
  S('sl-hvp-05', 'saltmere-poc', -22, '17:15', 'owner', `Good question. Proposal: test members are loaded as synthetic records in Data 360 for the POC, and your IdP is only used for staff users (service reps) via SAML. No real member data in the POC org. I will put it in section 4 of the blueprint.`, { ...HV, thread: 'sl-hvp-04' });
  S('sl-hvp-06', 'saltmere-poc', -22, '17:31', 'hv-soojin', `That works for us. Please also state the data residency assumption in the blueprint.`, { ...HV, thread: 'sl-hvp-04' });
  S('sl-hvp-07', 'saltmere-poc', -15, '09:30', 'hv-priyanka', `Team, a note from leadership: the POC has a go/no-go checkpoint at our architecture board. We will need the solution blueprint and a working demo in front of them.`, { ...HV, gist: 'Priyanka: POC go/no-go at the architecture board; needs blueprint + demo' });
  S('sl-hvp-08', 'saltmere-poc', -12, '09:15', 'hv-marisol', `Sharing our revised KPI list for the POC: containment rate for status questions, deflection of claim-status calls, average handle time delta, and member satisfaction on the new flow. Happy to adjust. ${L('hv-kpi')}`, { ...HV, altSlack: true, files: [{ name: 'hh-poc-kpi-baseline.xlsx', mimetype: 'application/vnd.ms-excel' }], asset: 'hv-kpi', gist: 'Mari Q. (alternate Slack identity of Marisol) shares the revised POC KPI list' });
  S('sl-hvp-09', 'saltmere-poc', -12, '09:40', 'owner', `This is great, thank you. Containment and handle time are measurable from the contact-center export you mentioned. Can your team provide 90 days of that so we can baseline? I will add your list to the success criteria doc: ${L('hv-success')}`, { ...HV, thread: 'sl-hvp-08' });
  S('sl-hvp-10', 'saltmere-poc', -8, '13:10', 'ae-harbor', `Recap from today's sync: (1) claims status is the first journey, (2) Marisol's team sends the 90-day contact-center export by Friday, (3) Rafael sends a blueprint outline next Monday and the full blueprint by 11/20. Shout if I got anything wrong.`, { ...HV, gist: 'Theo recaps the 11/10 sync: claims status first, export by Fri, blueprint 11/20' });
  S('sl-hvp-11', 'saltmere-poc', -6, '15:05', 'hv-marisol', `Export is on its way. Soo-jin's team scrubbed it for PHI. Two columns are still free text but they carry no member identifiers.`, { ...HV, thread: 'sl-hvp-10' });
  S('sl-hvp-12', 'saltmere-poc', -5, '14:02', 'hv-priyanka', `${ME} can we get the solution blueprint by next Friday, 11/20? Our architecture board packet closes the following Tuesday and I want our architects to read it first.`, { ...HV, gist: 'Priyanka asks for the solution blueprint by Fri 11/20 (board packet closes 11/24)' });
  S('sl-hvp-13', 'saltmere-poc', -5, '14:10', 'ae-harbor', `Friday 11/20 works. Rafael owns it, and I will make sure the commercial side is ready alongside.`, { ...HV, thread: 'sl-hvp-12' });
  S('sl-hvp-14', 'saltmere-poc', -5, '14:28', 'owner', `Confirmed: blueprint by end of day Friday 11/20 MT. I will send an outline on Monday so Soo-jin and Marisol can react before I write the long version.`, { ...HV, thread: 'sl-hvp-12', gist: 'Rafael commits to the blueprint by EOD Fri 11/20 and an outline on Monday' });
  S('sl-hvp-15', 'saltmere-poc', -2, '15:12', 'hv-soojin', `${ME} can you confirm which of our IdP groups the POC needs to map to Agentforce permission sets? Security wants that in writing before Thursday's sync. Our current groups are in the attached sheet.`, { ...HV, files: [{ name: 'idp-groups-export.csv', mimetype: 'text/csv' }], gist: 'Soo-jin asks which IdP groups map to Agentforce permission sets; wants it in writing before Thu sync' });
  S('sl-hvp-16', 'saltmere-poc', -1, '13:20', 'hv-priyanka', `Thanks for the sync today, great discussion on the escalation path. I have asked our infosec team to send the vendor security review questionnaire to Rafael; they want answers by the 24th.`, { ...HV, gist: 'Priyanka: infosec will send the vendor security questionnaire; answers by 11/24' });
  S('sl-hvp-17', 'saltmere-poc', -1, '17:05', 'hv-marisol', `${ME} one request from our contact-center leads after today: can the next demo show a member asking about a denied claim and the agent handing off to a human rep with the case summary? That is the scenario they worry about most.`, { ...HV, gist: 'Marisol asks for a denied-claim handoff scenario in the next demo' });
  S('sl-hvp-18', 'saltmere-poc', 0, '08:20', 'hv-priyanka', `FYI the architecture board moved to Dec 1 at 9:00 MT. Same deadline for the blueprint though.`, { ...HV });

  // ───────────── #saltmere-team (internal) ─────────────
  S('sl-hvt-01', 'saltmere-team', -28, '09:12', 'ae-harbor', `Marisol confirmed they have budget set aside for FY27 and the 1.25M figure is what procurement has in their plan. Let's keep the SOW lean and show consumption clearly.`, HV);
  S('sl-hvt-02', 'saltmere-team', -28, '09:30', 'spec-gustavo', `I can do a consumption model for a 12 month ramp. ${ME} can you send me the expected volumes (member interactions, profiles unified)?`, HV);
  S('sl-hvt-03', 'saltmere-team', -28, '10:05', 'owner', `Rough volumes: 1.8M members, about 420k monthly contact-center interactions, 35% about claim status. Unified profile on roughly 1.2M active members. I will put the assumptions in the sizing sheet today.`, { ...HV, thread: 'sl-hvt-02' });
  S('sl-hvt-04', 'saltmere-team', -21, '15:40', 'se-linnea', `If the claims warehouse is on the platform they mentioned, batch ingest will take two sprints, not one. Ravindra's team can help with the estimate.`, HV);
  S('sl-hvt-05', 'saltmere-team', -9, '16:55', 'spec-gustavo', `Updated the forecast comments in the specialist sheet. Saltmere stays in best case, 70% on a December close.`, HV);
  S('sl-hvt-06', 'saltmere-team', -7, '12:30', 'mgr', `Great momentum on Saltmere. Beatrix wants to hear the story at Monday's staff call. Theo, Rafael, can you do three slides?`, { ...HV, toMe: true, gist: 'Hana: Beatrix wants Saltmere story at Monday staff call; asks for 3 slides' });
  S('sl-hvt-07', 'saltmere-team', -7, '12:44', 'ae-harbor', `On it. Rafael, send me your two favorite proof points from the last sync.`, { ...HV, thread: 'sl-hvt-06', toMe: true });
  S('sl-hvt-08', 'saltmere-team', -2, '09:35', 'se-ioana', `FYI I am seeing a similar SSO-groups question on another POC. Is there a reusable section in your blueprint template?`, { ...HV, toMe: true });
  S('sl-hvt-09', 'saltmere-team', -2, '09:50', 'owner', `Yes, section 4.2 of the template. I will link it after I clean it up.`, { ...HV, thread: 'sl-hvt-08' });
  S('sl-hvt-10', 'saltmere-team', -1, '14:10', 'ae-harbor', `The security questionnaire is coming to you from Soo-jin's team. Don't let it block the blueprint; I would do the blueprint first.`, { ...HV, toMe: true });
  S('sl-hvt-11', 'saltmere-team', 0, '07:55', 'owner', `Blueprint status: sections 1-5 drafted, section 6 (rollout plan) and the architecture diagram still open. On track for Friday. Gustavo, I need your consumption numbers by Thursday EOD. Doc: ${L('hv-blueprint')}`, { ...HV, asset: 'hv-blueprint', edited: true });
  S('sl-hvt-12', 'saltmere-team', 0, '08:12', 'spec-gustavo', `Will have them tomorrow midday.`, { ...HV, thread: 'sl-hvt-11' });

  // ───────────── DMs: Theo, Hana, Nadia; group DM ─────────────
  S('sl-dmh-01', 'dm-ae-harbor', -14, '10:22', 'ae-harbor', `Quick favor: Priyanka wants to hear how consumption pricing works. Can you jump on a call with her Thursday after the sync? She would rather hear it from you than from me.`, { ...HV, gist: 'Theo asks Rafael to explain consumption pricing to Priyanka Thursday after the sync' });
  S('sl-dmh-02', 'dm-ae-harbor', -14, '10:30', 'owner', `Sure. 11:45 Thursday? I will have the Flex Credits one-pager ready.`, HV);
  S('sl-dmh-03', 'dm-ae-harbor', -2, '18:05', 'ae-harbor', `Oakhallow order form is stuck on the technical addendum. Valentina's legal wants your sign-off on section 3 before they send it. Can you look first thing tomorrow?`, { acct: 'oakhallow', opp: 'oakhallow-claims-agent', gist: 'Theo: Oakhallow order form blocked on Rafael sign-off of addendum section 3' });
  S('sl-dmh-04', 'dm-ae-harbor', -1, '08:20', 'owner', `Looked at the addendum: one wording fix on the SLA language. I emailed Valentina the redline.`, { acct: 'oakhallow', opp: 'oakhallow-claims-agent' });
  S('sl-dmh-05', 'dm-ae-harbor', -1, '08:44', 'ae-harbor', `Thank you! Also Ferrowpay wants the architecture session Thursday or Friday. Both work for me, you pick.`, { ...QP, gist: 'Theo: Ferrowpay architecture session Thursday or Friday, Rafael picks' });
  S('sl-dmh-06', 'dm-ae-harbor', 0, '08:05', 'ae-harbor', `Can you jump on Ferrowpay Thursday at 2? Folasade's fraud analysts will join and they want to see real case examples walked through.`, { ...QP, gist: 'Theo asks Rafael to take Ferrowpay on Thursday 2pm; analysts bring real cases' });

  S('sl-dmm-01', 'dm-mgr', -30, '09:00', 'mgr', `Welcome to the first full week of Q4 planning. Let's use Thursday's 1:1 to look at your top three pursuits and where you want my help.`);
  S('sl-dmm-02', 'dm-mgr', -20, '16:05', 'mgr', `Reminder: the Data Handling & Privacy refresh is mandatory this quarter and due 11/21. Please don't leave it to the last day.`, { gist: 'Hana reminds: mandatory Data Handling & Privacy refresh due 11/21' });
  S('sl-dmm-03', 'dm-mgr', -12, '09:12', 'mgr', `Friendly reminder to review the shared logging canvas. The weekly log is due Friday and I would like the Saltmere and Ferrowpay hours in there.`, { gist: 'Hana: review the logging canvas; weekly log due Friday' });
  S('sl-dmm-04', 'dm-mgr', -6, '14:40', 'mgr', `Notes from our 1:1: (1) finish the training before Saturday, (2) Cascadia onsite approved, please book travel by Friday, (3) shadow Linnea's Ferrowpay dry run if time permits.`, { gist: 'Hana 1:1 recap: training before Sat, Cascadia onsite approved, book travel by Fri' });
  S('sl-dmm-05', 'dm-mgr', -2, '10:15', 'mgr', `Are you OK to take the Oakhallow order-form call Wednesday if Theo is out? Say no if your week is full.`, { acct: 'oakhallow', opp: 'oakhallow-claims-agent' });
  S('sl-dmm-06', 'dm-mgr', -2, '10:40', 'owner', `I can take it, but it is blueprint week. Could it be 30 minutes max?`, { acct: 'oakhallow', opp: 'oakhallow-claims-agent' });
  S('sl-dmm-07', 'dm-mgr', 0, '08:24', 'mgr', `Beatrix is joining the Saltmere sync on the 24th. I know you are onsite at Cascadia that day, want Gustavo to run it?`, { ...HV, gist: 'Hana: Beatrix joins Saltmere sync 11/24, which conflicts with Cascadia onsite; asks if Gustavo runs it' });

  S('sl-dmc-01', 'dm-ae-commercial', -22, '17:20', 'ae-commercial', `Tariq is out tomorrow. Harrowgate wants a predictive maintenance agent demo with their reliability lead, Wed 10am. Can you jump on? I will send the account brief.`, { ...BW, gist: 'Nadia asks Rafael to cover Tariq on the Harrowgate predictive-maintenance demo Wed 10am' });
  S('sl-dmc-02', 'dm-ae-commercial', -22, '17:45', 'owner', `Yes, send me the brief and any reliability data they have shared. I can reuse the plant dashboards from the quality inspection win.`, BW);
  S('sl-dmc-03', 'dm-ae-commercial', -21, '18:30', 'ae-commercial', `That demo was excellent. Zainab already asked for a follow-up with her plant managers. I will try to get it scheduled for the week of Nov 9.`, BW);
  S('sl-dmc-04', 'dm-ae-commercial', -13, '15:00', 'ae-commercial', `Halvergate: Anjali still isn't replying to me either. Any luck on your side?`, { ...NS, gist: 'Nadia: Halvergate champion Anjali not replying to anyone' });
  S('sl-dmc-05', 'dm-ae-commercial', -13, '15:12', 'owner', `Nothing since her Oct 25 note. I sent two nudges, no replies.`, NS);
  S('sl-dmc-06', 'dm-ae-commercial', -9, '10:05', 'ae-commercial', `Harrowgate follow-up is Tuesday 11/10 at 1pm with the plant managers. Same demo but with the plant scenarios? Tariq can't make it again.`, { ...BW, edited: true, gist: 'Nadia asks Rafael to run the second Harrowgate demo Tue 11/10 1pm' });
  S('sl-dmc-07', 'dm-ae-commercial', -9, '10:12', 'owner', `I will adapt the demo with plant dashboards. Do you want me on the opp team? I am demoing for them twice now.`, BW);
  S('sl-dmc-08', 'dm-ae-commercial', -9, '10:40', 'ae-commercial', `Let's talk to Tariq first, he is the SE of record. I will flag the team roster.`, { ...BW, gist: 'Nadia defers adding Rafael to the Harrowgate opp team (Tariq is SE of record)' });
  S('sl-dmc-09', 'dm-ae-commercial', -8, '17:40', 'ae-commercial', `Zainab loved it. She will push for budget by the end of the month. I will keep you posted.`, BW);
  S('sl-dmc-10', 'dm-ae-commercial', -2, '16:15', 'ae-commercial', `Elderglen: see #elderglen-outdoors-deal, I posted the demo ask there. I would love to get it on Thursday.`, { ...TO, gist: 'Nadia points to the Elderglen demo ask in #elderglen-outdoors-deal; wants Thursday' });
  S('sl-dmc-11', 'dm-ae-commercial', -1, '12:10', 'ae-commercial', `Cascadia: Samir asked whether we can bring a second SE for the Monday session. Gustavo is open. Fine on your side?`, { ...CC, gist: 'Nadia: Samir asks for a second SE on Monday; Gustavo available' });
  S('sl-dmc-12', 'dm-ae-commercial', -1, '12:22', 'owner', `Fine. Gustavo's data section would help; I will send him the agenda.`, CC);

  S('sl-gdm-01', 'gdm-harbor-team', -13, '17:05', 'ae-harbor', `Priyanka asked for an executive readout in December. Hana, can Beatrix join?`, { ...HV, toMe: false });
  S('sl-gdm-02', 'gdm-harbor-team', -13, '17:20', 'mgr', `Yes. ${ME} can you outline what the readout covers by next Friday?`, { ...HV, toMe: true, gist: 'Hana asks Rafael to outline the December executive readout by next Friday' });
  S('sl-gdm-03', 'gdm-harbor-team', -6, '12:10', 'ae-harbor', `Readout date: Dec 3 at 10 MT. I will send the invite.`, HV);
  S('sl-gdm-04', 'gdm-harbor-team', -1, '18:05', 'mgr', `Great hosting today. Beatrix said the escalation-path story landed.`, HV);
  S('sl-gdm-05', 'gdm-harbor-team', 0, '07:30', 'ae-harbor', `The blueprint on Friday is the gating item for the board. Let's protect Rafael's Thursday and Friday.`, HV);

  // ───────────── Elderglen Outdoors (storyline 2) ─────────────
  S('sl-tod-01', 'elderglen-outdoors-deal', -30, '15:10', 'ae-commercial', `Renewal kickoff: the Elderglen Outdoors Data 360 renewal is up 11/30 and Brendan wants to add Agentforce order status as an expansion. Rafael, you are the SE for both parts.`, { ...TO, toMe: true, gist: 'Nadia kicks off renewal + order-status expansion; Rafael is SE' });
  S('sl-tod-02', 'elderglen-outdoors-deal', -23, '11:00', 'ae-commercial', `Pricing for the renewal plus expansion is in. Yuki, can you confirm the discount is inside your approval band?`, TO);
  S('sl-tod-03', 'elderglen-outdoors-deal', -23, '11:25', 'deskdesk-yuki', `8% on the renewal is inside my band. The expansion lines need a second approval since combined ACV tops 750k. I will route it.`, { ...TO, thread: 'sl-tod-02' });
  S('sl-del-1', 'elderglen-outdoors-deal', -12, '10:40', 'ae-commercial', `Pricing sheet for the wrong deal, ignore: ${L('qp-estimate')}`, { ...TO, asset: 'qp-estimate', gist: 'Nadia posts the wrong pricing sheet link in the Elderglen channel and deletes it', noise: true });
  S('sl-tod-04', 'elderglen-outdoors-deal', -16, '09:40', 'csm-femi', `Usage on their Data 360 instance is up 31% quarter over quarter, so the renewal story is strong. I will pull a usage chart for Brendan.`, TO);
  S('sl-tod-05', 'elderglen-outdoors-deal', -9, '16:20', 'ae-commercial', `Brendan got legal feedback on the renewal paper. Redlines are minor. Still targeting signature before 11/30.`, TO);
  S('sl-tod-06', 'elderglen-outdoors-deal', -2, '14:20', 'ae-commercial', `${ME} Brendan wants to see an Agentforce order-status demo before they sign the renewal. Can you do Thursday 11/19 or Friday 11/20? Mei-Ling will join for integration questions. He would like to see tracking for a split shipment.`, { ...TO, files: [{ name: 'tod-demo-asks.png', mimetype: 'image/png' }], gist: 'Nadia asks Rafael for an Agentforce order-status demo for Brendan, Thu 11/19 or Fri 11/20, split-shipment scenario' });
  S('sl-tod-07', 'elderglen-outdoors-deal', -2, '14:42', 'csm-femi', `Mei-Ling confirmed the OMS sandbox is up, that was blocking her earlier.`, { ...TO, thread: 'sl-tod-06' });
  S('sl-tod-08', 'elderglen-outdoors-deal', -1, '09:05', 'deskdesk-yuki', `Expansion approval cleared. Paper can go out once Nadia confirms scope.`, TO);
  S('sl-tod-09', 'elderglen-outdoors-deal', -1, '10:12', 'ae-commercial', `${ME} any thoughts on timing for the demo? Brendan is asking.`, { ...TO, thread: 'sl-tod-06', gist: 'Nadia chases Rafael on demo timing' });
  S('sl-tod-10', 'elderglen-outdoors-deal', 0, '07:48', 'ae-commercial', `${ME} Brendan pinged me again. He would love Thursday morning. Can you confirm today?`, { ...TO, thread: 'sl-tod-06', gist: 'Nadia: Brendan prefers Thursday morning; confirm today' });
  S('sl-toe-01', 'elderglen-outdoors-ext', -23, '12:00', 'to-brendan', `Thanks for the proposal. Before we finalize, can you remind us what the order-status agent would cover? Our ops team asks whether it can handle split shipments and partial refunds.`, TO);
  S('sl-toe-02', 'elderglen-outdoors-ext', -23, '12:40', 'ae-commercial', `Great questions. Rafael will cover them in a demo and we will schedule one before the paper is signed.`, { ...TO, thread: 'sl-toe-01' });
  S('sl-toe-03', 'elderglen-outdoors-ext', -23, '13:15', 'owner', `Short answer: split shipments yes, partial refunds are handled with a human handoff in the first release. I will show both in the demo.`, { ...TO, thread: 'sl-toe-01' });
  S('sl-toe-04', 'elderglen-outdoors-ext', -16, '10:30', 'to-meiling', `OMS sandbox access is with our vendor; we expect it this week.`, TO);
  S('sl-toe-05', 'elderglen-outdoors-ext', -10, '15:05', 'to-brendan', `Quick update: legal has our renewal redlines. Hope to have them back to Nadia early next week.`, TO);
  S('sl-toe-06', 'elderglen-outdoors-ext', -1, '16:20', 'to-meiling', `${ME} the sandbox is live. I can give you read access for the demo; who should I send the details to?`, { ...TO, gist: 'Mei-Ling: OMS sandbox is live, asks where to send read access details' });
  S('sl-toe-07', 'elderglen-outdoors-ext', -1, '16:40', 'owner', `Thanks Mei-Ling, please send them to me by email and I will wire up the demo connection tomorrow.`, { ...TO, thread: 'sl-toe-06' });

  // ───────────── Yarrowdale family (storyline 4) ─────────────
  S('sl-alw-01', 'yarrowdale-team', -28, '14:00', 'ae-harbor', `Yarrowdale architecture review series starts Monday; Lars will bring their data team lead. Gustavo and Rafael on our side.`, AW);
  S('sl-alw-02', 'yarrowdale-team', -23, '15:10', 'owner', `Notes from today's session: they run three EHR instances across the hospitals, and the Behavioral Health group keeps its own identity system. That affects the foundation scope.`, AW);
  S('sl-alw-03', 'yarrowdale-team', -23, '15:30', 'spec-gustavo', `That means the unified individual model has to treat BH as a separate trust domain. We should say that explicitly in the proposal.`, { ...AW, thread: 'sl-alw-02' });
  S('sl-alw-04', 'yarrowdale-team', -16, '10:20', 'se-linnea', `Heads up: the Medical Group referral work may color the conversation. I would acknowledge it and focus on the foundation.`, AW);
  S('sl-alw-05', 'yarrowdale-team', -9, '11:45', 'ae-harbor', `Constance asked for a one-page view of the phases. ${ME} and Gustavo own it by Wednesday.`, { ...AW, toMe: true, gist: 'Theo: Constance wants a one-page phases view; Rafael and Gustavo own it by Wednesday' });
  S('sl-alw-06', 'yarrowdale-team', -6, '16:30', 'owner', `Question for the team: on the VDP, should Behavioral Health intake sit under the Yarrowdale Health System company or its own? I lean toward the parent since Lars sponsors it, but BH has its own budget.`, { ...AW, acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake', gist: 'Rafael asks whether BH intake VDP sits under parent company or its own' });
  S('sl-alw-07', 'yarrowdale-team', -6, '16:50', 'ae-harbor', `Parent for now, we can split later. Rule of thumb from deal desk: subsidiaries get their own VDP only when they have their own contract.`, { ...AW, acct: 'yarrowdale-bh', opp: 'yarrowdale-bh-intake', thread: 'sl-alw-06' });
  S('sl-alw-08', 'yarrowdale-team', -2, '13:15', 'owner', `Posted the phases one-pager in the folder, feedback welcome before Constance sees it: ${L('aw-proposal')}`, { ...AW, asset: 'aw-proposal' });
  S('sl-alw-09', 'yarrowdale-team', -1, '09:30', 'spec-gustavo', `Read it. Phase 2 sizing looks light for the integration work; suggest a 20% buffer.`, { ...AW, thread: 'sl-alw-08' });

  // ───────────── Halvergate (storyline 3: gone quiet) ─────────────
  S('sl-nsf-01', 'halvergate-freight', -30, '11:00', 'ae-commercial', `Route exceptions agent proposal is in Anjali's hands. She said she would review with ops leadership this week.`, NS);
  S('sl-nsf-02', 'halvergate-freight', -26, '16:25', 'owner', `I sent Anjali the follow-up with the integration diagram: ${L('ns-proposal')}. No reply yet.`, { ...NS, asset: 'ns-proposal' });
  S('sl-nsf-03', 'halvergate-freight', -24, '10:10', 'ae-commercial', `Anjali replied: ops summit this week, she will come back to us after. Close date is still Nov 12.`, { ...NS, gist: 'Nadia: Anjali defers until after ops summit (last customer contact 10/25)' });
  S('sl-nsf-04', 'halvergate-freight', -16, '09:05', 'owner', `Nudged Anjali again by email. Nothing back.`, NS);
  S('sl-nsf-05', 'halvergate-freight', -14, '11:20', 'ae-commercial', `There is a rumor of a budget freeze on Walter's side. Careful. I will try a different path through ops.`, { ...NS, gist: 'Nadia: rumored budget freeze at Halvergate' });
  S('sl-nsf-06', 'halvergate-freight', -7, '09:40', 'ae-commercial', `Close date is Nov 12 on paper. Realistically this is slipping. I will update Org62 once I have a signal.`, NS);
  S('sl-nsf-07', 'halvergate-freight', -5, '10:00', 'ae-commercial', `${ME} close date passed with no reply. Marking this at risk. OK to send a short value-recap nudge?`, { ...NS, gist: 'Nadia: Halvergate close date passed, at risk; asks Rafael to send a value-recap nudge' });
  S('sl-nsf-08', 'halvergate-freight', -5, '10:25', 'owner', `Yes, I will draft it. Keep it light: a one-page recap and an open question about the outcome of their ops summit.`, { ...NS, thread: 'sl-nsf-07' });

  // ───────────── Cascadia (storyline 6) ─────────────
  S('sl-cco-01', 'cascadia-onsite', -14, '13:00', 'ae-commercial', `Samir confirmed the onsite workshop: Mon-Tue 11/23-24, 8:00 to 5:00 at the county services building. We will cover the citizen assistant design and the permits data discussion.`, { ...CC, gist: 'Nadia: Cascadia onsite workshop confirmed Mon-Tue 11/23-24 8:00-5:00' });
  S('sl-cco-02', 'cascadia-onsite', -14, '13:20', 'owner', `Great. I will fly in Sunday. Do we need badge pre-registration?`, { ...CC, thread: 'sl-cco-01' });
  S('sl-cco-03', 'cascadia-onsite', -13, '09:05', 'ae-commercial', `Yes, Samir's team needs names 5 business days before. I sent mine and yours. They also asked for laptop MAC addresses; I told them we would use guest Wi-Fi.`, { ...CC, thread: 'sl-cco-01' });
  S('sl-cco-04', 'cascadia-onsite', -9, '15:30', 'owner', `Draft workshop agenda is in the folder: ${L('cc-agenda')}. Day 1 is discovery on service channels and the data inventory; Day 2 is design and the demo.`, { ...CC, asset: 'cc-agenda' });
  S('sl-cco-05', 'cascadia-onsite', -8, '10:00', 'ae-commercial', `Samir likes it. He wants to add a 30-minute session on accessibility requirements.`, CC);
  S('sl-cco-06', 'cascadia-onsite', -6, '11:20', 'se-ioana', `Offering my accessibility checklist from the Northwind project in case it helps.`, CC);
  S('sl-cco-07', 'cascadia-onsite', -2, '16:00', 'owner', `Travel: flights booked for Sunday afternoon, hotel is two blocks from the county building. Receipts to follow.`, { ...CC, gist: 'Rafael: Cascadia flights Sunday 11/22, hotel booked' });
  S('sl-cco-08', 'cascadia-onsite', -1, '15:45', 'ae-commercial', `Samir sent the final attendee list: 14 people, including the county CIO on day 2 for the readout.`, CC);

  // ───────────── Ferrowpay ─────────────
  S('sl-qpp-01', 'ferrowpay-pursuit', -27, '10:00', 'ae-harbor', `Ferrowpay: Folasade confirmed the fraud agent proof of concept scope. Solution design stage, target close 1/19.`, { ...QP, opp: 'ferrowpay-fraud-agent' });
  S('sl-qpp-02', 'ferrowpay-pursuit', -20, '14:05', 'se-linnea', `I can run a dry run of the architecture session with you Friday if you want a second pair of eyes.`, { ...QP, opp: 'ferrowpay-fraud-agent', toMe: true });
  S('sl-qpp-03', 'ferrowpay-pursuit', -13, '11:10', 'owner', `Renata sent sample transaction schemas. Mapping to Data 360 DMOs looks clean except for the merchant hierarchy.`, QP);
  S('sl-qpp-04', 'ferrowpay-pursuit', -9, '16:00', 'ae-harbor', `The Ferrowpay Data 360 foundation proposal goes to procurement 11/12. Deal desk, please confirm the credits math.`, QP);
  S('sl-qpp-05', 'ferrowpay-pursuit', -7, '09:30', 'deskdesk-yuki', `Credits math checked, one correction: the third-year uplift is 5%, not 3%. Sheet updated: ${L('qp-estimate')}`, { ...QP, asset: 'qp-estimate' });
  S('sl-qpp-06', 'ferrowpay-pursuit', -2, '11:00', 'owner', `Architecture session with Ferrowpay: proposing Thursday 2pm or Friday 10am. Folasade's analysts will bring real case examples.`, { ...QP, opp: 'ferrowpay-fraud-agent' });
  S('sl-qpp-07', 'ferrowpay-pursuit', -1, '17:00', 'ae-harbor', `Thursday it is. 2pm MT.`, { ...QP, opp: 'ferrowpay-fraud-agent', thread: 'sl-qpp-06' });

  // ───────────── old pursuit channel (archived) ─────────────
  S('sl-ppc-01', 'oakhallow-pursuit-2025', -30, '09:30', 'ae-harbor', `This pursuit channel is retired now that the pilot is live; please use the main account space. It will be archived soon.`, { acct: 'oakhallow' });
  S('sl-ppc-02', 'oakhallow-pursuit-2025', -29, '09:40', 'bot:Channel Janitor', `This channel has had no activity for 60 days and will be archived on request.`, { acct: 'oakhallow', noise: true });

  // ───────────── team channels ─────────────
  S('sl-set-01', 'se-team', -26, '11:00', 'mgr', `Reminder: the Q4 SE planning doc is open for comments until Friday. Please add your top 5 pursuits.`, { toMe: true, gist: 'Hana: add your top 5 pursuits to Q4 SE planning doc by Friday' });
  S('sl-set-02', 'se-team', -18, '13:20', 'se-ioana', `Anyone have a reusable architecture diagram for zero-copy access to a warehouse? Happy to trade for my retail demo kit.`);
  S('sl-set-03', 'se-team', -18, '14:05', 'owner', `I have a sanitized one from Saltmere, will drop it in the shared kit folder.`, { thread: 'sl-set-02' });
  S('sl-set-04', 'se-team', -12, '10:15', 'se-tariq', `New Agentforce demo kit v2.3 is in the folder: ${L('se-demokit')}. Changes: order status skill, refreshed sample data.`, { asset: 'se-demokit' });
  S('sl-set-05', 'se-team', -5, '15:00', 'se-linnea', `Lessons from the Ferrowpay dry run: start with the fraud analyst workflow, not the architecture.`, { acct: 'ferrowpay' });
  S('sl-set-06', 'se-team', -3 + -1, '09:00', 'mgr', `Heads up for the SE team sync Wednesday: we will walk through Q4 pursuit coverage and who needs a second pair of hands over Thanksgiving week.`, { noise: false });
  S('sl-dss-01', 'data-ai-specialists', -28, '09:45', 'spec-gustavo', `Release notes this week: Data 360 identity resolution rulesets now support fuzzy match on address; the Agentforce testing center adds batch runs.`, { noise: true });
  S('sl-dss-02', 'data-ai-specialists', -21, '10:00', 'spec-gustavo', `Office hours Thursday 3pm for POC architecture questions.`, { noise: true });
  S('sl-dss-03', 'data-ai-specialists', -14, '09:40', 'spec-gustavo', `New consumption calculator version includes Flex Credits for agent actions. Please use v4 for any estimates.`, { noise: true });
  S('sl-dss-04', 'data-ai-specialists', -8, '09:35', 'spec-gustavo', `Reminder: use the shared DMO naming conventions in blueprints; reviewers flag deviations.`, { noise: true });
  S('sl-dss-05', 'data-ai-specialists', -2, '10:20', 'owner', `Does anyone have a good example of a claims status agent topic definition?`, { acct: 'saltmere' });
  S('sl-dss-06', 'data-ai-specialists', -2, '10:35', 'spec-gustavo', `Check the Oakhallow pilot repo, the topic instructions are sanitized there.`, { acct: 'oakhallow', thread: 'sl-dss-05', toMe: true });
  S('sl-dss-07', 'data-ai-specialists', 0, '08:05', 'spec-gustavo', `Heads up: partner enablement session Dec 3, sign-up link is in the calendar invite.`, { noise: true });

  S('sl-ann-01', 'company-announcements', -29, '08:00', 'bot:Company Announcements', `Q4 kickoff recording is now available. Please watch before the end of the month.`, { noise: true });
  S('sl-ann-02', 'company-announcements', -22, '08:00', 'bot:Company Announcements', `Benefits enrollment window opens Monday and closes Nov 20.`, { noise: true });
  S('sl-ann-03', 'company-announcements', -15, '09:00', 'bot:Company Announcements', `Security reminder: report phishing from the toolbar button; do not forward suspicious messages.`, { noise: true });
  S('sl-ann-04', 'company-announcements', -8, '08:00', 'bot:Company Announcements', `Holiday schedule for late November is posted on the people portal.`, { noise: true });
  S('sl-ann-05', 'company-announcements', -2, '10:30', 'bot:Company Announcements', `Town hall on Dec 3. Submit questions ahead of time using the form.`, { noise: true });
  S('sl-ann-06', 'company-announcements', 0, '08:00', 'bot:Company Announcements', `Reminder: mandatory annual training is due by Nov 21 for anyone still showing as incomplete.`, { noise: true, gist: 'Company-wide reminder on mandatory training due 11/21' });

  S('sl-ddh-01', 'deal-desk-help', -25, '10:00', 'ae-commercial', `Question: does a renewal with an expansion line need a separate approval path?`, { noise: true });
  S('sl-ddh-02', 'deal-desk-help', -25, '10:30', 'deskdesk-yuki', `Yes, combined ACV above 750k needs a second approval. Use the new intake form.`, { noise: true, thread: 'sl-ddh-01' });
  S('sl-ddh-03', 'deal-desk-help', -11, '09:15', 'deskdesk-yuki', `Quote approvals are taking two business days this week. Please plan accordingly.`, { noise: true });
  S('sl-ddh-04', 'deal-desk-help', -4, '14:00', 'ae-harbor', `Does anyone know the current approved language for consumption true-up? Looking for the clause library link.`, { noise: true });
  S('sl-ddh-05', 'deal-desk-help', 0, '08:20', 'deskdesk-yuki', `Year-end freeze: new nonstandard terms need approval by Dec 10.`, { noise: true });

  S('sl-inn-01', 'industry-news', -29, '07:30', 'bot:Industry News Digest', `Retail media networks are expanding; three regional chains announced loyalty data partnerships this week.`, { noise: true });
  S('sl-inn-02', 'industry-news', -23, '07:30', 'bot:Industry News Digest', `Healthcare payers push for prior-authorization automation ahead of new rules.`, { noise: true });
  S('sl-inn-03', 'industry-news', -16, '07:30', 'bot:Industry News Digest', `Logistics operators invest in exception-handling automation as peak season starts.`, { noise: true });
  S('sl-inn-04', 'industry-news', -9, '07:30', 'bot:Industry News Digest', `Insurance claims triage: early adopters report faster cycle times with agent-assisted workflows.`, { noise: true });
  S('sl-inn-05', 'industry-news', -3, '07:30', 'bot:Industry News Digest', `Public sector digital services: counties explore citizen-facing assistants.`, { noise: true });
  S('sl-inn-06', 'industry-news', 0, '07:30', 'bot:Industry News Digest', `Utilities outage analytics gain regulatory attention after storm season.`, { noise: true });

  S('sl-sdr-01', 'se-demo-requests', -27, '13:00', 'bot:Demo Request Form', `New demo request: regional grocery chain wants a loyalty personalization demo. Anyone available the week of Nov 2?`, { noise: true });
  S('sl-sdr-02', 'se-demo-requests', -19, '15:20', 'ae-commercial', `Need a retail demo for Elderglen Outdoors' parent group stakeholders, anyone with spare time?`, { acct: 'elderglen', noise: true });
  S('sl-sdr-03', 'se-demo-requests', -13, '11:10', 'bot:Demo Request Form', `New demo request: freight broker, route exception handling. Covered by Nadia's team.`, { noise: true });
  S('sl-sdr-04', 'se-demo-requests', -6, '14:30', 'bot:Demo Request Form', `New demo request: county government, citizen services assistant.`, { noise: true, acct: 'cascadia' });
  S('sl-sdr-05', 'se-demo-requests', -1, '10:45', 'se-ioana', `Taking the grocery chain demo, thanks all.`, { noise: true });

  S('sl-ccf-01', 'cc-feedback', -17, '16:00', 'owner', `Bug: Home shows a done item as overdue after a late reply reopened it. Steps: close a work item, then reply in the thread within an hour.`, { gist: 'Posted by the app on Rafael\'s Send: bug about a reopened item showing overdue' });
  S('sl-ccf-02', 'cc-feedback', -10, '09:20', 'owner', `Idea: let the weekly brief group highlights by account family, so the Yarrowdale subsidiaries read as one story.`, { gist: 'Posted by the app on Rafael\'s Send: idea for brief grouping by account family' });
  S('sl-ccf-03', 'cc-feedback', -3 - 1, '11:05', 'owner', `Bug: the scan for Gmail shows 0 new items right after a rate limit, but nothing is wrong on the Gmail side.`, { gist: 'Posted by the app on Rafael\'s Send: bug about scan showing 0 new items after a rate limit' });

  // ───────────── watched and shared accounts (storyline 10, 14, 18) ─────────────
  S('sl-con-01', 'contoso-marketplace', -20, '10:00', 'ae-commercial', `Welcome Ngozi and team. This channel is for the seller support agent and recommendations workstreams.`, { acct: 'contoso', noise: true });
  S('sl-con-02', 'contoso-marketplace', -19, '14:30', 'cm-ngozi', `Thanks Nadia. Our seller support volume spikes ahead of the holiday sale, so timing matters.`, { acct: 'contoso', noise: true });
  S('sl-con-03', 'contoso-marketplace', -12, '11:00', 'ext:Tobias Reinhardt', `Hi all, I am Tobias, an independent data consultant helping Ngozi's team with the recommendations pipeline. Looking forward to working with you.`, { acct: 'contoso', noise: true, gist: 'Tobias Reinhardt (external consultant, no account) introduces himself in the Contoso channel' });
  S('sl-con-04', 'contoso-marketplace', -12, '11:20', 'cm-ngozi', `Tobias is joining as our contractor. He will need read access to the catalog events sample.`, { acct: 'contoso', noise: true });
  S('sl-con-05', 'contoso-marketplace', -6, '15:00', 'ae-commercial', `The seller support agent proposal is with Julien. Questions welcome here.`, { acct: 'contoso', opp: 'contoso-seller-agent', noise: true });
  S('sl-con-06', 'contoso-marketplace', -1, '10:40', 'cm-ngozi', `Julien asked whether the agent can answer shipping policy questions in all our supported languages.`, { acct: 'contoso', opp: 'contoso-seller-agent', noise: true });
  S('sl-lga-01', 'voltmere-account', -24, '12:00', 'ae-commercial', `Voltmere outage insights: Petra's team shared their outage event data schema.`, { acct: 'voltmere', opp: 'voltmere-outage-insights' });
  S('sl-lga-02', 'voltmere-account', -17, '09:30', 'se-linnea', `Petra wants to see time-to-restore trends in Data 360. I will plan the discovery call.`, { acct: 'voltmere', opp: 'voltmere-outage-insights' });
  S('sl-lga-03', 'voltmere-account', -10, '15:00', 'ae-commercial', `Abdullahi, their CDO, will join the December readout.`, { acct: 'voltmere', opp: 'voltmere-outage-insights' });
  S('sl-lga-04', 'voltmere-account', -5, '10:20', 'se-linnea', `The customer service agent opp is qualified, budget not confirmed yet.`, { acct: 'voltmere', opp: 'voltmere-service-agent' });
  S('sl-lga-05', 'voltmere-account', 0, '08:18', 'ae-commercial', `Voltmere outage insights close date pushed to Feb 1.`, { acct: 'voltmere', opp: 'voltmere-outage-insights' });
  void D;
  void M;
}
