/**
 * Report a bug / idea (D-56): the server side. Routes in src/contract/routes.ts (`// lane D`), shared by both
 * DataSources through `FeedbackHost` (./host.ts). See ./service.ts for the flow.
 */
export { diagnoseFeedback, feedbackState, scrubReport, stageFeedback, MIN_AGENT_USD } from './service';
export { serverVersion, type FeedbackHost, type FeedbackSpend } from './host';
export { feedbackChannelFor, readTeamConfig, resolveFeedbackChannel, type TeamConfig } from './channel';
export { Scrubber, scrubTermsFrom, type ScrubTerms } from './scrub';
export { formatFeedbackMessage, firstName } from './format';
export { FEEDBACK_CAP_USD, SdkFeedbackAgent, type DiagnoseAgent } from './agent';
