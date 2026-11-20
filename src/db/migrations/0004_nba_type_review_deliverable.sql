-- CONTRACT-1: the NBA verb `review_deliverable` (a Drive deliverable judged ready for review).
-- Until now the NBA skills mapped it to `confirm_done`; it gets its own nba_type value.
-- Postgres 12+ allows ADD VALUE inside the migration transaction; the new value is not used in this
-- migration, so nothing reads it before commit. IF NOT EXISTS keeps re-runs harmless.
ALTER TYPE "public"."nba_type" ADD VALUE IF NOT EXISTS 'review_deliverable';
