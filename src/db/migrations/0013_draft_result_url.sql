-- Applied actions keep their link: where an applied or sent draft's result lives (the canvas, the message permalink,
-- the VDP record), from the Outbox adapter's write result. Nullable; existing drafts keep null (no backfill).
ALTER TABLE "drafts" ADD COLUMN "result_url" text;
