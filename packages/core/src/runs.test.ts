import { describe, expect, it } from 'vitest';
import { fromRuns, toRuns } from './runs.js';

describe('triangle runs', () => {
  it('packs consecutive numbers', () => {
    expect(toRuns([1, 2, 3, 7, 9, 10])).toEqual([
      [1, 3],
      [7, 1],
      [9, 2],
    ]);
    expect(toRuns([])).toEqual([]);
  });
  it('round-trips', () => {
    const list = [0, 1, 2, 5, 6, 100];
    expect([...fromRuns(toRuns(list))]).toEqual(list);
  });
});
