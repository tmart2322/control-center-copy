import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA_SETTINGS, PersonaSettingsPatch } from '@/contract';
import { AE_PERSONA, personaOf, SE_PERSONA } from '@/personas';
import {
  addCustomRule,
  carriedTaskRules,
  carryTaskRules,
  CUSTOM_RULE_ID,
  CUSTOM_RULES_MAX,
  customRuleId,
  DEFAULT_TASK_CAPTURE,
  editCustomRule,
  featuresAndSources,
  personaErrors,
  personaPatch,
  removeCustomRule,
  resetRule,
  resetThreshold,
  roleSummary,
  setFeature,
  setLevel,
  setRule,
  setSource,
  setThreshold,
  switchPersona,
  thresholdError,
  thresholdText,
  visibleThresholds,
  withoutCarried,
  type PersonaDraft,
} from '../role';

const { version: _v, ...DEFAULTS } = DEFAULT_PERSONA_SETTINGS;
const se = (): PersonaDraft => structuredClone(DEFAULTS);
const ae = (): PersonaDraft => ({ ...se(), id: 'ae' });
const resolved = (d: PersonaDraft, role = 'se_ic') => personaOf({ persona: d, profile: { role } });
const threshold = (key: string) => AE_PERSONA.thresholds.find((t) => t.key === key)!;

describe('role & rules: preset rules', () => {
  it('stores a rule edit only while it differs from the preset, and Reset removes it', () => {
    const off = setRule(se(), 'promises', { enabled: false });
    expect(off.rules).toEqual({ promises: { enabled: false } });
    expect(resolved(off).rules.find((r) => r.id === 'promises')!.enabled).toBe(false);
    // switched back on: the override goes, nothing left to save
    expect(setRule(off, 'promises', { enabled: true }).rules).toEqual({});
    expect(personaPatch(setRule(off, 'promises', { enabled: true }), se())).toEqual({});

    const reworded = setRule(se(), 'promises', { text: 'Anything I promise is a task' });
    expect(reworded.rules).toEqual({ promises: { text: 'Anything I promise is a task' } });
    // the preset's own words (whitespace aside) are no edit
    expect(setRule(reworded, 'promises', { text: '  Anything I say I will do is a task ' }).rules).toEqual({});
    expect(resetRule(setRule(reworded, 'promises', { enabled: false }), 'promises').rules).toEqual({});
  });

  it('the patch is only the top-level keys that changed, and the contract accepts it', () => {
    const d = setRule(setThreshold(ae(), 'staleNotesDays', 10), 'deal_role_never_none', { enabled: false });
    const patch = personaPatch(d, ae());
    expect(patch).toEqual({ rules: { deal_role_never_none: { enabled: false } }, thresholds: { staleNotesDays: 10 } });
    expect(PersonaSettingsPatch.safeParse(patch).success).toBe(true);
    expect(personaPatch(ae(), se())).toEqual({ id: 'ae' });
  });
});

describe('role & rules: your rules', () => {
  it('adds with an id the contract accepts, skips blanks and duplicates, edits, toggles and deletes', () => {
    let d = addCustomRule(se(), '  Asks from my RVP about a forecast are tasks due the same day ');
    expect(d.customRules).toEqual([{ id: 'asks-from-my-rvp-about-a-forecast-are-tasks-due', text: 'Asks from my RVP about a forecast are tasks due the same day', enabled: true }]);
    expect(addCustomRule(d, 'asks from my rvp about a forecast   are tasks due the same day')).toBe(d);
    expect(addCustomRule(d, '   ')).toBe(d);
    d = addCustomRule(d, 'Asks from my RVP about a forecast are tasks due the same day, always');
    expect(d.customRules.map((r) => r.id)).toEqual(['asks-from-my-rvp-about-a-forecast-are-tasks-due', 'asks-from-my-rvp-about-a-forecast-are-tasks-due-2']);
    d = editCustomRule(d, d.customRules[1]!.id, { enabled: false, text: 'Edited' });
    expect(d.customRules[1]).toMatchObject({ enabled: false, text: 'Edited' });
    expect(resolved(d).rules.filter((r) => r.custom).map((r) => [r.id, r.enabled])).toEqual([
      ['custom:asks-from-my-rvp-about-a-forecast-are-tasks-due', true],
      ['custom:asks-from-my-rvp-about-a-forecast-are-tasks-due-2', false],
    ]);
    d = removeCustomRule(d, d.customRules[0]!.id);
    expect(d.customRules.map((r) => r.text)).toEqual(['Edited']);
    expect(PersonaSettingsPatch.safeParse(personaPatch(d, se())).success).toBe(true);
  });

  it('ids always match the contract, whatever the text', () => {
    for (const t of ['Ünïcödé façade rule', '!!!', 'x'.repeat(300), 'Deal  role — never None']) {
      const id = customRuleId(t, []);
      expect(id).toMatch(CUSTOM_RULE_ID);
      expect(customRuleId(t, [id, `${id}-2`])).toBe(`${id}-3`);
    }
    expect(customRuleId('!!!', [])).toBe('rule');
  });

  it('holds at most the contract’s 50', () => {
    let d = se();
    for (let i = 0; i < CUSTOM_RULES_MAX + 3; i++) d = addCustomRule(d, `Rule number ${i}`);
    expect(d.customRules).toHaveLength(CUSTOM_RULES_MAX);
  });

  it('blank or too-long words block Save', () => {
    expect(personaErrors(setRule(se(), 'promises', { text: '  ' }))).toEqual({ 'rule:promises': 'Write the rule, or reset it.' });
    const d = editCustomRule(addCustomRule(se(), 'Mine'), 'mine', { text: '' });
    expect(personaErrors(d)).toEqual({ 'custom:mine': 'Write the rule, or delete it.' });
    expect(personaErrors(se())).toEqual({});
  });
});

