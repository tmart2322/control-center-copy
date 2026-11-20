/**
 * Control Center schema barrel (Postgres 17, drizzle-orm 0.45, node-postgres).
 *
 * Source of truth: docs/ui/DATA-MODEL.md §3.1, split by domain under src/db/schema/ (decision 9).
 * drizzle-kit reads this file (drizzle.config.ts). Import tables from here, not from the domain
 * files, so every module (and the users.id binding in core.ts) is loaded.
 *
 * Conventions (vdp-app): plural snake_case tables, explicit snake_case columns, uuid ids for
 * entities and bigserial for append-only logs, created_at/updated_at timestamptz, index names
 * <table>_<cols>_idx / _uidx, unique _uq, checks _chk, exclusions _excl, explicit FKs
 * <table>_<column>_fk when drizzle's default name would exceed 63 characters (decision 10).
 *
 * Drizzle cannot express the exclusion constraints, the audit trigger, the append-only guards,
 * the NOTIFY triggers or the view body: those live in src/db/migrations/0002_extras.sql.
 */
export * from './schema/enums';
export * from './schema/core';
export * from './schema/settings';
export * from './schema/connectors';
export * from './schema/scanning';
export * from './schema/sources';
export * from './schema/entities';
export * from './schema/drive';
export * from './schema/calendar';
export * from './schema/work';
export * from './schema/priority';
export * from './schema/nba';
export * from './schema/drafts';
export * from './schema/sessions';
export * from './schema/activity';
export * from './schema/deals';
export * from './schema/jobs';
export * from './schema/llm';
export * from './schema/chat';
export * from './schema/audit';
export * from './schema/health';
export * from './schema/tools';
export * from './schema/briefs';
export * from './schema/forecast'; // lane A
export * from './schema/landings'; // D-70
