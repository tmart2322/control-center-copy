/**
 * The spotlight tour's rules: which steps a run shows (missing anchors skipped, seen ones not re-shown), what Next,
 * Back, Done and Skip record, what each key does, the focus trap's wrap, the first-scan deferral, and the geometry
 * of the cutout and the card. Plus the content: every tour step has a title and a short body.
 */
import { describe, expect, it } from 'vitest';
import { PAGE_HELP, pageHelpFor } from '@/guide/pages';
import {
  CARD_GAP,
  cutoutRadius,
  cutoutRect,
  finishRecord,
  mayStart,
  moveTour,
  needsScroll,
  placeCard,
  primaryLabel,
  readyToStart,
  resolveSteps,
  sameSteps,
  scrollDelta,
  stepLabel,
  stepTo,
  tourKeyAction,
  tourQueue,
  tourSteps,
  trapTab,
  type AutoStart,
  type TourRun,
} from '@/guide/tour';
import { personaOf } from '@/personas';

const marks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const ids = marks.map((m) => m.id);
const run = (index: number, steps: readonly string[] = ids): TourRun => ({ steps, index });

describe('which steps a run shows', () => {
  it('queues the unseen marks in order, and every mark for a replay', () => {
    expect(tourQueue(marks, { b: '2026-11-11T09:00:00Z' }, new Set(['d']), false).map((m) => m.id)).toEqual(['a', 'c']);
    expect(tourQueue(marks, { b: '2026-11-11T09:00:00Z' }, new Set(['d']), true).map((m) => m.id)).toEqual(ids);
  });

  it('skips a mark whose anchor is missing (another persona, an empty state) and keeps the order', () => {
    const present = new Set(['a', 'c', 'd']);
    expect(tourSteps(marks, (m) => present.has(m.id)).map((m) => m.id)).toEqual(['a', 'c', 'd']);
    expect(tourSteps(marks, () => false)).toEqual([]);
  });

  it('starts once two looks agree on the steps', () => {
    expect(sameSteps(null, [{ id: 'a' }])).toBe(false);
    expect(sameSteps([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }])).toBe(false);
    expect(sameSteps([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])).toBe(true);
    // the same step on another element (a fallback stood in) is not the same look
    expect(sameSteps([{ id: 'a', selector: '#x' }], [{ id: 'a', selector: '#y' }])).toBe(false);
  });

  it('a step stands on the first of its selectors the page shows, else it is left out', () => {
    const q = [
      { id: 'draft', selector: '#ready', fallback: ['#row', '#list'] },
      { id: 'stage', selector: '#stage' },
    ];
    expect(resolveSteps(q, (s) => s === '#row' || s === '#stage').map((s) => [s.id, s.selector])).toEqual([
      ['draft', '#row'],
      ['stage', '#stage'],
    ]);
    expect(resolveSteps(q, (s) => s === '#ready')).toEqual([q[0]]);
    expect(resolveSteps(q, () => false)).toEqual([]);
  });

  it('a first visit waits for the page to settle; a request starts once all its steps are there', () => {
    const look = (over: Partial<Parameters<typeof readyToStart>[0]>) => readyToStart({ found: 2, queued: 3, agreed: 0, tries: 0, maxTries: 20, requested: false, ...over });
    expect(look({ found: 0, tries: 20 })).toBe(false);
    expect(look({})).toBe(false);
    expect(look({ agreed: 1 })).toBe(true);
    expect(look({ tries: 20 })).toBe(true);
    // requested (Take the tour, Show me): everything there is enough; a page still loading needs three agreeing looks
    expect(look({ requested: true, found: 3 })).toBe(true);
    expect(look({ requested: true, agreed: 1 })).toBe(false);
    expect(look({ requested: true, agreed: 2 })).toBe(true);
    expect(look({ requested: true, tries: 20 })).toBe(true);
  });

  it('a page tour run to its end records the page as toured; Skip and an item’s tip do not add it', () => {
    expect(finishRecord('next', true, 'page', 'tour.home')).toEqual(['tour.home']);
    expect(finishRecord('next', false, 'page', 'tour.home')).toEqual([]);
    expect(finishRecord('skip', true, 'page', 'tour.home')).toEqual([]);
    expect(finishRecord('next', true, 'item', 'tour.home')).toEqual([]);
  });

  it('resumes: a tour cut short after step 2 shows only the last two next time, from "Step 1 of 2"', () => {
    let r: TourRun | null = run(0);
    const seen: Record<string, string> = {};
    for (let i = 0; i < 2; i++) {
      const out = moveTour(r!, 'next', ids);
      for (const id of out.record) seen[id] = '2026-11-11T09:00:00Z';
      r = out.run;
    }
    expect(r).toEqual(run(2));
    const next = tourSteps(tourQueue(marks, seen, new Set(), false), () => true);
    expect(next.map((m) => m.id)).toEqual(['c', 'd']);
    expect(stepLabel(0, next.length)).toBe('Step 1 of 2');
  });

  it('is persona-aware: an SE with logging gets the quarter step on Time, one without does not', () => {
    const se = personaOf({ profile: { role: 'se_ic' } });
    const noLog = personaOf({ persona: { id: 'se', features: { activityLogging: false } } });
    expect(pageHelpFor('time', se)!.marks.map((m) => m.id)).toContain('time.quarter');
    expect(pageHelpFor('time', noLog)!.marks.map((m) => m.id)).not.toContain('time.quarter');
  });
});

