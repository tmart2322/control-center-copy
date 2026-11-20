/**
 * Home ▸ Log & fix rows for the Specialist Forecast duty (src/engines/home/persona-gaps.ts) on the mock's placeholder
 * records: the AE gets "N forecast notes due Mon", "N deal roles to set" and "N opp(s) with no Specialist Forecast";
 * an SE gets none; an SE who activates the feature gets them (a persona preconfigures, it never takes away).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { personaGaps } from '../../src/engines/home/persona-gaps';
import { homeInputFromStore } from '../../src/server/datasource/mock/home';
import { createMockDataSource, type MockDataSource } from '../../src/server/datasource/mock';

let ds: MockDataSource | null = null;
afterEach(() => {
  ds?.dispose();
  ds = null;
});

async function withPersona(value: Record<string, unknown>) {
  ds = createMockDataSource({ autoplay: false, delays: { enrichMs: 1e8, stepMs: 1e8, chatTokenMs: 0, verifyMs: 1e8, reevalMs: 1e8 } });
  ds.clock.freeze(new Date(ds.loaded.seed.meta.asOf));
  ds.resetStore();
  const s = await ds.getSettings({} as never);
  await ds.patchSettings({ params: { section: 'persona' }, body: { ifVersion: s.persona.version, value } } as never);
  const input = homeInputFromStore(ds, false);
  return personaGaps(input, Date.parse(input.now));
}

describe('Home ▸ Log & fix: the Specialist Forecast rows', () => {
  it('an AE gets notes due, deal roles to set and opps with no record, each opening Time ▸ Forecast', async () => {
    const gaps = await withPersona({ id: 'ae' });
    expect(gaps.map((g) => [g.rule, g.row.title])).toEqual([
      ['forecast_notes', '3 forecast notes due Mon'],
      ['deal_role', '2 deal roles to set'],
      ['missing_sfr', '1 opp with no Specialist Forecast'],
    ]);
    const notes = gaps[0]!.row;
    expect(notes).toMatchObject({ state: 'overdue', stateLabel: '1 overdue', href: '/activity?view=forecast', entity: { kind: 'specialist_forecast' } });
    expect(gaps[2]!.row.entity.kind).toBe('opportunity');
  });

  it('the Home payload carries them in Log & fix', async () => {
    await withPersona({ id: 'ae' });
    const home = await ds!.getHome({ query: {} } as never);
    const fix = home.sections.find((s) => s.id === 'fix')!;
    expect(fix.rows.map((r) => r.id)).toContain('gap:forecast_notes');
  });

  // D-59 added the SE's own persona row ("N VDPs need you", vdp_open) next to these: the forecast rows are filtered.
  const FORECAST = new Set(['forecast_notes', 'deal_role', 'missing_sfr']);
  it('an SE gets none; an SE who activates the feature gets them', async () => {
    const se = await withPersona({ id: 'se' });
    expect(se.filter((g) => FORECAST.has(g.rule))).toEqual([]);
    expect(se.map((g) => g.rule)).toEqual(['vdp_open']);
    ds!.dispose();
    const on = await withPersona({ id: 'se', features: { specialistForecast: true } });
    expect(on.map((g) => g.rule).filter((r) => FORECAST.has(r))).toEqual(['forecast_notes', 'deal_role', 'missing_sfr']);
  });

  it('D-59: an AE (VDP not active) gets no VDP row; the SE row opens Time ▸ VDP on the first VDP that needs them', async () => {
    expect((await withPersona({ id: 'ae' })).map((g) => g.rule)).not.toContain('vdp_open');
    ds!.dispose();
    const row = (await withPersona({ id: 'se' })).find((g) => g.rule === 'vdp_open')!.row;
    expect(row).toMatchObject({ href: '/activity?view=vdp', entity: { kind: 'vdp' }, title: expect.stringMatching(/VDPs? needs? you/) });
  });
});
