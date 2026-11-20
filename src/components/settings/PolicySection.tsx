'use client';
/**
 * Priority policy (R-UI-16, UI-SPEC §8): weights as label-left sliders, plain-language rules in a table,
 * then Preview re-rank → Apply as vN (a new version, with Undo and Revert). Apply stays grey until this exact
 * draft has been previewed. The effect pane (PolicyEffect) shows the before/after from the real preview route.
 */
import { useState, type ReactNode } from 'react';
import type { PolicyRule, PolicyWeightKey, PolicyWeights } from '@/contract';
import { useRightPanel } from '@/components/shell';
import { Button, cn, Skeleton } from '@/ui';
import { fmtClock } from '@/ui/format';
import { CONDITION_LABEL, lastChangedLine, newRule, setWeight, WEIGHT_KEYS, WEIGHT_META, type RuleCondition } from './derive';
import { Check, Glyph, MiniButton, NumberInput, RangeField, Select, TextInput, type GlyphName } from './controls';
import { Block, Row, Section } from './form';
import { useSettingsModel } from './state';
import { useApi } from '@/client/hooks';
import s from './settings.module.css';

/** The neutral "applies when" chips: one glyph + words per condition. */
function conditions(w: PolicyRule['when']): Array<{ glyph: GlyphName; text: string }> {
  const out: Array<{ glyph: GlyphName; text: string }> = [];
  if (w.customerFacing !== undefined) out.push({ glyph: 'bldg', text: w.customerFacing ? 'customer-facing' : 'internal' });
  if (w.fromManager !== undefined) out.push({ glyph: 'person', text: w.fromManager ? 'from my manager' : 'not from my manager' });
  if (w.dueWithinH !== undefined) out.push({ glyph: 'clock', text: `due within ${w.dueWithinH} h` });
  if (w.kinds?.length) out.push({ glyph: 'kind', text: w.kinds.join(' / ').replace(/_/g, ' ') });
  if (w.sources?.length) out.push({ glyph: 'doc', text: `from ${w.sources.join(' / ')}` });
  return out.length ? out : [{ glyph: 'lines', text: 'always' }];
}

function BoostBar({ boost }: { boost: number }) {
  const w = (Math.min(Math.abs(boost), 4) / 4) * 50;
  return (
    <span className={s.bbar} aria-hidden>
      <i style={{ left: boost >= 0 ? '50%' : `${50 - w}%`, width: `${w}%` }} />
    </span>
  );
}

export function PolicyActions() {
  const { policy: m } = useSettingsModel();
  if (!m.policy) return null;
  const n = m.changes.length;
  const state = !m.dirty ? 'No changes' : m.fresh ? `${n} change${n === 1 ? '' : 's'} · previewed ${fmtClock(new Date(m.fresh.at))}` : `${n} change${n === 1 ? '' : 's'} · not previewed`;
  return (
    <>
      <span className={s.saveState} role="status" aria-live="polite" data-testid="policy-state">
        {m.previewM.isPending ? 'Computing the new ranking…' : state}
      </span>
      {m.dirty ? (
        <Button variant="ghost" onClick={m.discard} data-testid="policy-discard">
          Discard
        </Button>
      ) : null}
      <Button variant="secondary" disabled={!m.dirty || !!m.fresh} loading={m.previewM.isPending} onClick={m.runPreview} data-testid="policy-preview-btn">
        Preview re-rank
      </Button>
      <Button variant="primary" disabled={!m.fresh} loading={m.apply.isPending} onClick={m.runApply} data-testid="policy-apply">
        Apply as v{m.policy.version + 1}
      </Button>
    </>
  );
}

/**
 * The weight sliders as label-left rows (Settings ▸ Priority policy and onboarding's Priorities step). `was` holds
 * the applied value of each weight: a moved slider shows "was n" with a reset, and its row reads as edited.
 */