describe('moving through a run', () => {
  it('Next records the step it leaves and moves on; Done on the last step ends the tour', () => {
    expect(moveTour(run(0), 'next', ids)).toEqual({ run: run(1), record: ['a'] });
    expect(moveTour(run(3), 'next', ids)).toEqual({ run: null, record: ['d'] });
  });

  it('Back records nothing and stays on step 1', () => {
    expect(moveTour(run(2), 'back', ids)).toEqual({ run: run(1), record: [] });
    expect(moveTour(run(0), 'back', ids)).toEqual({ run: run(0), record: [] });
  });

  it('Skip (the link or Esc) records the page’s whole set, the steps not shown included', () => {
    const out = moveTour(run(1, ['a', 'c']), 'skip', ids);
    expect(out.run).toBeNull();
    expect([...out.record].sort()).toEqual(ids);
  });

  it('a step whose element went away mid-tour is passed over, not recorded', () => {
    const gone = (id: string) => id !== 'b';
    expect(moveTour(run(0), 'next', ids, gone)).toEqual({ run: run(2), record: ['a'] });
    expect(moveTour(run(2), 'back', ids, gone)).toEqual({ run: run(0), record: [] });
    expect(moveTour(run(2), 'next', ids, (id) => id !== 'd')).toEqual({ run: null, record: ['c'] });
  });

  it('stepTo walks either way past missing steps', () => {
    const at = (i: number) => i !== 1;
    expect(stepTo(4, 0, 1, at)).toBe(2);
    expect(stepTo(4, 3, 1, at)).toBe('end');
    expect(stepTo(4, 2, -1, at)).toBe(0);
    expect(stepTo(4, 0, -1, at)).toBe(0);
  });

  it('labels: "Step 2 of 4", a lone step is a tip; Next, then Done on the last', () => {
    expect(stepLabel(1, 4)).toBe('Step 2 of 4');
    expect(stepLabel(0, 1)).toBe('Tip');
    expect([0, 1, 2].map((i) => primaryLabel(i, 3))).toEqual(['Next', 'Next', 'Done']);
    expect(primaryLabel(0, 1)).toBe('Done');
  });
});

describe('keys and focus', () => {
  it('→ and Enter are Next, ← is Back, Esc skips', () => {
    const off = { onControl: false };
    expect(tourKeyAction({ key: 'ArrowRight' }, off)).toBe('next');
    expect(tourKeyAction({ key: 'Enter' }, off)).toBe('next');
    expect(tourKeyAction({ key: 'ArrowLeft' }, off)).toBe('back');
    expect(tourKeyAction({ key: 'Escape' }, off)).toBe('skip');
    expect(tourKeyAction({ key: 'j' }, off)).toBeNull();
  });

  it('Enter on a focused button is that button’s (Enter on Back goes back), and modified keys are not the tour’s', () => {
    expect(tourKeyAction({ key: 'Enter' }, { onControl: true })).toBeNull();
    expect(tourKeyAction({ key: 'ArrowRight', metaKey: true }, { onControl: false })).toBeNull();
    expect(tourKeyAction({ key: 'Escape', ctrlKey: true }, { onControl: false })).toBeNull();
    expect(tourKeyAction({ key: 'ArrowLeft', altKey: true }, { onControl: false })).toBeNull();
  });

  it('Tab wraps inside the card, both ways, and pulls focus in from outside', () => {
    expect(trapTab(3, 0, false)).toBe(1);
    expect(trapTab(3, 2, false)).toBe(0);
    expect(trapTab(3, 0, true)).toBe(2);
    expect(trapTab(3, -1, false)).toBe(0);
    expect(trapTab(3, -1, true)).toBe(2);
    expect(trapTab(0, -1, false)).toBe(-1);
  });
});

describe('when it starts', () => {
  const base: AutoStart = { enabled: true, replay: false, personaReady: true, seenReady: true, paused: false, ranThisVisit: false, scanKnown: true, scanFilling: false };

  it('starts on a first visit once persona, seen state and the first-scan state are known', () => {
    expect(mayStart(base)).toBe(true);
    expect(mayStart({ ...base, personaReady: false })).toBe(false);
    expect(mayStart({ ...base, seenReady: false })).toBe(false);
    expect(mayStart({ ...base, scanKnown: false })).toBe(false);
    expect(mayStart({ ...base, paused: true })).toBe(false);
  });

  it('waits while the first scan fills in, and runs once per visit', () => {
    expect(mayStart({ ...base, scanFilling: true })).toBe(false);
    expect(mayStart({ ...base, ranThisVisit: true })).toBe(false);
  });

  it('stays off for automation; a replay from "?" runs anyway, first scan or not', () => {
    expect(mayStart({ ...base, enabled: false })).toBe(false);
    expect(mayStart({ ...base, enabled: false, replay: true, scanFilling: true, ranThisVisit: true, scanKnown: false })).toBe(true);
    expect(mayStart({ ...base, replay: true, paused: true })).toBe(false);
  });
});

