/**
 * Where a feedback report goes (D-56): Settings ▸ Feedback's channel, else the team default in `config/team.json`
 * (`{ "feedbackChannelId": "", "feedbackChannelName": "" }`, no secrets). The client never picks the channel: the
 * server resolves it when it stages the Outbox item, and the live relay resolves it again right before the post
 * (`feedbackChannelFor`, wired in the worker).
 */
import fs from 'node:fs';
import path from 'node:path';

import { FeedbackSettings, type FeedbackChannelState, type SendingSettings } from '@/contract';
import type { Db } from '@/db/client';
import { FEEDBACK_CHANNEL_ID } from '@/lib/feedback/payload';
import { loadSettingsSections } from '@/server/datasource/db/store/settings';

export interface TeamConfig {
  feedbackChannelId: string;
  feedbackChannelName: string;
}

export const EMPTY_TEAM_CONFIG: TeamConfig = { feedbackChannelId: '', feedbackChannelName: '' };

export function teamConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CC_TEAM_CONFIG ?? path.join(process.cwd(), 'config', 'team.json');
}

/** `config/team.json`, validated: a malformed file or a bad channel id reads as empty (never a guess). */
export function readTeamConfig(file = teamConfigPath()): TeamConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ...EMPTY_TEAM_CONFIG };
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof o.feedbackChannelId === 'string' && FEEDBACK_CHANNEL_ID.test(o.feedbackChannelId.trim()) ? o.feedbackChannelId.trim() : '';
  const name = typeof o.feedbackChannelName === 'string' ? o.feedbackChannelName.trim().slice(0, 80) : '';
  return { feedbackChannelId: id, feedbackChannelName: id ? name : '' };
}

/** The channel Send posts to, and whether it really would. */
export function resolveFeedbackChannel(feedback: Partial<FeedbackSettings> | null | undefined, sending: Pick<SendingSettings, 'dryRun'> | null | undefined, team: TeamConfig = readTeamConfig()): FeedbackChannelState {
  const fb = FeedbackSettings.parse({ version: 1, ...(feedback ?? {}) });
  const dryRun = sending?.dryRun !== false;
  const fromSettings = FEEDBACK_CHANNEL_ID.test(fb.channelId);
  const id = fromSettings ? fb.channelId : team.feedbackChannelId;
  const name = fromSettings ? fb.channelName : team.feedbackChannelName;
  const source: FeedbackChannelState['source'] = fromSettings ? 'settings' : id ? 'team' : 'none';
  return { id, name, source, postLive: fb.postLive, dryRun, live: !!id && fb.postLive && !dryRun };
}

/**
 * For the live relay (src/outbox/transport.ts): the configured channel id while "Post live" is on, else null. Global
 * dry run is not checked here: the delivery engine re-reads it right before the write.
 */
export async function feedbackChannelFor(db: Db, userId: string, team: () => TeamConfig = () => readTeamConfig()): Promise<string | null> {
  const sections = await loadSettingsSections({ db, userId });
  const c = resolveFeedbackChannel(sections.feedback, { dryRun: false }, team());
  return c.id && c.postLive ? c.id : null;
}