export function PolicyWeightRows({ weights, was, onChange, help }: { weights: PolicyWeights; was: PolicyWeights; onChange: (w: PolicyWeights) => void; help?: (k: PolicyWeightKey) => ReactNode }) {
  return (
    <>
      {WEIGHT_KEYS.map((k) => {
        const before = was[k];
        const v = weights[k];
        const changed = v !== before;
        return (
          <Row
            key={k}
            htmlFor={`w-${k}`}
            label={WEIGHT_META[k].label}
            help={help ? help(k) : WEIGHT_META[k].hint}
            edited={changed}
            testId={`w-${k}-row`}
            labelExtra={
              changed ? (
                <span className={s.was} data-testid={`w-${k}-value`}>
                  was {before}
                  <MiniButton label={`Reset ${WEIGHT_META[k].label} to ${before}`} onClick={() => onChange(setWeight(weights, k, before))}>
                    <Glyph name="reset" />
                  </MiniButton>
                </span>
              ) : null
            }
          >
            <RangeField id={`w-${k}`} label={WEIGHT_META[k].label} value={v} was={before} onValue={(n) => onChange(setWeight(weights, k, n))} />
          </Row>
        );
      })}
    </>
  );
}

/** The plain-language rules table with its "add a rule" row. `saved` marks what changed against the applied rules. */
export function PolicyRulesTable({ rules, saved, onChange }: { rules: PolicyRule[]; saved: PolicyRule[]; onChange: (rules: PolicyRule[]) => void }) {
  const [adding, setAdding] = useState({ text: '', condition: 'customer' as RuleCondition, boost: 2 });
  const savedRule = new Map(saved.map((r) => [r.id, r]));
  const setRules = onChange;
  return (
    <table className={s.tbl} aria-label="Rules">
      <thead>
        <tr>
          <th style={{ width: 48 }}>On</th>
          <th>Rule</th>
          <th style={{ width: 224 }}>Applies when</th>
          <th className={s.r} style={{ width: 168 }}>
            Boost
          </th>
          <th style={{ width: 44 }}>
            <span className={s.srOnly}>Remove</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rules.length === 0 ? (
          <tr>
            <td colSpan={5} className={s.muted}>
              No rules yet. Add one below, like “Customer-facing beats internal”.
            </td>
          </tr>
        ) : null}
        {rules.map((r, i) => {
          const o = savedRule.get(r.id);
          const changed = !o || o.enabled !== r.enabled || o.boost !== r.boost || o.text !== r.text;
          const upd = (patch: Partial<PolicyRule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <tr key={r.id} data-rule={r.id} className={cn(!r.enabled && s.off, changed && s.changed)}>
              <td>
                <Check checked={r.enabled} onChange={(v) => upd({ enabled: v })} label={`Rule on: ${r.text}`} />
              </td>
              <td>
                <input className={s.ruleText} aria-label={`Rule ${i + 1} text`} value={r.text} onChange={(e) => upd({ text: e.target.value })} />
              </td>
              <td>
                {conditions(r.when).map((c) => (
                  <span key={c.text} className={s.cond}>
                    <Glyph name={c.glyph} className="size-3 text-muted" />
                    {c.text}
                  </span>
                ))}
              </td>
              <td className={s.r}>
                <span className={s.boost}>
                  <BoostBar boost={r.boost} />
                  <NumberInput value={r.boost} min={-10} max={10} step={0.5} aria-label={`Boost: ${r.text}`} onValue={(n) => Number.isFinite(n) && upd({ boost: Math.min(10, Math.max(-10, Math.round(n * 2) / 2)) })} />
                </span>
              </td>
              <td>
                <MiniButton label={`Remove rule: ${r.text}`} className={s.rowX} onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                  <Glyph name="close" />
                </MiniButton>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5}>
            <form
              className={s.addRow}
              onSubmit={(e) => {
                e.preventDefault();
                if (!adding.text.trim()) return;
                setRules([...rules, newRule(adding.text, adding.condition, adding.boost)]);
                setAdding({ ...adding, text: '' });
              }}
            >
              <TextInput width="full" style={{ flex: '1 1 280px', width: 'auto' }} id="rule-text" aria-label="New rule" placeholder="New rule, e.g. “Deals closing this quarter come first”" value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} />
              <Select aria-label="When the rule applies" value={adding.condition} onChange={(e) => setAdding({ ...adding, condition: e.target.value as RuleCondition })}>
                {(Object.keys(CONDITION_LABEL) as RuleCondition[]).map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </Select>
              <NumberInput value={adding.boost} min={-10} max={10} step={0.5} aria-label="Boost for the new rule" onValue={(n) => setAdding({ ...adding, boost: Number.isFinite(n) ? n : 0 })} />
              <Button type="submit" variant="secondary" disabled={!adding.text.trim()}>
                Add rule
              </Button>
            </form>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

export function PolicySection() {
  const { policy: m } = useSettingsModel();
  const versions = useApi('getPolicyVersions');
  const panel = useRightPanel();
  const policy = m.policy;
  const draft = m.draft;

  const errors = (
    <>
      {m.previewM.error ? (
        <p role="alert" className="text-body text-danger-700">
          Couldn’t preview: {m.previewM.error.message}.{' '}
          <button type="button" className={s.linkBtn} onClick={m.runPreview}>
            Retry
          </button>
        </p>
      ) : null}
      {m.apply.conflict ? (
        <p role="alert" className="text-body text-danger-700">
          The policy changed elsewhere (another tab or the assistant). Your edits are kept; preview again on the new version.
        </p>
      ) : m.apply.error ? (
        <p role="alert" className="text-body text-danger-700">
          Couldn’t apply: {m.apply.error.message}. Nothing re-ranked; your edits are kept.{' '}
          <button type="button" className={s.linkBtn} onClick={m.runApply}>
            Retry
          </button>
        </p>
      ) : null}
    </>
  );
  const hasErrors = !!(m.previewM.error || m.apply.error || m.apply.conflict);

  if (!policy || !draft) {
    return (
      <Section id="policy" title="Priority policy">
        <Skeleton variant="block" className="mt-6 h-64 w-full" />
      </Section>
    );
  }
  const setRules = (rules: PolicyRule[]) => m.setDraft({ ...draft, rules });

  return (
    <Section
      id="policy"
      title="Priority policy"
      actions={<PolicyActions />}
      feedback={hasErrors ? errors : null}
      meta={
        <>
          {policy.name} · <b data-testid="policy-version">v{policy.version}</b>
          {versions.data ? (
            <>
              {' · '}
              <span data-testid="policy-changed-by">{lastChangedLine(versions.data.versions, policy.version).replace(/ · v\d+$/, '').replace(/^Last/, 'last')}</span>
            </>
          ) : null}{' '}
          · Nothing re-ranks until you preview and apply
        </>
      }
    >
      <Block id="b-weights" title="Weights" help="How much each signal counts. 0 ignores it, 10 dominates.">
        <PolicyWeightRows weights={draft.weights} was={policy.weights} onChange={(weights) => m.setDraft({ ...draft, weights })} />
      </Block>

      <Block id="b-rules" title="Rules in plain language" help="Applied after the weights. A positive boost lifts what matches; a negative one holds it back.">
        <PolicyRulesTable rules={draft.rules} saved={policy.rules} onChange={setRules} />
        <p className={s.askAi}>
          <span className={s.spark} aria-hidden>
            ✦
          </span>{' '}
          Or{' '}
          <button type="button" className={s.linkBtn} onClick={() => panel.openAssistant({ kind: 'policy', id: policy.id, label: 'Priority policy' })}>
            ask the assistant
          </button>
          , e.g. “weight due dates higher this week”. Its changes land in the history on the right, with Undo.
        </p>
      </Block>
    </Section>
  );
}
