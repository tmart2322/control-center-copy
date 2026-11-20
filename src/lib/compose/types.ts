/**
 * LIB-compose shared types + zod schemas.
 * Own types; the orchestrator reconciles them with `src/contract` at merge.
 * Format ids match the `rendition_format` enum in DATA-MODEL (slack_mrkdwn, slack_blocks, email_html, plain_text).
 */
import { z } from 'zod';

/** Bump when any serializer output changes (stored on draft_renditions.renderer_version). */
export const RENDERER_VERSION = 'compose-1';

// ---------------------------------------------------------------------------
// TipTap / ProseMirror JSON
// ---------------------------------------------------------------------------

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}
export interface ComposeDoc extends DocNode {
  type: 'doc';
  content: DocNode[];
}

export const DocMarkSchema: z.ZodType<DocMark> = z.object({
  type: z.string().min(1),
  attrs: z.record(z.unknown()).optional(),
});
export const DocNodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    attrs: z.record(z.unknown()).optional(),
    content: z.array(DocNodeSchema).optional(),
    marks: z.array(DocMarkSchema).optional(),
    text: z.string().optional(),
  }),
);
export const ComposeDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(DocNodeSchema),
}) as unknown as z.ZodType<ComposeDoc>;

// ---------------------------------------------------------------------------
// Capability profiles
// ---------------------------------------------------------------------------

export const PROFILE_IDS = ['slack_mrkdwn', 'slack_blocks', 'email_html', 'plain'] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const CAPABILITY_KEYS = [
  'bold',
  'italic',
  'strike',
  'code',
  'codeBlock',
  'link',
  'bulletList',
  'orderedList',
  'blockquote',
  'heading',
  'table',
  'mention',
  'hardBreak',
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export interface CapabilityProfile {
  id: ProfileId;
  label: string;
  /** true = renders natively; false = toolbar disables it and a switch reports it as lossy. */
  supports: Record<CapabilityKey, boolean>;
  /** Soft size ceiling in bytes of the main payload body (undefined = none). */
  maxBytes?: number;
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

export const SlackDestinationSchema = z
  .object({
    kind: z.literal('slack'),
    /** Channel id (C…/G…) or DM conversation id (D…). */
    channelId: z.string().min(1).optional(),
    /** Thread parent ts; when set the message is a thread reply. */
    threadTs: z.string().min(1).optional(),
    /** Open a DM with this user id (U…) when there is no conversation id yet. */
    dmUserId: z.string().min(1).optional(),
    /** `auto` picks rich_text blocks when the doc has lists or code blocks. */
    format: z.enum(['auto', 'mrkdwn', 'blocks']).default('auto'),
  })
  .refine((d) => d.channelId || d.dmUserId, { message: 'slack destination needs channelId or dmUserId' });

const EmailAddr = z.string().email();
export const EmailDestinationSchema = z.object({
  kind: z.literal('email'),
  to: z.array(EmailAddr).default([]),
  cc: z.array(EmailAddr).default([]),
  bcc: z.array(EmailAddr).default([]),
  subject: z.string().default(''),
  /** RFC 5322 Message-ID being replied to. */
  inReplyTo: z.string().optional(),
});

export const PlainDestinationSchema = z.object({ kind: z.literal('plain') });

export const DestinationSchema = z.union([SlackDestinationSchema, EmailDestinationSchema, PlainDestinationSchema]);
export type SlackDestination = z.input<typeof SlackDestinationSchema>;
export type EmailDestination = z.input<typeof EmailDestinationSchema>;
export type PlainDestination = z.input<typeof PlainDestinationSchema>;
export type Destination = SlackDestination | EmailDestination | PlainDestination;

// ---------------------------------------------------------------------------
// Serializer results
// ---------------------------------------------------------------------------

export interface LossyNote {
  kind: 'node' | 'mark' | 'mention' | 'link';
  from: string;
  to: string;
  count: number;
}

export interface ComposeWarning {
  code: 'broadcast_mention' | 'size_exceeded' | 'unsafe_link';
  message: string;
  count?: number;
}

export interface SerializeResult<P> {
  payload: P;
  lossy: LossyNote[];
  warnings: ComposeWarning[];
}

export type RichTextStyle = { bold?: true; italic?: true; strike?: true; code?: true };
export type RichTextElement =
  | { type: 'text'; text: string; style?: RichTextStyle }
  | { type: 'link'; url: string; text?: string; style?: RichTextStyle }
  | { type: 'user'; user_id: string; style?: RichTextStyle }
  | { type: 'channel'; channel_id: string; style?: RichTextStyle }
  | { type: 'usergroup'; usergroup_id: string; style?: RichTextStyle }
  | { type: 'broadcast'; range: 'here' | 'channel' | 'everyone' };
export type RichTextSection = { type: 'rich_text_section'; elements: RichTextElement[] };
export type RichTextBlockElement =
  | RichTextSection
  | { type: 'rich_text_preformatted'; elements: RichTextElement[] }
  | { type: 'rich_text_quote'; elements: RichTextElement[] }
  | {
      type: 'rich_text_list';
      style: 'bullet' | 'ordered';
      indent: number;
      offset?: number;
      elements: RichTextSection[];
    };
export interface SlackBlock {
  type: 'rich_text';
  elements: RichTextBlockElement[];
}

export interface SlackPayload {
  /** mrkdwn text. With `blocks` present it is only the notification fallback. */
  text: string;
  blocks?: SlackBlock[];
}
export interface EmailPayload {
  html: string;
  text: string;
}
export interface PlainPayload {
  text: string;
}
export type Payload = SlackPayload | EmailPayload | PlainPayload;

export const SLACK_TEXT_LIMIT = 40_000;
export const GMAIL_CLIP_BYTES = 102 * 1024;