describe('geometry', () => {
  const vp = { width: 1280, height: 800 };

  it('the cutout is the element plus 8 px, kept inside the viewport', () => {
    expect(cutoutRect({ top: 100, left: 200, width: 300, height: 40 }, vp)).toEqual({ top: 92, left: 192, width: 316, height: 56 });
    expect(cutoutRect({ top: 0, left: 0, width: 2000, height: 1000 }, vp)).toEqual({ top: 4, left: 4, width: 1272, height: 792 });
    expect(cutoutRect({ top: 900, left: 0, width: 100, height: 40 }, vp)).toBeNull();
  });

  it('its corners are concentric with the element’s own', () => {
    expect(cutoutRadius('16px', 300, 200)).toBe(24);
    expect(cutoutRadius('0px', 300, 200)).toBe(8);
    expect(cutoutRadius('', 300, 200)).toBe(8);
    expect(cutoutRadius('10px 4px', 300, 200)).toBe(18);
    // a round button stays round: 50% (or 9999px) of a 32 px box
    expect(cutoutRadius('50%', 32, 32)).toBe(24);
    expect(cutoutRadius('9999px', 32, 32)).toBe(24);
  });

  it('scrolls only when the element is not comfortably in its panel: centred, or top first when it is taller', () => {
    const view = { top: 64, left: 0, width: 1000, height: 736 };
    expect(needsScroll({ top: 300, left: 0, width: 100, height: 100 }, view)).toBe(false);
    expect(needsScroll({ top: 780, left: 0, width: 100, height: 100 }, view)).toBe(true);
    expect(needsScroll({ top: 70, left: 0, width: 100, height: 100 }, view)).toBe(true);
    expect(scrollDelta({ top: 900, left: 0, width: 100, height: 100 }, view)).toBe(950 - 432);
    expect(scrollDelta({ top: 900, left: 0, width: 100, height: 2000 }, view)).toBe(900 - 64 - 24);
  });

  const size = { width: 320, height: 180 };
  const overlaps = (p: { top: number; left: number }, c: { top: number; left: number; width: number; height: number }) =>
    p.left < c.left + c.width && c.left < p.left + size.width && p.top < c.top + c.height && c.top < p.top + size.height;

  it('the card sits on the mark’s side, with the arrow at the cutout’s centre', () => {
    const cut = { top: 100, left: 400, width: 200, height: 60 };
    const p = placeCard(cut, size, 'bottom', vp);
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(160 + CARD_GAP);
    expect(p.left).toBe(340);
    expect(p.arrow).toBe(160);
    expect(overlaps(p, cut)).toBe(false);
  });

  it('flips when the side has no room, then tries the perpendicular sides', () => {
    const low = { top: 700, left: 400, width: 200, height: 60 };
    expect(placeCard(low, size, 'bottom', vp).side).toBe('top');
    // a tall column: neither above nor below fits, so beside it
    const column = { top: 80, left: 40, width: 400, height: 680 };
    const p = placeCard(column, size, 'bottom', vp);
    expect(p.side).toBe('right');
    expect(overlaps(p, column)).toBe(false);
  });

  it('the arrow stays clear of the card’s corners when the card is shifted to the viewport edge', () => {
    const corner = { top: 100, left: 4, width: 40, height: 40 };
    const p = placeCard(corner, size, 'bottom', vp);
    expect(p.side).toBe('bottom');
    expect(p.left).toBe(12);
    expect(p.arrow).toBe(22);
  });

  it('a cutout too big for any side gets the card over its far end, without an arrow', () => {
    const huge = { top: 40, left: 40, width: 1200, height: 720 };
    const p = placeCard(huge, size, 'top', vp);
    expect(p.side).toBeNull();
    expect(p.arrow).toBeNull();
    expect(p.top + size.height).toBeLessThanOrEqual(vp.height - 12);
    expect(p.left).toBeGreaterThanOrEqual(12);
  });
});

describe('tour content', () => {
  it('every step has a short title and a body of one or two sentences', () => {
    for (const [key, page] of Object.entries(PAGE_HELP)) {
      for (const m of page!.marks) {
        const where = `${key} ${m.id}`;
        expect(m.title.length, where).toBeGreaterThan(2);
        expect(m.title.length, where).toBeLessThanOrEqual(32);
        expect(m.text.length, where).toBeLessThanOrEqual(150);
        const sentences = m.text.split(/(?<=[.?!])\s+(?=[A-Z“])/).filter(Boolean);
        expect(sentences.length, where).toBeGreaterThanOrEqual(1);
        expect(sentences.length, where).toBeLessThanOrEqual(2);
        expect(m.id.startsWith(`${key}.`), where).toBe(true);
      }
    }
  });
});
