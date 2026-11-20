/**
 * The confirm proof: no write tool runs without one (*tenet: Nothing leaves without approval*).
 *
 * A `DeliveryConfirmation` is minted only here, from either
 * - the explicit Outbox confirm: the confirm token from `POST /drafts/:id/preview` must equal the token the
 *   server recomputes for this exact draft version + mode + payload (`confirmDelivery`), or
 * - the approval the DataSource recorded at that confirm (db `drafts.approved_at` + `approved_content_hash`),
 *   re-checked against the current content when a queued job runs (`confirmFromApproval`).
 *
 * Proofs are tracked in a module-private WeakSet, so an object literal with the same fields is not a proof,
 * and each proof is single-use: the gateway consumes it on the write. A retry needs a fresh proof.
 *
 * The gateway also records WHICH call it spent the proof on (the hash of the exact tool call it derived from the
 * confirmed payload). A live relay that carries a write no other channel may make (the feedback post, D-56) checks
 * that hash with `assertSpentOn`, so the transport itself refuses a call that no confirmed payload produced.
 */
import type { DispatchMode } from '@/contract';

import { payloadHash } from './hash';
import type { ToolCall } from './types';

export interface DeliveryConfirmation {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly mode: DispatchMode;
  readonly payloadHash: string;
  /** `autopilot`: VDP autopilot under the autonomy policy the user turned on (D-60); every other proof is the user's. */
  readonly by: 'user' | 'autopilot';
  readonly via: 'confirm_token' | 'approval_record' | 'autonomy_policy';
  readonly at: string;
}

export class NotConfirmedError extends Error {
  override name = 'NotConfirmedError';
  readonly code = 'not_confirmed';
}

const minted = new WeakSet<DeliveryConfirmation>();
const consumed = new WeakSet<DeliveryConfirmation>();
/** Proof → the hash of the one tool call the gateway spent it on. */
const spentOn = new WeakMap<DeliveryConfirmation, string>();

function mint(c: DeliveryConfirmation): DeliveryConfirmation {
  const proof = Object.freeze({ ...c });
  minted.add(proof);
  return proof;
}

export interface ConfirmInput {
  draftId: string;
  draftVersion: number;
  mode: DispatchMode;
  payloadHash: string;
  /** The token the client sent back after the confirm dialog. */
  confirmToken: string | null | undefined;
  /** The token the server computes for the current draft version + mode + payload. */
  expectedToken: string;
  at: string;
}

/** Mint from the explicit confirm. Throws `NotConfirmedError` on a missing or mismatched token. */
export function confirmDelivery(i: ConfirmInput): DeliveryConfirmation {
  if (!i.confirmToken) throw new NotConfirmedError('No confirm: nothing is delivered without the explicit Outbox confirm');
  if (i.confirmToken !== i.expectedToken) throw new NotConfirmedError('Confirm token does not match this draft version and mode; preview again before sending');
  return mint({ draftId: i.draftId, draftVersion: i.draftVersion, mode: i.mode, payloadHash: i.payloadHash, by: 'user', via: 'confirm_token', at: i.at });
}

export interface ApprovalInput {
  draftId: string;
  draftVersion: number;
  mode: DispatchMode;
  payloadHash: string;
  /** When the user approved (null: never approved). */
  approvedAt: string | null;
  approvalMethod: string | null;
  /** The content hash at approval, and now. They must match (the draft did not change since the confirm). */
  approvedContentHash: string | null;
  currentContentHash: string;
  /** The payload hash recorded at the confirm (the job payload), and the one recomputed now. */
  confirmedPayloadHash: string | null;
  at: string;
  /**
   * D-60: for `approval_method = autonomy_policy` only, the policy's verdict for this draft re-read now
   * (src/outbox/autopilot.ts `autopilotRefusal` over the stored settings): null = it allows it, else why not.
   */
  policyRefusal?: string | null;
}

/**
 * Mint from a recorded approval (queued job path). Human approval methods count; so does VDP autopilot's autonomy
 * policy (D-60), only when the caller re-checked that policy for this very draft and it allows it.
 */
export function confirmFromApproval(i: ApprovalInput): DeliveryConfirmation {
  if (!i.approvedAt || !i.approvalMethod) throw new NotConfirmedError('Draft was never approved in the Outbox');
  const policy = i.approvalMethod === 'autonomy_policy';
  if (policy) {
    if (i.policyRefusal === undefined) throw new NotConfirmedError('An autonomy-policy approval needs the policy re-checked at delivery');
    if (i.policyRefusal !== null) throw new NotConfirmedError(i.policyRefusal);
  } else if (!['click', 'keyboard'].includes(i.approvalMethod)) throw new NotConfirmedError(`Approval method ${i.approvalMethod} is not an explicit user confirm`);
  if (!i.approvedContentHash || i.approvedContentHash !== i.currentContentHash) throw new NotConfirmedError('Draft changed after it was approved; confirm it again');
  if (!i.confirmedPayloadHash || i.confirmedPayloadHash !== i.payloadHash) throw new NotConfirmedError('Payload changed after it was confirmed; confirm it again');
  return mint({ draftId: i.draftId, draftVersion: i.draftVersion, mode: i.mode, payloadHash: i.payloadHash, by: policy ? 'autopilot' : 'user', via: policy ? 'autonomy_policy' : 'approval_record', at: i.approvedAt });
}

export function isConfirmation(c: unknown): c is DeliveryConfirmation {
  return typeof c === 'object' && c !== null && minted.has(c as DeliveryConfirmation);
}

export function isConsumed(c: DeliveryConfirmation): boolean {
  return consumed.has(c);
}

/** Throws unless `c` is a minted, unused proof for exactly this draft, mode and payload. */
export function assertConfirmedFor(c: unknown, expect: { draftId: string; mode: DispatchMode; payloadHash: string }): asserts c is DeliveryConfirmation {
  if (!isConfirmation(c)) throw new NotConfirmedError('No confirm proof: nothing is delivered without the explicit Outbox confirm');
  if (consumed.has(c)) throw new NotConfirmedError('This confirm was already used; a retry needs a new confirm');
  if (c.draftId !== expect.draftId) throw new NotConfirmedError('Confirm belongs to another draft');
  if (c.mode !== expect.mode) throw new NotConfirmedError(`Confirmed mode is ${c.mode}, not ${expect.mode}`);
  if (c.payloadHash !== expect.payloadHash) throw new NotConfirmedError('Payload differs from what was confirmed');
}

/** Mark used. Called by the gateway immediately before the write leaves, with the exact call it makes. */
export function consumeConfirmation(c: DeliveryConfirmation, call?: ToolCall): void {
  consumed.add(c);
  if (call) spentOn.set(c, payloadHash(call));
}

/**
 * For a live relay: `c` is a minted proof the gateway already spent, on exactly this call (same server, tool and
 * arguments, by content hash). Throws `NotConfirmedError` otherwise: no proof, a proof not yet spent (so not through
 * the gateway), or one spent on a different call.
 */
export function assertSpentOn(c: unknown, call: ToolCall): asserts c is DeliveryConfirmation {
  if (!isConfirmation(c)) throw new NotConfirmedError('No confirm proof reached the transport: nothing is posted without the explicit confirm');
  if (!consumed.has(c)) throw new NotConfirmedError('The confirm was not spent by the Outbox gateway');
  if (spentOn.get(c) !== payloadHash(call)) throw new NotConfirmedError('This call differs from the one the confirm was spent on');
}
