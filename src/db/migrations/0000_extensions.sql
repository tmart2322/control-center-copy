-- 0000_extensions.sql (custom; runs before the generated schema). DATA-MODEL §3.2.
-- The GIN trigram indexes and the GiST indexes over uuid/text in 0001_init need these.
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy alias / title matching (merge + resolver)
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- uuid/text equality inside GiST (exclusion, ledger ranges)
