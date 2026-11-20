/**
 * D-55, found by the release crawl: a source or feature the AE hasn't activated has no daily surface. With VDP broken
 * (the placeholder seed's VDP needs re-auth), an AE sees no "Re-auth VDP" chore on Today, no VDP alert in Home's
 * footer or Today's Health line, no item marked stale because of VDP, and no missed opps in Triage. An SE keeps all
 * of them. Placeholder seed only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockDataSource, type MockDataSource } from '@/server/datasource/mock';

let ds: MockDataSource;
beforeEach(() => {
  ds = createMockDataSource({ seedPath: 'src/mock/seed.example.json', autoplay: false, clockMode: 'seed' });
});
afterEach(() => ds.dispose());

async function asPersona(id: 'se' | 'ae') {
  const s = await ds.getSettings({} as never);
  if (s.persona.id !== id) await ds.patchSettings({ params: { section: 'persona' }, body: { ifVersion: s.persona.version, value: { id } } } as never);
}

async function surfaces() {
  const today = await ds.getToday({} as never);
  const home = await ds.getHome({ query: { wide: false } } as never);
  const items = await ds.listItems({ query: { tab: 'all_open' } } as never);
  const triage = await ds.getTriage({} as never);
  const json = JSON.stringify(today);
  return {
    reauthVdpChore: /Re-auth VDP/.test(json),
    footerVdp: home.footer.alerts.some((a) => /VDP/.test(a.label)),
    // the mock's connector ids are the sources ("vdp")
    staleFromVdp: items.items.some((w) => w.stale?.connectorId === 'vdp'),
    missedOpps: triage.groups.some((g) => g.group === 'missed_opps' && g.items.length > 0),
  };
}

describe('an AE (VDP and missed opps not activated)', () => {
  it('the SE baseline: the seed has VDP broken and missed opps, and an SE sees all of them', async () => {
    await asPersona('se');
    expect(await surfaces()).toEqual({ reauthVdpChore: true, footerVdp: true, staleFromVdp: true, missedOpps: true });
  });

  it('an AE sees none of them', async () => {
    await asPersona('ae');
    expect(await surfaces()).toEqual({ reauthVdpChore: false, footerVdp: false, staleFromVdp: false, missedOpps: false });
  });

  it('activating VDP and missed opps brings them back', async () => {
    await asPersona('ae');
    const s = await ds.getSettings({} as never);
    await ds.patchSettings({ params: { section: 'persona' }, body: { ifVersion: s.persona.version, value: { features: { vdp: true, missedOpps: true } } } } as never);
    expect(await surfaces()).toEqual({ reauthVdpChore: true, footerVdp: true, staleFromVdp: true, missedOpps: true });
  });
});
