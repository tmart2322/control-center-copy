/**
 * COMPATIBILITY SHIM. CONTRACT-1 folded these optional extensions into the scanner contract
 * (`src/scanner/types.ts`). Import from there in new code; these names stay so existing imports keep
 * compiling. The `*Ext` / `*With*` aliases are now the contract types themselves.
 */
import type { Candidate, OpenItemDigest, ScannerStore, SkillRunResult } from '../types';

export type { BriefHighlightsInput, Involvement, Resolution, ResolutionFields, UnlinkedSourceItemDetail } from '../types';
export { isContextOnly, LOOP_BACK_PREFIX } from '../types';

/** = OpenItemDigest (resolution, involvement, handedOffTo and expected are contract fields now). */
export type OpenItemDigestExt = OpenItemDigest;

/** = ScannerStore (recordBriefHighlights is required there). */
export type ScannerStoreWithBriefs = ScannerStore;

/** = Candidate (resolution fields and state are contract fields now). */
export type CandidateExt = Candidate;

/** = SkillRunResult (complete and counts are contract fields now). */
export type ScanSkillRunResult = SkillRunResult;
