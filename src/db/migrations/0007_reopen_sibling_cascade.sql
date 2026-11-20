-- BE-REEVAL: a "new sibling" reopen decision goes with the sibling it created.
-- reopen_decisions.new_work_item_id was ON DELETE SET NULL, but reopen_decisions_outcome_chk requires it when
-- outcome = 'new_sibling'. Undoing the engine change set that opened a sibling deletes the sibling (its insert is
-- in the audit images), the SET NULL then violated the check, and Undo failed "not restorable" (reeval and
-- DbDataSource.applyClosureSignal alike). reopen_decisions is unaudited engine output, like the scores in 0006:
-- the sibling is only ever deleted by undoing that change set, so the decision row is deleted with it and the
-- undo restores the state before the decision exactly. A redo brings the sibling back, not this row.
ALTER TABLE "reopen_decisions" DROP CONSTRAINT "reopen_decisions_new_work_item_id_work_items_id_fk";
--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_new_work_item_id_work_items_id_fk" FOREIGN KEY ("new_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;
