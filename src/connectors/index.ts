/**
 * BE-2b deterministic connectors. Wiring example (runtime, BE-2a):
 *
 *   const google = new GoogleWorkspaceClient();
 *   const me = { email, name };
 *   const fetchers = {
 *     gmail: new GmailFetcher({ google, me }),
 *     calendar: new CalendarFetcher({ google, me }),
 *     gemini_notes: new GeminiNotesFetcher({ google, me }),
 *     drive: new DriveFetcher({ google, me, store: new FileDigestStore(), linked: () => linkedFileRefsFromOpenItems() }),
 *     trainings: new TrainingsFetcher({ google, me }),
 *     claude_sessions: new ClaudeSessionsFetcher({ excludeCwdPrefixes: [scannerCwd] }),
 *     watch: new WatchScopeFetcher({ subscriptions }),
 *   };
 */
export * from './redact';
export * from './util';
export * from './google/client';
export * from './google/parse';
export * from './google/gmail';
export * from './google/calendar';
export * from './google/gemini-notes';
export * from './google/trainings';
export * from './claude/transcript';
export * from './claude/status';
export * from './claude/sessions';
export * from './claude/watcher';
export * from './watch';
export { DriveFetcher, FileDigestStore, MemoryDigestStore } from '@/scanner/drive-digest';
