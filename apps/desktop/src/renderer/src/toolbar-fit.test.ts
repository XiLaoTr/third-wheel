import { describe, expect, it } from 'vitest';
import { fitClasses, fitLevel, MAX_FIT_LEVEL } from './toolbar-fit.js';

describe('toolbar fit', () => {
  it('takes the first level that fits', () => {
    expect(fitLevel(() => false)).toBe(0);
    expect(fitLevel((l) => l < 2)).toBe(2);
    expect(fitLevel(() => true)).toBe(MAX_FIT_LEVEL);
  });

  it('adds up the classes', () => {
    expect(fitClasses(0)).toEqual([]);
    expect(fitClasses(3)).toEqual(['fit-1', 'fit-2', 'fit-3']);
    expect(fitClasses(9)).toHaveLength(MAX_FIT_LEVEL);
  });
});
