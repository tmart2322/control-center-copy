/** Seed ids inside in-app links become row ids; a view or section name that happens to equal an id stays a name. */
import { describe, expect, it } from 'vitest';
import { translateHrefs, type IdMap } from './translate';

const map: IdMap = new Map([
  ['vdp', 'u-vdp'],
  ['w_1', 'u-w1'],
  ['m_1', 'u-m1'],
]);
const t = (href: string) => translateHrefs({ href }, map).href;

describe('translateHrefs', () => {
  it('translates ids in the path and in id-carrying query values', () => {
    expect(t('/work/w_1')).toBe('/work/u-w1');
    expect(t('/health?connector=vdp')).toBe('/health?connector=u-vdp');
    expect(t('/deals/missed?id=m_1')).toBe('/deals/missed?id=u-m1');
    expect(t('/triage?item=w_1#closed_for_you')).toBe('/triage?item=u-w1#closed_for_you');
  });
  it('keeps view, section and tab names (Time ▸ VDP is not the vdp connector)', () => {
    expect(t('/time?view=vdp')).toBe('/time?view=vdp');
    expect(t('/settings?section=connectors')).toBe('/settings?section=connectors');
    expect(t('/deals?tab=missed&id=m_1')).toBe('/deals?tab=missed&id=u-m1');
  });
  it('leaves non-links alone', () => {
    expect(translateHrefs({ title: 'vdp' }, map).title).toBe('vdp');
    expect(translateHrefs({ href: 'https://example.com/vdp' }, map).href).toBe('https://example.com/vdp');
  });
});
