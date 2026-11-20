/** Home (design v2): pure aggregation from store entities to the HomePayload contract. */
export { buildHome, HOME_CAPS, SECTION_TITLE, PROMISE_MIN_AGE_D, FOLD_AT, OPEN_BLOCK_MIN } from './build';
export { handsOnMin, agentMin, approveMin, reauthMin } from './estimate';
export type { HomeInput } from './types';
export { nextWorkingDay, workingDayAt, type WorkingDay } from './time';