describe('role & rules: thresholds', () => {
  it('a value equal to the preset default is not stored; Reset removes one', () => {
    expect(setThreshold(ae(), 'staleNotesDays', 7).thresholds).toEqual({});
    const d = setThreshold(ae(), 'staleNotesDays', 10);
    expect(d.thresholds).toEqual({ staleNotesDays: 10 });
    expect(resolved(d).thresholds.staleNotesDays).toBe(10);
    expect(resetThreshold(d, 'staleNotesDays').thresholds).toEqual({});
    expect(setThreshold(ae(), 'notesDueAt', '09:00').thresholds).toEqual({});
  });

  it('shows only the thresholds of active features', () => {
    expect(visibleThresholds(SE_PERSONA, resolved(se())).map((t) => t.key)).toEqual(['missedOppMinAmountUsd']);
    expect(visibleThresholds(SE_PERSONA, resolved(setFeature(se(), 'missedOpps', false)))).toEqual([]);
    expect(visibleThresholds(AE_PERSONA, resolved(ae()))).toHaveLength(6);
  });

  it('validates by unit and writes values in words', () => {
    expect(thresholdError(threshold('staleNotesDays'), 0)).toBe('Between 1 day and 60 days.');
    expect(thresholdError(threshold('staleNotesDays'), 2.5)).toBe('Whole days.');
    expect(thresholdError(threshold('staleNotesDays'), NaN)).toBe('Enter a number.');
    expect(thresholdError(threshold('staleNotesMinAmountUsd'), -1)).toBe('At least $0.');
    expect(thresholdError(threshold('staleNotesMinAmountUsd'), 250_000)).toBeNull();
    expect(thresholdError(threshold('notesDueWeekday'), 7)).toBe('Pick a day.');
    expect(thresholdError(threshold('notesDueAt'), '9:00')).toBe('A time like 09:00.');
    expect(thresholdError(threshold('notesDueAt'), '17:30')).toBeNull();
    expect(thresholdError(threshold('forecastNoteTemplate'), ' ')).toBe('Write something, or reset to the preset.');
    expect(thresholdError(threshold('forecastNoteTemplate'), 'x'.repeat(401))).toBe('At most 400 characters.');
    expect(thresholdError(threshold('forecastNoteTemplate'), 'x'.repeat(120))).toBeNull(); // the AE preset's template is ~85
    expect(personaErrors(setThreshold(ae(), 'staleNotesDays', 0))).toEqual({ 'threshold:staleNotesDays': 'Between 1 day and 60 days.' });
    expect(thresholdText(threshold('staleNotesMinAmountUsd'), 100_000)).toBe('$100,000');
    expect(thresholdText(threshold('notesDueWeekday'), 1)).toBe('Monday');
    expect(thresholdText(threshold('staleNotesDays'), 1)).toBe('1 day');
  });
});

