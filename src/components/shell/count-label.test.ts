import { describe, expect, it } from 'vitest';
import { quietCountWhat } from './count-label';

describe('quietCountWhat', () => {
  it('says card for one and cards for more', () => {
    expect(`1${quietCountWhat('assistantPending', 1)}`).toBe('1 card not applied yet');
    expect(`3${quietCountWhat('assistantPending', 3)}`).toBe('3 cards not applied yet');
  });
  it('names what Time counts and adds nothing for plain counts', () => {
    expect(quietCountWhat('adminWaiting', 1)).toBe(' waiting on you: to log, or VDPs that need you');
    expect(quietCountWhat('today', 5)).toBe('');
    expect(quietCountWhat(undefined, 2)).toBe('');
  });
});
