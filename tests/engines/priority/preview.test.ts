/** Settings ▸ Priority policy: "Preview re-rank" shows the before/after Top 10 with reasons, then Apply. */
import { describe, expect, it } from 'vitest';
import { previewPolicy } from '@/engines/priority/preview';
import { RULE_CUSTOMER_FACING, SE_IC_POLICY } from '@/engines/priority/policy';
import { at, HOURS, item, withPolicy } from './fixtures';

const internalSoon = item('int', { title: 'Fill in team enablement survey', due: at('13:00'), effort: { youMin: 20, agentMin: 0 } });
const customerLater = item('cust', {
  title: 'Send ACME the pilot success criteria',
  due: at('17:00'),
  effort: { youMin: 20, agentMin: 0 },
  stakeholders: [{ name: 'Dana', isExternal: true }],
});
const filler = Array.from({ length: 11 }, (_, i) => item(`f${String(i).padStart(2, '0')}`, { title: `Filler ${i}`, effort: { youMin: 60, agentMin: 0 } }));

const base = { now: at('09:00'), items: [internalSoon, customerLater, ...filler], meetings: [], workingHours: HOURS };

describe('previewPolicy', () => {
  const oldPolicy = withPolicy({ rules: SE_IC_POLICY.rules.filter((r) => r.ruleKey !== RULE_CUSTOMER_FACING.ruleKey) }, 1);
  const newPolicy = withPolicy({ rules: SE_IC_POLICY.rules, changeSummary: "Added 'customer-facing beats internal'" }, 2);
  const p = previewPolicy(oldPolicy, newPolicy, base);

  it('returns the before and after Top 10 under each policy version', () => {
    expect(p.basedOnVersion).toBe(1);
    expect(p.newVersion).toBe(2);
    expect(p.before).toHaveLength(10);
    expect(p.after).toHaveLength(10);
    expect(p.before[0]!.workItemId).toBe('int');
    expect(p.after[0]!.workItemId).toBe('cust');
    expect(p.before.every((r) => r.policyVersion === 1)).toBe(true);
    expect(p.after.every((r) => r.policyVersion === 2)).toBe(true);
  });

  it('explains the moves in the new policy’s terms', () => {
    const row = p.after.find((r) => r.workItemId === 'cust')!;
    expect(row.moved).toBe(1);
    expect(row.rank).toBe(1);
    expect(row.reasons).toContain("Ranked up: your rule 'customer-facing beats internal'");
    expect(p.after.find((r) => r.workItemId === 'int')!.moved).toBe(-1);
    expect(p.changedCount).toBe(2);
    expect(p.summary).toBe("2 items move; 'Send ACME the pilot success criteria' takes #1");
    expect(p.changes).toEqual([{ kind: 'rule_added', key: 'customer_facing_over_internal', label: "Added rule 'Customer-facing beats internal'" }]);
  });

  it('lists weight changes and reports no movement when nothing changes', () => {
    const same = previewPolicy(SE_IC_POLICY, SE_IC_POLICY, base);
    expect(same.changedCount).toBe(0);
    expect(same.summary).toBe('No change in the Top 10');
    const heavier = withPolicy({ weights: { ...SE_IC_POLICY.weights, dealValue: 3 } }, 2);
    expect(previewPolicy(SE_IC_POLICY, heavier, base).changes).toEqual([{ kind: 'weight_changed', key: 'weight:dealValue', label: 'Weight deal value 1 → 3' }]);
    const disabled = withPolicy({ rules: SE_IC_POLICY.rules.map((r) => (r.ruleKey === 'external_attendee_boost' ? { ...r, enabled: false } : r)) }, 2);
    expect(previewPolicy(SE_IC_POLICY, disabled, base).changes[0]).toMatchObject({ kind: 'rule_disabled', key: 'external_attendee_boost' });
  });
});
