import { profileIdFor } from './profiles';
import { serializeSlackMrkdwn } from './slack-mrkdwn';
import { serializeSlackBlocks } from './slack-blocks';
import { serializeEmailHtml } from './email-html';
import { serializePlain } from './plain';
import type {
  ComposeWarning,
  Destination,
  DocNode,
  EmailPayload,
  LossyNote,
  Payload,
  PlainPayload,
  ProfileId,
  SerializeResult,
  SlackPayload,
} from './types';

export interface Serialized {
  profile: ProfileId;
  payload: Payload;
  lossy: LossyNote[];
  warnings: ComposeWarning[];
}

export function serializeFor(doc: DocNode, profile: 'slack_mrkdwn'): SerializeResult<SlackPayload>;
export function serializeFor(doc: DocNode, profile: 'slack_blocks'): SerializeResult<SlackPayload>;
export function serializeFor(doc: DocNode, profile: 'email_html'): SerializeResult<EmailPayload>;
export function serializeFor(doc: DocNode, profile: 'plain'): SerializeResult<PlainPayload>;
export function serializeFor(doc: DocNode, profile: ProfileId): SerializeResult<Payload>;
export function serializeFor(doc: DocNode, profile: ProfileId): SerializeResult<Payload> {
  switch (profile) {
    case 'slack_mrkdwn':
      return serializeSlackMrkdwn(doc);
    case 'slack_blocks':
      return serializeSlackBlocks(doc);
    case 'email_html':
      return serializeEmailHtml(doc);
    case 'plain':
      return serializePlain(doc);
  }
}

/** Serialize for a destination: payload + lossy notes + warnings. Deterministic, no ids, no clock. */
export function serialize(doc: DocNode, destination: Destination): Serialized {
  const profile = profileIdFor(destination, doc);
  const r = serializeFor(doc, profile);
  return { profile, payload: r.payload, lossy: r.lossy, warnings: r.warnings };
}

/** The exact payload object the send adapter posts. Slack: {text, blocks?}; email: {html, text}; plain: {text}. */
export function payloadFor(doc: DocNode, destination: Destination & { kind: 'slack' }): SlackPayload;
export function payloadFor(doc: DocNode, destination: Destination & { kind: 'email' }): EmailPayload;
export function payloadFor(doc: DocNode, destination: Destination & { kind: 'plain' }): PlainPayload;
export function payloadFor(doc: DocNode, destination: Destination): Payload;
export function payloadFor(doc: DocNode, destination: Destination): Payload {
  return serialize(doc, destination).payload;
}

/** Lossy-conversion list shown when the user switches the destination chip. */
export function lossyForSwitch(doc: DocNode, to: Destination): LossyNote[] {
  return serialize(doc, to).lossy;
}
