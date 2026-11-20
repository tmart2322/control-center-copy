/**
 * Activity's views per persona (D-55, D-60 shell, D-70): two main tabs, Org62 and VDP. Org62's sub-tabs are Log it
 * (?view=week, the SE's default) · Needs you (?view=needs) · Weeks (?view=weeks) · Ledger (?view=log) · Use cases
 * (?view=usecases, with VDP) · Forecast for an AE (their default); VDP's are Changes (?view=vdp) · My VDPs
 * (?view=vdp&sub=mine). An AE without VDP sees Org62 only, and a direct ?view=vdp says it is available to activate;
 * nothing gated shows while the persona loads. Every old ?view= still lands, and a ?week= opens Weeks on that week.
 */
import { describe, expect, it } from 'vitest';
import { personaOf } from '@/personas';
import { redirectFor } from '@/components/shell/routes';
import { areaTabsFor, hrefForArea, hrefForVdpSub, hrefForView, hrefForWeek, timeAreaOf, timeTabsFor, timeViewAccess, timeViewOf, vdpSubOf } from './views';

const SE = personaOf({ persona: { id: 'se' } });
const AE = personaOf({ persona: { id: 'ae' } });

describe('activity views per persona', () => {
  it('reads ?view= as before, plus Needs you, Weeks and Use cases', () => {
    expect(timeViewOf('log')).toBe('log');
    expect(timeViewOf('vdp')).toBe('vdp');
    expect(timeViewOf('needs')).toBe('needs');
    expect(timeViewOf('weeks')).toBe('weeks');
    expect(timeViewOf('usecases')).toBe('usecases');
    expect(timeViewOf(null)).toBe('week');
    expect(timeViewOf('bogus')).toBe('week');
    expect(timeViewOf('forecast')).toBe('forecast');
  });

  it('a ?week= deep link opens Weeks on that week (Log it and Needs you show no week any more)', () => {
    expect(timeViewOf(null, SE, '2026-11-02')).toBe('weeks');
    expect(timeViewOf('week', SE, '2026-11-02')).toBe('weeks');
    expect(timeViewOf('needs', SE, '2026-11-02')).toBe('weeks');
    expect(timeViewOf('log', SE, '2026-11-02')).toBe('log');
    expect(timeViewOf('vdp', SE, '2026-11-02')).toBe('vdp');
    expect(hrefForWeek('2026-11-02')).toBe('/activity?view=weeks&week=2026-11-02');
    expect(hrefForWeek(null)).toBe('/activity?view=weeks');
  });

  it('an AE lands on Forecast; everyone else on Log it', () => {
    expect(timeViewOf(null, AE)).toBe('forecast');
    expect(timeViewOf(null, SE)).toBe('week');
    expect(timeViewOf('log', AE)).toBe('log');
    expect(timeViewOf(null, personaOf({ persona: { id: 'ae', features: { specialistForecast: false } } }))).toBe('week');
  });

  it('two main tabs for the SE: Org62 (Log it · Needs you · Weeks · Ledger · Use cases) and VDP (Changes · My VDPs)', () => {
    expect(areaTabsFor(SE)).toEqual([
      { value: 'org62', label: 'Org62' },
      { value: 'vdp', label: 'VDP' },
    ]);
    expect(timeTabsFor(SE).map((t) => t.label)).toEqual(['Log it', 'Needs you', 'Weeks', 'Ledger', 'Use cases']);
    expect(timeAreaOf('vdp')).toBe('vdp');
    for (const v of ['week', 'needs', 'weeks', 'log', 'usecases', 'forecast'] as const) expect(timeAreaOf(v)).toBe('org62');
    expect(vdpSubOf(null)).toBe('changes');
    expect(vdpSubOf('mine')).toBe('mine');
    expect(vdpSubOf('bogus')).toBe('changes');
    expect(timeViewAccess('forecast', SE)).toEqual({ state: 'inactive', feature: 'specialistForecast' });
    for (const v of ['week', 'needs', 'weeks', 'log', 'usecases', 'vdp'] as const) expect(timeViewAccess(v, SE)).toEqual({ state: 'show' });
  });

  it('links: the bare /activity is the persona default; VDP opens on Changes', () => {
    expect(hrefForArea('org62', SE)).toBe('/activity');
    expect(hrefForArea('org62', AE)).toBe('/activity?view=forecast');
    expect(hrefForArea('vdp', SE)).toBe('/activity?view=vdp');
    expect(hrefForView('week', SE)).toBe('/activity');
    expect(hrefForView('needs', SE)).toBe('/activity?view=needs');
    expect(hrefForView('usecases', SE)).toBe('/activity?view=usecases');
    expect(hrefForView('forecast', AE)).toBe('/activity');
    expect(hrefForView('week', AE)).toBe('/activity?view=week');
    expect(hrefForVdpSub('changes')).toBe('/activity?view=vdp');
    expect(hrefForVdpSub('mine')).toBe('/activity?view=vdp&sub=mine');
  });

  it('every old /time link lands on /activity with its query', () => {
    expect(redirectFor('/time', new URLSearchParams(''))).toBe('/activity');
    expect(redirectFor('/time', new URLSearchParams('view=vdp&sub=mine'))).toBe('/activity?view=vdp&sub=mine');
    expect(redirectFor('/time', new URLSearchParams('week=2026-11-02'))).toBe('/activity?week=2026-11-02');
    expect(redirectFor('/time/', new URLSearchParams('view=needs&draft=d1'))).toBe('/activity?view=needs&draft=d1');
    expect(redirectFor('/activity', new URLSearchParams('view=needs'))).toBeNull();
  });

  it('an AE without VDP sees Org62 only, and VDP and Use cases are available on their own links', () => {
    expect(areaTabsFor(AE).map((t) => t.value)).toEqual(['org62']);
    expect(timeTabsFor(AE).map((t) => t.value)).toEqual(['week', 'needs', 'weeks', 'log', 'forecast']);
    expect(timeViewAccess('vdp', AE)).toEqual({ state: 'inactive', feature: 'vdp' });
    expect(timeViewAccess('usecases', AE)).toEqual({ state: 'inactive', feature: 'vdp' });
    expect(timeViewAccess('week', AE)).toEqual({ state: 'show' });
    expect(timeViewAccess('log', AE)).toEqual({ state: 'show' });
  });

  it('brings VDP back for an AE who activates it', () => {
    const ae = personaOf({ persona: { id: 'ae', features: { vdp: true } } });
    expect(areaTabsFor(ae).map((t) => t.value)).toEqual(['org62', 'vdp']);
    expect(timeViewAccess('vdp', ae)).toEqual({ state: 'show' });
  });

  it('shows nothing gated while the persona loads', () => {
    expect(areaTabsFor(null).map((t) => t.value)).toEqual(['org62']);
    expect(timeTabsFor(null).map((t) => t.value)).toEqual(['week', 'needs', 'weeks', 'log']);
    expect(timeViewAccess('vdp', null)).toEqual({ state: 'loading' });
    expect(timeViewAccess('week', null)).toEqual({ state: 'show' });
  });
});