describe('role & rules: features and sources', () => {
  it('stores a switch only while it differs from the preset; VDP brings its source', () => {
    const off = setFeature(se(), 'vdp', false);
    expect(off.features).toEqual({ vdp: false });
    expect(resolved(off).connectors).not.toContain('vdp');
    expect(setFeature(off, 'vdp', true).features).toEqual({});

    const on = setFeature(ae(), 'vdp', true);
    expect(on.features).toEqual({ vdp: true });
    expect(resolved(on).connectors).toContain('vdp');
    // a stray override on the feature's own source goes: the source follows the feature
    expect(setFeature({ ...ae(), connectors: { vdp: false } }, 'vdp', true).connectors).toEqual({});

    const slack = setSource(se(), 'slack', false);
    expect(slack.connectors).toEqual({ slack: false });
    expect(setSource(slack, 'slack', true).connectors).toEqual({});
  });

  it('lists the active ones first and the rest as available; the VDP source is never listed on its own', () => {
    const fs = featuresAndSources(resolved(ae()));
    expect(fs.activeFeatures).toEqual(['activityLogging', 'specialistForecast']);
    expect(fs.availableFeatures).toEqual(['vdp', 'dealContributions', 'missedOpps', 'solutionsJudgement']);
    expect([...fs.activeSources, ...fs.availableSources]).not.toContain('vdp');
    expect(fs.availableSources).toEqual([]);
    expect(featuresAndSources(resolved(setSource(se(), 'trainings', false))).availableSources).toEqual(['trainings']);
  });
});

describe('role & rules: persona and level', () => {
  it('switching keeps your own rules and drops switches the new preset already makes', () => {
    let d = setFeature(se(), 'specialistForecast', true);
    d = addCustomRule({ ...d, level: 'manager' }, 'Mine');
    const next = switchPersona(d, 'ae');
    expect(next).toMatchObject({ id: 'ae', level: null, features: {}, customRules: [{ id: 'mine', text: 'Mine', enabled: true }] });
    expect(resolved(next).priorityTemplate).toBe('ae');
    expect(personaPatch(next, d)).toEqual({ id: 'ae', level: null, features: {} });
  });

  it('a level equal to the one the profile gives follows the profile', () => {
    expect(setLevel(se(), 'manager', { role: 'se_ic' }).level).toBe('manager');
    expect(setLevel({ ...se(), level: 'manager' }, 'ic', { role: 'se_ic' }).level).toBeNull();
    expect(setLevel(se(), 'manager', { role: 'se_manager' }).level).toBeNull();
  });

  it('the nav line names the level, Preview and the rules that are on', () => {
    expect(roleSummary(resolved(se()))).toBe('SE · 6 rules');
    expect(roleSummary(resolved(ae()))).toBe('Specialist AE (Preview) · 8 rules');
    expect(roleSummary(resolved(setFeature(se(), 'vdp', false)))).toBe('SE · 5 rules');
  });
});

describe('role & rules: the taskCapture carry-over', () => {
  it('the defaults never carry', () => {
    expect(carriedTaskRules(DEFAULT_TASK_CAPTURE, se(), resolved(se()))).toEqual([]);
    expect(carriedTaskRules(DEFAULT_TASK_CAPTURE, ae(), resolved(ae()))).toEqual([]);
  });

  it('nothing carries on the placeholder seed', () => {
    const seed = JSON.parse(readFileSync(path.resolve(__dirname, '../../../mock/seed.example.json'), 'utf8')) as { settings: { agentBehavior: { taskCapture: string[] } } };
    expect(carriedTaskRules(seed.settings.agentBehavior.taskCapture, se(), resolved(se()))).toEqual([]);
  });

  it('carries what you typed, once, unless it is already a rule (case and whitespace aside)', () => {
    const d = addCustomRule(se(), 'Asks from my RVP are tasks');
    const typed = ['Anything I say I will do', '  Anything a customer asks me to send ', 'anything a customer   asks me to send', 'ASKS FROM MY RVP ARE TASKS', 'anything i say i will do is a task', '', 'Follow up on every demo within a day'];
    const carried = carriedTaskRules(typed, d, resolved(d));
    expect(carried).toEqual(['Anything a customer asks me to send', 'Follow up on every demo within a day']);

    const r = carryTaskRules(d, carried);
    expect(r.ids).toEqual(['anything-a-customer-asks-me-to-send', 'follow-up-on-every-demo-within-a-day']);
    expect(r.texts).toEqual(carried);
    expect(r.draft.customRules.map((x) => x.text)).toEqual(['Asks from my RVP are tasks', ...carried]);
    // carried once: on the next open they are custom rules already
    expect(carriedTaskRules(typed, r.draft, resolved(r.draft))).toEqual([]);
    // and the save takes them out of Agent behavior
    expect(withoutCarried(typed, r.texts)).toEqual(['Anything I say I will do', 'ASKS FROM MY RVP ARE TASKS', 'anything i say i will do is a task', '']);
  });

  it('a reworded preset rule still counts as present', () => {
    const d = setRule(se(), 'promises', { text: 'Every promise I make is a task' });
    expect(carriedTaskRules(['every promise I make is a task'], d, resolved(d))).toEqual([]);
  });
});
