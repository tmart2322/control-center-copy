/**
 * Spend ledger for the stress campaign: every LLM call the campaign makes (scanner runs, Sonnet escalations,
 * recorder agents, the Opus answer key) appends one line. A hard campaign cap (default $50) is checked before
 * each spending step: `assertBudget(estimate)` throws `CampaignBudgetError` instead of going over.
 */
import path from 'node:path';

import { appendPriv, privDir, readJsonl } from './paths';

export interface SpendEntry {
  at: string;
  scenario: string;
  kind: 'scanner' | 'triage' | 'escalation' | 'recorder' | 'answer_key' | 'probe' | 'adjudication' | 'completion';
  model: string;
  /** Campaign tag (`CC_STRESS_CAMPAIGN`, e.g. STRESS-2): its own cap via `CC_STRESS_CAP_USD`. */
  campaign?: string;
  costUsd: number;
  runId?: string;
  note?: string;
}

export class CampaignBudgetError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly capUsd: number,
    public readonly estimateUsd: number,
  ) {
    super(`campaign budget: spent $${spentUsd.toFixed(2)} + estimate $${estimateUsd.toFixed(2)} would pass the $${capUsd} cap`);
    this.name = 'CampaignBudgetError';
  }
}

export const CAMPAIGN_CAP_USD = Number(process.env.CC_STRESS_CAP_USD ?? 50);
const CAMPAIGN = process.env.CC_STRESS_CAMPAIGN || undefined;

export function ledgerFile(): string {
  return path.join(privDir('ledger'), 'spend.jsonl');
}

export function recordSpend(e: Omit<SpendEntry, 'at'> & { at?: string }): void {
  if (!(e.costUsd > 0)) return;
  appendPriv(ledgerFile(), JSON.stringify({ at: e.at ?? new Date().toISOString(), ...(CAMPAIGN ? { campaign: CAMPAIGN } : {}), ...e }));
}

export function spendEntries(): SpendEntry[] {
  return readJsonl<SpendEntry>(ledgerFile());
}

export function totalSpend(filter?: (e: SpendEntry) => boolean): number {
  return spendEntries()
    .filter((e) => !filter || filter(e))
    .reduce((a, e) => a + e.costUsd, 0);
}

export function assertBudget(estimateUsd: number, capUsd = CAMPAIGN_CAP_USD): void {
  const spent = totalSpend(CAMPAIGN ? (e) => e.campaign === CAMPAIGN : undefined);
  if (spent + estimateUsd > capUsd) throw new CampaignBudgetError(spent, capUsd, estimateUsd);
}

export function spendSummary(): { totalUsd: number; byKind: Record<string, number>; byScenario: Record<string, number>; calls: number } {
  const es = spendEntries();
  const byKind: Record<string, number> = {};
  const byScenario: Record<string, number> = {};
  for (const e of es) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + e.costUsd;
    byScenario[e.scenario] = (byScenario[e.scenario] ?? 0) + e.costUsd;
  }
  return { totalUsd: es.reduce((a, e) => a + e.costUsd, 0), byKind, byScenario, calls: es.length };
}
