/**
 * Time ▸ VDP details (pure parts): the head sentence (the same status the card shows, D-59), open vs closed
 * candidates, the Find assets run line. Placeholders only. (D-59 dropped the per-gap rows inside a step: each item
 * is one row now, so `rowLabel` and its test are gone.)
 */
import { describe, expect, it } from 'vitest';
import type { VdpAssetCandidate, VdpStatus, VdpStep } from '@/contract';
import { candidateGroups, panelSentence, personList, runLine } from './vdp-panel-derive';

const cand = (id: string, status: VdpAssetCandidate['status']) => ({ id, status, title: id }) as VdpAssetCandidate;
const step = (state: VdpStep['state'], kind: VdpStep['kind'] = 'use_case_fields') => ({ state, kind }) as VdpStep;
const status = (state: VdpStatus['state'], o: Partial<VdpStatus> = {}): VdpStatus => ({ state, open: 0, appCanFix: 0, waiting: 0, label: state === 'done' ? 'Done' : `${o.open ?? 0} open`, nextReadAt: null, ...o });
const NOW = Date.parse('2026-11-10T16:00:00.000Z');

describe('VDP details panel', () => {
  it('says what is left, and that nothing can go in before the VDP exists', () => {
    const g = candidateGroups([cand('a', 'suggested'), cand('b', 'unsure'), cand('c', 'in_vdp'), cand('d', 'dismissed'), cand('e', 'added')]);
    expect(g.open.map((c) => c.id)).toEqual(['a', 'b', 'e']);
    expect(g.closed.map((c) => c.id)).toEqual(['c', 'd']);
    expect(panelSentence({ vdp: {} as never, steps: [step('todo'), step('todo'), step('todo')], status: status('open', { open: 3, appCanFix: 3 }) }, g, NOW, 'UTC')).toBe('3 open · 3 the app can push · 1 asset to add · 1 to confirm');
    expect(panelSentence({ vdp: null, steps: [step('todo', 'create_vdp')], status: status('open', { open: 1 }) }, g, NOW, 'UTC')).toBe('No VDP yet: one push creates it and what goes under it · 1 asset ready for it · 1 to confirm');
    expect(panelSentence({ vdp: null, steps: [step('todo', 'add_opp')], status: status('open', { open: 1 }) }, { open: [] }, NOW, 'UTC')).toBe('Not on its VDP yet: add it');
    expect(panelSentence({ vdp: {} as never, steps: [], status: status('done') }, { open: [] }, NOW, 'UTC')).toBe('Done: VDP has everything the app checks');
  });

  it('the run line and people', () => {
    expect(runLine({ last: null }, 'UTC')).toBe('Not searched yet');
    expect(runLine({ last: { status: 'running', startedAt: '2026-11-10T10:00:00.000Z', finishedAt: null, found: 0, costUsd: null, note: null } }, 'UTC')).toMatch(/Looking through Drive, Slack, Gmail and Calendar/);
    expect(runLine({ last: { status: 'done', startedAt: '2026-11-10T10:00:00.000Z', finishedAt: '2026-11-10T10:02:00.000Z', found: 3, costUsd: 0.21, note: null } }, 'UTC')).toMatch(/^Searched .* · 3 new finds · \$0\.21$/);
    expect(runLine({ last: { status: 'skipped', startedAt: '2026-11-10T10:00:00.000Z', finishedAt: '2026-11-10T10:00:01.000Z', found: 0, costUsd: null, note: 'budget' } }, 'UTC')).toMatch(/didn't finish: budget$/);
    expect(personList([{ name: 'AE Placeholder', email: null }, { name: null, email: 'ta@example.com' }])).toBe('AE Placeholder, ta@example.com');
    expect(personList([])).toBeNull();
  });
});
