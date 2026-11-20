import {
  CAPABILITY_KEYS,
  GMAIL_CLIP_BYTES,
  SLACK_TEXT_LIMIT,
  type CapabilityKey,
  type CapabilityProfile,
  type Destination,
  type DocNode,
  type ProfileId,
  type SlackDestination,
} from './types';

const all = (v: boolean): Record<CapabilityKey, boolean> =>
  Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, v])) as Record<CapabilityKey, boolean>;

const slackBase = { ...all(true), heading: false, table: false };

export const PROFILES: Record<ProfileId, CapabilityProfile> = {
  slack_mrkdwn: {
    id: 'slack_mrkdwn',
    label: 'Slack (mrkdwn)',
    // Lists render as `•` / `1.` text lines; no headings or tables.
    supports: { ...slackBase },
    maxBytes: SLACK_TEXT_LIMIT,
  },
  slack_blocks: {
    id: 'slack_blocks',
    label: 'Slack (rich text)',
    supports: { ...slackBase },
    maxBytes: SLACK_TEXT_LIMIT,
  },
  email_html: {
    id: 'email_html',
    label: 'Gmail (HTML)',
    supports: all(true),
    maxBytes: GMAIL_CLIP_BYTES,
  },
  plain: {
    id: 'plain',
    label: 'Plain text',
    supports: {
      ...all(false),
      bulletList: true,
      orderedList: true,
      blockquote: true,
      codeBlock: true,
      mention: true,
      hardBreak: true,
    },
  },
};

export function getProfile(id: ProfileId): CapabilityProfile {
  return PROFILES[id];
}

const LIST_OR_CODE = new Set(['bulletList', 'orderedList', 'codeBlock']);

export function docHasListOrCode(doc: DocNode): boolean {
  if (LIST_OR_CODE.has(doc.type)) return true;
  return (doc.content ?? []).some(docHasListOrCode);
}

/** Resolve the capability profile for a destination (and a doc, for Slack `auto`). */
export function profileIdFor(destination: Destination, doc?: DocNode): ProfileId {
  if (destination.kind === 'email') return 'email_html';
  if (destination.kind === 'plain') return 'plain';
  const fmt = (destination as SlackDestination).format ?? 'auto';
  if (fmt === 'mrkdwn') return 'slack_mrkdwn';
  if (fmt === 'blocks') return 'slack_blocks';
  return doc && docHasListOrCode(doc) ? 'slack_blocks' : 'slack_mrkdwn';
}

/** Capabilities the UI should use to enable/disable toolbar buttons. */
export function profileForDestination(destination: Destination, doc?: DocNode): CapabilityProfile {
  return PROFILES[profileIdFor(destination, doc)];
}

// ---------------------------------------------------------------- naming

/**
 * The API contract (`RenditionFormat`) and the DB (`rendition_format`) name renditions differently from
 * the compose profiles in one place: profile `plain` is `plain_text` there. Kept as plain strings so this
 * lib stays free of contract imports (tests pin it to the contract enum).
 */
export type RenditionFormatName = 'slack_mrkdwn' | 'slack_blocks' | 'email_html' | 'plain_text';

/** DB-only rendition formats with no compose profile of their own (see `fromRenditionFormat`). */
export type DbOnlyRenditionFormat = 'email_text' | 'canvas_markdown';

const TO_RENDITION: Record<ProfileId, RenditionFormatName> = {
  slack_mrkdwn: 'slack_mrkdwn',
  slack_blocks: 'slack_blocks',
  email_html: 'email_html',
  plain: 'plain_text',
};

/** Compose profile id → contract/DB rendition format (`plain` → `plain_text`). */
export function toRenditionFormat(id: ProfileId): RenditionFormatName {
  return TO_RENDITION[id];
}

/**
 * Contract/DB rendition format → compose profile id (`plain_text` → `plain`). The DB's `email_text` (the
 * plain alternative of an email) renders with the `plain` profile; `canvas_markdown` has no compose
 * profile and returns null, as does any unknown name.
 */
export function fromRenditionFormat(format: RenditionFormatName | DbOnlyRenditionFormat | string): ProfileId | null {
  switch (format) {
    case 'slack_mrkdwn':
    case 'slack_blocks':
    case 'email_html':
      return format;
    case 'plain_text':
    case 'email_text':
      return 'plain';
    default:
      return null;
  }
}
