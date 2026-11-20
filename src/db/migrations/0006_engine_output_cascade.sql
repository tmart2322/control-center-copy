-- INTEGRATE-1: derived ranking output cascades with the policy version it was computed under.
-- priority_runs.policy_id, priority_scores.policy_id and priority_score_rule_hits.rule_id were ON DELETE
-- RESTRICT, so undoing a policy apply (which deletes the version row and its rules it inserted) failed with
-- "not restorable" once a re-rank had scored items under it. A policy version row is only ever deleted by
-- undoing its own change set, which first restores the work items' score pointers (newest audit row
-- first), so nothing live references the scores that go with it. Scores are unaudited engine output (B5).
ALTER TABLE "priority_runs" DROP CONSTRAINT "priority_runs_policy_id_priority_policies_id_fk";
--> statement-breakpoint
ALTER TABLE "priority_score_rule_hits" DROP CONSTRAINT "priority_score_rule_hits_rule_id_priority_policy_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "priority_scores" DROP CONSTRAINT "priority_scores_policy_id_priority_policies_id_fk";
--> statement-breakpoint
ALTER TABLE "priority_runs" ADD CONSTRAINT "priority_runs_policy_id_priority_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."priority_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_score_rule_hits" ADD CONSTRAINT "priority_score_rule_hits_rule_id_priority_policy_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."priority_policy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_scores" ADD CONSTRAINT "priority_scores_policy_id_priority_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."priority_policies"("id") ON DELETE cascade ON UPDATE no action;