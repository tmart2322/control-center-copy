/**
 * Work that waits for a logging canvas and is not a row (2026-11-13 audit C2): DC requests (approved, not on a canvas
 * yet) and VDP use cases (creates and Stage / Go-Live fixes) that ride on the next canvas with rows. One count, read
 * by the server (the sidebar Time badge in navCounts, Home ▸ Log & fix) and the client (Time ▸ Log it's Ready stop),
 * so no surface reads "done" or "Nothing" while they wait. Pure.
 */
import type { DcRequest, UseCaseSyncPayload } from '@/contract';

/** A DC request waiting for a canvas: approved, not on one yet (Deals ▸ DCs "Requested"). */
export const isDcWaiting = (r: Pick<DcRequest, 'status' | 'stage'>): boolean => r.status === 'approved' && r.stage === 'waiting';

export function dcWaitingCount(requests: ReadonlyArray<Pick<DcRequest, 'status' | 'stage'>>): number {
  return requests.filter(isDcWaiting).length;
}

/** VDP use cases waiting for a canvas: the creates and the Stage / Go-Live fixes (getUseCaseSync counts). */
export function ucWaitingCount(counts: Pick<UseCaseSyncPayload['counts'], 'create' | 'update'> | null | undefined): number {
  return counts ? counts.create + counts.update : 0;
}

export interface WaitingForCanvas {
  dcs: number;
  useCases: number;
}

export const NO_WAITING: WaitingForCanvas = { dcs: 0, useCases: 0 };
