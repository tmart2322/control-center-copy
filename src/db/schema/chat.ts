/** Chat threads, messages and tool calls (section 15; R-UI-10). */
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId } from './columns';
import {
  chatScope,
  chatRole,
  toolCallStatus,
} from './enums';
import { accounts, opportunities } from './entities';
import { workItems } from './work';
import { jobs } from './jobs';
import { llmCalls } from './llm';
import { changeSets } from './audit';

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    title: text('title'),
    scope: chatScope('scope').notNull().default('global'),
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    /** Agent SDK session id, for resume. */
    sdkSessionId: text('sdk_session_id'),
    model: text('model'),
    lastMessageAt: tstz('last_message_at'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('chat_threads_owner_last_idx').on(t.ownerUserId, t.lastMessageAt.desc())],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: chatRole('role').notNull(),
    content: text('content'),
    /** SDK content blocks when richer than text. */
    contentBlocks: jsonb('content_blocks').$type<unknown[]>(),
    model: text('model'),
    llmCallId: bigint('llm_call_id', { mode: 'number' }).references((): AnyPgColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('chat_messages_thread_seq_uidx').on(t.threadId, t.seq)],
);

export const chatToolCalls = pgTable(
  'chat_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    toolUseId: text('tool_use_id').notNull(),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    /** Redacted and truncated. */
    output: jsonb('output').$type<unknown>(),
    isMutation: boolean('is_mutation').notNull().default(false),
    requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
    status: toolCallStatus('status').notNull().default('proposed'),
    changeSetId: uuid('change_set_id').references(() => changeSets.id, { onDelete: 'set null' }),
    jobId: bigint('job_id', { mode: 'number' }).references(() => jobs.id, { onDelete: 'set null' }),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    errorCode: text('error_code'),
  },
  (t) => [
    uniqueIndex('chat_tool_calls_message_tool_use_uidx').on(t.messageId, t.toolUseId),
    index('chat_tool_calls_change_set_idx').on(t.changeSetId),
  ],
);
