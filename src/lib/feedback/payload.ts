/**
 * The `feedback.post` action (D-56): one report → one Slack message in the team's feedback channel. Pure, shared by
 * both DataSources, the UI and the Outbox adapter (src/outbox/adapters/feedback.ts).
 *
 *   input   { channelId, channelName, text, title, kind, report }   (the whole report lives here: no table of its own)
 *   payload { tool: 'slack_send_message', channel, channelName, text, title, kind }   (what the preview, the dry run
 *           and Send use; the channel is the one the server resolved, never one the client picked)
 */
import type { ActionDestination, Destination, FeedbackKind, FeedbackReport, FeedbackSettings } from '@/contract';

export interface FeedbackActionInput {
  channelId: string;
  channelName: string;
  /** The final Slack mrkdwn the user reviewed (scrubbed twice). */
  text: string;
  title: string;
  kind: FeedbackKind;
  report: FeedbackReport | null;
}

/** One Slack message; Slack takes far more, a report this long is a paste accident. */
export const FEEDBACK_MAX_CHARS = 6000;
export const FEEDBACK_CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;

export const channelLabel = (name: string, id: string) => (name ? (name.startsWith('#') ? name : `#${name}`) : id);

export function feedbackActionFor(i: FeedbackActionInput): ActionDestination {
  const where = channelLabel(i.channelName, i.channelId);
  return {
    kind: 'action',
    action: 'feedback.post',
    target: { label: where, url: null },
    input: { ...i },
    changes: [
      { label: 'Post to', before: null, after: where },
      { label: i.kind === 'idea' ? 'Idea' : 'Bug', before: null, after: i.title },
    ],
    text: i.text,
  };
}

export function feedbackInputOf(dest: Pick<ActionDestination, 'input'>): FeedbackActionInput {
  const i = dest.input as Partial<FeedbackActionInput>;
  return {
    channelId: String(i.channelId ?? ''),
    channelName: String(i.channelName ?? ''),
    text: String(i.text ?? ''),
    title: String(i.title ?? 'Feedback'),
    kind: i.kind === 'idea' ? 'idea' : 'bug',
    report: (i.report as FeedbackReport | undefined) ?? null,
  };
}

/** The exact request: one message, to the resolved channel, nothing else. */
export function feedbackActionPayload(dest: ActionDestination): Record<string, unknown> {
  const i = feedbackInputOf(dest);
  const invalid = !FEEDBACK_CHANNEL_ID.test(i.channelId)
    ? 'no feedback channel is configured (Settings ▸ Feedback, or config/team.json)'
    : !i.text.trim()
      ? 'the report is empty'
      : i.text.length > FEEDBACK_MAX_CHARS
        ? `the report is ${i.text.length} characters; one post takes at most ${FEEDBACK_MAX_CHARS}`
        : null;
  return {
    tool: 'slack_send_message',
    channel: i.channelId,
    channelName: i.channelName,
    text: i.text,
    title: i.title,
    kind: i.kind,
    ...(invalid ? { invalid } : {}),
  };
}

/**
 * Settings ▸ Feedback "Post live" off: Send on a feedback item is a dry run whatever the global setting (both
 * DataSources' dispatch read this; the live relay refuses the post too).
 */
export function feedbackHeld(dest: Destination, feedback: Pick<FeedbackSettings, 'postLive'> | null | undefined): boolean {
  return dest.kind === 'action' && dest.action === 'feedback.post' && feedback?.postLive === false;
}
